// Reemplaza la fila 2.1.12 PUBLICIDAD Y MARKETING de "Reporte Egresos" y
// "Reporte Consolidado" por 4 filas: Programas en vivo, Membresias, Fundacion
// y B2B ([[publicidad-por-unidad]]).
//
// Metodo = el de contabilidad (pestana "0.1 EGR - UNIDAD NEG." del libro
// FC-EGRESOS): monto del BANCO x % de gasto de Marketing por unidad. Pegar los
// montos de Marketing tal cual romperia el cuadre al centimo: Marketing anota el
// consumo por plataforma y el banco el cargo (USD, impuestos, fecha de cobro).
//
// ONLINE e INMOBILIARIA no entran a la base del % (pedido del usuario).
// Membresias no es unidad en Marketing sino productos dentro de EN VIVO, asi que
// "Programas en vivo" es el residuo (1 - los otros tres): las 4 filas suman el
// banco por construccion, y si el IMPORTRANGE falla todo cae ahi sin descuadrar.
//
// La fila 2.1.12 no se borra: se renombra y se le insertan 3 debajo, para que las
// referencias a ella (Consolidado, total general) y los SUMIF del bloque sigan vivos.
//
// Re-ejecutable: si ya esta desglosado no inserta filas; la pestana de reparto se
// reescribe siempre. Aborta si el total general de Egresos cambia.
// Uso: node scripts/egresos-publicidad-por-unidad.mjs [--dry]
import { google } from "googleapis";
import { writeFileSync } from "node:fs";

const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const LIBRO_MARKETING = "1Pvuasr0OcpYhPyYbf_B4J5pshVlLBqq6u-O0wacOI6M"; // Gastos Marketing 2026
const EGRESOS = "Reporte Egresos";
const CONSOLIDADO = "Reporte Consolidado";
const REPARTO = "Reparto Publicidad";
const CODIGO = "2.1.12";
const RESPALDO = "scripts/_backup_publicidad_por_unidad_2026-09-11.json";
const TOLERANCIA = 0.01;

