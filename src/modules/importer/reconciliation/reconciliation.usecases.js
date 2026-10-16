import { reconciliationRepository } from './reconciliation.repository.js'
import { reconcile, normText, mergeSheets } from './reconciliation.entity.js'
import { proposeFixes, planFinancialFix, FIX_ACTIONS } from './reconciliation.fixes.js'
import { toReconciliationDto, toFixResultsDto } from './reconciliation.dto.js'
import { parseSheetRows } from '../importer.usecases.js'
import { importerPorts } from '../importer.ports.js'
import { enrollmentFicoImporter, ensureChildren, membershipInscription, rowPaymentDetail } from '../importers/enrollment-fico.importer.js'
import { DomainError } from '../../../shared/errors.js'

// Orquesta la conciliacion hoja FICO <-> sistema: lee las hojas con el MISMO
// parser que importa (incluidas las filas R, para verificar que no esten
// activas), trae de la BD lo necesario en pocas queries y delega la comparacion
// en la entity. Cada fila sale con las correcciones que se le pueden aplicar
// (Fase 3); aplicarlas es una llamada aparte que vuelve a conciliar en el
// servidor: solo se ejecuta lo que la conciliacion ACTUAL sigue proponiendo.
//
// Un programa vive en una hoja por año (BI-EZ-01 2025 y 2026) y la BD es una
// sola: se concilian juntas. Si una fila se repite entre hojas, manda la
// ULTIMA de la lista (la mas reciente: esa venta ya cuenta como de ese año).

const repo = reconciliationRepository

// Las hojas se bajan de Google (lo mas lento: unos 6 s cada una). Conciliar
// siempre las baja de nuevo; las correcciones reusan la ultima lectura por un
// rato para que aplicar no tarde lo mismo que conciliar. La BD se lee siempre.
// ponytail: cache en memoria de un solo proceso, como el progreso del importador.
const SHEET_CACHE_TTL_MS = 15 * 60 * 1000
const sheetCache = new Map() // url -> { rows, ts }

async function readSheet (url, { fresh }) {
  const hit = sheetCache.get(url)
  if (!fresh && hit && Date.now() - hit.ts < SHEET_CACHE_TTL_MS) return hit.rows
  const rows = await parseSheetRows('enrollment_fico', url, { includeExcluded: true })
  sheetCache.set(url, { rows, ts: Date.now() })
  return rows
}

async function buildReconciliation (urls, { fresh }) {
  const sheets = []
  for (const url of urls) sheets.push(await readSheet(url, { fresh }))
  const { rows, replaced } = mergeSheets(sheets)
  const versionCodes = [...new Set(rows.map(r => String(r.raw.course_code || '').trim()).filter(Boolean))]
  if (!versionCodes.length) throw new DomainError('Las hojas no traen codigos de curso (columna COD).')

  const documentNumbers = [...new Set(rows.map(r => String(r.raw.document_number || '').trim()).filter(Boolean))]
  const [activeEditions, enrollments, related, agents] = await Promise.all([
    repo.activeEditions(versionCodes),
    repo.enrollmentsByVersions(versionCodes),
    // Mismos alumnos en cualquier programa: destinos de CC y destinos sueltos.
    repo.enrollmentsByDocuments(documentNumbers),
    importerPorts.listAgents ? importerPorts.listAgents() : []
  ])
  const structure = await repo.structure(activeEditions.map(a => Number(a.program_edition_id)))
  const agentsByAlias = new Map((agents || []).filter(a => a.alias).map(a => [normText(a.alias), Number(a.user_id)]))

  const result = reconcile({ rows, enrollments, related, activeEditions, structure })
  for (const row of result.rows) row.fixes = proposeFixes(row, { structure, related, agentsByAlias })
  return { result, structure, sheets, replaced, versionCodes }
}

export async function reconcileFicoSheets ({ urls }) {
  const { result, sheets, replaced, versionCodes } = await buildReconciliation(urls, { fresh: true })
  return toReconciliationDto({
    ...result,
    versionCodes: versionCodes.map(c => normText(c).toUpperCase()),
    sheets: sheets.map((s, i) => ({ sheet: i + 1, rows: s.length })),
    replaced
  })
}

// --- Correcciones ------------------------------------------------------------

