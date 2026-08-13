/**
 * One-off Apps Script (bound al Sheet "Reporte Diario", proyecto
 * 1TgIGoULYeE9-t7nns4cYAmQhwVGt70-rwg72vEtYfB62ZJF7adRGEgrn).
 *
 * 2026-08-04: extendio la matriz de 5 a 14 semanas (01/06 -> 06/09).
 * 2026-08-13: el reporte pasa a cubrir ENERO -> hoy. 36 semanas (29/12/25 ->
 *   06/09/26), pie del mes para los 12 meses y TC mensual real.
 *
 * Estructura de la hoja de ingresos (hoy "Reporte Ingresos", antes "Ingresos
 * Diarios" -- por eso se busca por coincidencia parcial):
 *   - Bloque semanal = 16 columnas: 7 dias x (s/. , #) + (Subtotal , #). C es el
 *     primer bloque; semana n arranca en la columna 3 + 16*(n-1).
 *   - Fila 1 (oculta) = cadena de fechas por FORMULA: solo C1 es literal, el
 *     resto es "= la anterior + 1". Por eso mover ANCLA recorre la matriz
 *     entera y extender hacia atras es cambiar una celda, no insertar columnas.
 *   - Fila 2 = mes + "Semana n" (celdas start+5 y start+6).
 *   - Fila 3 = etiqueta dd/mm (merge por par) + "Subtotal Sem. n".
 *   - Columna A (oculta) = clave de categoria; filas 6..48 = SUMIFS/COUNTIFS
 *     contra 'Fuente Estatico' col S (monto en soles) y col T (categoria).
 *   - B1 = checksum: suma de los subtotales semanales.
 *   - Filas 52..63 = pie del mes (52 = Enero ... 63 = Diciembre).
 *
 * OJO: el locale del archivo usa ';' como separador de argumentos, y
 * Range.setFormula NO traduce: pasarle comas deja la celda en #ERROR!. Los
 * NOMBRES de funcion, en cambio, van siempre en ingles (SUMIFS, no SUMAR.SI.CONJUNTO).
 *
 * Todo es idempotente: correr de nuevo pisa con lo mismo.
 * Mes nuevo => subir MESES_CARGADOS, agregar su TC, y correr sembrarControl() +
 * pieDelMes(). Semana nueva => subir SEMANAS y correr extender() + arreglar().
 */

var ORIGEN = '1Uy8E9nlRIz7TueD_v21nSuPVfIh8n3uRvm18e64Jj3I'; // Ing. Operativos - GRUPO WE | 2026
var ANIO = 2026;
var SEMANAS = 36;
var ANCLA = [2025, 12, 29]; // lunes anterior al 01/01/2026; +154 dias cae en 01/06/2026
var MESES_CARGADOS = 8;     // pestanas que existen en el origen (ENERO..AGOSTO)

var MES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
           'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

// TC oficial por mes (dato de finanzas, 2026-08-13). Julio bajo de 3,600 a 3,399:
// mueve el monto en soles de las ventas en USD de julio ya publicadas.
var TC = [3.355, 3.361, 3.495, 3.529, 3.417, 3.415, 3.399, 3.600];

var W = 16;         // columnas por bloque semanal
var FIRST = 3;      // columna C
var FILAS = 48;     // alto del bloque semanal
var FILA_ENERO = 52;

/**
 * Punto de entrada del one-off. Primera funcion del archivo a proposito: el
 * editor preselecciona esa en el selector de Ejecutar y el selector no acepta
 * que le cambien la opcion por click. Su cuerpo se va reapuntando al paso que
 * toque; el orden completo esta en ampliarDesdeEnero().
 */
function paso() {
  actualizarLeyenda();
}

/**
 * La leyenda del tablero decia "USD convertido a 3,415", que dejo de ser cierto
 * cuando el TC paso a ser mensual (ver tcMensual()). Vive en la fila 3, que por
 * contrato la mantiene el equipo a mano y construirConsolidado() respeta via
 * adoptarEncabezado() -- por eso se corrige una vez y sobrevive a los rebuilds.
 * Se busca por contenido y no por celda fija: la fila 3 va con merges y la celda
 * ancla se mueve cada vez que alguien reacomoda el encabezado.
 */
