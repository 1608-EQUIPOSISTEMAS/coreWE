import { describe, it, expect } from 'vitest'
import { reconcile, compareRow, compareMoveOrigin, mergeSheets, agentCodeOf, isoDate, rowKey, enrollmentKey } from '../reconciliation.entity.js'

// Fila del importador (raw de ingest) y su inscripcion en BD, con los valores de
// un caso "sano" de la hoja BI-EZ-01: contado de 640 saldado, en E63.
const raw = (extra = {}) => ({
  document_number: '72950952',
  full_name: 'ARTEAGA VIDAL DEYSY',
  course_code: 'BI-EZ-01',
  edition: 'E63',
  enrollment_mode: 'ACT',
  excluded: false,
  total_amount: 640,
  ingreso: 640,
  saldo: 0,
  registration_date: '23/09/2025',
  payment_date: '23/09/2025',
  member_type: '',
  agent_code: 'AE30',
  _installments: [],
  ...extra
})

const enrollment = (extra = {}) => ({
  enrollment_id: 11661,
  document_number: '72950952',
  student: 'ARTEAGA VIDAL DEYSY',
  version_code: 'BI-EZ-01',
  global_code: 'E63',
  program_edition_id: 500,
  total_amount: 640,
  paid_amount: 640,
  registration_date: '2025-09-23',
  cat_type_status: 3046,
  status_label: 'Activo',
  active: 'Y',
  membership_program_id: null,
  agent_alias: 'AE30',
  children: [{ edition_id: 900, label: 'BI-CZ-04 E58' }],
  installments: [{ n: 1, amount: 640, status: 4454, has_payment: true }],
  ...extra
})

const aula = (edition_id, label) => ({ edition_id, label })
const ctx = { activeEditions: [{ version_code: 'BI-EZ-01', global_code: 'E63', program_edition_id: 500 }], structure: new Map([[500, [aula(900, 'BI-CZ-04 E58')]]]) }
const row = (r, rowNumber = 181) => ({ rowNumber, raw: r })
const codes = (result) => result.rows.flatMap(r => r.findings.map(f => f.code))

describe('helpers', () => {
  it('isoDate entiende el D/M/AAAA del CSV de Google', () => {
    expect(isoDate('7/12/2024')).toBe('2024-12-07')
    expect(isoDate('2025-09-23')).toBe('2025-09-23')
    expect(isoDate('PARA EL 30/1/2026')).toBeNull()
  })

  it('agentCodeOf quita los marcadores de canal', () => {
    expect(agentCodeOf('WEB-AE30')).toBe('ae30')
    expect(agentCodeOf('RH30-B2B')).toBe('rh30')
    expect(agentCodeOf('S/A')).toBeNull()
    expect(agentCodeOf('B2B')).toBeNull()
  })

  it('la E0 cruza con la inscripcion sin edicion', () => {
    expect(rowKey(raw({ edition: 'E0' }))).toBe(enrollmentKey(enrollment({ program_edition_id: null, global_code: null })))
  })
})

