import { authenticate, hasRole } from '../../../shared/http/auth.middleware.js'
import {
  confirmInstallmentSchema,
  additionalPaymentSchema,
  additionalPaymentEditSchema,
  editInstallmentAmountSchema,
  correctInitialPaymentSchema,
  revertInstallmentPaymentSchema,
  addInstallmentSchema,
  rescheduleInstallmentsSchema,
  collectionCampaignSchema,
  syncInstallmentPaymentSchema,
  collectionsSchema
} from './installment.schemas.js'
import * as ctrl from './installment.controller.js'

// Todo lo que cambia montos o estados ya cobrados queda restringido a roles FICO:
// reprogramar, campañas, editar montos y las correcciones de inicial/cuota. El
// resto de endpoints solo exigen autenticacion, como en el flujo legacy.
const RESCHEDULE_ROLES = ['ADMIN', 'FICO', 'LIDER_FICO']

export default async function installmentRoutes (fastify) {
  fastify.post('/confirminstallment', { preHandler: [authenticate], schema: confirmInstallmentSchema }, ctrl.confirmInstallmentHandler)
  fastify.post('/additionalpayment', { preHandler: [authenticate], schema: additionalPaymentSchema }, ctrl.additionalPaymentHandler)
  fastify.post('/additionalpayment/edit', { preHandler: [authenticate], schema: additionalPaymentEditSchema }, ctrl.additionalPaymentEditHandler)
  fastify.post('/editinstallmentamount', { preHandler: [authenticate, hasRole(RESCHEDULE_ROLES)], schema: editInstallmentAmountSchema }, ctrl.editInstallmentAmountHandler)
  fastify.post('/correctinitialpayment', { preHandler: [authenticate, hasRole(RESCHEDULE_ROLES)], schema: correctInitialPaymentSchema }, ctrl.correctInitialPaymentHandler)
  fastify.post('/revertinstallmentpayment', { preHandler: [authenticate, hasRole(RESCHEDULE_ROLES)], schema: revertInstallmentPaymentSchema }, ctrl.revertInstallmentPaymentHandler)
  fastify.post('/addinstallment', { preHandler: [authenticate], schema: addInstallmentSchema }, ctrl.addInstallmentHandler)
  fastify.post('/rescheduleinstallments', { preHandler: [authenticate, hasRole(RESCHEDULE_ROLES)], schema: rescheduleInstallmentsSchema }, ctrl.rescheduleInstallmentsHandler)
  fastify.post('/collectioncampaign', { preHandler: [authenticate, hasRole(RESCHEDULE_ROLES)], schema: collectionCampaignSchema }, ctrl.collectionCampaignHandler)
  fastify.post('/syncinstallmentpayment', { preHandler: [authenticate], schema: syncInstallmentPaymentSchema }, ctrl.syncInstallmentPaymentHandler)
  fastify.post('/collections', { preHandler: [authenticate], schema: collectionsSchema }, ctrl.collectionsHandler)
}
