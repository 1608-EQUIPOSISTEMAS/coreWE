import { DomainError } from '../../shared/errors.js'

// Logica pura del modulo Planilla (Talento / RRHH). Sin BD ni HTTP: todo lo que
// decide cuanto se paga y cuanto se descuenta vive aca para poder probarlo.
//
// Contexto (reunion previa con Talento, 30/10/2026; la definitiva es el 02/11):
// - El personal emite recibo por honorarios: se paga el NETO, sin AFP/ONP.
// - 1.a quincena = 40 % del neto, sin descuentos.
// - Fin de mes = 60 % del neto MENOS las tardanzas del mes.
// - Tolerancia hasta HH:10:59 sobre la hora de ingreso. Desde el minuto 11 se
//   computa 30 min de tardanza; pasado el minuto 30 se computa 1 hora.

export const PORCENTAJE_QUINCENA = 0.40
export const PORCENTAJE_FIN_MES = 0.60

// Valor del minuto como en una empresa grande: mes de 30 dias y jornada de 8 h.
// Queda en constantes para ajustarlo cuando Talento confirme su criterio.
export const DIAS_MES = 30
export const HORAS_JORNADA = 8

// Tramos de tardanza, en segundos de retraso sobre la hora de ingreso.
// `hasta` es inclusivo: 10:59 de retraso todavia es tolerancia.
export const TRAMOS_TARDANZA = [
  { hasta: 10 * 60 + 59, minutos: 0 },
  { hasta: 30 * 60 + 59, minutos: 30 },
  { hasta: Infinity, minutos: 60 }
]

// Horario por area. FICO y B2B entran 8:30 y salen 7:00 pm; el resto 9:00 a 7:30 pm.
export const HORARIOS = {
  TEMPRANO: { ingreso: '08:30', salida: '19:00' },
  GENERAL: { ingreso: '09:00', salida: '19:30' }
}
const AREAS_TEMPRANO = ['FICO', 'B2B']

export function horarioDeArea (area) {
  const a = String(area || '').trim().toUpperCase()
  return AREAS_TEMPRANO.includes(a) ? HORARIOS.TEMPRANO : HORARIOS.GENERAL
}

// ── Horas ────────────────────────────────────────────────────────────────

// 'HH:MM' o 'HH:MM:SS' -> segundos desde medianoche. null si no es una hora.
export function horaASegundos (hora) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(hora || '').trim())
  if (!m) return null
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] || 0)]
  if (h > 23 || mi > 59 || s > 59) return null
  return h * 3600 + mi * 60 + s
}

export function segundosAHora (seg) {
  const h = Math.floor(seg / 3600)
  const m = Math.floor((seg % 3600) / 60)
  const s = seg % 60
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':')
}

// ── Tardanza ─────────────────────────────────────────────────────────────

// Minutos de tardanza que se computan por una entrada. 0 si llego a tiempo.
export function minutosDeTardanza (entrada, horaIngreso) {
  const e = horaASegundos(entrada)
  const h = horaASegundos(horaIngreso)
  if (e === null || h === null) return 0
  const retraso = e - h
  if (retraso <= 0) return 0
  return TRAMOS_TARDANZA.find(t => retraso <= t.hasta).minutos
}

export function valorMinuto (sueldoNeto) {
  return Number(sueldoNeto || 0) / DIAS_MES / HORAS_JORNADA / 60
}

const redondear = n => Math.round(n * 100) / 100

// ── Planilla ─────────────────────────────────────────────────────────────

/**
 * Detalle de un trabajador en el mes.
 * @param {object} p   { sueldoNeto, horaIngreso }
 * @param {Array}  dias [{ fecha, entrada, salida, justificado }]
 */