describe('compareRow', () => {
  it('fila y BD iguales no generan hallazgos', () => {
    expect(compareRow(raw(), enrollment(), ctx)).toEqual([])
  })

  it('total de catalogo en vez de lo cobrado (import de junio)', () => {
    const f = compareRow(raw({ total_amount: 510, ingreso: 510 }), enrollment({ total_amount: 570.5, paid_amount: 570.5 }), ctx)
    expect(f.map(x => x.code)).toEqual(['TOTAL_MISMATCH', 'PAID_MISMATCH'])
    expect(f[0]).toMatchObject({ sheet: 510, db: 570.5, severity: 'error' })
  })

  it('cuotas C1/C2 cobradas que no existen en BD (solo la reserva de 200)', () => {
    const f = compareRow(
      raw({ total_amount: 770, ingreso: 770, _installments: [{ installment_number: 1, amount: 285, paid: true }, { installment_number: 2, amount: 285, paid: true }] }),
      enrollment({ total_amount: 770, paid_amount: 200, installments: [{ n: 0, amount: 200, status: 2471, has_payment: true }] }),
      ctx)
    expect(f.map(x => x.code)).toEqual(['PAID_MISMATCH', 'INSTALLMENTS_MISSING'])
    expect(f[1].message).toContain('C1 (285)')
  })

  it('cuota pagada sin fila en payments (Mercado Pago)', () => {
    const f = compareRow(raw(), enrollment({ paid_amount: 0, installments: [{ n: 1, amount: 640, status: 2471, has_payment: false }] }), ctx)
    expect(f.map(x => x.code)).toEqual(['PAID_MISMATCH', 'PAID_WITHOUT_PAYMENT'])
    expect(f[1].severity).toBe('warning')
  })

  it('deuda de la hoja contra cuotas pendientes (anuladas no cuentan)', () => {
    const f = compareRow(
      raw({ total_amount: 733.5, ingreso: 250, saldo: 483.5 }),
      enrollment({ total_amount: 733.5, paid_amount: 250, installments: [{ n: 0, amount: 250, status: 4454, has_payment: true }, { n: 1, amount: 483.5, status: 4456, has_payment: false }] }),
      ctx)
    expect(f.map(x => x.code)).toEqual(['PENDING_MISMATCH'])
  })

  it('aulas hijas segun edition_structure, miembro sin tier, asesor y fecha', () => {
    const f = compareRow(
      raw({ member_type: 'WE BLACK', agent_code: 'WEB-CG37', registration_date: '' }),
      enrollment({ children: [], registration_date: '2026-06-25' }),
      ctx)
    expect(f.map(x => x.code)).toEqual(['CHILDREN_MISMATCH', 'MEMBERSHIP_MISSING', 'AGENT_MISMATCH', 'REGISTRATION_DATE_MISMATCH'])
    expect(f[3]).toMatchObject({ sheet: '2025-09-23', db: '2026-06-25' })
  })

  it('asesor solo-canal no se compara', () => {
    expect(compareRow(raw({ agent_code: 'S/A' }), enrollment({ agent_alias: null }), ctx)).toEqual([])
  })
})

