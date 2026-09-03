// Indice compacto de "Reporte Egresos": fila | codigo | etiqueta | formula-tipo.
import { google } from "googleapis";
const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });
const { data } = await sheets.spreadsheets.values.batchGet({
  spreadsheetId: LIBRO,
  ranges: ["'Reporte Egresos'!A1:T400"],
  valueRenderOption: "FORMULA",
});
const egr = data.valueRanges[0].values ?? [];
const tipo = (f) => {
  const s = String(f ?? "");
  if (!s.startsWith("=")) return s === "" ? "" : "valor";
  if (s.includes("Fuente Principal")) return "link";
  if (s.includes("Reporte Contabilidaad")) return "contab";
  return s.slice(0, 60);
};
egr.forEach((f, i) => {
  const [a, b, c] = [f?.[0] ?? "", f?.[1] ?? "", f?.[2] ?? ""];
  if (!a && !b && !c) return;
  console.log(`${i + 1}\t${b}\t${c}\t${tipo(f?.[6])}`);
});
