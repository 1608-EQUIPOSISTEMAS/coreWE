// ===== Reporte Consolidado: tablero de una hoja, metricas en filas y meses en columnas =====
// Idempotente: borra y rehace la pestana. Toda la data sale de 'Fuente Estatico'.
// Fila 4 (oculta) = primer dia de cada mes; todas las formulas cuelgan de ahi.
// OJO: el locale del archivo usa ';' como separador de argumentos y setFormula NO traduce.
function construirConsolidado() {
  var ANIO = 2026;
  var ss = SpreadsheetApp.getActive();
  // El origen se resuelve ANTES de borrar nada: si la hoja de ingresos falta, la corrida se
  // cae sin haber dejado una pestana vacia a medio construir.
  var diario = hojaIngresos(ss);
  var vieja = ss.getSheetByName(TABLERO);
  // La vieja NO se borra todavia: primero hay que copiarle el encabezado a la nueva.
  var sh = ss.insertSheet(TABLERO + ' (nuevo)', ss.getNumSheets());

  var FE = "'Fuente Estatico'!";
  var MES = FE + '$B:$B;">="&C$4;' + FE + '$B:$B;"<="&EOMONTH(C$4;0)';
  // Los FILTER van con COLUMNA ENTERA a proposito. Con un tope fijo (antes $1:$6000) la data
  // nueva quedaba fuera del rango y, como COUNTUNIQUE(FILTER(vacio)) devuelve 1, los meses
  // recientes mostraban "1 alumno / 1 dia con venta" mientras SUMIFS (sin tope) daba bien.
  var DES = FE + '$B:$B>=C$4;' + FE + '$B:$B<=EOMONTH(C$4;0)';
  var COR = FE + '$D:$D';
  // Ultimo mes cerrado: el mes en curso no promedia porque esta incompleto y hunde el promedio.
  var CERRADO = 'AVERAGEIF($C$4:$N$4;"<="&EOMONTH(TODAY();-1);';
  var BS = String.fromCharCode(92);
  var Q = String.fromCharCode(39);

  function monto(col, val) {
    return '=SUMIFS(' + FE + '$S:$S;' + FE + '$' + col + ':$' + col + ';"' + val + '";' + MES + ')';
  }
  function montoAnio(col, val) {
    return '=SUMIFS(' + FE + '$S:$S;' + FE + '$' + col + ':$' + col + ';"' + val + '")';
  }
  // Alumnos unicos de una unidad: el prefijo de 'Fuente Estatico'!T identifica la unidad.
  function alumnosUnidad(pre, delMes) {
    var uni = 'LEFT(' + FE + '$T:$T;' + pre.length + ')="' + pre + '"';
    return delMes
      ? '=IF(C{trx}=0;0;IFERROR(COUNTUNIQUE(FILTER(' + COR + ';' + DES + ';' + COR + '<>"";' + uni + '));0))'
      : '=IFERROR(COUNTUNIQUE(FILTER(' + COR + ';' + COR + '<>"";' + uni + '));0)';
  }
  // ---- bloque de INGRESOS POR UNIDAD, leido de la hoja de ingresos diarios ----
  // No se redefine la taxonomia aqui: se toma tal cual de esa hoja (col B = etiqueta,
  // col A oculta = clave de 'Fuente Estatico'!T). Asi las dos hojas no pueden divergir.
  // Tipo de fila por su etiqueta:  '1. Algo' = metrica  |  'SUBTOTAL...' = suma  |  resto = banda.
  function bloqueUnidades(diario, FE, MES) {
    var ab = diario.getRange(5, 1, 44, 2).getDisplayValues();

    var filas = [], subs = [], desde = null, hasta = null, n = 0;
    ab.forEach(function (par) {
      var clave = String(par[0]).trim();
      var etq = String(par[1]).trim();
      if (!etq) return;

      if (/^SUBTOTAL/i.test(etq)) {
        var k = 'sub' + subs.length;
        subs.push(k);
        filas.push({
          k: k, t: 'mon', b: etq.replace(/\s+/g, ' '), sub: true,
          f: desde ? '=SUM(C{' + desde + '}:C{' + hasta + '})' : '=0',
          o: desde ? '=SUM(O{' + desde + '}:O{' + hasta + '})' : '=0'
        });
        desde = null; hasta = null;
        return;
      }

      if (/^\d+\./.test(etq)) {
        var kk = 'u' + (n++);
        var f = clave
          ? '=SUMIFS(' + FE + '$S:$S;' + FE + '$T:$T;"' + clave + '";' + MES + ')'
          : '=0';
        var o = clave
          ? '=SUMIFS(' + FE + '$S:$S;' + FE + '$T:$T;"' + clave + '")'
          : '=0';
        filas.push({ k: kk, t: 'mon', b: '   ' + etq, f: f, o: o, sinClave: !clave });
        if (!desde) desde = kk;
        hasta = kk;
        return;
      }

      filas.push({ t: 'sec', b: etq });
    });

    return { filas: filas, subs: subs };
  }
  // t: sec | mon | num | pct ;  f: formula de la columna C ;  o: formula del total
  var UNI = bloqueUnidades(diario, FE, MES);
  var UNIDADES = UNI.filas;
  var RESTO_C = '=ROUND(C{ing}-(' + UNI.subs.map(function (k) { return 'C{' + k + '}'; }).join('+') + ');0)';
  var RESTO_O = '=ROUND(O{ing}-(' + UNI.subs.map(function (k) { return 'O{' + k + '}'; }).join('+') + ');0)';

  var F = [
    { t: 'sec', b: 'RESULTADO DEL MES' },
    // El ingreso del mes NO se recalcula: se lee del pie de la hoja de ingresos, que a su vez
    // espeja el ING. TOTALES de 'Ing. Operativos'. Ese archivo es la fuente oficial y no se
    // toca, asi que el reporte tiene que dar SU numero; sumar 'Fuente Estatico' por nuestra
    // cuenta da otro (ver reporte-diario-sync-fix.md) y tener dos verdades no sirve a nadie.
    { k: 'ing', t: 'mon', b: 'Ingresos', f: "=INDEX('" + diario.getName() + "'!$C$52:$C$63;MONTH(C$4))", o: 'SUMA' },
    { k: 'gro', t: 'pct', b: 'Crecimiento vs mes anterior', f: '', o: '' },
    { k: 'trx', t: 'num', b: 'Transacciones', f: '=COUNTIFS(' + FE + '$K:$K;">0";' + MES + ')', o: 'SUMA' },
    { k: 'tkt', t: 'mon', b: 'Ticket promedio', f: '=IFERROR(C{ing}/C{trx};0)', o: '=IFERROR(O{ing}/O{trx};0)' },
    { k: 'dia', t: 'num', b: 'Dias con venta', f: '=IF(C{trx}=0;0;IFERROR(COUNTUNIQUE(FILTER(' + FE + '$B:$B;' + DES + ';' + FE + '$K:$K>0));0))', o: 'SUMA' },
    { k: 'vpd', t: 'mon', b: 'Venta promedio por dia activo', f: '=IFERROR(C{ing}/C{dia};0)', o: '=IFERROR(O{ing}/O{dia};0)' },

    { t: 'sec', b: 'INGRESOS POR UNIDAD' },
    UNIDADES,
    { k: 'nocl', t: 'mon', b: 'No clasificado (fuera de las 5 unidades)', f: RESTO_C, o: RESTO_O },
    { t: 'sec', b: 'AREA DE CONOCIMIENTO' },
    { k: 'asa', t: 'mon', b: 'SAP', f: monto('G', 'SAP'), o: montoAnio('G', 'SAP') },
    { k: 'abi', t: 'mon', b: 'Business Intelligence', f: monto('G', 'BI'), o: montoAnio('G', 'BI') },
    { k: 'aex', t: 'mon', b: 'Excel', f: monto('G', 'EXCEL'), o: montoAnio('G', 'EXCEL') },
    { k: 'apr', t: 'mon', b: 'Procesos', f: monto('G', 'PROCESOS'), o: montoAnio('G', 'PROCESOS') },
    { k: 'alo', t: 'mon', b: 'Logistica', f: monto('G', 'LOG*'), o: montoAnio('G', 'LOG*') },
    { k: 'aia', t: 'mon', b: 'Inteligencia Artificial', f: monto('G', 'IA'), o: montoAnio('G', 'IA') },
    { k: 'afi', t: 'mon', b: 'Finanzas', f: monto('G', 'FINANZ*'), o: montoAnio('G', 'FINANZ*') },
    { k: 'apy', t: 'mon', b: 'Proyectos', f: monto('G', 'PROYECTOS'), o: montoAnio('G', 'PROYECTOS') },
    { k: 'aot', t: 'mon', b: 'Otras / membresias', f: '=ROUND(C{ing}-SUM(C{asa}:C{apy});0)', o: '=ROUND(O{ing}-SUM(O{asa}:O{apy});0)' },

    { t: 'sec', b: 'ESTRUCTURA DE COBRO' },
    { k: 'ept', t: 'mon', b: 'Pago total (PT)', f: monto('I', 'PT'), o: montoAnio('I', 'PT') },
    { k: 'epp', t: 'mon', b: 'Pago parcial (PP)', f: monto('I', 'PP'), o: montoAnio('I', 'PP') },
    { k: 'ecu', t: 'mon', b: 'Cuotas', f: monto('I', 'CUOTA'), o: montoAnio('I', 'CUOTA') },
    { k: 'epc', t: 'pct', b: '% del ingreso que viene de cuotas', f: '=IFERROR(C{ecu}/C{ing};0)', o: '=IFERROR(O{ecu}/O{ing};0)' },
    { k: 'ebe', t: 'num', b: 'Becas otorgadas', f: '=COUNTIFS(' + FE + '$I:$I;"BECA";' + MES + ')', o: 'SUMA' },

    { t: 'sec', b: 'A QUE EMPRESA ENTRO' },
    { k: 'ted', t: 'mon', b: 'WE Educacion', f: monto('M', 'WE EDUCA*'), o: montoAnio('M', 'WE EDUCA*') },
    { k: 'tfu', t: 'mon', b: 'WE Foundation', f: monto('M', 'WE FOUND*'), o: montoAnio('M', 'WE FOUND*') },
    { k: 'tla', t: 'mon', b: 'WE Latam', f: monto('M', 'WE LATAM*'), o: montoAnio('M', 'WE LATAM*') },
    { k: 'tsa', t: 'mon', b: 'Sin empresa asignada', f: '=ROUND(C{ing}-SUM(C{ted}:C{tla});0)', o: '=ROUND(O{ing}-SUM(O{ted}:O{tla});0)' },

    { t: 'sec', b: 'MEDIO DE PAGO' },
    { k: 'mya', t: 'mon', b: 'Yape', f: monto('L', 'YAPE'), o: montoAnio('L', 'YAPE') },
    { k: 'mcu', t: 'mon', b: 'Culqui', f: monto('L', 'CULQUI'), o: montoAnio('L', 'CULQUI') },
    { k: 'mtr', t: 'mon', b: 'Transferencia', f: monto('L', 'TRANSFERENCIA'), o: montoAnio('L', 'TRANSFERENCIA') },
    { k: 'mmp', t: 'mon', b: 'Mercado Pago', f: monto('L', 'MERCADO PAGO'), o: montoAnio('L', 'MERCADO PAGO') },
    { k: 'mde', t: 'mon', b: 'Deposito', f: monto('L', 'DEPOSITO'), o: montoAnio('L', 'DEPOSITO') },
    { k: 'mot', t: 'mon', b: 'Otros / sin registrar', f: '=ROUND(C{ing}-SUM(C{mya}:C{mde});0)', o: '=ROUND(O{ing}-SUM(O{mya}:O{mde});0)' },
    { t: 'sec', b: 'ALUMNOS   ·   ingresante = su primera compra registrada   ·   comunidad = ya habia comprado antes' },
    { k: 'alt', t: 'num', b: 'Alumnos totales', f: '=IF(C{trx}=0;0;IFERROR(COUNTUNIQUE(FILTER(' + COR + ';' + DES + ';' + COR + '<>""));0))', o: '=IFERROR(COUNTUNIQUE(FILTER(' + COR + ';' + COR + '<>""));0)' },
    { k: 'ali', t: 'num', b: '   Alumnos - Ingresantes ( Nuevos + Leads )', f: '=IF(C{trx}=0;0;IFERROR(C{alt}-SUMPRODUCT(--(COUNTIF(FILTER(' + COR + ';' + FE + '$B:$B<C$4;' + COR + '<>"");UNIQUE(FILTER(' + COR + ';' + DES + ';' + COR + '<>"")))>0));C{alt}))', o: '=O{alt}' },
    { k: 'alc', t: 'num', b: '   Alumnos Comunidad ( Comunidad )', f: '=C{alt}-C{ali}', o: '' },
    { k: 'alp', t: 'pct', b: '% Comunidad', f: '=IFERROR(C{alc}/C{alt};0)', o: '' },
    { k: 'ipa', t: 'mon', b: 'Ingreso por alumno', f: '=IFERROR(C{ing}/C{alt};0)', o: '=IFERROR(O{ing}/O{alt};0)' },

    { t: 'sec', b: 'ALUMNOS POR UNIDAD   ·   un alumno puede comprar en mas de una unidad, por eso NO suman al total' },
    { k: 'aue', t: 'num', b: 'En Vivo', f: alumnosUnidad('ENVIVO', true), o: alumnosUnidad('ENVIVO', false) },
    { k: 'auo', t: 'num', b: 'Online', f: alumnosUnidad('ONLINE', true), o: alumnosUnidad('ONLINE', false) },
    { k: 'aum', t: 'num', b: 'Membresias', f: alumnosUnidad('MEMB', true), o: alumnosUnidad('MEMB', false) },
    { k: 'aub', t: 'num', b: 'B2B / Convenios', f: alumnosUnidad('B2B', true), o: alumnosUnidad('B2B', false) },
    { k: 'auf', t: 'num', b: 'Fundacion WE', f: alumnosUnidad('FUND', true), o: alumnosUnidad('FUND', false) }
  ];
  F = [].concat.apply([], F.map(function (x) { return Array.isArray(x) ? x : [x]; }));

  var fila = {};
  var r0 = 7;
  F.forEach(function (x, i) { if (x.k) fila[x.k] = r0 + i; });
  function res(s) { return s.replace(/\{(\w+)\}/g, function (_, k) { return fila[k]; }); }

  // ---- cabecera ----
  sh.getRange('B2').setValue('CONSOLIDADO MENSUAL ' + ANIO);
  sh.getRange('B3').setValue('Fuente: hoja Fuente Estatico  |  montos en soles, USD al tipo de cambio del mes (hoja TC)  |  PROMEDIO MES = promedio de los meses ya cerrados, el mes en curso no entra  |  se actualiza solo con el sync');
  sh.getRange('C4').setFormula('=DATE(' + ANIO + ';1;1)');
  sh.getRange('D4').setFormula('=EDATE(C4;1)');
  sh.getRange('D4').copyTo(sh.getRange('E4:N4'));
  sh.getRange('B5').setValue('INDICADOR');
  sh.getRange('C5').setFormula('=UPPER(TEXT(C$4;"mmm"))');
  sh.getRange('C5').copyTo(sh.getRange('D5:N5'));
  sh.getRange('O5').setValue('TOTAL');
  sh.getRange('P5').setValue('PROMEDIO MES');
  sh.getRange('Q5').setValue('TENDENCIA');

  // ---- filas ----
  F.forEach(function (x, i) {
    var r = r0 + i;
    sh.getRange(r, 2).setValue(x.b);
    if (x.t === 'sec') return;
    if (x.f) {
      sh.getRange(r, 3).setFormula(res(x.f));
      sh.getRange(r, 3).copyTo(sh.getRange(r, 4, 1, 11));
    }
    if (x.o === 'SUMA') sh.getRange(r, 15).setFormula('=SUM(C' + r + ':N' + r + ')');
    else if (x.o) sh.getRange(r, 15).setFormula(res(x.o));
    sh.getRange(r, 16).setFormula('=IFERROR(' + CERRADO + 'C' + r + ':N' + r + ');0)');
    if (x.t !== 'pct') {
      sh.getRange(r, 17).setFormula('=SPARKLINE(C' + r + ':N' + r + ';{"charttype"' + BS + '"column";"color"' + BS + '"#002060";"empty"' + BS + '"zero"})');
    }
  });
  sh.getRange(fila.gro, 4).setFormula('=IF(D' + fila.ing + '=0;"";IFERROR(D' + fila.ing + '/C' + fila.ing + '-1;""))');
  sh.getRange(fila.gro, 4).copyTo(sh.getRange(fila.gro, 5, 1, 10));

  // ---- top de productos ----
  var rTop = r0 + F.length + 2;
  sh.getRange(rTop, 2).setValue('TOP 15 PRODUCTOS DEL ANIO');
  var qtxt = 'select Col8, count(Col8), sum(Col19) where Col19 > 0 group by Col8 order by sum(Col19) desc limit 15 ' +
    'label Col8 ' + Q + 'Producto' + Q + ', count(Col8) ' + Q + 'Ventas' + Q + ', sum(Col19) ' + Q + 'Ingreso' + Q;
  sh.getRange(rTop + 1, 2).setFormula('=QUERY(' + FE + '$A:$T;"' + qtxt + '";0)');

  formatearConsolidado(sh, F, r0, fila, rTop);
  // El encabezado lo mantiene el equipo a mano y el tablero se rehace borrando la hoja: hay
  // que llevarselo puesto o cada corrida se come el diseno. Se copia DESPUES de formatear,
  // asi lo hecho a mano gana sobre lo que escribio el script.
  if (vieja) {
    adoptarEncabezado(vieja, sh);
    ss.deleteSheet(vieja);
  }
  sh.setName(TABLERO);
  SpreadsheetApp.flush();

  console.log('Consolidado listo. Metricas en filas ' + r0 + '-' + (r0 + F.length - 1) + ', top en ' + rTop + '.');
  ['ing', 'nocl', 'alt', 'ali', 'alc'].forEach(function (k) {
    console.log(k + ': ' + sh.getRange(fila[k], 3, 1, 13).getDisplayValues()[0].join(' | '));
  });
}

