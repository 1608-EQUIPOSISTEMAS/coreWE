import { describe, it, expect } from 'vitest'
import { expectedPlan, planFinancialFix, proposeFixes, PAYMENT_PLAN_SINGLE, PAYMENT_PLAN_INSTALLMENTS } from '../reconciliation.fixes.js'
import { reconcile } from '../reconciliation.entity.js'

// Fila de la hoja (raw de ingest) y estado de la inscripcion, con casos reales
// de BI-EZ-02 (2026-10-16).
const raw = (extra = {}) => ({
  document_number: '18847682',
  full_name: 'RONCAL BUENO FERNANDA KATE',
  course_code: 'BI-EZ-02',
  edition: 'E37',
  enrollment_mode: 'ACT',
  excluded: false,
  total_amount: 643,
  ingreso: 643,
  saldo: 0,
  down_payment: 643,
  payment_date: '16/01/2026',
  registration_date: '19/01/2026',
  payment_way: 'contado',
  member_type: '',
  agent_code: 'WEB',
  _installments: [],
  ...extra
})

const inst = (n, amount, status = 4452, payments = []) => ({ installment_id: 1000 + n, n, amount, status, payments, has_payment: payments.length > 0 })

const state = (extra = {}) => ({ total_amount: 643, cat_payment_plan: PAYMENT_PLAN_SINGLE, installments: [inst(1, 643, 4454, [{ payment_id: 1, amount: 643 }])], ...extra })

describe('expectedPlan', () => {
  it('contado saldado: una cuota por el total (la inicial va dentro si no hay cuota 0)', () => {
    expect(expectedPlan(raw())).toMatchObject({ total: 643, items: [{ n: 1, amount: 643, paid: true, due_date: '2026-01-16' }] })
  })

  it('con cronograma: reserva (cuota 0) + Cn, cobradas segun la hoja', () => {
    const r = raw({
      total_amount: 815, ingreso: 815, down_payment: 250, payment_way: 'cuotas',
      _installments: [
        { installment_number: 1, amount: 282, due_date: '30/12/2025', paid: true },
        { installment_number: 2, amount: 283, due_date: '19/01/2026', paid: true }
      ]
    })
    expect(expectedPlan(r).items.map(i => [i.n, i.amount, i.paid])).toEqual([[0, 250, true], [1, 282, true], [2, 283, true]])
  })

  it('deuda sin cronograma (SALDO sin FCn): no se adivina, queda bloqueado', () => {
    expect(expectedPlan(raw({ total_amount: 666, ingreso: 643, saldo: 23 })).blocked).toMatch(/sin cronograma/)
  })

  it('cronograma que no cuadra con INGRESO: bloqueado', () => {
    const r = raw({
      total_amount: 600, ingreso: 300, down_payment: 0, payment_way: 'cuotas',
      _installments: [{ installment_number: 1, amount: 300, due_date: '1/2/2026', paid: true }, { installment_number: 2, amount: 200, due_date: '1/3/2026' }]
    })
    expect(expectedPlan(r).blocked).toMatch(/no cuadra/)
  })
})