export function calcularTrabajador ({ sueldoNeto, horaIngreso }, dias = []) {
  const vm = valorMinuto(sueldoNeto)
  const detalle = dias.map(d => {
    const minutos = d.justificado ? 0 : minutosDeTardanza(d.entrada, horaIngreso)
    return { ...d, minutos_tardanza: minutos, descuento: redondear(minutos * vm) }
  })
  const minutos = detalle.reduce((a, d) => a + d.minutos_tardanza, 0)
  const neto = Number(sueldoNeto || 0)
  const quincena = redondear(neto * PORCENTAJE_QUINCENA)
  const finMesBruto = redondear(neto - quincena)
  // El descuento se calcula sobre el total de minutos (no sumando redondeos por dia).
  const descuento = Math.min(redondear(minutos * vm), finMesBruto)
  return {
    dias_asistidos: detalle.length,
    tardanzas: detalle.filter(d => d.minutos_tardanza > 0).length,
    minutos_tardanza: minutos,
    valor_minuto: Math.round(vm * 10000) / 10000,
    sueldo_neto: neto,
    pago_quincena: quincena,
    pago_fin_mes_bruto: finMesBruto,
    descuento_tardanza: descuento,
    pago_fin_mes: redondear(finMesBruto - descuento),
    detalle
  }
}

// ── Periodo ──────────────────────────────────────────────────────────────

export function validarPeriodo (anio, mes) {
  const a = Number(anio)
  const m = Number(mes)
  if (!Number.isInteger(a) || a < 2020 || a > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new DomainError('Periodo invalido (anio/mes).', { statusCode: 400 })
  }
  const desde = `${a}-${String(m).padStart(2, '0')}-01`
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  const hasta = `${a}-${String(m).padStart(2, '0')}-${ultimo}`
  return { anio: a, mes: m, desde, hasta }
}

// ── Importacion del huellero ─────────────────────────────────────────────

const sinTildes = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Los huelleros (ZKTeco y similares) exportan con nombres de columna distintos
// segun modelo e idioma. Se busca por palabra clave, no por posicion.
const CLAVES_HUELLERO = {
  codigo: ['ac-no', 'ac no', 'no.', 'id de usuario', 'id usuario', 'user id', 'userid', 'enroll', 'codigo', 'cod', 'id', 'no', 'dni', 'documento'],
  nombre: ['nombre', 'name', 'empleado', 'trabajador', 'personal'],
  fechaHora: ['fecha/hora', 'fecha hora', 'date/time', 'datetime', 'tiempo', 'time', 'checktime'],
  fecha: ['fecha', 'date', 'dia'],
  hora: ['hora', 'hour'],
  departamento: ['departamento', 'department', 'dept', 'area']
}

function buscarColumna (headers, claves, usadas) {
  for (const clave of claves) {
    const idx = headers.findIndex((h, i) => !usadas.has(i) && h === clave)
    if (idx >= 0) return idx
  }
  for (const clave of claves) {
    if (clave.length < 4) continue
    const idx = headers.findIndex((h, i) => !usadas.has(i) && h.includes(clave))
    if (idx >= 0) return idx
  }
  return -1
}

// Recibe las filas crudas (arrays) y devuelve { headerRow, cols } o lanza error.
export function detectarColumnasHuellero (filas) {
  for (let r = 0; r < Math.min(filas.length, 15); r++) {
    const headers = (filas[r] || []).map(sinTildes)
    const usadas = new Set()
    const tomar = claves => { const i = buscarColumna(headers, claves, usadas); if (i >= 0) usadas.add(i); return i }
    const fechaHora = tomar(CLAVES_HUELLERO.fechaHora)
    const fecha = fechaHora >= 0 ? -1 : tomar(CLAVES_HUELLERO.fecha)
    const hora = fechaHora >= 0 ? -1 : tomar(CLAVES_HUELLERO.hora)
    const nombre = tomar(CLAVES_HUELLERO.nombre)
    const departamento = tomar(CLAVES_HUELLERO.departamento)
    const codigo = tomar(CLAVES_HUELLERO.codigo)
    const tieneTiempo = fechaHora >= 0 || (fecha >= 0 && hora >= 0)
    if (codigo >= 0 && tieneTiempo) {
      return { headerRow: r, cols: { codigo, nombre, fechaHora, fecha, hora, departamento } }
    }
  }
  throw new DomainError(
    'No se reconocieron las columnas del huellero. Se necesita una columna de codigo/ID del trabajador y la fecha y hora de la marcacion.',
    { statusCode: 422 }
  )
}

