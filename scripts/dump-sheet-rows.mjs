// Vuelca fila por fila una pestaña (con fórmulas) para inspeccionar plantillas.
// Uso: node scripts/dump-sheet-rows.mjs <spreadsheetId> "<Pestaña>" [--cols 20] [--values]
import { google } from "googleapis";

const maxCols = Number(flag("--cols") ?? 20);
const flagValues = new Set([flag("--cols")]);
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--") && !flagValues.has(a));
const [spreadsheetId, ...tabs] = positional;
const render = process.argv.includes("--values") ? "UNFORMATTED_VALUE" : "FORMULA";

function flag(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

for (const tab of tabs) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'`,
    valueRenderOption: render,
  });
  console.log(`\n########## ${tab} ##########`);
  (data.values ?? []).forEach((row, i) => {
    const line = row.slice(0, maxCols).map((v) => String(v ?? "")).join(" | ").replace(/(\s*\|)+\s*$/, "");
    if (line.trim()) console.log(String(i + 1).padStart(4) + ": " + line);
  });
}
