// Reestablece leads.cat_client_moment segun public.fn_client_moment.
//
// Foto historica: cada lead se reclasifica con lo que se sabia EL DIA en que se
// registro (por eso pasa su registration_date), no con lo que se sabe hoy. Asi el
// embudo de un mes cerrado no se reescribe cuando la persona compra despues.
//
// La funcion aplica el piso: solo SUBE (NUEVO->LEAD->COMUNIDAD). Un lead que hoy
// esta mas alto de lo que la data prueba se queda como esta: es el asesor que
// sabe de una compra vieja que nunca se importo.
//
//   node scripts/backfill-client-moment.mjs --dry   # muestra el resumen, no guarda
//   node scripts/backfill-client-moment.mjs         # aplica
import { q, pool } from './db.mjs'

const soloVerDiff = process.argv.includes('--dry')
const LOTE = 2000   // el tunel SSH se cae seguido: lotes cortos y reanudables

const NOMBRE = { 3047: 'LEAD', 3048: 'NUEVO', 3049: 'COMUNIDAD' }

// Se materializa el calculo primero para poder mostrar el diff antes de tocar
// nada, y para que el UPDATE sea un simple join (el tunel no aguanta 30k llamadas).
await q(`
  CREATE TEMP TABLE recalculo AS
  SELECT lead_id,
         cat_client_moment AS antes,
         public.fn_client_moment(origin_phone, cat_client_moment, registration_date) AS despues
    FROM public.leads`)

const { rows: diff } = await q(`
  SELECT antes, despues, count(*)::int AS filas
    FROM recalculo WHERE antes IS DISTINCT FROM despues
   GROUP BY 1, 2 ORDER BY 3 DESC`)

if (diff.length === 0) {
  console.log('Nada que corregir: todos los leads ya cumplen la regla.')
  await pool.end()
  process.exit(0)
}

console.table(diff.map(d => ({
  antes: NOMBRE[d.antes] ?? '(vacio)',
  despues: NOMBRE[d.despues] ?? '(vacio)',
  filas: d.filas
})))
const total = diff.reduce((s, d) => s + d.filas, 0)
console.log(`Total a corregir: ${total}`)

// Guarda es una red, no una formalidad: si el calculo alguna vez bajara un
// momento, seria un bug de la funcion y no se puede escribir en produccion.
const { rows: [{ bajadas }] } = await q(`
  SELECT count(*)::int AS bajadas FROM recalculo
   WHERE public.fn_client_moment_rank(despues) < public.fn_client_moment_rank(antes)`)
if (bajadas > 0) throw new Error(`${bajadas} leads bajarian de momento; fn_client_moment esta mal`)

if (soloVerDiff) {
  console.log('\n(--dry: no se guardo nada)')
  await pool.end()
  process.exit(0)
}

let corregidos = 0
for (;;) {
  const { rowCount } = await q(`
    UPDATE public.leads l
       SET cat_client_moment = r.despues
      FROM (SELECT lead_id, despues FROM recalculo
             WHERE antes IS DISTINCT FROM despues
             ORDER BY lead_id LIMIT ${LOTE} OFFSET ${corregidos}) r
     WHERE l.lead_id = r.lead_id
       AND l.cat_client_moment IS DISTINCT FROM r.despues`)
  if (rowCount === 0) break
  corregidos += rowCount
  console.log(`  ${corregidos}/${total}`)
}

console.log(`Listo: ${corregidos} leads corregidos.`)
await pool.end()
