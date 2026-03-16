// src/services/dashboard.service.js
import { pool } from '../config/db.js'
async function dashboardList(payload = {}) {
  const {
    year     = 2026,
    modality = 'NO_ONLINE',
    // Nuevos: fecha de inicio y fin de la semana seleccionada
    date_start = null,   // '2026-03-16'
    date_end   = null,   // '2026-03-22'
    // Compatibilidad: si todavía vienen month+period los usamos
    month  = null,
    period = null,
  } = payload

  const params = [year, modality]
  let sql = `
    SELECT * FROM public.v_dashboard_comercial
    WHERE year_period = $1
      AND modality    = $2
  `

  if (date_start && date_end) {
    sql += ` AND fecha_inicio >= $3 AND fecha_fin <= $4`
    params.push(date_start, date_end)
  } else {
    // Fallback al filtro clásico
    if (month)  { sql += ` AND month_period = $${params.length + 1}`; params.push(month) }
    if (period && period !== 'ALL') { 
      sql += ` AND period_label = $${params.length + 1}`
      params.push(period)
    }
  }

  sql += ` ORDER BY asesor ASC`

  const { rows } = await pool.query(sql, params)

  const items = rows.map(r => ({
    target_id:       r.target_id,
    asesor:          r.asesor,
    cod_asesor:      r.cod_asesor,
    alias_asesor:    r.alias_asesor,
    year:            r.year_period,
    month:           r.month_period,
    week:            r.period_label,
    modality:        r.modality,
    fecha_inicio:    r.fecha_inicio,
    fecha_fin:       r.fecha_fin,
    objetivo:        Number(r.objetivo      || 0),
    logrado:         Number(r.logrado       || 0),
    falta:           Number(r.falta         || 0),
    meta_monto:      Number(r.meta_monto    || 0),
    logrado_monto:   Number(r.logrado_monto || 0),
    ticket_prom:     Number(r.ticket_prom   || 0),
    consultas:       Number(r.consultas     || 0),
  chart_tendencia_horaria:   typeof r.chart_tendencia_horaria   === 'string' ? JSON.parse(r.chart_tendencia_horaria)   : (r.chart_tendencia_horaria   || []),
  chart_curva_persistencia:  typeof r.chart_curva_persistencia  === 'string' ? JSON.parse(r.chart_curva_persistencia)  : (r.chart_curva_persistencia  || []),
  
  chart_curva_persistencia_mensual: typeof r.chart_curva_persistencia_mensual === 'string'
    ? JSON.parse(r.chart_curva_persistencia_mensual)
    : (r.chart_curva_persistencia_mensual || []),

  chart_objeciones:   typeof r.chart_objeciones   === 'string' ? JSON.parse(r.chart_objeciones)   : (r.chart_objeciones   || []),
  json_pending_tasks: typeof r.json_pending_tasks  === 'string' ? JSON.parse(r.json_pending_tasks)  : (r.json_pending_tasks  || []),
    high_interest_count: Number(r.high_interest_count || 0),
    follow_up_pending: Number(r.follow_up_pending || 0),

    
    // --- CAMBIOS AQUÍ: Mapeamos lo nuevo de la vista ---
    // Ya no dependemos solo de porcentajes, traemos el dato crudo
    leads_activos:   Number(r.leads_activos || 0),  // Viene de la vista
    venta_cohorte:   Number(r.venta_cohorte || 0),  // Viene de la vista
    
    conversion:      Number(r.conversion    || 0),
    ratio:           Number(r.ratio         || 0),
    desglose_diario: r.desglose_diario || []
  }))

  return { total: items.length, items }
}

// En tu dashboardService
async function getAvailableWeeks(payload = {}) {
  const { year = 2026, modality = 'NO_ONLINE' } = payload
  const sql = `
  SELECT
    period_label,
    month_period,
    MIN(date_start)::date AS date_start,
    MAX(date_end)::date   AS date_end
  FROM sales_targets
  WHERE year_period = $1
    AND active      = 'Y'
    AND modality    = $2
  GROUP BY period_label, month_period
  ORDER BY MIN(date_start) ASC
`
  const { rows } = await pool.query(sql, [year, modality])
  const MONTHS_ES = { '01':'Ene','02':'Feb','03':'Mar','04':'Abr','05':'May','06':'Jun','07':'Jul','08':'Ago','09':'Sep','10':'Oct','11':'Nov','12':'Dic' }
  
  return rows.map((r, idx) => {
    const start  = new Date(r.date_start)
    const end    = new Date(r.date_end)
    const dStart = start.getUTCDate()
    const dEnd   = end.getUTCDate()
    const mStart = MONTHS_ES[String(start.getUTCMonth() + 1).padStart(2,'0')]
    const mEnd   = MONTHS_ES[String(end.getUTCMonth() + 1).padStart(2,'0')]
    const rango  = mStart !== mEnd
      ? `${dStart} ${mStart} al ${dEnd} ${mEnd}`
      : `${dStart} al ${dEnd} ${mEnd}`

    return {
      value:      r.period_label,
      month:      r.month_period,
      label:      `SEM ${idx + 1} · ${rango}`,
      date_start: r.date_start,
      date_end:   r.date_end,
    }
  })
}
/**
 * (OPCIONAL) METAS REGISTER
 * Si necesitas crear las metas desde el sistema en lugar de SQL directo
 */
