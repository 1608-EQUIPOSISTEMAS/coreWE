import { editionRepository } from './edition.repository.js'
import { teamsMeetingsRepository } from './teams-meetings.repository.js'
import { buildControlRow } from './edition.entity.js'
import { todayInLima } from './academic-outcomes.entity.js'
import {
  parseHourRange,
  needsTeams,
  futureSessions,
  instructorUpn,
  resolveOrganizer,
  desiredSlot,
  buildEventPayload,
  planEditionSync,
  matchOdooSession,
  meetingOptions,
  organizerIdFromJoinUrl,
  horizonEndOf,
  DEFAULT_HORIZON_DAYS
} from './teams-meetings.entity.js'
import { getCatalog } from '../catalog/catalog.usecases.js'
import { buildPresentialCourseName } from '../fico/odoo-sync/odoo-sync.entity.js'
import { odoo } from '../../shared/adapters/odoo/odoo.adapter.js'
import { startJob, getJob } from '../../shared/adapters/llm/ai-jobs.js'
import {
  isGraphConfigured,
  createTeamsEvent,
  updateTeamsEvent,
  cancelTeamsEvent,
  findOnlineMeetingByJoinUrl,
  updateOnlineMeeting
} from '../../shared/adapters/msgraph/msgraph.adapter.js'
import { DomainError } from '../../shared/errors.js'

const repo = teamsMeetingsRepository

// Links de Teams por sesion. Hoy cada aula tiene UN teams_link para todo el
// curso; esto crea una reunion independiente por sesion (evento de calendario
// con Teams en el buzon organizador) y guarda su link. teams_link queda como
// respaldo para lo que aun no tiene reunion.
export function teamsConfig (env = process.env) {
  return {
    configured: isGraphConfigured(env) && Boolean(env.MS_TEAMS_ORGANIZER),
    organizer: env.MS_TEAMS_ORGANIZER || null,
    // 'central' (todo en la cuenta organizadora) | 'instructor' (en la cuenta
    // del docente, que queda de anfitrion; cae a la central si no tiene).
    mode: env.MS_TEAMS_ORGANIZER_MODE === 'instructor' ? 'instructor' : 'central',
    horizonDays: Number(env.MS_TEAMS_HORIZON_DAYS) || DEFAULT_HORIZON_DAYS,
    inviteInstructor: env.MS_TEAMS_INVITE_INSTRUCTOR !== 'false',
    // Copiar cada link a su sesion en Odoo (slide.session.meeting_url).
    odooSync: env.MS_TEAMS_ODOO_SYNC !== 'false',
    // Opciones de la reunion (API onlineMeetings): docente coorganizador y
    // grabacion + transcripcion automaticas.
    coorganizer: env.MS_TEAMS_COORGANIZER !== 'false',
    autoRecord: env.MS_TEAMS_AUTO_RECORD !== 'false',
    // Quien entra sin sala de espera: everyone | organization | organizer | default
    lobby: env.MS_TEAMS_LOBBY_BYPASS || 'everyone'
  }
}

// Aplica coorganizador / grabacion automatica a las reuniones futuras cuya
// firma de opciones no es la deseada (recien creadas, docente cambiado o
// configuracion nueva). Un fallo queda en options_error y se reintenta.
async function applyMeetingOptions ({ work, cfg, today, stats }) {
  const instructorBy = new Map(work.map((w) => [Number(w.row.edition_num_id), w.instructor]))
  const rows = await repo.listForOptions([...instructorBy.keys()], today)
  for (const r of rows) {
    const editionId = Number(r.program_edition_id)
    const { patch, signature } = meetingOptions({
      instructor: instructorBy.get(editionId),
      coorganizer: cfg.coorganizer,
      autoRecord: cfg.autoRecord,
      lobby: cfg.lobby
    })
    if (r.meeting_options === signature) continue
    try {
      const organizerId = organizerIdFromJoinUrl(r.join_url)
      if (!organizerId) throw new Error('El link de Teams no trae el id del organizador')
      let meetingId = r.online_meeting_id
      if (!meetingId) {
        const m = await findOnlineMeetingByJoinUrl(organizerId, r.join_url)
        if (!m) throw new Error('Teams no devolvió la reunión de este link')
        meetingId = m.id
      }
      await updateOnlineMeeting(organizerId, meetingId, patch)
      await repo.markOptionsApplied(editionId, r.session_number, meetingId, signature)
      stats.options_applied++
    } catch (err) {
      const hint = err.statusCode === 403
        ? ' (falta la política de acceso de aplicación de Teams: scripts/teams-access-policy.ps1)'
        : ''
      await repo.markOptionsError(editionId, r.session_number, err.message + hint)
      stats.options_errors.push({ edition_num_id: editionId, session_number: r.session_number, message: err.message + hint })
    }
  }
}

