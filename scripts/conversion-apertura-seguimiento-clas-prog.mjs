// Ventas, consultas y conversion de "2. Clas. prog." partidas en Apertura /
// Seguimiento x mes Alto / Normal (bloques K:N, O:R, S:V). Pedido de Planeamiento,
// 15/09/2026: "las conversiones, pero segun temporalidad y si es apertura o seguimiento".
//
// Reglas:
//  - Apertura o seguimiento es propiedad de la EDICION, no de la venta: la decide
//    el mismo clasificador del Plan 2027 (SEGUI >= 3 y no paquete). Por eso venta y
//    consulta se cuelgan de su edicion (99,3% y 99,2% la tienen; el resto se reporta).
//  - La temporalidad es el mes de INICIO de la edicion, igual que la programacion
//    del Plan. Ventas y consultas usan la misma edicion: si no, la conversion de una
//    celda dividiria ventas de unas ediciones entre consultas de otras.
//  - Universos identicos a las columnas C y H (primer pago / leads en los 5 estados,
//    ene-ago, sin Online) y el programa sale de la version, agrupado sin " V<n>".
//  - G y H pasan a ser =SUMA de sus cuatro celdas: cuadran por construccion. Antes
//    eran valores pegados, y quedaron desalineados de B cuando se reordeno la hoja.
//
//   cd Backend && node scripts/programas-paquete-produccion.mjs 2026 12 <paquetes.json>
//   cd Backend && node scripts/conversion-apertura-seguimiento-clas-prog.mjs <paquetes.json> [--dry]
import fs from 'node:fs'
import assert from 'node:assert/strict'
import pg from 'pg'
import { EditionRepository, LEAD_STATUSES_CONSULTA } from '../src/modules/edition/edition.repository.js'
import { integrationRepository as repo } from '../src/modules/integration/integration.repository.js'
import { crearClasificador, nombreDelPrograma, temporalidad } from './lib/clasificacion-ediciones.mjs'

const LIBRO = '1F1yhj280zbnwhoxcR9fJeO5_Aqo0b7kHz3Bix31FbJk'
const HOJA_ID = 1623103124
const PRIMERA_FILA = 7
const MODALIDAD_ONLINE = 2623
const CELDAS = ['APE_ALTA', 'APE_NORMAL', 'SEG_ALTA', 'SEG_NORMAL'] // orden de K:N, O:R, S:V

const [RUTA_PAQUETES] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const clasificar = crearClasificador(JSON.parse(fs.readFileSync(RUTA_PAQUETES, 'utf8')))

// El curso que se clasifica es el PROGRAMA vendido/consultado, no el de la edicion:
// el lead de un paquete cuelga de la edicion de su primer modulo (ESP. EN PYTHON ->
// PYTHON. DATOS, 538 consultas) y ese SEGUI lo volvia seguimiento. De la edicion
// solo se toman su SEGUI y su mes de inicio.
export const celdaDeEdicion = (edicion, programa, clasificador) => {
  const fila = { curso: programa, inicio: edicion.inicio, segui: edicion.segui }
  return `${clasificador(fila) === 'SEGUIMIENTO' ? 'SEG' : 'APE'}_${temporalidad(fila)}`
}

export function acumular (filas, celdaDe) {
  const porPrograma = new Map()
  const sinEdicion = []
  for (const { programa, edicion, n } of filas) {
    const celda = celdaDe(edicion, programa)
    if (!celda) { sinEdicion.push({ programa, n }); continue }
    const clave = nombreDelPrograma(programa)
    const cuenta = porPrograma.get(clave) ?? Object.fromEntries(CELDAS.map(c => [c, 0]))
    cuenta[celda] += n
    porPrograma.set(clave, cuenta)
  }
  return { porPrograma, sinEdicion }
}

