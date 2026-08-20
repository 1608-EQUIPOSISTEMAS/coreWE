// Actualiza OBJETIVOS FINANCIEROS 2027 (OFIC-27) con la data real de Contabilidad.
//
// Criterio acordado con el usuario (20/08/2026):
//   1. El histórico 2022-2025 se CONGELA a valores. Antes dependía de 10 libros
//      ajenos vía IMPORTRANGE: al copiar el libro para el ciclo 2027 se rompieron
//      (typo en la fórmula del 2024, #REF! en el avance) y nadie se enteró.
//   2. Solo el año en curso queda enlazado en vivo al Flujo de Caja 2026, en UNA
//      sola celda por serie; el resto la referencia.
//   3. Los meses que Contabilidad todavía no cierra llegan como 0 desde el origen
//      y se muestran vacíos: un 0 contaminaría promedios, temporalidad y margen.
//      Julio 2026 tiene ingreso cerrado pero NO egreso; por eso el corte es distinto.
//
// No se toca 'Temporalidad 2026' (fila 25): un año con 7 meses no produce una
// temporalidad válida, y la fila 26 la promedia para fijar el objetivo 2027.
// AVERAGE ignora la celda vacía, así que el objetivo sigue saliendo del 22-25.
import { google } from 'googleapis'
import { createRequire } from 'node:module'

const OFIC27 = '1xXixIXR9xJ-dJwQonLIGCEqwcLbC8X_dVjivoUg9hMA'
const FLUJO_2026 = '1lHKqXmJtifLoecSPtomZjBcTG6qkslxGsAeIFHftZec'
const OBJETIVO = "'2. Objetivo Ing - Query'"
const AVANCE = "'3. Avance U.Neg'"

// Ingresos totales por mes (Ene-Dic), tal como los muestra hoy el OFIC-26 vigente.
const INGRESOS = {
  2022: [177886.55, 181483, 209540.7, 201579.1352, 206037.125, 241814.942, 228630.76, 236345.36, 198044.28, 175313.84, 190956.75, 138414.75],
  2023: [257056.5921, 179170.5115, 209293.1113, 225136.3853, 259733.90721, 201323.40708, 247394.14014, 223175.05792, 222061.601, 216912.41442, 214140.119, 171845.9579],
  2024: [289329.775, 234333.117, 255294.45945, 246514.0004, 230259.762, 258999.49576, 329862.03734, 263497.99, 282829.004, 247410.888, 216793.7575, 232766.183],
  2025: [334513.4436, 296446.851, 294570.4172, 270543.1335, 328748.104, 255717.61008, 346649.08, 331194.056, 270039.657, 291609.272, 332187.606, 325367.3255],
}

// Egresos totales por mes. Jul-Dic 2025 estaban escritos a mano con un incremento
// lineal de +2.427 (245.605 → 257.740): el gasto real del 2025 es S/ 46.840 mayor.
// Fuente: '3. ING vs EGR TOTALES'!E41:P41 del Flujo de Caja 2026.
const EGRESOS = {
  2022: [95410.3014, 110323.0836, 125949.6826, 143774.8421, 133093.9275, 107639.7296, 152851.6688, 131097.0636, 132320.0472, 123036.2056, 116701.0432, 153096.584],
  2023: [150455.181715, 180898.54023, 181550.161528, 161602.53675, 179973.13215, 188794.76424, 202227.0965, 184233.89432, 195404.31474, 187271.99014, 177342.50094, 212544.9852],
  2024: [216135.28925, 188327.77653, 195959.67147, 209651.28416, 210464.66001, 216843.81698, 240776.10504, 212364.17, 214670.51172, 224456.4292, 222808.41255, 241465.6575],
  2025: [187331.94, 233745.36, 227484.35, 257415.07, 290868.61, 208484.35, 268224.24, 240418.9, 281125.31, 232458.64, 242050.5, 292597.57],
}

