// One-off: arma el libro "Sistemas Tickets | Catálogo y SLA 2026" (reemplaza a
// "Incidencias y Solictudes | Sistemas Tickets"). Cuatro pestañas:
//   Niveles   → urgencia, impacto, prioridad→SLA y matriz (fuente de las fórmulas)
//   Catálogo  → ítems por área; prioridad/SLA/volumen/cumplimiento son fórmulas
//   Tickets   → los tickets reales de Slack (15/08–14/09/2026) medidos en min hábiles
//   Resumen   → cumplimiento por tipo, prioridad y área (COUNTIFS vivos)
//
// Uso: node scripts/sheets-catalogo-sla.mjs <spreadsheetId> <tickets_sla.json>
// La cuenta de servicio (credentials/service.json) debe tener acceso de editor.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { google } from 'googleapis'

const [spreadsheetId, ticketsPath] = process.argv.slice(2)
if (!spreadsheetId || !ticketsPath) {
  console.error('Uso: node scripts/sheets-catalogo-sla.mjs <spreadsheetId> <tickets_sla.json>')
  process.exit(1)
}

const NAVY = { red: 0, green: 0x20 / 255, blue: 0x60 / 255 }
const WHITE = { red: 1, green: 1, blue: 1 }

const URGENCIAS = [
  ['Crítica', 'Bloquea ahora un cobro, una venta o una clase en curso.'],
  ['Alta', 'Afecta la operación del día; sin solución hoy hay retraso visible.'],
  ['Media', 'Puede esperar días sin afectar clientes ni cierres.'],
  ['Baja', 'Consulta, mejora o pedido sin fecha comprometida.'],
]
const IMPACTOS = [
  ['Crítico', 'Dinero, ventas, ingresos operativos o muchos alumnos.'],
  ['Alto', 'Un área completa o un reporte de gerencia.'],
  ['Medio', 'Una persona, un curso o un grupo pequeño.'],
  ['Bajo', 'Cosmético o de uso interno sin efecto en el negocio.'],
]
// Minutos hábiles con jornada L–V 09:00–18:00 (1 día hábil = 540 min).
const PRIORIDADES = [
  ['P1', '15 minutos', '4 horas hábiles', 15, 240],
  ['P2', '30 minutos', '1 día hábil', 30, 540],
  ['P3', '1 hora', '3 días hábiles', 60, 1620],
  ['P4', '4 horas hábiles', '5 días hábiles', 240, 2700],
]
const MATRIZ = [
  ['Crítica', 'P1', 'P1', 'P1', 'P2'],
  ['Alta', 'P1', 'P1', 'P2', 'P3'],
  ['Media', 'P1', 'P2', 'P3', 'P4'],
  ['Baja', 'P2', 'P3', 'P4', 'P4'],
]
const TIPOS = [
  ['Incidente', 'Algo que funcionaba dejó de funcionar o da un dato incorrecto.'],
  ['Solicitud', 'Pedido de un entregable o cambio: base, reporte, acceso, configuración.'],
  ['Consulta', 'Duda de uso o de dónde está algo; se resuelve con una respuesta.'],
  ['Queja de flujo', 'El proceso funciona pero es engorroso, lento o interrumpe; alimenta mejoras.'],
]
const CATEGORIAS = [
  ['Error en Datos', 'Datos incorrectos, faltantes o que no jalan entre sistemas.'],
  ['Base de Datos', 'Crear, importar, depurar o entregar bases.'],
  ['Documentos', 'Reportes, certificados, credenciales y archivos generados.'],
  ['Visualización', 'Dashboards, Looker y pantallas.'],
  ['Configuración', 'Parámetros, formularios, correos automáticos y bots.'],
  ['Accesos', 'Usuarios, permisos y cuentas corporativas.'],
  ['Revisión', 'Validar flujos, fórmulas, diseños o ediciones.'],
  ['Contenido', 'PPT, video, news y material.'],
  ['Soporte', 'Uso del sistema, equipos e infraestructura.'],
]
const AREAS = ['TODAS', 'FUNDACIÓN', 'ACADEMICA', 'B2B', 'COMERCIAL', 'PRODUCTO', 'FICO', 'GERENCIA', 'MARKETING', 'SISTEMAS', 'OTRO']

