import { isMembership } from '../../../utils/fico-formatters.js'
import { jobQueue as defaultJobQueue } from '../../../shared/adapters/jobs/postgres-queue.adapter.js'
import { paymentConfirmationRepository } from './payment-confirmation.repository.js'
import { odoo } from '../../../shared/adapters/odoo/odoo.adapter.js'
import { getEnrollmentOdoo } from '../../../utils/fico-queries.sql.js'
import { isEventEnrollment } from '../../../shared/event-category.js'
import {
  targetInstallmentNumber,
  isIdempotencyEligible,
  isPaidStatusAlias,
  resolveMembershipActivationDecision,
  CONFIRM_CONTADO,
  CONFIRM_DOCUMENTAL
} from './payment-confirmation.entity.js'

// Caso de uso de confirmacion del pago inicial / contado. Orquesta: guards de
// validacion de hijos e idempotencia, resolucion de la activacion de membresia,
// el SP que graba el pago real, la limpieza del placeholder, la sincronizacion
// de leads.pay_date y los side-effects (crear hijos, activar fees Odoo, encolar
// membresia diferida, sync contado a Odoo).
//
// Los side-effects de Odoo/email/hijos viven aun en otros subdominios (no
// migrados). Entran por el puerto `sideEffects` (default: service legacy) para
// que el orquestador re-apunte cada uno cuando su subdominio exista, sin tocar
// este usecase. NO se cambia sincrono<->async respecto al legacy.

const repo = paymentConfirmationRepository

// Puerto de efectos cruzados. Cada miembro es una funcion del subdominio dueno
// del efecto. Default: delega al service legacy (paridad de comportamiento).
const defaultSideEffects = {
  validateChildEnrollmentSetup: async () => ({ ok: true }),
  createChildEnrollments: async () => { throw new Error('createChildEnrollments no inyectado (falta fico.bootstrap)') },
  enrollInOdoo: async () => { throw new Error('enrollInOdoo no inyectado (falta fico.bootstrap)') },
  getEnrollmentOdoo: enrollmentId => getEnrollmentOdoo(enrollmentId),
  activateFees: orderId => odoo.activateFees(orderId),
  syncInstallmentPaymentToOdoo: async () => { throw new Error('syncInstallmentPaymentToOdoo no inyectado (falta fico.bootstrap)') },
  logAudit: async () => {}
}

// Cablea los efectos cruzados a los subdominios reales (desde fico.bootstrap.js).
export function setSideEffects (overrides = {}) {
  Object.assign(defaultSideEffects, overrides)
}

// Validacion de hijos: una inscripcion padre debe tener todas sus ediciones de
// hijos no convalidados asignadas antes de confirmar. Devuelve un error de
// dominio (result=2) o null si paso / no aplica.
async function validateChildren (enrollmentId, sideEffects) {
  if (!enrollmentId) return null
  try {
    const validation = await sideEffects.validateChildEnrollmentSetup({ enrollmentId })
    if (!validation.ok) {
      return {
        result: 2,
        message: 'Faltan ediciones por configurar antes de confirmar el pago',
        validation_errors: validation.errors
      }
    }
  } catch (vErr) {
    console.error('[confirmPayment] validateChildEnrollmentSetup falló:', vErr.message, vErr.stack)
    // No abortamos: los enrollments sin estructura de hijos no requieren validacion.
  }
  return null
}

// Guard de idempotencia: si la cuota objetivo del action ya esta 'paid'
// (cualquier alias), retorna exito idempotente sin tocar payments ni efectos
// posteriores. Cubre re-click de FICO o concurrencia de ventanas.
async function idempotencyGuard (enrollmentId, action) {
  if (!enrollmentId || !isIdempotencyEligible(action)) return null
  const targetInstNum = targetInstallmentNumber(action)
  try {
    const alias = await repo.findInstallmentStatusAlias(enrollmentId, targetInstNum)
    if (isPaidStatusAlias(alias)) {
      console.warn(`[confirmPayment] Idempotente: enrollment=${enrollmentId} action=${action} ya estaba confirmado`)
      return {
        result: 1,
        message: 'El pago ya fue confirmado previamente',
        already_confirmed: true
      }
    }
  } catch (chkErr) {
    console.error('[confirmPayment] Error chequeando idempotencia:', chkErr.message)
    // Si el chequeo falla por algo raro, dejamos que el SP corra (comportamiento previo).
  }
  return null
}