// La primera es el residuo. El orden fija las filas 8..11 de la pestana de reparto.
const UNIDADES = [
  { codigo: "2.1.12-ENVIVO",     etiqueta: "PUBLICIDAD - PROGRAMAS EN VIVO" },
  { codigo: "2.1.12-MEMBRESIAS", etiqueta: "PUBLICIDAD - MEMBRESIAS" },
  { codigo: "2.1.12-FUNDACION",  etiqueta: "PUBLICIDAD - FUNDACION" },
  { codigo: "2.1.12-B2B",        etiqueta: "PUBLICIDAD - B2B" },
];
const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
const letra = (n) => { let s = ""; for (; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const columnasMes = MESES.map((_, i) => letra(2 + i)); // B..M en la pestana de reparto

const dry = process.argv.includes("--dry");
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

const leer = async (rango, render = "FORMULA") => (await sheets.spreadsheets.values.get({
  spreadsheetId: LIBRO, range: rango, valueRenderOption: render,
})).data.values ?? [];

// Pestana de reparto. Las posiciones de "RPT Resumen Mensual" son estables (meses
// en C:N, quincenas en filas 9-22); las de "DATA Gastos Marketing" NO: Marketing
// agrega columnas cada quincena, asi que el mes de cada columna se deduce de su
// rotulo ("Enero 1", "Agos 2") y nunca de su posicion.
// El bloque "RESUMEN MENSUAL POR UNIDAD" (f24-29) queda fuera a proposito: no suma
// sus propias quincenas desde febrero.
function contenidoReparto() {
  const sumaUnidad = (rotulo) => `=SUMIF($A$20:$A$35;"${rotulo}";INDEX($C$20:$N$35;0;COLUMN()-1))`;
  const fila = (etiqueta, formulaDeColumna) => [etiqueta, ...columnasMes.map(formulaDeColumna)];
  const plataformas = "FACEBOOK|INSTAGRAM|GOOGLE|TIKTOK|YOUTUBE|LINKEDIN|WHATSAPP";
  return [
    ["Gasto de Marketing por mes", ...MESES],
    fila("EN VIVO (incluye membresias)", () => sumaUnidad("EN VIVO")),
    fila("MEMBRESIAS", () => "=SUMPRODUCT(($D$15:$HZ$15=COLUMN()-1)*$D$16:$HZ$16*$D$17:$HZ$17)"),
    fila("FUNDACION", () => sumaUnidad("FUNDACION")),
    fila("B2B", () => sumaUnidad("B2B")),
    fila("BASE (sin ONLINE ni INMOBILIARIA)", (c) => `=${c}2+${c}4+${c}5`),
    [],
    fila(UNIDADES[0].codigo, (c) => `=1-SUM(${c}9:${c}11)`),
    fila(UNIDADES[1].codigo, (c) => `=IFERROR(${c}3/${c}6;0)`),
    fila(UNIDADES[2].codigo, (c) => `=IFERROR(${c}4/${c}6;0)`),
    fila(UNIDADES[3].codigo, (c) => `=IFERROR(${c}5/${c}6;0)`),
    [],
    ["Membresias: una columna por cada columna de DATA Gastos Marketing (desde D)"],
    ["Rotulo de quincena", "", "", '=SCAN("";D41:HZ41;LAMBDA(a;x;IF(x="";a;x)))'],
    // "set" y "sep" son el mismo mes; el MOD descarta coincidencias entre dos meses.
    ["Mes", "", "", '=ARRAYFORMULA(IF(D14:HZ14="";0;IFERROR(LET(p;FIND(SUBSTITUTE(LOWER(LEFT(D14:HZ14;3));"set";"sep");"enefebmarabrmayjunjulagosepoctnovdic");IF(MOD(p-1;3)=0;(p+2)/3;0));0)))'],
    // Solo columnas de plataforma: la columna del rotulo ya es el total del bloque y se contaria dos veces.
    ["Es plataforma", "", "", `=ARRAYFORMULA(--REGEXMATCH(UPPER(TO_TEXT(D42:HZ42));"^(${plataformas})$"))`],
    ["Membresias por columna", "", "", '=MMULT(TRANSPOSE(ARRAYFORMULA(--REGEXMATCH(UPPER(TO_TEXT(C43:C739));"MEMBRES")));ARRAYFORMULA(IF(ISNUMBER(D43:HZ739);D43:HZ739;0)))'],
    [],
    ["Importado de Gastos Marketing 2026 > RPT Resumen Mensual A7:N22"],
    [`=IMPORTRANGE("${LIBRO_MARKETING}";"RPT Resumen Mensual!A7:N22")`],
    ...Array(18).fill([]),
    ["Importado de Gastos Marketing 2026 > DATA Gastos Marketing A1:HZ700"],
    [`=IMPORTRANGE("${LIBRO_MARKETING}";"DATA Gastos Marketing!A1:HZ700")`],
  ];
}

// Monto del banco de la raiz del codigo (misma formula viva que el resto del
// reporte) por el % de la unidad, buscado por el codigo derivado de la fila.
const formulaEgresos = (fila) =>
  `=LET(k;COLUMN()-6;cod;REGEXEXTRACT($B${fila};"^[^-]+");r;IFERROR(MATCH(cod;'Fuente Principal'!$A:$A;0);0);` +
  `pen;IF(r=0;0;N(INDEX('Fuente Principal'!$A:$AB;r;3+2*k)));` +
  `usd;IF(r=0;0;N(INDEX('Fuente Principal'!$A:$AB;r;4+2*k)));` +
  `banco;pen+IF(usd=0;0;usd*VLOOKUP(202600+k;Control!$A:$B;2;FALSE));` +
  `pct;IFERROR(INDEX('${REPARTO}'!$B$8:$M$11;MATCH($B${fila};'${REPARTO}'!$A$8:$A$11;0);k);0);banco*pct)`;
const columnasReporte = MESES.map((_, i) => letra(7 + i)); // G..R
const formulaConsolidado = (filaEgresos) => (c) => `=SUM('${EGRESOS}'!${c}$${filaEgresos})`;

const buscarFila = (filas, codigo) => filas.findIndex((f) => String(f?.[1] ?? "").trim() === codigo) + 1;

const { data: libro } = await sheets.spreadsheets.get({ spreadsheetId: LIBRO, fields: "sheets.properties" });
const idDe = (titulo) => libro.sheets.find((s) => s.properties.title === titulo)?.properties.sheetId;

const [egresos, consolidado] = [await leer(`'${EGRESOS}'!A1:S400`), await leer(`'${CONSOLIDADO}'!A1:T200`)];
const totalAntes = (await leer(`'${EGRESOS}'!G4:R4`, "UNFORMATTED_VALUE"))[0] ?? [];
const anclaEgresos = buscarFila(egresos, CODIGO) || buscarFila(egresos, UNIDADES[0].codigo);
const anclaConsolidado = buscarFila(consolidado, CODIGO) || buscarFila(consolidado, UNIDADES[0].codigo);
if (!anclaEgresos || !anclaConsolidado) throw new Error(`No se encontro ${CODIGO} en las dos pestanas`);
const yaDesglosado = buscarFila(egresos, UNIDADES[0].codigo) > 0;

console.log(`Egresos fila ${anclaEgresos}, Consolidado fila ${anclaConsolidado}` +
  (yaDesglosado ? " (ya desglosado: no se insertan filas)" : " (se insertan 3 filas debajo de cada una)"));
for (const [i, u] of UNIDADES.entries()) console.log(`  ${anclaEgresos + i} / ${anclaConsolidado + i}  ${u.codigo.padEnd(18)} ${u.etiqueta}`);
console.log(`Pestana "${REPARTO}": ${idDe(REPARTO) === undefined ? "se crea" : "se reescribe"}`);
if (dry) process.exit(0);

writeFileSync(RESPALDO, JSON.stringify({ egresos, consolidado }, null, 1));
console.log(`Respaldo en ${RESPALDO}`);

if (idDe(REPARTO) === undefined) {
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: LIBRO, requestBody: { requests: [
    { addSheet: { properties: { title: REPARTO, gridProperties: { rowCount: 760, columnCount: 240 } } } },
  ] } });
}
await sheets.spreadsheets.values.clear({ spreadsheetId: LIBRO, range: `'${REPARTO}'!A1:HZ760` });
await sheets.spreadsheets.values.update({
  spreadsheetId: LIBRO, range: `'${REPARTO}'!A1`, valueInputOption: "USER_ENTERED",
  requestBody: { values: contenidoReparto() },
});