function actualizarLeyenda() {
  var LEYENDA = 'Fuente: hoja Fuente Estatico  |  montos en soles, USD convertido al TC ' +
    'del mes (hoja Control)  |  se actualiza solo con el sync';

  var sh = SpreadsheetApp.getActive().getSheetByName('Reporte Consolidado');
  var fila = sh.getRange(3, 1, 1, sh.getMaxColumns()).getDisplayValues()[0];

  for (var c = 0; c < fila.length; c++) {
    if (fila[c].indexOf('Fuente:') < 0) continue;
    sh.getRange(3, c + 1).setValue(LEYENDA);
    console.log('Leyenda actualizada en ' + colLetra_(c + 1) + '3.');
    return;
  }
  console.log('No encontre la leyenda en la fila 3. Sin cambios.');
}

/**
 * La columna F del pie (detalle) heredaba formato de porcentaje y mostraba
 * "54664347%" donde va S/546.643,47. El valor siempre estuvo bien -- la
 * diferencia de la col E cuadraba --, era solo el formato de la celda.
 */
function formatearPie() {
  var ing = hojaIngresos_(SpreadsheetApp.getActive());
  ing.getRange(FILA_ENERO, 6, 12, 1).setNumberFormat('[$S/.]#,##0.00');
}

/** Pie del mes de un vistazo: total oficial, detalle y diferencia. */
function verPie() {
  var ing = hojaIngresos_(SpreadsheetApp.getActive());
  var v = ing.getRange(FILA_ENERO, 3, 12, 4).getDisplayValues();
  console.log(v.map(function (r, i) {
    return MES[i] + ' | oficial=' + r[0] + ' | trx=' + r[1] + ' | detalle=' + r[3] + ' | dif=' + r[2];
  }).join('\n'));
  console.log('checksum B1 = ' + ing.getRange('B1').getDisplayValue());
}

/** Borra el andamiaje que dejo este one-off. */
function limpiar() {
  var ss = SpreadsheetApp.getActive();
  var probe = ss.getSheetByName('_probe');
  if (probe) ss.deleteSheet(probe);
}

/**
 * 'Fuente Estatico' se dimensiono cuando el reporte era de 3 meses; con los 12
 * pasa de ~3.000 filas a ~10.000. pegar() escribe por getRange(fila, col, n, ..),
 * que revienta si la hoja no tiene esas filas creadas, asi que se crecen antes.
 */
function asegurarFilasEstatico() {
  var ss = SpreadsheetApp.getActive();
  var necesarias = ss.getSheetByName('Fuente Principal').getLastRow() + 100;
  var fe = ss.getSheetByName('Fuente Estatico');
  if (fe.getMaxRows() >= necesarias) return;

  fe.insertRowsAfter(fe.getMaxRows(), necesarias - fe.getMaxRows());
  console.log('Fuente Estatico ampliada a ' + fe.getMaxRows() + ' filas.');
}

/**
 * IMPORTRANGE resuelve fuera del hilo del script, asi que recien escrita la
 * formula la hoja esta vacia o en "Loading". Pegar en ese momento volcaria un
 * bloque a medias sobre 'Fuente Estatico', que es el modo de falla que ya
 * congelo este reporte una semana. Aqui se espera y se reporta que llego.
 */
function esperarFuentePrincipal() {
  var fp = SpreadsheetApp.getActive().getSheetByName('Fuente Principal');

  for (var intento = 0; intento < 10; intento++) {
    Utilities.sleep(6000);
    var a1 = fp.getRange('A1').getDisplayValue();
    if (a1 === '' || a1.indexOf('Loading') >= 0 || a1.charAt(0) === '#') continue;

    var fechas = fp.getRange(1, 2, fp.getLastRow(), 1).getDisplayValues();
    var porMes = {};
    for (var i = 0; i < fechas.length; i++) {
      var f = fechas[i][0];
      if (!f) continue;
      var mes = f.split('/')[1];
      porMes[mes] = (porMes[mes] || 0) + 1;
    }
    console.log('Fuente Principal OK: ' + fp.getLastRow() + ' filas. Por mes: ' + JSON.stringify(porMes));
    return;
  }
  console.log('Fuente Principal sigue sin resolver. NO pegar todavia.');
}