// Las pestanas se renombraron en agosto 2026: 'Ingresos Diarios' -> 'Reporte Ingresos' y
// 'Consolidado Mensual' -> 'Reporte Consolidado'. El tablero se busca por nombre exacto
// (hay que crearlo), pero el origen se busca por coincidencia parcial para que el proximo
// renombre no vuelva a romper la generacion.
var TABLERO = 'Reporte Consolidado';

function hojaIngresos(ss) {
  var hoja = ss.getSheets().filter(function (s) { return /ingresos/i.test(s.getName()); })[0];
  if (!hoja) throw new Error('No encuentro la hoja de ingresos diarios (hoy: Reporte Ingresos)');
  return hoja;
}

// Filas 1-3 = encabezado editable a mano (logo, titulo, leyenda). De la 4 hacia abajo manda el
// script: la 4 son las fechas ocultas y de la 5 al final, el tablero.
var FILAS_ENCABEZADO = 3;

function adoptarEncabezado(origen, destino) {
  var cols = Math.min(origen.getMaxColumns(), destino.getMaxColumns());
  origen.getRange(1, 1, FILAS_ENCABEZADO, cols).copyTo(destino.getRange(1, 1));
  for (var r = 1; r <= FILAS_ENCABEZADO; r++) destino.setRowHeight(r, origen.getRowHeight(r));
  copiarImagenes(origen, destino);
}