// Aprueba una venta con Orden de Servicio / de Compra: pone la inscripcion en
// 'checked' sin tocar payments ni cuotas. Devuelve la misma forma que el SP para
// que el resto del caso de uso (hijos SEG, Odoo, correo) siga igual.
//
// El UPDATE no afecta filas cuando ya estaba confirmada: eso es el guard de
// idempotencia de este camino (el de idempotencyGuard mira la cuota, que aqui
// sigue pendiente a proposito y por lo tanto nunca dispararia).
async function approveWithoutPayment (enrollmentId) {
  const updated = await repo.markCheckedWithoutPayment(enrollmentId)
  if (updated === 0) {
    console.warn(`[confirmPayment] Idempotente: enrollment=${enrollmentId} ya estaba confirmado (OS/OP)`)
    return { result: 1, message: 'La inscripcion ya fue confirmada previamente', already_confirmed: true }
  }
  return { result: 1, message: 'Inscripcion confirmada. El pago de la OS/OP queda pendiente de cobro.' }
}

// Resuelve si la confirmacion debe diferir la activacion de membresia. Lee
// is_membership de BD y delega el calculo de ventana/runAt al SP (TZ Lima),
// dejando la decision final a la entity pura.
async function resolveMembershipActivation (payload) {
  const enrollmentId = payload?.enrollment_id
  if (!enrollmentId) return { isMembership: false }

  const probe = await repo.findMembershipProbe(enrollmentId)
  const isMembershipProgram = !!probe && isMembership(probe.abbreviation, probe.is_membership)
  if (!isMembershipProgram) return { isMembership: false }

  const raw = payload.activation_date
  if (!raw) return resolveMembershipActivationDecision({ isMembershipProgram, rawDate: null })

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw).trim())) {
    return { error: 'activation_date debe ser YYYY-MM-DD' }
  }

  const facts = await repo.computeActivationFacts(raw)
  if (!facts) return { error: 'activation_date no se pudo parsear' }

  return resolveMembershipActivationDecision({
    isMembershipProgram,
    rawDate: raw,
    isTodayOrPast: facts.is_today_or_past,
    outOfWindow: facts.out_of_window,
    activationDate: facts.activation_date,
    runAt: facts.run_at
  })
}