async function dashboardTargetRegister({ target = {} }) {
    // Aquí sí podrías usar un SP si decides crear uno para insertar
    // Por ahora, un insert simple para el ejemplo:
    const sql = `
      INSERT INTO public.sales_targets 
      (seller_agent_id, year_period, month_period, period_label, date_start, date_end, target_vacancies, target_revenue)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING target_id
    `
    const values = [
      target.seller_agent_id,
      target.year,
      target.month,
      target.period, // 'S1'
      target.date_start,
      target.date_end,
      target.target_vacancies,
      target.target_revenue
    ]

    const { rows } = await pool.query(sql, values)
    return { target_id: rows[0]?.target_id }
}


async function programGoalsList(payload = {}) {
  const {
    year = 2026,
    month_num = 1 // Esperamos el número del mes (1 = Enero) para ser precisos
  } = payload

  // Consulta a la nueva vista
  const sql = `
    SELECT * FROM public.v_dashboard_program_goals 
    WHERE anio = $1 
      AND mes_num = $2
    ORDER BY fecha_inicio ASC
  `
  
  const { rows } = await pool.query(sql, [year, month_num])

  // Mapeo de respuesta para el Frontend
  const items = rows.map(r => ({
    edition_id:       r.edition_num_id,
    
    // Información del Programa
    categoria:        r.categoria,
    linea:            r.linea,
    programa:         r.programa,
    tipo:             r.tipo,       // A, B, C
    inicio:           r.fecha_inicio, // 2026-01-22
    codigo:           r.codigo_edicion,
    
    // Metas (Editables)
    meta_monto:       Number(r.meta_monto || 0),
    meta_vacantes:    Number(r.meta_vacantes || 0),
    
    // Logros (Reales)
    venta_monto:      Number(r.venta_monto || 0),
    venta_cantidad:   Number(r.venta_cantidad || 0),
    
    // Porcentajes
    logro_monto_pct:    Number(r.porcentaje_logro_monto || 0),
    logro_vacantes_pct: Number(r.porcentaje_logro_vacantes || 0),

    // Desgloses JSON (Listos para pintar en el front)
    breakdown_asesores: r.breakdown_asesores || [], // [{name: 'Grecia', count: 5, ...}]
    breakdown_origen:   r.breakdown_origen   || [], // [{name: 'Facebook', count: 4}]
    breakdown_clientes: r.breakdown_clientes || [], // [{name: 'Nuevo', count: 2}]
    breakdown_estados:  r.breakdown_estado_comercial || [] // Embudo completo
  }))

  return { total: items.length, items }
}
async function liderList(payload = {}) {
  const { year = 2026, month = 1, advisor = 'all' } = payload

  let sql = `SELECT * FROM public.v_dashboard_lider WHERE anio = $1`
  const params = [year]

  if (month && month !== 0 && month !== '0') {
    params.push(month)
    sql += ` AND mes_num = $${params.length}`
  }

  if (advisor && advisor !== 'all') {
    params.push(advisor)
    sql += ` AND cod_asesor = $${params.length}`
  }

  sql += ` ORDER BY total_sin_atencion DESC`

  const { rows } = await pool.query(sql, params)

  const items = rows.map(r => ({
    anio:               r.anio,
    mes_num:            r.mes_num,
    mes_nombre:         r.mes_nombre,
    cod_asesor:         r.cod_asesor,
    asesor_nombre:      r.asesor_nombre,
    asesor_alias:       r.asesor_alias,
    total_leads:        Number(r.total_leads        || 0),
    total_intentos:     Number(r.total_intentos     || 0),
    total_atendidas:    Number(r.total_atendidas    || 0),
    total_sin_atencion: Number(r.total_sin_atencion || 0),
    total_pendientes:   Number(r.total_pendientes   || 0),
    pct_atendidas:      Number(r.pct_atendidas      || 0),
    pct_sin_atencion:   Number(r.pct_sin_atencion   || 0),
    pct_pendientes:     Number(r.pct_pendientes     || 0),
    json_origin_stats:     typeof r.json_origin_stats     === 'string' ? JSON.parse(r.json_origin_stats)     : (r.json_origin_stats     || []),
    json_reschedule_stats: typeof r.json_reschedule_stats === 'string' ? JSON.parse(r.json_reschedule_stats) : (r.json_reschedule_stats || []),
    json_pending_tasks:    typeof r.json_pending_tasks    === 'string' ? JSON.parse(r.json_pending_tasks)    : (r.json_pending_tasks    || [])
  }))

  return { total: items.length, items }
}
async function contactabilityList(payload = {}) {
  const { year = 2026, month = 1, advisor = 'all' } = payload

  let sql = `SELECT * FROM public.v_dashboard_contactability WHERE anio = $1`
  const params = [year]

  if (month && month !== 0 && month !== '0') {
    params.push(month)
    sql += ` AND mes_num = $${params.length}`
  }

  if (advisor && advisor !== 'all') {
    params.push(advisor)
    sql += ` AND cod_asesor = $${params.length}`
  }

  sql += ` ORDER BY tasa_conversion DESC`

  const { rows } = await pool.query(sql, params)

  const items = rows.map(r => ({
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
    
    // Parseamos JSONb
    chart_tendencia_horaria: typeof r.chart_tendencia_horaria === 'string' ? JSON.parse(r.chart_tendencia_horaria) : (r.chart_tendencia_horaria || []),
    chart_curva_persistencia: typeof r.chart_curva_persistencia === 'string' ? JSON.parse(r.chart_curva_persistencia) : (r.chart_curva_persistencia || []),
    chart_objeciones: typeof r.chart_objeciones === 'string' ? JSON.parse(r.chart_objeciones) : (r.chart_objeciones || []),
    
    // 🔴 AÑADIR ESTA LÍNEA (El eslabón perdido)
    json_pending_tasks: typeof r.json_pending_tasks === 'string' ? JSON.parse(r.json_pending_tasks) : (r.json_pending_tasks || [])
  }))

  return { total: items.length, items }
}

