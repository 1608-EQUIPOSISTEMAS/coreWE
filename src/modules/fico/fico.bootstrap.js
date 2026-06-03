import { logAudit } from './audit/audit.usecases.js'
import { enrollInOdoo, syncInstallmentPaymentToOdoo } from './odoo-sync/odoo-sync.usecases.js'
import { enrollMembershipInOdoo } from './membership/membership.usecases.js'
import { sendConfirmationEmail, configureEmailDeps } from './email-confirmation/email-confirmation.usecases.js'
import { createChildEnrollments, validateChildEnrollmentSetup, setPorts as setValidationPorts } from './validation/validation.usecases.js'
import { setEnrollmentPorts } from './enrollment/enrollment.repository.js'
import { setSideEffects } from './payment-confirmation/payment-confirmation.usecases.js'

// Composition root del modulo FICO. Cablea los efectos cruzados entre subdominios
// (audit / odoo-sync / membership / email-confirmation / validation) a traves de los
// puntos de inyeccion de cada uno, resolviendo el ciclo email<->membership sin imports
// circulares estaticos. Reemplaza los puentes que delegaban al legacy fico.service.js.
// Idempotente: se ejecuta una sola vez al importarse (lo importan fico.routes.js y
// job-worker.cron.js).
let wired = false

export function bootstrapFico () {
  if (wired) return
  wired = true

  // email-confirmation necesita los efectos Odoo (ciclo email<->membership).
  configureEmailDeps({ enrollInOdoo, enrollMembershipInOdoo })

  // validation (escenario E0): audita, inscribe hijos en Odoo y envia confirmacion.
  setValidationPorts({ logAudit, enrollInOdoo, sendConfirmationEmail })

  // enrollment.repository: efectos cruzados de su orquestacion.
  setEnrollmentPorts({ logAudit, enrollInOdoo, sendConfirmationEmail, createChildEnrollments })

  // payment-confirmation: side-effects de la confirmacion del pago.
  setSideEffects({
    validateChildEnrollmentSetup,
    createChildEnrollments,
    enrollInOdoo,
    syncInstallmentPaymentToOdoo,
    logAudit
  })
}

bootstrapFico()
