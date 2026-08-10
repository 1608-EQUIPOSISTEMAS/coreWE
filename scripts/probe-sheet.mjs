// Sonda de un Google Sheet: pestañas, encabezados, muestra y llenado por columna.
// Uso: node scripts/probe-sheet.mjs <spreadsheetId> [--tab "Nombre"] [--rows 5]
import { google } from "googleapis";

const [spreadsheetId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const tabFilter = argOf("--tab");
const sampleRows = Number(argOf("--rows") ?? 5);

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function sheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: "credentials/service.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth: await auth.getClient() });
}

const cut = (s, n = 28) => (String(s ?? "").length > n ? String(s).slice(0, n - 1) + "…" : String(s ?? ""));

async function main() {
  const sheets = await sheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title,sheets.properties" });
  console.log(`SPREADSHEET: ${meta.data.properties.title}\n`);

  const tabs = meta.data.sheets
    .map((s) => s.properties)
    .filter((p) => !tabFilter || p.title === tabFilter);

  for (const p of tabs) {
    console.log(`── ${p.title}  (gid ${p.sheetId}, grid ${p.gridProperties.rowCount}x${p.gridProperties.columnCount}${p.hidden ? ", OCULTA" : ""})`);
  }
  if (!tabFilter) console.log();

  for (const p of tabs) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${p.title}'`,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    const rows = res.data.values ?? [];
    console.log(`\n=== ${p.title} — ${rows.length} filas con datos ===`);
    if (!rows.length) continue;

    const width = Math.max(...rows.map((r) => r.length));
    const header = rows[0];
    const body = rows.slice(1);

    for (let c = 0; c < width; c++) {
      const vals = body.map((r) => r[c]).filter((v) => v !== undefined && v !== "");
      const uniq = new Set(vals.map(String));
      const muestra = [...uniq].slice(0, 3).map((v) => cut(v, 22)).join(" | ");
      console.log(
        `  [${colLetter(c)}] ${cut(header?.[c] ?? "(sin título)", 34).padEnd(34)} ` +
          `llenas ${String(vals.length).padStart(5)}/${body.length}  únicos ${String(uniq.size).padStart(5)}  ej: ${muestra}`
      );
    }

    console.log(`\n  Primeras ${sampleRows} filas:`);
    for (const r of body.slice(0, sampleRows)) console.log("   ", r.map((v) => cut(v, 18)).join(" ‖ "));
  }
}

function colLetter(i) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
