// Correcciones de la conciliacion (Fase 3). Reglas puras, sin BD ni HTTP:
//   - proposeFixes: que acciones ofrecer para una fila con diferencias.
//   - planFinancialFix: el plan de cuotas/pagos que dice la hoja contra el que
//     tiene la inscripcion, como lista de operaciones (o el motivo por el que no
//     se puede corregir solo).
// Las acciones SOLO tocan inscripciones de "Importacion masiva FICO": las del
// flujo normal se corrigen a mano desde el detalle de la inscripcion.

import {
  normText, isoDate, isCurrent, agentCodeOf,
  INSTALLMENT_PAID_STATUSES, INSTALLMENT_VOID_STATUSES, STATUS_REPROGRAMMED
} from './reconciliation.entity.js'

// Catalogo de forma de pago (cat_payment_plan) y estados de cuota que escribe
// la correccion (los vigentes; 2471 legacy tambien cuenta como pagada).
export const PAYMENT_PLAN_SINGLE = 2466
export const PAYMENT_PLAN_INSTALLMENTS = 2467

const TOLERANCE = 0.01
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const differs = (a, b) => Math.abs(round2(a) - round2(b)) > TOLERANCE
const sum = (list, f = (x) => x.amount) => round2(list.reduce((s, x) => s + Number(f(x) || 0), 0))
const isPaidStatus = (s) => INSTALLMENT_PAID_STATUSES.includes(Number(s))
const isVoidStatus = (s) => INSTALLMENT_VOID_STATUSES.includes(Number(s))

// risk 'low': no cambia montos ni crea/anula inscripciones (se puede aplicar en
// lote). 'high': se confirma una por una.
export const FIX_ACTIONS = {
  registration_date: { label: 'Corregir fecha', risk: 'low' },
  agent: { label: 'Corregir asesor', risk: 'low' },
  payments: { label: 'Registrar pagos', risk: 'low' },
  plan: { label: 'Rehacer plan según hoja', risk: 'high' },
  children: { label: 'Crear aulas hijas', risk: 'high' },
  membership: { label: 'Asignar membresía', risk: 'high' },
  annul_duplicates: { label: 'Anular duplicadas', risk: 'high' },
  retire: { label: 'Retirar', risk: 'high' },
  import_row: { label: 'Importar fila', risk: 'high' },
  link_rp: { label: 'Aplicar RP', risk: 'high' }
}

const FINANCIAL_CODES = ['TOTAL_MISMATCH', 'PAID_MISMATCH', 'PENDING_MISMATCH', 'INSTALLMENTS_MISSING', 'PAID_WITHOUT_PAYMENT']
const isImported = (e) => e?.imported === true
const isMoveRow = (raw) => ['rp', 'cc'].includes(normText(raw?.enrollment_mode))
const label = (e) => `#${e.enrollment_id} (${e.version_code || ''} ${e.global_code || 'E0'})`.replace(' )', ')')

function fix (action, { codes, description, changes = [], blocked = null, target = null }) {
  const def = FIX_ACTIONS[action]
  return { action, label: def.label, risk: def.risk, codes, description, changes, blocked, target }
}

// --- Plan financiero ---------------------------------------------------------