describe('reconcile', () => {
  it('solo devuelve filas con diferencias y deja fuera las ediciones historicas', () => {
    const r = reconcile({
      rows: [row(raw()), row(raw({ document_number: '1', edition: 'E51' }), 2)],
      enrollments: [enrollment()],
      ...ctx
    })
    expect(r.summary).toMatchObject({ sheet_rows: 2, in_scope: 1, out_of_scope: 1, ok: 1, with_findings: 0 })
    expect(r.rows).toEqual([])
  })

  it('fila importable sin inscripcion', () => {
    const r = reconcile({ rows: [row(raw({ document_number: '07971440' }), 206)], enrollments: [], ...ctx })
    expect(codes(r)).toEqual(['MISSING_IN_DB'])
    expect(r.rows[0].row_number).toBe(206)
  })

  it('fila R con inscripcion vigente y su duplicado', () => {
    const r = reconcile({
      rows: [row(raw({ enrollment_mode: 'R', excluded: true }), 193)],
      enrollments: [enrollment({ enrollment_id: 19990 }), enrollment({ enrollment_id: 11689, cat_type_status: 3245, status_label: 'R' })],
      ...ctx
    })
    expect(codes(r)).toEqual(['EXCLUDED_BUT_ACTIVE', 'DUPLICATE_IN_DB'])
    expect(r.rows[0].findings[1].severity).toBe('error')
  })

  it('fila R con todas sus inscripciones retiradas: el duplicado es solo advertencia', () => {
    const retirada = { cat_type_status: 3245, status_label: 'R' }
    const r = reconcile({
      rows: [row(raw({ enrollment_mode: 'R', excluded: true }), 194)],
      enrollments: [enrollment({ enrollment_id: 19992, ...retirada }), enrollment({ enrollment_id: 11691, ...retirada })],
      ...ctx
    })
    expect(r.rows[0].findings).toMatchObject([{ code: 'DUPLICATE_IN_DB', severity: 'warning' }])
  })

  it('la hoja la trae activa y en BD esta retirada: no se comparan montos', () => {
    const r = reconcile({ rows: [row(raw())], enrollments: [enrollment({ cat_type_status: 3245, status_label: 'R', total_amount: 1 })], ...ctx })
    expect(codes(r)).toEqual(['INACTIVE_IN_DB'])
  })

  it('RP partido: el destino BECA aparece como inscripcion sin fila, con pista a la RP', () => {
    const editions = [
      { version_code: 'BI-EZ-01', global_code: 'E65', program_edition_id: 501 },
      { version_code: 'BI-EZ-01', global_code: 'E66', program_edition_id: 502 }
    ]
    const rarazEnrollments = [
      enrollment({ enrollment_id: 11799, document_number: '75258746', global_code: 'E65', program_edition_id: 501, total_amount: 652, paid_amount: 652, children: [aula(1, 'a'), aula(2, 'b')], installments: [{ n: 1, amount: 652, status: 4454, has_payment: true }] }),
      enrollment({ enrollment_id: 11902, document_number: '75258746', global_code: 'E66', program_edition_id: 502, total_amount: 0, imported: true })
    ]
    const r = reconcile({
      related: rarazEnrollments,
      rows: [
        row(raw({ document_number: '75258746', edition: 'E65', enrollment_mode: 'RP', total_amount: 652, ingreso: 652 }), 238),
        row(raw({ document_number: '9', edition: 'E66' }), 240)
      ],
      enrollments: [
        enrollment({ enrollment_id: 11799, document_number: '75258746', global_code: 'E65', program_edition_id: 501, total_amount: 652, paid_amount: 652, children: [aula(1, 'a'), aula(2, 'b')], installments: [{ n: 1, amount: 652, status: 4454, has_payment: true }] }),
        enrollment({ enrollment_id: 11902, document_number: '75258746', global_code: 'E66', program_edition_id: 502, total_amount: 0, imported: true }),
        enrollment({ enrollment_id: 30, document_number: '8', global_code: 'E66', program_edition_id: 502, children: [aula(3, 'c'), aula(4, 'd')] }),
        enrollment({ enrollment_id: 7, document_number: '9', global_code: 'E66', program_edition_id: 502, children: [aula(3, 'c'), aula(4, 'd')] })
      ],
      activeEditions: editions,
      structure: new Map([[501, [aula(1, 'a'), aula(2, 'b')]], [502, [aula(3, 'c'), aula(4, 'd')]]])
    })
    const notInSheet = r.rows.find(x => x.enrollment_id === 11902)
    expect(notInSheet.findings[0].code).toBe('NOT_IN_SHEET')
    expect(notInSheet.findings[0].message).toContain('fila 238')
    expect(notInSheet.findings[0].severity).toBe('error')
    // Venta registrada en el sistema (no importada): la hoja esta desactualizada.
    expect(r.rows.find(x => x.enrollment_id === 30).findings[0].severity).toBe('warning')
    // El origen sigue Activo: la RP no se aplico, y se propone el destino suelto.
    const origen = r.rows.find(x => x.enrollment_id === 11799)
    expect(origen.findings[0]).toMatchObject({ code: 'MOVE_NOT_APPLIED', severity: 'error' })
    expect(origen.findings[0].message).toContain('#11902 (BI-EZ-01 E66)')
    expect(r.summary.by_code).toEqual({ NOT_IN_SHEET: 2, MOVE_NOT_APPLIED: 1 })
  })
})