// Aplica correcciones elegidas en la pantalla. Cada pedido { action,
// enrollment_id, row_number, sheet } se busca en la conciliacion recien hecha:
// si ya no aplica (otra persona la corrigio, la hoja cambio), no se ejecuta.
// Una por una y cada una en su transaccion: un fallo no frena a las demas.
export async function applyReconciliationFixes ({ urls, fixes, userId }) {
  const state = await buildReconciliation(urls, { fresh: false })
  let ctx = null
  const getCtx = async () => { ctx = ctx || await enrollmentFicoImporter.loadContext(); return ctx }

  const results = []
  for (const req of fixes) {
    const row = state.result.rows.find(r =>
      (r.enrollment_id ?? null) === (req.enrollment_id ?? null) &&
      (r.row_number ?? null) === (req.row_number ?? null) &&
      (r.sheet ?? null) === (req.sheet ?? null))
    const fix = row?.fixes.find(f => f.action === req.action)
    const base = { ...req, label: FIX_ACTIONS[req.action]?.label || req.action }
    if (!fix) {
      results.push({ ...base, ok: false, message: 'Ya no aplica: la fila cambió desde que conciliaste. Vuelve a conciliar.' })
      continue
    }
    if (fix.blocked) {
      results.push({ ...base, ok: false, message: fix.blocked })
      continue
    }
    try {
      const message = await EXECUTORS[fix.action]({ row, fix, state, getCtx, userId })
      results.push({ ...base, ok: true, message })
    } catch (err) {
      if (!(err instanceof DomainError)) console.error('[reconciliation] corrección', req, err)
      results.push({ ...base, ok: false, message: err.message })
    }
  }
  if (results.some(r => r.ok)) importerPorts.refreshEnrollmentMv('on-reconciliation-fix')
  return toFixResultsDto(results)
}

// Datos de la fila ya resueltos a IDs (catalogos, cuentas, asesor, membresia),
// con el mismo resolveRow que importa.
async function resolveRaw (raw, getCtx) {
  return enrollmentFicoImporter.resolveRow(raw, await getCtx())
}