// [id, área, ítem, tipo, categoría, urgencia, impacto, automatizable]
const CATALOGO = [
  ['GEN-01', 'TODAS', 'Sistema caído (ERP / Nexus)', 'Incidente', 'Soporte', 'Crítica', 'Crítico', 'No'],
  ['GEN-02', 'TODAS', 'Usuarios y permisos del ERP / Nexus', 'Solicitud', 'Accesos', 'Media', 'Medio', 'Si'],
  ['GEN-03', 'TODAS', 'No puede ingresar al sistema', 'Incidente', 'Accesos', 'Alta', 'Medio', 'No'],
  ['GEN-04', 'TODAS', 'Cuentas corporativas (correo, Slack, Drive, redes)', 'Solicitud', 'Accesos', 'Media', 'Medio', 'No'],
  ['GEN-05', 'TODAS', 'Soporte de equipos e internet', 'Incidente', 'Soporte', 'Media', 'Medio', 'No'],
  ['GEN-06', 'TODAS', 'Consulta de uso del sistema', 'Consulta', 'Soporte', 'Baja', 'Bajo', 'Si'],
  ['GEN-07', 'TODAS', 'Mejora o queja de flujo', 'Queja de flujo', 'Configuración', 'Baja', 'Medio', 'No'],
  ['GEN-08', 'TODAS', 'Error de pantalla, búsqueda o filtros', 'Incidente', 'Error en Datos', 'Media', 'Medio', 'No'],
  ['FUN-01', 'FUNDACIÓN', 'Revisión de flujos operativos', 'Solicitud', 'Revisión', 'Media', 'Medio', 'No'],
  ['FUN-02', 'FUNDACIÓN', 'Base de eventos', 'Solicitud', 'Base de Datos', 'Alta', 'Alto', 'Si'],
  ['FUN-03', 'FUNDACIÓN', 'Revisión de ficha de eventos', 'Solicitud', 'Revisión', 'Media', 'Medio', 'No'],
  ['FUN-04', 'FUNDACIÓN', 'Reporte de masivos', 'Solicitud', 'Documentos', 'Alta', 'Alto', 'Si'],
  ['FUN-05', 'FUNDACIÓN', 'Realización de credenciales', 'Solicitud', 'Documentos', 'Media', 'Medio', 'Si'],
  ['FUN-06', 'FUNDACIÓN', 'Generar certificados', 'Solicitud', 'Documentos', 'Media', 'Alto', 'Si'],
  ['FUN-07', 'FUNDACIÓN', 'Revisión de PPT', 'Solicitud', 'Contenido', 'Media', 'Medio', 'No'],
  ['FUN-08', 'FUNDACIÓN', 'Revisión de video', 'Solicitud', 'Contenido', 'Media', 'Medio', 'No'],
  ['FUN-09', 'FUNDACIÓN', 'Creación del Bot', 'Solicitud', 'Configuración', 'Alta', 'Alto', 'No'],
  ['FUN-10', 'FUNDACIÓN', 'Configuración de Bot', 'Solicitud', 'Configuración', 'Alta', 'Alto', 'No'],
  ['ACA-01', 'ACADEMICA', 'Lista de notas', 'Solicitud', 'Base de Datos', 'Alta', 'Alto', 'Si'],
  ['ACA-02', 'ACADEMICA', 'Base de datos semanal', 'Solicitud', 'Base de Datos', 'Media', 'Medio', 'Si'],
  ['ACA-03', 'ACADEMICA', 'Base de datos mensual', 'Solicitud', 'Base de Datos', 'Media', 'Alto', 'Si'],
  ['ACA-04', 'ACADEMICA', 'Reportes de Looker', 'Solicitud', 'Visualización', 'Media', 'Medio', 'Si'],
  ['ACA-05', 'ACADEMICA', 'Verificación de laptops', 'Solicitud', 'Revisión', 'Media', 'Medio', 'No'],
  ['ACA-06', 'ACADEMICA', 'Certificados online', 'Solicitud', 'Documentos', 'Alta', 'Alto', 'Si'],
  ['ACA-07', 'ACADEMICA', 'Instalaciones', 'Solicitud', 'Configuración', 'Alta', 'Alto', 'No'],
  ['ACA-08', 'ACADEMICA', 'Generadores (kit docente)', 'Solicitud', 'Configuración', 'Media', 'Alto', 'Si'],
  ['ACA-09', 'ACADEMICA', 'Alumno o curso con datos incorrectos en lista / aula', 'Incidente', 'Error en Datos', 'Alta', 'Medio', 'No'],
  ['ACA-10', 'ACADEMICA', 'Reprogramaciones (bandeja y cancelaciones)', 'Incidente', 'Error en Datos', 'Media', 'Alto', 'No'],
  ['ACA-11', 'ACADEMICA', 'Auditoría de docentes', 'Incidente', 'Error en Datos', 'Media', 'Medio', 'No'],
  ['ACA-12', 'ACADEMICA', 'Exámenes y encuestas en Nexus (intentos, preguntas)', 'Solicitud', 'Configuración', 'Media', 'Medio', 'No'],
  ['ACA-13', 'ACADEMICA', 'Base de members', 'Solicitud', 'Base de Datos', 'Media', 'Alto', 'Si'],
  ['ACA-14', 'ACADEMICA', 'Kit docente con error (usuario, PDF)', 'Incidente', 'Documentos', 'Media', 'Medio', 'No'],
  ['B2B-01', 'B2B', 'Control de ventas', 'Solicitud', 'Base de Datos', 'Alta', 'Crítico', 'Si'],
  ['B2B-02', 'B2B', 'Control de empresas', 'Solicitud', 'Base de Datos', 'Alta', 'Alto', 'Si'],
  ['B2B-03', 'B2B', 'Base de asesoras', 'Solicitud', 'Base de Datos', 'Media', 'Medio', 'Si'],
  ['B2B-04', 'B2B', 'Ingresos operativos B2B', 'Solicitud', 'Base de Datos', 'Alta', 'Crítico', 'Si'],
  ['B2B-05', 'B2B', 'Lista de asistencias', 'Solicitud', 'Base de Datos', 'Media', 'Medio', 'Si'],
  ['B2B-06', 'B2B', 'Certificación B2B', 'Solicitud', 'Documentos', 'Alta', 'Alto', 'Si'],
  ['B2B-07', 'B2B', 'Modificaciones Looker', 'Solicitud', 'Configuración', 'Media', 'Medio', 'No'],
  ['B2B-08', 'B2B', 'Drive de su equipo', 'Consulta', 'Soporte', 'Baja', 'Bajo', 'No'],
  ['B2B-09', 'B2B', 'Looker de encuestas para empresa cliente', 'Solicitud', 'Visualización', 'Media', 'Alto', 'Si'],
  ['COM-01', 'COMERCIAL', 'Configuración de Bot', 'Solicitud', 'Configuración', 'Alta', 'Alto', 'No'],
  ['COM-02', 'COMERCIAL', 'Base de asesoras', 'Solicitud', 'Base de Datos', 'Alta', 'Alto', 'Si'],
  ['COM-03', 'COMERCIAL', 'Reportes', 'Solicitud', 'Documentos', 'Alta', 'Alto', 'Si'],
  ['COM-04', 'COMERCIAL', 'Creación de News', 'Solicitud', 'Contenido', 'Media', 'Medio', 'No'],
  ['COM-05', 'COMERCIAL', 'Peticiones', 'Consulta', 'Soporte', 'Media', 'Medio', 'No'],
  ['COM-06', 'COMERCIAL', 'Empresa / convenio no aparece al registrar venta', 'Incidente', 'Error en Datos', 'Alta', 'Alto', 'No'],
  ['COM-07', 'COMERCIAL', 'Alumno perdió acceso al curso', 'Incidente', 'Accesos', 'Alta', 'Medio', 'No'],
  ['PRO-01', 'PRODUCTO', 'Cronograma', 'Solicitud', 'Base de Datos', 'Alta', 'Alto', 'No'],
  ['PRO-02', 'PRODUCTO', 'Creación de Looker', 'Solicitud', 'Visualización', 'Media', 'Medio', 'No'],
  ['PRO-03', 'PRODUCTO', 'Creación de BD', 'Solicitud', 'Base de Datos', 'Alta', 'Alto', 'No'],
  ['PRO-04', 'PRODUCTO', 'Planeamiento', 'Solicitud', 'Revisión', 'Media', 'Alto', 'No'],
  ['PRO-05', 'PRODUCTO', 'Verificación de ediciones', 'Solicitud', 'Revisión', 'Media', 'Medio', 'No'],
  ['PRO-06', 'PRODUCTO', 'Diseño y UX de Nexus (feedback)', 'Solicitud', 'Revisión', 'Baja', 'Medio', 'No'],
  ['PRO-07', 'PRODUCTO', 'Formulario de cursos (campos y validaciones)', 'Solicitud', 'Configuración', 'Media', 'Medio', 'No'],
  ['FIC-01', 'FICO', 'Revisión de Grupo WE', 'Solicitud', 'Base de Datos', 'Crítica', 'Crítico', 'No'],
  ['FIC-02', 'FICO', 'Revisión de pagos', 'Incidente', 'Error en Datos', 'Crítica', 'Crítico', 'No'],
  ['FIC-03', 'FICO', 'Creación de BD pagos', 'Solicitud', 'Base de Datos', 'Crítica', 'Crítico', 'Si'],
  ['FIC-04', 'FICO', 'Operativos en vivo', 'Solicitud', 'Base de Datos', 'Alta', 'Crítico', 'Si'],
  ['FIC-05', 'FICO', 'Operativos online', 'Solicitud', 'Base de Datos', 'Alta', 'Crítico', 'Si'],
  ['FIC-06', 'FICO', 'Operativos Fundación', 'Solicitud', 'Base de Datos', 'Alta', 'Crítico', 'Si'],
  ['FIC-07', 'FICO', 'Cuentas por cobrar', 'Solicitud', 'Base de Datos', 'Crítica', 'Crítico', 'Si'],
  ['FIC-08', 'FICO', 'Precios de cursos', 'Solicitud', 'Configuración', 'Alta', 'Crítico', 'No'],
  ['FIC-09', 'FICO', 'Ediciones de los cursos', 'Solicitud', 'Configuración', 'Alta', 'Alto', 'No'],
  ['FIC-10', 'FICO', 'Corregir datos de alumno o inscripción', 'Solicitud', 'Error en Datos', 'Media', 'Alto', 'No'],
  ['FIC-11', 'FICO', 'Eliminar inscripción duplicada', 'Solicitud', 'Base de Datos', 'Media', 'Medio', 'No'],
  ['FIC-12', 'FICO', 'Importar alumno al ERP', 'Solicitud', 'Base de Datos', 'Media', 'Medio', 'Si'],
  ['FIC-13', 'FICO', 'Correo de confirmación no enviado / curso no activado', 'Incidente', 'Error en Datos', 'Alta', 'Medio', 'No'],
  ['FIC-14', 'FICO', 'Plantillas de correos automáticos', 'Solicitud', 'Configuración', 'Baja', 'Medio', 'No'],
  ['FIC-15', 'FICO', 'Comisiones de asesores', 'Solicitud', 'Base de Datos', 'Alta', 'Crítico', 'Si'],
  ['FIC-16', 'FICO', 'Error al registrar inscripción / venta', 'Incidente', 'Error en Datos', 'Alta', 'Alto', 'No'],
  ['GER-01', 'GERENCIA', 'Reporte diario y consolidado', 'Solicitud', 'Documentos', 'Alta', 'Alto', 'Si'],
  ['GER-02', 'GERENCIA', 'Reporte de gastos y egresos', 'Solicitud', 'Documentos', 'Media', 'Alto', 'Si'],
  ['GER-03', 'GERENCIA', 'Cuadre de cifras entre ERP y reportes', 'Incidente', 'Revisión', 'Alta', 'Alto', 'No'],
]

