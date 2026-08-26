// Escribe en la fila 5 de "Reporte Egresos" el total general de cada mes.
//
// La hoja no tenia total general: el nivel mas alto eran los 12 SUB TOTAL de
// seccion y el cuadre contra el libro solo vivia en egresos-verificar-cuadre.mjs.
// La fila 4 ya rotula "Total mes"; la 5 es la fila donde va ese valor.
//
// La lista de filas es explicita a proposito: un SUMIF con "SUB TOTAL*" tambien
// engancharia un "Sub Total - X" mal tipeado y duplicaria la seccion en silencio.
// Uso: node scripts/egresos-total-general-mes.mjs
import { google } from "googleapis";

const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const HOJA = "Reporte Egresos";
const HOJA_ID = 1440644810;
const FILA_TOTAL = 5;
const SECCIONES = [9, 110, 126, 133, 171, 197, 258, 265, 276, 294, 306, 333];
const MESES = ["G","H","I","J","K","L","M","N","O","P","Q","R"];
const TOLERANCIA = 0.01;

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

const totalDelMes = (col) => `=SUM(${SECCIONES.map((f) => col + f).join(";")})`;
const fila = [...MESES.map(totalDelMes), `=SUM(G${FILA_TOTAL}:R${FILA_TOTAL})`];

await sheets.spreadsheets.values.update({
  spreadsheetId: LIBRO,
  range: `'${HOJA}'!G${FILA_TOTAL}:S${FILA_TOTAL}`,
  valueInputOption: "USER_ENTERED",
  requestBody: { values: [fila] },
});

// El formato de moneda se hereda de la fila de subtotal de Personal y Planillas,
// que es la que ya luce como total. Solo el numberFormat: copiar el estilo entero
// pisaria el fondo de la fila de titulo de seccion.
const { data: muestra } = await sheets.spreadsheets.get({
  spreadsheetId: LIBRO,
  ranges: [`'${HOJA}'!G110`],
  includeGridData: true,
  fields: "sheets/data/rowData/values/userEnteredFormat/numberFormat",
});
const numberFormat = muestra.sheets[0].data[0].rowData?.[0]?.values?.[0]?.userEnteredFormat?.numberFormat;
if (numberFormat) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: LIBRO,
    requestBody: { requests: [{ repeatCell: {
      range: { sheetId: HOJA_ID, startRowIndex: FILA_TOTAL - 1, endRowIndex: FILA_TOTAL,
               startColumnIndex: 6, endColumnIndex: 19 },
      cell: { userEnteredFormat: { numberFormat } },
      fields: "userEnteredFormat.numberFormat",
    } }] },
  });
}

// Guarda: el total escrito tiene que igualar la suma de los subtotales leidos.
const { data } = await sheets.spreadsheets.values.batchGet({
  spreadsheetId: LIBRO,
  ranges: [`'${HOJA}'!G${FILA_TOTAL}:S${FILA_TOTAL}`,
           ...SECCIONES.map((f) => `'${HOJA}'!G${f}:R${f}`)],
  valueRenderOption: "UNFORMATTED_VALUE",
});
const [escrito, ...subtotales] = data.valueRanges.map((r) => r.values?.[0] ?? []);
const num = (v) => (typeof v === "number" ? v : 0);
const esperado = MESES.map((_, i) => subtotales.reduce((a, f) => a + num(f[i]), 0));

let descuadre = 0;
MESES.forEach((col, i) => {
  const diff = Math.abs(num(escrito[i]) - esperado[i]);
  if (diff > TOLERANCIA) descuadre++;
  console.log(`${col}${FILA_TOTAL} = ${num(escrito[i]).toFixed(2)}` + (diff > TOLERANCIA ? `  DESCUADRE (esperado ${esperado[i].toFixed(2)})` : ""));
});
console.log(`S${FILA_TOTAL} (anio) = ${num(escrito[12]).toFixed(2)}`);
if (descuadre) { console.error(`\n${descuadre} mes(es) sin cuadrar`); process.exit(1); }
console.log("\nCuadra: los 12 meses igualan la suma de los 12 subtotales de seccion.");