// ── Odoo ────────────────────────────────────────────────────────────────────
// Cada aula es un slide.group en Odoo (mismo nombre con el que FICO matricula:
// odoo_activation + inicio) y cada sesion un slide.session con meeting_url.
async function odooSessionsOf (row, port) {
  const activation = String(row.odoo_activation || '').trim()
  if (!activation) throw new Error('El programa no tiene odoo_activation configurado')
  const name = buildPresentialCourseName({ odooActivation: activation, startDate: row.start_date })
  const groups = await port.callKw('slide.group', 'search_read', [[['name', '=', name]]], { fields: ['id'], limit: 2 })
  if (groups?.length > 1) throw new Error(`Hay más de un grupo en Odoo con el nombre "${name}"`)
  let groupId = groups?.[0]?.id
  if (!groupId) {
    // Producto movio el inicio y el grupo de Odoo conserva el nombre viejo:
    // se usa el grupo donde ya se escribieron links de esta aula.
    const hint = await repo.odooSessionHint(Number(row.edition_num_id))
    if (hint) {
      const [s] = await port.callKw('slide.session', 'read', [[hint]], { fields: ['slide_group_id'] })
      groupId = s?.slide_group_id?.[0]
    }
  }
  if (!groupId) throw new Error(`Grupo no encontrado en Odoo: "${name}"`)
  return port.callKw('slide.session', 'search_read', [[['slide_group_id', '=', groupId]]],
    { fields: ['id', 'sequence', 'name', 'meeting_url'] })
}

// Deja en Odoo el link correcto de cada sesion futura: lo escribe si falta o
// si Odoo tiene otro (el link unico del aula, o la sesion se recreo al
// reprogramar en Odoo), y retira los de reuniones canceladas. Se compara con
// lo que Odoo tiene de verdad. Un fallo queda en odoo_error y se reintenta.
async function syncOdooLinks ({ rowsById, today, stats, port = odoo, tick = () => {} }) {
  const pending = await repo.listOdooRows([...rowsById.keys()], today)
  const byEdition = new Map()
  for (const p of pending) {
    const k = Number(p.program_edition_id)
    if (!byEdition.has(k)) byEdition.set(k, [])
    byEdition.get(k).push(p)
  }
  for (const [editionId, items] of byEdition) {
    let sessions
    try {
      sessions = await odooSessionsOf(rowsById.get(editionId), port)
    } catch (err) {
      for (const p of items) await repo.markOdooError(editionId, p.session_number, err.message)
      stats.odoo_errors.push({ edition_num_id: editionId, message: err.message })
      items.forEach(tick)
      continue
    }
    for (const p of items) {
      const target = matchOdooSession(sessions, p.session_number)
      try {
        if (!target) throw new Error(`No existe la "Sesión ${p.session_number}" en el grupo de Odoo`)
        if (target.meeting_url !== p.join_url) {
          await port.callKw('slide.session', 'write', [[target.id], { meeting_url: p.join_url }])
          // Ya estaba escrito por el ERP y alguien lo borro o recreo la sesion.
          if (p.odoo_url === p.join_url) stats.odoo_repaired++
          else stats.odoo_written++
          await repo.markOdooSynced(editionId, p.session_number, target.id, p.join_url)
        } else if (p.odoo_url !== p.join_url) {
          await repo.markOdooSynced(editionId, p.session_number, target.id, p.join_url)
        }
      } catch (err) {
        await repo.markOdooError(editionId, p.session_number, err.message)
        stats.odoo_errors.push({ edition_num_id: editionId, session_number: p.session_number, message: err.message })
      }
      tick()
    }
  }

  // Reunion cancelada: se borra su link de Odoo solo si sigue siendo el que
  // escribio el ERP (si alguien ya puso otro a mano, se respeta).
  for (const c of await repo.listOdooToClear()) {
    try {
      if (c.odoo_session_id) {
        const [cur] = await port.callKw('slide.session', 'read', [[c.odoo_session_id]], { fields: ['meeting_url'] })
        if (cur && cur.meeting_url === c.odoo_url) {
          await port.callKw('slide.session', 'write', [[c.odoo_session_id], { meeting_url: false }])
          stats.odoo_cleared++
        }
      }
      await repo.markOdooSynced(Number(c.program_edition_id), c.session_number, c.odoo_session_id, null)
    } catch (err) {
      stats.odoo_errors.push({ edition_num_id: c.program_edition_id, session_number: c.session_number, message: err.message })
    }
  }
}

