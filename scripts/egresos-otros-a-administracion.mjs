// Saca de "13. Movimientos Patrimoniales y Deudas" las partidas que no son
// movimientos patrimoniales ([[reporte-gastos-vs-fc-egresos]]).
//
// El bloque "Otros por area" nacio el 2026-09-01 como bolsa de los 15 codigos
// huerfanos del libro. Se apilaron en la seccion 13 por ser el bloque nuevo, no
// porque pertenezcan ahi, y eso dejo dos problemas que reporto Contabilidad:
//
//   1. ENVIOS (x4), MOVILIDAD y REPARACION DE ACTIVOS FIJOS repiten conceptos
//      que YA tienen su sub-bloque en ADMINISTRACION GENERAL.
//   2. Los 9 "OTROS por area" son gasto administrativo, no patrimonial.
//
// Resultado: la seccion 13 queda solo con Directorio + Deudas 2025 y los
// S/3.096 viajan a ADMINISTRACION GENERAL. El total general NO cambia: esa es
// la prueba de que se movieron filas y no plata.
//
// Uso: node scripts/egresos-otros-a-administracion.mjs [--dry]
import { google } from "googleapis";
import { writeFileSync } from "node:fs";

const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const EGRESOS = "Reporte Egresos";
const CONSOLIDADO = "Reporte Consolidado";
const RESPALDO = "scripts/_backup_reporte_egresos_2026-09-08.json";
const SECCION_DESTINO = "7. Administración General";
const SOLO_DIAGNOSTICO = process.argv.includes("--dry");

// Cada partida mal ubicada vuelve a su sub-bloque: [codigo, concepto, area, centro].
const REUBICACIONES = [
  { ancla: 244, bloque: "Reparaciones activos", partidas: [
    ["2.4.26", "REPARACION DE ACTIVOS FIJOS", "EXPERIENCIA AL ALUMNO", "Academica"],
  ] },
  { ancla: 237, bloque: "Movilidad", partidas: [
    ["2.1.9", "MOVILIDAD", "MARKETING", "Marketing"],
  ] },
  { ancla: 226, bloque: "Envios", partidas: [
    ["2.10.14", "ENVIOS", "GERENCIA", "Gerencia"],
    ["2.1.10", "ENVIOS", "MARKETING", "Marketing"],
    ["2.4.19", "ENVIOS", "EXPERIENCIA AL ALUMNO", "Academica"],
    ["2.5.22", "ENVIOS", "FINANZAS", "Finanzas"],
  ] },
];
const PRIMER_CODIGO_RETIRADO = "2.4.26";
const ULTIMO_CODIGO_RETIRADO = "2.5.22";
const TOTAL_RETIRADAS = REUBICACIONES.reduce((n, r) => n + r.partidas.length, 0);

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

const { data: libro } = await sheets.spreadsheets.get({ spreadsheetId: LIBRO });
const idDePestana = (titulo) => {
  const hoja = libro.sheets.find((s) => s.properties.title === titulo);
  if (!hoja) throw new Error(`No existe la pestana "${titulo}"`);
  return hoja.properties.sheetId;
};
const idEgresos = idDePestana(EGRESOS);
const idConsolidado = idDePestana(CONSOLIDADO);

const leer = async (pestana, rango, render = "FORMULA") => (await sheets.spreadsheets.values.get({
  spreadsheetId: LIBRO, range: `'${pestana}'!${rango}`, valueRenderOption: render,
})).data.values ?? [];

const aplicar = async (requests) => {
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: LIBRO, requestBody: { requests } });
};
const escribir = async (data) => {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: LIBRO, requestBody: { valueInputOption: "USER_ENTERED", data },
  });
};

const concepto = (fila) => String(fila?.[2] ?? "").trim();
const codigo = (fila) => String(fila?.[1] ?? "").trim();
const buscarFila = (filas, predicado, que) => {
  const i = filas.findIndex(predicado);
  if (i < 0) throw new Error(`No se encontro ${que}: el reporte cambio de forma, abortado.`);
  return i + 1;
};

const antes = await leer(EGRESOS, "A1:S400");
writeFileSync(RESPALDO, JSON.stringify(antes, null, 1));
console.log(`Respaldo en ${RESPALDO} (${antes.length} filas)`);

