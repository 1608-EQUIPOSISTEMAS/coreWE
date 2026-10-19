// Reglas puras de la conciliacion hoja FICO <-> BD. Recibe las filas que el
// importador lee de la hoja (mismo parser que importa) y las inscripciones reales
// de la BD, y devuelve SOLO las diferencias, fila por fila. Sin BD ni HTTP.

// Estados de inscripcion que ya no estan vigentes: retiro, reprogramacion y
// cambio de curso (mismos ids que MOVED_ENROLLMENT_STATUSES del dashboard FICO).
export const STATUS_RETIRED = 3245
export const STATUS_REPROGRAMMED = 3240
export const STATUS_COURSE_CHANGED = 3242
export const NOT_CURRENT_STATUSES = [STATUS_RETIRED, STATUS_REPROGRAMMED, STATUS_COURSE_CHANGED]
// Cuotas: pagada (legacy 2471, actual 4454) y anulada/borrador (nunca se cobran).
export const INSTALLMENT_PAID_STATUSES = [2471, 4454]
export const INSTALLMENT_VOID_STATUSES = [4456, 3174]

const TOLERANCE = 0.01
const CHANNELS = ['web', 'b2b', 'we', 's/a', 'sa']
const MOVE_STATUS = { rp: STATUS_REPROGRAMMED, cc: STATUS_COURSE_CHANGED }

export const FINDINGS = {
  MISSING_IN_DB: 'error',
  DUPLICATE_IN_DB: 'error',
  EXCLUDED_BUT_ACTIVE: 'error',
  INACTIVE_IN_DB: 'error',
  MOVE_NOT_APPLIED: 'error',
  MOVE_DESTINATION_MISSING: 'error',
  MOVE_SPLIT_IMPORT: 'error',
  MOVE_TYPE_MISMATCH: 'warning',
  MODULE_MOVE_NOTE: 'warning',
  TOTAL_MISMATCH: 'error',
  PAID_MISMATCH: 'error',
  PENDING_MISMATCH: 'error',
  INSTALLMENTS_MISSING: 'error',
  PAID_WITHOUT_PAYMENT: 'warning',
  PAYMENT_DATA_MISSING: 'warning',
  CHILDREN_MISMATCH: 'error',
  MEMBERSHIP_MISSING: 'error',
  AGENT_MISMATCH: 'warning',
  REGISTRATION_DATE_MISMATCH: 'warning',
  NOT_IN_SHEET: 'error'
}