// Medio, cuenta, fecha y N° de operacion de la hoja para el pago de la cuota n.
// La cuota 0 (reserva) es el pago de la fila; las demas, su bloque de "Cuota
// INS - N" (o la fila, sin N° de operacion, que es el de la inicial).
function paymentDetailFrom (data, rowPay) {
  return (n) => {
    if (Number(n) === 0) return rowPay
    const p = (data.installment_payments || []).find(x => Number(x.installment_number) === Number(n))
    return p || { ...rowPay, transaction_code: null }
  }
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

const EXECUTORS = {
  async registration_date ({ row, getCtx, userId }) {
    const { data } = await resolveRaw(row._ctx.raw, getCtx)
    if (!data.registration_date) throw new DomainError('La fila no trae F. REGISTRO ni F. PAGO.')
    const r = await importerPorts.setImportedRegistrationDate({ enrollmentId: row.enrollment_id, registrationDate: data.registration_date, userId })
    return r.updated?.length ? `Fecha ${data.registration_date} en ${plural(r.updated.length, 'inscripción', 'inscripciones')}.` : 'La fecha ya estaba bien.'
  },

  async agent ({ row, getCtx, userId }) {
    const { data } = await resolveRaw(row._ctx.raw, getCtx)
    if (!data.seller_agent_id) throw new DomainError(`"${row._ctx.raw.agent_code}" no es el código de ningún asesor.`)
    await repo.setAgent({ enrollmentId: row.enrollment_id, sellerAgentId: data.seller_agent_id, agentOrigin: data.agent_origin ?? null, userId })
    return 'Asesor actualizado.'
  },

  payments: financial,
  plan: financial,

  async children ({ row, fix, state, getCtx, userId }) {
    const e = row._ctx.enrollment
    const { data } = await resolveRaw(row._ctx.raw, getCtx)
    const wanted = new Set(fix.target.map(Number))
    const children = (state.structure.get(Number(e.program_edition_id)) || []).filter(c => wanted.has(Number(c.edition_id)))
    const fails = await ensureChildren(e.enrollment_id, data, children, userId)
    // Las hijas nacen con la fecha de hoy: misma fecha que el padre.
    if (data.registration_date) {
      await importerPorts.setImportedRegistrationDate({ enrollmentId: e.enrollment_id, registrationDate: data.registration_date, userId })
    }
    if (fails.length) throw new DomainError(`No se crearon ${fails.length} de ${children.length} aulas: ${fails.join('; ')}.`)
    return `${plural(children.length, 'aula hija creada', 'aulas hijas creadas')}.`
  },

  async membership ({ row, getCtx, userId }) {
    const { data } = await resolveRaw(row._ctx.raw, getCtx)
    if (!data.membership_version_id || !data.membership_program_id) {
      throw new DomainError(`La membresía "${row._ctx.raw.member_type}" (col J) no coincide con ningún programa de membresía.`)
    }
    const resp = await importerPorts.registerEnrollment({ data: membershipInscription(data), userId, skipFollowup: true, dedupeByVersion: true })
    if (resp?.result !== 1 && resp?.result !== 2) throw new DomainError(resp?.message || 'No se pudo crear la inscripción de membresía.')
    await repo.setMembership({ enrollmentId: row.enrollment_id, membershipProgramId: data.membership_program_id, userId })
    return resp.result === 1 ? `Membresía ${data.member_type || row._ctx.raw.member_type} asignada e inscripción de membresía creada.` : 'Membresía asignada (el alumno ya tenía la inscripción de membresía).'
  },

  async annul_duplicates ({ row, fix, userId }) {
    const done = await repo.annulDuplicates({ keepId: row.enrollment_id, enrollmentIds: fix.target, userId })
    return `Anuladas ${done.map(d => `#${d.enrollment_id}`).join(', ')}; se conserva #${row.enrollment_id}.`
  },

  async retire ({ fix, userId }) {
    for (const enrollmentId of fix.target) {
      await importerPorts.retireEnrollment({
        enrollmentId,
        reason: 'La hoja FICO la marca R (retirado)',
        hasRefund: false,
        refundAmount: 0,
        justificacion: 'Conciliacion hoja FICO: la fila esta marcada R y la inscripcion seguia vigente.',
        userId
      })
    }
    return `Retirada ${fix.target.map(id => `#${id}`).join(', ')}.`
  },

  async import_row ({ row, getCtx, userId }) {
    const ctx = await getCtx()
    const { data, errors } = await enrollmentFicoImporter.resolveRow(row._ctx.raw, ctx)
    if (errors?.length) throw new DomainError(`La fila tiene errores, no se importó: ${errors.join(' ')}`)
    const outcome = await enrollmentFicoImporter.commitRow(data, { userId })
    if (!outcome.ok && !outcome.duplicate) throw new DomainError(outcome.message)
    return outcome.id ? `Importada como #${outcome.id}. ${outcome.message}` : outcome.message
  },

  async link_rp ({ row, fix, userId }) {
    const r = await repo.linkReprogram({ originId: row.enrollment_id, destinationId: fix.target[0], userId })
    return `RP aplicada: #${row.enrollment_id} → #${fix.target[0]}` +
      (r.moved ? `; ${plural(r.moved, 'cuota pendiente trasladada', 'cuotas pendientes trasladadas')} (${r.moved_amount.toFixed(2)})` : '') +
      (r.retired_children ? `; ${plural(r.retired_children, 'aula hija retirada', 'aulas hijas retiradas')}` : '') + '.'
  }
}

// Plan de cuotas y pagos ('payments' o 'plan'). Se recalcula con la inscripcion
// bloqueada: si ahora toca otra cosa que la que se confirmo (p. ej. se pidio
// solo registrar pagos y ya hay que cambiar montos), no se aplica.
async function financial ({ row, fix, getCtx, userId }) {
  const raw = row._ctx.raw
  const ctx = await getCtx()
  const { data } = await enrollmentFicoImporter.resolveRow(raw, ctx)
  const r = await repo.applyFinancialFix({
    enrollmentId: row.enrollment_id,
    userId,
    paymentDetail: paymentDetailFrom(data, rowPaymentDetail(raw, ctx)),
    planFn: (st) => {
      const plan = planFinancialFix(raw, st)
      if (!plan.blocked && plan.kind && plan.kind !== fix.action) {
        return { blocked: 'La inscripción cambió desde que conciliaste. Vuelve a conciliar.' }
      }
      return plan
    }
  })
  return r.applied ? r.changes.join(' ') : 'Ya estaba como en la hoja.'
}
