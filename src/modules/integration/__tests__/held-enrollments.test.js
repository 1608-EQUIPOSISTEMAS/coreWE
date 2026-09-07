import { describe, it, expect } from 'vitest'
import {
  HELD_ENROLLMENT_IDS,
  EXCLUDE_HELD,
  integrationRepository
} from '../integration.repository.js'

// El SQL no se puede correr sin BD, pero si leer, pasandole un `db` falso que
// solo guarda la query (mismo truco que eventos-sheet.test.js).
const captureSql = (metodo) => {
  let sql = ''
  const repo = Object.create(Object.getPrototypeOf(integrationRepository))
  Object.assign(repo, integrationRepository)
  repo.db = { query: (text) => { sql = text; return { rows: [] } } }
  repo[metodo]()
  return sql
}

// Las ordenes de pago del flujo antiguo no deben llegar a las hojas hasta que
// el alumno pague. Si el predicado deja de nombrar un id o la lista se vacia
// generando SQL invalido, estas ventas sin cobrar aparecerian en el Sheet.
describe('EXCLUDE_HELD', () => {
  it('nombra a cada inscripcion retenida y tambien a sus hijas', () => {
    for (const id of HELD_ENROLLMENT_IDS) expect(EXCLUDE_HELD).toContain(String(id))
    expect(EXCLUDE_HELD).toContain('e.enrollment_id NOT IN')
    expect(EXCLUDE_HELD).toContain('COALESCE(e.parent_enrollment_id, 0) NOT IN')
  })

  it('nunca produce un NOT IN () vacio', () => {
    expect(EXCLUDE_HELD).not.toContain('IN ()')
  })
})

// El limbo de una OS/OP -- aprobada por FICO, cobrada semanas despues -- ya no
// se representa escondiendo la fila. Si alguien reintroduce un filtro por
// doctype, el asesor vuelve a perder su venta de "0. Ventas Sistemas" y el
// alumno vuelve a caerse del aula, sin que nada avise.
describe('OS/OP sin cobrar', () => {
  const HOJAS = [
    'getFicoSales', 'getFicoAula', 'getFicoConsolidado',
    'getFicoCuotas', 'getFicoEventos', 'getFicoMembresias', 'getFicoConvenios'
  ]

  it('ninguna hoja la esconde por tipo de documento', () => {
    for (const hoja of HOJAS) expect(captureSql(hoja)).not.toContain('c_doc.alias IN')
  })

  it('toda hoja sigue respetando la retencion manual', () => {
    for (const hoja of HOJAS) expect(captureSql(hoja)).toContain('e.enrollment_id NOT IN')
  })

  // Lo que sostiene todo lo anterior: si INICIAL volviera a leer el monto de la
  // cuota sin mirar el cobro, la OS entraria declarando plata que no existe --
  // que es justo el motivo por el que antes se la escondia.
  it('INICIAL cuenta lo cobrado, no el monto pactado de la cuota', () => {
    for (const hoja of ['getFicoSales', 'getFicoConsolidado', 'getFicoEventos']) {
      const sql = captureSql(hoja)
      expect(sql).toContain('WHEN pi_res.pagada THEN pi_res.amount ELSE 0')
      expect(sql).not.toContain('COALESCE(pi_pt.amount, e.total_amount)')
    }
  })
})
