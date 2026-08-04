/**
 * One-off Apps Script (bound al Sheet "Reporte Diario", proyecto
 * 1TgIGoULYeE9-t7nns4cYAmQhwVGt70-rwg72vEtYfB62ZJF7adRGEgrn).
 * Ejecutado el 2026-08-04: extendio la matriz "Ingresos Diarios" de 5 a 14
 * semanas (01/06 -> 06/09) y lleno Julio/Agosto en INGRESOS TOTALES.
 *
 * Estructura de la hoja "Ingresos Diarios":
 *   - Bloque semanal = 16 columnas: 7 dias x (s/. , #) + (Subtotal , #). C es el
 *     primer bloque; semana n arranca en la columna 3 + 16*(n-1).
 *   - Fila 1 (oculta) = cadena de fechas por FORMULA: C1==DATE(2026;6;1), D1==C1,
 *     E1==C1+1 ... S1==O1+1. Por eso copiar el bloque de la SEMANA 2 hacia la
 *     derecha propaga las fechas solo; copiar la semana 1 no (su C1 es literal).
 *   - Fila 2 = mes + "Semana n" (celdas start+5 y start+6, centrado por seleccion).
 *   - Fila 3 = etiqueta dd/mm (merge por par) + "Subtotal Sem. n".
 *   - Columna A (oculta) = clave de categoria; filas 6..48 = SUMIFS/COUNTIFS
 *     contra 'Fuente Estatico' col S (monto en soles) y col T (categoria).
 *   - B1 = checksum: suma de los subtotales semanales.
 *   - Filas 51..64 = INGRESOS TOTALES por mes (Junio=57, Julio=58, Agosto=59).
 *
 * OJO: el locale del archivo usa ';' como separador de argumentos, y
 * Range.setFormula NO traduce: pasarle comas deja la celda en #ERROR!.
 *
 * Para agregar setiembre: subir SEMANAS y volver a correr extender() + arreglar()
 * (ambas son idempotentes).
 */

function colLetra_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

function extender() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Ingresos Diarios');
  var W = 16, FIRST = 3, FILAS = 48, SEMANAS = 14;
  var necesarias = FIRST + SEMANAS * W - 1;
  if (sh.getMaxColumns() < necesarias) sh.insertColumnsAfter(sh.getMaxColumns(), necesarias - sh.getMaxColumns());

  var molde = sh.getRange(1, FIRST + W, FILAS, W); // semana 2
  for (var w = 5; w < SEMANAS; w++) molde.copyTo(sh.getRange(1, FIRST + w * W, FILAS, W));

  for (var k = 0; k < W; k++) {
    var ancho = sh.getColumnWidth(FIRST + W + k);
    for (var w2 = 5; w2 < SEMANAS; w2++) sh.setColumnWidth(FIRST + w2 * W + k, ancho);
  }
  SpreadsheetApp.flush();

  var MES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  for (var s = 0; s < SEMANAS; s++) {
    var c = FIRST + s * W;
    sh.getRange(2, c + 5).setValue(MES[sh.getRange(1, c).getValue().getMonth()]);
    sh.getRange(2, c + 6).setValue('Semana ' + (s + 1));
    sh.getRange(3, c + 14).setValue('Subtotal Sem. ' + (s + 1));
  }
}

function arreglar() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Ingresos Diarios');
  var W = 16, FIRST = 3, SEMANAS = 14;

  var partes = [];
  for (var t = 0; t < SEMANAS; t++) partes.push(colLetra_(FIRST + t * W + 14) + '4');
  sh.getRange('B1').setFormula('=SUM(' + partes.join(';') + ')');

  for (var s = 0; s < SEMANAS; s++) {
    var c = FIRST + s * W;
    for (var d = 0; d < 7; d++) {
      sh.getRange(3, c + d * 2).setFormula('=TEXT(' + colLetra_(c + d * 2) + '1;"dd/mm")');
    }
  }

  // INGRESOS TOTALES: [fila, mes, ultimoDia]
  [[58, 7, 31], [59, 8, 31]].forEach(function (m) {
    var rango = "'Fuente Estatico'!$B:$B;\">=\"&DATE(2026;" + m[1] + ";1)" +
                ";'Fuente Estatico'!$B:$B;\"<=\"&DATE(2026;" + m[1] + ";" + m[2] + ")";
    sh.getRange(m[0], 3).setFormula("=SUMIFS('Fuente Estatico'!$S:$S;" + rango + ")");
    sh.getRange(m[0], 4).setFormula("=COUNTIFS('Fuente Estatico'!$K:$K;\"<>\";'Fuente Estatico'!$K:$K;\"<>0\";" + rango + ")");
  });
}