const insertarDebajo = (sheetId, fila) => ({ insertDimension: {
  range: { sheetId, dimension: "ROWS", startIndex: fila, endIndex: fila + UNIDADES.length - 1 },
  inheritFromBefore: true,
} });
if (!yaDesglosado) {
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: LIBRO, requestBody: { requests: [
    insertarDebajo(idDe(EGRESOS), anclaEgresos),
    insertarDebajo(idDe(CONSOLIDADO), anclaConsolidado),
  ] } });
}

const filasDe = (hoja, ancla, original, formulaDeColumna) => UNIDADES.map((u, i) => {
  const fila = ancla + i;
  return {
    range: `'${hoja}'!C${fila}:S${fila}`,
    values: [[u.etiqueta, original[3], original[4], original[5] ?? "",
      ...columnasReporte.map(formulaDeColumna(fila, i)), `=SUM(G${fila}:R${fila})`]],
  };
});
await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: LIBRO, requestBody: { valueInputOption: "USER_ENTERED", data: [
  ...filasDe(EGRESOS, anclaEgresos, egresos[anclaEgresos - 1], (fila) => () => formulaEgresos(fila)),
  ...filasDe(CONSOLIDADO, anclaConsolidado, consolidado[anclaConsolidado - 1], (_, i) => formulaConsolidado(anclaEgresos + i)),
] } });
// Codigos en RAW: con USER_ENTERED Sheets puede leer "2.1.12" como fecha y el MATCH deja de cruzar.
const codigos = UNIDADES.map((u) => [u.codigo]);
await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: LIBRO, requestBody: { valueInputOption: "RAW", data: [
  { range: `'${EGRESOS}'!B${anclaEgresos}:B${anclaEgresos + 3}`, values: codigos },
  { range: `'${CONSOLIDADO}'!B${anclaConsolidado}:B${anclaConsolidado + 3}`, values: codigos },
  { range: `'${REPARTO}'!A8:A11`, values: codigos },
] } });

const totalDespues = (await leer(`'${EGRESOS}'!G4:R4`, "UNFORMATTED_VALUE"))[0] ?? [];
const mesesQueCambian = MESES.filter((_, i) => Math.abs((totalDespues[i] ?? 0) - (totalAntes[i] ?? 0)) > TOLERANCIA);
if (mesesQueCambian.length) {
  console.error(`El total general cambio en ${mesesQueCambian.join(", ")}. Restaurar desde ${RESPALDO}.`);
  process.exit(1);
}
console.log("OK: 2.1.12 desglosado y el total general no se movio.");