describe('planFinancialFix', () => {
  it('reserva pagada sin pago registrado: solo registrar el pago (bajo riesgo)', () => {
    const r = raw({
      total_amount: 815, ingreso: 815, down_payment: 250, payment_way: 'cuotas',
      _installments: [
        { installment_number: 1, amount: 282, due_date: '30/12/2025', paid: true },
        { installment_number: 2, amount: 283, due_date: '19/01/2026', paid: true }
      ]
    })
    const st = {
      total_amount: 815,
      cat_payment_plan: PAYMENT_PLAN_INSTALLMENTS,
      installments: [inst(0, 250, 2471), inst(1, 282, 4454, [{ payment_id: 1, amount: 282 }]), inst(2, 283, 4454, [{ payment_id: 2, amount: 283 }])]
    }
    const p = planFinancialFix(r, st)
    expect(p.kind).toBe('payments')
    expect(p.ops).toEqual([{ type: 'insert_payment', installment_id: 1000, n: 0, amount: 250 }])
  })

  it('total y pago de mas segun la hoja: ajusta cuota, pago y total (alto riesgo)', () => {
    const p = planFinancialFix(raw({ total_amount: 593, ingreso: 593, down_payment: 593 }), state({ total_amount: 643.5, installments: [inst(1, 643.5, 2471, [{ payment_id: 7, amount: 643.5 }])] }))
    expect(p.kind).toBe('plan')
    expect(p.ops.map(o => o.type)).toEqual(['update_amount', 'update_payment', 'set_total'])
    expect(p.ops.find(o => o.type === 'update_payment')).toMatchObject({ payment_id: 7, from: 643.5, to: 593 })
  })

  it('cuota pagada sin pago y con otro monto: ajusta monto y registra el pago', () => {
    const p = planFinancialFix(raw(), state({ total_amount: 652, installments: [inst(1, 652, 2471)] }))
    expect(p.ops.map(o => o.type)).toEqual(['update_amount', 'insert_payment', 'set_total'])
  })

  it('beneficio de membresia (total 0): la cuota queda en 0 y no se toca un pago', () => {
    const p = planFinancialFix(raw({ total_amount: 0, ingreso: 0, down_payment: 0, member_type: 'WE BLACK' }), state({ total_amount: 786.5, installments: [inst(1, 786.5, 2471)] }))
    expect(p.ops).toEqual([
      { type: 'update_amount', installment_id: 1001, n: 1, from: 786.5, to: 0 },
      { type: 'set_total', from: 786.5, to: 0 }
    ])
    const conPago = planFinancialFix(raw({ total_amount: 0, ingreso: 0, down_payment: 0 }), state({ installments: [inst(1, 100, 4454, [{ payment_id: 3, amount: 100 }])] }))
    expect(conPago.blocked).toMatch(/total 0/)
  })

  it('crea las cuotas que faltan y anula las que la hoja no tiene', () => {
    const r = raw({
      total_amount: 900, ingreso: 300, saldo: 600, down_payment: 300, payment_way: 'cuotas',
      _installments: [{ installment_number: 1, amount: 300, due_date: '1/2/2026' }, { installment_number: 2, amount: 300, due_date: '1/3/2026' }]
    })
    const st = { total_amount: 900, cat_payment_plan: PAYMENT_PLAN_SINGLE, installments: [inst(0, 300, 4454, [{ payment_id: 1, amount: 300 }]), inst(1, 600, 4452), inst(5, 0, 4452)] }
    const p = planFinancialFix(r, st)
    expect(p.kind).toBe('plan')
    expect(p.ops).toEqual([
      { type: 'update_amount', installment_id: 1001, n: 1, from: 600, to: 300 },
      { type: 'insert_installment', n: 2, amount: 300, paid: false, due_date: '2026-03-01' },
      { type: 'void_installment', installment_id: 1005, n: 5, amount: 0 },
      { type: 'set_payment_plan', from: PAYMENT_PLAN_SINGLE, to: PAYMENT_PLAN_INSTALLMENTS }
    ])
  })

  it('no toca dinero cobrado que la hoja no reconoce', () => {
    const r = raw({
      total_amount: 600, ingreso: 300, saldo: 300, down_payment: 0, payment_way: 'cuotas',
      _installments: [{ installment_number: 1, amount: 300, due_date: '1/2/2026', paid: true }, { installment_number: 2, amount: 300, due_date: '1/3/2026' }]
    })
    const st = { total_amount: 600, cat_payment_plan: PAYMENT_PLAN_INSTALLMENTS, installments: [inst(1, 300, 4454, [{ payment_id: 1, amount: 300 }]), inst(2, 300, 4454, [{ payment_id: 2, amount: 300 }])] }
    expect(planFinancialFix(r, st).blocked).toMatch(/Cuota 2: la hoja la da por pendiente/)
  })

  it('sin diferencias: nada que hacer', () => {
    expect(planFinancialFix(raw(), state())).toMatchObject({ kind: null, ops: [] })
  })
})

