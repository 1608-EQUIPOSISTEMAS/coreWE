import { describe, it, expect } from 'vitest'
import { ComercialRepository } from '../comercial.repository.js'

// El asesor de convenios que registra la venta el mismo (sin token) con el lead
// en "profesional" la dejaba sin marca B2B: fuera de "7. Convenios" (23080).
const registrar = async (spResult) => {
  const llamadas = []
  const db = { query: (sql, params) => { llamadas.push({ sql, params }); return { rows: [] } } }
  const repo = new ComercialRepository(db, async () => [spResult])
  await repo.enrollmentRegister(436953, 38, { inscription: {} })
  return llamadas.filter(l => l.sql.includes("SET agent_origin = 'B2B'"))
}

describe('enrollmentRegister marca B2B por el rol de quien registra', () => {
  it('marca la venta recien creada con el usuario que la registro', async () => {
    const [stamp] = await registrar({ result: 1, enrollment_id: 23080 })
    expect(stamp.params).toEqual([23080, 38])
  })

  it('no marca nada si el SP rechazo el alta', async () => {
    expect(await registrar({ result: 0, enrollment_id: null })).toHaveLength(0)
  })
})
