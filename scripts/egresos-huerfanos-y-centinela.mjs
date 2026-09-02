// Cierra la brecha de julio en "Reporte Egresos" ([[reporte-gastos-vs-fc-egresos]]):
//
//   1. Da de alta las 12 partidas del libro que no tenian fila en el reporte.
//   2. Restituye la fila centinela "NO CLASIFICADO", que alguien borro y era la
//      unica senal de que un codigo nuevo del libro se estaba cayendo del arbol.
//
// Las filas se insertan DENTRO de su sub-bloque, nunca debajo del subtotal:
// Google extiende solo los rangos de las formulas vivas (`=SUM(G143:G144)`) si
// la insercion cae entre sus extremos. Insertar despues del ultimo elemento
// dejaria la fila fuera del subtotal sin dar error.
//
// Es re-ejecutable: si un codigo ya tiene fila, se omite. Guarda un respaldo de
// la pestana antes de tocar nada.
// Uso: node scripts/egresos-huerfanos-y-centinela.mjs
import { google } from "googleapis";
import { writeFileSync } from "node:fs";

const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const PESTANA = "Reporte Egresos";
const RESPALDO = "scripts/_backup_reporte_egresos_2026-09-01.json";
const CENTINELA = "NO CLASIFICADO (control automatico)";

// Cada alta se ancla a una fila existente de su sub-bloque: de ahi hereda la
// seccion (columna E) y ahi mismo se inserta, para que el subtotal la absorba.
const ALTAS = [
  { ancla: 115, partidas: [["2.11.10", "PONENTES", "FUNDACIÓN", "Fundacion WE"]] },
  { ancla: 143, partidas: [
    ["2.1.28", "ALMACENAMIENTO DE CORREOS", "MARKETING", "Marketing"],
    ["2.3.25", "ALMACENAMIENTO DE CORREOS", "PRODUCTO", "Producto"],
    ["2.5.13", "ALMACENAMIENTO DE CORREOS", "FINANZAS", "Finanzas"],
    ["2.6.21", "ALMACENAMIENTO DE CORREOS", "CONTABILIDAD", "Contabilidad"],
    ["2.8.19", "ALMACENAMIENTO DE CORREOS", "GESTION DE TALENTO", "Talento"],
    ["2.9.21", "ALMACENAMIENTO DE CORREOS", "B2B", "B2B"],
  ] },
  { ancla: 219, partidas: [["2.2.8", "ENVIOS", "COMERCIAL", "Comercial"]] },
  { ancla: 236, partidas: [["2.1.21", "REPARACION DE ACTIVOS FIJOS", "MARKETING", "Marketing"]] },
  { ancla: 319, partidas: [
    ["2.4.29", "OTROS", "EXPERIENCIA AL ALUMNO", "Academica"],
    ["2.5.28", "OTROS", "FINANZAS", "Finanzas"],
    ["2.7.27", "OTROS", "SISTEMAS", "Sistemas"],
  ] },
];

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

const leerFormulas = async (rango) => (await sheets.spreadsheets.values.get({
  spreadsheetId: LIBRO, range: `'${PESTANA}'!${rango}`, valueRenderOption: "FORMULA",
})).data.values ?? [];

const { data: libro } = await sheets.spreadsheets.get({ spreadsheetId: LIBRO });
const hoja = libro.sheets.find((s) => s.properties.title === PESTANA);
if (!hoja) throw new Error(`No existe la pestana "${PESTANA}"`);
const sheetId = hoja.properties.sheetId;

const antes = await leerFormulas("A1:S400");
writeFileSync(RESPALDO, JSON.stringify(antes, null, 1));
console.log(`Respaldo en ${RESPALDO} (${antes.length} filas)`);

const yaTieneFila = new Set(antes.map((f) => String(f?.[1] ?? "").trim()));
const yaHayCentinela = antes.some((f) => String(f?.[2] ?? "").startsWith("NO CLASIFICADO"));

