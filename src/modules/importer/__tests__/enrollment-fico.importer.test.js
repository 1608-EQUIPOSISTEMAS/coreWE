import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { enrollmentFicoImporter, num } from '../importers/enrollment-fico.importer.js'
import { setImporterPorts } from '../importer.ports.js'

describe('enrollment-fico num — montos en formato peruano y US', () => {
  it('coma decimal peruana', () => {
    expect(num('220,00')).toBe(220)      // antes daba 22000
    expect(num('1.507,00')).toBe(1507)
    expect(num('50,5')).toBe(50.5)
  })
  it('punto decimal con coma de miles', () => {
    expect(num('1,507.00')).toBe(1507)
    expect(num('395.00')).toBe(395)
  })
  it('enteros y prefijos de moneda', () => {
    expect(num('370')).toBe(370)
    expect(num('S/. 0')).toBe(0)
    expect(num('S/. 33')).toBe(33)       // el "." de "S/." NO es decimal
    expect(num('S/. 1.507,00')).toBe(1507)
    expect(num('1,200')).toBe(1200)      // coma de miles sin decimales
    expect(num('')).toBe(0)
  })
})

// ctx minimo: una version activa + una edicion indexada por (version_code|global_code).
const ctx = {
  catalog: {
    we_business_entity: [
      { alias: 'we_business_entity_wec', description: 'WORLD ENTERPRISE CONSULTING S.A.C.', catalogo_id: 3212 },
      { alias: 'we_business_entity_weee', description: 'WE EDUCACION EJECUTIVA S.A.C.', catalogo_id: 3213 },
      { alias: 'we_business_entity_wel', description: 'WE EDUCACION LATAM S.A.C.', catalogo_id: 3214 },
      { alias: 'we_business_entity_wef', description: 'WE FOUNDATION', catalogo_id: 3215 },
      { alias: 'we_business_entity_johan', description: 'Johan Palomino', catalogo_id: 3258 }
    ]
  },
  programVersions: [{ program_version_id: 42, version_code: 'IA-CZ-03' }],
  editionsByCode: new Map([['ia-cz-03|e31', { program_edition_id: 500, program_version_id: 42 }]]),
  membershipByName: new Map([
    ['we black', { version_id: 900, program_id: 167 }],
    ['we gold', { version_id: 901, program_id: 169 }]
  ]),
  agentsByAlias: new Map([['ae30', 7], ['jp39', 8]]),
  // edicion 500 es padre: aulas hijas 600 (curso 60) y 601 (curso 61).
  childEditionsByParent: new Map([[500, [{ edition_id: 600, version_id: 60 }, { edition_id: 601, version_id: 61 }]]]),
  currencyByAlias: new Map([['we_currency_soles', 3041], ['we_currency_dollars', 3042]]),
  bankAccounts: [
    { account_id: 1, business_entity_catalog_id: 3212, bank_name: 'BCP', currency: 'PEN' },
    { account_id: 2, business_entity_catalog_id: 3212, bank_name: 'BCP', currency: 'USD' },
    { account_id: 6, business_entity_catalog_id: 3213, bank_name: 'BCP', currency: 'PEN' },
    { account_id: 9, business_entity_catalog_id: 3213, bank_name: 'INTERBANK', currency: 'PEN' },
    { account_id: 3, business_entity_catalog_id: 3212, bank_name: 'BCP-PROINNOVATE', currency: 'PEN' }
  ]
}
const baseRaw = { full_name: 'PEREZ GOMEZ JUAN', edition: 'E0', course_code: 'IA-CZ-03' }

describe('enrollment-fico loadContext — versiones para convalidacion', () => {
  it('carga versiones SIN filtro active (convalidacion puede referenciar curso inactivo)', async () => {
    let versionArgs = null
    setImporterPorts({
      getCatalog: async () => ({}),
      listProgramVersions: async (p) => { versionArgs = p; return { items: [] } },
      listActiveEditions: async () => [],
      listMembershipVersions: async () => [],
      listAgents: async () => [],
      listEditionStructure: async () => [],
      listBankAccounts: async () => [],
      listCurrencies: async () => []
    })
    await enrollmentFicoImporter.loadContext()
    expect(versionArgs.active).toBeUndefined() // antes pasaba 'Y' y perdia las inactivas
  })
})

