import ficoService from '../services/fico.service.js'
import { authenticate, hasRole, ADMIN_ONLY } from '../middlewares/auth.hooks.js'

const RESCHEDULE_ROLES = ['ADMIN', 'FICO', 'LIDER_FICO']

export default async function ficoRoutes (fastify) {
  fastify.post('/enrollmentregister', {
    schema: {
      body: {
        type: 'object',
        required: ['inscription'],
        additionalProperties: true,
        properties: {
          inscription: { type: 'object', additionalProperties: true }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.ficoEnrollmentRegister({
        data: req.body.inscription,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[ficoEnrollmentRegister ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/enrollmentlist', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: true,
        properties: {
          q:                        { type: ['string', 'null'] },
          date_from:                { type: ['string', 'null'] },
          date_to:                  { type: ['string', 'null'] },
          edition_start_from:       { type: ['string', 'null'] },
          edition_start_to:         { type: ['string', 'null'] },
          page:                     { type: ['integer', 'null'], default: 1 },
          size:                     { type: ['integer', 'null'], default: 25 },
          order_by:                 { type: ['number', 'null'] },
          student_statuses:         { type: ['array', 'null'], items: { type: 'string' } },
          confirmations:            { type: ['array', 'null'], items: { type: 'string' } },
          advisors:                 { type: ['array', 'null'], items: { type: 'string' } },
          program_types:            { type: ['array', 'null'], items: { type: 'string' } },
          modalities:               { type: ['array', 'null'], items: { type: 'string' } },
          program_version_ids:      { type: ['array', 'null'], items: { type: 'integer' } },
          edition_num_ids:          { type: ['array', 'null'], items: { type: 'integer' } },
          payment_channels:         { type: ['array', 'null'], items: { type: 'string' } }
        }
      }
    }
  }, async (req, reply) => {
    const data = await ficoService.enrollmentList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.get('/enrollmentadvisors', async (req, reply) => {
    try {
      const data = await ficoService.enrollmentAdvisorsList()
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[enrollmentAdvisorsList ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.get('/bankaccounts', async (req, reply) => {
    const data = await ficoService.bankAccountList()
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/confirminstallment', {
    schema: {
      body: {
        type: 'object',
        required: ['installment_id', 'enrollment_id'],
        additionalProperties: true,
        properties: {
          installment_id:      { type: 'integer' },
          enrollment_id:       { type: 'integer' },
          cat_currency:        { type: ['integer', 'null'] },
          cat_payment_medium:  { type: ['integer', 'null'] },
          cat_business_entity: { type: ['integer', 'null'] },
          bank_account_id:     { type: ['integer', 'null'] },
          transaction_code:    { type: ['string', 'null'] },
          voucher_url:         { type: ['string', 'null'] },
          payment_date:        { type: ['string', 'null'] }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.confirmInstallment({
        installmentId:     req.body.installment_id,
        enrollmentId:      req.body.enrollment_id,
        catCurrency:       req.body.cat_currency,
        catPaymentMedium:  req.body.cat_payment_medium,
        catBusinessEntity: req.body.cat_business_entity,
        bankAccountId:     req.body.bank_account_id,
        transactionCode:   req.body.transaction_code,
        voucherUrl:        req.body.voucher_url,
        paymentDate:       req.body.payment_date,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[confirmInstallment ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/confirmpayment', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        additionalProperties: true,
        properties: {
          enrollment_id:    { type: 'integer' },
          currency_type:    { type: 'string' },
          payment_medium:   { type: ['string', 'null'] },
          business_entity:  { type: ['string', 'null'] },
          financial_entity: { type: ['string', 'null'] },
          installments:     { type: ['array', 'null'], items: {
            type: 'object',
            properties: {
              installment_number: { type: 'integer' },
              amount:             { type: 'number' },
              due_date:           { type: ['string', 'null'] },
              currency_type:      { type: ['string', 'null'] },
              payment_medium:     { type: ['string', 'null'] },
              business_entity:    { type: ['string', 'null'] },
              financial_entity:   { type: ['string', 'null'] }
            }
          }}
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.confirmPayment({ ...req.body, user_id: req.user?.id ?? req.body.user_id })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      req.log.error({ err, body: req.body }, 'confirmPayment failed')
      console.error('[confirmPayment ERROR]', err.message, err.stack)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/enrollinodoo', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        properties: {
          enrollment_id: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.enrollInOdoo({ enrollmentId: req.body.enrollment_id })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[enrollInOdoo ERROR]', err.message)
      return reply.code(200).send({ ok: true, data: { error: err.message } })
    }
  })

  fastify.post('/sendconfirmationemail', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        properties: {
          enrollment_id: { type: 'integer' },
          cc: { type: ['string', 'array', 'null'], items: { type: 'string' } }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const result = await ficoService.sendConfirmationEmail({
        enrollmentId: req.body.enrollment_id,
        cc: req.body.cc ?? undefined
      })
      return reply.code(200).send({ ok: true, data: result })
    } catch (err) {
      console.error('[sendConfirmationEmail ERROR]', err.message)
      return reply.code(200).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/emaillogs', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        properties: {
          enrollment_id: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    const data = await ficoService.getEmailLogs({ enrollmentId: req.body.enrollment_id })
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/sendpaymentconfirmationemail', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        properties: {
          enrollment_id: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const result = await ficoService.sendPaymentConfirmationEmail({ enrollmentId: req.body.enrollment_id })
      return reply.code(200).send({ ok: true, data: result })
    } catch (err) {
      console.error('[sendPaymentConfirmationEmail ERROR]', err.message)
      return reply.code(200).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/paymentdetailget', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        additionalProperties: false,
        properties: {
          enrollment_id: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    const data = await ficoService.paymentDetailGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/enrollmentupdate', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id', 'justificacion'],
        additionalProperties: true,
        properties: {
          enrollment_id: { type: 'integer' },
          justificacion: { type: 'string', minLength: 1 },
          fields: { type: 'object', additionalProperties: true }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.enrollmentUpdate({
        enrollmentId: req.body.enrollment_id,
        fields: req.body.fields || {},
        justificacion: req.body.justificacion,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[enrollmentUpdate ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/syncinstallmentpayment', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        properties: {
          enrollment_id: { type: 'integer' },
          installment_number: { type: ['integer', 'null'] }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.syncInstallmentPaymentToOdoo({
        enrollmentId: req.body.enrollment_id,
        installmentNumber: req.body.installment_number || null
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[syncInstallmentPayment ERROR]', err.message)
      return reply.code(200).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/availableeditions', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        additionalProperties: false,
        properties: {
          enrollment_id: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    const data = await ficoService.getAvailableEditions({ enrollmentId: req.body.enrollment_id })
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/programprice', {
    schema: {
      body: {
        type: 'object',
        required: ['program_version_id'],
        properties: {
          program_version_id: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    const data = await ficoService.getProgramPrice({ programVersionId: req.body.program_version_id })
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/previewemail', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        properties: {
          enrollment_id: { type: 'integer' },
          override_edition_id: { type: ['integer', 'null'] }
        }
      }
    }
  }, async (req, reply) => {
    const data = await ficoService.previewConfirmationEmail({
      enrollmentId: req.body.enrollment_id,
      overrideEditionId: req.body.override_edition_id || null
    })
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/retireenrollment', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id', 'reason'],
        additionalProperties: true,
        properties: {
          enrollment_id: { type: 'integer' },
          reason:        { type: 'string', minLength: 1 },
          has_refund:    { type: 'boolean' },
          refund_amount: { type: 'number' },
          justificacion: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.retireEnrollment({
        enrollmentId: req.body.enrollment_id,
        reason: req.body.reason,
        hasRefund: req.body.has_refund || false,
        refundAmount: req.body.refund_amount || 0,
        justificacion: req.body.justificacion || req.body.reason,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[retireEnrollment ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/deleteenrollment', {
    preHandler: [authenticate, ADMIN_ONLY],
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        additionalProperties: false,
        properties: {
          enrollment_id: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.deleteEnrollment({
        enrollmentId: req.body.enrollment_id,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[deleteEnrollment ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/enrollmentflags', {
    schema: {
      body: { type: 'object', required: ['enrollment_id'], properties: { enrollment_id: { type: 'integer' } } }
    }
  }, async (req, reply) => {
    const data = await ficoService.getEnrollmentFlags({ enrollmentId: req.body.enrollment_id })
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/editstudent', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id', 'justificacion'],
        additionalProperties: true,
        properties: {
          enrollment_id:   { type: 'integer' },
          first_name:      { type: 'string' },
          last_name:       { type: 'string' },
          document_number: { type: 'string' },
          origin_email:    { type: 'string' },
          origin_phone:    { type: 'string' },
          odoo_email:      { type: 'string' },
          cat_profile_id:  { type: 'integer' },
          justificacion:   { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.editStudent({
        enrollmentId:   req.body.enrollment_id,
        firstName:      req.body.first_name,
        lastName:       req.body.last_name,
        documentNumber: req.body.document_number,
        originEmail:    req.body.origin_email,
        originPhone:    req.body.origin_phone,
        odooEmail:      req.body.odoo_email,
        newProfileId:   req.body.cat_profile_id,
        justificacion:  req.body.justificacion,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[editStudent ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/addinstallment', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id', 'amount', 'due_date', 'justificacion'],
        additionalProperties: true,
        properties: {
          enrollment_id: { type: 'integer' },
          amount:        { type: 'number' },
          due_date:      { type: 'string', minLength: 1 },
          justificacion: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.addInstallment({
        enrollmentId:  req.body.enrollment_id,
        amount:        req.body.amount,
        dueDate:       req.body.due_date,
        justificacion: req.body.justificacion,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[addInstallment ERROR]', err.message)
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/editinstallmentamount', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id', 'installment_id', 'new_amount', 'justificacion'],
        additionalProperties: true,
        properties: {
          enrollment_id:  { type: 'integer' },
          installment_id: { type: 'integer' },
          new_amount:     { type: 'number' },
          justificacion:  { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.editInstallmentAmount({
        enrollmentId:   req.body.enrollment_id,
        installmentId:  req.body.installment_id,
        newAmount:      req.body.new_amount,
        justificacion:  req.body.justificacion,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[editInstallmentAmount ERROR]', err.message)
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/changemodality', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id', 'new_modality_id', 'justificacion'],
        additionalProperties: true,
        properties: {
          enrollment_id:   { type: 'integer' },
          new_modality_id: { type: 'integer' },
          justificacion:   { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.changeModality({
        enrollmentId: req.body.enrollment_id,
        newModalityId: req.body.new_modality_id,
        justificacion: req.body.justificacion,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[changeModality ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/collections', {
    preHandler: [authenticate, hasRole(['ADMIN', 'FICO', 'LIDER_FICO', 'GERENCIA'])],
    schema: {
      body: {
        type: 'object',
        required: ['year', 'month'],
        additionalProperties: true,
        properties: {
          year:        { type: 'integer', minimum: 2020, maximum: 2100 },
          month:       { type: 'integer', minimum: 1, maximum: 12 },
          day:         { type: ['integer', 'null'], minimum: 1, maximum: 31 },
          q:           { type: ['string', 'null'] },
          state:       { type: ['string', 'null'], enum: ['all', 'overdue', 'today', 'upcoming', null] },
          advisor_ids: { type: ['array', 'null'], items: { type: 'integer' } }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.getCollections({
        year:        req.body.year,
        month:       req.body.month,
        day:         req.body.day ?? null,
        q:           req.body.q || null,
        state:       req.body.state || 'all',
        advisorIds:  req.body.advisor_ids || []
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[getCollections ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/editselleragent', {
    preHandler: [authenticate, hasRole(['ADMIN', 'FICO', 'LIDER_FICO'])],
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id', 'justificacion'],
        additionalProperties: true,
        properties: {
          enrollment_id:        { type: 'integer' },
          // null o ausente = Sin Asesor (S/A)
          new_seller_agent_id:  { type: ['integer', 'null'] },
          justificacion:        { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.editSellerAgent({
        enrollmentId:     req.body.enrollment_id,
        newSellerAgentId: req.body.new_seller_agent_id ?? null,
        justificacion:    req.body.justificacion,
        userId:           req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[editSellerAgent ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/coursechange', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id', 'new_program_version_id', 'new_edition_id', 'total_amount', 'justificacion'],
        additionalProperties: true,
        properties: {
          enrollment_id:          { type: 'integer' },
          new_program_version_id: { type: 'integer' },
          new_edition_id:         { type: 'integer' },
          total_amount:           { type: 'number' },
          justificacion:          { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.courseChange({
        enrollmentId: req.body.enrollment_id,
        newProgramVersionId: req.body.new_program_version_id,
        newEditionId: req.body.new_edition_id,
        totalAmount: req.body.total_amount,
        justificacion: req.body.justificacion,
        userId: req.user?.id ?? req.body.user_id,
        cat_currency: req.body.cat_currency,
        cat_method_payment: req.body.cat_method_payment,
        cat_business_entity: req.body.cat_business_entity,
        bank_account_id: req.body.bank_account_id,
        transaction_code: req.body.transaction_code,
        ticket_payment_urls: req.body.ticket_payment_urls
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[courseChange ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/reprogramedition', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id', 'new_edition_id', 'justificacion'],
        additionalProperties: false,
        properties: {
          enrollment_id:   { type: 'integer' },
          new_edition_id:  { type: 'integer' },
          justificacion:   { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.reprogramEdition({
        enrollmentId: req.body.enrollment_id,
        newEditionId: req.body.new_edition_id,
        justificacion: req.body.justificacion,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[reprogramEdition ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/approvependingreview', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        additionalProperties: false,
        properties: {
          enrollment_id: { type: 'integer' },
          user_id:       { type: ['integer', 'null'] }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.approvePendingReview({
        enrollmentId: req.body.enrollment_id,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[approvePendingReview ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/rescheduleinstallments', {
    preHandler: [authenticate, hasRole(RESCHEDULE_ROLES)],
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id', 'changes', 'justificacion'],
        additionalProperties: false,
        properties: {
          enrollment_id: { type: 'integer' },
          justificacion: { type: 'string', minLength: 1 },
          reason_code:   { type: ['string', 'null'] },
          changes: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['installment_id', 'new_due_date'],
              additionalProperties: false,
              properties: {
                installment_id: { type: 'integer' },
                new_due_date:   { type: 'string', minLength: 10 }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.rescheduleInstallments({
        enrollmentId: req.body.enrollment_id,
        changes: req.body.changes,
        justificacion: req.body.justificacion,
        reasonCode: req.body.reason_code,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[rescheduleInstallments ERROR]', err.message)
      return reply.code(400).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/rejectenrollment', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id', 'reason'],
        additionalProperties: true,
        properties: {
          enrollment_id: { type: 'integer' },
          reason: { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.rejectEnrollment({
        enrollmentId: req.body.enrollment_id,
        reason: req.body.reason,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[rejectEnrollment ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/resubmitenrollment', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        additionalProperties: true,
        properties: {
          enrollment_id: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.resubmitEnrollment({
        enrollmentId: req.body.enrollment_id,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[resubmitEnrollment ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.get('/programchildren/:id', async (req, reply) => {
    const parentEditionId = req.query?.parent_edition_id ? parseInt(req.query.parent_edition_id) : null
    const data = await ficoService.getProgramChildren({
      programVersionId: parseInt(req.params.id),
      parentEditionId
    })
    return reply.code(200).send({ ok: true, data })
  })

  fastify.get('/validations/:enrollmentId', async (req, reply) => {
    const data = await ficoService.getValidations({ enrollmentId: parseInt(req.params.enrollmentId) })
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/validations', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id', 'validations'],
        additionalProperties: true,
        properties: {
          enrollment_id: { type: 'integer' },
          validations: {
            type: 'array',
            items: {
              type: 'object',
              required: ['child_version_id'],
              additionalProperties: true,
              properties: {
                child_version_id: { type: 'integer' },
                validation_type: { type: 'string' },
                custom_edition_id: { type: ['integer', 'null'] },
                notes: { type: ['string', 'null'] }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const data = await ficoService.saveValidations({
        enrollmentId: req.body.enrollment_id,
        validations: req.body.validations,
        userId: req.user?.id ?? req.body.user_id
      })
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[saveValidations ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.post('/auditlog', {
    schema: {
      body: {
        type: 'object',
        required: ['enrollment_id'],
        properties: {
          enrollment_id: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    const data = await ficoService.getAuditLog({ enrollmentId: req.body.enrollment_id })
    return reply.code(200).send({ ok: true, data })
  })

  fastify.get('/classroomexport/options', async (req, reply) => {
    try {
      const data = await ficoService.getClassroomExportOptions()
      return reply.code(200).send({ ok: true, data })
    } catch (err) {
      console.error('[classroomExportOptions ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })

  fastify.get('/classroomexport', {
    schema: {
      querystring: {
        type: 'object',
        required: ['programVersionId', 'editionNumId'],
        properties: {
          programVersionId: { type: 'integer' },
          editionNumId:     { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    try {
      const csv = await ficoService.exportClassroomCsv({
        programVersionId: Number(req.query.programVersionId),
        editionNumId:     Number(req.query.editionNumId)
      })
      const filename = `aula_${req.query.programVersionId}_${req.query.editionNumId}.csv`
      return reply
        .code(200)
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csv)
    } catch (err) {
      console.error('[classroomExport ERROR]', err.message)
      return reply.code(500).send({ ok: false, error: err.message })
    }
  })
}
