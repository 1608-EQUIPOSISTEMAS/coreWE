// Verificacion end-to-end del fix de RP en la hoja "7. Convenios": corre la
// query real contra produccion y muestra como sale la venta reprogramada.
//
// Esperado para MIGUEL BELLIDO ONTON (#18939 origen -> #18956 destino):
//   UNA sola fila, MONTO 250, PAGO EFECTUADO 100, EMPRESA DINET, F.PAGO 14/09.
// Antes del fix eran dos: 100 con DINET y 150 sin empresa ni fecha.
//
// Ojo pools partidos: el repo usa src/config/db.js, que lee DATABASE_URL. Hay
// que exportarla apuntando a produccion (ver README de scripts), nunca PGPASSWORD.
import { integrationRepository } from '../src/modules/integration/integration.repository.js'
import { pool } from '../src/config/db.js'

const BUSCADOS = ['BELLIDO', 'VALER', 'NAHUAMAN']

const { rows: [{ db }] } = await pool.query('SELECT current_database() AS db')
console.log('BD:', db, '\n')

const filas = await integrationRepository.getFicoConvenios()
console.log('filas totales en la hoja:', filas.length, '\n')

for (const quien of BUSCADOS) {
  const suyas = filas.filter((f) => (f.nombres || '').toUpperCase().includes(quien))
  console.log(`== ${quien}: ${suyas.length} fila(s) ==`)
  if (suyas.length) {
    console.table(suyas.map((f) => ({
      fecha: f.fecha,
      empresa: f.empresa,
      nombres: f.nombres,
      programa: f.nombre_p,
      f_programa: f.f_programa,
      f_pago: f.f_pago,
      monto: f.monto,
      pagado: f.pago_efectuado,
      tipo: f.tipo_pago,
      asesor: f.asesor
    })))
  }
}

// Red de seguridad: ningun alumno deberia aparecer dos veces en la hoja.
const porAlumno = new Map()
for (const f of filas) {
  const k = `${f.nombres}|${f.nombre_p}`
  porAlumno.set(k, (porAlumno.get(k) || 0) + 1)
}
const repetidos = [...porAlumno.entries()].filter(([, n]) => n > 1)
console.log(`\nalumno+programa repetidos en la hoja: ${repetidos.length}`)
for (const [k, n] of repetidos.slice(0, 15)) console.log(`  ${n}x  ${k}`)

await pool.end()
