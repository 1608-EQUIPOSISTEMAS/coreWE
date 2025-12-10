// src/routes/discounts.js
import discountService from '../services/discount.service.js'

export default async function discountRoutes (fastify) {
  // registrar descuento
  fastify.post('/discountregister', {
    schema: {
      body: {
        type: 'object',
        required: ['discount'],
        additionalProperties: false,
        properties: {
          discount: {
            type: 'object',
            additionalProperties: false,
            properties: {
              description:        { type: ['string','null'] },
              alias:              { type: ['string','null'] },
              cat_discount_type:  { type: ['integer','null'] },
              cat_currency_type:  { type: ['integer','null'] }, // NUEVO
              value:              { type: ['number','null'] },
              is_global:          { type: ['boolean','null'] },
              campaign_id:        { type: ['integer','null'] },
              start_date:         { type: ['string','null'] }, // YYYY-MM-DD
              end_date:           { type: ['string','null'] }, // YYYY-MM-DD
              active:             { type: ['boolean','null'] },
              program_ids:        {                            // NUEVO
                type: ['array', 'null'],
                items: { type: 'integer' }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const payload = req.body
    const { discount_id } = await discountService.discountRegister(payload)
    return reply.code(201).send({ ok: true, discount_id })
  })

 // listar descuentos
  fastify.post('/discountlist', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // Quitamos from_date, to_date y campaign_id porque el SP actual no filtra por eso
          active:             { type: ['boolean','null'] },
          cat_discount_type:  { type: ['integer','null'] },
          is_global:          { type: ['boolean','null'] }, // <--- Agregamos este campo
          q:                  { type: ['string','null'] },
          page:               { type: ['integer','null'], default: 1 },
          size:               { type: ['integer','null'], default: 25 }
        }
      }
    }
  }, async (req, reply) => {
    const data = await discountService.discountList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // obtener descuento por id
  fastify.post('/discountget', {
    schema: {
      body: {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: {
          id: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    const { data } = await discountService.discountGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // actualizar descuento
  fastify.post('/discountupdate', {
    schema: {
      body: {
        type: 'object',
        required: ['id','discount'],
        additionalProperties: false,
        properties: {
          id: { type: 'integer' },
          discount: {
            type: 'object',
            additionalProperties: false,
            properties: {
              description:        { type: ['string','null'] },
              alias:              { type: ['string','null'] },
              cat_discount_type:  { type: ['integer','null'] },
              cat_currency_type:  { type: ['integer','null'] }, // NUEVO
              value:              { type: ['number','null'] },
              is_global:          { type: ['boolean','null'] },
              campaign_id:        { type: ['integer','null'] },
              start_date:         { type: ['string','null'] },
              end_date:           { type: ['string','null'] },
              active:             { type: ['boolean','null'] },
              program_ids:        {                            // NUEVO
                type: ['array', 'null'],
                items: { type: 'integer' }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const { discount_id } = await discountService.discountUpdate(req.body)
    return reply.code(200).send({ ok: true, discount_id })
  })

  fastify.post('/discountcaller', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          q:                 { type: ['string', 'null'] },
          cat_discount_type: { type: ['integer', 'null'] }, // Filtro opcional por tipo
          cat_currency:      { type: ['integer', 'null'] },
          active:            { type: ['boolean', 'null'], default: true }
        }
      }
    }
  }, async (req, reply) => {
    const data = await discountService.discountCaller(req.body)
    return reply.code(200).send({ ok: true, data })
  })
}