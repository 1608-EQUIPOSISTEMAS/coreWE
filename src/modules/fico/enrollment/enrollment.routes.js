import { authenticate, hasRole, ADMIN_ONLY } from '../../../shared/http/auth.middleware.js'
import * as ctrl from './enrollment.controller.js'
import {
  enrollmentRegisterSchema, enrollmentListSchema, jobStatusSchema, kpisDailySchema,
  paymentDetailGetSchema, enrollmentUpdateSchema, availableEditionsSchema, programPriceSchema,
  retireEnrollmentSchema, deleteEnrollmentSchema, enrollmentFlagsSchema, editStudentSchema,
  changeModalitySchema, editSellerAgentSchema, courseChangeSchema, reprogramEditionSchema,
  approvePendingReviewSchema, rejectEnrollmentSchema, resubmitEnrollmentSchema
} from './enrollment.schemas.js'

// Roles que pueden reasignar el asesor de una inscripcion (editSellerAgent).
const SELLER_AGENT_ROLES = ['ADMIN', 'FICO', 'LIDER_FICO']

// Rutas del agregado raiz enrollment. Toda la superficie requiere autenticacion
// (hook a nivel de plugin, espejo del addHook global del routes/fico.js legacy);
// deleteenrollment y editselleragent suman gates de rol identicos al legacy.
export default async function enrollmentRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)

  fastify.post('/enrollmentregister', { schema: enrollmentRegisterSchema }, ctrl.enrollmentRegisterHandler)
  fastify.post('/refreshlist', ctrl.refreshListHandler)
  fastify.post('/enrollmentlist', { schema: enrollmentListSchema }, ctrl.enrollmentListHandler)
  fastify.get('/enrollmentadvisors', ctrl.enrollmentAdvisorsHandler)
  fastify.get('/job-status/:enrollmentId', { schema: jobStatusSchema }, ctrl.jobStatusHandler)
  fastify.get('/kpisdaily', { schema: kpisDailySchema }, ctrl.kpisDailyHandler)
  fastify.get('/bankaccounts', ctrl.bankAccountsHandler)
  fastify.post('/paymentdetailget', { schema: paymentDetailGetSchema }, ctrl.paymentDetailGetHandler)
  fastify.post('/enrollmentupdate', { schema: enrollmentUpdateSchema }, ctrl.enrollmentUpdateHandler)
  fastify.post('/availableeditions', { schema: availableEditionsSchema }, ctrl.availableEditionsHandler)
  fastify.post('/programprice', { schema: programPriceSchema }, ctrl.programPriceHandler)
  fastify.post('/retireenrollment', { schema: retireEnrollmentSchema }, ctrl.retireEnrollmentHandler)
  fastify.post('/deleteenrollment', { preHandler: [authenticate, ADMIN_ONLY], schema: deleteEnrollmentSchema }, ctrl.deleteEnrollmentHandler)
  fastify.post('/enrollmentflags', { schema: enrollmentFlagsSchema }, ctrl.enrollmentFlagsHandler)
  fastify.post('/editstudent', { schema: editStudentSchema }, ctrl.editStudentHandler)
  fastify.post('/changemodality', { schema: changeModalitySchema }, ctrl.changeModalityHandler)
  fastify.post('/editselleragent', { preHandler: [authenticate, hasRole(SELLER_AGENT_ROLES)], schema: editSellerAgentSchema }, ctrl.editSellerAgentHandler)
  fastify.post('/coursechange', { schema: courseChangeSchema }, ctrl.courseChangeHandler)
  fastify.post('/reprogramedition', { schema: reprogramEditionSchema }, ctrl.reprogramEditionHandler)
  fastify.post('/approvependingreview', { schema: approvePendingReviewSchema }, ctrl.approvePendingReviewHandler)
  fastify.post('/rejectenrollment', { schema: rejectEnrollmentSchema }, ctrl.rejectEnrollmentHandler)
  fastify.post('/resubmitenrollment', { schema: resubmitEnrollmentSchema }, ctrl.resubmitEnrollmentHandler)
}
