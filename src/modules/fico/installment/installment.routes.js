import { authenticate, hasRole } from '../../../shared/http/auth.middleware.js'
import {
  confirmInstallmentSchema,
  additionalPaymentSchema,
  additionalPaymentEditSchema,
  editInstallmentAmountSchema,
  addInstallmentSchema,
  rescheduleInstallmentsSchema,
  collectionCampaignSchema,
  syncInstallmentPaymentSchema,
  collectionsSchema
} from './installment.schemas.js'
import * as ctrl from './installment.controller.js'

// Reprogramacion de cuotas restringida a roles que pueden alterar el cronograma
// y sincronizarlo con Odoo. El resto de endpoints solo exigen autenticacion,
// como en el flujo legacy.
const RESCHEDULE_ROLES = ['ADMIN', 'FICO', 'LIDER_FICO']

export default async function installmentRoutes (fastify) {
  fastify.post('/confirminstallment', { preHandler: [authenticate], schema: confirmInstallmentSchema }, ctrl.confirmInstallmentHandler)
  fastify.post('/additionalpayment', { preHandler: [authenticate], schema: additionalPaymentSchema }, ctrl.additionalPaymentHandler)
  fastify.post('/additionalpayment/edit', { preHandler: [authenticate], schema: additionalPaymentEditSchema }, ctrl.additionalPaymentEditHandler)
  fastify.post('/editinstallmentamount', { preHandler: [authenticate], schema: editInstallmentAmountSchema }, ctrl.editInstallmentAmountHandler)
  fastify.post('/addinstallment', { preHandler: [authenticate], schema: addInstallmentSchema }, ctrl.addInstallmentHandler)
  fastify.post('/rescheduleinstallments', { preHandler: [authenticate, hasRole(RESCHEDULE_ROLES)], schema: rescheduleInstallmentsSchema }, ctrl.rescheduleInstallmentsHandler)
  fastify.post('/collectioncampaign', { preHandler: [authenticate, hasRole(RESCHEDULE_ROLES)], schema: collectionCampaignSchema }, ctrl.collectionCampaignHandler)
  fastify.post('/syncinstallmentpayment', { preHandler: [authenticate], schema: syncInstallmentPaymentSchema }, ctrl.syncInstallmentPaymentHandler)
  fastify.post('/collections', { preHandler: [authenticate], schema: collectionsSchema }, ctrl.collectionsHandler)
}
