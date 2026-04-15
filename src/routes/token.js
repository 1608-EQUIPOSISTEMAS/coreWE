import tokenService from '../services/token.service.js'

export default async function tokenRoutes (fastify) {

  fastify.get('/list', async (req, reply) => {
    try {
      const data = await tokenService.tokenList(req.query)
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[tokenList ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/create', {
    schema: {
      body: {
        type: 'object',
        required: ['lead_id', 'cat_provider', 'amount'],
        additionalProperties: true,
        properties: {
          lead_id:         { type: 'integer' },
          enrollment_id:   { type: ['integer', 'null'] },
          cat_provider:    { type: 'integer' },
          amount:          { type: 'number' },
          currency:        { type: ['string', 'null'] },
          payment_url:     { type: ['string', 'null'] },
          notes:           { type: ['string', 'null'] },
          expiration_date: { type: ['string', 'null'] },
          cat_payment_channel: { type: ['integer', 'null'] }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await tokenService.tokenCreate({
        leadId:         req.body.lead_id,
        enrollmentId:   req.body.enrollment_id,
        catProvider:    req.body.cat_provider,
        amount:         req.body.amount,
        currency:       req.body.currency,
        paymentUrl:     req.body.payment_url,
        notes:          req.body.notes,
        expirationDate: req.body.expiration_date,
        catPaymentChannel: req.body.cat_payment_channel,
        inscriptionData: req.body.inscription_data,
        userId:         req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[tokenCreate ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.put('/update', {
    schema: {
      body: {
        type: 'object',
        required: ['token_id'],
        additionalProperties: true,
        properties: {
          token_id:            { type: 'integer' },
          payment_url:         { type: ['string', 'null'] },
          provider_reference:  { type: ['string', 'null'] },
          notes:               { type: ['string', 'null'] },
          expiration_date:     { type: ['string', 'null'] },
          cat_provider:        { type: ['integer', 'null'] },
          amount:              { type: ['number', 'null'] }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await tokenService.tokenUpdate({
        tokenId:           req.body.token_id,
        paymentUrl:        req.body.payment_url,
        providerReference: req.body.provider_reference,
        notes:             req.body.notes,
        expirationDate:    req.body.expiration_date,
        catProvider:       req.body.cat_provider,
        amount:            req.body.amount,
        userId:            req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[tokenUpdate ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/markpaid', {
    schema: {
      body: {
        type: 'object',
        required: ['token_id'],
        additionalProperties: true,
        properties: {
          token_id:           { type: 'integer' },
          provider_reference: { type: ['string', 'null'] }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await tokenService.tokenMarkPaid({
        tokenId:           req.body.token_id,
        providerReference: req.body.provider_reference,
        userId:            req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[tokenMarkPaid ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/confirm', {
    schema: {
      body: {
        type: 'object',
        required: ['token_id'],
        additionalProperties: true,
        properties: {
          token_id:           { type: 'integer' },
          provider_reference: { type: ['string', 'null'] }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await tokenService.tokenConfirm({
        tokenId:           req.body.token_id,
        providerReference: req.body.provider_reference,
        userId:            req.user?.id ?? req.body.user_id
      })

      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[tokenConfirm ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.delete('/delete/:id', async (req, reply) => {
    try {
      const data = await tokenService.tokenDelete({
        tokenId: Number(req.params.id)
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[tokenDelete ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })
}