// Los tickets que no encajaban en el catálogo viejo, asignados a mano por
// posición en tickets_sla.json (orden por fecha). Si el JSON cambia, se revisa.
const ASIGNACION_MANUAL = {
  0: 'FIC-14', 11: 'GEN-02', 13: 'ACA-13', 15: 'GEN-06', 19: 'FIC-11', 23: 'GEN-06', 25: 'GEN-02',
  28: 'GEN-06', 29: 'GEN-05', 30: 'GEN-06', 31: 'GEN-02', 33: 'GEN-06', 39: 'GEN-04', 41: 'FIC-11',
  42: 'ACA-13', 43: 'GEN-02', 46: 'GEN-06', 47: 'ACA-14', 48: 'ACA-11', 49: 'FIC-10', 51: 'GEN-04',
  53: 'FIC-10', 54: 'FIC-14', 58: 'GEN-06', 59: 'GER-02', 63: 'GER-03', 64: 'GEN-06', 67: 'GEN-04',
  70: 'GER-02', 73: 'FIC-13', 74: 'FIC-13', 87: 'ACA-09', 90: 'GER-03', 91: 'ACA-09', 92: 'GEN-02',
  93: 'GEN-06', 94: 'GEN-07', 95: 'ACA-14', 96: 'FIC-14', 97: 'GEN-07', 98: 'GER-02', 99: 'GEN-01',
  104: 'GEN-01', 106: 'ACA-09', 108: 'ACA-09', 110: 'ACA-09', 111: 'GEN-03', 112: 'GEN-03', 113: 'GEN-07',
  114: 'ACA-12', 115: 'ACA-10', 119: 'COM-06', 126: 'FIC-16', 130: 'FIC-14', 131: 'ACA-10', 133: 'FIC-13',
  134: 'FIC-12', 136: 'B2B-09', 142: 'FIC-14', 145: 'FIC-10', 146: 'COM-06', 147: 'ACA-10', 151: 'B2B-09',
  153: 'GEN-04', 155: 'FIC-12', 157: 'FIC-12', 164: 'ACA-12', 168: 'GEN-06', 170: 'GEN-07', 173: 'ACA-13',
  175: 'GEN-06', 182: 'ACA-06', 183: 'GEN-06', 188: 'GEN-08', 189: 'FIC-10', 190: 'PRO-03', 192: 'GEN-02',
  193: 'GEN-04', 195: 'GEN-05', 196: 'FIC-13', 197: 'GEN-06', 198: 'GEN-07', 202: 'FIC-10', 203: 'GEN-07',
  205: 'GEN-04', 206: 'FIC-16', 207: 'FIC-11', 210: 'GEN-06', 211: 'ACA-09', 213: 'FIC-15', 217: 'GER-03',
  219: 'FIC-10', 222: 'GEN-06', 228: 'GEN-08', 231: 'GER-03', 233: 'FIC-10', 234: 'GEN-08', 235: 'FIC-13',
  237: 'GEN-04', 238: 'GER-01', 243: 'GEN-05', 244: 'FIC-11', 245: 'FIC-12', 248: 'GEN-06', 251: 'GEN-05',
  252: 'FIC-15', 253: 'GEN-04', 254: 'GEN-04', 257: 'GEN-02', 264: 'GER-02', 265: 'GEN-06', 266: 'FIC-10',
  267: 'GEN-07', 269: 'GER-02', 270: 'PRO-06', 275: 'GEN-06', 276: 'GEN-02', 277: 'FIC-16', 282: 'GEN-02',
  283: 'GEN-08', 284: 'FIC-10', 286: 'GEN-05', 290: 'GER-03', 292: 'GEN-06', 293: 'FIC-15', 296: 'GER-03',
  303: 'COM-07', 307: 'GEN-06', 309: 'GEN-05', 313: 'FIC-15', 314: 'ACA-12', 315: 'PRO-07', 316: 'PRO-07',
  323: 'GEN-05', 325: 'PRO-06', 327: 'PRO-06', 329: 'GER-03',
}