describe('enrollment-fico resolveRow — convalidacion (ED E0)', () => {
  it('ED E0 resuelve curso por COD y deja edicion null, sin error', async () => {
    const { data, errors } = await enrollmentFicoImporter.resolveRow(baseRaw, ctx)
    expect(data.program_version_id).toBe(42)
    expect(data.program_edition_id).toBeNull()
    expect(data.observations).toMatch(/convalidacion/i)
    expect(errors).toHaveLength(0)
  })

  it('match de COD es tolerante a may/min y espacios', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow(
      { ...baseRaw, course_code: ' ia-cz-03 ' }, ctx)
    expect(data.program_version_id).toBe(42)
  })

  it('E0 con curso desconocido reporta error (no inventa edicion)', async () => {
    const { data, errors } = await enrollmentFicoImporter.resolveRow(
      { ...baseRaw, course_code: 'NO-EXISTE' }, ctx)
    expect(data.program_version_id).toBeUndefined()
    expect(errors.some(e => /convalidacion/i.test(e))).toBe(true)
  })
})

describe('enrollment-fico resolveRow — edicion normal (indice en memoria)', () => {
  it('resuelve edicion + version por (COD|ED) contra editionsByCode, sin query', async () => {
    const { data, errors } = await enrollmentFicoImporter.resolveRow(
      { full_name: 'X Y', course_code: 'ia-cz-03', edition: 'E31' }, ctx)
    expect(data.program_edition_id).toBe(500)
    expect(data.program_version_id).toBe(42)
    expect(errors).toHaveLength(0)
  })

  it('par (COD,ED) no indexado -> error "Edicion no encontrada"', async () => {
    const { errors } = await enrollmentFicoImporter.resolveRow(
      { full_name: 'X Y', course_code: 'IA-CZ-03', edition: 'E99' }, ctx)
    expect(errors.some(e => /Edicion no encontrada/i.test(e))).toBe(true)
  })

  it('edicion padre (paquete) -> adjunta sus aulas hijas', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow(
      { full_name: 'X Y', course_code: 'IA-CZ-03', edition: 'E31' }, ctx) // resuelve a edicion 500 (padre)
    expect(data.child_editions).toEqual([
      { edition_id: 600, version_id: 60 }, { edition_id: 601, version_id: 61 }
    ])
  })
})

describe('enrollment-fico resolveRow — beneficio de membresia (columna J)', () => {
  it('col J con valor (WE BLACK) -> resuelve membresia, NO beca, precio 0 OK', async () => {
    const { data, errors } = await enrollmentFicoImporter.resolveRow(
      { full_name: 'X Y', course_code: 'IA-CZ-03', edition: 'E31', member_type: 'WE BLACK', total_amount: 0 }, ctx)
    expect(data.is_membership_benefit).toBe(true)
    expect(data.is_scholarship).toBe(false)
    expect(data.membership_version_id).toBe(900)
    expect(errors).toHaveLength(0)
  })

  it('col J con tier desconocido -> error (no se pierde el miembro en silencio)', async () => {
    const { errors } = await enrollmentFicoImporter.resolveRow(
      { full_name: 'X Y', course_code: 'IA-CZ-03', edition: 'E31', member_type: 'WE DIAMOND' }, ctx)
    expect(errors.some(e => /membresia "WE DIAMOND"/i.test(e))).toBe(true)
  })

  it('col J vacia -> inscripcion normal, sin membresia', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow(
      { full_name: 'X Y', course_code: 'IA-CZ-03', edition: 'E31', member_type: '', total_amount: 500 }, ctx)
    expect(data.is_membership_benefit).toBe(false)
    expect(data.membership_version_id).toBeNull()
  })
})

