import ExcelJS from 'exceljs'
import { DomainError } from '../../shared/errors.js'
import { COLUMNAS_PLANTILLA_PERSONAL } from './planilla.entity.js'

// Archivo subido -> matriz de filas (arrays de celdas). La interpretacion de las
// columnas la hace la entity; aca solo se lee el formato.

function leerCsv (buffer) {
  const txt = buffer.toString('utf8').replace(/^﻿/, '')
  const sep = (txt.split(/\r?\n/, 1)[0].match(/;/g) || []).length > (txt.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? ';' : (txt.includes('\t') ? '\t' : ',')
  return txt.split(/\r?\n/).map(linea => linea.split(sep).map(c => c.replace(/^"|"$/g, '').trim()))
}

export async function leerArchivo (buffer, nombre = '') {
  const n = nombre.toLowerCase()
  if (n.endsWith('.csv') || n.endsWith('.txt')) return leerCsv(buffer)
  if (!n.endsWith('.xlsx')) {
    throw new DomainError('Formato no soportado. Sube un .xlsx o .csv (si el huellero exporta .xls, abrelo en Excel y guardalo como .xlsx).', { statusCode: 400 })
  }
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buffer)
  } catch {
    throw new DomainError('No se pudo leer el Excel. Verifica que no este dañado ni protegido con clave.', { statusCode: 400 })
  }
  // La hoja con mas filas: los huelleros a veces agregan una portada.
  const ws = wb.worksheets.reduce((a, b) => (b.actualRowCount > (a?.actualRowCount || 0) ? b : a), null)
  if (!ws) throw new DomainError('El Excel no tiene hojas.', { statusCode: 400 })
  const filas = []
  ws.eachRow({ includeEmpty: true }, (row, i) => {
    const vals = row.values.slice(1).map(v => (v && typeof v === 'object' && 'result' in v ? v.result : v))
    filas[i - 1] = vals
  })
  return filas
}

export async function plantillaPersonal () {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Personal')
  ws.addRow(COLUMNAS_PLANTILLA_PERSONAL)
  ws.addRow(['101', '12345678', 'Apellidos y Nombres', 'FICO', 2500])
  ws.getRow(1).font = { bold: true }
  ws.columns = [{ width: 18 }, { width: 14 }, { width: 36 }, { width: 16 }, { width: 14 }]
  ws.getColumn(5).numFmt = '#,##0.00'
  return wb.xlsx.writeBuffer()
}

export async function exportarPlanilla ({ anio, mes, filas }) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(`Planilla ${anio}-${String(mes).padStart(2, '0')}`)
  ws.addRow(['Codigo', 'DNI', 'Nombre', 'Area', 'Sueldo neto', 'Quincena (40%)', 'Fin de mes (60%)', 'Tardanzas', 'Minutos', 'Descuento', 'A pagar fin de mes'])
  ws.getRow(1).font = { bold: true }
  for (const f of filas) {
    ws.addRow([f.codigo, f.dni, f.nombre, f.area, f.sueldo_neto, f.pago_quincena, f.pago_fin_mes_bruto, f.tardanzas, f.minutos_tardanza, f.descuento_tardanza, f.pago_fin_mes])
  }
  ws.columns = [12, 12, 36, 14, 13, 14, 15, 10, 10, 12, 18].map(width => ({ width }))
  for (const c of [5, 6, 7, 10, 11]) ws.getColumn(c).numFmt = '#,##0.00'

  const det = wb.addWorksheet('Detalle tardanzas')
  det.addRow(['Codigo', 'Nombre', 'Fecha', 'Entrada', 'Hora ingreso', 'Minutos', 'Descuento', 'Justificado'])
  det.getRow(1).font = { bold: true }
  for (const f of filas) {
    for (const d of f.detalle.filter(x => x.minutos_tardanza > 0 || x.justificado)) {
      det.addRow([f.codigo, f.nombre, d.fecha, d.entrada, f.hora_ingreso, d.minutos_tardanza, d.descuento, d.justificado ? (d.justificacion || 'Si') : ''])
    }
  }
  det.columns = [12, 36, 12, 10, 12, 10, 12, 30].map(width => ({ width }))
  return wb.xlsx.writeBuffer()
}