// copyTo no arrastra las imagenes sobre la cuadricula, y el logo es una de ellas: van aparte.
function copiarImagenes(origen, destino) {
  origen.getImages().forEach(function (img) {
    var ancla = img.getAnchorCell();
    if (ancla.getRow() > FILAS_ENCABEZADO) return;
    destino.insertImage(img.getBlob(), ancla.getColumn(), ancla.getRow(),
                        img.getAnchorCellXOffset(), img.getAnchorCellYOffset())
           .setWidth(img.getWidth())
           .setHeight(img.getHeight());
  });
}

function formatearConsolidado(sh, F, r0, fila, rTop) {
  var NAVY = '#002060', SUAVE = '#EEF2F8', GRIS = '#F7F8FA';
  var ultima = r0 + F.length - 1;

  sh.setHiddenGridlines(true);
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setFontFamily('Nunito').setFontSize(10);
  sh.setColumnWidth(1, 24);
  sh.setColumnWidth(2, 260);
  for (var c = 3; c <= 14; c++) sh.setColumnWidth(c, 86);
  sh.setColumnWidth(15, 104);
  sh.setColumnWidth(16, 104);
  sh.setColumnWidth(17, 120);

  sh.getRange('B2:Q2').merge().setFontSize(18).setFontWeight('bold').setFontColor(NAVY);
  sh.getRange('B3:Q3').merge().setFontSize(9).setFontColor('#6B7280');
  sh.setRowHeight(2, 34);

  sh.getRange(5, 2, 1, 16).setBackground(NAVY).setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
  sh.getRange(5, 2).setHorizontalAlignment('left');
  sh.setRowHeight(5, 26);
  sh.hideRows(4);

  F.forEach(function (x, i) {
    var r = r0 + i;
    if (x.t === 'sec') {
      sh.getRange(r, 2, 1, 16).merge().setBackground(SUAVE).setFontColor(NAVY)
        .setFontWeight('bold').setFontSize(10);
      sh.setRowHeight(r, 24);
      return;
    }
    sh.getRange(r, 2).setFontColor(x.sinClave ? '#9CA3AF' : '#111827');
    if (x.sub) sh.getRange(r, 2, 1, 16).setFontWeight('bold').setBackground('#E8EEF7');
    if (x.sinClave) sh.getRange(r, 2, 1, 15).setFontStyle('italic');
    // C..P: el promedio mensual se lee en la misma unidad que la fila, por eso comparte formato.
    var rango = sh.getRange(r, 3, 1, 14);
    if (x.t === 'mon') rango.setNumberFormat('"S/."#,##0;-"S/."#,##0;"-"');
    if (x.t === 'num') rango.setNumberFormat('#,##0;-#,##0;"-"');
    if (x.t === 'pct') rango.setNumberFormat('0.0%;-0.0%;"-"');
    sh.getRange(r, 16).setFontColor('#6B7280');
    if (i % 2 === 1) sh.getRange(r, 2, 1, 16).setBackground(GRIS);
  });

  // el bloque de resultado y la columna TOTAL mandan visualmente
  sh.getRange(fila.ing, 2, 1, 16).setFontWeight('bold').setBackground('#DCE6F5');
  sh.getRange(r0, 15, F.length, 1).setFontWeight('bold');
  sh.getRange(fila.gro, 3, 1, 12).setNumberFormat('+0.0%;-0.0%;"-"');

  sh.getRange(rTop, 2, 1, 3).merge().setBackground(NAVY).setFontColor('#FFFFFF')
    .setFontWeight('bold').setFontSize(10);
  sh.setRowHeight(rTop, 24);
  sh.getRange(rTop + 1, 2, 16, 1).setFontColor('#111827');
  sh.getRange(rTop + 1, 4, 16, 1).setNumberFormat('"S/."#,##0');
  sh.getRange(rTop + 1, 2, 1, 3).setFontWeight('bold');

  var ini = null;
  F.forEach(function (x, i) {
    var r = r0 + i;
    if (x.t === 'sec') {
      if (ini && r - 1 > ini) sh.getRange(ini + 1, 1, r - 1 - ini).shiftRowGroupDepth(1);
      ini = r;
    }
  });
  if (ini && r0 + F.length - 1 > ini) sh.getRange(ini + 1, 1, r0 + F.length - 1 - ini).shiftRowGroupDepth(1);

  sh.setFrozenRows(5);

}


