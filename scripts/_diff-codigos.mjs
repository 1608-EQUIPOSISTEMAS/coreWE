import { google } from "googleapis";
const ID = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const auth = new google.auth.GoogleAuth({ keyFile: "credentials/service.json", scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });
const { data } = await sheets.spreadsheets.values.batchGet({
  spreadsheetId: ID,
  ranges: ["'Fuente Principal'!A1:AB1000", "Control!A:B", "'Reporte Egresos'!B1:C310"],
  valueRenderOption: "UNFORMATTED_VALUE",
});
const [fuente, control, reporte] = data.valueRanges.map(r => r.values ?? []);
const num = v => typeof v === "number" ? v : 0;
const tc = new Map(control.map(f => [f[0], num(f[1])]));
const esPartida = c => /^\d+\.\d+\.\d+$/.test(c);
const meses = fila => Array.from({length:12}, (_,i) => { const u = num(fila[5+i*2]); return num(fila[4+i*2]) + (u===0?0:u*(tc.get(202601+i)??0)); });

const libro = new Map();
let rubro = "";
for (const f of fuente) {
  const cod = String(f?.[0] ?? "").trim(), con = String(f?.[1] ?? "").trim();
  if (!esPartida(cod)) { if (con) rubro = con; continue; }
  const m = meses(f);
  libro.set(cod, { concepto: con, rubro, meses: m, total: m.reduce((a,b)=>a+b,0) });
}

const enReporte = new Map();
reporte.forEach((f, i) => {
  const raw = String(f?.[0] ?? "").trim();
  if (!raw) return;
  const cod = raw.split("-")[0];
  if (!enReporte.has(cod)) enReporte.set(cod, []);
  enReporte.get(cod).push({ fila: i+1, etiqueta: String(f?.[1] ?? "").trim(), derivado: raw !== cod });
});

const faltantes = [...libro.entries()].filter(([c]) => !enReporte.has(c));
console.log(`\n=== ${faltantes.length} CODIGOS DEL LIBRO SIN FILA EN EL REPORTE ===`);
faltantes.sort((a,b) => b[1].total - a[1].total);
let suma = 0;
for (const [c, d] of faltantes) { suma += d.total; console.log(`  ${c.padEnd(9)} ${d.concepto.padEnd(38)} ${d.rubro.padEnd(22)} ${d.total.toFixed(2).padStart(11)}`); }
console.log(`  ${"".padEnd(9)} ${"TOTAL FALTANTE".padEnd(61)} ${suma.toFixed(2).padStart(11)}`);

console.log(`\n=== CODIGOS REPETIDOS EN EL REPORTE (posible doble conteo) ===`);
for (const [c, filas] of enReporte) {
  if (filas.length < 2 || filas[0].derivado) continue;
  console.log(`  ${c}  x${filas.length}  ${filas.map(f=>`f${f.fila} ${f.etiqueta}`).join(" | ")}   libro=${(libro.get(c)?.total ?? 0).toFixed(2)}`);
}

console.log(`\n=== CODIGOS EN EL REPORTE QUE NO EXISTEN EN EL LIBRO ===`);
for (const [c, filas] of enReporte) if (!libro.has(c)) console.log(`  ${c}  ${filas.map(f=>`f${f.fila} ${f.etiqueta}`).join(" | ")}`);

const totalLibro = [...libro.values()].reduce((a,d)=>a+d.total,0);
console.log(`\nTOTAL LIBRO (partidas 3 niveles): ${totalLibro.toFixed(2)}`);