// Plan de cuotas que dice la hoja, con la misma lectura que el importador
// (ingest + resolveRow): reserva = INICIAL (cuota 0, cobrada); cronograma FCn/Cn
// (Cn con monto = cobrada); contado = una sola cuota por el total.
//   hasReserva: la inscripcion ya tiene cuota 0. En contado, si no la tiene, la
//   INICIAL va dentro de la cuota 1 (como la crea el alta) para no reestructurar.
export function expectedPlan (raw, { hasReserva = false } = {}) {
  const total = round2(raw.total_amount)
  const ingreso = round2(raw.ingreso)
  const inicial = round2(raw.down_payment)
  const fechaPago = isoDate(raw.payment_date) || isoDate(raw.registration_date)
  if (total <= 0) return { total: 0, items: [], zero: true }

  const schedule = (raw._installments || [])
    .filter(c => Number(c.installment_number) > 0 && Number(c.amount) > 0 && isoDate(c.due_date))
    .sort((a, b) => a.installment_number - b.installment_number)
  const items = []
  if (schedule.length) {
    if (inicial > 0) items.push({ n: 0, amount: inicial, paid: true, due_date: fechaPago })
    for (const c of schedule) {
      items.push({ n: Number(c.installment_number), amount: round2(c.amount), paid: !!c.paid, due_date: isoDate(c.due_date) })
    }
  } else {
    if (ingreso + TOLERANCE < total) {
      return { blocked: `La hoja tiene deuda (SALDO ${round2(total - ingreso)}) sin cronograma (FCn): no se sabe en qué cuota va. Corregir a mano.` }
    }
    if (inicial > 0 && hasReserva) {
      items.push({ n: 0, amount: inicial, paid: true, due_date: fechaPago })
      if (differs(total, inicial)) items.push({ n: 1, amount: round2(total - inicial), paid: true, due_date: fechaPago })
    } else {
      items.push({ n: 1, amount: total, paid: true, due_date: fechaPago })
    }
  }

  const suma = sum(items)
  if (differs(suma, total)) {
    return { blocked: `Las cuotas de la hoja suman ${suma} y el total (INGRESO + SALDO) es ${total}: la hoja no cuadra.` }
  }
  const cobrado = sum(items.filter(i => i.paid))
  if (differs(cobrado, ingreso)) {
    return { blocked: `Lo cobrado en las cuotas de la hoja (${cobrado}) no cuadra con INGRESO (${ingreso}).` }
  }
  return { total, items, installments: schedule.length > 0 }
}

// Operaciones para dejar el plan de la inscripcion igual al de la hoja.
//   state: { total_amount, cat_payment_plan, installments: [{ installment_id, n,
//            amount, status, payments: [{ payment_id, amount }] }] }
// Devuelve { kind: 'payments' | 'plan' | null, ops, changes } o { blocked }.
//   'payments' = solo registrar pagos de cuotas cobradas que ya estan bien
//   (bajo riesgo); 'plan' = cambia montos, cuotas o el total.
// Nunca borra ni cambia de monto un pago con varias filas o que no coincide con
// su cuota: eso queda bloqueado para revisar a mano.
export function planFinancialFix (raw, state) {
  const insts = (state.installments || []).filter(i => !isVoidStatus(i.status))
  const byN = new Map()
  for (const i of insts) {
    if (byN.has(Number(i.n))) return { blocked: `La inscripción tiene dos cuotas número ${i.n}: corregir a mano.` }
    byN.set(Number(i.n), i)
  }
  const exp = expectedPlan(raw, { hasReserva: byN.has(0) })
  if (exp.blocked) return { blocked: exp.blocked }

  const ops = []
  const blocked = []
  const paysOf = (i) => i?.payments || []

  if (exp.zero) {
    // Total 0 (beca o beneficio de membresia): una cuota en 0, sin pagos.
    for (const i of insts) {
      if (paysOf(i).length) {
        blocked.push(`La hoja dice total 0 y la cuota ${i.n} tiene pagos por ${sum(paysOf(i))}.`)
      } else if (differs(i.amount, 0)) {
        ops.push({ type: 'update_amount', installment_id: i.installment_id, n: Number(i.n), from: round2(i.amount), to: 0 })
      }
    }
    if (!insts.length) ops.push({ type: 'insert_installment', n: 1, amount: 0, paid: true, due_date: isoDate(raw.registration_date) })
  } else {
    const expectedNs = new Set(exp.items.map(e => e.n))
    for (const e of exp.items) {
      const db = byN.get(e.n)
      if (!db) {
        ops.push({ type: 'insert_installment', n: e.n, amount: e.amount, paid: e.paid, due_date: e.due_date })
        if (e.paid) ops.push({ type: 'insert_payment', n: e.n, amount: e.amount })
        continue
      }
      const pays = paysOf(db)
      const pagado = sum(pays)
      if (differs(db.amount, e.amount)) {
        if (!pays.length) {
          ops.push({ type: 'update_amount', installment_id: db.installment_id, n: e.n, from: round2(db.amount), to: e.amount })
        } else if (pays.length === 1 && !differs(pagado, db.amount) && e.paid) {
          ops.push({ type: 'update_amount', installment_id: db.installment_id, n: e.n, from: round2(db.amount), to: e.amount })
          ops.push({ type: 'update_payment', payment_id: pays[0].payment_id, n: e.n, from: pagado, to: e.amount })
        } else {
          blocked.push(`Cuota ${e.n}: el sistema tiene ${round2(db.amount)} con pagos por ${pagado} y la hoja dice ${e.amount}.`)
          continue
        }
      }
      const pagadaEnBd = isPaidStatus(db.status)
      if (e.paid) {
        if (!pagadaEnBd) ops.push({ type: 'set_paid', installment_id: db.installment_id, n: e.n })
        if (!pays.length) ops.push({ type: 'insert_payment', installment_id: db.installment_id, n: e.n, amount: e.amount })
      } else if (pays.length) {
        blocked.push(`Cuota ${e.n}: la hoja la da por pendiente y el sistema tiene pagos por ${pagado}.`)
      } else if (pagadaEnBd) {
        ops.push({ type: 'set_pending', installment_id: db.installment_id, n: e.n })
      }
    }
    for (const db of insts) {
      if (expectedNs.has(Number(db.n))) continue
      if (paysOf(db).length) {
        blocked.push(`Cuota ${db.n} (${round2(db.amount)}) no está en la hoja y tiene pagos registrados.`)
      } else {
        ops.push({ type: 'void_installment', installment_id: db.installment_id, n: Number(db.n), amount: round2(db.amount) })
      }
    }
  }

  if (differs(state.total_amount, exp.total)) {
    ops.push({ type: 'set_total', from: round2(state.total_amount), to: exp.total })
  }
  const plan = exp.installments ? PAYMENT_PLAN_INSTALLMENTS : PAYMENT_PLAN_SINGLE
  if (!exp.zero && Number(state.cat_payment_plan) !== plan) {
    ops.push({ type: 'set_payment_plan', from: Number(state.cat_payment_plan) || null, to: plan })
  }

  if (blocked.length) return { blocked: blocked.join(' ') }
  const onlyPayments = ops.every(o => o.type === 'insert_payment' || o.type === 'set_paid')
  const kind = ops.length === 0 ? null : onlyPayments ? 'payments' : 'plan'
  return { kind, ops, changes: ops.map(describeOp), total: exp.total }
}