const PREFIJO_POR_AREA = { FUNDACIÓN: 'FUN', ACADEMICA: 'ACA', B2B: 'B2B', COMERCIAL: 'COM', PRODUCTO: 'PRO', FICO: 'FIC' }

// Los agentes usaron los nombres del catálogo viejo ("Locker", minúsculas).
// "Base de asesoras" y "Configuración de Bot" existen en dos áreas: gana la del solicitante.
function resolveCatalogId(ticket, index) {
  if (ASIGNACION_MANUAL[index]) return ASIGNACION_MANUAL[index]
  const nombre = normalize(ticket.catalogo_match)
  const candidatos = CATALOGO.filter(([, , item]) => normalize(item).startsWith(nombre))
  const delArea = candidatos.find(([id]) => id.startsWith(PREFIJO_POR_AREA[ticket.area_solicitante]))
  return (delArea ?? candidatos[0])?.[0]
}

function normalize(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace('locker', 'looker').replace('onlines', 'online').trim()
}

function buildTicketRows(tickets) {
  return tickets.map((t, i) => {
    const id = resolveCatalogId(t, i)
    if (!id) throw new Error(`Ticket ${i} sin ítem de catálogo: ${t.resumen}`)
    const r = i + 2
    return [
      t.fecha, t.fuente, t.solicitante, t.area_solicitante, id,
      `=IFERROR(VLOOKUP(E${r},'Catálogo'!$A:$C,3,FALSE),"")`,
      t.tipo, t.categoria, t.resumen, t.urgencia, t.impacto,
      priorityFormula(`J${r}`, `K${r}`),
      t.respuesta_min_habiles ?? '', t.resolucion_min_habiles ?? '',
      `=IF(M${r}="","SIN RESPUESTA",IF(M${r}<=VLOOKUP(L${r},Niveles!$A$12:$E$15,4,FALSE),"SI","NO"))`,
      `=IF(N${r}="","SIN EVIDENCIA",IF(N${r}<=VLOOKUP(L${r},Niveles!$A$12:$E$15,5,FALSE),"SI","NO"))`,
    ]
  })
}

