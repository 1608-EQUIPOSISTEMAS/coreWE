import { AREA_OF_LEADER } from '../audit/audit.entity.js'

// Reglas puras del dominio dashboard. Sin BD, Odoo ni Slack.
// Transformaciones de filas crudas de las vistas a DTO de salida y armado de
// etiquetas de semana. Todo determinista a partir de su entrada.

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

// Etiqueta de la semana: 'SEM N · DD Mmm al DD Mmm'. El indice es base 0.
export function formatWeekLabel (row, idx) {
  const start = new Date(row.date_start)
  const end = new Date(row.date_end)
  const dStart = start.getUTCDate()
  const dEnd = end.getUTCDate()
  const mStart = MONTHS_ES[String(start.getUTCMonth() + 1).padStart(2, '0')]
  const mEnd = MONTHS_ES[String(end.getUTCMonth() + 1).padStart(2, '0')]
  const rango = mStart !== mEnd
    ? `${dStart} ${mStart} al ${dEnd} ${mEnd}`
    : `${dStart} al ${dEnd} ${mEnd}`

  return {
    value: row.period_label,
    month: row.month_period,
    label: `SEM ${idx + 1} · ${rango}`,
    date_start: row.date_start,
    date_end: row.date_end
  }
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
    tipo: r.tipo,
    inicio: r.fecha_inicio,
    codigo: r.codigo_edicion,
    meta_monto: Number(r.meta_monto || 0),
    meta_vacantes: Number(r.meta_vacantes || 0),
    venta_monto: Number(r.venta_monto || 0),
    venta_cantidad: Number(r.venta_cantidad || 0),
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

// Fila de v_dashboard_lider a DTO de liderazgo.
export function mapLiderRow (r) {
  return {
    anio: r.anio,
    mes_num: r.mes_num,
    mes_nombre: r.mes_nombre,
    cod_asesor: r.cod_asesor,
    asesor_nombre: r.asesor_nombre,
    asesor_alias: r.asesor_alias,
    total_leads: Number(r.total_leads || 0),
    total_intentos: Number(r.total_intentos || 0),
    total_atendidas: Number(r.total_atendidas || 0),
    total_sin_atencion: Number(r.total_sin_atencion || 0),
    total_pendientes: Number(r.total_pendientes || 0),
    pct_atendidas: Number(r.pct_atendidas || 0),
    pct_sin_atencion: Number(r.pct_sin_atencion || 0),
    pct_pendientes: Number(r.pct_pendientes || 0),
    json_origin_stats: parseJsonbField(r.json_origin_stats),
    json_reschedule_stats: parseJsonbField(r.json_reschedule_stats),
    json_pending_tasks: parseJsonbField(r.json_pending_tasks)
  }
}

// Fila de v_dashboard_contactability a DTO de contactabilidad.
export function mapContactabilityRow (r) {
  return {
    anio: r.anio,
    mes_num: r.mes_num,
    mes_nombre: r.mes_nombre,
    cod_asesor: r.cod_asesor,
    asesor_nombre: r.asesor_nombre,
    asesor_alias: r.asesor_alias,
    total_leads_gestionados: Number(r.total_leads_gestionados || 0),
    total_intentos: Number(r.total_intentos || 0),
    total_contactados: Number(r.total_contactados || 0),
    tasa_contactabilidad: Number(r.tasa_contactabilidad || 0),
    total_ventas: Number(r.total_ventas || 0),
    tasa_conversion: Number(r.tasa_conversion || 0),
    ingresos_recuperados: Number(r.ingresos_recuperados || 0),
    tiempo_prom_minutos: Number(r.tiempo_prom_minutos || 0),
    chart_tendencia_horaria: parseJsonbField(r.chart_tendencia_horaria),
    chart_curva_persistencia: parseJsonbField(r.chart_curva_persistencia),
    chart_objeciones: parseJsonbField(r.chart_objeciones),
    json_pending_tasks: parseJsonbField(r.json_pending_tasks)
  }
}

// Estructura inicial de canales por tipo de cliente.
const CANAL_DEFAULTS = {
  lk: { c: 0, v: 0 }, ig: { c: 0, v: 0 }, fb: { c: 0, v: 0 }, other: { c: 0, v: 0 },
  web: { c: 0, v: 0 }, bot: { c: 0, v: 0 }, cot: { c: 0, v: 0 }, com: { c: 0, v: 0 }
}
const TIPOS = ['NEW', 'LDS', 'CWE', 'MEMBERS']

// Agrega filas de v_dashboard_ventas_canal por semana, sumando los canales de
// multiples asesores en una sola estructura semanal.
export function aggregateVentasCanal (rows) {
  const semanasMap = {}

  rows.forEach(r => {
    const key = r.semana_mes
    if (!semanasMap[key]) {
      semanasMap[key] = {
        title: r.semana_label,
        fecha_desde: r.fecha_desde,
        fecha_hasta: r.fecha_hasta,
        rowsMap: {}
      }

      TIPOS.forEach(t => {
        semanasMap[key].rowsMap[t] = {
          type: t,
          channels: structuredClone(CANAL_DEFAULTS)
        }
      })
    }

    const rowsData = Array.isArray(r.rows_data) ? r.rows_data : []

    rowsData.forEach(rd => {
      const tipo = rd.type

      Object.entries(rd.channels || {}).forEach(([ch, val]) => {
        if (semanasMap[key].rowsMap[tipo].channels[ch]) {
          semanasMap[key].rowsMap[tipo].channels[ch].c += Number(val.c || 0)
          semanasMap[key].rowsMap[tipo].channels[ch].v += Number(val.v || 0)
        }
      })
    })
  })

  const weeklyData = Object.values(semanasMap).map(sem => ({
    title: sem.title,
    rows: TIPOS.map(tipo => sem.rowsMap[tipo])
  }))

  return { total: weeklyData.length, weeklyData }
}

// ── Panel de equipo (líder) y panel propio (colaborador) ──────────────────
//
// Etiqueta legible del área a la que pertenece un rol operativo. Solo existe
// para pintar el encabezado; la BD nunca se filtra por esto.
const AREA_LABEL = {
  COMERCIAL: 'Comercial',
  FICO: 'FICO',
  ACADEMICA: 'Académica',
  PRODUCTO: 'Producto',
  FUNDACION: 'Fundación',
  B2B: 'B2B'
}

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
export function teamScopeFor ({ roles = [], userId = null } = {}) {
  if (roles.includes('ADMIN')) {
    return { areaRoles: null, userId: null, area: 'Todas las áreas', isLeader: true }
  }

  const areaRoles = [...new Set(roles.flatMap(role => AREA_OF_LEADER[role] || []))]
  if (areaRoles.length) {
    const label = areaRoles.map(r => AREA_LABEL[r]).find(Boolean) ?? 'Mi área'
    return { areaRoles, userId: null, area: label, isLeader: true }
  }

  return { areaRoles: null, userId, area: 'Mi actividad', isLeader: false }
}