describe('enrollment-fico resolveRow — cronograma de cuotas (raw._installments)', () => {
  const base = { full_name: 'X Y', course_code: 'IA-CZ-03', edition: 'E31' }

  it('toma las cuotas de raw._installments cuando el pipeline pasa [] (FICO sin hoja detalle)', async () => {
    const raw = { ...base, _installments: [
      { installment_number: 2, amount: 395, due_date: '29/4/2026' },
      { installment_number: 1, amount: 395, due_date: '15/4/2026' }
    ] }
    const { data } = await enrollmentFicoImporter.resolveRow(raw, ctx, []) // 3er arg vacio = pipeline real
    expect(data.installment_plan).toEqual([
      { installment_number: 1, amount: 395, due_date: '2026-04-15' },
      { installment_number: 2, amount: 395, due_date: '2026-04-29' }
    ])
  })

  it('sin cuotas -> sin installment_plan', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow({ ...base, _installments: [] }, ctx, [])
    expect(data.installment_plan).toBeUndefined()
  })
})

describe('enrollment-fico resolveRow — BECA y marcador de canal en columna AS', () => {
  const base = { full_name: 'X Y', course_code: 'IA-CZ-03', edition: 'E31' }

  it('tipo de descuento "BECA" -> is_scholarship true (acepta precio 0)', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow({ ...base, scholarship: 'BECA', total_amount: 0 }, ctx)
    expect(data.is_scholarship).toBe(true)
    expect(data.observations).toMatch(/BECA/)
  })

  it('sin beca -> is_scholarship false', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow({ ...base, scholarship: '', total_amount: 500 }, ctx)
    expect(data.is_scholarship).toBe(false)
  })

  it('beca NO se combina con membresia (la membresia tiene su propia via)', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow(
      { ...base, scholarship: 'BECA', member_type: 'WE BLACK' }, ctx)
    expect(data.is_scholarship).toBe(false)
    expect(data.is_membership_benefit).toBe(true)
  })

  it('columna AS "S/A" -> agent_origin SA, sin asesor', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow({ ...base, agent_code: 'S/A' }, ctx)
    expect(data.agent_origin).toBe('SA')
    expect(data.seller_agent_id).toBeUndefined()
  })

  it('columna AS con codigo real -> seller_agent_id, sin tocar agent_origin', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow({ ...base, agent_code: 'ae30' }, ctx)
    expect(data.seller_agent_id).toBe(7)
    expect(data.agent_origin).toBeUndefined()
  })

  it('combo "JP39-B2B" -> canal B2B en agent_origin + seller por codigo JP39', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow({ ...base, agent_code: 'JP39-B2B', total_amount: 500 }, ctx)
    expect(data.agent_origin).toBe('B2B')
    expect(data.seller_agent_id).toBe(8) // jp39 -> 8 en el ctx
  })

  it('total 0 sin beca (ej B2B 100%) -> is_scholarship true (acepta precio 0)', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow(
      { ...base, agent_code: 'B2B', total_amount: 0 }, ctx)
    expect(data.is_scholarship).toBe(true)
    expect(data.agent_origin).toBe('B2B')
  })
})

describe('enrollment-fico resolveRow — agente (columna AS)', () => {
  it('codigo de asesor conocido -> seller_agent_id; agent_origin NO se toca (es el canal)', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow(
      { full_name: 'X Y', course_code: 'IA-CZ-03', edition: 'E31', agent_code: 'ae30' }, ctx)
    expect(data.seller_agent_id).toBe(7)
    expect(data.agent_origin).toBeUndefined()
  })

  it('codigo desconocido -> seller_agent_id null y agent_origin sin asignar', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow(
      { full_name: 'X Y', course_code: 'IA-CZ-03', edition: 'E31', agent_code: 'ZZ99' }, ctx)
    expect(data.agent_origin).toBeUndefined()
    expect(data.seller_agent_id).toBeNull()
  })
})

