// Guarda del "Reporte Consolidado": cada mes tiene que igualar al total general
// de "Reporte Egresos" (y por tanto al libro). Sale con codigo 1 si no cuadra.
// Uso: node scripts/consolidado-verificar.mjs
import { google } from "googleapis";
const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });
const { data } = await sheets.spreadsheets.values.batchGet({
  spreadsheetId: LIBRO,
  ranges: ["'Reporte Egresos'!A1:T400", "'Reporte Consolidado'!A1:T200"],
  valueRenderOption: "UNFORMATTED_VALUE",
});
const [egr, cons] = data.valueRanges.map((r) => r.values ?? []);
const num = (v) => (typeof v === "number" ? v : 0);
const buscar = (hoja, texto, col) =>
  hoja.find((f) => String(f?.[2] ?? "").toUpperCase().startsWith(texto))?.slice(col) ?? [];
const totalEgresos = egr[3].slice(6, 18).map(num);
const totalCons = buscar(cons, "TOTAL GENERAL", 7).slice(0, 12).map(num);
const centCons = buscar(cons, "NO CLASIFICADO", 7).slice(0, 12).map(num);
const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Set","Oct","Nov","Dic"];
const s = (n) => n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let falla = false;
console.log("mes\tEgresos\tConsolidado\tdif\tno clasificado");
MESES.forEach((m, k) => {
  const dif = totalCons[k] - totalEgresos[k];
  if (Math.abs(dif) > 0.01) falla = true;
  console.log(`${m}\t${s(totalEgresos[k])}\t${s(totalCons[k])}\t${s(dif)}\t${s(centCons[k])}`);
});
console.log(`\nAÑO\t${s(totalEgresos.reduce((a,b)=>a+b,0))}\t${s(totalCons.reduce((a,b)=>a+b,0))}`);
if (falla) { console.error("El Consolidado NO cuadra con Reporte Egresos."); process.exit(1); }
console.log("OK: el Consolidado cuadra con Reporte Egresos en los 12 meses.");
