import { describe, it, expect } from 'vitest'
import { IntegrationRepository, NOT_FICO_OPERATOR } from '../integration.repository.js'

// El panel FICO resuelve el AGENTE con una cascada: alias de quien solicito el
// PRIMER token de pago > alias del seller_agent_id. En una venta por token el
// seller es quien genero el link (FICO/admin), no el comercial que la cerro.
// Toda hoja que publique la columna ASESOR tiene que decir lo mismo que el ERP:
// "7. Convenios" nacio sin el LATERAL y mostraba 'B2B - ELFI' donde el panel
// mostraba 'B2B - JF39' (enrollment 18141).
const HOJAS_CON_ASESOR = [
  ['0. Ventas Sistemas', 'getFicoSales'],
  ['7. Convenios', 'getFicoConvenios'],
  ['3. Aula', 'getFicoAula'],
  ['Consolidado', 'getFicoConsolidado'],
  ['Cuotas', 'getFicoCuotas']
]

const sqlDe = async (metodo) => {
  let sql = ''
  const db = { query: (texto) => { sql = texto; return { rows: [] } } }
  await new IntegrationRepository(db)[metodo]()
  return sql
}

describe('columna ASESOR del sync FICO', () => {
  it.each(HOJAS_CON_ASESOR)('"%s" prioriza al asesor del token', async (_hoja, metodo) => {
    const sql = await sqlDe(metodo)
    expect(sql).toContain('public.payment_tokens pt')
    expect(sql).toContain('COALESCE(pt.requested_by, pt.created_by)')
    expect(sql).toContain('COALESCE(ag_token.alias, u.alias)')
  })
})

describe('NOT_FICO_OPERATOR', () => {
  // La regla mira el rol, no una lista de alias: un operador FICO nuevo queda
  // cubierto sin tocar codigo. Si alguien agrega un rol a la exclusion sin
  // pensarlo, este test lo obliga a mirar aqui.
  it('silencia solo a los roles que no venden', () => {
    const sql = NOT_FICO_OPERATOR('u')
    expect(sql).toContain("r.alias NOT IN ('FICO', 'LIDER_FICO')")
    expect(sql).toContain('public.user_roles')
  })

  it('es fail-open: un usuario sin ningun rol conserva su alias', () => {
    expect(NOT_FICO_OPERATOR('u')).toContain('NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.user_id)')
  })

  it('se aplica al seller Y al solicitante del token de "7. Convenios"', async () => {
    const sql = await sqlDe('getFicoConvenios')
    expect(sql).toContain(NOT_FICO_OPERATOR('u'))
    expect(sql).toContain(NOT_FICO_OPERATOR('u_pt'))
  })
})