describe('RP / CC: el par se arma con el enlace del sistema', () => {
  const editions = [
    { version_code: 'BI-EZ-01', global_code: 'E65', program_edition_id: 501 },
    { version_code: 'BI-EZ-01', global_code: 'E66', program_edition_id: 502 }
  ]
  const structure = new Map([[501, [aula(1, 'BI-CZ-03 E129'), aula(2, 'BI-CZ-04 E59')]], [502, [aula(3, 'BI-CZ-03 E131'), aula(4, 'BI-CZ-04 E61')]]])
  const RP = 3240
  const CC = 3242
  // Origen ya reprogramado: conserva lo pagado, sin deuda ni hijas vigentes.
  const origen = (extra = {}) => enrollment({
    enrollment_id: 100, global_code: 'E65', program_edition_id: 501, cat_type_status: RP, status_label: 'RP',
    total_amount: 733.5, paid_amount: 250, children: [], installments: [{ n: 0, amount: 250, status: 4454, has_payment: true }], ...extra
  })
  // Destino creado por reprogramEdition: total 0, hereda la deuda y crea sus hijas.
  const destino = (extra = {}) => enrollment({
    enrollment_id: 200, global_code: 'E66', program_edition_id: 502, total_amount: 0, paid_amount: 0,
    move_origin_id: 100, move_kind: 'RP', children: [aula(3, 'BI-CZ-03 E131'), aula(4, 'BI-CZ-04 E61')],
    installments: [{ n: 1, amount: 483.5, status: 4452, has_payment: false }], ...extra
  })
  const filaRP = raw({ edition: 'E65', enrollment_mode: 'RP', total_amount: 733.5, ingreso: 250, saldo: 483.5 })
  const filaDestino = raw({ edition: 'E66', enrollment_mode: 'ACT', obs: 'VIENE DE UNA RP', total_amount: 0, ingreso: 0, saldo: 0 })

  it('RP bien hecha en el mismo programa: ni deuda ni hijas del origen dan falsas alarmas', () => {
    const o = origen(); const d = destino()
    const r = reconcile({ rows: [row(filaRP, 10), row(filaDestino, 11)], enrollments: [o, d], related: [o, d], activeEditions: editions, structure })
    expect(r.rows).toEqual([])
    expect(r.summary.ok).toBe(2)
  })

  it('la deuda de la fila RP se compara contra el destino', () => {
    const o = origen(); const d = destino({ installments: [{ n: 1, amount: 400, status: 4452, has_payment: false }] })
    const f = compareMoveOrigin(filaRP, o, { structure, related: [o, d] })
    expect(f.map(x => x.code)).toEqual(['PENDING_MISMATCH'])
    expect(f[0].message).toContain('#200')
  })

  it('origen en RP sin ninguna inscripcion que venga de el', () => {
    const o = origen()
    expect(compareMoveOrigin(filaRP, o, { structure, related: [o] }).map(x => x.code)).toEqual(['MOVE_DESTINATION_MISSING'])
  })

  it('CC importado partido (caso RAMOS): origen activo y destino E0 suelto en otro programa', () => {
    const o = origen({ enrollment_id: 11850, cat_type_status: 3046, status_label: 'Activo', children: [aula(1, 'BI-CZ-03 E129'), aula(2, 'BI-CZ-04 E59')] })
    const sueltoE0 = { enrollment_id: 8044, document_number: o.document_number, version_code: 'BI-EZ-06', global_code: null, program_edition_id: null, total_amount: 73, active: 'Y', cat_type_status: 3046, notes_viene_de: true }
    const membresia = { ...sueltoE0, enrollment_id: 3209, version_code: 'MEMB-03', total_amount: 0, notes_viene_de: false, is_membership: true }
    const f = compareMoveOrigin(raw({ edition: 'E65', enrollment_mode: 'CC', total_amount: 733.5, ingreso: 250, saldo: 0 }), o, { structure, related: [o, sueltoE0, membresia] })
    expect(f[0]).toMatchObject({ code: 'MOVE_NOT_APPLIED', severity: 'error' })
    expect(f[0].message).toContain('#8044 (BI-EZ-06 E0)')
    expect(f[0].message).not.toContain('#3209') // la membresia no es un destino
  })

  it('CC bien hecho con destino en otro programa (otra hoja)', () => {
    const o = origen({ cat_type_status: CC, status_label: 'CC' })
    const d = { enrollment_id: 300, document_number: o.document_number, version_code: 'BI-EZ-06', global_code: 'E9', program_edition_id: 77, active: 'Y', cat_type_status: 3046, move_origin_id: 100, move_kind: 'CC', pending_amount: 483.5 }
    expect(compareMoveOrigin(raw({ ...filaRP, enrollment_mode: 'CC' }), o, { structure, related: [o, d] })).toEqual([])
  })

  it('la hoja dice RP pero el destino enlazado es de otro programa: en el sistema es un CC', () => {
    const o = origen({ cat_type_status: CC, status_label: 'CC' })
    const d = { enrollment_id: 300, document_number: o.document_number, version_code: 'BI-EZ-06', global_code: 'E9', program_edition_id: 77, active: 'Y', move_origin_id: 100, pending_amount: 483.5 }
    const f = compareMoveOrigin(filaRP, o, { structure, related: [o, d] })
    expect(f.map(x => x.code)).toEqual(['MOVE_TYPE_MISMATCH', 'MOVE_TYPE_MISMATCH'])
    expect(f[1].message).toContain('en el sistema es un CC')
  })

  it('destino E0 (convalidacion) no puede salir del flujo RP: se acepta suelto', () => {
    const o = origen()
    const e0 = { enrollment_id: 400, document_number: o.document_number, version_code: 'BI-EZ-01', global_code: null, program_edition_id: null, total_amount: 0, active: 'Y', cat_type_status: 3046 }
    expect(compareMoveOrigin({ ...filaRP, saldo: 0 }, o, { structure, related: [o, e0] })).toEqual([])
  })

  it('fila "VIENE DE UN RP" que en el sistema es una inscripcion suelta', () => {
    const o = origen()
    const suelta = destino({ move_origin_id: null, move_kind: null, installments: [] })
    const r = reconcile({ rows: [row(filaDestino, 11)], enrollments: [suelta], related: [o, suelta], activeEditions: editions, structure })
    expect(r.rows[0].findings[0]).toMatchObject({ code: 'MOVE_SPLIT_IMPORT', severity: 'error' })
    expect(r.rows[0].findings[0].message).toContain('posible origen #100')
  })

  it('destino enlazado sin fila ACT en la hoja: advertencia, no error', () => {
    const o = origen(); const d = destino()
    const r = reconcile({ rows: [row(filaRP, 10)], enrollments: [o, d], related: [o, d], activeEditions: editions, structure })
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].findings[0]).toMatchObject({ code: 'NOT_IN_SHEET', severity: 'warning' })
    expect(r.rows[0].findings[0].message).toContain('fila 10')
  })

  it('hija en el aula equivocada y movimiento de modulo anotado en OBS', () => {
    const f = compareRow(raw({ obs: 'VIENE DE UN CC, SE RP 3ER MODULO' }), enrollment({ children: [aula(901, 'BI-CZ-04 E60')] }), ctx)
    expect(f.map(x => x.code)).toEqual(['CHILDREN_MISMATCH', 'MODULE_MOVE_NOTE'])
    expect(f[0].message).toBe('Aulas hijas: faltan BI-CZ-04 E58; sobran BI-CZ-04 E60.')
  })
})

