// Llena la pestana "Reporte Consolidado" del libro Reporte Gastos.
//
// El Consolidado NO es una fuente nueva: es una reagrupacion del "Reporte
// Egresos", que ya resolvio PEN + USD x tipo de cambio. Por eso cada fila
// apunta a celdas de esa pestana y no vuelve a jalar del libro de contabilidad
// (dos copias de esa formula divergirian).
//
//   fila con codigo en B -> la fila de Egresos que tiene ese mismo codigo
//   fila "AGRUPADO"      -> el subtotal del sub-bloque homonimo de Egresos
//
// El reparto es una PARTICION: cada fila de detalle de Egresos cae en una sola
// fila del Consolidado. El script lo verifica y aborta si alguna queda fuera o
// se cuenta dos veces. Cierra con una fila centinela
// (total de Egresos - suma del Consolidado) para que una fuga futura se vea.
//
// Uso: node scripts/consolidado-llenar.mjs [--dry]
import { google } from "googleapis";
import { existsSync, writeFileSync } from "node:fs";

const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const ORIGEN = "Reporte Egresos";
const DESTINO = "Reporte Consolidado";
const RESPALDO = "scripts/_backup_reporte_consolidado.json";
const CENTINELA = "NO CLASIFICADO (control automatico)";
const DRY = process.argv.includes("--dry");

// Egresos: meses G..R (6..17). Consolidado: meses H..S (7..18), TOTAL en T.
const MES_ORIGEN = 6;
const MES_DESTINO = 7;
const FILA_TOTAL_ORIGEN = 4; // total general de "Reporte Egresos"
const PRIMERA = 4; // primera fila de datos (el encabezado va en la 3)

// El unico rotulo que no coincide entre ambas pestanas.
const ALIAS_AGRUPADO = { "REPARACION DE ACTIVOS FIJOS": "REPARACIONES ACTIVOS" };

// Conceptos que en Egresos viven dentro de un sub-bloque pero el Consolidado
// saca a fila propia: el AGRUPADO tiene que excluirlos o se cuentan dos veces.
const AGRUPADO_SIN_SU_PRIMERA_FILA = new Set(["UTILES DE OFICINA", "ACTIVOS FIJOS"]);

// Filas que el Consolidado no traia y sin las cuales no cuadra con el libro.
// El ancla es el CODIGO de la fila que las precede, no su numero: asi el script
// se puede volver a correr sobre la hoja ya llena sin recalcular posiciones.
// codigo del ancla -> filas nuevas [codigo, concepto, area]
const ALTAS = {
  "2.11.28": [["2.1.31", "DEVOLUCION", "MARKETING"], ["2.2.24", "DEVOLUCION", "COMERCIAL"]],
  "2.11.8": [["2.11.10", "PONENTES", "FUNDACIÓN"]],
  "2.7.18": [["2.7.17", "CONTABO", "SISTEMAS"]],
};
// Seccion 13 completa: existe en Egresos (S/64 mil) y el Consolidado la ignora.
const SECCION_FINAL = [
  { tipo: "seccion", concepto: "MOVIMIENTOS PATRIMONIALES Y DEUDAS" },
  { tipo: "agrupado", concepto: "Directorio", area: "DIRECTORIO" },
  { tipo: "agrupado", concepto: "Deudas 2025", area: "GENERAL" },
  { tipo: "agrupado", concepto: "Otros por area", area: "GENERAL" },
  { tipo: "subtotal", concepto: "SUB TOTAL MOVIMIENTOS PATRIMONIALES Y DEUDAS" },
];
const CLASE_FINAL = "13. Movimientos Patrimoniales y Deudas";

const letra = (i) => String.fromCharCode(65 + i);
const normalizar = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
const num = (v) => (typeof v === "number" ? v : 0);

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

const { data } = await sheets.spreadsheets.values.batchGet({
  spreadsheetId: LIBRO,
  ranges: [`'${ORIGEN}'!A1:S400`, `'${DESTINO}'!A1:F200`],
  valueRenderOption: "FORMULA",
});
const egresos = data.valueRanges[0].values ?? [];
const consolidado = data.valueRanges[1].values ?? [];
const { data: crudo } = await sheets.spreadsheets.values.get({
  spreadsheetId: LIBRO,
  range: `'${ORIGEN}'!A1:S400`,
  valueRenderOption: "UNFORMATTED_VALUE",
});
const egresosValores = crudo.values ?? [];

