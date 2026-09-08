// Sonda: fila | codigo(B) | concepto(C) | area(D) | seccion(E) | TOTAL(S) de "Reporte Egresos".
import { google } from "googleapis";
const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });
const { data } = await sheets.spreadsheets.values.get({
  spreadsheetId: LIBRO, range: "'Reporte Egresos'!A1:S400",
  valueRenderOption: "UNFORMATTED_VALUE",
});
const num = (v) => typeof v === "number" ? v.toLocaleString("es-PE", { maximumFractionDigits: 0 }) : "";
(data.values ?? []).forEach((f, i) => {
  if (!f || f.every((c) => c === "" || c == null)) return;
  console.log([i + 1, f[0] ?? "", f[1] ?? "", f[2] ?? "", f[3] ?? "", f[4] ?? "", num(f[18])].join(" | "));
});
