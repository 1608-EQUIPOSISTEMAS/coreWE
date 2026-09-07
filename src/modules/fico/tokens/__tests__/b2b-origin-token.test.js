import { describe, it, expect } from 'vitest'
import { TokenRepository } from '../token.repository.js'

// Una venta por token que pidio un asesor de convenios tiene que quedar marcada
// como B2B: el SP no lo hace (saca agent_origin de la situacion del lead y toma
// como vendedor al operador FICO que confirma). Sin la marca la venta no entra a
// la hoja "7. Convenios" y el cronograma la cuenta como VENTAS (18534).
const ejecutar = async (args) => {
  const llamadas = []
  const db = { query: (sql, params) => { llamadas.push({ sql, params }); return { rows: [] } } }
  await new TokenRepository(db).stampB2bOriginFromAdvisor(args)
  return llamadas
}

describe('stampB2bOriginFromAdvisor', () => {
  it('marca la venta como B2B por el ROL de quien pidio el token', async () => {
    const [{ sql, params }] = await ejecutar({ enrollmentId: 18534, userId: 38 })
    expect(params).toEqual([18534, 38])
    expect(sql).toContain("SET agent_origin = 'B2B'")
    expect(sql).toContain("r.alias IN ('B2B', 'LIDER_B2B')")
  })

  // Fail-safe: la marca solo RELLENA el hueco. Si pisara el origen, un asesor
  // B2B que pide el token de una venta WEB/Fundacion le cambiaria el canal.
  it('no pisa un agent_origin ya escrito', async () => {
    const [{ sql }] = await ejecutar({ enrollmentId: 18534, userId: 38 })
    expect(sql).toContain('agent_origin IS NULL')
  })

  it('no toca la BD sin inscripcion o sin asesor', async () => {
    expect(await ejecutar({ enrollmentId: null, userId: 38 })).toHaveLength(0)
    expect(await ejecutar({ enrollmentId: 18534, userId: null })).toHaveLength(0)
  })
})