/**
 * Cuantas columnas devuelve DE VERDAD cada bloque de mes. El ancho que declara
 * el rango y el que entrega Sheets no son lo mismo (una pestana mas angosta que
 * el rango se recorta en silencio), y de ahi salia el #VALUE!/ARRAY_LITERAL.
 * Se mide con COLUMNS() en una hoja temporal en vez de deducirlo.
 */
function probarAncho() {
  var ss = SpreadsheetApp.getActive();
  var src = SpreadsheetApp.openById(ORIGEN);
  var hoja = ss.getSheetByName('_probe') || ss.insertSheet('_probe');
  hoja.clear();

  for (var m = 0; m < MESES_CARGADOS; m++) {
    hoja.getRange(m + 1, 1).setValue(MES[m]);
    hoja.getRange(m + 1, 2).setFormula('=COLUMNS(' + bloqueMes_(src, MES[m], 18, 5000) + ')');
    hoja.getRange(m + 1, 3).setFormula('=ROWS(' + bloqueMes_(src, MES[m], 18, 5000) + ')');
  }
  SpreadsheetApp.flush();

  // IMPORTRANGE resuelve fuera del hilo del script: hay que darle tiempo y
  // reintentar mientras siga en "Loading".
  var v = [];
  for (var intento = 0; intento < 6; intento++) {
    Utilities.sleep(5000);
    v = hoja.getRange(1, 1, MESES_CARGADOS, 3).getDisplayValues();
    if (v.every(function (f) { return f[1] !== '' && f[1].indexOf('Loading') < 0; })) break;
  }
  console.log(v.map(function (f) { return f[0] + ': cols=' + f[1] + ' filas=' + f[2]; }).join('\n'));
}

/**
 * 'Fuente Principal'!A1 apila un IMPORTRANGE por mes con {} y un literal de
 * matriz exige el MISMO ancho en todos los bloques. ENERO y FEBRERO solo tienen
 * 17 columnas en el origen (la 18, WE PLUS-DESC, se agrego en agosto), asi que
 * Sheets recortaba esos dos rangos a 17 y la celda entera caia en #VALUE!.
 * Se rellenan con columnas vacias desde la formula: el origen es archivo
 * oficial de finanzas y no se toca desde aca.
 *
 * De paso el rango sube de la fila 3000 a la 5000: las pestanas ya llegan a la
 * 3254, o sea el limite viejo truncaba ~250 filas por mes sin avisar. Las filas
 * de mas no ensucian nada, el QUERY exterior descarta lo que no tiene fecha.
 */
function arreglarFuentePrincipal() {
  var ANCHO = 18, HASTA = 5000;
  var src = SpreadsheetApp.openById(ORIGEN);

  var bloques = [];
  for (var m = 0; m < MESES_CARGADOS; m++) {
    bloques.push(bloqueMes_(src, MES[m], ANCHO, HASTA));
  }

  var formula = '=QUERY({' + bloques.join(';') + '};"select * where Col2 is not null";0)';
  SpreadsheetApp.getActive().getSheetByName('Fuente Principal').getRange('A1').setFormula(formula);
  console.log('Fuente Principal!A1 reescrita: ' + MESES_CARGADOS + ' meses, ' + ANCHO + ' columnas.');
}

/**
 * Un mes del origen, siempre con `ancho` columnas.
 *
 * El relleno se hace con ARRAYFORMULA y no con QUERY "select ...,''": el Query
 * Language de Sheets no admite literales de cadena en el select y devuelve #N/A
 * (medido con probarAncho(), no supuesto). La columna postiza se genera del
 * mismo alto que el bloque leyendo A30:A<hasta>, que abarca las mismas filas.
 * '\\' es el separador de COLUMNAS del literal de matriz en este locale (el de
 * filas es ';', el mismo que separa argumentos).
 */
