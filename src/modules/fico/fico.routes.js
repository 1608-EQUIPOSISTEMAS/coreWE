import './fico.bootstrap.js'
import enrollmentRoutes from './enrollment/enrollment.routes.js'
import paymentConfirmationRoutes from './payment-confirmation/payment-confirmation.routes.js'
import installmentRoutes from './installment/installment.routes.js'
import membershipRoutes from './membership/membership.routes.js'
import validationRoutes from './validation/validation.routes.js'
import odooSyncRoutes from './odoo-sync/odoo-sync.routes.js'
import emailConfirmationRoutes from './email-confirmation/email-confirmation.routes.js'
import auditRoutes from './audit/audit.routes.js'
import classroomExportRoutes from './classroom-export/classroom-export.routes.js'

// Agregador del modulo FICO. Registra los 9 subdominios como plugins Fastify
// encapsulados bajo el mismo prefijo /api/fico (lo aplica buildApp). Cada subdominio
// trae su propio preHandler de autenticacion. Importa fico.bootstrap (composition
// root) que cablea los efectos cruzados entre subdominios. El legacy fico.service.js
// fue retirado: validar flujos de dinero en staging.
export default async function ficoRoutes (fastify) {
  await fastify.register(enrollmentRoutes)
  await fastify.register(paymentConfirmationRoutes)
  await fastify.register(installmentRoutes)
  await fastify.register(membershipRoutes)
  await fastify.register(validationRoutes)
  await fastify.register(odooSyncRoutes)
  await fastify.register(emailConfirmationRoutes)
  await fastify.register(auditRoutes)
  await fastify.register(classroomExportRoutes)
}
