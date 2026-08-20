// Verifica que el OFIC-27 quedó consistente tras los scripts ofic27-*.mjs.
// Falla ruidosamente: es lo único que separa "la fórmula se escribió" de "el número está bien".
import assert from 'node:assert/strict'
import { google } from 'googleapis'
import { createRequire } from 'node:module'

const OFIC27 = '1xXixIXR9xJ-dJwQonLIGCEqwcLbC8X_dVjivoUg9hMA'
const OBJETIVO = "'2. Objetivo Ing - Query'"
const AVANCE = "'3. Avance U.Neg'"
const HISTORICO = "'4. Ing. Historico'"

const INGRESO_2026_A_JULIO = 2643216
const SUMA_UNIDADES_2026 = 2638945 // menor que el total: ver el assert de más abajo
const EGRESO_2025_REAL = 2962205

const key = createRequire(import.meta.url)('../credentials/service.json')
const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})
const sheets = google.sheets({ version: 'v4', auth })

const leer = async (range) =>
  (await sheets.spreadsheets.values.get({ spreadsheetId: OFIC27, range, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values || []

const esError = (celda) => typeof celda === 'string' && celda.startsWith('#')
const redondear = (n) => Math.round(n)

const HOJAS = [
  { nombre: OBJETIVO, rango: `${OBJETIVO}!A11:P115`, filaBase: 11 },
  { nombre: AVANCE, rango: `${AVANCE}!A1:P125`, filaBase: 1 },
  { nombre: HISTORICO, rango: `${HISTORICO}!A8:Q146`, filaBase: 8 },
]

const errores = (
  await Promise.all(
    HOJAS.map(async ({ nombre, rango, filaBase }) =>
      (await leer(rango)).flatMap((fila, i) =>
        fila.filter(esError).map((celda) => `${nombre} fila ${filaBase + i}: ${celda}`),
      ),
    ),
  )
).flat()
assert.deepEqual(errores, [], `Quedaron celdas en error:\n${errores.join('\n')}`)

const [[egresos2025], [egresos2026], [ingresos2026], porUnidad, [historico2026], detalle] = await Promise.all([
  leer(`${OBJETIVO}!B37:O37`),
  leer(`${OBJETIVO}!B38:O38`),
  leer(`${OBJETIVO}!B19:O19`),
  leer(`${AVANCE}!C74:C98`),
  leer(`${HISTORICO}!C13`),
  leer(`${HISTORICO}!O87:O144`),
])

assert.equal(redondear(egresos2025[0]), EGRESO_2025_REAL, 'El egreso 2025 debe ser el real, no la escalera de +2.427')
assert.equal(egresos2025.length, 14, 'El egreso 2025 debe tener los 12 meses cerrados')
assert.equal(redondear(ingresos2026[0]), INGRESO_2026_A_JULIO, 'Ingreso 2026 acumulado a julio')
assert.equal(ingresos2026.length, 9, 'Ingresos 2026: Ene-Jul cargados, Ago-Dic vacíos')
assert.equal(egresos2026.length, 8, 'Egresos 2026: Ene-Jun cargados, julio sigue sin cerrar en Contabilidad')

// Las 4 unidades del avance: filas 74 (EE), 84 (Online), 91 (B2B) y 98 (Fundación).
const unidades = [0, 10, 17, 24].map((i) => redondear(porUnidad[i][0]))
assert.deepEqual(unidades, [2079619, 153011, 330562, 75753], 'Avance 2026 por unidad vs el margen por unidad de Contabilidad')
assert.equal(
  unidades.reduce((a, b) => a + b),
  SUMA_UNIDADES_2026,
  `Suma por unidad a julio. Queda S/ ${INGRESO_2026_A_JULIO - SUMA_UNIDADES_2026} debajo del ingreso total: es mayo, que Contabilidad dejó sin unidad asignada`,
)

// '4. Ing. Historico' no vuelve a importar nada: refleja el avance.
assert.equal(redondear(historico2026[0]), INGRESO_2026_A_JULIO, 'Cuadro I del histórico debe espejar el avance 2026')
// Ojo con el orden: el avance va EE / Online / B2B / Fundación y las tablas de
// detalle van ZOOM / Online / Fundación / B2B. Tres libros, tres ordenamientos.
const [ejecutiva, online, business, fundacion] = unidades
const totalesDetalle = [0, 19, 38, 57].map((i) => redondear(detalle[i][0]))
assert.deepEqual(
  totalesDetalle,
  [ejecutiva, online, fundacion, business],
  'Las 4 tablas de detalle deben cerrar con las mismas unidades',
)

// El fallo más traicionero del libro: si la fila de severidades pierde su referencia
// no da error, solo clasifica los 12 meses como ATÍPICO y hunde el margen del escenario.
const [severidades] = await leer(`${OBJETIVO}!D68:O68`)
assert.ok(
  new Set(severidades).size > 1,
  `Las severidades del escenario colapsaron a "${severidades[0]}": la fila 68 perdió su referencia a la temporalidad proyectada`,
)

console.log('OK: 3 pestañas sin celdas en error, egresos 2025 completos, 2026 cortado donde corresponde y cuadrando en las 3 vistas')
