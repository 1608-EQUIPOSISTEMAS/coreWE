import { describe, it, expect } from 'vitest'
import Ajv from 'ajv'
import { leadRegisterSchema, leadUpdateSchema } from '../comercial.schemas.js'

// Fastify valida el body con removeAdditional: true. Combinado con el
// additionalProperties: false del objeto `lead`, cualquier campo que no este
// declarado en el schema se BORRA en silencio: la request responde 200 y el
// dato nunca llega al SP. Asi se perdio la empresa del convenio en los 32.433
// leads, sin un solo error en los logs.
const validador = (schema) => new Ajv({ removeAdditional: true, allowUnionTypes: true, coerceTypes: true })
  .compile(schema.body)

const leadBase = { origin_phone: '900000000', b2b: 'Y', company_id: 967 }

describe('company_id sobrevive a la validacion del body', () => {
  it('leadRegisterSchema no borra la empresa del convenio', () => {
    const body = { user_id: 2, lead: { ...leadBase } }
    expect(validador(leadRegisterSchema)(body)).toBe(true)
    expect(body.lead.company_id).toBe(967)
  })

  it('leadUpdateSchema no borra la empresa del convenio', () => {
    const body = { id: 1, user_id: 2, lead: { ...leadBase } }
    expect(validador(leadUpdateSchema)(body)).toBe(true)
    expect(body.lead.company_id).toBe(967)
  })

  // Desvincular la empresa tiene que poder viajar: el SP distingue "no vino la
  // clave" (deja la empresa) de "vino en null" (la borra).
  it('deja pasar company_id en null para desvincular', () => {
    const body = { user_id: 2, lead: { ...leadBase, company_id: null } }
    expect(validador(leadRegisterSchema)(body)).toBe(true)
    expect(body.lead).toHaveProperty('company_id', null)
  })
})
