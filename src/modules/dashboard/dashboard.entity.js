import { AREA_OF_LEADER, areaLabelOf } from '../../shared/organigrama.js'

// Reglas puras del dominio dashboard. Sin BD, Odoo ni Slack.
// Transformaciones de filas crudas de las vistas a DTO de salida. Todo determinista a partir de su entrada.

// Mapa numero de mes (string '01'..'12') a abreviatura en espanol.
export const MONTHS_ES = {
  '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr',
  '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Ago',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic'
}

// Parsea un campo JSONB que puede llegar como string o como valor ya hidratado.
export function parseJsonbField (val) {
  return typeof val === 'string' ? JSON.parse(val) : (val || [])
}

// Fila de v_dashboard_comercial a DTO comercial.
export function mapDashboardRow (r) {
  return {
    target_id: r.target_id,
    asesor: r.asesor,
    cod_asesor: r.cod_asesor,
    alias_asesor: r.alias_asesor,
    year: r.year_period,
    month: r.month_period,
    week: r.period_label,
    modality: r.modality,
    fecha_inicio: r.fecha_inicio,
    fecha_fin: r.fecha_fin,
    objetivo: Number(r.objetivo || 0),
    logrado: Number(r.logrado || 0),
    falta: Number(r.falta || 0),
    meta_monto: Number(r.meta_monto || 0),
    logrado_monto: Number(r.logrado_monto || 0),
    ticket_prom: Number(r.ticket_prom || 0),
    consultas: Number(r.consultas || 0),
    chart_tendencia_horaria: parseJsonbField(r.chart_tendencia_horaria),
    chart_curva_persistencia: parseJsonbField(r.chart_curva_persistencia),
    chart_curva_persistencia_mensual: parseJsonbField(r.chart_curva_persistencia_mensual),
    chart_objeciones: parseJsonbField(r.chart_objeciones),
    json_pending_tasks: parseJsonbField(r.json_pending_tasks),
    high_interest_count: Number(r.high_interest_count || 0),
    follow_up_pending: Number(r.follow_up_pending || 0),
    leads_activos: Number(r.leads_activos || 0),
    venta_cohorte: Number(r.venta_cohorte || 0),
    conversion: Number(r.conversion || 0),
    ratio: Number(r.ratio || 0),
    desglose_diario: r.desglose_diario || [],
    ventas_por_programa: r.ventas_por_programa || []
  }
}

// Fila de v_dashboard_program_goals a DTO de metas por programa.
export function mapProgramGoalRow (r) {
  return {
    edition_id: r.edition_num_id,
    categoria: r.categoria,
    linea: r.linea,
    programa: r.programa,
    // La abreviatura es el nombre con el que Planeamiento escribe sus hojas y el
    // que cruza contra el Plan 2027; program_name es el largo de catalogo.
    programa_abrev: r.programa_abrev || r.programa,
    tipo: r.tipo,
    inicio: r.fecha_inicio,
    codigo: r.codigo_edicion,
    meta_monto: Number(r.meta_monto || 0),
    meta_vacantes: Number(r.meta_vacantes || 0),
    meta_consultas: Number(r.meta_consultas || 0),
    // Reparto del objetivo por canal, con los nombres del embudo de Gerencia:
    // { MARKETING: { ventas, consultas }, ... }. Ventas se reparte en los cuatro
    // canales y consultas en tres: la consulta WEB no existe como canal propio.
    metas_canal: parseJsonbObject(r.metas_canal),
    // 'PLAN' = el objetivo lo puso el Plan 2027; 'GERENCIA' = lo ajusto una
    // persona y ya no se recarga desde el plan; null = la edicion no tiene
    // objetivo cargado (el plan no la alcanza), que no es tenerlo en cero.
    origen_meta: r.origen_meta || null,
    venta_monto: Number(r.venta_monto || 0),
    venta_cantidad: Number(r.venta_cantidad || 0),
    // Consultas que de verdad entraron, contra las que el objetivo pide.
    consultas_reales: Number(r.consultas_reales || 0),
    // Quien dejo el objetivo como esta. Solo interesa cuando origen_meta es
    // 'GERENCIA': si lo puso el parametro, el autor es el sistema.
    editado_por: r.editado_por || null,
    editado_en: r.editado_en || null,
    logro_monto_pct: Number(r.porcentaje_logro_monto || 0),
    logro_vacantes_pct: Number(r.porcentaje_logro_vacantes || 0),
    breakdown_asesores: r.breakdown_asesores || [],
    breakdown_origen: r.breakdown_origen || [],
    breakdown_clientes: r.breakdown_clientes || [],
    breakdown_estados: r.breakdown_estado_comercial || []
  }
}

