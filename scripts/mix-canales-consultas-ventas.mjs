// Reparto de CONSULTAS y de VENTAS entre los cuatro canales que usa la hoja
// "1. Plan 2027" (Mkt / Com / WEB / Otros), partido en mes alto y mes normal.
// Alimenta la tabla de supuestos con la que se reparte el objetivo de ventas.
//
// Reglas de negocio (Planeamiento, 11/09/2026):
//  - Mkt son las redes que compra y gestiona marketing; WEB es la compra directa
//    por la web; Com es el lead SIN canal, que es el que el asesor levanta por su
//    cuenta; el resto (chatbot, cotizador, WhatsApp suelto) cae en Otros.
//  - Mes alto = enero, febrero, marzo y julio, igual que el resto de la hoja.
//
// OJO con las ventas: se cuentan por leads.enrollment_id, que solo tiene el 59%
// de las ventas reales del periodo (2797 de 4758). Sirve para el REPARTO, que
// sale casi identico en mes alto y en mes normal, no para el total.
import { q, pool } from './db.mjs'

const CANAL = `CASE
    WHEN c.description IN ('Facebook','Instagram','LinkedIn','Estados','TikTok','YouTube') THEN 'Mkt'
    WHEN c.description = 'WEB' THEN 'WEB'
    WHEN c.description IS NULL OR c.description = '-' THEN 'Com'
    ELSE 'Otros' END`

const { rows } = await q(`
  SELECT ${CANAL} canal,
         CASE WHEN EXTRACT(month FROM l.registration_date) IN (1,2,3,7) THEN 'ALTO' ELSE 'NORMAL' END temporalidad,
         COUNT(*)::int consultas,
         COUNT(l.enrollment_id)::int ventas
  FROM leads l LEFT JOIN catalog c ON c.catalog_id = l.cat_channel
  WHERE l.registration_date >= '2026-01-01' AND l.registration_date < '2026-09-01'
  GROUP BY 1, 2`)

const porcentaje = (parte, total) => `${(100 * parte / total).toFixed(1)}%`

console.log('TEMPORALIDAD;CANAL;CONSULTAS;% CONSULTAS;VENTAS;% VENTAS;CONVERSION')
for (const temporalidad of ['ALTO', 'NORMAL']) {
  const delMes = rows.filter(r => r.temporalidad === temporalidad)
  const consultas = delMes.reduce((a, r) => a + r.consultas, 0)
  const ventas = delMes.reduce((a, r) => a + r.ventas, 0)
  for (const canal of ['Mkt', 'Com', 'WEB', 'Otros']) {
    const r = delMes.find(x => x.canal === canal)
    console.log([temporalidad, canal, r.consultas, porcentaje(r.consultas, consultas),
      r.ventas, porcentaje(r.ventas, ventas), porcentaje(r.ventas, r.consultas)].join(';'))
  }
}
await pool.end()
