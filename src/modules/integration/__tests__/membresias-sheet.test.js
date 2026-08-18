import { describe, it, expect } from 'vitest'
import { buildMembresiasRow, MEMBRESIAS_HEADER_ROW } from '../integration.entity.js'
import { integrationRepository } from '../integration.repository.js'

// El SQL de getFicoMembresias no se puede correr sin BD, pero si se puede leer:
// capturamos el texto pasandole un `db` falso que solo guarda la query.
const captureMembresiasSql = () => {
  let sql = ''
  const repo = Object.create(Object.getPrototypeOf(integrationRepository))
  Object.assign(repo, integrationRepository)
  repo.db = { query: (text) => { sql = text; return { rows: [] } } }
  repo.getFicoMembresias()
  return sql
}

describe('hoja "5. Membresias"', () => {
  it('la fila sale en el mismo orden que su cabecera', () => {
    const row = buildMembresiasRow({
      nombres: 'ANA', apellidos: 'PEREZ LOPEZ', celular: '999888777',
      correo: 'ana@we.pe', membresia: 'WE GOLD', vencimiento: '15/08/2027'
    })
    expect(row).toHaveLength(MEMBRESIAS_HEADER_ROW.length)
    expect(row).toEqual(['ANA', 'PEREZ LOPEZ', '999888777', 'ana@we.pe', 'WE GOLD', '15/08/2027'])
  })

  it('una fila incompleta no desplaza columnas: los huecos van vacios', () => {
    expect(buildMembresiasRow({ nombres: 'ANA' }))
      .toEqual(['ANA', '', '', '', '', ''])
  })

  it('el vencimiento es un anio despues del arranque del beneficio', () => {
    expect(captureMembresiasSql()).toContain("INTERVAL '1 year'")
  })

  it('la activacion diferida gana sobre la F. PAGO al fijar el arranque', () => {
    const sql = captureMembresiasSql()
    const activacion = sql.indexOf('e.membership_activation_date')
    const payDate = sql.indexOf('l.pay_date')
    expect(activacion).toBeGreaterThan(-1)
    expect(activacion).toBeLessThan(payDate)
  })

  it('solo lista membresias confirmadas y vigentes', () => {
    const sql = captureMembresiasSql()
    expect(sql).toContain('prog.is_membership = true')
    expect(sql).toContain("cf.alias = 'we_enrollment_status_checked'")
    expect(sql).toContain("e.active = 'Y'")
  })

  // A diferencia de las demas hojas FICO: la mitad de las membresias entro por
  // la importacion masiva y un tercio es anterior al corte del sync, y todas
  // siguen dando beneficio. Si alguien copia los filtros de las otras queries,
  // la hoja se queda a medias sin que nada mas falle.
  it('no hereda los filtros de importacion masiva ni el corte temporal', () => {
    const sql = captureMembresiasSql()
    expect(sql).not.toContain('masiva FICO')
    expect(sql).not.toContain('SYNC_FROM_DATE')
    expect(sql).not.toMatch(/>= DATE '\d{4}-\d{2}-\d{2}'/)
  })
})
