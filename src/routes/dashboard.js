// src/routes/dashboard.js
import dashboardService from '../services/dashboard.service.js'
import { pool } from '../plugins/db.js' // Asegúrate de importar pool si vas a usarlo directo aquí

export default async function dashboardRoutes (fastify) {

  // 1. LISTAR DASHBOARD
  // Ruta final: /api/dashboard/dashboardlist
  fastify.post('/dashboardlist', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          year:   { type: ['integer', 'null'], default: 2026 },
          month:  { type: ['string', 'null'],  default: 'ENE' },
          period: { type: ['string', 'null'] },
          //modality
          modality: { type: ['string', 'null'], default: 'NO_ONLINE' }
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