// Reconcilia el FC-EGRESOS (fuente) contra la plantilla "Reporte Egresos" (destino).
// Responde: ¿qué códigos de la fuente NO tienen fila en la plantilla, y cuánto suman?
// Uso: node scripts/egresos-reconciliar-junio.mjs [--mes JUNIO]
import { google } from "googleapis";

const FUENTE = "17s8lele1C0IMuuvruWTlGxLJvnuQYg96HLJKR0KGDM4";
const DESTINO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const HOJA_FUENTE = "0. FC - EGRESOS ";

// En la fuente cada mes ocupa DOS columnas: PEN y USD. Enero arranca en E (índice 4).
const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO",
               "AGOSTO", "SETIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const iMes = process.argv.indexOf("--mes");
const mes = (iMes === -1 ? "JUNIO" : process.argv[iMes + 1]).toUpperCase();
const colPen = 4 + MESES.indexOf(mes) * 2;
const colUsd = colPen + 1;
const FILA_TIPO_CAMBIO = 4; // fila 5 de la hoja

const esHoja = (codigo) => /^\d+\.\d+\.\d+$/.test(String(codigo).trim());
const num = (v) => (typeof v === "number" ? v : 0);
const soles = (n) => n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

const leer = async (spreadsheetId, rango) =>
  (await sheets.spreadsheets.values.get({ spreadsheetId, range: rango, valueRenderOption: "UNFORMATTED_VALUE" }))
    .data.values ?? [];

const fuente = await leer(FUENTE, `'${HOJA_FUENTE}'`);
const plantilla = await leer(DESTINO, "'Reporte Egresos'");

const tipoCambio = num(fuente[FILA_TIPO_CAMBIO][colPen]);

const partidas = fuente
  .map((fila, i) => ({
    codigo: String(fila[0] ?? "").trim(),
    concepto: String(fila[1] ?? "").trim(),
    pen: num(fila[colPen]),
    usd: num(fila[colUsd]),
    filaHoja: i + 1,
  }))
  .filter((p) => esHoja(p.codigo));

partidas.forEach((p) => (p.soles = p.pen + p.usd * tipoCambio));

const enPlantilla = new Set(
  plantilla.map((f) => String(f[1] ?? "").trim()).filter(esHoja)
);

const mapeadas = partidas.filter((p) => enPlantilla.has(p.codigo));
const huerfanas = partidas.filter((p) => !enPlantilla.has(p.codigo) && p.soles !== 0);
const inventadas = [...enPlantilla].filter((c) => !partidas.some((p) => p.codigo === c));

const suma = (xs) => xs.reduce((a, p) => a + p.soles, 0);
const control = num(fuente[1][colPen]); // fila 2: EGRESO TOTAL EN SOLES

console.log(`MES ${mes}   TC ${tipoCambio}`);
console.log(`Control (fila 'EGRESO TOTAL EN SOLES'): ${soles(control)}`);
console.log(`Suma de partidas hoja de la fuente:     ${soles(suma(partidas))}`);
console.log(`  → mapeadas a la plantilla:            ${soles(suma(mapeadas))}  (${mapeadas.length} códigos)`);
console.log(`  → SIN fila en la plantilla:           ${soles(suma(huerfanas))}  (${huerfanas.length} códigos)\n`);

console.log(`── Partidas con monto en ${mes} que la plantilla NO contempla ──`);
huerfanas
  .sort((a, b) => b.soles - a.soles)
  .forEach((p) => console.log(`  ${p.codigo.padEnd(9)} ${p.concepto.padEnd(42)} ${soles(p.soles).padStart(12)}`));

console.log(`\n── Códigos que la plantilla pide y NO existen en la fuente (${inventadas.length}) ──`);
inventadas.forEach((c) => console.log(`  ${c}`));

// Un código repetido en la plantilla duplicaría el monto de la fuente al cargarlo.
const vecesEnPlantilla = new Map();
plantilla.forEach((f, i) => {
  const codigo = String(f[1] ?? "").trim();
  if (esHoja(codigo)) vecesEnPlantilla.set(codigo, [...(vecesEnPlantilla.get(codigo) ?? []), i + 1]);
});
const repetidos = [...vecesEnPlantilla].filter(([, filas]) => filas.length > 1);
console.log(`\n── Códigos DUPLICADOS en la plantilla (duplicarían el monto) (${repetidos.length}) ──`);
repetidos.forEach(([codigo, filas]) => {
  const p = partidas.find((x) => x.codigo === codigo);
  console.log(`  ${codigo.padEnd(9)} ${(p?.concepto ?? "").padEnd(30)} filas ${filas.join(", ")}  ${soles(p?.soles ?? 0)}`);
});

// Filas de detalle sin código: la plantilla pide una apertura que la fuente no tiene.
const sinCodigo = plantilla
  .map((f, i) => ({ fila: i + 1, concepto: String(f[2] ?? "").trim(), area: String(f[3] ?? "").trim() }))
  .filter((r) => r.area && !esHoja(String(plantilla[r.fila - 1][1] ?? "").trim()));
console.log(`\n── Filas de la plantilla SIN código de origen (${sinCodigo.length}) ──`);
sinCodigo.forEach((r) => console.log(`  fila ${String(r.fila).padStart(3)}  ${r.concepto.padEnd(38)} ${r.area}`));