function bloqueMes_(src, mes, ancho, hasta) {
  var cols = src.getSheetByName(mes).getMaxColumns();
  var importar = 'IMPORTRANGE("' + ORIGEN + '";"' + mes + '!A30:' +
    colLetra_(Math.min(cols, ancho)) + hasta + '")';
  if (cols >= ancho) return importar;

  var vacia = 'ARRAYFORMULA(IF(IMPORTRANGE("' + ORIGEN + '";"' + mes + '!A30:A' + hasta +
    '")<>"";"";""))';
  var partes = [importar];
  while (partes.length < ancho - cols + 1) partes.push(vacia);
  return '{' + partes.join('\\') + '}';
}

/**
 * Por que existe: 'Fuente Principal'!A1 apila 8 IMPORTRANGE con {}, y un
 * literal de matriz exige que TODOS los bloques tengan el mismo ancho. Si una
 * pestana del origen es mas angosta que R, Sheets recorta ese IMPORTRANGE y
 * toda la celda cae en #VALUE! (ARRAY_LITERAL). Aqui se mide el ancho real de
 * cada pestana en vez de suponerlo. Solo lee, y el origen es archivo oficial:
 * no se toca desde aca.
 */
function diagnosticarOrigen() {
  var src = SpreadsheetApp.openById(ORIGEN);
  var lineas = [];
  for (var m = 0; m < MESES_CARGADOS; m++) {
    var sh = src.getSheetByName(MES[m]);
    lineas.push(sh
      ? MES[m] + ': maxCols=' + sh.getMaxColumns() + ' lastCol=' + sh.getLastColumn() +
        ' lastRow=' + sh.getLastRow() + ' D10=' + sh.getRange('D10').getDisplayValue()
      : MES[m] + ': NO EXISTE');
  }
  lineas.push('--- pestanas del origen: ' +
    src.getSheets().map(function (h) { return h.getName(); }).join(', '));
  console.log(lineas.join('\n'));
}

/**
 * Todo el cambio de enero, en orden. Primera funcion del archivo a proposito:
 * el editor preselecciona esa en el selector de Ejecutar (el mismo truco que
 * usa diagnostico() en Codigo.gs). Toma foto antes y despues: si algo hay que
 * revertir, el registro de ejecucion guarda como estaba.
 */
function ampliarDesdeEnero() {
  console.log('===== ANTES =====');
  estado();

  arreglarFuentePrincipal();   // los 8 meses, con ENERO/FEBRERO rellenados a 18 columnas
  esperarFuentePrincipal();    // IMPORTRANGE es asincrono: no pegar a medias

  sembrarControl();            // TC oficial + total espejo del origen, por mes
  tcMensual();                 // 'Fuente Estatico'!S1 convierte USD con el TC del mes
  extender();                  // 36 semanas desde el 29/12/2025
  arreglar();                  // checksum y etiquetas dd/mm
  pieDelMes();                 // filas 52..63: oficial / detalle / diferencia
  formatearPie();

  asegurarFilasEstatico();     // de ~3.000 a ~10.000 filas
  forzarPegado();              // repuebla el snapshot y arrastra S1:T1
  construirConsolidado();      // regenera el tablero
  actualizarLeyenda();

  limpiar();
  console.log('===== DESPUES =====');
  verPie();
}

function colLetra_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

function hojaIngresos_(ss) {
  var hojas = ss.getSheets();
  for (var i = 0; i < hojas.length; i++) {
    if (/ingresos/i.test(hojas[i].getName())) return hojas[i];
  }
  throw new Error('No encuentro la hoja de ingresos.');
}

/** Rango de fechas de un mes, como argumentos sueltos de un SUMIFS/COUNTIFS. */
function filtroMes_(mes) {
  var desde = 'DATE(' + ANIO + ';' + mes + ';1)';
  var hasta = mes === 12 ? 'DATE(' + (ANIO + 1) + ';1;1)' : 'DATE(' + ANIO + ';' + (mes + 1) + ';1)';
  return "'Fuente Estatico'!$B:$B;\">=\"&" + desde + ";'Fuente Estatico'!$B:$B;\"<\"&" + hasta;
}

