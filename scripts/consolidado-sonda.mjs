// Sonda de lectura del "Reporte Consolidado" y del indice de subtotales de
// "Reporte Egresos". Solo lee: sirve para mapear etiqueta -> fila origen.
import { google } from "googleapis";
const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });
const { data } = await sheets.spreadsheets.values.batchGet({
  spreadsheetId: LIBRO,
  ranges: ["'Reporte Consolidado'!A1:Z120", "'Reporte Egresos'!A1:S400"],
  valueRenderOption: "FORMULA",
});
const [cons, egr] = data.valueRanges.map((r) => r.values ?? []);
console.log("=== Reporte Consolidado ===");
cons.forEach((f, i) => console.log(`${i + 1}|${(f ?? []).join(" | ")}`));
console.log("\n=== Reporte Egresos (A..G) ===");
egr.forEach((f, i) => console.log(`${i + 1}|${(f ?? []).slice(0, 7).join(" | ")}`));
