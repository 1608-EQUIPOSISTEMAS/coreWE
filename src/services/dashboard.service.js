// src/services/dashboard.service.js
import { pool } from '../plugins/db.js'
async function dashboardList(payload = {}) {
  const {
    year = 2026,
    month = 'ENE',
    period = null,
    modality = 'NO_ONLINE'
  } = payload

  const params = [year, month, modality] 
  
  // Tu query original está bien, asegurate que la vista ya esté actualizada en DB
  let sql = `
    SELECT * FROM public.v_dashboard_comercial 
    WHERE year_period  = $1 
      AND month_period = $2
      AND modality     = $3
  `

  if (period && period !== 'ALL') {
    sql += ` AND period_label = $4`
    params.push(period)
  }

  sql += ` ORDER BY asesor ASC, period_label ASC`

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

export default {
  dashboardList,
  dashboardTargetRegister,
  programGoalsList
}