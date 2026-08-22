// Separa el costo del personal de limpieza de la planilla de Gestion de Talento.
//
// Contabilidad saco 2.8.1 PLANILLA, 2.8.2 AFP y 2.8.4 BENEFICIOS SOCIALES del
// detalle del libro (ya no existen en "Fuente Principal") y dejo su desglose en
// la pestana "Reporte Contabilidaad", tablas 3/4/5, partido en talento y
// personal de limpieza. Sin esto el reporte pierde S/16.499,59 en silencio.
//
// El personal de limpieza es gasto de local, no de area: sus tres conceptos van
// al sub-bloque "Mantenimiento Oficina" de INFRAESTRUCTURA Y OFICINA, junto al
// resto del costo de mantener la oficina.
//
// Uso: node scripts/egresos-personal-limpieza.mjs [--dry]
import { google } from "googleapis";

const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const REPORTE = "Reporte Egresos";
const DESGLOSE = "Reporte Contabilidaad";
const HOJA_REPORTE_ID = 1440644810;

// Cada concepto vive en dos filas del desglose: talento y personal de limpieza.
const CONCEPTOS = [
  { codigo: "2.8.1", etiqueta: "PLANILLA",            filaTalento: 76, desgloseTalento: 34, desgloseLimpieza: 35 },
  { codigo: "2.8.2", etiqueta: "AFP",                 filaTalento: 77, desgloseTalento: 40, desgloseLimpieza: 41 },
  { codigo: "2.8.4", etiqueta: "BENEFICIOS SOCIALES", filaTalento: 78, desgloseTalento: 46, desgloseLimpieza: 47 },
];

const FILA_LIMPIEZA = 180;                 // "PERSONAL DE LIMPIEZA - MANTENIMIENTO", hoy vacia
const FILA_SUBTOTAL_BLOQUE = 181;          // subtotal de "Mantenimiento Oficina", sin formula y mal rotulado
const FILA_INICIO_BLOQUE = 175;
const MESES = 12;
const COL_MES = (i) => String.fromCharCode(71 + i);

const filasNuevas = CONCEPTOS.length - 1;  // la primera reusa la fila que ya existe
const filaSubtotalFinal = FILA_SUBTOTAL_BLOQUE + filasNuevas;
const dry = process.argv.includes("--dry");

const formulaDesglose = (filaDesglose) =>
  `=N(INDEX('${DESGLOSE}'!$B$${filaDesglose}:$M$${filaDesglose};COLUMN()-6))`;

const importes = (filaReporte, filaDesglose) => ({
  range: `'${REPORTE}'!G${filaReporte}:S${filaReporte}`,
  values: [[...Array(MESES).fill(formulaDesglose(filaDesglose)), `=SUM(G${filaReporte}:R${filaReporte})`]],
});

if (dry) {
  console.log("Gestion de Talento (solo su parte):");
  for (const c of CONCEPTOS) {
    console.log(`  f${c.filaTalento}  ${c.codigo}-TALENTO  ${c.etiqueta.padEnd(20)} <- '${DESGLOSE}' fila ${c.desgloseTalento}`);
  }
  console.log(`\nMantenimiento Oficina (+${filasNuevas} filas insertadas):`);
  CONCEPTOS.forEach((c, i) => {
    console.log(`  f${FILA_LIMPIEZA + i}  ${c.codigo}-LIMPIEZA  PERSONAL DE LIMPIEZA - ${c.etiqueta.padEnd(20)} <- '${DESGLOSE}' fila ${c.desgloseLimpieza}`);
  });
  console.log(`  f${filaSubtotalFinal}  Subtotal - Mantenimiento Oficina = SUM(G${FILA_INICIO_BLOQUE}:G${filaSubtotalFinal - 1})`);
  process.exit(0);
}

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

const yaAplicado = String((await sheets.spreadsheets.values.get({
  spreadsheetId: LIBRO, range: `'${REPORTE}'!B${FILA_LIMPIEZA}`,
})).data.values?.[0]?.[0] ?? "").trim().startsWith("2.8.1-");
if (yaAplicado) { console.log("Ya aplicado; nada que hacer."); process.exit(0); }

await sheets.spreadsheets.batchUpdate({
  spreadsheetId: LIBRO,
  requestBody: {
    requests: [{
      insertDimension: {
        range: { sheetId: HOJA_REPORTE_ID, dimension: "ROWS", startIndex: FILA_LIMPIEZA, endIndex: FILA_LIMPIEZA + filasNuevas },
        inheritFromBefore: true,
      },
    }],
  },
});

const datos = [];
for (const c of CONCEPTOS) {
  // El codigo derivado deja constancia de que la fila es una porcion de 2.8.x y
  // no el codigo entero; ademas ninguno cruza ya contra "Fuente Principal".
  datos.push({ range: `'${REPORTE}'!B${c.filaTalento}`, values: [[`${c.codigo}-TALENTO`]] });
  datos.push(importes(c.filaTalento, c.desgloseTalento));
}
CONCEPTOS.forEach((c, i) => {
  const fila = FILA_LIMPIEZA + i;
  datos.push({
    range: `'${REPORTE}'!B${fila}:F${fila}`,
    values: [[`${c.codigo}-LIMPIEZA`, `PERSONAL DE LIMPIEZA - ${c.etiqueta}`, "GENERAL",
              "6. Infraestructura y Oficina", "Administracion"]],
  });
  datos.push(importes(fila, c.desgloseLimpieza));
});

// El subtotal del sub-bloque nunca tuvo formula y arrastraba el rotulo de otro
// bloque; se corrige de paso porque ahora si tiene algo que sumar.
datos.push({ range: `'${REPORTE}'!C${filaSubtotalFinal}`, values: [["Subtotal - Mantenimiento Oficina"]] });
datos.push({
  range: `'${REPORTE}'!G${filaSubtotalFinal}:S${filaSubtotalFinal}`,
  values: [[
    ...Array.from({ length: MESES }, (_, i) => `=SUM(${COL_MES(i)}${FILA_INICIO_BLOQUE}:${COL_MES(i)}${filaSubtotalFinal - 1})`),
    `=SUM(S${FILA_INICIO_BLOQUE}:S${filaSubtotalFinal - 1})`,
  ]],
});

await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: LIBRO,
  requestBody: { valueInputOption: "USER_ENTERED", data: datos },
});
console.log(`Talento reapuntado (f${CONCEPTOS[0].filaTalento}-f${CONCEPTOS[2].filaTalento}).`);
console.log(`Personal de limpieza en f${FILA_LIMPIEZA}-f${FILA_LIMPIEZA + filasNuevas}, subtotal en f${filaSubtotalFinal}.`);
