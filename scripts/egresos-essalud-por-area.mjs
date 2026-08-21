// Coloca ESSALUD (1.4.7) y RENTA DE 5TA CTG (1.4.5) desglosados por area en
// "Reporte Egresos". Ambos codigos existen en el libro de contabilidad solo
// agregados a nivel GENERAL, por eso hasta ahora no tenian fila y el reporte
// perdia S/23.297.
//
// El desglose por area lo mantiene contabilidad a mano en la pestana
// "Essalud-Rta5taCtg"; aqui NO se copian valores, se enlazan por formula para
// que julio en adelante se llene solo cuando ellos actualicen esa pestana.
//
// Uso: node scripts/egresos-essalud-por-area.mjs [--dry]
import { google } from "googleapis";

const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const REPORTE = "Reporte Egresos";
const DESGLOSE = "Essalud-Rta5taCtg";
const HOJA_REPORTE_ID = 1440644810;

// Fila del reporte <-> fila del desglose. El orden de areas difiere entre las
// dos pestanas (el reporte pone Marketing primero, el desglose Comercial), por
// eso el mapeo es explicito y no un MATCH por nombre: los acentos y el prefijo
// "a. " del desglose hacen que el cruce por texto sea fragil.
const AREAS = [
  { clave: "MARKETING",    reporte: { essalud: 18,  renta: 19  }, desglose: { essalud: 6,  renta: 22 } },
  { clave: "COMERCIAL",    reporte: { essalud: 27,  renta: 28  }, desglose: { essalud: 5,  renta: 21 } },
  { clave: "PRODUCTO",     reporte: { essalud: 36,  renta: 37  }, desglose: { essalud: 7,  renta: 23 } },
  { clave: "EXPERIENCIA",  reporte: { essalud: 46,  renta: 47  }, desglose: { essalud: 8,  renta: 24 } },
  { clave: "FINANZAS",     reporte: { essalud: 55,  renta: 56  }, desglose: { essalud: 9,  renta: 25 } },
  { clave: "CONTABILIDAD", reporte: { essalud: 64,  renta: 65  }, desglose: { essalud: 10, renta: 26 } },
  { clave: "SISTEMAS",     reporte: { essalud: 72,  renta: 73  }, desglose: { essalud: 11, renta: 27 } },
  { clave: "TALENTO",      reporte: { essalud: 81,  renta: 82  }, desglose: { essalud: 13, renta: 29 } },
  { clave: "B2B",          reporte: { essalud: 92,  renta: 93  }, desglose: { essalud: 12, renta: 28 } },
  { clave: "FUNDACION",    reporte: { essalud: 102, renta: 103 }, desglose: { essalud: 14, renta: 30 } },
];

// "a. asesores externos" (S/305 al mes) no corresponde a ningun area del reporte:
// es Essalud de personal externo repartido entre varias. Repartirlo sin criterio
// contable seria inventar cifras, asi que se le abre bloque propio al final de
// PERSONAL Y PLANILLAS y el total cuadra sin tocar los subtotales de las demas.
const BLOQUE_NUEVO = {
  clave: "ASESORES EXTERNOS",
  filaAncla: 104,                                    // Subtotal - Fundación WE
  desglose: { essalud: 15, renta: 31 },
};
const FILA_SUBTOTAL_SECCION = 105;                   // SUB TOTAL PERSONAL Y PLANILLAS
const SUBTOTALES_AREA = [104, 94, 83, 74, 66, 57, 48, 38, 29, 20];

const CODIGOS = { essalud: "1.4.7", renta: "1.4.5" };
const ETIQUETAS = { essalud: "ESSALUD", renta: "RENTA DE 5TA CTG" };
const MESES = 12;
const PRIMERA_COL_MES = 7;                           // G

const dry = process.argv.includes("--dry");
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

// COLUMN()-6 convierte G..R en 1..12, el mismo indice que usan las formulas ya
// existentes de la hoja; asi la formula es una sola para las doce columnas.
const formulaMes = (filaDesglose) =>
  `=N(INDEX('${DESGLOSE}'!$B$${filaDesglose}:$M$${filaDesglose};COLUMN()-6))`;
const formulaTotalFila = (fila) => `=SUM(G${fila}:R${fila})`;

// Las filas de area ya traen su descripcion (C:F) correcta desde la plantilla;
// escribirla de nuevo borraria el CENTRO DE COSTO, asi que solo se tocan el
// codigo y los importes.
const filaDeConcepto = (concepto, fila, filaDesglose, clave) => [
  { range: `'${REPORTE}'!B${fila}`, values: [[`${CODIGOS[concepto]}-${clave}`]] },
  {
    range: `'${REPORTE}'!G${fila}:S${fila}`,
    values: [[...Array(MESES).fill(formulaMes(filaDesglose)), formulaTotalFila(fila)]],
  },
];