// Los 4 grupos y 3 momentos del embudo. El orden es el del reporte, no alfabetico.
export const FUNNEL_GROUPS = ['MARKETING', 'WEB', 'COMERCIAL', 'OTROS']
export const FUNNEL_MOMENTS = ['NUEVO', 'LEAD', 'COMUNIDAD']

// Fila de v_gerencia_funnel a DTO del reporte de Gerencia. Aplana `canales` y
// `metas_canal` (dos jsonb con la misma clave GRUPO_MOMENTO) en una sola lista,
// para que el front no tenga que cruzarlos celda por celda.
export function mapGerenciaFunnelRow (r) {
  const reales = parseJsonbObject(r.canales)
  const metas = parseJsonbObject(r.metas_canal)

  const canales = []
  for (const grupo of FUNNEL_GROUPS) {
    for (const momento of FUNNEL_MOMENTS) {
      const key = `${grupo}_${momento}`
      const real = reales[key] || {}
      const meta = metas[key] || {}
      const consultas = Number(real.consultas || 0)
      const ventas = Number(real.ventas || 0)
      const metaConsultas = Number(meta.consultas || 0)
      const metaVentas = Number(meta.ventas || 0)
      // Una celda sin meta ni movimiento no aporta: no la mandamos.
      if (!consultas && !ventas && !metaConsultas && !metaVentas) continue
      canales.push({ key, grupo, momento, consultas, ventas, meta_consultas: metaConsultas, meta_ventas: metaVentas })
    }
  }

  const consultas = Number(r.consultas || 0)
  const ventas = Number(r.ventas || 0)

  return {
    edition_id: r.edition_num_id,
    categoria: r.categoria,
    linea: r.linea,
    programa: r.programa,
    tipo: r.tipo,
    inicio: r.fecha_inicio,
    codigo: r.codigo_edicion,
    meta_consultas: Number(r.meta_consultas || 0),
    meta_ventas: Number(r.meta_ventas || 0),
    meta_monto: Number(r.meta_monto || 0),
    consultas,
    ventas,
    venta_monto: Number(r.venta_monto || 0),
    // Ventas con lead detras. `ventas - ventas_trazadas` = venta sin canal conocido.
    ventas_trazadas: Number(r.ventas_trazadas || 0),
    // La metrica que la hoja nunca calcula, teniendo ambas columnas al lado.
    conversion_pct: consultas > 0 ? Math.round((ventas / consultas) * 1000) / 10 : null,
    canales
  }
}

// Igual que parseJsonbField pero el vacio es objeto, no array.
function parseJsonbObject (val) {
  return typeof val === 'string' ? JSON.parse(val) : (val || {})
}