export async function confirmPayment (payload, deps = {}) {
  const sideEffects = { ...defaultSideEffects, ...(deps.sideEffects || {}) }
  const jobQueue = deps.jobQueue || defaultJobQueue

  const childErr = await validateChildren(payload.enrollment_id, sideEffects)
  if (childErr) return childErr

  const idemHit = await idempotencyGuard(payload.enrollment_id, payload.action)
  if (idemHit) return idemHit

  // Resolvemos activation_date ANTES del SP. Si la fecha es invalida abortamos
  // sin tocar el pago: preferimos que FICO corrija el dato a que el pago quede
  // confirmado con activacion en limbo.
  const activation = await resolveMembershipActivation(payload)
  if (activation.error) {
    return { result: 0, message: activation.error }
  }

  // Capturamos el max payment_id ANTES del SP. Cualquier payment activo con id
  // <= a este valor es un placeholder previo (cat_payment_type=3113, sin
  // transaction_code) creado al confirmar el token. Tras grabar el real, ese
  // placeholder queda obsoleto y se desactiva.
  let prevMaxPayId = 0
  if (payload.enrollment_id) {
    try {
      prevMaxPayId = await repo.findPrevMaxPaymentId(payload.enrollment_id)
    } catch (e) {
      console.error('[confirmPayment] No se pudo capturar prevMaxPayId:', e.message)
    }
  }

  const isDocumental = payload.action === CONFIRM_DOCUMENTAL

  // Quien aprueba queda grabado ANTES de aprobar: los dos caminos de abajo
  // cambian cat_fico_status sin tocar user_modification_id, y el trigger de
  // auditoria lee el autor de ahi. Sin este sello la bitacora nombra al ultimo
  // que edito la venta. Best-effort: auditar no puede tumbar la confirmacion.
  if (payload.enrollment_id) {
    try {
      await repo.stampApprover(payload.enrollment_id, payload.user_id)
    } catch (e) {
      console.error('[confirmPayment] No se pudo sellar al aprobador:', e.message)
    }
  }

  let resp
  if (isDocumental) {
    resp = await approveWithoutPayment(payload.enrollment_id)
    // Mismo corte que idempotencyGuard: si ya estaba confirmada no se repiten
    // matricula en Odoo ni correo de bienvenida.
    if (resp.already_confirmed) return resp
  } else {
    try {
      resp = await repo.confirmPaymentSp(payload)
    } catch (spErr) {
      console.error('[confirmPayment] SP sp_fico_confirm_payment falló:', spErr.message, spErr.stack, 'payload:', JSON.stringify(payload))
      throw new Error(`SP confirm_payment: ${spErr.message}`)
    }
  }

  if (resp.result === 1 && payload.enrollment_id) {
    // El placeholder solo existe cuando hubo un pago previo declarado; una OS/OP
    // nace sin fila en payments, asi que no hay nada que desactivar.
    if (prevMaxPayId > 0 && !isDocumental) {
      try {
        await repo.deactivateObsoletePlaceholder(payload.enrollment_id, prevMaxPayId)
      } catch (e) {
        console.error('[confirmPayment] No se pudo desactivar placeholder:', e.message)
      }
    }

    if (payload.payment_date) {
      try {
        await repo.syncLeadPayDate(payload.enrollment_id, payload.payment_date, payload.user_id)
      } catch (e) {
        console.error('[confirmPayment] No se pudo sincronizar leads.pay_date:', e.message)
      }
    }

    try {
      await sideEffects.logAudit({
        enrollmentId: payload.enrollment_id,
        action: 'approved',
        userId: payload.user_id,
        details: isDocumental
          ? 'Inscripcion confirmada por OS/OP - sin pago recibido, cuota pendiente de cobro'
          : `Pago confirmado: ${payload.action || ''}`
      })
    } catch (auditErr) {
      console.error('[confirmPayment] logAudit approved falló:', auditErr.message)
    }

    try {
      await sideEffects.createChildEnrollments({ enrollmentId: payload.enrollment_id, userId: payload.user_id })
    } catch (err) {
      console.error('[confirmPayment] Error creando enrollments hijos:', err.message)
    }

    try {
      await repo.markPaymentTokenConfirmed(payload.enrollment_id, payload.user_id)
    } catch (err) {
      console.error('[confirmPayment] Error actualizando token:', err.message)
    }

    // Persistir membership_activation_date si la confirmacion trajo fecha valida
    // (ambos casos: inmediata o diferida) cuando el caller mando fecha explicita.
    if (activation.isMembership && activation.activationDate) {
      try {
        await repo.persistMembershipActivationDate(payload.enrollment_id, activation.activationDate)
      } catch (e) {
        console.error('[confirmPayment] No se pudo persistir membership_activation_date:', e.message)
      }
    }

    // Congreso / evento: no se toca Odoo en ninguno de los dos bloques de abajo.
    // No hay curso en el campus al que inscribir ni cuotas que activar; lo unico
    // que recibe el asistente es el correo, que dispara el frontend despues.
    const isEvent = await isEventEnrollment(payload.enrollment_id)

    // TODA membresia sale por la cola, difiera o no, y siempre en DOS jobs:
    //   bienvenida  -> hoy, sin importar la fecha de activacion. El socio recibe
    //                  credenciales el dia que se inscribe (pedido de FICO).
    //   activacion  -> en la fecha elegida (o el proximo poll si activo hoy).
    // El correo es responsabilidad del job y no de una 2da llamada del navegador:
    // si esa llamada no ocurria, el alumno quedaba sin credenciales y sin rastro.
    if (activation.isMembership) {
      try {
        const welcomeJob = await jobQueue.enqueue({
          jobType: 'membership_welcome',
          enrollmentId: payload.enrollment_id,
          payload: { enrollmentId: payload.enrollment_id },
          runAt: null
        })
        const activationJob = await jobQueue.enqueue({
          jobType: 'membership_activation',
          enrollmentId: payload.enrollment_id,
          payload: { enrollmentId: payload.enrollment_id },
          runAt: activation.deferred ? activation.runAt : null
        })
        // Flag para que el frontend NO llame a enrollInOdoo ni sendConfirmationEmail
        // despues: el job lo hara. Sin esto se mandaria el correo dos veces.
        resp.membership_queued = true
        resp.scheduled_job_id = activationJob.job_id
        resp.welcome_job_id = welcomeJob.job_id
        if (activation.deferred) {
          resp.membership_deferred = true
          resp.activation_date = activation.activationDate
        }
        await sideEffects.logAudit({
          enrollmentId: payload.enrollment_id,
          action: activation.deferred ? 'membership_activation_scheduled' : 'membership_activation_queued',
          userId: payload.user_id,
          details: activation.deferred
            ? `Bienvenida encolada hoy (job=${welcomeJob.job_id}); activacion programada para ${activation.activationDate} 09:00 (job=${activationJob.job_id})`
            : `Bienvenida y activacion inmediatas encoladas (jobs=${welcomeJob.job_id}, ${activationJob.job_id})`
        })
      } catch (qErr) {
        // Sin job, el frontend sigue siendo el plan B: membership_queued queda
        // en false y dispara el correo como antes.
        console.error('[confirmPayment] No se pudo encolar la membresia:', qErr.message)
      }
    } else if (isEvent) {
      console.log(`[confirmPayment] enrollment ${payload.enrollment_id} es evento: se omite Odoo`)
      // El frontend anuncia "inscripcion en Odoo completada" tras confirmar. En
      // un evento eso seria mentira, asi que se le avisa.
      resp.odoo_skipped = true
    } else {
      // Flujo sincrono: cursos regulares + membresia inmediata.
      try {
        let odooOrderId = (await sideEffects.getEnrollmentOdoo(payload.enrollment_id))?.odoo_order_id

        if (!odooOrderId) {
          const odooResult = await sideEffects.enrollInOdoo({ enrollmentId: payload.enrollment_id })
          if (odooResult?.success) {
            const cursoLabel = odooResult.course_search || 'Curso no especificado'
            await sideEffects.logAudit({
              enrollmentId: payload.enrollment_id,
              action: 'odoo_enrolled',
              userId: payload.user_id,
              details: `Odoo user ${odooResult.odoo_user_id} - ${cursoLabel}`
            })
            odooOrderId = (await sideEffects.getEnrollmentOdoo(payload.enrollment_id))?.odoo_order_id
          }
        }

        if (odooOrderId) {
          const activated = await sideEffects.activateFees(odooOrderId)
          if (activated?.activated > 0) {
            await sideEffects.logAudit({
              enrollmentId: payload.enrollment_id,
              action: 'odoo_fees_activated',
              userId: payload.user_id,
              details: `${activated.activated} cuota(s) pasadas a Pendiente en Odoo`
            })
          }
        }
      } catch (odooErr) {
        console.error('[confirmPayment] Odoo enroll/activate:', odooErr.message)
      }
    }

    if (payload.action === CONFIRM_CONTADO && !isEvent) {
      try {
        const odooResult = await sideEffects.syncInstallmentPaymentToOdoo({
          enrollmentId: payload.enrollment_id,
          installmentNumber: 1
        })
        if (odooResult?.success) {
          await sideEffects.logAudit({
            enrollmentId: payload.enrollment_id,
            action: 'odoo_fee_paid',
            userId: payload.user_id,
            details: `Pago contado: ${odooResult.message} (fee_id: ${odooResult.fee_id})`
          })
        }
      } catch (odooErr) {
        console.error('[confirmPayment] Odoo sync contado:', odooErr.message)
      }
    }
  }

  return resp
}