function priorityFormula(celdaUrgencia, celdaImpacto) {
  return `=IFERROR(INDEX(Niveles!$H$12:$K$15,MATCH(${celdaUrgencia},Niveles!$G$12:$G$15,0),MATCH(${celdaImpacto},Niveles!$H$11:$K$11,0)),"")`
}

function buildCatalogRows() {
  return CATALOGO.map(([id, area, item, tipo, categoria, urgencia, impacto, automatizable], i) => {
    const r = i + 2
    return [
      id, area, item, tipo, categoria, urgencia, impacto,
      priorityFormula(`F${r}`, `G${r}`),
      `=IFERROR(VLOOKUP(H${r},Niveles!$A$12:$C$15,2,FALSE),"")`,
      `=IFERROR(VLOOKUP(H${r},Niveles!$A$12:$C$15,3,FALSE),"")`,
      automatizable,
      `=COUNTIF(Tickets!$E:$E,A${r})`,
      `=IFERROR(COUNTIFS(Tickets!$E:$E,A${r},Tickets!$O:$O,"SI")/COUNTIFS(Tickets!$E:$E,A${r},Tickets!$O:$O,"<>SIN RESPUESTA"),"")`,
    ]
  })
}

function buildNivelesValues() {
  return [
    ['NIVELES DE INCIDENCIAS — Sistemas WE'],
    ['Horario hábil: lunes a viernes 09:00–18:00 (Lima). Los SLA corren solo en ese horario.'],
    ['URGENCIA (tiempo crítico)', 'Criterio', '', '', 'IMPACTO (afectación al negocio)', 'Criterio'],
    ...URGENCIAS.map((u, i) => [u[0], u[1], '', '', IMPACTOS[i][0], IMPACTOS[i][1]]),
    [],
    [],
    [],
    ['PRIORIDAD', 'SLA RESPUESTA', 'SLA RESOLUCIÓN', 'Respuesta (min hábiles)', 'Resolución (min hábiles)', '', 'Urgencia \\ Impacto', 'Crítico', 'Alto', 'Medio', 'Bajo'],
    ...PRIORIDADES.map((p, i) => [...p, '', ...MATRIZ[i]]),
    [],
    ['TIPO', 'Cuándo se usa', '', '', 'CATEGORÍA', 'Qué incluye'],
    ...CATEGORIAS.map((c, i) => [TIPOS[i]?.[0] ?? '', TIPOS[i]?.[1] ?? '', '', '', c[0], c[1]]),
  ]
}