describe('enrollment-fico resolveRow — moneda / entidad empresa / cuenta bancaria', () => {
  const base = { full_name: 'X Y', course_code: 'IA-CZ-03', edition: 'E31' }

  it('TIPO DE MONEDA "USD" -> cat_currency dolares (no default soles)', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow({ ...base, currency: 'USD' }, ctx)
    expect(data.cat_currency).toBe(3042)
  })

  it('TIPO DE MONEDA "PEN" -> cat_currency soles', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow({ ...base, currency: 'PEN' }, ctx)
    expect(data.cat_currency).toBe(3041)
  })

  it('moneda vacia -> default soles', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow({ ...base }, ctx)
    expect(data.cat_currency).toBe(3041)
  })

  it('ENTIDAD EMPRESA nombres amigables del dropdown -> cat_business_entity', async () => {
    const cases = [
      ['WE Educación', 3213], ['WE Consulting', 3212], ['WE Foundation', 3215],
      ['WE LATAM', 3214], ['Johan Palomino', 3258]
    ]
    for (const [label, id] of cases) {
      const { data } = await enrollmentFicoImporter.resolveRow({ ...base, business_entity: label }, ctx)
      expect(data.cat_business_entity, label).toBe(id)
    }
  })

  it('ENTIDAD EMPRESA tambien por abreviatura de alias (WEC) -> cat_business_entity', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow({ ...base, business_entity: 'WEC' }, ctx)
    expect(data.cat_business_entity).toBe(3212)
  })

  it('ENTIDAD FINANCIERA "BCP" + empresa WEC + USD -> cuenta unica', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow(
      { ...base, financial_entity: 'BCP', business_entity: 'WEC', currency: 'USD' }, ctx)
    expect(data.bank_account_id).toBe(2)
  })

  it('ENTIDAD FINANCIERA "BCP" exacto NO engancha "BCP-PROINNOVATE"', async () => {
    // WEC+PEN tiene cuenta BCP (1) y BCP-PROINNOVATE (3); el exacto debe dar la 1.
    const { data } = await enrollmentFicoImporter.resolveRow(
      { ...base, financial_entity: 'BCP', business_entity: 'WE Consulting', currency: 'PEN' }, ctx)
    expect(data.bank_account_id).toBe(1)
  })

  it('ENTIDAD FINANCIERA ambigua (BCP sin empresa, dos cuentas PEN) -> null, no adivina', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow(
      { ...base, financial_entity: 'BCP', currency: 'PEN' }, ctx)
    expect(data.bank_account_id).toBeUndefined()
  })
})

