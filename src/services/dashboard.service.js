// src/services/dashboard.service.js
import { pool } from '../plugins/db.js'

async function dashboardList(payload = {}) {
  const {
    year = 2026,
    month = 'ENE',
    period = null 
  } = payload

  let sql = `
    SELECT * FROM public.v_dashboard_comercial 
    WHERE year_period = $1 
      AND month_period = $2
  `
  
  const params = [year, month]

  if (period && period !== 'ALL') {
    sql += ` AND period_label = $3`
    params.push(period)
  }

  sql += ` ORDER BY asesor ASC, period_label ASC`

  const { rows } = await pool.query(sql, params)

  const items = rows.map(r => ({
    target_id: r.target_id,
    
    // Info Asesor
    asesor: r.asesor,
    cod_asesor: r.cod_asesor,
    alias_asesor: r.alias_asesor,

    // Periodo
    year: r.year_period,
    month: r.month_period,
    week: r.period_label,
    fecha_inicio: r.fecha_inicio,
    fecha_fin: r.fecha_fin,
    
    // Métricas
    objetivo: Number(r.objetivo || 0),
    logrado: Number(r.logrado || 0),
    falta: Number(r.falta || 0),
    
    // Financiero
    meta_monto: Number(r.meta_monto || 0),
    logrado_monto: Number(r.logrado_monto || 0),
    ticket_prom: Number(r.ticket_prom || 0),

    // Gestión
    consultas: Number(r.consultas || 0),
    conversion: Number(r.conversion || 0),
    
    // === NUEVO CAMPO OBLIGATORIO ===
    ratio: Number(r.ratio || 0), 

    // === JSON ===
    desglose_diario: r.desglose_diario || [] 
  }))

  return { 
    total: items.length, 
    items 
  }
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

export default {
  dashboardList,
  dashboardTargetRegister
}