// ── Indice de "Reporte Egresos": codigo -> fila, y subtotal -> {fila, primera}
const filaDeCodigo = new Map();
const subtotales = new Map();
const detalle = new Set();
let inicioBloque = null;
egresos.forEach((f, i) => {
  const fila = i + 1;
  const codigo = String(f?.[1] ?? "").trim();
  const rotulo = String(f?.[2] ?? "").trim();
  if (codigo && codigo !== "Antigua #") {
    if (filaDeCodigo.has(codigo)) throw new Error(`Codigo duplicado en ${ORIGEN}: ${codigo}`);
    filaDeCodigo.set(codigo, fila);
    detalle.add(fila);
    if (inicioBloque === null) inicioBloque = fila;
    return;
  }
  if (/^Subtotal\s*-/i.test(rotulo)) {
    subtotales.set(normalizar(rotulo.replace(/^Subtotal\s*-\s*/i, "")), { fila, primera: inicioBloque });
  }
  inicioBloque = null;
});

// ── Modelo del Consolidado: se conserva A..F y se resuelve el origen de cada fila
const asignadas = new Set();
const usar = (filas) => {
  for (const f of filas) {
    if (asignadas.has(f)) throw new Error(`Fila ${f} de ${ORIGEN} asignada dos veces`);
    asignadas.add(f);
  }
  return filas;
};

const resolverAgrupado = (concepto) => {
  const clave = normalizar(concepto);
  const sub = subtotales.get(normalizar(ALIAS_AGRUPADO[clave] ?? clave));
  if (!sub) throw new Error(`Sin subtotal en ${ORIGEN} para el AGRUPADO "${concepto}"`);
  const primera = AGRUPADO_SIN_SU_PRIMERA_FILA.has(clave) ? sub.primera + 1 : sub.primera;
  const filas = [];
  for (let f = primera; f < sub.fila; f++) if (detalle.has(f)) filas.push(f);
  return { rango: { desde: primera, hasta: sub.fila - 1 }, filas };
};

const nuevas = []; // indices del modelo que la hoja todavia no tiene
const yaEnLaHoja = new Set(consolidado.map((f) => String(f?.[1] ?? "").trim()).filter(Boolean));
const yaEnLaHojaRotulo = new Set(consolidado.map((f) => normalizar(f?.[2])).filter(Boolean));

const modelo = [];
for (let i = PRIMERA - 1; i < consolidado.length; i++) {
  const f = consolidado[i] ?? [];
  const a = [0, 1, 2, 3, 4, 5].map((c) => String(f[c] ?? "").trim());
  const [nuevoN, codigo, concepto, , clase, centro] = a;
  a[0] = "";

  if (!concepto) {
    modelo.push({ tipo: "vacia", a });
  } else if (normalizar(concepto) === normalizar(CENTINELA)) {
    modelo.push({ tipo: "centinela", a });
  } else if (normalizar(concepto) === "TOTAL GENERAL") {
    modelo.push({ tipo: "total", a });
  } else if (/^(SUB\s*TOTAL|TOTAL\s*-)/i.test(concepto)) {
    modelo.push({ tipo: "subtotal", a });
  } else if (normalizar(nuevoN) === "AGRUPADO") {
    a[0] = "AGRUPADO";
    const { rango, filas } = resolverAgrupado(concepto);
    usar(filas);
    modelo.push({ tipo: "detalle", a, origen: [rango] });
  } else if (codigo) {
    // 1.4.4 esta partido en dos filas de Egresos (docentes y consultoria) y el
    // Consolidado lo presenta agregado en Impuestos.
    const codigos = codigo === "1.4.4" ? ["1.4.4", "1.4.4-CONSULTORIA"] : [codigo];
    const filas = codigos.map((c) => filaDeCodigo.get(c)).filter(Boolean);
    if (codigo === "1.4.5") {
      // Renta de 5ta ya viaja dentro de cada area (filas 1.4.5-<AREA>), igual que
      // ESSALUD. Sumarla aqui la contaria dos veces: la fila queda informativa.
      modelo.push({ tipo: "detalle", a, origen: [], nota: "ya incluida en cada area" });
    } else if (!filas.length) {
      modelo.push({ tipo: "detalle", a, origen: [], nota: `sin fila en ${ORIGEN}` });
    } else {
      usar(filas);
      modelo.push({ tipo: "detalle", a, origen: filas.map((r) => ({ desde: r, hasta: r })) });
    }
  } else {
    modelo.push({ tipo: "seccion", a });
  }

  for (const [cod, conc, area] of ALTAS[codigo] ?? []) {
    if (yaEnLaHoja.has(cod)) continue;
    const fila = filaDeCodigo.get(cod);
    if (!fila) throw new Error(`El alta ${cod} no existe en ${ORIGEN}`);
    usar([fila]);
    modelo.push({ tipo: "detalle", a: ["", cod, conc, area, clase, centro], origen: [{ desde: fila, hasta: fila }] });
    nuevas.push(modelo.length - 1);
  }
}