async function ventasCanalList(payload = {}) {
  const { year = 2026, month_num = 1, advisor = 'all' } = payload;

  let sql = `
    SELECT * FROM public.v_dashboard_ventas_canal
    WHERE anio = $1
      AND mes_num = $2
  `;
  const params = [year, month_num];

  if (advisor && advisor !== 'all') {
    params.push(advisor);
    sql += ` AND cod_asesor = $${params.length}`;
  }

  // 1. CORRECCIÓN: Quitamos tipo_cliente del ORDER BY porque no existe en la vista final
  sql += ` ORDER BY semana_mes ASC`;

  const { rows } = await pool.query(sql, params);

  const CANAL_DEFAULTS = {
    lk: {c:0,v:0}, ig: {c:0,v:0}, fb: {c:0,v:0}, other: {c:0,v:0},
    web:{c:0,v:0}, bot:{c:0,v:0}, cot:{c:0,v:0}, com:  {c:0,v:0}
  };
  const TIPOS = ['NEW', 'LDS', 'CWE', 'MEMBERS'];

  const semanasMap = {};

  rows.forEach(r => {
    const key = r.semana_mes;
    if (!semanasMap[key]) {
      semanasMap[key] = {
        title:       r.semana_label,
        fecha_desde: r.fecha_desde,
        fecha_hasta: r.fecha_hasta,
        rowsMap:     {} 
      };
      
      // Inicializamos la estructura limpia para evitar referencias cruzadas
      TIPOS.forEach(t => {
        semanasMap[key].rowsMap[t] = {
          type: t,
          channels: JSON.parse(JSON.stringify(CANAL_DEFAULTS)) // Clon profundo seguro
        };
      });
    }

    const rowsData = Array.isArray(r.rows_data) ? r.rows_data : [];

    rowsData.forEach(rd => {
      const tipo = rd.type;
      
      // 2. CORRECCIÓN: Usamos += para sumar los datos de múltiples asesores
      Object.entries(rd.channels || {}).forEach(([ch, val]) => {
        if (semanasMap[key].rowsMap[tipo].channels[ch]) {
          semanasMap[key].rowsMap[tipo].channels[ch].c += Number(val.c || 0);
          semanasMap[key].rowsMap[tipo].channels[ch].v += Number(val.v || 0);
        }
      });
    });
  });

  const weeklyData = Object.values(semanasMap).map(sem => ({
    title: sem.title,
    rows:  TIPOS.map(tipo => sem.rowsMap[tipo])
  }));

  return { total: weeklyData.length, weeklyData };
}

// No olvides exportarla:
export default {
  dashboardList,
  dashboardTargetRegister,
  programGoalsList,
  contactabilityList,
  liderList ,
  ventasCanalList  
}