{
  const clas = crearClasificador(['DIP X'])
  const ediciones = new Map([
    [1, { curso: 'CURSO V2', inicio: '2026-02-01', segui: 5 }],
    [2, { curso: 'CURSO', inicio: '2026-05-01', segui: 0 }],
    [3, { curso: 'DIP X', inicio: '2026-07-01', segui: 9 }]
  ])
  const celdaDe = (id, programa) => ediciones.has(id) ? celdaDeEdicion(ediciones.get(id), programa, clas) : null
  const { porPrograma, sinEdicion } = acumular([
    { programa: 'CURSO V2', edicion: 1, n: 4 },
    { programa: 'CURSO', edicion: 2, n: 3 },
    { programa: 'DIP X', edicion: 3, n: 2 },
    { programa: 'DIP X', edicion: 1, n: 7 },
    { programa: 'CURSO', edicion: null, n: 1 }
  ], celdaDe)
  assert.deepEqual(porPrograma.get('CURSO'), { APE_ALTA: 0, APE_NORMAL: 3, SEG_ALTA: 4, SEG_NORMAL: 0 }, 'versiones juntas, cada edicion a su celda')
  assert.equal(porPrograma.get('DIP X').APE_ALTA, 9, 'un paquete sigue siendo apertura, aunque cuelgue de la edicion de un modulo con SEGUI')
  assert.deepEqual(sinEdicion, [{ programa: 'CURSO', n: 1 }], 'sin edicion no se inventa celda')
}

async function conectarProduccion () {
  const url = fs.readFileSync('.env.bak-produccion', 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim()
  for (let intento = 1; ; intento++) {
    const cliente = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 })
    try { await cliente.connect(); return cliente } catch (error) {
      await cliente.end().catch(() => {})
      if (intento === 3) throw new Error(`tunel SSH caido tras 3 intentos: ${error.message}`)
    }
  }
}

const cliente = await conectarProduccion()
const { rows: ventas } = await cliente.query(`
  WITH primer_pago AS (
    SELECT DISTINCT ON (pa.enrollment_id) pa.enrollment_id, pa.payment_date
      FROM public.payments pa WHERE pa.active = 'Y'
     ORDER BY pa.enrollment_id, pa.payment_date, pa.payment_id
  )
  SELECT pv.abbreviation AS programa, e.program_edition_id AS edicion, COUNT(*)::int AS n
    FROM primer_pago pp
    JOIN public.enrollments e       ON e.enrollment_id = pp.enrollment_id
    JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    JOIN public.programs p          ON p.program_id = pv.program_id
   WHERE e.active = 'Y' AND p.cat_model_modality <> $1
     AND pp.payment_date >= '2026-01-01' AND pp.payment_date < '2026-09-01'
   GROUP BY 1, 2`, [MODALIDAD_ONLINE])
const { rows: consultas } = await cliente.query(`
  SELECT pv.abbreviation AS programa, l.program_edition_id AS edicion, COUNT(*)::int AS n
    FROM public.leads l
    JOIN public."catalog" cs        ON cs.catalog_id = l.cat_status_lead
    JOIN public.program_versions pv ON pv.program_version_id = l.program_version_id
    JOIN public.programs p          ON p.program_id = pv.program_id
   WHERE l.active = 'Y' AND cs.alias = ANY($1::text[]) AND p.cat_model_modality <> $2
     AND l.registration_date >= '2026-01-01' AND l.registration_date < '2026-09-01'
   GROUP BY 1, 2`, [LEAD_STATUSES_CONSULTA, MODALIDAD_ONLINE])

const ids = [...new Set([...ventas, ...consultas].map(f => f.edicion).filter(Boolean))]
const { rows: ediciones } = await cliente.query(`
  SELECT pe.edition_num_id AS id, to_char(pe.start_date, 'YYYY-MM-DD') AS inicio, pv.abbreviation AS curso
    FROM public.program_editions pe
    JOIN public.program_versions pv ON pv.program_version_id = pe.program_version_id
   WHERE pe.edition_num_id = ANY($1::int[])`, [ids])
const metricas = await new EditionRepository(cliente).classroomChannelMetricsList(ids)
await cliente.end()

const seguiPor = new Map(metricas.map(m => [Number(m.edition_num_id), m.cnt_segui ?? 0]))
const edicionPor = new Map(ediciones.filter(e => e.inicio).map(e =>
  [Number(e.id), { curso: e.curso, inicio: e.inicio, segui: seguiPor.get(Number(e.id)) ?? 0 }]))
const celdaDe = (id, programa) =>
  edicionPor.has(Number(id)) ? celdaDeEdicion(edicionPor.get(Number(id)), programa, clasificar) : null

const V = acumular(ventas, celdaDe)
const C = acumular(consultas, celdaDe)

const sheets = await repo.sheets()
const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: LIBRO })
const HOJA = meta.sheets.find(s => s.properties.sheetId === HOJA_ID).properties.title
const leer = async (rango, valueRenderOption = 'FORMATTED_VALUE') =>
  (await sheets.spreadsheets.values.get({ spreadsheetId: LIBRO, range: `'${HOJA}'!${rango}`, valueRenderOption })).data.values ?? []