const cabeceraOtros = buscarFila(antes, (f) => concepto(f) === "Otros por area", 'la cabecera "Otros por area"');
const subtotalOtros = buscarFila(antes, (f) => concepto(f) === "Subtotal - Otros por area", "su subtotal");
const primeraRetirada = buscarFila(antes, (f) => codigo(f) === PRIMER_CODIGO_RETIRADO, PRIMER_CODIGO_RETIRADO);
const ultimaRetirada = buscarFila(antes, (f) => codigo(f) === ULTIMO_CODIGO_RETIRADO, ULTIMO_CODIGO_RETIRADO);
if (ultimaRetirada - primeraRetirada + 1 !== TOTAL_RETIRADAS) {
  throw new Error("Las partidas a reubicar ya no estan contiguas; revisar a mano.");
}
if (subtotalOtros !== ultimaRetirada + 1) {
  throw new Error('El bloque "Otros por area" cambio de forma; revisar a mano.');
}
console.log(`Bloque "Otros por area": filas ${cabeceraOtros}-${subtotalOtros}. A reubicar: ${primeraRetirada}-${ultimaRetirada}.`);

const totalAntes = Number((await leer(EGRESOS, "S4:S4", "UNFORMATTED_VALUE"))[0][0]);
console.log(`TOTAL antes: S/${totalAntes.toLocaleString("es-PE")}`);
if (SOLO_DIAGNOSTICO) {
  console.log("--dry: no se aplico nada.");
  process.exit(0);
}

// ── 1. Las 6 partidas repetidas salen de la seccion 13...
await aplicar([{ deleteDimension: { range: {
  sheetId: idEgresos, dimension: "ROWS",
  startIndex: primeraRetirada - 1, endIndex: ultimaRetirada,
} } }]);

// ...y vuelven a entrar DENTRO de su sub-bloque, nunca debajo del subtotal:
// Google estira `=SUM(G226:G228)` solo si la insercion cae entre sus extremos.
// De abajo hacia arriba, porque insertar arriba correria las anclas de abajo.
const formulaMes = (fila) =>
  `=IF($B${fila}="";"";LET(k;COLUMN()-6;r;IFERROR(MATCH($B${fila};'Fuente Principal'!$A:$A;0);0);` +
  `pen;IF(r=0;0;N(INDEX('Fuente Principal'!$A:$AB;r;3+2*k)));` +
  `usd;IF(r=0;0;N(INDEX('Fuente Principal'!$A:$AB;r;4+2*k)));` +
  `pen+IF(usd=0;0;usd*VLOOKUP(202600+k;Control!$A:$B;2;FALSE))))`;

for (const { ancla, bloque, partidas } of REUBICACIONES) {
  await aplicar([{ insertDimension: {
    range: { sheetId: idEgresos, dimension: "ROWS", startIndex: ancla, endIndex: ancla + partidas.length },
    inheritFromBefore: true,
  } }]);
  const filas = partidas.map(([cod, con, area, centro], i) => {
    const fila = ancla + 1 + i;
    return ["", cod, con, area, SECCION_DESTINO, centro,
      ...Array(12).fill(formulaMes(fila)), `=SUM(G${fila}:R${fila})`];
  });
  await escribir([{ range: `'${EGRESOS}'!A${ancla + 1}:S${ancla + partidas.length}`, values: filas }]);
  // El codigo va aparte y en RAW: con USER_ENTERED, Sheets lee "2.1.9" como
  // fecha en locale europeo y el MATCH contra el libro deja de encontrarlo.
  await sheets.spreadsheets.values.update({
    spreadsheetId: LIBRO, range: `'${EGRESOS}'!B${ancla + 1}:B${ancla + partidas.length}`,
    valueInputOption: "RAW", requestBody: { values: partidas.map(([cod]) => [cod]) },
  });
  console.log(`  ${bloque}: +${partidas.length} fila(s) tras la ${ancla} (${partidas.map(([c]) => c).join(", ")})`);
}

// ── 2. El bloque "Otros por area" se muda entero debajo de "1.11.1 OTROS
// GASTOS", que es su vecino natural dentro de ADMINISTRACION GENERAL.
const trasReubicar = await leer(EGRESOS, "A1:S400");
const filaOtrosGastos = buscarFila(trasReubicar, (f) => codigo(f) === "1.11.1", "1.11.1 OTROS GASTOS");
const cabecera = buscarFila(trasReubicar, (f) => concepto(f) === "Otros por area", "la cabecera del bloque");
const subtotal = buscarFila(trasReubicar, (f) => concepto(f) === "Subtotal - Otros por area", "el subtotal del bloque");
const altura = subtotal - cabecera + 1;

