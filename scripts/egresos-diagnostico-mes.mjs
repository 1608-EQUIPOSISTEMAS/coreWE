// Desarma la brecha de un mes entre "Reporte Egresos" y el libro de contabilidad.
// El verificador (egresos-verificar-cuadre.mjs) dice QUE no cuadra; esto dice
// CUANTO aporta cada causa, que es lo que hay que llevarle a contabilidad.
//
// Uso: node scripts/egresos-diagnostico-mes.mjs [1..12]   (por defecto, julio)
import { google } from "googleapis";

const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO",
               "AGOSTO", "SETIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
// Conceptos que el libro solo lleva agregados: su unica fuente es la pestana
// manual "Reporte Contabilidaad". Ver [[essalud-renta5ta-por-area]].
// El libro escribe "2.81" donde el reporte usa "2.8.1-TALENTO": el cruce es por
// literal, asi que la equivalencia hay que declararla.
const DESGLOSE_MANUAL = [["1.4.7", "1.4.7"], ["1.4.5", "1.4.5"],
                         ["2.81", "2.8.1"], ["2.82", "2.8.2"], ["2.84", "2.8.4"]];
const TOLERANCIA = 0.01;
const mes = (Number(process.argv[2]) || 7) - 1;

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
const enSoles = (fila) => {
  const usd = num(fila[5 + mes * 2]);
  return num(fila[4 + mes * 2]) + (usd === 0 ? 0 : usd * (tipoCambio.get(202601 + mes) ?? 0));
};

const libro = new Map();
for (const fila of fuente) {
  const codigo = String(fila?.[0] ?? "").trim();
  // El libro escribe "2.81" donde queria decir "2.8.1": se acepta tal cual,
  // porque el cruce con el reporte es por el literal de la columna.
  if (!/^\d+\.\d+(\.\d+)?$/.test(codigo)) continue;
  libro.set(codigo, { concepto: String(fila?.[1] ?? "").trim(), importe: enSoles(fila) });
}

const enReporte = new Map();
for (const fila of reporte) {
  const raiz = String(fila?.[0] ?? "").trim().split("-")[0];
  if (!/^\d+\.\d+(\.\d+)?$/.test(raiz)) continue;
  enReporte.set(raiz, (enReporte.get(raiz) ?? 0) + num(fila[5 + mes]));
}

const totalDelLibro = num(fuente[1][4 + mes * 2]);
const totalDelReporte = [...enReporte.values()].reduce((a, b) => a + b, 0);
const linea = (etiqueta, importe) => console.log(`  ${etiqueta.padEnd(52)} S/${importe.toFixed(2).padStart(10)}`);

console.log(`\n${MESES[mes]}: libro S/${totalDelLibro.toFixed(2)} vs reporte S/${totalDelReporte.toFixed(2)} = S/${(totalDelReporte - totalDelLibro).toFixed(2)}`);

console.log("\nA. DESGLOSE MANUAL SIN LLENAR (pestana 'Reporte Contabilidaad')");
let manual = 0;
for (const [codigo, raizEnReporte] of DESGLOSE_MANUAL) {
  const brecha = (libro.get(codigo)?.importe ?? 0) - (enReporte.get(raizEnReporte) ?? 0);
  if (Math.abs(brecha) < TOLERANCIA) continue;
  linea(`${codigo} ${libro.get(codigo)?.concepto ?? ""}`, brecha);
  manual += brecha;
}
linea("subtotal", manual);

console.log("\nB. CODIGOS DEL LIBRO SIN FILA EN EL REPORTE");
let huerfanos = 0;
for (const [codigo, d] of libro) {
  // Solo partidas de 3 niveles: un rubro x.y ya viene contado por sus hijos.
  if (!/^\d+\.\d+\.\d+$/.test(codigo)) continue;
  if (enReporte.has(codigo) || Math.abs(d.importe) < TOLERANCIA) continue;
  linea(`${codigo} ${d.concepto}`, d.importe);
  huerfanos += d.importe;
}
linea("subtotal", huerfanos);

// Un rubro que no iguala a sus hijos es plata colgada de una fila intermedia:
// asi aparecieron "2.81" y "2.84", que el libro escribio sin el tercer punto.
console.log("\nC. RUBROS x.y QUE NO IGUALAN A SUS HIJOS");
for (const [codigo, d] of libro) {
  if (!/^\d+\.\d+$/.test(codigo)) continue;
  const hijos = [...libro].filter(([c]) => c.startsWith(`${codigo}.`)).reduce((a, [, h]) => a + h.importe, 0);
  if (Math.abs(d.importe - hijos) > TOLERANCIA) linea(`${codigo} ${d.concepto}`, d.importe - hijos);
}

console.log("\nD. RESTO SIN EXPLICAR");
linea("brecha total", totalDelLibro - totalDelReporte);
linea("sin explicar", totalDelLibro - totalDelReporte - manual - huerfanos);