// ── Panel de equipo (líder) y panel propio (colaborador) ──────────────────
//
// A quién ve quien consulta el panel. Tres alcances y una sola consulta detrás:
//
//   ADMIN        → toda la empresa      (areaRoles null, userId null)
//   LIDER_<AREA> → su área              (areaRoles [...], userId null)
//   cualquiera   → él mismo             (areaRoles null, userId <id>)
//
// El organigrama se importa de la Auditoría en vez de copiarse: es la misma
// pregunta ("¿de quién soy responsable?") y una segunda copia se desincroniza
// el día que alguien mueva un área.
//
// A diferencia de auditableRolesFor, esto NO lanza 403: un colaborador sin rol
// de liderazgo tiene panel, solo que el equipo es de una persona.
//
// viewAs ('LIDER_FICO', ...) solo lo respeta el ADMIN: no tiene área propia y
// usa el selector del dashboard para ver exactamente lo que ve cada líder. A
// cualquier otro rol se le ignora, así nadie amplía su alcance desde el payload.
//
// leaderKey dice de qué área se piden los indicadores de resultado. Un líder de
// dos áreas ve la actividad de ambas, pero los resultados de la primera: son
// paneles distintos (ventas vs cobranza) y mezclarlos no respondería a ninguno.
export function teamScopeFor ({ roles = [], userId = null, viewAs = null } = {}) {
  if (roles.includes('ADMIN')) {
    // hasOwn y no AREA_OF_LEADER[viewAs] a secas: 'toString' existe en el prototipo.
    return Object.hasOwn(AREA_OF_LEADER, viewAs ?? '')
      ? leaderScope([...AREA_OF_LEADER[viewAs]], viewAs)
      : { areaRoles: null, userId: null, area: 'Todas las áreas', isLeader: true, leaderKey: null }
  }

  const leaderKeys = roles.filter(role => Object.hasOwn(AREA_OF_LEADER, role))
  if (leaderKeys.length) {
    const areaRoles = [...new Set(leaderKeys.flatMap(role => AREA_OF_LEADER[role]))]
    return leaderScope(areaRoles, leaderKeys[0])
  }

  return { areaRoles: null, userId, area: 'Mi actividad', isLeader: false, leaderKey: null }
}

function leaderScope (areaRoles, leaderKey) {
  return { areaRoles, userId: null, area: areaLabelOf(areaRoles, 'Mi área'), isLeader: true, leaderKey }
}


// ── Ventas por canal (Comercial > Marketing - Gestión) ─────────────────────
// Recuperado el 06/10/26 (se habia borrado con Plan Comercial el 25/09/26).
// v_dashboard_ventas_canal trae una fila por asesor y semana del mes (dia/7,
// la 4 absorbe del 22 al fin de mes) con rows_data = [{ type, channels:
// { lk: { c, v } } }]. c = consultas que ENTRARON esa semana; v = ventas
// PAGADAS esa semana (pay_date), sean de consultas de esa semana o anteriores.
export const VENTAS_CANAL_CHANNELS = ['lk', 'ig', 'fb', 'web', 'bot', 'cot', 'com', 'other']
export const VENTAS_CANAL_TYPES = ['NEW', 'LDS', 'CWE', 'MEMBERS']

// La vista mete del dia 22 al fin de mes en la semana 4, pero su fecha_hasta
// corta en el 28: las ventas del 29-31 salian en una semana que decia no
// incluirlas. Se toma el ultimo dia real del mes.
const LAST_WEEK = 4
function weekEnd (week, from, to) {
  if (week !== LAST_WEEK || !from) return to
  const [y, m] = String(from).split('-').map(Number)
  return `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

const emptyChannels = () => Object.fromEntries(VENTAS_CANAL_CHANNELS.map(ch => [ch, { c: 0, v: 0 }]))

// Suma los asesores en una estructura semana → tipo de cliente → canal. advisor
// filtra por cod_asesor; la lista de asesores sale SIEMPRE de todas las filas
// del mes (con el filtro puesto el selector no se vacia).
export function aggregateVentasCanal (rows = [], advisor = null) {
  const advisors = new Map()
  const weeks = new Map()
  for (const r of rows) {
    advisors.set(Number(r.cod_asesor), r.asesor_nombre || r.asesor_alias || `Usuario ${r.cod_asesor}`)
    if (advisor && Number(r.cod_asesor) !== Number(advisor)) continue
    const week = Number(r.semana_mes)
    if (!weeks.has(week)) {
      weeks.set(week, {
        week,
        from: r.fecha_desde,
        to: weekEnd(week, r.fecha_desde, r.fecha_hasta),
        rows: Object.fromEntries(VENTAS_CANAL_TYPES.map(t => [t, emptyChannels()]))
      })
    }
    const destino = weeks.get(week).rows
    for (const rd of Array.isArray(r.rows_data) ? r.rows_data : []) {
      if (!destino[rd.type]) continue
      for (const [ch, val] of Object.entries(rd.channels || {})) {
        if (!destino[rd.type][ch]) continue
        destino[rd.type][ch].c += Number(val?.c || 0)
        destino[rd.type][ch].v += Number(val?.v || 0)
      }
    }
  }
  return {
    advisors: [...advisors].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    weeks: [...weeks.values()].sort((a, b) => a.week - b.week)
  }
}
