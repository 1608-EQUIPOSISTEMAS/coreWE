// Cierra el cuadre de "Reporte Egresos" contra el libro de contabilidad.
//
// Quedaban 16 codigos con importe que ningun bloque del reporte reclamaba
// (S/64.523) y un doble conteo de 1.4.4. Los codigos huerfanos son de tres
// naturalezas distintas -movimientos de capital, deudas heredadas y sobrantes
// menores por area- que no encajan en las secciones operativas existentes, asi
// que se agrupan en una seccion propia al final.
//
// Uso: node scripts/egresos-seccion-patrimonial.mjs [--dry]
import { google } from "googleapis";

const LIBRO = "1QZdliuhPYUhSbPeTi250_2u17rzFypP09ZV593ZkgZA";
const REPORTE = "Reporte Egresos";
const HOJA_REPORTE_ID = 1440644810;
const SECCION = "MOVIMIENTOS PATRIMONIALES Y DEUDAS";
const CLASIFICACION = "13. Movimientos Patrimoniales y Deudas";

const FILA_ENCABEZADO = 304;          // hoy "OTROS GASTOS", con dos placeholders muertos debajo
const FILA_SUBTOTAL_VIEJO = 307;      // "SUB TOTAL INVERSIONES Y CRECIMIENTO" (etiqueta mal copiada)
const FILA_4TA_CONSULTORIA = 198;

const BLOQUES = [
  {
    titulo: "Directorio",
    partidas: [
      ["2.12.14", "VENTA DE ACCIONES", "DIRECTORIO", "Direccion"],
      ["2.12.13", "ADELANTO DE DIVIDENDO", "DIRECTORIO", "Direccion"],
      ["2.12.15", "OTROS", "DIRECTORIO", "Direccion"],
    ],
  },
  {
    // Las cuatro cuentas del rubro, no solo la que tiene saldo: si en 2026 se
    // paga cualquiera de las otras tres, entra sola al reporte.
    titulo: "Deudas 2025",
    partidas: [
      ["2.14.2", "PALOMINO MINAYA JOHAN", "DEUDAS 2025", "Administracion"],
      ["2.14.1", "CHAVARRI ARCE RAQUEL MARTHA", "DEUDAS 2025", "Administracion"],
      ["2.14.3", "SAAVEDRA PABLO CESAR DAVID", "DEUDAS 2025", "Administracion"],
      ["2.14.4", "DELGADO PAREDES SERGIO", "DEUDAS 2025", "Administracion"],
    ],
  },
  {
    titulo: "Otros por area",
    partidas: [
      ["2.10.24", "OTROS", "GERENCIA", "Gerencia"],
      ["2.6.26", "OTROS", "CONTABILIDAD", "Contabilidad"],
      ["2.11.30", "OTROS", "FUNDACION", "Fundacion WE"],
      ["2.9.29", "OTROS", "B2B", "B2B"],
      ["2.2.25", "OTROS", "COMERCIAL", "Comercial"],
      ["2.3.29", "OTROS", "PRODUCTO", "Producto"],
      ["2.4.26", "REPARACION DE ACTIVOS FIJOS", "EXPERIENCIA AL ALUMNO", "Academica"],
      ["2.10.14", "ENVIOS", "GERENCIA", "Gerencia"],
      ["2.1.9", "MOVILIDAD", "MARKETING", "Marketing"],
      ["2.1.10", "ENVIOS", "MARKETING", "Marketing"],
      ["2.4.19", "ENVIOS", "EXPERIENCIA AL ALUMNO", "Academica"],
      ["2.5.22", "ENVIOS", "FINANZAS", "Finanzas"],
    ],
  },
];

const MESES = 12;
const COL_MES = (i) => String.fromCharCode(71 + i);           // G..R
const dry = process.argv.includes("--dry");