for (const item of SECCION_FINAL) {
  if (yaEnLaHojaRotulo.has(normalizar(item.concepto))) continue;
  nuevas.push(modelo.length);
  if (item.tipo !== "agrupado") {
    modelo.push({ tipo: item.tipo, a: ["", "", item.concepto, "", "", ""] });
    continue;
  }
  const { rango, filas } = resolverAgrupado(item.concepto);
  usar(filas);
  modelo.push({
    tipo: "detalle",
    a: ["AGRUPADO", "", item.concepto, item.area, CLASE_FINAL, ""],
    origen: [rango],
  });
}
for (const [tipo, rotulo] of [["centinela", CENTINELA], ["total", "TOTAL GENERAL"]]) {
  if (yaEnLaHojaRotulo.has(normalizar(rotulo))) continue;
  nuevas.push(modelo.length);
  modelo.push({ tipo, a: ["", "", rotulo, "", "", ""] });
}

// ── Guarda: la particion tiene que cubrir todo el detalle de Egresos
const huerfanas = [...detalle].filter((f) => !asignadas.has(f));
if (huerfanas.length) {
  console.error(`\n${huerfanas.length} filas de ${ORIGEN} sin lugar en el Consolidado:`);
  for (const f of huerfanas) console.error(`  ${f}\t${egresos[f - 1]?.[1]}\t${egresos[f - 1]?.[2]}`);
  process.exit(1);
}
console.log(`Particion completa: ${asignadas.size} filas de detalle repartidas.`);

// ── Numeracion final y formulas
modelo.forEach((f, i) => { f.fila = PRIMERA + i; });

const sumaMes = (origen, k) => {
  const col = letra(MES_ORIGEN + k);
  const piezas = origen.map(({ desde, hasta }) =>
    desde === hasta ? `'${ORIGEN}'!${col}$${desde}` : `'${ORIGEN}'!${col}$${desde}:${col}$${hasta}`);
  return `=SUM(${piezas.join(";")})`;
};

// Un subtotal suma su seccion completa: los sub-encabezados no llevan importe,
// asi que un SUM de rango no puede contar de mas.
let inicioSeccion = null;
const filasSubtotal = [];
for (const f of modelo) {
  if (f.tipo === "seccion") { inicioSeccion = f.fila + 1; continue; }
  if (f.tipo !== "subtotal") continue;
  f.desde = inicioSeccion ?? f.fila;
  f.hasta = f.fila - 1;
  filasSubtotal.push(f.fila);
  inicioSeccion = null;
}
const filaCentinela = modelo.find((f) => f.tipo === "centinela").fila;

const formulaFila = (f, k) => {
  const cd = letra(MES_DESTINO + k);
  const co = letra(MES_ORIGEN + k);
  const sumaSubtotales = filasSubtotal.map((r) => `${cd}${r}`).join(";");
  if (f.tipo === "detalle") return f.origen.length ? sumaMes(f.origen, k) : "";
  if (f.tipo === "subtotal") return `=SUM(${cd}${f.desde}:${cd}${f.hasta})`;
  if (f.tipo === "centinela") return `='${ORIGEN}'!${co}$${FILA_TOTAL_ORIGEN}-SUM(${sumaSubtotales})`;
  if (f.tipo === "total") return `=SUM(${sumaSubtotales})+${cd}${filaCentinela}`;
  return "";
};

const filas = modelo.map((f) => {
  const meses = Array.from({ length: 12 }, (_, k) => formulaFila(f, k));
  const total = meses.some((m) => m !== "")
    ? `=SUM(${letra(MES_DESTINO)}${f.fila}:${letra(MES_DESTINO + 11)}${f.fila})`
    : "";
  return [...f.a, "", ...meses, total];
});