async function loadCandidates (today, editionIds = null) {
  // Mismo SELECT que el Control de ediciones; fin abierto = aulas en curso o
  // por empezar (el margen de 45 dias cubre las reprogramadas).
  let rows = await editionRepository.weeklyControlEditions(today, '2999-12-31')
  if (editionIds?.length) {
    const wanted = new Set(editionIds.map(Number))
    rows = rows.filter((r) => wanted.has(Number(r.edition_num_id)))
  }
  const ids = rows.map((r) => Number(r.edition_num_id))
  const [catalog, controls] = await Promise.all([
    getCatalog(),
    editionRepository.sessionControlsList(ids)
  ])
  const ctx = {
    dayCombos: catalog.we_day_combination || [],
    holidaySet: new Set((catalog.we_holiday || []).map((h) => h.variable_3).filter(Boolean)),
    controls
  }
  return rows.map((r) => ({ row: r, control: buildControlRow(r, ctx) }))
}

// Sincroniza las reuniones contra el cronograma derivado.
//   editionIds: solo esas aulas (p.ej. tras reprogramar); null = todas.
//   dryRun: no llama a Graph ni escribe; devuelve lo que haria.
export async function syncTeamsMeetings ({ editionIds = null, dryRun = false, progreso = () => {}, env = process.env } = {}) {
  const cfg = teamsConfig(env)
  if (!dryRun && !cfg.configured) {
    throw new DomainError('Teams no configurado: faltan MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET o MS_TEAMS_ORGANIZER en el .env', { statusCode: 409 })
  }
  const today = todayInLima()
  const horizonEnd = horizonEndOf(today, cfg.horizonDays)
  const candidates = await loadCandidates(today, editionIds)

  const stats = {
    dry_run: dryRun,
    today,
    horizon_end: horizonEnd,
    editions_checked: candidates.length,
    editions_with_sessions: 0,
    editions_to_create: 0,
    // Docente sin usuario de Teams en el ERP: sin invitacion ni coorganizador.
    editions_without_instructor_account: 0,
    instructors_invited: 0,
    invites_avg: 0,
    invites_max: 0,
    skipped_in_person: 0,
    skipped_no_hours: [],
    created: 0,
    updated: 0,
    cancelled: 0,
    errors: [],
    odoo_written: 0,
    odoo_repaired: 0,
    odoo_cleared: 0,
    odoo_errors: [],
    options_applied: 0,
    options_errors: [],
    sample: []
  }

  const work = []
  for (const { row, control } of candidates) {
    const sessions = futureSessions(control, today)
    // Presenciales: se dictan en local, sin Teams. Se cuentan solo las que
    // tienen clases dentro del rango, igual que el resto del resumen.
    if (!needsTeams(row)) {
      if (sessions.some((s) => s.date <= horizonEnd)) stats.skipped_in_person++
      continue
    }
    const hours = parseHourRange(row.hour_alias)
    if (!sessions.length) continue
    if (!hours) { stats.skipped_no_hours.push(row.edition_num_id); continue }
    stats.editions_with_sessions++
    const instructor = instructorUpn(row)
    work.push({
      row,
      instructor,
      organizer: resolveOrganizer({ mode: cfg.mode, central: cfg.organizer, instructor }) || '(sin organizador)',
      slots: sessions.map((s) => desiredSlot(row, s, hours))
    })
  }

  const existingAll = await repo.listActive(work.map((w) => Number(w.row.edition_num_id)))
  const existingBy = new Map()
  for (const e of existingAll) {
    const k = Number(e.program_edition_id)
    if (!existingBy.has(k)) existingBy.set(k, [])
    existingBy.get(k).push(e)
  }

  // Huerfanos: solo en la corrida completa (en una parcial no se sabe).
  const orphans = editionIds?.length
    ? []
    : await repo.listOrphans(work.map((w) => Number(w.row.edition_num_id)), today)

  const plans = work.map((w) => ({
    ...w,
    plan: planEditionSync({
      slots: w.slots,
      existing: existingBy.get(Number(w.row.edition_num_id)) || [],
      horizonEnd,
      today,
      organizer: w.organizer
    })
  }))
  const totalOps = plans.reduce((a, p) => a + p.plan.create.length + p.plan.update.length + p.plan.cancel.length, 0) + orphans.length
  let done = 0
  const tick = () => progreso(++done, totalOps)

  // Lo que la pantalla muestra antes de confirmar: aulas que reciben reuniones
  // nuevas en esta corrida y cuantas invitaciones le llegan a cada docente.
  const invites = new Map()
  for (const p of plans) {
    if (!p.plan.create.length) continue
    stats.editions_to_create++
    if (!p.instructor) stats.editions_without_instructor_account++
    if (cfg.inviteInstructor && p.instructor) invites.set(p.instructor, (invites.get(p.instructor) || 0) + p.plan.create.length)
  }
  const perDocente = [...invites.values()]
  stats.instructors_invited = perDocente.length
  stats.invites_max = perDocente.length ? Math.max(...perDocente) : 0
  stats.invites_avg = perDocente.length ? Math.round((perDocente.reduce((a, b) => a + b, 0) / perDocente.length) * 10) / 10 : 0

  if (dryRun) {
    for (const p of plans) {
      stats.created += p.plan.create.length
      stats.updated += p.plan.update.length
      stats.cancelled += p.plan.cancel.length
      if (stats.sample.length < 15 && p.plan.create.length) {
        stats.sample.push({
          edition_num_id: p.row.edition_num_id,
          organizer: p.organizer,
          instructor: p.instructor,
          sessions: p.plan.create.map((s) => `${s.session_number}: ${s.start_local}-${s.end_local.slice(11)}`)
        })
      }
    }
    stats.cancelled += orphans.length
    return stats
  }

  const fail = (op, edition, session, err) => {
    stats.errors.push({ op, edition_num_id: edition, session_number: session, message: err.message })
  }

  for (const p of plans) {
    const editionId = Number(p.row.edition_num_id)
    for (const ev of p.plan.cancel) {
      try {
        if (ev.event_id) await cancelTeamsEvent(ev.organizer, ev.event_id, 'La sesión fue reprogramada o retirada del cronograma.')
        await repo.markCancelled(editionId, ev.session_number)
        stats.cancelled++
      } catch (err) { fail('cancel', editionId, ev.session_number, err) }
      tick()
    }
    for (const slot of p.plan.update) {
      try {
        const payload = buildEventPayload(p.row, slot, { organizer: slot.organizer, instructor: null })
        await updateTeamsEvent(slot.organizer, slot.event_id, {
          subject: payload.subject, start: payload.start, end: payload.end
        })
        await repo.updateSlot({ edition_id: editionId, ...slot })
        stats.updated++
      } catch (err) {
        fail('update', editionId, slot.session_number, err)
        await repo.markError({ edition_id: editionId, organizer: slot.organizer, ...slot }, err.message).catch(() => {})
      }
      tick()
    }
    for (const slot of p.plan.create) {
      const data = { edition_id: editionId, organizer: p.organizer, ...slot }
      try {
        const instructor = teamsConfig(env).inviteInstructor ? p.instructor : null
        const ev = await createTeamsEvent(p.organizer, buildEventPayload(p.row, slot, { organizer: p.organizer, instructor }))
        const joinUrl = ev?.onlineMeeting?.joinUrl || ev?.onlineMeetingUrl || null
        if (!joinUrl) throw new Error('Graph creó el evento pero no devolvió link de Teams (¿la cuenta organizadora tiene licencia de Teams?)')
        await repo.upsertActive({ ...data, event_id: ev.id, join_url: joinUrl })
        stats.created++
      } catch (err) {
        fail('create', editionId, slot.session_number, err)
        await repo.markError(data, err.message).catch(() => {})
      }
      tick()
    }
  }
  for (const ev of orphans) {
    try {
      if (ev.event_id) await cancelTeamsEvent(ev.organizer, ev.event_id, 'El aula fue retirada del cronograma.')
      await repo.markCancelled(Number(ev.program_edition_id), ev.session_number)
      stats.cancelled++
    } catch (err) { fail('cancel', ev.program_edition_id, ev.session_number, err) }
    tick()
  }
  if (cfg.coorganizer || cfg.autoRecord) {
    try {
      await applyMeetingOptions({ work, cfg, today, stats })
    } catch (err) {
      stats.options_errors.push({ message: `Opciones de Teams: ${err.message}` })
    }
  }
  if (cfg.odooSync) {
    const rowsById = new Map(work.map((w) => [Number(w.row.edition_num_id), w.row]))
    try {
      await syncOdooLinks({ rowsById, today, stats })
    } catch (err) {
      stats.odoo_errors.push({ message: `Odoo no respondió: ${err.message}` })
    }
  }
  if (stats.errors.length > 50) stats.errors = stats.errors.slice(0, 50)
  if (stats.odoo_errors.length > 50) stats.odoo_errors = stats.odoo_errors.slice(0, 50)
  if (stats.options_errors.length > 50) stats.options_errors = stats.options_errors.slice(0, 50)
  return stats
}