const programas = (await leer(`B${PRIMERA_FILA}:B200`)).map(f => String(f[0] ?? '').trim())
const ULTIMA_FILA = PRIMERA_FILA + programas.findIndex(p => !p) - 1
const enHoja = programas.slice(0, ULTIMA_FILA - PRIMERA_FILA + 1)
const cero = Object.fromEntries(CELDAS.map(c => [c, 0]))

const filas = enHoja.map((programa, i) => {
  const fila = PRIMERA_FILA + i
  const v = V.porPrograma.get(programa) ?? cero
  const c = C.porPrograma.get(programa) ?? cero
  return [
    `=SUM(K${fila}:N${fila})`, `=SUM(O${fila}:R${fila})`, null, null,
    ...CELDAS.map(k => v[k]), ...CELDAS.map(k => c[k]),
    ...['K', 'L', 'M', 'N'].map((col, j) => `=IFERROR(${col}${fila}/${String.fromCharCode(79 + j)}${fila};"")`)
  ]
})

const suma = m => [...m.values()].reduce((a, x) => a + CELDAS.reduce((s, k) => s + x[k], 0), 0)
const fuera = m => [...m.keys()].filter(p => !enHoja.includes(p))
console.log(`${enHoja.length} programas (filas ${PRIMERA_FILA}-${ULTIMA_FILA}) | ventas ${suma(V.porPrograma)} | consultas ${suma(C.porPrograma)}`)
console.log(`sin edicion: ${V.sinEdicion.reduce((a, x) => a + x.n, 0)} ventas, ${C.sinEdicion.reduce((a, x) => a + x.n, 0)} consultas`)
console.log(`programas del ERP sin fila en la hoja: ${fuera(new Map([...V.porPrograma, ...C.porPrograma])).join(', ') || 'ninguno'}`)
console.log(`en la hoja sin datos del ERP: ${enHoja.filter(p => !V.porPrograma.has(p) && !C.porPrograma.has(p)).join(', ') || 'ninguno'}`)
if (process.argv.includes('--dry')) {
  filas.slice(0, 5).forEach((f, i) => console.log(`  ${enHoja[i]}: ventas ${f.slice(4, 8).join('/')} consultas ${f.slice(8, 12).join('/')}`))
  process.exit(0)
}

// G:H formulas, I intacta (ya divide G/H), J vacia, K:V bloque nuevo.
await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: LIBRO,
  requestBody: {
    valueInputOption: 'USER_ENTERED',
    data: [
      { range: `'${HOJA}'!G${PRIMERA_FILA}:H${ULTIMA_FILA}`, values: filas.map(f => f.slice(0, 2)) },
      { range: `'${HOJA}'!K${PRIMERA_FILA}:V${ULTIMA_FILA}`, values: filas.map(f => f.slice(4)) }
    ]
  }
})
// La conversion nueva lleva el mismo formato de % que la columna I.
const rango = (c0, c1) => ({ sheetId: HOJA_ID, startRowIndex: PRIMERA_FILA - 1, endRowIndex: ULTIMA_FILA, startColumnIndex: c0, endColumnIndex: c1 })
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: LIBRO,
  requestBody: { requests: [{ copyPaste: { source: rango(8, 9), destination: rango(18, 22), pasteType: 'PASTE_FORMAT' } }] }
})

const despues = await leer(`A${PRIMERA_FILA}:V${ULTIMA_FILA}`, 'UNFORMATTED_VALUE')
despues.forEach((f, i) => {
  const fila = PRIMERA_FILA + i
  assert.equal(String(f[1]).trim(), enHoja[i], `fila ${fila}: el programa se movio mientras se escribia`)
  const total = (desde) => [0, 1, 2, 3].reduce((a, k) => a + (Number(f[desde + k]) || 0), 0)
  assert.equal(f[6], total(10), `fila ${fila} ${enHoja[i]}: G no cuadra con K:N`)
  assert.equal(f[7], total(14), `fila ${fila} ${enHoja[i]}: H no cuadra con O:R`)
  const v = V.porPrograma.get(enHoja[i]) ?? cero
  assert.deepEqual(f.slice(10, 14).map(Number), CELDAS.map(k => v[k]), `fila ${fila}: ventas escritas distintas al ERP`)
})
console.log(`OK: ${despues.length} programas, G = suma K:N y H = suma O:R en todas las filas`)