const filaDeConceptoNueva = (concepto, fila, filaDesglose, clave) => [
  {
    range: `'${REPORTE}'!C${fila}:F${fila}`,
    values: [[ETIQUETAS[concepto], "GENERAL", "2. Personal y Planillas", "Administración"]],
  },
  ...filaDeConcepto(concepto, fila, filaDesglose, clave),
];

async function insertarBloqueAsesoresExternos() {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: LIBRO,
    range: `'${REPORTE}'!C${BLOQUE_NUEVO.filaAncla + 1}`,
  });
  const yaExiste = String(data.values?.[0]?.[0] ?? "").trim() === BLOQUE_NUEVO.clave;
  if (yaExiste) return false;

  const desde = BLOQUE_NUEVO.filaAncla;             // 0-based: inserta justo debajo
  const rango = (inicio, fin) => ({
    sheetId: HOJA_REPORTE_ID, startRowIndex: inicio, endRowIndex: fin,
    startColumnIndex: 0, endColumnIndex: 20,
  });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: LIBRO,
    requestBody: {
      requests: [
        { insertDimension: { range: { sheetId: HOJA_REPORTE_ID, dimension: "ROWS", startIndex: desde, endIndex: desde + 4 }, inheritFromBefore: false } },
        // El formato se clona del bloque Fundación WE (encabezado, dos partidas y
        // subtotal) para que el bloque nuevo no desentone con el resto.
        { copyPaste: { source: rango(94, 95),   destination: rango(desde, desde + 1),         pasteType: "PASTE_FORMAT" } },
        { copyPaste: { source: rango(101, 103), destination: rango(desde + 1, desde + 3),     pasteType: "PASTE_FORMAT" } },
        { copyPaste: { source: rango(103, 104), destination: rango(desde + 3, desde + 4),     pasteType: "PASTE_FORMAT" } },
      ],
    },
  });
  return true;
}

const actualizaciones = AREAS.flatMap(({ clave, reporte, desglose }) => [
  ...filaDeConcepto("essalud", reporte.essalud, desglose.essalud, clave),
  ...filaDeConcepto("renta", reporte.renta, desglose.renta, clave),
]);

if (dry) {
  console.log(`[dry] ${actualizaciones.length} filas de area + bloque "${BLOQUE_NUEVO.clave}"`);
  for (const u of actualizaciones) console.log(`  ${u.range}`);
  process.exit(0);
}

const seInserto = await insertarBloqueAsesoresExternos();
console.log(seInserto ? `Bloque "${BLOQUE_NUEVO.clave}" insertado.` : `Bloque "${BLOQUE_NUEVO.clave}" ya existia.`);

const cab = BLOQUE_NUEVO.filaAncla + 1;
const [fEssalud, fRenta, fSubtotal] = [cab + 1, cab + 2, cab + 3];
actualizaciones.push(
  { range: `'${REPORTE}'!C${cab}`, values: [[BLOQUE_NUEVO.clave]] },
  ...filaDeConceptoNueva("essalud", fEssalud, BLOQUE_NUEVO.desglose.essalud, BLOQUE_NUEVO.clave),
  ...filaDeConceptoNueva("renta", fRenta, BLOQUE_NUEVO.desglose.renta, BLOQUE_NUEVO.clave),
  {
    range: `'${REPORTE}'!C${fSubtotal}:S${fSubtotal}`,
    values: [[
      `Subtotal - ${BLOQUE_NUEVO.clave}`, null, null, null,
      ...Array.from({ length: MESES }, (_, i) => {
        const col = String.fromCharCode(64 + PRIMERA_COL_MES + i);
        return `=SUM(${col}${fEssalud}:${col}${fRenta})`;
      }),
      `=SUM(S${fEssalud}:S${fRenta})`,
    ]],
  },
  {
    // El subtotal de seccion enumera los subtotales de area uno a uno; hay que
    // sumarle el bloque nuevo a mano porque no es un rango contiguo.
    range: `'${REPORTE}'!G${FILA_SUBTOTAL_SECCION + 4}:S${FILA_SUBTOTAL_SECCION + 4}`,
    values: [Array.from({ length: MESES + 1 }, (_, i) => {
      const col = String.fromCharCode(64 + PRIMERA_COL_MES + i);
      return `=SUM(${[fSubtotal, ...SUBTOTALES_AREA].map((f) => `${col}${f}`).join(";")})`;
    })],
  },
);

await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: LIBRO,
  requestBody: { valueInputOption: "USER_ENTERED", data: actualizaciones },
});
console.log(`${actualizaciones.length} rangos escritos.`);
