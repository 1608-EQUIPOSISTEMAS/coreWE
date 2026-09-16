// Verificacion end-to-end del fix de RP en las 6 hojas FICO: corre cada query
// real contra produccion y comprueba que la venta reprogramada salga UNA vez y
// con el precio del origen.
//
// Caso testigo MIGUEL BELLIDO ONTON: #18939 (origen RP, 250 pactados, 100
// cobrados) -> #18956 (destino, edicion 14/11). Antes del fix eran dos filas
// (100 y 150) y el destino salia como BECA/Saldado en Consolidado y Aula.
//
// Ojo pools partidos: el repo usa src/config/db.js, que lee DATABASE_URL. Hay
// que exportarla apuntando a produccion, nunca PGPASSWORD.
import { integrationRepository } from '../src/modules/integration/integration.repository.js'
import { pool } from '../src/config/db.js'

const HOJAS = [
  'getFicoSales', 'getFicoConvenios', 'getFicoAula',
  'getFicoEventos', 'getFicoConsolidado', 'getFicoCuotas'
]

// Los tres alumnos con RP que este trabajo toco.
const TESTIGOS = ['BELLIDO', 'VALER', 'NAHUAMAN']

const nombreDe = (f) =>
  `${f.nombres || ''} ${f.apellidos || ''}`.toUpperCase().trim()

const { rows: [{ db }] } = await pool.query('SELECT current_database() AS db')
console.log('BD:', db, '\n')

for (const hoja of HOJAS) {
  let filas
  try {
    filas = await integrationRepository[hoja]()
  } catch (err) {
    console.error(`\n!! ${hoja} REVENTO: ${err.message}\n`)
    continue
  }

  console.log(`\n===== ${hoja}: ${filas.length} filas =====`)

  for (const quien of TESTIGOS) {
    const suyas = filas.filter((f) => nombreDe(f).includes(quien))
    if (!suyas.length) continue
    console.log(`  ${quien}: ${suyas.length} fila(s)`)
    for (const f of suyas) {
      // Cada hoja nombra distinto sus columnas de plata; mostramos las que haya.
      const plata = ['monto', 'inicial', 'ingreso', 'saldo', 'pago_efectuado', 'estado', 'status_pago', 'al_dia', 'estado_alumno', 'dsct']
        .filter((k) => f[k] !== undefined && f[k] !== '')
        .map((k) => `${k}=${f[k]}`)
        .join('  ')
      console.log(`     ${f.ed || f.f_programa || ''} ${f.f_inicio || ''} | ${plata}`)
    }
  }

  // Una RP colapsada no debe dejar al alumno dos veces en la misma hoja.
  const porAlumno = new Map()
  for (const f of filas) {
    const k = `${nombreDe(f)}|${f.cod || f.nombre_p || f.curso || ''}`
    porAlumno.set(k, (porAlumno.get(k) || 0) + 1)
  }
  const repetidos = [...porAlumno.entries()].filter(([, n]) => n > 1)
  console.log(`  alumno+programa repetidos: ${repetidos.length}`)
  for (const [k, n] of repetidos.slice(0, 8)) console.log(`     ${n}x  ${k}`)
}

await pool.end()
