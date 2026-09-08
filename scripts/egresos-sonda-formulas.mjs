// Sonda de formulas: columna G de "Reporte Egresos" y columna H de "Reporte Consolidado".
import { google } from "googleapis";
const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });
const { data } = await sheets.spreadsheets.values.batchGet({
  spreadsheetId: LIBRO,
  ranges: ["'Reporte Egresos'!A1:S400", "'Reporte Consolidado'!A1:T200"],
  valueRenderOption: "FORMULA",
});
const [egr, con] = data.valueRanges;
const filas = process.argv[2] === "consolidado" ? con.values : egr.values;
const col = process.argv[2] === "consolidado" ? 7 : 6;
(filas ?? []).forEach((f, i) => {
  if (!f || f.every((c) => c === "" || c == null)) return;
  console.log(`${i + 1} | ${f[0] ?? ""} | ${f[1] ?? ""} | ${f[2] ?? ""} | ${String(f[col] ?? "").slice(0, 160)}`);
});
