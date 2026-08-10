// Vuelca el FC-EGRESOS a la pestaña "Fuente Principal" del Reporte Gastos.
// La fuente lleva PEN y USD en columnas separadas por mes; aquí se consolida en
// soles con el tipo de cambio del propio mes, porque la plantilla destino tiene
// una sola columna por mes (y su cifra de control ya viene consolidada).
// Uso: node scripts/egresos-cargar-fuente-principal.mjs [--dry]
import { google } from "googleapis";

const FUENTE = "17s8lele1C0IMuuvruWTlGxLJvnuQYg96HLJKR0KGDM4";
const DESTINO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const HOJA_FUENTE = "0. FC - EGRESOS ";
const HOJA_DESTINO = "Fuente Principal";

const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO",
               "AGOSTO", "SETIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const COL_PEN_ENERO = 4;            // columna E de la fuente
const FILA_TIPO_CAMBIO = 4;         // fila 5 de la fuente
const FILA_CONTROL = 1;             // fila 2: EGRESO TOTAL EN SOLES

const dry = process.argv.includes("--dry");
const esPartida = (codigo) => /^\d+\.\d+\.\d+$/.test(codigo);
const num = (v) => (typeof v === "number" ? v : 0);
const redondear = (n) => Math.round(n * 100) / 100;

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

const { data } = await sheets.spreadsheets.values.get({
  spreadsheetId: FUENTE,
  range: `'${HOJA_FUENTE}'`,
  valueRenderOption: "UNFORMATTED_VALUE",
});
const fuente = data.values;

const tiposCambio = MESES.map((_, i) => num(fuente[FILA_TIPO_CAMBIO][COL_PEN_ENERO + i * 2]));
const control = MESES.map((_, i) => num(fuente[FILA_CONTROL][COL_PEN_ENERO + i * 2]));

// El rubro es la fila de agrupación inmediatamente anterior a cada partida.
let rubro = "";
const partidas = [];
for (const fila of fuente) {
  const codigo = String(fila[0] ?? "").trim();
  const concepto = String(fila[1] ?? "").trim();
  if (!esPartida(codigo)) {
    if (concepto) rubro = concepto;
    continue;
  }
  const meses = MESES.map((_, i) => {
    const pen = num(fila[COL_PEN_ENERO + i * 2]);
    const usd = num(fila[COL_PEN_ENERO + i * 2 + 1]);
    // Sin redondear: redondear partida por partida desviaba el total del mes
    // respecto a la fila de control. El formato de celda se encarga de mostrar 2 decimales.
    return pen + usd * tiposCambio[i];
  });
  partidas.push([codigo, concepto, rubro, ...meses, meses.reduce((a, b) => a + b, 0)]);
}

// Guarda: si el volcado no cuadra con la fila de control, no se escribe nada.
const desvios = MESES.map((mes, i) => {
  const sumado = redondear(partidas.reduce((a, p) => a + p[3 + i], 0));
  return { mes, sumado, control: redondear(control[i]), delta: redondear(sumado - control[i]) };
}).filter((d) => Math.abs(d.delta) > 0.05);

const encabezado = [
  [`FUENTE: 2. FC-EGRESOS MENSUAL - WE GROUP | 2026 → hoja "${HOJA_FUENTE.trim()}". Montos en soles (PEN + USD x TC del mes).`],
  ["TIPO DE CAMBIO", "", "", ...tiposCambio, ""],
  ["CODIGO", "CONCEPTO", "RUBRO", ...MESES, "TOTAL"],
];

console.log(`${partidas.length} partidas, ${MESES.length} meses.`);
MESES.forEach((mes, i) => {
  const sumado = redondear(partidas.reduce((a, p) => a + p[3 + i], 0));
  console.log(`  ${mes.padEnd(10)} TC ${String(tiposCambio[i]).padEnd(6)} ${sumado.toFixed(2).padStart(13)}  (control ${control[i].toFixed(2)})`);
});

if (desvios.length) {
  console.error("\nABORTA: el volcado no cuadra con la fila de control:", desvios);
  process.exit(1);
}
if (dry) {
  console.log("\n--dry: no se escribió nada.");
  process.exit(0);
}

await sheets.spreadsheets.values.clear({ spreadsheetId: DESTINO, range: `'${HOJA_DESTINO}'` });
await sheets.spreadsheets.values.update({
  spreadsheetId: DESTINO,
  range: `'${HOJA_DESTINO}'!A1`,
  valueInputOption: "RAW",
  requestBody: { values: [...encabezado, ...partidas] },
});
console.log(`\nEscritas ${partidas.length} filas en "${HOJA_DESTINO}".`);