describe('enrollment-fico commitRow — importacion solo inserta', () => {
  it('pide al puerto NO notificar (skipFollowup) y dedup por curso (dedupeByVersion)', async () => {
    let received = null
    setImporterPorts({ registerEnrollment: async (args) => { received = args; return { result: 1, enrollment_id: 99 } } })
    const out = await enrollmentFicoImporter.commitRow({ program_version_id: 42 }, { userId: 7 })
    expect(received.skipFollowup).toBe(true)
    expect(received.dedupeByVersion).toBe(true)
    expect(out).toEqual({ ok: true, id: 99, message: 'Inscripcion creada' })
  })

  it('result=2 del puerto -> fila marcada duplicada, no importada', async () => {
    setImporterPorts({ registerEnrollment: async () => ({ result: 2, message: 'Ya existe' }) })
    const out = await enrollmentFicoImporter.commitRow({ program_version_id: 42 }, { userId: 7 })
    expect(out.ok).toBe(false)
    expect(out.duplicate).toBe(true)
  })

  it('duplicado con agente -> actualiza el asesor de la inscripcion existente', async () => {
    let updated = null
    setImporterPorts({
      registerEnrollment: async () => ({ result: 2, duplicate_info: { enrollment_id: 555 } }),
      updateEnrollmentAgent: async (args) => { updated = args }
    })
    await enrollmentFicoImporter.commitRow(
      { program_version_id: 42, seller_agent_id: 7, agent_origin: 'AE30' }, { userId: 1 })
    expect(updated).toEqual({ enrollmentId: 555, sellerAgentId: 7, agentOrigin: 'AE30' })
  })

  it('fila con tier -> crea curso Y membresia (2 llamadas; la 2da al programa-membresia)', async () => {
    const calls = []
    setImporterPorts({ registerEnrollment: async (args) => { calls.push(args.data); return { result: 1, enrollment_id: 1 } } })
    await enrollmentFicoImporter.commitRow(
      { program_version_id: 42, membership_version_id: 900, member_type: 'WE BLACK', document_number: '123' }, { userId: 7 })
    expect(calls).toHaveLength(2)
    expect(calls[1].program_version_id).toBe(900)
    expect(calls[1].program_edition_id).toBeNull()
    expect(calls[1].is_membership_benefit).toBe(true)
    expect(calls[1].list_price).toBe(0)
  })

  it('paquete -> crea padre + 1 hija por aula, ligadas al padre', async () => {
    const calls = []
    setImporterPorts({ registerEnrollment: async (args) => { calls.push(args.data); return { result: 1, enrollment_id: 1000 } } })
    await enrollmentFicoImporter.commitRow({
      program_version_id: 42, program_edition_id: 500, document_number: '123',
      child_editions: [{ edition_id: 600, version_id: 60 }, { edition_id: 601, version_id: 61 }]
    }, { userId: 7 })
    expect(calls).toHaveLength(3) // padre + 2 hijas
    expect(calls[1]).toMatchObject({ program_edition_id: 600, program_version_id: 60, parent_enrollment_id: 1000, list_price: 0 })
    expect(calls[2]).toMatchObject({ program_edition_id: 601, program_version_id: 61, parent_enrollment_id: 1000 })
  })

  it('paquete con padre duplicado -> igual crea las hijas (backfill) con el id existente', async () => {
    const calls = []
    setImporterPorts({
      registerEnrollment: async (args) => {
        calls.push(args.data)
        return calls.length === 1 ? { result: 2, duplicate_info: { enrollment_id: 2000 } } : { result: 1, enrollment_id: 9 }
      }
    })
    await enrollmentFicoImporter.commitRow({
      program_version_id: 42, program_edition_id: 500, document_number: '123',
      child_editions: [{ edition_id: 600, version_id: 60 }]
    }, { userId: 7 })
    expect(calls).toHaveLength(2)
    expect(calls[1].parent_enrollment_id).toBe(2000)
  })

  it('hija que falla (result!=1/2) -> fila NO ok y mensaje con ADVERTENCIA (no se traga el fallo)', async () => {
    let n = 0
    setImporterPorts({
      registerEnrollment: async () => {
        n++
        // 1ra llamada = padre ok; 2da = hija falla con result 0.
        return n === 1 ? { result: 1, enrollment_id: 1000 } : { result: 0, message: 'El correo es obligatorio.' }
      }
    })
    const out = await enrollmentFicoImporter.commitRow({
      program_version_id: 42, program_edition_id: 500, document_number: '123',
      child_editions: [{ edition_id: 600, version_id: 60 }]
    }, { userId: 7 })
    expect(out.ok).toBe(false)
    expect(out.message).toMatch(/ADVERTENCIA/)
    expect(out.message).toMatch(/aula 600/)
  })
})

// --- ingest: como se reconstruye el dinero de la fila -------------------------
// Estas dos reglas salen de la hoja real (SAP HANA, 2026-07-24) y tocan plata,
// asi que se prueban sobre un workbook de verdad y no solo sobre resolveRow.
function hojaFico (filas) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('INS - N')
  ws.addRow(['DNI', 'NOMBRES Y APELLIDOS', 'ED', 'COD', 'OBS', 'INICIAL',
    'FC1', 'C1', 'FC2', 'C2', 'SALDO', 'INGRESO'])
  for (const f of filas) ws.addRow(f)
  return wb
}