describe('proposeFixes', () => {
  const enrollment = (extra = {}) => ({
    enrollment_id: 4079,
    document_number: '18847682',
    version_code: 'BI-EZ-02',
    global_code: 'E37',
    program_edition_id: 500,
    total_amount: 652,
    paid_amount: 0,
    cat_payment_plan: PAYMENT_PLAN_SINGLE,
    registration_date: '2026-01-19',
    cat_type_status: 3100,
    status_label: 'Activo',
    active: 'Y',
    imported: true,
    agent_alias: null,
    children: [],
    installments: [inst(1, 652, 2471)],
    ...extra
  })
  const row = (findings, e = enrollment(), extra = {}) => ({
    enrollment_id: e?.enrollment_id ?? null,
    findings: findings.map(code => ({ code, severity: 'error', sheet: null, db: null })),
    _ctx: { raw: raw(), enrollment: e, db: e ? [e] : [], kind: 'importable', ...extra }
  })

  it('montos distintos en una importada: rehacer plan, con el detalle de cambios', () => {
    const [f] = proposeFixes(row(['TOTAL_MISMATCH', 'PAID_MISMATCH', 'PAID_WITHOUT_PAYMENT']))
    expect(f).toMatchObject({ action: 'plan', risk: 'high', blocked: null })
    expect(f.changes).toContain('Total: 652 → 643.')
  })

  it('una inscripcion registrada en el sistema no se corrige desde aqui', () => {
    const [f] = proposeFixes(row(['TOTAL_MISMATCH'], enrollment({ imported: false })))
    expect(f.blocked).toMatch(/no viene de la importación/)
  })

  it('asesor que no existe: la accion sale bloqueada con el motivo', () => {
    const r = row(['AGENT_MISMATCH'])
    r._ctx.raw = raw({ agent_code: 'IV27' })
    const [f] = proposeFixes(r, { agentsByAlias: new Map([['ae30', 2]]) })
    expect(f).toMatchObject({ action: 'agent', risk: 'low' })
    expect(f.blocked).toMatch(/IV27/)
  })

  it('fila sin inscripcion: importar la fila', () => {
    expect(proposeFixes(row(['MISSING_IN_DB'], null)).map(f => f.action)).toEqual(['import_row'])
  })

  it('fila sin inscripcion con DNI de relleno: no se importa (crearia otra persona)', () => {
    const r = row(['MISSING_IN_DB'], null)
    r._ctx.raw = raw({ document_number: '0' })
    expect(proposeFixes(r)[0].blocked).toMatch(/DNI de la hoja \("0"\)/)
  })

  it('RP partida con un destino suelto del mismo programa: aplicar RP enlazandolo', () => {
    const origen = enrollment({ enrollment_id: 11799, global_code: 'E65', program_edition_id: 15318 })
    const destino = { ...enrollment({ enrollment_id: 11902, global_code: 'E66', program_edition_id: 15335, total_amount: 0 }), move_origin_id: null, is_membership: false }
    const r = row(['MOVE_NOT_APPLIED'], origen)
    r._ctx.raw = raw({ enrollment_mode: 'RP' })
    const [f] = proposeFixes(r, { related: [origen, destino] })
    expect(f).toMatchObject({ action: 'link_rp', target: [11902], blocked: null })
  })
})

describe('reconcile: entre duplicadas conserva la que mas se parece a la fila', () => {
  it('elige la duplicada con la fecha correcta aunque tenga un id mayor', () => {
    const r = raw({ edition: 'E0', registration_date: '29/08/2025', payment_date: '28/08/2025' })
    const base = { document_number: '18847682', version_code: 'BI-EZ-02', global_code: null, program_edition_id: null, total_amount: 643, paid_amount: 643, cat_type_status: 3100, status_label: 'Activo', active: 'Y', imported: true, installments: [inst(1, 643, 4454, [{ payment_id: 1, amount: 643 }])], children: [] }
    const out = reconcile({
      rows: [{ rowNumber: 79, raw: r }],
      enrollments: [
        { ...base, enrollment_id: 4038, registration_date: '2026-06-23' },
        { ...base, enrollment_id: 4130, registration_date: '2025-08-29' }
      ]
    })
    expect(out.rows[0].enrollment_id).toBe(4130)
    expect(out.rows[0].findings.map(f => f.code)).toEqual(['DUPLICATE_IN_DB'])
  })
})
