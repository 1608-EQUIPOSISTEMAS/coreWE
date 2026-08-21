// Guarda de cuadre de "Reporte Egresos" contra el libro de contabilidad.
// Corre las tres comprobaciones que costaron encontrar y no se detectaban solas:
//
//   1. El desglose por area de ESSALUD / RENTA DE 5TA CTG iguala al agregado.
//   2. Ningun codigo con importe se quedo sin fila en el reporte.
//   3. Ningun codigo se cuenta dos veces, y el total mensual iguala al libro.
//
// Sale con codigo 1 si algo no cuadra, para poder encadenarla en un script.
// Uso: node scripts/egresos-verificar-cuadre.mjs
import { google } from "googleapis";

const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
               "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DESGLOSADOS = [["1.4.7", "ESSALUD"], ["1.4.5", "RENTA DE 5TA CTG"]];
const TOLERANCIA = 0.01;

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });
const { data } = await sheets.spreadsheets.values.batchGet({
  spreadsheetId: LIBRO,
  ranges: ["'Fuente Principal'!A1:AB1000", "Control!A:B", "'Reporte Egresos'!B1:S400"],
  valueRenderOption: "UNFORMATTED_VALUE",
});
const [fuente, control, reporte] = data.valueRanges.map((r) => r.values ?? []);

const num = (v) => (typeof v === "number" ? v : 0);
const tipoCambio = new Map(control.map((f) => [f[0], num(f[1])]));
const esPartida = (codigo) => /^\d+\.\d+\.\d+$/.test(codigo);

// Layout de la fuente: cada mes ocupa dos columnas (PEN, USD) desde la E.
const consolidarEnSoles = (fila) => MESES.map((_, i) => {
  const usd = num(fila[5 + i * 2]);
  return num(fila[4 + i * 2]) + (usd === 0 ? 0 : usd * (tipoCambio.get(202601 + i) ?? 0));
});

const libro = new Map();
let rubro = "";
for (const fila of fuente) {
  const codigo = String(fila?.[0] ?? "").trim();
  const concepto = String(fila?.[1] ?? "").trim();
  if (!esPartida(codigo)) { if (concepto) rubro = concepto; continue; }
  const meses = consolidarEnSoles(fila);
  libro.set(codigo, { concepto, rubro, meses, total: meses.reduce((a, b) => a + b, 0) });
}
// La fila de control no sigue el layout PEN/USD del resto: su segunda columna
// por mes es la variacion, no dolares. Ya viene consolidada en soles.
const egresoTotalDelLibro = MESES.map((_, i) => num(fuente[1][4 + i * 2]));

// Las filas del reporte se agrupan por su codigo raiz: "1.4.7-B2B" cuenta como
// una porcion de 1.4.7, no como un codigo distinto.
const enReporte = new Map();
reporte.forEach((fila, i) => {
  const bruto = String(fila?.[0] ?? "").trim();
  if (!esPartida(bruto.split("-")[0])) return;
  const raiz = bruto.split("-")[0];
  if (!enReporte.has(raiz)) enReporte.set(raiz, []);
  enReporte.get(raiz).push({
    fila: i + 1,
    etiqueta: String(fila?.[1] ?? "").trim(),
    derivado: bruto !== raiz,
    meses: MESES.map((_, m) => num(fila[5 + m])),
  });
});

let fallas = 0;
const marcar = (mensaje) => { fallas += 1; console.log(`  FALLA  ${mensaje}`); };

console.log("\n1. DESGLOSE POR AREA");
for (const [codigo, etiqueta] of DESGLOSADOS) {
  const filas = enReporte.get(codigo) ?? [];
  const esperado = libro.get(codigo)?.meses ?? [];
  const obtenido = MESES.map((_, i) => filas.reduce((suma, f) => suma + f.meses[i], 0));
  const desviados = MESES.filter((_, i) => Math.abs(obtenido[i] - esperado[i]) > TOLERANCIA);
  const total = obtenido.reduce((a, b) => a + b, 0);
  if (desviados.length) marcar(`${etiqueta}: no cuadra en ${desviados.join(", ")}`);
  else console.log(`  OK     ${etiqueta.padEnd(18)} ${filas.length} areas   S/${total.toFixed(2)}`);
}

console.log("\n2. CODIGOS CON IMPORTE SIN FILA EN EL REPORTE");
const huerfanos = [...libro.entries()]
  .filter(([codigo, d]) => Math.abs(d.total) > TOLERANCIA && !enReporte.has(codigo))
  .sort((a, b) => b[1].total - a[1].total);
if (huerfanos.length) {
  for (const [codigo, d] of huerfanos) marcar(`${codigo} ${d.concepto} (${d.rubro}) S/${d.total.toFixed(2)}`);
} else {
  const enCero = [...libro.keys()].filter((c) => !enReporte.has(c)).length;
  console.log(`  OK     ninguno (${enCero} codigos sin fila, todos en cero)`);
}

console.log("\n3. CODIGOS CONTADOS DOS VECES");
const duplicados = [...enReporte.entries()].filter(([, filas]) =>
  filas.length > 1 && filas.some((f) => !f.derivado) && filas.filter((f) => !f.derivado).length > 1);
if (duplicados.length) {
  for (const [codigo, filas] of duplicados) marcar(`${codigo} en filas ${filas.map((f) => f.fila).join(", ")}`);
} else {
  console.log("  OK     ninguno");
}

console.log("\n4. TOTAL MENSUAL: REPORTE vs LIBRO");
const totalDelReporte = MESES.map((_, i) =>
  [...enReporte.values()].flat().reduce((suma, f) => suma + f.meses[i], 0));
MESES.forEach((mes, i) => {
  const diferencia = totalDelReporte[i] - egresoTotalDelLibro[i];
  if (Math.abs(diferencia) > TOLERANCIA) {
    marcar(`${mes}: reporte ${totalDelReporte[i].toFixed(2)} vs libro ${egresoTotalDelLibro[i].toFixed(2)} (${diferencia.toFixed(2)})`);
    return;
  }
  if (egresoTotalDelLibro[i] === 0) return;
  console.log(`  OK     ${mes.padEnd(11)} S/${totalDelReporte[i].toFixed(2).padStart(12)}`);
});
const sumaReporte = totalDelReporte.reduce((a, b) => a + b, 0);
const sumaLibro = egresoTotalDelLibro.reduce((a, b) => a + b, 0);
console.log(`  ${Math.abs(sumaReporte - sumaLibro) > TOLERANCIA ? "FALLA " : "OK    "} ${"ANO".padEnd(11)} S/${sumaReporte.toFixed(2).padStart(12)}   libro S/${sumaLibro.toFixed(2)}`);
if (Math.abs(sumaReporte - sumaLibro) > TOLERANCIA) fallas += 1;

console.log(fallas ? `\n${fallas} comprobacion(es) fallaron.` : "\nCuadra todo.");
process.exit(fallas ? 1 : 0);
