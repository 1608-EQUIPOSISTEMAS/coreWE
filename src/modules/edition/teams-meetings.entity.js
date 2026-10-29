// Links de Teams por sesion (reglas puras, sin BD ni Graph).
//
// Cada sesion futura de un aula activa EN VIVO es un evento de calendario con
// reunion de Teams. El cronograma NO se guarda: sale de buildControlRow (fecha
// de inicio + dias + feriados + reprogramaciones). Lo unico persistido es el
// evento creado por sesion (edition_session_teams), y la sincronizacion compara
// ese estado contra el cronograma derivado: crea lo que falta, mueve lo que
// cambio de fecha/hora y cancela lo que ya no corresponde.

export const LIMA_TZ = 'SA Pacific Standard Time' // nombre Windows que entiende Graph
// Rango de creacion: cada sesion se crea (e invita al docente) cuando faltan
// 14 dias, asi nunca le llegan todas las invitaciones juntas.
export const DEFAULT_HORIZON_DAYS = 14
const IN_PERSON_ALIAS = 'we_modality_in_person'
export const ERP_CATEGORY = 'ERP Aulas'
export const ERP_FOOTER = 'Reunión generada automáticamente por el ERP (Control de Ediciones). No editar a mano: los cambios de fecha se hacen reprogramando la sesión en el ERP.'

// 'we_hour_combination_19_22' -> 19:00-22:00; '_1930_2200' -> 19:30-22:00.
export function parseHourRange (alias) {
  const m = /_(\d{2})(\d{2})?_(\d{2})(\d{2})?$/.exec(String(alias || ''))
  if (!m) return null
  const [, h1, m1 = '00', h2, m2 = '00'] = m
  const start = `${h1}:${m1}`
  const end = `${h2}:${m2}`
  if (Number(h1) > 23 || Number(h2) > 23 || Number(m1) > 59 || Number(m2) > 59 || end <= start) return null
  return { start, end }
}

// Presencial no lleva Teams; cualquier otra modalidad (En Vivo) si.
export const needsTeams = (row = {}) => row.modality_alias !== IN_PERSON_ALIAS