describe('enrollment-fico ingest — total y cronograma', () => {
  it('GIFT CARD: el saldo residual es el regalo, no deuda -> total = INGRESO', () => {
    const { rows } = enrollmentFicoImporter.ingest(hojaFico([
      ['111', 'A A', 'E31', 'IA-CZ-03', 'GIF CARD DE S/50', 200, '19/3/2026', 209, '5/4/2026', 201, 43, 610]
    ]))
    expect(rows[0].raw.total_amount).toBe(610) // 610 + 43 seria cobrarle el regalo
    expect(rows[0].raw._installments).toEqual([
      { installment_number: 1, amount: 209, due_date: '19/3/2026' },
      { installment_number: 2, amount: 201, due_date: '5/4/2026' }
    ])
  })

  it('Cn vacia con FCn con fecha = cuota programada NO pagada, por el SALDO', () => {
    const { rows } = enrollmentFicoImporter.ingest(hojaFico([
      ['222', 'B B', 'E31', 'IA-CZ-03', '', 250, '30/4/2026', 233, '23/5/2026', '', 234, 483]
    ]))
    const { total_amount: total, down_payment: inicial, _installments: plan } = rows[0].raw
    expect(total).toBe(717)
    expect(plan).toEqual([
      { installment_number: 1, amount: 233, due_date: '30/4/2026' },
      { installment_number: 2, amount: 234, due_date: '23/5/2026' }
    ])
    // El SP exige que el plan cierre contra el saldo a financiar.
    expect(inicial + plan.reduce((s, i) => s + i.amount, 0)).toBe(total)
  })

  it('Cn vacia SIN fecha no inventa cuota (queda saldo sin cronograma)', () => {
    const { rows } = enrollmentFicoImporter.ingest(hojaFico([
      ['333', 'C C', 'E31', 'IA-CZ-03', '', 700, '', '', '', '', 155, 700]
    ]))
    expect(rows[0].raw.total_amount).toBe(855)
    expect(rows[0].raw._installments).toEqual([])
    expect(rows[0].raw.payment_way).toBe('contado')
  })
})

describe('enrollment-fico resolveRow — miembro que SI paga su curso', () => {
  it('WE PLUS con total > 0: se cobra, no es beneficio, y conserva el tier', async () => {
    const { data, errors } = await enrollmentFicoImporter.resolveRow(
      { ...baseRaw, member_type: 'WE BLACK', total_amount: 700, down_payment: 150 }, ctx, [])
    expect(errors).toEqual([])
    expect(data.total_amount).toBe(700)      // antes lo dejaba en 0 por ser miembro
    expect(data.is_membership_benefit).toBe(false)
    expect(data.is_scholarship).toBe(false)  // tampoco es beca
    expect(data.membership_program_id).toBe(167) // el tier se conserva
  })

  it('WE BLACK con total 0 sigue siendo beneficio de membresia', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow(
      { ...baseRaw, member_type: 'WE BLACK', total_amount: 0 }, ctx, [])
    expect(data.is_membership_benefit).toBe(true)
    expect(data.member_type).toBe('WE BLACK')
    expect(data.membership_program_id).toBe(167)
  })
})