// Ingreso real por unidad de negocio, congelado igual que el total.
const POR_UNIDAD = {
  [`${AVANCE}!D69:O69`]: [221341.3682, 153641.3112, 186010.3637, 206407.1676, 211921.41521, 174142.796, 177653.3368, 169143.7432, 167259.876, 168697.304, 139962.655, 152610.56119],
  [`${AVANCE}!D70:O70`]: [223850.55, 198936.377, 224522.93848, 174061.2234, 191208.879, 195677.62897, 227163.69734, 206010, 208962.842, 194521.288, 168636.21, 181600.903],
  [`${AVANCE}!D71:O71`]: [268971.0272, 240631.997, 190403.8548, 195722.7043, 206766.02, 178224.36, 244957.65, 224788.2, 211775.725, 202659.852, 229479.364, 260701.7415],
  [`${AVANCE}!D79:O79`]: [20329.298, 13716.542, 13889.22697, 16054.844, 14632.111, 17963.60679, 21325.356, 22342.5, 19337.002, 16574.84, 11422.54, 13854.8],
  [`${AVANCE}!D80:O80`]: [30299.48, 20825.17, 19999.692, 22865.91, 16319.976, 23966.616, 24702.38, 25121.08, 22354.45, 24738.586, 36396.152, 28358.424],
  [`${AVANCE}!D85:O85`]: [32702.737, 21540.198, 12109.805, 30197.853, 18039.64, 28818.26, 56279.46, 31900.49, 47533.72, 35364.76, 30346.0075, 34795.48],
  [`${AVANCE}!D86:O86`]: [35242.9364, 33029.584, 51489.4784, 43089.1202, 100612.772, 39906.88608, 60632.49, 52994.916, 31876.482, 54706.234, 63248.09, 34183.16],
  [`${AVANCE}!D91:O91`]: [0, 140, 4663.329, 26200.08, 6379.132, 16540, 25093.524, 3245, 6995.44, 950, 6389, 2515],
  [`${AVANCE}!D92:O92`]: [0, 1960.1, 32677.392, 8865.399, 5049.336, 13619.748, 16356.56, 28289.86, 4033, 9504.6, 3064, 2124],
}

const FLUJO_2026_HOJA = "'1. FLUJO WE GROUP 2026'"

const importarDelFlujo2026 = (rango) => {
  const traer = `IMPORTRANGE("${FLUJO_2026}";"${FLUJO_2026_HOJA}!${rango}")`
  return `=ARRAYFORMULA(IF(${traer}=0;"";${traer}))`
}

const espejar = (rango) => `=ARRAYFORMULA(IF(${rango}="";"";${rango}))`

const crecimientoMensual = (mes) =>
  `=IF(${mes}19="";"";(${mes}19-${mes}18)/${mes}18)`

const MESES = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O']

const cambios = [
  // Histórico congelado: ingresos 2022-2025 y egresos 2022-2025.
  { range: `${OBJETIVO}!D15:O18`, values: [INGRESOS[2022], INGRESOS[2023], INGRESOS[2024], INGRESOS[2025]] },
  { range: `${OBJETIVO}!D34:O37`, values: [EGRESOS[2022], EGRESOS[2023], EGRESOS[2024], EGRESOS[2025]] },
  { range: `${AVANCE}!D23:O23`, values: [INGRESOS[2023]] },
  { range: `${AVANCE}!D26:O26`, values: [INGRESOS[2024]] },
  { range: `${AVANCE}!D32:O32`, values: [INGRESOS[2025]] },
  ...Object.entries(POR_UNIDAD).map(([range, fila]) => ({ range, values: [fila] })),

  // Año en curso en vivo. La única celda que llama al Flujo de Caja 2026 por serie.
  { range: `${AVANCE}!D38`, values: [[importarDelFlujo2026('E7:P7')]] },
  { range: `${OBJETIVO}!D19`, values: [[espejar(`${AVANCE}!D38:O38`)]] },
  { range: `${OBJETIVO}!D38`, values: [[importarDelFlujo2026('E19:P19')]] },

  // La copia dejó esta fila comparando 24 vs 25 pese a que el rótulo dice 25 vs 26.
  { range: `${OBJETIVO}!D20:O20`, values: [MESES.map(crecimientoMensual)] },
]

const key = createRequire(import.meta.url)('../credentials/service.json')
const auth = new google.auth.JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})
const sheets = google.sheets({ version: 'v4', auth })

const { data } = await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: OFIC27,
  requestBody: { valueInputOption: 'USER_ENTERED', data: cambios },
})
console.log(`Celdas actualizadas: ${data.totalUpdatedCells} en ${data.totalUpdatedSheets} pestañas`)

// Los meses que aún no cierran mostraban "0,00% logrado" y "-100,00% de
// crecimiento", que en el reporte se lee como una caída y no como un mes vacío.
const MESES_SIN_CERRAR = MESES.map((mes) => [
  `=IF(${mes}38="";"";${mes}38/${mes}37)`,
  `=IF(${mes}38="";"";(${mes}38-${mes}32)/${mes}32)`,
])

const { data: avance } = await sheets.spreadsheets.values.update({
  spreadsheetId: OFIC27,
  range: `${AVANCE}!D39:O40`,
  valueInputOption: 'USER_ENTERED',
  requestBody: { majorDimension: 'COLUMNS', values: MESES_SIN_CERRAR },
})
console.log(`Avance sin cerrar: ${avance.updatedCells} celdas`)
