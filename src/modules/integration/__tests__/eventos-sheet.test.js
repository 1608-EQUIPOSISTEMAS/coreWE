import { describe, it, expect } from 'vitest'
import { buildEventosRow, EVENTOS_HEADER_ROW } from '../integration.entity.js'
import { integrationRepository } from '../integration.repository.js'

// Mismo truco que membresias-sheet.test.js: el SQL no se puede correr sin BD,
// pero si leer, pasandole un `db` falso que solo guarda la query.
const captureEventosSql = () => {
  let sql = ''
  const repo = Object.create(Object.getPrototypeOf(integrationRepository))
  Object.assign(repo, integrationRepository)
  repo.db = { query: (text) => { sql = text; return { rows: [] } } }
  repo.getFicoEventos()
  return sql
}

const fila = {
  f_pago: '03/08/2026', dni: '45678912', nombres: 'ANA', apellidos: 'PEREZ LOPEZ',
  celular: '999888777', correo: 'ana@we.pe', ocup: 'P', estado: 'PT',
  dsct: '20,00%', inicial: '240,00', saldo: '0,00', ingreso: '240,00',
  modalidad: 'VIP', asiento: '24', cod: 'CO-CE-01', status_deuda: 'NO DEBE'
}

describe('hoja "4. Ventas Eventos"', () => {
  it('la fila sale en el mismo orden que su cabecera', () => {
    const row = buildEventosRow(fila)
    expect(row).toHaveLength(EVENTOS_HEADER_ROW.length)
    expect(row).toEqual([
      '03/08/2026', '45678912', 'ANA', 'PEREZ LOPEZ', '999888777', 'ana@we.pe',
      'P', 'PT', '20,00%', '240,00', '0,00', '240,00', 'VIP', '24', 'CO-CE-01',
      'NO DEBE'
    ])
  })

  it('una fila incompleta no desplaza columnas: los huecos van vacios', () => {
    expect(buildEventosRow({ nombres: 'ANA' }))
      .toEqual(['', '', 'ANA', '', '', '', '', '', '', '', '', '', '', '', '', ''])
  })

  // Misma regla que las otras hojas con importe por alumno.
  it('los alumnos de monto-cero suben con importe 0', () => {
    const row = buildEventosRow({ ...fila, correo: 'wchambi@bancoripley.com.pe' })
    expect(row.slice(8, 12)).toEqual([0, 0, 0, 0])
  })

  // STATUS es de cobranza: con saldo pendiente DEBE, y con beca o pago
  // completo NO DEBE. El de monto-cero nunca debe, aunque el SQL diga otra cosa.
  it('STATUS sale de la deuda que calculo el SQL', () => {
    expect(buildEventosRow({ ...fila, status_deuda: 'DEBE' }).at(-1)).toBe('DEBE')
    expect(buildEventosRow({ ...fila, status_deuda: 'DEBE', correo: 'wchambi@bancoripley.com.pe' }).at(-1))
      .toBe('NO DEBE')
  })

  it('una beca y una entrada saldada no deben; una con saldo si', () => {
    const sql = captureEventosSql()
    expect(sql).toContain("WHEN (e.total_amount) = 0 THEN 'NO DEBE'")
    expect(sql).toContain("COALESCE(pay_agg.total_paid, 0)) > 0 THEN 'DEBE'")
    expect(sql).toContain('AS status_deuda')
  })

  it('solo trae inscripciones de evento, por categoria de entrada o por tipo de programa', () => {
    const sql = captureEventosSql()
    expect(sql).toContain('e.cat_event_category IS NOT NULL')
    expect(sql).toContain("c_type_ev.alias = 'we_program_type_event'")
  })

  it('hereda los filtros del sync FICO: confirmadas, sin importacion masiva ni corte viejo', () => {
    const sql = captureEventosSql()
    expect(sql).toContain("cf.alias = 'we_enrollment_status_checked'")
    expect(sql).toContain('masiva FICO')
    expect(sql).toMatch(/>= DATE '\d{4}-\d{2}-\d{2}'/)
  })

  // La hoja pide NOMBRES y APELLIDOS en columnas distintas; el resto de hojas
  // FICO los manda concatenados y copiar de ahi dejaria APELLIDOS vacio.
  it('separa nombres de apellidos', () => {
    const sql = captureEventosSql()
    expect(sql).toContain('AS nombres')
    expect(sql).toContain('AS apellidos')
    expect(sql).not.toContain("concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)")
  })

  // La hoja llevaba las columnas de la venta pero no el codigo del programa,
  // que es el cruce con el resto de hojas FICO.
  it('trae el codigo del programa de la venta', () => {
    const sql = captureEventosSql()
    expect(sql).toContain('pv.version_code')
    expect(sql).toContain('public.program_versions pv ON pv.program_version_id = e.program_version_id')
  })
})