describe('enrollment-fico ingest — reparto del saldo y gift card con monto', () => {
  it('varias cuotas programadas sin monto: el saldo se reparte parejo', () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('INS - N')
    ws.addRow(['DNI', 'NOMBRES Y APELLIDOS', 'ED', 'COD', 'OBS', 'INICIAL',
      'FC1', 'C1', 'FC2', 'C2', 'FC3', 'C3', 'SALDO', 'INGRESO'])
    ws.addRow(['444', 'D D', 'E31', 'IA-CZ-03', '', 200,
      '15/3/2026', '', '1/4/2026', '', '1/5/2026', '', 750, 200])
    const { raw } = enrollmentFicoImporter.ingest(wb).rows[0]
    expect(raw._installments).toEqual([
      { installment_number: 1, amount: 250, due_date: '15/3/2026' },
      { installment_number: 2, amount: 250, due_date: '1/4/2026' },
      { installment_number: 3, amount: 250, due_date: '1/5/2026' }
    ])
    expect(raw.down_payment + raw._installments.reduce((s, i) => s + i.amount, 0)).toBe(raw.total_amount)
  })

  it('reparto con resto: la ultima cuota absorbe el centimo', () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('INS - N')
    ws.addRow(['DNI', 'NOMBRES Y APELLIDOS', 'ED', 'COD', 'OBS', 'INICIAL', 'FC1', 'C1', 'FC2', 'C2', 'SALDO', 'INGRESO'])
    ws.addRow(['555', 'E E', 'E31', 'IA-CZ-03', '', 0, '1/2/2026', '', '1/3/2026', '', 100.01, 0])
    const plan = enrollmentFicoImporter.ingest(wb).rows[0].raw._installments
    expect(plan.map(i => i.amount)).toEqual([50, 50.01])
  })

  it('gift card menor que el saldo: el saldo SI es deuda', () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('INS - N')
    ws.addRow(['DNI', 'NOMBRES Y APELLIDOS', 'ED', 'COD', 'OBS', 'INICIAL', 'FC1', 'C1', 'SALDO', 'INGRESO'])
    ws.addRow(['666', 'F F', 'E31', 'IA-CZ-03', 'GIF CARD S/30', 200, '31/3/2026', '', 625, 200])
    const { raw } = enrollmentFicoImporter.ingest(wb).rows[0]
    expect(raw.total_amount).toBe(825) // 200 + 625, la tarjeta de 30 no cubre el saldo
    expect(raw._installments).toEqual([{ installment_number: 1, amount: 625, due_date: '31/3/2026' }])
  })
})

describe('enrollment-fico ingest — saldo que no entra en ninguna cuota', () => {
  it('agrega una cuota extra con el vencimiento de la ultima, sin tocar las cobradas', () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('INS - N')
    ws.addRow(['DNI', 'NOMBRES Y APELLIDOS', 'ED', 'COD', 'OBS', 'INICIAL',
      'FC1', 'C1', 'FC2', 'C2', 'FC3', 'C3', 'SALDO', 'INGRESO'])
    // Caso real MAMANI: 150 + 254*3 = 912 cobrados, total 963, sobran 51.
    ws.addRow(['777', 'G G', 'E31', 'IA-CZ-03', '', 150,
      '10/1/2026', 254, '17/1/2026', 254, '17/2/2026', 254, 51, 912])
    const { raw } = enrollmentFicoImporter.ingest(wb).rows[0]
    expect(raw.total_amount).toBe(963)
    expect(raw._installments).toEqual([
      { installment_number: 1, amount: 254, due_date: '10/1/2026' },
      { installment_number: 2, amount: 254, due_date: '17/1/2026' },
      { installment_number: 3, amount: 254, due_date: '17/2/2026' },
      { installment_number: 4, amount: 51, due_date: '17/2/2026' } // el resto, aparte
    ])
    expect(raw.down_payment + raw._installments.reduce((s, i) => s + i.amount, 0)).toBe(963)
  })

  it('contado con saldo no genera cuotas (no hay vencimiento del que colgarse)', () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('INS - N')
    ws.addRow(['DNI', 'NOMBRES Y APELLIDOS', 'ED', 'COD', 'OBS', 'INICIAL', 'FC1', 'C1', 'SALDO', 'INGRESO'])
    ws.addRow(['888', 'H H', 'E31', 'IA-CZ-03', '', 700, '', '', 155, 700])
    const { raw } = enrollmentFicoImporter.ingest(wb).rows[0]
    expect(raw._installments).toEqual([])
    expect(raw.payment_way).toBe('contado')
  })
})