// Formula viva de una partida: jala su importe del libro por el codigo de la
// columna B. Es la misma de todas las filas del reporte, con la fila cambiada.
const formulaMes = (fila) =>
  `=IF($B${fila}="";"";LET(k;COLUMN()-6;r;IFERROR(MATCH($B${fila};'Fuente Principal'!$A:$A;0);0);` +
  `pen;IF(r=0;0;N(INDEX('Fuente Principal'!$A:$AB;r;3+2*k)));` +
  `usd;IF(r=0;0;N(INDEX('Fuente Principal'!$A:$AB;r;4+2*k)));` +
  `pen+IF(usd=0;0;usd*VLOOKUP(202600+k;Control!$A:$B;2;FALSE))))`;

const filaDePartida = (fila, [codigo, concepto, area, centro], seccion) =>
  ["", codigo, concepto, area, seccion, centro,
   ...Array(12).fill(formulaMes(fila)), `=SUM(G${fila}:R${fila})`];

// De abajo hacia arriba: insertar arriba correria las anclas de mas abajo.
const pendientes = ALTAS
  .map((alta) => ({ ...alta, partidas: alta.partidas.filter(([c]) => !yaTieneFila.has(c)) }))
  .filter((alta) => alta.partidas.length)
  .sort((a, b) => b.ancla - a.ancla);

for (const { ancla, partidas } of pendientes) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: LIBRO,
    requestBody: { requests: [{ insertDimension: {
      range: { sheetId, dimension: "ROWS", startIndex: ancla, endIndex: ancla + partidas.length },
      inheritFromBefore: true,
    } }] },
  });
  const seccion = antes[ancla - 1][4];
  await sheets.spreadsheets.values.update({
    spreadsheetId: LIBRO,
    range: `'${PESTANA}'!A${ancla + 1}:S${ancla + partidas.length}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: partidas.map((p, i) => filaDePartida(ancla + 1 + i, p, seccion)) },
  });
  // El codigo va aparte y en RAW: con USER_ENTERED, Sheets lee "2.2.8" como
  // fecha en locale europeo y el MATCH contra el libro deja de encontrarlo.
  await sheets.spreadsheets.values.update({
    spreadsheetId: LIBRO,
    range: `'${PESTANA}'!B${ancla + 1}:B${ancla + partidas.length}`,
    valueInputOption: "RAW",
    requestBody: { values: partidas.map(([codigo]) => [codigo]) },
  });
  console.log(`  +${partidas.length} fila(s) tras la ${ancla}: ${partidas.map(([c]) => c).join(", ")}`);
}

if (yaHayCentinela) {
  console.log("Centinela: ya existe, no se toca.");
} else {
  const despues = await leerFormulas("A1:S400");
  const filaCentinela = despues.length + 1;
  // El total general suma los 12 subtotales de seccion uno a uno. El centinela
  // es lo que el libro declara menos esa suma, y entra como sumando 13: asi el
  // total SIEMPRE iguala al libro y la fuga queda a la vista en una sola celda.
  const sumandos = String(despues[3][6]).replace(/^=SUM\((.*)\)$/, "$1");
  const columna = (i) => String.fromCharCode(71 + i); // G..R
  const total = "'Fuente Principal'!$E$2:$AB$2";

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: LIBRO,
    requestBody: { valueInputOption: "USER_ENTERED", data: [
      {
        range: `'${PESTANA}'!A${filaCentinela}:S${filaCentinela}`,
        // Va SIN codigo en la columna B a proposito: si lo tuviera, la formula
        // viva de las partidas intentaria cruzarlo contra el libro.
        values: [["", "", CENTINELA, "", "", "",
          ...Array.from({ length: 12 }, (_, i) => {
            const c = columna(i);
            return `=INDEX(${total};1;(COLUMN()-6)*2-1)-SUM(${sumandos.replace(/([A-R])(\d+)/g, `${c}$2`)})`;
          }),
          `=SUM(G${filaCentinela}:R${filaCentinela})`]],
      },
      {
        range: `'${PESTANA}'!G4:R4`,
        values: [Array.from({ length: 12 }, (_, i) => {
          const c = columna(i);
          return `=SUM(${sumandos.replace(/([A-R])(\d+)/g, `${c}$2`)};${c}${filaCentinela})`;
        })],
      },
    ] },
  });
  console.log(`Centinela restituido en la fila ${filaCentinela} y sumado al total (fila 4).`);
}