describe('varias hojas del mismo programa (una por año)', () => {
  const fila = (dni, ed, extra = {}) => ({ rowNumber: extra.rowNumber ?? 1, raw: raw({ document_number: dni, edition: ed, ...extra }) })

  it('une las hojas y, si una fila se repite, manda la ultima', () => {
    const h2025 = [fila('1', 'E65', { rowNumber: 238, enrollment_mode: 'RP' }), fila('2', 'E63', { rowNumber: 180 })]
    const h2026 = [fila('1', 'E65', { rowNumber: 76, enrollment_mode: 'RP', ingreso: 999 }), fila('1', 'E66', { rowNumber: 111 })]
    const { rows, replaced } = mergeSheets([h2025, h2026])
    expect(replaced).toBe(1)
    expect(rows.map(r => [r.raw.document_number, r.raw.edition, r.sheet, r.rowNumber])).toEqual([
      ['1', 'E65', 2, 76], ['2', 'E63', 1, 180], ['1', 'E66', 2, 111]
    ])
    expect(rows[0].raw.ingreso).toBe(999)
  })

  it('dentro de una misma hoja no deduplica: dos filas iguales son un duplicado real', () => {
    const { rows, replaced } = mergeSheets([[fila('1', 'E65', { rowNumber: 5 }), fila('1', 'E65', { rowNumber: 6 })]])
    expect(rows).toHaveLength(2)
    expect(replaced).toBe(0)
  })

  it('las referencias dicen de que hoja es la fila', () => {
    const o = enrollment({ enrollment_id: 100, global_code: 'E66', program_edition_id: 502, cat_type_status: 3240, status_label: 'RP', children: [] })
    const d = enrollment({ enrollment_id: 200, global_code: 'E65', program_edition_id: 501, total_amount: 0, paid_amount: 0, move_origin_id: 100, move_kind: 'RP', children: [] })
    const { rows } = mergeSheets([[], [{ rowNumber: 80, raw: raw({ edition: 'E66', enrollment_mode: 'RP' }) }]])
    const r = reconcile({ rows, enrollments: [o, d], related: [o, d], activeEditions: [{ version_code: 'BI-EZ-01', global_code: 'E66' }], structure: new Map() })
    const destino = r.rows.find(x => x.enrollment_id === 200)
    expect(destino.findings[0].message).toContain('fila 80 (hoja 2)')
  })

  it('"VIENDE DE UNA RP" (errata real de la hoja 2026) tambien es un destino de RP', () => {
    const suelta = enrollment({ move_origin_id: null })
    const r = reconcile({ rows: [{ rowNumber: 113, raw: raw({ obs: 'VIENDE DE UNA RP' }) }], enrollments: [suelta], related: [suelta], ...ctx })
    expect(r.rows[0].findings[0].code).toBe('MOVE_SPLIT_IMPORT')
  })
})
