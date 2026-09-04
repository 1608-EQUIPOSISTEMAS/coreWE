// Sonda de lectura del "Reporte Consolidado": fila | codigo | concepto | Enero | TOTAL.
import { google } from "googleapis";
const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });
const { data } = await sheets.spreadsheets.values.get({
  spreadsheetId: LIBRO, range: "'Reporte Consolidado'!A1:T200",
  valueRenderOption: "UNFORMATTED_VALUE",
});
const s = (v) => typeof v === "number"
  ? v.toLocaleString("es-PE", { maximumFractionDigits: 0 }) : String(v ?? "");
(data.values ?? []).forEach((f, i) => {
  if (!f?.[2]) return;
  console.log(`${i + 1}\t${f[0] ?? ""}\t${f[1] ?? ""}\t${f[2]}\t${s(f[7])}\t${s(f[19])}`);
});
