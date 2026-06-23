import { describe, it, expect } from 'vitest'
import { enrollmentFicoImporter } from '../importers/enrollment-fico.importer.js'
import { setImporterPorts } from '../importer.ports.js'

// ctx minimo: una version activa + una edicion indexada por (version_code|global_code).
const ctx = {
  catalog: {
    we_business_entity: [
      { alias: 'we_business_entity_wec', description: 'WORLD ENTERPRISE CONSULTING S.A.C.', catalogo_id: 3212 },
      { alias: 'we_business_entity_weee', description: 'WE EDUCACION EJECUTIVA S.A.C.', catalogo_id: 3213 }
    ]
  },
  programVersions: [{ program_version_id: 42, version_code: 'IA-CZ-03' }],
  editionsByCode: new Map([['ia-cz-03|e31', { program_edition_id: 500, program_version_id: 42 }]]),
  membershipByName: new Map([['we black', 900], ['we gold', 901]]),
  agentsByAlias: new Map([['ae30', 7], ['jp39', 8]]),
  // edicion 500 es padre: aulas hijas 600 (curso 60) y 601 (curso 61).
  childEditionsByParent: new Map([[500, [{ edition_id: 600, version_id: 60 }, { edition_id: 601, version_id: 61 }]]]),
  currencyByAlias: new Map([['we_currency_soles', 3041], ['we_currency_dollars', 3042]]),
  bankAccounts: [
    { account_id: 1, business_entity_catalog_id: 3212, bank_name: 'BCP', currency: 'PEN' },
    { account_id: 2, business_entity_catalog_id: 3212, bank_name: 'BCP', currency: 'USD' },
    { account_id: 6, business_entity_catalog_id: 3213, bank_name: 'BCP', currency: 'PEN' },
    { account_id: 9, business_entity_catalog_id: 3213, bank_name: 'INTERBANK', currency: 'PEN' }
  ]
}
const baseRaw = { full_name: 'PEREZ GOMEZ JUAN', edition: 'E0', course_code: 'IA-CZ-03' }

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

  it('ENTIDAD EMPRESA por abreviatura de alias (WEC) -> cat_business_entity', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow({ ...base, business_entity: 'WEC' }, ctx)
    expect(data.cat_business_entity).toBe(3212)
  })

  it('ENTIDAD FINANCIERA "BCP" + empresa WEC + USD -> cuenta unica', async () => {
    const { data } = await enrollmentFicoImporter.resolveRow(
      { ...base, financial_entity: 'BCP', business_entity: 'WEC', currency: 'USD' }, ctx)
    expect(data.bank_account_id).toBe(2)
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
})
