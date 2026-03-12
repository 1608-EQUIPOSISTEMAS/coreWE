// src/routes/dashboard.js
import dashboardService from '../services/dashboard.service.js'
import { pool } from '../plugins/db.js' // Asegúrate de importar pool si vas a usarlo directo aquí

export default async function dashboardRoutes (fastify) {

fastify.post('/dashboardlist', {
  schema: {
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        year:       { type: ['integer', 'null'], default: 2026 },
        month:      { type: ['string',  'null'], default: 'ENE' },
        period:     { type: ['string',  'null'] },
        modality:   { type: ['string',  'null'], default: 'NO_ONLINE' },
        date_start: { type: ['string',  'null'] },  // ← NUEVO
        date_end:   { type: ['string',  'null'] }   // ← NUEVO
      }
    }
  }
}, async (req, reply) => {
  const data = await dashboardService.dashboardList(req.body)
  return reply.code(200).send({ ok: true, data })
})

  fastify.post('/program-goals', {
    schema: {
      body: {
        type: 'object',
        properties: {
          year: { type: 'integer', default: 2026 },
          month_num: { type: 'integer', default: 1 } // Envía 1 para Enero, 2 Febrero...
        }
      }
    }
  }, async (req, reply) => {
    const data = await dashboardService.programGoalsList(req.body)
    return reply.send({ ok: true, data })
  })

  // 2. REGISTRAR META
  // Ruta final: /api/dashboard/dashboardtargetregister
  fastify.post('/dashboardtargetregister', {
    schema: {
      body: {
        type: 'object',
        required: ['target'],
        additionalProperties: false,
        properties: {
          target: {
            type: 'object',
            required: ['seller_agent_id', 'year', 'month', 'period', 'date_start', 'date_end'],
            additionalProperties: false,
            properties: {
              seller_agent_id:  { type: 'integer' },
              year:             { type: 'integer' },
              month:            { type: 'string' },
              period:           { type: 'string' },
              date_start:       { type: 'string' },
              date_end:         { type: 'string' },
              target_vacancies: { type: ['integer', 'null'], default: 0 },
              target_revenue:   { type: ['number', 'null'],  default: 0 }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const payload = req.body
    const { target_id } = await dashboardService.dashboardTargetRegister(payload)
    return reply.code(201).send({ ok: true, target_id })
  })

  // 3. DETALLE LEADS [CORREGIDO]
  // Quitamos '/dashboard' del string. Ruta final: /api/dashboard/detailleads
  fastify.post('/detailleads', {
    schema: {
      body: {
        type: 'object',
        properties: {
          cod_asesor: { type: ['integer', 'string', 'null'] },
          date: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { cod_asesor, date } = req.body
    
    let sql = `SELECT * FROM public.v_dashboard_detail_leads WHERE fecha_registro = $1`
    const params = [date]

    if (cod_asesor && cod_asesor !== 'ALL') {
        sql += ` AND cod_asesor = $2`
        params.push(cod_asesor)
    }

    sql += ` ORDER BY hora_registro DESC`

    const { rows } = await pool.query(sql, params)
    return reply.send({ ok: true, data: rows })
  })

  // 5. CONTACTABILIDAD
  // Ruta final: /api/dashboard/contactability
  fastify.post('/contactability', {
    schema: {
      body: {
        type: 'object',
        properties: {
          year: { type: 'integer', default: 2026 },
          month: { type: 'integer', default: 1 }, // 0 para traer todos los meses
          advisor: { type: ['string', 'integer'], default: 'all' }
        }
      }
    }
  }, async (req, reply) => {
    const data = await dashboardService.contactabilityList(req.body)
    return reply.send({ ok: true, data })
  })

  fastify.post('/lider', {
  schema: {
    body: {
      type: 'object',
      properties: {
        year:    { type: 'integer', default: 2026 },
        month:   { type: 'integer', default: 1 },   // 0 = todos los meses
        advisor: { type: ['string', 'integer'], default: 'all' }
      }
    }
  }
}, async (req, reply) => {
  const data = await dashboardService.liderList(req.body)
  return reply.send({ ok: true, data })
})
fastify.post('/available-weeks', {
  schema: {
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        year:     { type: ['integer', 'null'], default: 2026 },
        modality: { type: ['string', 'null'],  default: 'NO_ONLINE' }
      }
    }
  }
}, async (req, reply) => {
  const { year = 2026, modality = 'NO_ONLINE' } = req.body

  // Sin DISTINCT — GROUP BY ya lo resuelve
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

  const MONTHS_ES = {
    '01':'Ene','02':'Feb','03':'Mar','04':'Abr',
    '05':'May','06':'Jun','07':'Jul','08':'Ago',
    '09':'Sep','10':'Oct','11':'Nov','12':'Dic'
  }

  const data = rows.map((r, idx) => {
    const start  = new Date(r.date_start)
    const end    = new Date(r.date_end)
    const dStart = start.getUTCDate()
    const dEnd   = end.getUTCDate()
    const mStart = MONTHS_ES[String(start.getUTCMonth() + 1).padStart(2, '0')]
    const mEnd   = MONTHS_ES[String(end.getUTCMonth() + 1).padStart(2, '0')]
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

  return reply.send({ ok: true, data })
})
  fastify.post('/ventas-canal', {
  schema: {
    body: {
      type: 'object',
      properties: {
        year:      { type: 'integer', default: 2026 },
        month_num: { type: 'integer', default: 1 },
        advisor:   { type: ['string','integer'], default: 'all' }
      }
    }
  }
}, async (req, reply) => {
  const data = await dashboardService.ventasCanalList(req.body)
  return reply.send({ ok: true, data })
})

  // 4. DETALLE VENTAS [CORREGIDO]
  // Quitamos '/dashboard' del string. Ruta final: /api/dashboard/detailsales
  fastify.post('/detailsales', {
    schema: {
      body: {
        type: 'object',
        properties: {
          cod_asesor: { type: ['integer', 'string', 'null'] },
          date: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { cod_asesor, date } = req.body
    
    let sql = `SELECT * FROM public.v_dashboard_detail_sales WHERE fecha_venta = $1`
    const params = [date]

    if (cod_asesor && cod_asesor !== 'ALL') {
        sql += ` AND cod_asesor = $2`
        params.push(cod_asesor)
    }

    sql += ` ORDER BY hora_venta DESC`

    const { rows } = await pool.query(sql, params)
    return reply.send({ ok: true, data: rows })
  })

}