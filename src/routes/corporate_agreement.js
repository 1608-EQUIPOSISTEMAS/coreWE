// src/routes/corporate_agreements.js
import agreementService from '../services/corporate_agreement.service.js'

export default async function corporateAgreementRoutes (fastify) {
  
  // REGISTRAR CONVENIO (Agreement)
  fastify.post('/agreementregister', {
    schema: {
      body: {
        type: 'object',
        required: ['agreement'],
        additionalProperties: false,
        properties: {
          agreement: {
            type: 'object',
            required: ['company_id'], // company_id es mandatorio
            additionalProperties: false,
            properties: {
              company_id:           { type: 'integer' },
              intermediary_id:      { type: ['integer', 'null'] },
              
              // Descuentos (numeric en DB, number en JS)
              discount_live_pct:    { type: ['number', 'null'] },
              discount_online_pct:  { type: ['number', 'null'] },
              
              // Fechas (YYYY-MM-DD)
              start_date:           { type: ['string', 'null'] },
              end_date:             { type: ['string', 'null'] },
              
              // flags
              active:               { type: ['string', 'null'] }, // 'Y' | 'N'
              
              // auditoría
              user_registration_id: { type: ['integer', 'null'] }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const payload = req.body
    const { agreement_id, data } = await agreementService.agreementRegister(payload)
    
    return reply.code(201).send({
      ok: true,
      agreement_id,
      data
    })
  })

  // LISTAR CONVENIOS (Paginado)
  fastify.post('/agreementlist', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          active: { type: ['boolean', 'string', 'null'] }, // true/false o 'Y'/'N'
          q:      { type: ['string', 'null'] },            // busca en razon social o comercial
          page:   { type: ['integer', 'null'], default: 1 },
          size:   { type: ['integer', 'null'], default: 25 }
        }
      }
    }
  }, async (req, reply) => {
    const data = await agreementService.agreementList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // CALLER PARA COMBOS (SearchSelect)
  fastify.post('/agreementcaller', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          active: { type: ['boolean', 'string', 'null'] }, 
          q:      { type: ['string', 'null'] }
        }
      }
    }
  }, async (req, reply) => {
    const items = await agreementService.agreementCaller(req.body)
    return reply.code(200).send({ ok: true, items })
  })

  // ACTUALIZAR CONVENIO
  fastify.post('/agreementupdate', {
    schema: {
      body: {
        type: 'object',
        required: ['id', 'agreement'],
        additionalProperties: false,
        properties: {
          id: { type: 'integer' }, // agreement_id
          agreement: {
            type: 'object',
            additionalProperties: false,
            properties: {
              company_id:           { type: ['integer', 'null'] },
              intermediary_id:      { type: ['integer', 'null'] },
              
              discount_live_pct:    { type: ['number', 'null'] },
              discount_online_pct:  { type: ['number', 'null'] },
              
              start_date:           { type: ['string', 'null'] },
              end_date:             { type: ['string', 'null'] },
              
              active:               { type: ['string', 'null'] }, // 'Y' | 'N'
              
              user_modification_id: { type: ['integer', 'null'] }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const { agreement_id, data } = await agreementService.agreementUpdate(req.body)

    return reply.code(200).send({
      ok: true,
      agreement_id,
      data
    })
  })
}