// ── Comprobacion numerica contra los valores vivos de Egresos
const valorMes = (fila, k) => num(egresosValores[fila - 1]?.[MES_ORIGEN + k]);
const filaCentinelaOrigen = egresosValores.findIndex((x) => String(x?.[2] ?? "").startsWith("NO CLASIFICADO")) + 1;
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
const s = (n) => n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let cuadra = true;
console.log("\nmes\ttotal Egresos\tsuma Consolidado\tcentinela\tcentinela Egresos");
MESES.forEach((m, k) => {
  const totalEgresos = valorMes(FILA_TOTAL_ORIGEN, k);
  const suma = modelo
    .filter((f) => f.tipo === "detalle" && f.origen.length)
    .reduce((acc, f) => acc + f.origen.reduce((t, { desde, hasta }) => {
      for (let r = desde; r <= hasta; r++) t += valorMes(r, k);
      return t;
    }, 0), 0);
  const cent = totalEgresos - suma;
  const esperado = filaCentinelaOrigen ? valorMes(filaCentinelaOrigen, k) : 0;
  const ok = Math.abs(cent - esperado) < 0.01;
  if (!ok) cuadra = false;
  console.log(`${m}\t${s(totalEgresos)}\t${s(suma)}\t${s(cent)}\t${s(esperado)}\t${ok ? "OK" : "<-- REVISAR"}`);
});
console.log(`\nFilas ${PRIMERA}..${PRIMERA + modelo.length - 1}. Subtotales: ${filasSubtotal.join(", ")}.`);
for (const f of modelo) if (f.nota) console.log(`  fila ${f.fila} "${f.a[2]}": ${f.nota}`);
if (!cuadra) { console.error("\nEl mapeo no reproduce el centinela de Egresos: no se escribe nada."); process.exit(1); }

if (DRY) { console.log("\n--dry: no se escribio nada."); process.exit(0); }

// ── Escritura: primero las filas que faltan (heredan formato), luego los valores
const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId: LIBRO });
const hoja = meta.sheets.find((h) => h.properties.title === DESTINO);
if (!hoja) throw new Error(`No existe la pestana "${DESTINO}"`);
const sheetId = hoja.properties.sheetId;
// Solo la primera corrida: el respaldo vale por ser el estado ANTES de llenar.
if (!existsSync(RESPALDO)) writeFileSync(RESPALDO, JSON.stringify(consolidado, null, 1));

// Las filas nuevas consecutivas se insertan de una (Google solo hereda el
// formato de la fila de arriba) y de abajo hacia arriba, para que una insercion
// no corra las posiciones de las que faltan.
const tramos = [];
for (const idx of nuevas) {
  const ultimo = tramos.at(-1);
  if (ultimo && idx === ultimo.desde + ultimo.cantidad) ultimo.cantidad++;
  else tramos.push({ desde: idx, cantidad: 1 });
}
if (tramos.length) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: LIBRO,
    requestBody: {
      requests: tramos.slice().reverse().map(({ desde, cantidad }) => ({
        insertDimension: {
          range: {
            sheetId, dimension: "ROWS",
            startIndex: PRIMERA + desde - 1,
            endIndex: PRIMERA + desde - 1 + cantidad,
          },
          inheritFromBefore: true,
        },
      })),
    },
  });
  console.log(`\nInsertadas ${nuevas.length} filas en ${tramos.length} tramos.`);
}

await sheets.spreadsheets.values.update({
  spreadsheetId: LIBRO,
  range: `'${DESTINO}'!A${PRIMERA}:T${PRIMERA + modelo.length - 1}`,
  valueInputOption: "USER_ENTERED",
  requestBody: { values: filas },
});
await sheets.spreadsheets.values.update({
  spreadsheetId: LIBRO,
  range: `'${DESTINO}'!T3`,
  valueInputOption: "RAW",
  requestBody: { values: [["TOTAL"]] },
});

// Las dos filas que invitan a "arreglarlas" y romper el cuadre: se documentan
// en la propia hoja, no solo aqui.
const NOTAS = [
  [modelo.find((f) => f.a[1] === "1.4.5")?.fila,
   "Vacia a proposito: la Renta de 5ta ya viaja dentro de cada area de PERSONAL Y " +
   "PLANILLAS (filas 1.4.5-<AREA> de Reporte Egresos), igual que ESSALUD. " +
   "Jalar aqui el agregado 1.4.5 la contaria dos veces."],
  [filaCentinela,
   "Control automatico = total de Reporte Egresos menos la suma de los subtotales " +
   "de esta hoja. Debe dar 0. Si un mes deja de dar 0, hay un concepto del libro " +
   "sin fila en el Consolidado. No borrar."],
].filter(([fila]) => fila);
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: LIBRO,
  requestBody: {
    requests: NOTAS.map(([fila, nota]) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: fila - 1, endRowIndex: fila, startColumnIndex: 2, endColumnIndex: 3 },
        cell: { note: nota },
        fields: "note",
      },
    })),
  },
});
console.log(`Escritas ${filas.length} filas en "${DESTINO}". Respaldo en ${RESPALDO}.`);