const addDays = (ymd, days) => {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export const horizonEndOf = (today, days = DEFAULT_HORIZON_DAYS) => addDays(today, days)

// Sesiones que deben tener reunion: fecha >= hoy y aun no dictadas (A/T).
// Una R futura cuenta en su fecha nueva (buildControlRow ya la desplaza).
export function futureSessions (controlRow, today) {
  return (controlRow?.sessions || []).filter(
    (s) => s.date >= today && s.status !== 'A' && s.status !== 'T'
  )
}

// UPN del docente en el tenant (instructors.teams_username), si parece correo.
export function instructorUpn (row = {}) {
  const v = String(row.teams_username || '').trim().toLowerCase()
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null
}

// Quien organiza: modo 'instructor' usa la cuenta del docente (queda como
// anfitrion); si no tiene, o en modo 'central', la cuenta central.
export function resolveOrganizer ({ mode = 'central', central = null, instructor = null } = {}) {
  if (mode === 'instructor' && instructor) return instructor
  return central ? String(central).trim().toLowerCase() : null
}

const firstWordCapitalized = (s) => {
  const w = String(s || '').trim().split(/\s+/)[0] || ''
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''
}

// Mismo nombre que Academica pone a mano a las reuniones del aula:
// "WE_EXCEL INTERM_Jonathan Sanchez_04.10" = curso, primer nombre y primer
// apellido del docente, inicio del aula DD.MM. Todas las sesiones del aula
// comparten el nombre; cada una es un evento distinto con su propio link.
export function sessionSubject (row) {
  const docente = [firstWordCapitalized(row.instructor_first_name), firstWordCapitalized(row.instructor_last_name)]
    .filter(Boolean).join(' ')
  const [, mm, dd] = String(row.start_date || '').slice(0, 10).split('-')
  const inicio = dd && mm ? `${dd}.${mm}` : ''
  return ['WE', String(row.abbreviation || '').trim(), docente, inicio].filter(Boolean).join('_')
}

// Lo que se compara para decidir si un evento existente hay que moverlo.
export function desiredSlot (row, session, hours) {
  return {
    session_number: session.session_number,
    start_local: `${session.date}T${hours.start}`,
    end_local: `${session.date}T${hours.end}`,
    subject: sessionSubject(row)
  }
}

export function buildEventPayload (row, slot, { organizer, instructor } = {}) {
  const attendees = instructor && instructor !== organizer
    ? [{ emailAddress: { address: instructor, name: row.instructor || instructor }, type: 'required' }]
    : []
  return {
    subject: slot.subject,
    body: {
      contentType: 'HTML',
      content: `<p>${row.abbreviation} — Sesión ${slot.session_number}` +
        `${row.instructor ? ` · Docente: ${row.instructor}` : ''}</p>` +
        `<p style="color:#888">${ERP_FOOTER}</p>`
    },
    // Marca visible en Outlook (color/filtro) para distinguirlas de las manuales.
    categories: [ERP_CATEGORY],
    start: { dateTime: `${slot.start_local}:00`, timeZone: LIMA_TZ },
    end: { dateTime: `${slot.end_local}:00`, timeZone: LIMA_TZ },
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness',
    attendees,
    allowNewTimeProposals: false,
    responseRequested: false,
    isReminderOn: true,
    reminderMinutesBeforeStart: 30,
    // Idempotencia del POST: el mismo transactionId no crea dos eventos.
    transactionId: `erp-ed${row.edition_num_id}-s${slot.session_number}-${slot.start_local.replace(/\D/g, '')}`
  }
}

// Opciones de la reunion de Teams: docente como coorganizador (puede admitir,
// silenciar, grabar y cambiar opciones; no borrar la reunion) y grabacion +
// transcripcion automaticas. La firma resume lo aplicado: si cambia (otro
// docente, otra opcion) se vuelve a aplicar.
// lobby: quien entra directo sin sala de espera. 'everyone' = todos, incluso
// alumnos sin cuenta del tenant; otro valor = la configuracion de Teams.
export const LOBBY_SCOPES = ['everyone', 'organization', 'organizer']
export function meetingOptions ({ instructor = null, coorganizer = true, autoRecord = true, lobby = 'everyone' } = {}) {
  const coorg = coorganizer && instructor ? instructor : null
  const lobbyScope = LOBBY_SCOPES.includes(lobby) ? lobby : null
  const patch = {
    allowRecording: true,
    allowTranscription: true,
    recordAutomatically: Boolean(autoRecord),
    participants: {
      attendees: coorg ? [{ upn: coorg, role: 'coorganizer' }] : []
    }
  }
  if (lobbyScope) patch.lobbyBypassSettings = { scope: lobbyScope, isDialInBypassEnabled: true }
  const signature = `rec=${autoRecord ? 1 : 0};co=${coorg || '-'};lobby=${lobbyScope || '-'}`
  return { patch, signature }
}

// El link de Teams trae el objectId del organizador en su contexto
// (...?context={"Tid":"…","Oid":"<id>"}); la API onlineMeetings lo exige y
// leerlo de ahi evita pedir el permiso User.Read.All solo para eso.
export function organizerIdFromJoinUrl (joinUrl) {
  try {
    const ctx = new URL(joinUrl).searchParams.get('context')
    const oid = ctx && JSON.parse(ctx).Oid
    return /^[0-9a-f-]{36}$/i.test(oid || '') ? oid : null
  } catch {
    return null
  }
}

// Sesion de Odoo (slide.session del grupo del aula) que corresponde al numero
// de sesion del ERP. Se cruza por NUMERO, no por fecha: las fechas en Odoo se
// mantienen a mano y quedan viejas tras feriados y reprogramaciones, pero la
// "Sesión 5" de Odoo sigue siendo la sesion 5. sequence primero; si falta, el
// numero del nombre ("Sesión 5:").
export function matchOdooSession (odooSessions = [], sessionNumber) {
  const n = Number(sessionNumber)
  const bySeq = odooSessions.filter((s) => Number(s.sequence) === n)
  if (bySeq.length === 1) return bySeq[0]
  const byName = odooSessions.filter((s) => {
    const m = /sesi[oó]n\s*(\d+)/i.exec(String(s.name || ''))
    return m && Number(m[1]) === n
  })
  return byName.length === 1 ? byName[0] : null
}

// Plan de una edicion.
//   existing: filas activas de edition_session_teams de esa edicion
//   slots:    desiredSlot de sus sesiones futuras (sin tope de horizonte)
// Crea solo dentro del horizonte (las demas se crean cuando entren en la
// ventana: menos eventos que mover si el aula se reprograma). Lo que ya existe
// se mantiene/mueve aunque quede fuera del horizonte, para no cambiar el link.
// Se cancela lo que ya no tiene sesion futura, salvo lo ya pasado.
export function planEditionSync ({ slots = [], existing = [], horizonEnd, today, organizer }) {
  const bySession = new Map(existing.map((e) => [Number(e.session_number), e]))
  const wanted = new Set(slots.map((s) => s.session_number))
  const create = []
  const update = []
  const cancel = []

  for (const slot of slots) {
    const ev = bySession.get(slot.session_number)
    if (!ev) {
      if (slot.start_local.slice(0, 10) <= horizonEnd) create.push(slot)
      continue
    }
    // Cambio de organizador (p.ej. se paso a modo docente): recrear.
    if (organizer && ev.organizer && ev.organizer !== organizer) {
      cancel.push(ev)
      if (slot.start_local.slice(0, 10) <= horizonEnd) create.push(slot)
      continue
    }
    if (ev.start_local !== slot.start_local || ev.end_local !== slot.end_local || ev.subject !== slot.subject) {
      update.push({ ...slot, event_id: ev.event_id, organizer: ev.organizer })
    }
  }
  for (const ev of existing) {
    if (!wanted.has(Number(ev.session_number)) && String(ev.start_local).slice(0, 10) >= today) cancel.push(ev)
  }
  return { create, update, cancel }
}