// Filas de Niveles que usan las fórmulas: urgencias G12:G15, impactos H11:K11,
// matriz H12:K15, prioridades A12:E15. buildNivelesValues las deja ahí.
const NIVELES_LAYOUT_CHECK = { filaEncabezadoPrioridad: 11 }

function buildResumenValues(ticketCount) {
  const grupos = [
    ['POR TIPO', 'G', TIPOS.map(t => t[0])],
    ['POR PRIORIDAD', 'L', PRIORIDADES.map(p => p[0])],
    ['POR ÁREA SOLICITANTE', 'D', AREAS.filter(a => a !== 'TODAS')],
  ]
  const values = [
    ['RESUMEN SLA — Tickets de Slack 15/08/2026 al 14/09/2026'],
    [`Total tickets: ${ticketCount}`, '', '', 'Cumple respuesta global', `=COUNTIF(Tickets!O:O,"SI")/(COUNTA(Tickets!A:A)-1-COUNTIF(Tickets!O:O,"SIN RESPUESTA"))`],
  ]
  for (const [titulo, col, claves] of grupos) {
    values.push([], [titulo, 'Tickets', 'Sin respuesta', 'Mediana 1ª respuesta (min)', 'Cumple respuesta', 'Cumple resolución'])
    for (const clave of claves) {
      const r = values.length + 1
      const rango = `Tickets!$${col}:$${col}`
      values.push([
        clave,
        `=COUNTIF(${rango},A${r})`,
        `=COUNTIFS(${rango},A${r},Tickets!$O:$O,"SIN RESPUESTA")`,
        `=IFERROR(MEDIAN(FILTER(Tickets!$M:$M,${rango}=A${r},Tickets!$M:$M<>"")),"")`,
        `=IFERROR(COUNTIFS(${rango},A${r},Tickets!$O:$O,"SI")/(B${r}-C${r}),"")`,
        `=IFERROR(COUNTIFS(${rango},A${r},Tickets!$P:$P,"SI")/COUNTIFS(${rango},A${r},Tickets!$P:$P,"<>SIN EVIDENCIA"),"")`,
      ])
    }
  }
  return values
}