// Misma formula que el resto del reporte: cada fila se jala sola por su codigo.
const formulaPartida = (fila) =>
  `=IF($B${fila}="";"";LET(k;COLUMN()-6;r;IFERROR(MATCH($B${fila};'Fuente Principal'!$A:$A;0);0);` +
  `pen;IF(r=0;0;N(INDEX('Fuente Principal'!$A:$AB;r;3+2*k)));` +
  `usd;IF(r=0;0;N(INDEX('Fuente Principal'!$A:$AB;r;4+2*k)));` +
  `pen+IF(usd=0;0;usd*VLOOKUP(202600+k;Control!$A:$B;2;FALSE))))`;

// Se arma el plano de filas antes de tocar nada: cuantas filas hacen falta y
// que va en cada una. Asi la insercion es un solo calculo, no un acumulado.
const plano = [];
const subtotalesBloque = [];
let cursor = FILA_ENCABEZADO + 1;
for (const bloque of BLOQUES) {
  plano.push({ fila: cursor, tipo: "titulo", texto: bloque.titulo });
  cursor += 1;
  const primera = cursor;
  for (const [codigo, concepto, clasificacion, centro] of bloque.partidas) {
    plano.push({ fila: cursor, tipo: "partida", codigo, concepto, clasificacion, centro });
    cursor += 1;
  }
  plano.push({ fila: cursor, tipo: "subtotal", texto: `Subtotal - ${bloque.titulo}`, desde: primera, hasta: cursor - 1 });
  subtotalesBloque.push(cursor);
  cursor += 1;
}
const FILA_SUBTOTAL_SECCION = cursor;
const FILA_FIN_DATOS = FILA_SUBTOTAL_SECCION;
const FILA_CONTROL = FILA_SUBTOTAL_SECCION + 2;
const FILAS_A_INSERTAR = FILA_SUBTOTAL_SECCION - FILA_SUBTOTAL_VIEJO;

if (dry) {
  console.log(`Seccion "${SECCION}": filas ${FILA_ENCABEZADO}-${FILA_SUBTOTAL_SECCION} (+${FILAS_A_INSERTAR} insertadas)`);
  for (const p of plano) {
    console.log(`  ${String(p.fila).padStart(4)}  ${p.tipo.padEnd(9)} ${(p.codigo ?? "").padEnd(9)} ${p.texto ?? p.concepto}`);
  }
  console.log(`  ${String(FILA_SUBTOTAL_SECCION).padStart(4)}  seccion   ${"".padEnd(9)} SUB TOTAL ${SECCION}`);
  console.log(`  ${String(FILA_CONTROL).padStart(4)}  control   ${"".padEnd(9)} NO CLASIFICADO`);
  process.exit(0);
}

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials/service.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

const encabezadoActual = (await sheets.spreadsheets.values.get({
  spreadsheetId: LIBRO, range: `'${REPORTE}'!C${FILA_ENCABEZADO}`,
})).data.values?.[0]?.[0];
if (String(encabezadoActual ?? "").trim() === SECCION) {
  console.log("La seccion ya existe; nada que hacer.");
  process.exit(0);
}

await sheets.spreadsheets.batchUpdate({
  spreadsheetId: LIBRO,
  requestBody: {
    requests: [{
      insertDimension: {
        range: {
          sheetId: HOJA_REPORTE_ID, dimension: "ROWS",
          startIndex: FILA_SUBTOTAL_VIEJO - 1,
          endIndex: FILA_SUBTOTAL_VIEJO - 1 + FILAS_A_INSERTAR,
        },
        inheritFromBefore: true,
      },
    }],
  },
});

const escribir = (rango, valores) => ({ range: `'${REPORTE}'!${rango}`, values: [valores] });
const datos = [escribir(`C${FILA_ENCABEZADO}`, [SECCION])];