// Corrida en segundo plano (la pantalla consulta el avance). La misma clave
// impide dos sincronizaciones completas a la vez.
export function startTeamsSync ({ editionIds = null, dryRun = false } = {}) {
  const scope = editionIds?.length ? `ed:${[...editionIds].sort().join(',')}` : 'all'
  return startJob({ tipo: 'teams_sync', clave: `teams_sync:${scope}:${dryRun ? 'dry' : 'run'}`, force: true },
    async ({ progreso }) => ({ ok: true, data: await syncTeamsMeetings({ editionIds, dryRun, progreso }) }))
}

export const teamsSyncStatus = (jobId) => getJob(jobId)

export async function teamsSummary () {
  const cfg = teamsConfig()
  const [summary, errors] = await Promise.all([repo.summary(todayInLima()), repo.listErrors(20)])
  return {
    configured: cfg.configured,
    organizer: cfg.organizer,
    mode: cfg.mode,
    horizon_days: cfg.horizonDays,
    ...summary,
    recent_errors: errors
  }
}

// Links por sesion de un aula (para el Control de ediciones / ficha del aula).
export async function editionTeamsLinks (editionId) {
  const rows = await repo.listActive([Number(editionId)])
  return rows
    .map((r) => ({ session_number: r.session_number, join_url: r.join_url, start_local: r.start_local, end_local: r.end_local }))
    .sort((a, b) => a.session_number - b.session_number)
}

// Pega join_url en cada sesion de filas ya armadas por buildControlRow.
export async function attachTeamsLinks (controlRows = []) {
  const ids = controlRows.map((r) => Number(r.edition_num_id))
  if (!ids.length) return controlRows
  const rows = await repo.listActive(ids).catch(() => [])
  const key = (e, n) => `${e}:${n}`
  const links = new Map(rows.map((r) => [key(Number(r.program_edition_id), Number(r.session_number)), r.join_url]))
  for (const r of controlRows) {
    for (const s of r.sessions || []) {
      s.teams_join_url = links.get(key(Number(r.edition_num_id), s.session_number)) || null
    }
  }
  return controlRows
}

// Tras cambiar el cronograma de un aula (Producto edita inicio/dias/horario,
// o se reprograma una sesion): mueve solo las reuniones de esas aulas, sin
// esperar a la sincronizacion diaria. Acepta un id o una lista (padre + hijos).
// Best-effort: si Teams no esta configurado o falla, el guardado no se cae.
export function syncTeamsForEdition (editionIds) {
  if (!teamsConfig().configured) return null
  const ids = [].concat(editionIds).map(Number).filter(Boolean)
  return ids.length ? startTeamsSync({ editionIds: ids }) : null
}