export function normText (value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

// 'D/M/AAAA' (CSV de Google) o ISO -> 'YYYY-MM-DD'. null si no es una fecha.
export function isoDate (value) {
  const s = String(value ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const differs = (a, b) => Math.abs(round2(a) - round2(b)) > TOLERANCE

export function isCurrent (enrollment) {
  return enrollment.active === 'Y' && !NOT_CURRENT_STATUSES.includes(Number(enrollment.cat_type_status))
}

// ED "E0" = convalidacion, SIEMPRE (confirmado por negocio): inscripcion sin
// edicion y sin aulas hijas. No confundir con el "escenario E0" de fico/validation.
const isConvalidation = (edition) => normText(edition) === 'e0'

// Clave de cruce fila <-> inscripcion: DNI + version (COD) + edicion (null en E0).
export function rowKey (raw) {
  const ed = isConvalidation(raw.edition) ? '' : normText(raw.edition)
  return `${normText(raw.document_number)}|${normText(raw.course_code)}|${ed}`
}

export function enrollmentKey (e) {
  return `${normText(e.document_number)}|${normText(e.version_code)}|${e.program_edition_id ? normText(e.global_code) : ''}`
}

// Codigo de asesor de la columna AS, sin los marcadores de canal ("WEB-AE30",
// "RH30-B2B" -> "ae30"/"rh30"). null si solo trae canal (S/A, WEB, B2B...).
export function agentCodeOf (raw) {
  const parts = String(raw ?? '').split('-').map(normText).filter(Boolean)
  return parts.find(p => !CHANNELS.includes(p)) || null
}

// La hoja anota con texto libre de donde viene un destino ("VIENE DE UN RP")
// y los movimientos de un modulo hijo ("SE RP 3ER MODULO").
// Tolera las erratas reales de la hoja: "VIENE DE UN RP", "VIENE DE UNA RP", "VIENDE DE UNA RP".
const saysComesFromMove = (obs) => /\bvien\w* de una?\s*(rp|cc)\b/i.test(String(obs || ''))
const mentionsModuleMove = (obs) => /\b(rp|cc)\b.*m[oó]dulo|m[oó]dulo.*\b(rp|cc)\b/i.test(String(obs || ''))

const label = (e) => `#${e.enrollment_id} (${e.version_code || ''} ${e.global_code || 'E0'})`.replace(' )', ')')

// Une las filas de varias hojas del mismo programa (una por año). Una fila que se
// repite (mismo DNI + COD + ED) en una hoja posterior reemplaza a la anterior:
// manda la ultima de la lista. Dentro de una misma hoja no se deduplica (dos
// filas iguales en la misma hoja son un duplicado real que hay que ver).
//   sheets: [[{ rowNumber, raw }], ...] en el orden de las URLs.
export function mergeSheets (sheets = []) {
  const byKey = new Map() // clave -> { sheet, rows }
  let replaced = 0
  sheets.forEach((rows, i) => {
    const sheet = i + 1
    const own = new Map()
    for (const r of rows) {
      const k = rowKey(r.raw)
      if (!own.has(k)) own.set(k, [])
      own.get(k).push({ ...r, sheet })
    }
    for (const [k, list] of own) {
      if (byKey.has(k)) replaced += byKey.get(k).rows.length
      byKey.set(k, { sheet, rows: list })
    }
  })
  return { rows: [...byKey.values()].flatMap(v => v.rows), replaced }
}

// "fila 80 (hoja 2)": con varias hojas el numero de fila solo no alcanza.
const rowRef = (r) => r.sheet ? `fila ${r.rowNumber} (hoja ${r.sheet})` : `fila ${r.rowNumber}`

// Una fila esta en alcance si su edicion esta activa en la BD (las historicas no
// se importan) o es una convalidacion E0.
function inScope (raw, activeEditionKeys) {
  if (isConvalidation(raw.edition)) return true
  return activeEditionKeys.has(`${normText(raw.course_code)}|${normText(raw.edition)}`)
}

function finding (code, message, sheet = null, db = null) {
  return { code, severity: FINDINGS[code], message, sheet, db }
}

// Deuda pendiente de una inscripcion: sus cuotas sin pagar ni anular. Las
// inscripciones "relacionadas" (otro programa) ya la traen calculada.
function pendingOf (e) {
  if (!Array.isArray(e.installments)) return round2(e.pending_amount)
  return round2(e.installments
    .filter(i => !INSTALLMENT_VOID_STATUSES.includes(Number(i.status)) && !INSTALLMENT_PAID_STATUSES.includes(Number(i.status)))
    .reduce((s, i) => s + Number(i.amount), 0))
}

// Aulas hijas vigentes contra las de la estructura de la edicion, por AULA (no
// solo cuantas): una hija en el aula equivocada tambien es un error.
function childrenFinding (e, structure) {
  if (!e.program_edition_id) return null
  const expected = structure.get(Number(e.program_edition_id)) || []
  const actual = e.children || []
  const actualIds = new Set(actual.map(c => Number(c.edition_id)))
  const expectedIds = new Set(expected.map(c => Number(c.edition_id)))
  const faltan = expected.filter(c => !actualIds.has(Number(c.edition_id)))
  const sobran = actual.filter(c => !expectedIds.has(Number(c.edition_id)))
  if (!faltan.length && !sobran.length) return null
  const partes = []
  if (faltan.length) partes.push(`faltan ${faltan.map(c => c.label).join(', ')}`)
  if (sobran.length) partes.push(`sobran ${sobran.map(c => c.label).join(', ')}`)
  return finding('CHILDREN_MISMATCH', `Aulas hijas: ${partes.join('; ')}.`,
    expected.map(c => c.label), actual.map(c => c.label))
}

// Datos de pago que la BD tiene vacios y la hoja si trae: cuenta (de ella sale la
// entidad empresa), medio y N° de operacion. Solo cuotas con UN pago activo: con
// varios no se sabe a cual corresponde el dato de la hoja. Nunca pisa un valor.
//   installments: cuotas no anuladas con payments [{ payment_id, account_id,
//   medium, operation }]; detailOf: (n) -> { bank_account_id, cat_payment_medium,
//   transaction_code, account_label?, medium_label? } | null.
// Devuelve [{ payment_id, n, set: { account_id?, medium?, operation? }, labels }].
export function missingPaymentData (installments = [], detailOf = null) {
  if (typeof detailOf !== 'function') return []
  const out = []
  for (const i of installments) {
    const pays = i.payments || []
    if (pays.length !== 1) continue
    const p = pays[0]
    const d = detailOf(Number(i.n))
    if (!d) continue
    const set = {}
    const labels = []
    if (!p.account_id && d.bank_account_id) {
      set.account_id = Number(d.bank_account_id)
      labels.push(`cuenta ${d.account_label || d.bank_account_id}`)
    }
    if (!p.medium && d.cat_payment_medium) {
      set.medium = Number(d.cat_payment_medium)
      labels.push(`medio ${d.medium_label || d.cat_payment_medium}`)
    }
    const op = String(d.transaction_code ?? '').trim()
    if (!String(p.operation ?? '').trim() && op) {
      set.operation = op
      labels.push(`N° operación ${op}`)
    }
    if (labels.length) out.push({ payment_id: p.payment_id, n: Number(i.n), set, labels })
  }
  return out
}

function paymentDataFinding (insts, detailOf) {
  const missing = missingPaymentData(insts, detailOf)
  if (!missing.length) return null
  return finding('PAYMENT_DATA_MISSING',
    `Pagos sin datos que la hoja sí trae: ${missing.map(m => `cuota ${m.n} (${m.labels.join(', ')})`).join('; ')}.`,
    missing.map(m => ({ n: m.n, ...m.set, labels: m.labels })), null)
}

// Compara una fila importable contra su inscripcion. Devuelve los hallazgos.
//   skip: codigos que no aplican a esta fila (ej. el origen de una RP ya no
//   tiene deuda ni hijas: se fueron al destino por diseño).
//   paymentDetailOf: (raw) -> (n) -> detalle de pago de la hoja ya resuelto a IDs
//   (lo arma el caso de uso con el importador); sin el, no se revisan los datos de pago.
export function compareRow (raw, e, { structure = new Map(), skip = new Set(), paymentDetailOf = null } = {}) {
  const out = []
  const total = round2(raw.total_amount)
  const ingreso = round2(raw.ingreso)
  const saldo = Math.max(round2(raw.saldo), 0)
  const insts = (e.installments || []).filter(i => !INSTALLMENT_VOID_STATUSES.includes(Number(i.status)))
  const push = (f) => { if (f && !skip.has(f.code)) out.push(f) }

  if (differs(e.total_amount, total)) {
    push(finding('TOTAL_MISMATCH', `Hoja ${total} · sistema ${round2(e.total_amount)}.`, total, round2(e.total_amount)))
  }
  if (differs(e.paid_amount, ingreso)) {
    push(finding('PAID_MISMATCH', `Cobrado según la hoja (INGRESO) ${ingreso} · pagos registrados ${round2(e.paid_amount)}.`, ingreso, round2(e.paid_amount)))
  }
  const pending = pendingOf(e)
  if (differs(pending, saldo)) {
    push(finding('PENDING_MISMATCH', `Deuda según la hoja (SALDO) ${saldo} · cuotas pendientes ${pending}.`, saldo, pending))
  }

  const dbNumbers = new Set(insts.map(i => Number(i.n)))
  const missing = (raw._installments || []).filter(c => !dbNumbers.has(Number(c.installment_number)))
  if (missing.length) {
    push(finding('INSTALLMENTS_MISSING',
      `Cuotas de la hoja que no existen: ${missing.map(c => `C${c.installment_number} (${round2(c.amount)})`).join(', ')}.`,
      missing.map(c => ({ n: c.installment_number, amount: round2(c.amount), paid: !!c.paid })),
      insts.map(i => ({ n: Number(i.n), amount: round2(i.amount) }))))
  }

  const sinPago = insts.filter(i => INSTALLMENT_PAID_STATUSES.includes(Number(i.status)) && Number(i.amount) > 0 && !i.has_payment)
  if (sinPago.length) {
    push(finding('PAID_WITHOUT_PAYMENT',
      `Cuotas marcadas pagadas sin pago registrado: ${sinPago.map(i => `N.${i.n} (${round2(i.amount)})`).join(', ')}.`,
      null, sinPago.map(i => ({ n: Number(i.n), amount: round2(i.amount) }))))
  }

  push(paymentDataFinding(insts, paymentDetailOf?.(raw)))

  push(childrenFinding(e, structure))

  if (String(raw.member_type || '').trim() && !e.membership_program_id) {
    push(finding('MEMBERSHIP_MISSING', `Miembro ${raw.member_type} en la hoja (col J), sin membresía en la inscripción.`, raw.member_type, null))
  }

  const code = agentCodeOf(raw.agent_code)
  if (code && code !== normText(e.agent_alias)) {
    push(finding('AGENT_MISMATCH', `Hoja ${raw.agent_code} · sistema ${e.agent_alias || 'sin asesor'}.`, raw.agent_code, e.agent_alias || null))
  }

  const fecha = isoDate(raw.registration_date) || isoDate(raw.payment_date)
  if (fecha && fecha !== e.registration_date) {
    push(finding('REGISTRATION_DATE_MISMATCH', `Hoja ${fecha} · sistema ${e.registration_date}.`, fecha, e.registration_date))
  }

  if (mentionsModuleMove(raw.obs)) {
    push(finding('MODULE_MOVE_NOTE', `La observación anota un movimiento de módulo ("${raw.obs}"): revisar a mano.`, raw.obs, null))
  }
  return out
}

// Fila RP/CC = ORIGEN del movimiento. Modelo del sistema (reprogramEdition /
// courseChange): el origen pasa a estado RP/CC y conserva lo pagado; el destino
// es una inscripcion nueva cuya nota dice "... desde inscripcion #origen", con la
// deuda pendiente y sus propias hijas. RP = mismo programa; CC = otro programa
// (esta en OTRA hoja, por eso el par se arma con el enlace de la BD, no con filas).
//   related: inscripciones de los alumnos de la hoja en cualquier programa.
export function compareMoveOrigin (raw, e, { structure = new Map(), related = [], paymentDetailOf = null } = {}) {
  const out = []
  const kind = normText(raw.enrollment_mode) // 'rp' | 'cc'
  const KIND = kind.toUpperCase()
  const destinos = related.filter(x => Number(x.move_origin_id) === Number(e.enrollment_id))
  // Destino importado suelto: mismo alumno, vigente, sin enlace a ningun origen,
  // no membresia (tambien va sin edicion y en 0) y con cara de destino (E0,
  // total 0 o nota "VIENE DE UN RP/CC").
  const candidatos = destinos.length
    ? []
    : related.filter(x => x.enrollment_id !== e.enrollment_id && isCurrent(x) && !x.move_origin_id && !x.is_membership &&
        normText(x.document_number) === normText(e.document_number) &&
        (!x.program_edition_id || Number(x.total_amount) === 0 || x.notes_viene_de))
  const pista = candidatos.length ? ` Posible destino importado suelto: ${candidatos.map(label).join(', ')}.` : ''

  if (isCurrent(e)) {
    out.push(finding('MOVE_NOT_APPLIED',
      `La hoja la marca ${KIND} y en el sistema sigue ${e.status_label || 'activa'}: no se hizo ${KIND === 'RP' ? 'la reprogramación' : 'el cambio de curso'}.${pista}`,
      KIND, e.status_label))
  } else if (Number(e.cat_type_status) !== MOVE_STATUS[kind]) {
    out.push(finding('MOVE_TYPE_MISMATCH', `La hoja la marca ${KIND} y en el sistema está ${e.status_label}.`, KIND, e.status_label))
  } else if (!destinos.length) {
    // Un destino E0 (convalidacion) no puede salir del flujo RP/CC, que exige
    // edicion: se acepta suelto si existe.
    const destinoE0 = candidatos.find(x => !x.program_edition_id)
    if (!destinoE0) {
      out.push(finding('MOVE_DESTINATION_MISSING', `El origen está en ${KIND}, pero ninguna inscripción viene de él.${pista}`, KIND, null))
    }
  }

  for (const d of destinos) {
    const mismoPrograma = normText(d.version_code) === normText(e.version_code)
    if (kind === 'rp' && !mismoPrograma) {
      out.push(finding('MOVE_TYPE_MISMATCH', `La hoja dice RP, pero el destino ${label(d)} es de otro programa: en el sistema es un CC.`, 'RP', 'CC'))
    } else if (kind === 'cc' && mismoPrograma) {
      out.push(finding('MOVE_TYPE_MISMATCH', `La hoja dice CC, pero el destino ${label(d)} es del mismo programa: en el sistema es una RP.`, 'CC', 'RP'))
    }
  }

  // Dinero del origen: total y lo cobrado. La deuda y las hijas se fueron al
  // destino por diseño; la deuda de la hoja (SALDO) se compara contra el destino.
  const skip = new Set(['PENDING_MISMATCH', 'INSTALLMENTS_MISSING', 'CHILDREN_MISMATCH'])
  if (isCurrent(e)) skip.delete('CHILDREN_MISMATCH')
  out.push(...compareRow(raw, e, { structure, skip, paymentDetailOf }))
  if (destinos.length) {
    const saldo = Math.max(round2(raw.saldo), 0)
    const pendiente = round2(destinos.reduce((s, d) => s + pendingOf(d), 0))
    if (differs(pendiente, saldo)) {
      out.push(finding('PENDING_MISMATCH', `Deuda según la hoja (SALDO) ${saldo} · pendiente en el destino ${destinos.map(label).join(', ')} ${pendiente}.`, saldo, pendiente))
    }
  }
  return out
}

const isExcluded = (raw) => raw.excluded === true || normText(raw.enrollment_mode) === 'r'
const isMoveRow = (raw) => ['rp', 'cc'].includes(normText(raw.enrollment_mode))

// Fila ACT (o destino de RP/CC) contra su inscripcion.
function compareActive (raw, e, { structure, related, moveRefByDni = new Map(), paymentDetailOf = null }) {
  const out = []
  if (e.move_origin_id) {
    // Destino enlazado: la deuda de la hoja vive en la fila RP/CC del origen.
    out.push(...compareRow(raw, e, { structure, paymentDetailOf, skip: new Set(['PENDING_MISMATCH', 'INSTALLMENTS_MISSING']) }))
    return out
  }
  if (saysComesFromMove(raw.obs) && !isConvalidation(raw.edition)) {
    // El origen: en el sistema ya movido a RP/CC o, si sigue activo (RP partida),
    // la fila RP/CC del mismo alumno en las hojas.
    const origen = related.find(x => normText(x.document_number) === normText(raw.document_number) &&
      [STATUS_REPROGRAMMED, STATUS_COURSE_CHANGED].includes(Number(x.cat_type_status)))
    const filaOrigen = moveRefByDni.get(normText(raw.document_number))
    const pista = origen ? ` (posible origen ${label(origen)})` : filaOrigen ? ` (origen en la ${filaOrigen})` : ''
    out.push(finding('MOVE_SPLIT_IMPORT',
      `La hoja dice "${raw.obs}", pero en el sistema es una inscripción suelta sin enlace al origen${pista}: debió crearse con la RP/CC.`,
      raw.obs, null))
  }
  out.push(...compareRow(raw, e, { structure, paymentDetailOf }))
  return out
}

// Concilia la hoja completa.
//   rows: [{ rowNumber, raw }] del importador (con includeExcluded).
//   enrollments: inscripciones padre (sin parent) de las versiones de la hoja.
//   related: inscripciones padre de los alumnos de la hoja en cualquier programa.
//   activeEditions: [{ version_code, global_code }] activas de esas versiones.
//   structure: Map(program_edition_id -> [{ edition_id, label }] aulas hijas).
//   paymentDetailOf: (raw) -> (n) -> detalle de pago de la hoja (ver compareRow).
export function reconcile ({ rows = [], enrollments = [], related = [], activeEditions = [], structure = new Map(), paymentDetailOf = null }) {
  const activeEditionKeys = new Set(activeEditions.map(a => `${normText(a.version_code)}|${normText(a.global_code)}`))
  const scoped = rows.filter(r => inScope(r.raw, activeEditionKeys))
  // Filas RP/CC por alumno: pista del origen para un destino importado suelto.
  const moveRefByDni = new Map(scoped.filter(r => isMoveRow(r.raw)).map(r => [normText(r.raw.document_number), rowRef(r)]))
  const ctx = { structure, related, moveRefByDni, paymentDetailOf }

  const dbByKey = new Map()
  for (const e of enrollments) {
    const k = enrollmentKey(e)
    if (!dbByKey.has(k)) dbByKey.set(k, [])
    dbByKey.get(k).push(e)
  }
  const sheetByKey = new Map()
  for (const r of scoped) {
    const k = rowKey(r.raw)
    if (!sheetByKey.has(k)) sheetByKey.set(k, [])
    sheetByKey.get(k).push(r)
  }

  const used = new Set()
  const moveRowByOrigin = new Map() // origen (enrollment_id) -> referencia de la fila RP/CC
  const results = []
  for (const [key, group] of sheetByKey) {
    const importable = group.filter(r => !isExcluded(r.raw))
    const excluded = group.filter(r => isExcluded(r.raw))
    // Vigentes primero: la fila activa se compara con la inscripcion vigente. Entre
    // duplicadas, la que MAS se parece a la fila (menos diferencias): esa se
    // conserva y las otras son las sobrantes que la correccion propone anular.
    const ref = importable[0]?.raw
    const score = (e) => ref ? compareRow(ref, e, { structure, paymentDetailOf }).length : 0
    const db = [...(dbByKey.get(key) || [])].sort((a, b) =>
      Number(isCurrent(b)) - Number(isCurrent(a)) || score(a) - score(b) || a.enrollment_id - b.enrollment_id)
    db.forEach(e => used.add(e.enrollment_id))

    importable.forEach((r, i) => {
      const e = db[i]
      const findings = []
      if (!e) {
        findings.push(finding('MISSING_IN_DB', 'La fila no tiene inscripción en el sistema.'))
      } else if (isMoveRow(r.raw)) {
        moveRowByOrigin.set(e.enrollment_id, rowRef(r))
        findings.push(...compareMoveOrigin(r.raw, e, ctx))
      } else if (!isCurrent(e)) {
        findings.push(finding('INACTIVE_IN_DB', `La hoja la trae activa y en el sistema está ${e.status_label || 'inactiva'}.`, r.raw.enrollment_mode, e.status_label))
      } else {
        findings.push(...compareActive(r.raw, e, ctx))
      }
      if (i === 0 && db.length > importable.length) {
        const extra = db.slice(importable.length)
        const vigentes = extra.filter(isCurrent)
        findings.push({
          ...finding('DUPLICATE_IN_DB', `Hay ${db.length} inscripciones para esta fila: ${db.map(x => `#${x.enrollment_id} (${x.status_label || '-'})`).join(', ')}.`, null, db.map(x => x.enrollment_id)),
          severity: vigentes.length ? 'error' : 'warning'
        })
      }
      results.push(rowResult(r, e, findings, { db, kind: 'importable' }))
    })

    if (!importable.length) {
      for (const r of excluded) {
        const findings = []
        const vigentes = db.filter(isCurrent)
        if (vigentes.length) {
          findings.push(finding('EXCLUDED_BUT_ACTIVE', `La hoja la marca R (no se importa), pero en el sistema sigue vigente: ${vigentes.map(x => `#${x.enrollment_id}`).join(', ')}.`, 'R', vigentes.map(x => x.enrollment_id)))
        }
        if (db.length > 1) {
          findings.push({
            ...finding('DUPLICATE_IN_DB', `Hay ${db.length} inscripciones para esta fila: ${db.map(x => `#${x.enrollment_id} (${x.status_label || '-'})`).join(', ')}.`, null, db.map(x => x.enrollment_id)),
            severity: vigentes.length ? 'error' : 'warning'
          })
        }
        results.push(rowResult(r, vigentes[0] || db[0] || null, findings, { db, kind: 'excluded' }))
      }
    }
  }

  // Inscripciones vigentes en ediciones que la hoja cubre, sin fila que las
  // explique (ej. el destino BECA de un RP que se importo partido en dos).
  const scopedEditions = new Set(scoped.map(r => `${normText(r.raw.course_code)}|${isConvalidation(r.raw.edition) ? '' : normText(r.raw.edition)}`))
  const notInSheet = enrollments
    .filter(e => !used.has(e.enrollment_id) && isCurrent(e))
    // En alcance: su edicion la cubre la hoja, o es el destino de una RP/CC de la hoja.
    .filter(e => scopedEditions.has(`${normText(e.version_code)}|${e.program_edition_id ? normText(e.global_code) : ''}`) ||
      moveRowByOrigin.has(Number(e.move_origin_id)))
    .map(e => {
      const filaOrigen = e.move_origin_id ? moveRowByOrigin.get(Number(e.move_origin_id)) : null
      let f
      if (filaOrigen) {
        // Destino bien enlazado de una RP de la hoja: lo que falta es la fila ACT.
        f = { ...finding('NOT_IN_SHEET', `Destino de la ${e.move_kind || 'RP'} de la ${filaOrigen} (desde #${e.move_origin_id}); las hojas no tienen su fila.`, null, e.enrollment_id), severity: 'warning' }
      } else {
        const rpRow = moveRefByDni.get(normText(e.document_number))
        const hint = rpRow ? ` Posible destino partido de la RP/CC de la ${rpRow}.` : ''
        // Importada de una hoja y ausente en esta = error de importacion. Registrada
        // en el sistema (venta normal) = la hoja esta desactualizada: advertencia.
        const origin = e.imported ? ' Vino de una importación masiva.' : ' Registrada en el sistema, no por importación.'
        f = {
          ...finding('NOT_IN_SHEET', `Inscripción #${e.enrollment_id} (${e.global_code || 'E0'}) sin fila en las hojas.${origin}${hint}`, null, e.enrollment_id),
          severity: e.imported ? 'error' : 'warning'
        }
      }
      return {
        row_number: null,
        sheet: null,
        enrollment_id: e.enrollment_id,
        student: e.student,
        document_number: e.document_number,
        edition: e.global_code || 'E0',
        mode: null,
        findings: [f]
      }
    })

  const all = [...results, ...notInSheet]
  const withFindings = all.filter(r => r.findings.length)
  const byCode = {}
  for (const r of withFindings) for (const f of r.findings) byCode[f.code] = (byCode[f.code] || 0) + 1

  return {
    summary: {
      sheet_rows: rows.length,
      in_scope: scoped.length,
      out_of_scope: rows.length - scoped.length,
      ok: results.filter(r => !r.findings.length).length,
      with_findings: withFindings.length,
      errors: withFindings.filter(r => r.findings.some(f => f.severity === 'error')).length,
      by_code: byCode
    },
    rows: withFindings.sort((a, b) => (a.row_number ?? Infinity) - (b.row_number ?? Infinity))
  }
}

// `_ctx` es interno (no sale en el DTO): la fila de la hoja, la inscripcion con
// la que se comparo y todas las de su clave. Lo usan las correcciones (Fase 3).
function rowResult (r, e, findings, { db = [], kind } = {}) {
  return {
    _ctx: { raw: r.raw, enrollment: e || null, db, kind },
    row_number: r.rowNumber,
    sheet: r.sheet ?? null,
    enrollment_id: e?.enrollment_id ?? null,
    student: r.raw.full_name,
    document_number: r.raw.document_number,
    edition: r.raw.edition,
    mode: r.raw.enrollment_mode || null,
    findings
  }
}