await aplicar([{ moveDimension: {
  source: { sheetId: idEgresos, dimension: "ROWS", startIndex: cabecera - 1, endIndex: subtotal },
  destinationIndex: filaOtrosGastos,
} }]);
// Las filas de en medio se corrieron: releer y ubicar por contenido sale mas
// barato que recalcular indices a mano.
const trasMudar = await leer(EGRESOS, "A1:S400");
const nuevaCabecera = buscarFila(trasMudar, (f) => concepto(f) === "Otros por area", "la cabecera mudada");
const nuevoSubtotal = buscarFila(trasMudar, (f) => concepto(f) === "Subtotal - Otros por area", "el subtotal mudado");
if (nuevaCabecera !== filaOtrosGastos + 1 || nuevoSubtotal - nuevaCabecera + 1 !== altura) {
  throw new Error(`La mudanza no quedo donde debia (${nuevaCabecera}-${nuevoSubtotal}). Restaurar ${RESPALDO}.`);
}
console.log(`  "Otros por area": filas ${cabecera}-${subtotal} -> ${nuevaCabecera}-${nuevoSubtotal}`);

// Los dos subtotales se reescriben a mano: Google reapunta las referencias al
// mudar filas, pero el SUB TOTAL de la seccion 13 seguiria sumando el bloque
// que acaba de irse, contandolo dos veces.
const columnas = Array.from({ length: 12 }, (_, i) => String.fromCharCode(71 + i)); // G..R
const subtotalDirectorio = buscarFila(trasMudar, (f) => concepto(f) === "Subtotal - Directorio", "Subtotal - Directorio");
const subtotalDeudas = buscarFila(trasMudar, (f) => concepto(f) === "Subtotal - Deudas 2025", "Subtotal - Deudas 2025");
const subtotalPatrimonial = buscarFila(trasMudar,
  (f) => concepto(f).startsWith("SUB TOTAL MOVIMIENTOS PATRIMONIALES"), "el SUB TOTAL de la seccion 13");

await escribir([
  {
    range: `'${EGRESOS}'!E${nuevaCabecera + 1}:E${nuevoSubtotal - 1}`,
    values: Array(altura - 2).fill([SECCION_DESTINO]),
  },
  {
    range: `'${EGRESOS}'!G${nuevoSubtotal}:R${nuevoSubtotal}`,
    values: [columnas.map((c) => `=SUM(${c}${nuevaCabecera + 1}:${c}${nuevoSubtotal - 1})`)],
  },
  {
    range: `'${EGRESOS}'!G${subtotalPatrimonial}:R${subtotalPatrimonial}`,
    values: [columnas.map((c) => `=SUM(${c}${subtotalDirectorio};${c}${subtotalDeudas})`)],
  },
]);

// ── 3. El Consolidado no lee el libro: apunta a celdas de "Reporte Egresos".
// Su fila AGRUPADO tiene que seguir al bloque y mudarse tambien de seccion.
const consolidado = await leer(CONSOLIDADO, "A1:T200");
const filaAgrupada = buscarFila(consolidado, (f) => /otros por area/i.test(concepto(f)), 'el AGRUPADO "Otros por area"');
const filaOtrosGastosCon = buscarFila(consolidado, (f) => codigo(f) === "1.11.1", "1.11.1 en el Consolidado");
await aplicar([{ moveDimension: {
  source: { sheetId: idConsolidado, dimension: "ROWS", startIndex: filaAgrupada - 1, endIndex: filaAgrupada },
  destinationIndex: filaOtrosGastosCon,
} }]);
const nuevaAgrupada = filaOtrosGastosCon + 1;
// Los meses del Consolidado van en H:S, una columna corridos respecto a G:R.
const mesConsolidado = (c) => String.fromCharCode(c.charCodeAt(0) + 1);
await escribir([{
  range: `'${CONSOLIDADO}'!C${nuevaAgrupada}:T${nuevaAgrupada}`,
  values: [["OTROS POR AREA", "", "", "", "",
    ...columnas.map((c) => {
      const m = mesConsolidado(c);
      return `=SUM('${EGRESOS}'!${m}$${nuevaCabecera + 1}:${m}$${nuevoSubtotal - 1})`;
    }),
    `=SUM(H${nuevaAgrupada}:S${nuevaAgrupada})`]],
}]);
console.log(`  Consolidado: AGRUPADO "Otros por area" ${filaAgrupada} -> ${nuevaAgrupada}`);

const totalDespues = Number((await leer(EGRESOS, "S4:S4", "UNFORMATTED_VALUE"))[0][0]);
console.log(`TOTAL despues: S/${totalDespues.toLocaleString("es-PE")}`);
if (Math.abs(totalDespues - totalAntes) > 0.01) {
  throw new Error(`El total se movio (${totalAntes} -> ${totalDespues}). Restaurar ${RESPALDO}.`);
}
console.log("OK: se movieron filas, no plata.");