export function describeOp (o) {
  switch (o.type) {
    case 'insert_installment': return `Crear cuota ${o.n} por ${o.amount} (${o.paid ? 'pagada' : 'pendiente'}${o.due_date ? `, vence ${o.due_date}` : ''}).`
    case 'insert_payment': return `Registrar el pago de la cuota ${o.n} por ${o.amount}.`
    case 'update_amount': return `Cuota ${o.n}: monto ${o.from} → ${o.to}.`
    case 'update_payment': return `Pago de la cuota ${o.n}: monto ${o.from} → ${o.to}.`
    case 'set_paid': return `Cuota ${o.n}: marcar pagada.`
    case 'set_pending': return `Cuota ${o.n}: marcar pendiente.`
    case 'void_installment': return `Anular la cuota ${o.n} (${o.amount}), que la hoja no tiene.`
    case 'set_total': return `Total: ${o.from} → ${o.to}.`
    case 'set_payment_plan': return `Forma de pago: ${o.to === PAYMENT_PLAN_INSTALLMENTS ? 'cuotas' : 'contado'}.`
    default: return o.type
  }
}

// --- Propuesta por fila -------------------------------------------------------

// Acciones para una fila de la conciliacion.
//   row: resultado de reconcile (findings + _ctx { raw, enrollment, db, kind }).
//   ctx: { structure, related, agentsByAlias: Map(alias normalizado -> user_id) }.
// Cada accion lleva `blocked` (motivo) cuando aplica pero no se puede hacer sola:
// la pantalla la muestra deshabilitada con el motivo, en vez de esconderla.
export function proposeFixes (row, { structure = new Map(), related = [], agentsByAlias = new Map() } = {}) {
  const { raw, enrollment: e, db = [], kind } = row._ctx || {}
  if (!raw) return []
  const codes = new Set(row.findings.map(f => f.code))
  const out = []
  const notImported = 'La inscripción no viene de la importación masiva: corregirla desde su detalle.'

  if (codes.has('MISSING_IN_DB')) {
    // Un DNI de relleno ("0", "-") cruza con nadie: importar crearia otra persona
    // (BI-EZ-02 fila 54: DNI 0 y el alumno ya existe como #23112).
    const doc = String(raw.document_number || '').trim()
    const docInvalido = doc.length < 6 || /^0+$/.test(doc)
    out.push(fix('import_row', {
      codes: ['MISSING_IN_DB'],
      description: 'Importa esta fila como en "Importar hoja" (inscripción, cuotas, pagos, hijas y membresía). Si la fila tiene errores, se muestran sin escribir nada.',
      blocked: docInvalido ? `El DNI de la hoja ("${doc}") no es válido: corregirlo en la hoja; si el alumno ya está en el sistema con otro DNI, no importar.` : null
    }))
    return out
  }
  if (!e) return out

  if (codes.has('EXCLUDED_BUT_ACTIVE')) {
    const vigentes = db.filter(isCurrent)
    const ajenas = vigentes.filter(x => !isImported(x))
    out.push(fix('retire', {
      codes: ['EXCLUDED_BUT_ACTIVE'],
      description: `Retira ${vigentes.map(x => `#${x.enrollment_id}`).join(', ')} (la hoja la marca R), con sus aulas hijas y cuotas pendientes, sin devolución. También la desinscribe de Odoo y avisa del retiro como el retiro normal.`,
      target: vigentes.map(x => x.enrollment_id),
      blocked: ajenas.length ? `${ajenas.map(x => `#${x.enrollment_id}`).join(', ')} no viene de la importación masiva: retirarla desde su detalle.` : null
    }))
  }

  if (codes.has('DUPLICATE_IN_DB') && kind === 'importable') {
    const sobrantes = db.filter(x => x.enrollment_id !== e.enrollment_id && isCurrent(x))
    if (sobrantes.length) {
      const ajenas = sobrantes.filter(x => !isImported(x))
      out.push(fix('annul_duplicates', {
        codes: ['DUPLICATE_IN_DB'],
        description: `Se conserva #${e.enrollment_id} (la que más se parece a la fila) y se anula ${sobrantes.map(x => `#${x.enrollment_id}`).join(', ')}: inscripción, aulas hijas, cuotas y pagos quedan inactivos con motivo "Duplicado". No se borra nada.`,
        changes: sobrantes.map(x => `Anular #${x.enrollment_id} (${x.status_label || '-'}, total ${round2(x.total_amount)}, pagos ${round2(x.paid_amount)}).`),
        target: sobrantes.map(x => x.enrollment_id),
        blocked: ajenas.length ? `${ajenas.map(x => `#${x.enrollment_id}`).join(', ')} no viene de la importación masiva: anularla a mano.` : null
      }))
    }
  }

  if (kind !== 'importable' || !isCurrent(e)) return out

  // RP partida: el origen sigue activo y hay UN destino suelto en otra edicion
  // del mismo programa. Se enlaza ese destino (no se crea otro): conserva sus
  // aulas, asistencia y notas.
  if (codes.has('MOVE_NOT_APPLIED') && normText(raw.enrollment_mode) === 'rp') {
    const candidatos = related.filter(x => x.enrollment_id !== e.enrollment_id && isCurrent(x) && !x.move_origin_id && !x.is_membership &&
      normText(x.document_number) === normText(e.document_number) &&
      (!x.program_edition_id || Number(x.total_amount) === 0 || x.notes_viene_de))
    let blocked = null
    const d = candidatos[0]
    if (!isImported(e)) blocked = notImported
    else if (candidatos.length !== 1) blocked = candidatos.length ? `Hay ${candidatos.length} posibles destinos (${candidatos.map(label).join(', ')}): aplicar la RP a mano.` : 'No hay un destino suelto: hacer la reprogramación desde el detalle de la inscripción.'
    else if (normText(d.version_code) !== normText(e.version_code)) blocked = `El posible destino ${label(d)} es de otro programa: es un CC, aplicarlo a mano.`
    else if (!d.program_edition_id) blocked = `El posible destino ${label(d)} es una convalidación (sin edición): aplicar a mano.`
    else if (Number(d.program_edition_id) === Number(e.program_edition_id)) blocked = `El posible destino ${label(d)} está en la misma edición que el origen.`
    else if (!isImported(d)) blocked = `El posible destino ${label(d)} se registró en el sistema, no por importación: aplicar la RP a mano.`
    out.push(fix('link_rp', {
      codes: ['MOVE_NOT_APPLIED'],
      description: d
        ? `El origen #${e.enrollment_id} pasa a RP (conserva lo pagado; sus aulas hijas se retiran) y su deuda pendiente pasa al destino ${label(d)}, que queda enlazado como "Reprogramacion desde inscripcion #${e.enrollment_id}".`
        : 'Enlaza el origen con su destino suelto.',
      target: d ? [d.enrollment_id] : [],
      blocked
    }))
  }

  const moving = isMoveRow(raw) || !!e.move_origin_id || Number(e.cat_type_status) === STATUS_REPROGRAMMED

  if (codes.has('REGISTRATION_DATE_MISMATCH')) {
    const f = row.findings.find(x => x.code === 'REGISTRATION_DATE_MISMATCH')
    out.push(fix('registration_date', {
      codes: ['REGISTRATION_DATE_MISMATCH'],
      description: `Fecha de inscripción ${f.db} → ${f.sheet} (padre y aulas hijas).`,
      changes: [`Fecha de inscripción: ${f.db} → ${f.sheet}.`],
      blocked: isImported(e) ? null : notImported
    }))
  }

  if (codes.has('AGENT_MISMATCH')) {
    const code = agentCodeOf(raw.agent_code)
    const userId = code ? agentsByAlias.get(code) : null
    out.push(fix('agent', {
      codes: ['AGENT_MISMATCH'],
      description: `Asesor ${e.agent_alias || 'sin asesor'} → ${code ? code.toUpperCase() : raw.agent_code} (columna AS).`,
      changes: [`Asesor: ${e.agent_alias || 'sin asesor'} → ${code ? code.toUpperCase() : raw.agent_code}.`],
      blocked: !isImported(e) ? notImported : !userId ? `"${raw.agent_code}" no es el código de ningún asesor del sistema: revisar la columna AS.` : null
    }))
  }

  const financial = FINANCIAL_CODES.filter(c => codes.has(c))
  if (financial.length && !moving) {
    if (!isImported(e)) {
      out.push(fix('plan', { codes: financial, description: 'Dejar cuotas y pagos como en la hoja.', blocked: notImported }))
    } else {
      const plan = planFinancialFix(raw, e)
      if (plan.blocked) {
        out.push(fix('plan', { codes: financial, description: 'Dejar cuotas y pagos como en la hoja.', blocked: plan.blocked }))
      } else if (plan.kind) {
        out.push(fix(plan.kind, {
          codes: financial,
          description: plan.kind === 'payments'
            ? 'Registra el pago de las cuotas que la hoja da por cobradas y que ya existen con el mismo monto (medio, banco y N° de operación de la hoja).'
            : 'Deja total, cuotas y pagos como en la hoja. Los pagos nuevos toman medio, banco y N° de operación de la hoja.',
          changes: plan.changes
        }))
      }
    }
  }

  if (codes.has('CHILDREN_MISMATCH') && e.program_edition_id) {
    const expected = structure.get(Number(e.program_edition_id)) || []
    const actualIds = new Set((e.children || []).map(c => Number(c.edition_id)))
    const faltan = expected.filter(c => !actualIds.has(Number(c.edition_id)))
    if (faltan.length && !moving) {
      out.push(fix('children', {
        codes: ['CHILDREN_MISMATCH'],
        description: `Crea las aulas hijas que faltan: ${faltan.map(c => c.label).join(', ')}. Las que sobran no se tocan.`,
        changes: faltan.map(c => `Crear hija en ${c.label}.`),
        target: faltan.map(c => c.edition_id),
        blocked: isImported(e) ? null : notImported
      }))
    }
  }

  if (codes.has('MEMBERSHIP_MISSING')) {
    out.push(fix('membership', {
      codes: ['MEMBERSHIP_MISSING'],
      description: `Marca la inscripción con la membresía ${raw.member_type} (col J) y crea la inscripción de membresía si el alumno no la tiene.`,
      changes: [`Membresía: ${raw.member_type}.`],
      blocked: isImported(e) ? null : notImported
    }))
  }

  return out
}