const pad = n => String(n).padStart(2, '0')

// Las celdas de fecha de Excel llegan como Date con la hora "de pared" en UTC.
function desdeDate (d) {
  return {
    fecha: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    hora: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  }
}

function fechaDeTexto (s) {
  const t = String(s ?? '').trim()
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(t)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/.exec(t)
  if (m) {
    const anio = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${anio}-${pad(m[2])}-${pad(m[1])}` // formato peruano: dd/mm/aaaa
  }
  return null
}

function horaDeTexto (s) {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?/i.exec(String(s ?? ''))
  if (!m) return null
  let h = Number(m[1])
  const ampm = (m[4] || '').toLowerCase()
  if (ampm === 'p' && h < 12) h += 12
  if (ampm === 'a' && h === 12) h = 0
  if (h > 23) return null
  return `${pad(h)}:${m[2]}:${pad(m[3] || 0)}`
}

function leerFecha (v) {
  if (v instanceof Date) return desdeDate(v).fecha
  if (typeof v === 'number') return desdeDate(new Date(Math.round((v - 25569) * 86400000))).fecha
  return fechaDeTexto(v)
}

function leerHora (v) {
  if (v instanceof Date) return desdeDate(v).hora
  if (typeof v === 'number') {
    const seg = Math.round((v % 1) * 86400)
    return segundosAHora(seg % 86400)
  }
  return horaDeTexto(v)
}

function texto (v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && 'text' in v) return String(v.text).trim()
  if (typeof v === 'object' && 'result' in v) return String(v.result).trim()
  return String(v).trim()
}

/**
 * Filas crudas del Excel -> marcaciones { codigo, nombre, departamento, fecha, hora }.
 * Devuelve tambien las filas que no se pudieron leer, para mostrarlas en la vista previa.
 */
export function parsearMarcaciones (filas) {
  const { headerRow, cols } = detectarColumnasHuellero(filas)
  const marcaciones = []
  const errores = []
  for (let r = headerRow + 1; r < filas.length; r++) {
    const fila = filas[r] || []
    if (fila.every(c => texto(c) === '')) continue
    const codigo = texto(fila[cols.codigo]).replace(/\.0+$/, '')
    let fecha, hora
    if (cols.fechaHora >= 0) {
      const v = fila[cols.fechaHora]
      fecha = leerFecha(v)
      hora = leerHora(v)
    } else {
      fecha = leerFecha(fila[cols.fecha])
      hora = leerHora(fila[cols.hora])
    }
    if (!codigo || !fecha || !hora) {
      errores.push({ fila: r + 1, motivo: !codigo ? 'Sin codigo de trabajador' : 'Fecha u hora ilegible' })
      continue
    }
    marcaciones.push({
      codigo,
      nombre: cols.nombre >= 0 ? texto(fila[cols.nombre]) : '',
      departamento: cols.departamento >= 0 ? texto(fila[cols.departamento]) : '',
      fecha,
      hora
    })
  }
  return { marcaciones, errores }
}

// Una fila por trabajador y dia: primera marca = entrada, ultima = salida.
export function agruparPorDia (marcaciones) {
  const map = new Map()
  for (const m of marcaciones) {
    const key = `${m.codigo}|${m.fecha}`
    const seg = horaASegundos(m.hora)
    const d = map.get(key) || { codigo: m.codigo, nombre: m.nombre, departamento: m.departamento, fecha: m.fecha, min: seg, max: seg, marcas: 0 }
    d.min = Math.min(d.min, seg)
    d.max = Math.max(d.max, seg)
    d.marcas++
    if (!d.nombre && m.nombre) d.nombre = m.nombre
    map.set(key, d)
  }
  return [...map.values()]
    .map(d => ({
      codigo: d.codigo,
      nombre: d.nombre,
      departamento: d.departamento,
      fecha: d.fecha,
      entrada: segundosAHora(d.min),
      // Con una sola marca no hay salida: queda para revision.
      salida: d.marcas > 1 ? segundosAHora(d.max) : null,
      marcas: d.marcas
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo) || a.fecha.localeCompare(b.fecha))
}

// ── Importacion del maestro de personal ──────────────────────────────────

const CLAVES_PERSONAL = {
  codigo: ['codigo huellero', 'codigo', 'id huellero', 'id', 'ac-no'],
  dni: ['dni', 'documento', 'nro documento'],
  nombre: ['nombre', 'apellidos y nombres', 'trabajador', 'personal'],
  area: ['area', 'departamento'],
  sueldo: ['sueldo neto', 'neto', 'sueldo', 'remuneracion', 'honorario', 'monto']
}

export const COLUMNAS_PLANTILLA_PERSONAL = ['Codigo huellero', 'DNI', 'Nombre', 'Area', 'Sueldo neto']

export function parsearPersonal (filas) {
  let headerRow = -1
  let cols = null
  for (let r = 0; r < Math.min(filas.length, 10) && headerRow < 0; r++) {
    const headers = (filas[r] || []).map(sinTildes)
    const usadas = new Set()
    const tomar = claves => { const i = buscarColumna(headers, claves, usadas); if (i >= 0) usadas.add(i); return i }
    const c = {
      sueldo: tomar(CLAVES_PERSONAL.sueldo),
      dni: tomar(CLAVES_PERSONAL.dni),
      codigo: tomar(CLAVES_PERSONAL.codigo),
      nombre: tomar(CLAVES_PERSONAL.nombre),
      area: tomar(CLAVES_PERSONAL.area)
    }
    if (c.nombre >= 0 && c.sueldo >= 0 && (c.codigo >= 0 || c.dni >= 0)) { headerRow = r; cols = c }
  }
  if (!cols) {
    throw new DomainError('No se reconocieron las columnas. Usa la plantilla: Codigo huellero, DNI, Nombre, Area, Sueldo neto.', { statusCode: 422 })
  }

  const personal = []
  const errores = []
  for (let r = headerRow + 1; r < filas.length; r++) {
    const fila = filas[r] || []
    if (fila.every(c => texto(c) === '')) continue
    const get = i => (i >= 0 ? texto(fila[i]) : '')
    const dni = get(cols.dni).replace(/\.0+$/, '')
    const codigo = get(cols.codigo).replace(/\.0+$/, '') || dni
    const nombre = get(cols.nombre)
    const sueldoTxt = get(cols.sueldo).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.')
    const sueldo = Number(sueldoTxt)
    const motivo = !codigo ? 'Falta codigo de huellero o DNI'
      : !nombre ? 'Falta nombre'
        : !(sueldo > 0) ? 'Sueldo neto invalido'
          : null
    if (motivo) { errores.push({ fila: r + 1, motivo }); continue }
    personal.push({ codigo, dni: dni || null, nombre, area: get(cols.area).toUpperCase() || null, sueldo_neto: Math.round(sueldo * 100) / 100 })
  }

  const vistos = new Set()
  for (const p of personal) {
    if (vistos.has(p.codigo)) throw new DomainError(`El codigo ${p.codigo} esta repetido en el archivo.`, { statusCode: 422 })
    vistos.add(p.codigo)
  }
  return { personal, errores }
}

// ── Permisos ─────────────────────────────────────────────────────────────

// Los sueldos solo los ve TALENTO. ADMIN entra al modulo (soporte) pero sin montos.
export function puedeVerSueldos (roles = []) {
  return roles.includes('TALENTO')
}

export function assertPuedeVerSueldos (roles) {
  if (!puedeVerSueldos(roles)) {
    throw new DomainError('Solo el area de Talento puede ver o cargar sueldos.', { statusCode: 403, code: 'PLANILLA_SUELDOS' })
  }
}