/**
 * Tabla de una fila por mes: TC oficial y total del origen. Es el ancla del
 * cuadre -- el reporte ESPEJA el total del origen en vez de recalcularlo.
 * Pestana aparte y no 'Fuente Estatico'!V:W: el script de sync escribe y limpia
 * A:T, y el dia que el origen pase de R hay que correr S y T a la derecha.
 */
function sembrarControl() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Control') || ss.insertSheet('Control');

  for (var m = 1; m <= MESES_CARGADOS; m++) {
    var fila = m;
    sh.getRange(fila, 1).setValue(ANIO * 100 + m);
    sh.getRange(fila, 2).setValue(TC[m - 1]);
    // D10 = celda del ING. TOTALES en cada pestana del origen.
    // Techo conocido: si mueven ese bloque, hay que corregir la referencia.
    sh.getRange(fila, 3).setFormula(
      '=IMPORTRANGE("' + ORIGEN + '";"' + MES[m - 1] + '!D10")');
  }
  console.log('Control: ' + MESES_CARGADOS + ' meses sembrados.');
}

/**
 * El monto en soles depende del TC del MES de la venta, no de una constante.
 * Sin SI.ERROR a proposito: un mes sin TC revienta con #N/A a la vista en vez
 * de convertir en silencio con el TC de otro mes. Es un flujo de dinero.
 * Solo S1: forzarPegado() arrastra S1:T1 hacia abajo con las relativas bien.
 */
function tcMensual() {
  SpreadsheetApp.getActive().getSheetByName('Fuente Estatico').getRange('S1').setFormula(
    '=IF(J1="USD";P1*VLOOKUP(YEAR(B1)*100+MONTH(B1);Control!$A:$B;2;FALSE);P1)');
  console.log('Fuente Estatico!S1: TC mensual aplicado. Correr forzarPegado() para arrastrarlo.');
}

/** Crece la matriz hasta SEMANAS bloques y reescribe mes/semana de cada uno. */
function extender() {
  var sh = hojaIngresos_(SpreadsheetApp.getActive());
  var necesarias = FIRST + SEMANAS * W - 1;
  if (sh.getMaxColumns() < necesarias) {
    sh.insertColumnsAfter(sh.getMaxColumns(), necesarias - sh.getMaxColumns());
  }

  // Mover el ancla recorre la matriz entera: las demas fechas son "= anterior + 1".
  sh.getRange(1, FIRST).setFormula('=DATE(' + ANCLA.join(';') + ')');

  var molde = sh.getRange(1, FIRST + W, FILAS, W); // semana 2: su fila 1 es formula, no literal
  var yaHechas = 5;                                // bloques que existian antes del primer extender()
  for (var w = yaHechas; w < SEMANAS; w++) {
    molde.copyTo(sh.getRange(1, FIRST + w * W, FILAS, W));
  }

  for (var k = 0; k < W; k++) {
    var ancho = sh.getColumnWidth(FIRST + W + k);
    for (var w2 = yaHechas; w2 < SEMANAS; w2++) sh.setColumnWidth(FIRST + w2 * W + k, ancho);
  }
  SpreadsheetApp.flush();

  for (var s = 0; s < SEMANAS; s++) {
    var c = FIRST + s * W;
    sh.getRange(2, c + 5).setValue(MES[sh.getRange(1, c).getValue().getMonth()]);
    sh.getRange(2, c + 6).setValue('Semana ' + (s + 1));
    sh.getRange(3, c + 14).setValue('Subtotal Sem. ' + (s + 1));
  }
  console.log('Matriz: ' + SEMANAS + ' semanas desde ' + ANCLA.join('-') + '.');
}

/** Checksum y etiquetas dd/mm de todos los bloques. */
function arreglar() {
  var sh = hojaIngresos_(SpreadsheetApp.getActive());

  var partes = [];
  for (var t = 0; t < SEMANAS; t++) partes.push(colLetra_(FIRST + t * W + 14) + '4');
  sh.getRange('B1').setFormula('=SUM(' + partes.join(';') + ')');

  for (var s = 0; s < SEMANAS; s++) {
    var c = FIRST + s * W;
    for (var d = 0; d < 7; d++) {
      sh.getRange(3, c + d * 2).setFormula('=TEXT(' + colLetra_(c + d * 2) + '1;"dd/mm")');
    }
  }
  console.log('Checksum y etiquetas: ' + SEMANAS + ' semanas.');
}

