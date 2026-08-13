// Verifica fn_client_moment contra la BD real, con datos de juguete que se
// crean y se borran dentro de una transaccion que SIEMPRE hace ROLLBACK.
//
//   node scripts/test-fn-client-moment.mjs
import assert from 'node:assert/strict'
import { pool } from './db.mjs'

const NUEVO = 3048, LEAD = 3047, COMUNIDAD = 3049
const TEL = '900000001'   // inexistente en produccion; igual se revierte todo

const cx = await pool.connect()
await cx.query('BEGIN')

const momento = async (chosen = null, at = 'LOCALTIMESTAMP') =>
  Number((await cx.query(
    `SELECT public.fn_client_moment($1, $2, ${at}) AS m`, [TEL, chosen])).rows[0].m)

// leads y enrollments tienen ~10 columnas NOT NULL sin default cada una. En vez
// de inventarlas, se clona una fila real y se pisan solo los campos de la regla.
const clonar = async (tabla, pk, cambios) => {
  const { rows: [fila] } = await cx.query(
    `INSERT INTO public.${tabla}
     SELECT (jsonb_populate_record(NULL::public.${tabla},
               to_jsonb(t) || jsonb_build_object('${pk}', (SELECT MAX(${pk}) + 1 FROM public.${tabla}))
                           || $1::jsonb)).*
       FROM public.${tabla} t WHERE t.${pk} = (SELECT MIN(${pk}) FROM public.${tabla})
     RETURNING ${pk}`, [JSON.stringify(cambios)])
  return fila[pk]
}

try {
  // ── Sin rastro: NUEVO ──────────────────────────────────────────────────────
  assert.equal(await momento(), NUEVO, 'telefono virgen debe ser NUEVO')

  // ── El asesor puede subir el piso (compra de 2023 nunca importada) ─────────
  assert.equal(await momento(COMUNIDAD), COMUNIDAD, 'el asesor puede subir a COMUNIDAD')
  assert.equal(await momento(LEAD), LEAD, 'el asesor puede subir a LEAD')

  // ── Una consulta previa: LEAD, aunque el asesor insista en NUEVO ───────────
  const hace = (dias) => new Date(Date.now() - dias * 864e5).toISOString().slice(0, 19)
  const leadId = await clonar('leads', 'lead_id',
    { origin_phone: TEL, registration_date: hace(30), enrollment_id: null, active: 'Y' })

  assert.equal(await momento(), LEAD, 'con consulta previa debe ser LEAD')
  assert.equal(await momento(NUEVO), LEAD, 'el asesor NO puede bajar de LEAD a NUEVO')
  assert.equal(await momento(COMUNIDAD), COMUNIDAD, 'sobre LEAD el asesor todavia puede subir')

  // ── La consulta que se esta clasificando no se cuenta a si misma ───────────
  assert.equal(
    await momento(null, `LOCALTIMESTAMP - INTERVAL '60 days'`), NUEVO,
    'una consulta posterior no puede volver LEAD a una anterior')

  // ── Con venta previa: COMUNIDAD ───────────────────────────────────────────
  const enrollmentId = await clonar('enrollments', 'enrollment_id',
    { registration_date: hace(20), active: 'Y' })
  await cx.query('UPDATE public.leads SET enrollment_id = $1 WHERE lead_id = $2',
    [enrollmentId, leadId])

  assert.equal(await momento(), COMUNIDAD, 'con venta previa debe ser COMUNIDAD')
  assert.equal(await momento(NUEVO), COMUNIDAD, 'el asesor NO puede bajar de COMUNIDAD')

  // ── La venta tampoco viaja al pasado ──────────────────────────────────────
  assert.equal(
    await momento(null, `LOCALTIMESTAMP - INTERVAL '25 days'`), LEAD,
    'una venta posterior no puede volver COMUNIDAD a una consulta anterior')

  console.log('OK: 10 aserciones')
} finally {
  await cx.query('ROLLBACK')
  cx.release()
  await pool.end()
}