async function sheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), 'credentials/service.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth: await auth.getClient() })
}

// Deja exactamente las 4 pestañas; la primera hoja vacía del libro nuevo pasa a ser Niveles.
async function ensureTabs(sheets) {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId })
  const existentes = data.sheets.map(s => s.properties)
  const deseadas = ['Niveles', 'Catálogo', 'Tickets', 'Resumen']
  const requests = []
  if (!existentes.some(s => s.title === 'Niveles')) {
    requests.push({ updateSheetProperties: { properties: { sheetId: existentes[0].sheetId, title: 'Niveles' }, fields: 'title' } })
  }
  for (const title of deseadas.slice(1)) {
    if (!existentes.some(s => s.title === title)) requests.push({ addSheet: { properties: { title } } })
  }
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } })
  const { data: after } = await sheets.spreadsheets.get({ spreadsheetId })
  return Object.fromEntries(after.sheets.map(s => [s.properties.title, s.properties.sheetId]))
}

async function writeValues(sheets, tabs) {
  const tickets = JSON.parse(readFileSync(ticketsPath, 'utf8'))
  const data = [
    { range: 'Niveles!A1', values: buildNivelesValues() },
    { range: "'Catálogo'!A1", values: [['ID', 'ÁREA', 'INCIDENCIA / SOLICITUD', 'TIPO', 'CATEGORÍA', 'URGENCIA', 'IMPACTO', 'PRIORIDAD (calculada)', 'SLA RESPUESTA', 'SLA RESOLUCIÓN', 'AUTOMATIZABLE', 'TICKETS 30D', 'CUMPLE RESPUESTA'], ...buildCatalogRows()] },
    { range: 'Tickets!A1', values: [['FECHA', 'FUENTE', 'SOLICITANTE', 'ÁREA', 'ID CATÁLOGO', 'ÍTEM CATÁLOGO', 'TIPO', 'CATEGORÍA', 'RESUMEN', 'URGENCIA', 'IMPACTO', 'PRIORIDAD', 'MIN RESPUESTA (hábiles)', 'MIN RESOLUCIÓN (hábiles)', 'CUMPLE RESPUESTA', 'CUMPLE RESOLUCIÓN'], ...buildTicketRows(tickets)] },
    { range: 'Resumen!A1', values: buildResumenValues(tickets.length) },
  ]
  for (const tab of Object.keys(tabs)) {
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${tab}'` })
  }
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'USER_ENTERED', data } })
  return tickets.length
}

function headerFormat(sheetId, row, endCol) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: endCol },
      cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, foregroundColor: WHITE }, wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy,verticalAlignment)',
    },
  }
}

function listValidation(sheetId, col, rows, valores) {
  return {
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, endRowIndex: rows + 1, startColumnIndex: col, endColumnIndex: col + 1 },
      rule: { condition: { type: 'ONE_OF_LIST', values: valores.map(v => ({ userEnteredValue: v })) }, strict: true, showCustomUi: true },
    },
  }
}

function colorWhen(sheetId, col, texto, color) {
  return {
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 }],
        booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: texto }] }, format: { backgroundColor: color } },
      },
    },
  }
}

function percentFormat(sheetId, col, startRow = 1) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: startRow, startColumnIndex: col, endColumnIndex: col + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0%' } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  }
}