/**
 * Pie del mes, los 12. C = total OFICIAL (espejo del origen), F = detalle real
 * de Fuente Estatico, E = la diferencia escrita al lado. No se borra plata ni
 * se duplica en silencio: si el origen y el detalle no cuadran, se ve.
 * Un mes sin fila en Control cae a 0 y deja E vacia.
 */
function pieDelMes() {
  var sh = hojaIngresos_(SpreadsheetApp.getActive());

  for (var m = 1; m <= 12; m++) {
    var fila = FILA_ENERO + m - 1;
    var filtro = filtroMes_(m);

    sh.getRange(fila, 3).setFormula(
      '=IFERROR(VLOOKUP(' + (ANIO * 100 + m) + ';Control!$A:$C;3;FALSE);0)');
    sh.getRange(fila, 4).setFormula(
      "=COUNTIFS('Fuente Estatico'!$K:$K;\"<>\";'Fuente Estatico'!$K:$K;\"<>0\";" + filtro + ')');
    sh.getRange(fila, 6).setFormula("=SUMIFS('Fuente Estatico'!$S:$S;" + filtro + ')');
    sh.getRange(fila, 5).setFormula(
      '=IF(C' + fila + '=0;"";TEXT(F' + fila + '-C' + fila + ';"+#,##0.00;-#,##0.00;""cuadrado"""))');
  }
  console.log('Pie del mes: 12 filas (' + FILA_ENERO + '-' + (FILA_ENERO + 11) + ').');
}

/** Foto del estado antes de tocar nada. Solo lee. */
function estado() {
  var ss = SpreadsheetApp.getActive();
  var out = { hojas: ss.getSheets().map(function (h) { return h.getName(); }) };

  function rango_(sh, col) {
    var v = sh.getRange(1, col, sh.getMaxRows(), 1).getValues();
    var prim = null, ult = null, n = 0;
    for (var i = 0; i < v.length; i++) {
      if (v[i][0] !== '' && v[i][0] !== null) { if (!prim) prim = v[i][0]; ult = v[i][0]; n++; }
    }
    return { filas: n, primera: String(prim), ultima: String(ult) };
  }

  var fp = ss.getSheetByName('Fuente Principal');
  out.fuentePrincipal = { a1: fp.getRange('A1').getFormula().slice(0, 400), fechas: rango_(fp, 2) };

  var fe = ss.getSheetByName('Fuente Estatico');
  out.fuenteEstatico = {
    maxRows: fe.getMaxRows(), lastRow: fe.getLastRow(), fechas: rango_(fe, 2),
    s1: fe.getRange('S1').getFormula(), t1: fe.getRange('T1').getFormula().slice(0, 200)
  };

  var ing = hojaIngresos_(ss);
  out.ingresos = {
    nombre: ing.getName(), maxCols: ing.getMaxColumns(),
    semanas: Math.floor((ing.getMaxColumns() - FIRST + 1) / W),
    c1: ing.getRange(1, FIRST).getFormula() + ' -> ' + ing.getRange(1, FIRST).getDisplayValue(),
    b1: ing.getRange('B1').getFormula().slice(0, 120),
    pie: ing.getRange(50, 1, 15, 6).getDisplayValues().map(function (r, i) { return (50 + i) + ': ' + r.join(' | '); })
  };
  out.ingresosC58 = ing.getRange(58, 3).getFormula();
  out.ingresosE58 = ing.getRange(58, 5).getFormula();
  out.ingresosF58 = ing.getRange(58, 6).getFormula();

  var ctl = ss.getSheetByName('Control');
  out.control = ctl ? ctl.getRange(1, 1, 12, 3).getDisplayValues() : 'NO EXISTE';

  console.log(JSON.stringify(out, null, 1));
}