for (const p of plano) {
  if (p.tipo === "titulo") {
    datos.push(escribir(`C${p.fila}`, [p.texto]));
  } else if (p.tipo === "partida") {
    datos.push(escribir(`B${p.fila}:F${p.fila}`, [p.codigo, p.concepto, p.clasificacion, CLASIFICACION, p.centro]));
    datos.push(escribir(`G${p.fila}:S${p.fila}`, [
      ...Array(MESES).fill(formulaPartida(p.fila)),
      `=SUM(G${p.fila}:R${p.fila})`,
    ]));
  } else {
    datos.push(escribir(`C${p.fila}`, [p.texto]));
    datos.push(escribir(`G${p.fila}:S${p.fila}`, [
      ...Array.from({ length: MESES }, (_, i) => `=SUM(${COL_MES(i)}${p.desde}:${COL_MES(i)}${p.hasta})`),
      `=SUM(S${p.desde}:S${p.hasta})`,
    ]));
  }
}

datos.push(escribir(`C${FILA_SUBTOTAL_SECCION}`, [`SUB TOTAL ${SECCION}`]));
datos.push(escribir(`G${FILA_SUBTOTAL_SECCION}:S${FILA_SUBTOTAL_SECCION}`, [
  ...Array.from({ length: MESES }, (_, i) => `=SUM(${subtotalesBloque.map((f) => `${COL_MES(i)}${f}`).join(";")})`),
  `=SUM(${subtotalesBloque.map((f) => `S${f}`).join(";")})`,
]));

// Fila centinela: lo que el libro reporta menos lo que el arbol reclama. Hoy da
// cero; si manana contabilidad estrena un codigo que aqui no tiene fila, el
// importe aparece en esta linea en vez de evaporarse -que es exactamente como
// se perdieron los S/64.523 y los S/22.074 de ESSALUD-.
datos.push(escribir(`C${FILA_CONTROL}:F${FILA_CONTROL}`,
  ["NO CLASIFICADO (control automatico)", "GENERAL", "0. Control", "Administracion"]));
datos.push(escribir(`G${FILA_CONTROL}:S${FILA_CONTROL}`, [
  ...Array.from({ length: MESES }, (_, i) =>
    `=N(INDEX('Fuente Principal'!$A:$AB;2;3+2*(COLUMN()-6)))` +
    `-SUMIF($B$5:$B$${FILA_FIN_DATOS};"<>";${COL_MES(i)}$5:${COL_MES(i)}$${FILA_FIN_DATOS})`),
  `=SUM(G${FILA_CONTROL}:R${FILA_CONTROL})`,
]));

// 1.4.4 estaba en dos filas y cada una traia el agregado del libro: se contaba
// S/3.798 sobre S/1.899 reales. El codigo se queda en la fila de docentes; la de
// consultoria conserva un codigo derivado -no cruza, luego suma cero- para no
// borrar la linea mientras contabilidad define el reparto real.
datos.push(escribir(`B${FILA_4TA_CONSULTORIA}`, ["1.4.4-CONSULTORIA"]));

// El total del reporte suma el arbol y le agrega el centinela, que queda fuera
// del rango del SUMIF a proposito para no crear referencia circular.
const columnaC = (await sheets.spreadsheets.values.get({
  spreadsheetId: LIBRO, range: `'${REPORTE}'!C${FILA_CONTROL}:C400`,
})).data.values ?? [];
const desplazamiento = columnaC.findIndex((f) => String(f?.[0] ?? "").trim() === "Enero");
if (desplazamiento < 0) throw new Error("No se encontro la fila 'Enero' del bloque de totales");
const FILA_TOTAL_ENERO = FILA_CONTROL + desplazamiento;
for (let i = 0; i < MESES; i += 1) {
  datos.push(escribir(`D${FILA_TOTAL_ENERO + i}`, [
    `=SUMIF($B$5:$B$${FILA_FIN_DATOS};"<>";${COL_MES(i)}$5:${COL_MES(i)}$${FILA_FIN_DATOS})` +
    `+${COL_MES(i)}$${FILA_CONTROL}`,
  ]));
}

await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: LIBRO,
  requestBody: { valueInputOption: "USER_ENTERED", data: datos },
});
console.log(`Seccion "${SECCION}": filas ${FILA_ENCABEZADO}-${FILA_SUBTOTAL_SECCION}.`);
console.log(`Control en ${FILA_CONTROL}; totales recalculados desde ${FILA_TOTAL_ENERO}.`);