async function applyFormat(sheets, tabs, ticketCount) {
  const verde = { red: 0.85, green: 0.93, blue: 0.83 }
  const rojo = { red: 0.96, green: 0.8, blue: 0.8 }
  const ambar = { red: 1, green: 0.95, blue: 0.8 }
  const niv = tabs.Niveles
  const cat = tabs['Catálogo']
  const tic = tabs.Tickets
  const res = tabs.Resumen
  const nombres = (lista) => lista.map(x => x[0])
  const filasCatalogo = CATALOGO.length

  const requests = [
    { updateSheetProperties: { properties: { sheetId: cat, gridProperties: { frozenRowCount: 1, frozenColumnCount: 3 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
    { updateSheetProperties: { properties: { sheetId: tic, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    { repeatCell: { range: { sheetId: niv, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } }, fields: 'userEnteredFormat.textFormat' } },
    { repeatCell: { range: { sheetId: res, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } }, fields: 'userEnteredFormat.textFormat' } },
    headerFormat(niv, 2, 6), headerFormat(niv, 10, 11), headerFormat(niv, 16, 6),
    headerFormat(cat, 0, 13), headerFormat(tic, 0, 16),
    listValidation(cat, 1, filasCatalogo + 50, AREAS),
    listValidation(cat, 3, filasCatalogo + 50, nombres(TIPOS)),
    listValidation(cat, 4, filasCatalogo + 50, nombres(CATEGORIAS)),
    listValidation(cat, 5, filasCatalogo + 50, nombres(URGENCIAS)),
    listValidation(cat, 6, filasCatalogo + 50, nombres(IMPACTOS)),
    listValidation(cat, 10, filasCatalogo + 50, ['Si', 'No']),
    listValidation(tic, 9, ticketCount + 500, nombres(URGENCIAS)),
    listValidation(tic, 10, ticketCount + 500, nombres(IMPACTOS)),
    listValidation(tic, 6, ticketCount + 500, nombres(TIPOS)),
    {
      setDataValidation: {
        range: { sheetId: tic, startRowIndex: 1, endRowIndex: ticketCount + 501, startColumnIndex: 4, endColumnIndex: 5 },
        rule: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: "='Catálogo'!$A$2:$A" }] }, strict: false, showCustomUi: true },
      },
    },
    colorWhen(tic, 14, 'SI', verde), colorWhen(tic, 14, 'NO', rojo), colorWhen(tic, 14, 'SIN RESPUESTA', ambar),
    colorWhen(tic, 15, 'SI', verde), colorWhen(tic, 15, 'NO', rojo),
    colorWhen(cat, 7, 'P1', rojo), colorWhen(tic, 11, 'P1', rojo),
    percentFormat(cat, 12), percentFormat(res, 4), percentFormat(res, 5),
    { setBasicFilter: { filter: { range: { sheetId: tic, startRowIndex: 0, endRowIndex: ticketCount + 1, startColumnIndex: 0, endColumnIndex: 16 } } } },
    { setBasicFilter: { filter: { range: { sheetId: cat, startRowIndex: 0, endRowIndex: filasCatalogo + 1, startColumnIndex: 0, endColumnIndex: 13 } } } },
    ...[[niv, 0, 11], [cat, 0, 13], [tic, 0, 16], [res, 0, 6]].map(([sheetId, start, end]) => ({ autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: start, endIndex: end } } })),
    { updateDimensionProperties: { range: { sheetId: tic, dimension: 'COLUMNS', startIndex: 8, endIndex: 9 }, properties: { pixelSize: 420 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: niv, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 380 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: niv, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 }, properties: { pixelSize: 380 }, fields: 'pixelSize' } },
  ]
  // Resumen: encabezado navy en cada bloque (fila con "Tickets" en la columna B).
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Resumen!A:B' })
  data.values.forEach((fila, i) => { if (fila[1] === 'Tickets') requests.push(headerFormat(res, i, 6)) })

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } })
}

// Una fórmula mal parseada (separador de argumentos por locale) no lanza error
// en la API: queda #ERROR! en la celda. Por eso se verifica leyendo los valores.
async function assertNoFormulaErrors(sheets) {
  const { data } = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ["'Catálogo'!H:M", 'Tickets!F:P', 'Resumen!A:F'] })
  const errores = data.valueRanges.flatMap(vr => (vr.values ?? []).flat().filter(v => /^#(ERROR|NAME|REF|VALUE|N\/A)/.test(String(v))))
  if (errores.length) throw new Error(`${errores.length} celdas con error de fórmula, ej: ${errores.slice(0, 3).join(', ')}`)
}

const sheets = await sheetsClient()
const tabs = await ensureTabs(sheets)
if (buildNivelesValues()[NIVELES_LAYOUT_CHECK.filaEncabezadoPrioridad - 1][0] !== 'PRIORIDAD') {
  throw new Error('Niveles cambió de forma: las fórmulas apuntan a A12:E15 / G11:K15')
}
const ticketCount = await writeValues(sheets, tabs)
await applyFormat(sheets, tabs, ticketCount)
await assertNoFormulaErrors(sheets)
console.log(`OK: ${CATALOGO.length} ítems de catálogo, ${ticketCount} tickets → https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`)
