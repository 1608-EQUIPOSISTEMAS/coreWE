import { DomainError, NotFoundError } from '../../../shared/errors.js'
import { safeAsync } from '../../../shared/utils/safe-async.js'
import { enrollmentRepository, ALIAS } from './enrollment.repository.js'
import { isMembership } from '../../../utils/fico-formatters.js'
import { buildOdooNameParts } from '../../../utils/fico-odoo.helper.js'
import {
  fmtAgent,
  advisorObservationOrNull,
  flattenDailyKpis,
  resolveSellerAgentChange,
  assertChecked,
  assertModalityChangeNeeded,
  editionShiftDays,
  buildDuplicateResponse,
  buildDirectInscription,
  buildCourseChangeInscription,
  buildReprogramInscription,
  buildReprogramPlan,
  courseChangeAmountDifference,
  selectChildrenToRetireOnCourseChange,
  MEMBERSHIP_ACTIVATION_WINDOW_MONTHS
} from './enrollment.entity.js'
import { toEnrollmentListDto, toPaymentDetailDto } from './enrollment.dto.js'

// Casos de uso del agregado raiz enrollment. Orquesta repository (SQL/SP) +
// entity (reglas puras) + efectos cruzados (audit/Odoo/email/cola). Replica los
// flujos del service legacy sin alterar su caracter sincrono/asincrono.

const repo = enrollmentRepository

// --- Listado, KPIs, asesores, cuentas ------------------------------------

export async function enrollmentList (payload = {}) {
  const rows = await repo.listEnrollments(payload)
  return toEnrollmentListDto(rows, payload)
}

export async function refreshEnrollmentList () {
  await repo.forceRefreshMv('manual-reload')
  return { result: 1, message: 'Listado actualizado' }
}

// Cache in-memory del dropdown de asesores (TTL 5 min): FICO abre el listado con
// frecuencia y la query es costosa. Proceso-local; se invalida al reasignar asesor.
let _advisorsCache = null
let _advisorsCachedAt = 0
const ADVISORS_TTL_MS = 5 * 60 * 1000

export function invalidateAdvisorsCache () {
  _advisorsCache = null
  _advisorsCachedAt = 0
}

export async function enrollmentAdvisorsList () {
  const now = Date.now()
  if (_advisorsCache && (now - _advisorsCachedAt) < ADVISORS_TTL_MS) return _advisorsCache
  _advisorsCache = await repo.advisorsList()
  _advisorsCachedAt = now
  return _advisorsCache
}

export async function getKpisDaily ({ today, yesterday }) {
  if (!today || !yesterday) {
    throw new DomainError('getKpisDaily requiere today y yesterday en formato YYYY-MM-DD')
  }
  return flattenDailyKpis(await repo.kpisDaily({ today, yesterday }))
}

export async function bankAccountList () {
  return repo.bankAccountList()
}

export async function getLatestJob ({ enrollmentId, jobType }) {
  return repo.getLatestJob(enrollmentId, jobType)
}

// --- Detalle de pago -----------------------------------------------------

export async function paymentDetailGet ({ enrollment_id }) {
  const result = await repo.paymentDetailGet(enrollment_id)
  if (result) {
    try {
      const ed = await repo.paymentDetailEditionDates(enrollment_id)
      if (ed) {
        result.edition_start_date = ed.edition_start_date || null
        result.edition_end_date = ed.edition_end_date || null
        result.commercial_pay_date = ed.commercial_pay_date || null
        result.membership_activation_date = ed.membership_activation_date || null
        result.membership_program_id = ed.membership_program_id || null
        result.membership_program_name = ed.membership_program_name || null
        result.cat_type_status_alias = ed.cat_type_status_alias || null
        result.b2b_doctype_alias = ed.b2b_doctype_alias || null
        result.b2b_doctype_label = ed.b2b_doctype_label || null
        // Correo en copia: el valor guardado, el flag que comercial levanto y la
        // observacion cruda del asesor (enrollments.notes) que la pidio. FICO ve
        // los tres en el preview del correo y decide; nunca se parsea la nota.
        result.email_cc = ed.email_cc || null
        result.requires_email_cc = ed.requires_email_cc === true
        result.advisor_observation = advisorObservationOrNull(ed.advisor_observation)
      }
    } catch (err) {
      console.error('[paymentDetailGet] edition dates:', err.message)
    }
    try {
      result.discounts = await repo.paymentDetailDiscounts(enrollment_id)
    } catch (err) {
      console.error('[paymentDetailGet] discounts:', err.message)
      result.discounts = []
    }
    try {
      const cert = await repo.paymentDetailCertificate(enrollment_id)
      result.certificate_status_alias = cert.status?.certificate_status_alias || null
      result.certificate_status_label = cert.status?.certificate_status_label || null
      result.additional_payments = cert.additionalPayments
    } catch (err) {
      console.error('[paymentDetailGet] certificate:', err.message)
    }
  }
  return toPaymentDetailDto(result)
}

// --- Registro directo FICO ----------------------------------------------

// skipFollowup: omite TODOS los efectos posteriores al alta (cola
// register_followup = correo + activacion Odoo, y el refresh de la MV por fila).
// Lo usa la importacion masiva: solo debe insertar datos, sin notificar a nadie.
export async function ficoEnrollmentRegister ({ data, userId, skipFollowup = false, dedupeByVersion = false }) {
  const doc = data.document_number && String(data.document_number).trim() ? String(data.document_number).trim() : null
  const mail = data.email && String(data.email).trim() ? String(data.email).trim() : null
  if (data.program_edition_id && (doc || mail)) {
    const duplicate = await repo.findDuplicate({ programEditionId: data.program_edition_id, doc, mail })
    if (duplicate) return buildDuplicateResponse(duplicate)
  } else if (dedupeByVersion && !data.program_edition_id && data.program_version_id && (doc || mail)) {
    // Convalidacion (sin edicion): re-correr la importacion no debe duplicarla.
    const duplicate = await repo.findDuplicateByVersion({ programVersionId: data.program_version_id, doc, mail })
    if (duplicate) return buildDuplicateResponse(duplicate)
  }

  const inscription = buildDirectInscription(data)
  const enrollResp = await repo.registerDirect({ userId, inscription })

  if (enrollResp.result === 1 && enrollResp.enrollment_id) {
    const eid = enrollResp.enrollment_id

    const ccArray = repo.parseEmailCc(data.email_cc)
    if (ccArray.length > 0) {
      try {
        await repo.saveEmailCc(eid, ccArray)
      } catch (ccErr) {
        console.error('[ficoEnrollmentRegister] No se pudo guardar email_cc:', ccErr.message)
      }
    }

    await repo.logAudit({ enrollmentId: eid, action: 'created', userId, details: 'Inscripcion registrada desde FICO' })
    await repo.logAudit({
      enrollmentId: eid,
      action: 'approved',
      userId,
      details: inscription.is_scholarship ? 'Beca - sin pago requerido' : 'Auto-aprobado por registro directo FICO'
    })
    if (!inscription.is_scholarship && data.cat_payment_medium) {
      const payAmount = data.total_amount || data.saved_money || 0
      await repo.logAudit({
        enrollmentId: eid,
        action: 'payment_registered',
        userId,
        details: `Pago registrado: ${payAmount} - Op: ${data.transaction_code || 'N/A'}`
      })
    }

    // Importacion masiva: sin correo, sin Odoo, sin refresh por fila. El listado
    // se actualiza con un "Actualizar" manual o refreshEnrollmentList al final.
    if (!skipFollowup) {
      // leads.pay_date gana en la cascada F.PAGO (listado y hojas de Sheets);
      // alinearlo a la fecha real del pago registrado o queda con la fecha
      // comercial y el sheet nunca refleja lo que muestra FICO.
      const payIso = String(data.payment_date || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
      await repo.syncLeadPayDate(eid, payIso, userId)

      repo.refreshMv('on-register-sync')

      let registerJobId = null
      try {
        const job = await repo.enqueueRegisterFollowup({
          enrollmentId: eid,
          userId,
          sapUsername: data.sap_username ?? null,
          sapPassword: data.sap_password ?? null
        })
        registerJobId = job.job_id
      } catch (qErr) {
        console.error('[ficoEnrollmentRegister] enqueue register_followup fallo:', qErr.message)
      }
      enrollResp.email_pending = true
      enrollResp.job_id = registerJobId
    }
  }

  return enrollResp
}

// --- Ediciones / precios -------------------------------------------------

export async function getAvailableEditions ({ enrollmentId }) {
  const e = await repo.getEnrollmentEditionRefs(enrollmentId)
  if (!e?.program_version_id) return []
  const editions = await repo.listEditionsByVersion(e.program_version_id)
  return (editions || []).filter(ed => (ed.edition_num_id || ed.id) !== e.program_edition_id)
}

export async function getProgramPrice ({ programVersionId }) {
  return repo.getProgramPrice(programVersionId)
}

// --- Reprogramar edicion -------------------------------------------------
//
// Modelo RP = 2 inscripciones (mismo esquema que el cambio de curso):
//  - ORIGEN: conserva su edicion y todo lo pagado, pasa a estado RP; sus hijos
//    SEG pasan a R (retirados). Sus cuotas pendientes salen de aqui.
//  - DESTINO: inscripcion nueva en la edicion elegida, estado ACT, pago 0 (la
//    venta vive en el origen) y hereda las cuotas pendientes (plan editable por
//    FICO). El job register_followup crea sus hijos SEG, lo inscribe en Odoo y
//    manda el correo — que asi lista SOLO las cuotas por pagar.

export async function reprogramEdition ({ enrollmentId, newEditionId, justificacion, userId, installmentPlan = null }) {
  const old = await repo.getCourseChangeOrigin(enrollmentId)
  if (!old) throw new DomainError('Inscripcion no encontrada')
  if (old.program_edition_id === newEditionId) {
    throw new DomainError('La nueva edicion es la misma que la actual')
  }

  const newEd = await repo.getEditionById(newEditionId)
  if (!newEd) throw new DomainError('La edicion destino no existe')
  if (newEd.program_version_id !== old.program_version_id) {
    throw new DomainError('La edicion destino no pertenece al mismo programa')
  }

  const pendingRows = await repo.getReprogramPendingInstallments(enrollmentId)
  const diffDays = editionShiftDays(old.old_start_date, newEd.start_date)
  const plan = buildReprogramPlan({ pendingRows, requestedPlan: installmentPlan, diffDays })

  const rpNote = `Reprogramacion desde inscripcion #${enrollmentId} (${old.old_program_name || ''} ${old.old_edition_code || ''})`
  const inscription = buildReprogramInscription({
    old, newEditionId, rpNote, today: new Date().toISOString().slice(0, 10)
  })

  const newEnroll = await repo.registerDirect({ userId, inscription })
  if (newEnroll.result !== 1 || !newEnroll.enrollment_id) {
    throw new DomainError(newEnroll.message || 'Error al crear la inscripcion destino')
  }
  const newEid = newEnroll.enrollment_id

  await repo.transferInstallmentsForReprogram({ oldEnrollmentId: enrollmentId, newEid, plan })

  const ccArray = repo.parseEmailCc(old.email_cc)
  if (ccArray.length > 0) {
    await repo.saveEmailCc(newEid, ccArray).catch(err => console.error('[reprogramEdition] email_cc:', err.message))
  }

  // Marcar RP recien cuando el destino existe y ya tiene las cuotas: si algo
  // de lo anterior falla, el origen queda intacto.
  await repo.setReprogrammedStatus(enrollmentId)

  // Hijos SEG del origen -> R (retirados). El followup del destino creara los suyos.
  const retId = await repo.resolveCatalogId(ALIAS.ENROLLMENT_STATUS_RETIRED)
  const retiredChildren = []
  if (retId) {
    const children = await repo.getActiveChildren(enrollmentId, retId)
    for (const child of children) {
      await repo.retireChild(child.enrollment_id, retId)
      await repo.logAudit({
        enrollmentId: child.enrollment_id,
        action: 'retired',
        userId,
        justificacion,
        details: `Retirado por reprogramacion del programa padre #${enrollmentId} hacia ${newEd.global_code || ''} (nueva inscripcion #${newEid})`
      })
      retiredChildren.push(`${child.child_program_name || ''} ${child.edition_code || ''}`.trim())
    }
  }

  const fmtDate = d => d ? new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '---'
  const edicionChange = {
    old: `${old.old_edition_code || '---'} (${fmtDate(old.old_start_date)})`,
    new: `${newEd.global_code || '---'} (${fmtDate(newEd.start_date)})`
  }
  const changes = {
    'Edicion': edicionChange,
    'Nuevo enrollment': { old: '---', new: `#${newEid}` },
    // Anclas estables para el historial del aula (classroomStudentsHistory).
    old_edition_id: old.program_edition_id,
    new_edition_id: newEditionId,
    new_enrollment_id: newEid
  }
  if (plan.length > 0) {
    const planTotal = plan.reduce((s, p) => s + p.amount, 0)
    changes['Cuotas trasladadas'] = { old: '---', new: `${plan.length} cuota(s) pendiente(s) (S/. ${planTotal.toFixed(2)}) al enrollment #${newEid}` }
  }
  if (retiredChildren.length > 0) {
    changes['Modulos retirados'] = { old: '---', new: retiredChildren.join(', ') }
  }

  await repo.logAudit({
    enrollmentId,
    action: 'edition_reprogrammed',
    userId,
    justificacion,
    changes,
    details: `Reprogramacion de edicion: ${edicionChange.old} → ${edicionChange.new}. Nueva inscripcion #${newEid}`
  })

  await repo.logAudit({
    enrollmentId: newEid,
    action: 'created_from_rp',
    userId,
    justificacion,
    changes: {
      'Edicion origen': { old: '---', new: edicionChange.old },
      'Edicion nueva': { old: '---', new: edicionChange.new },
      'Enrollment origen': { old: '---', new: `#${enrollmentId}` }
    },
    details: `Creado por reprogramacion de #${enrollmentId}: ${edicionChange.old} → ${edicionChange.new}${plan.length ? `. ${plan.length} cuota(s) pendiente(s) heredada(s)` : ''}`
  })

  // Odoo: desinscribir el origen (grupos del aula vieja + cancelar orden de venta).
  if (old.old_odoo_activation) {
    await repo.unenrollFromOldOdoo({ enrollmentId, old })
    await repo.logAudit({ enrollmentId, action: 'odoo_unenrolled', userId, details: `Desinscrito de Odoo: ${old.old_odoo_activation}` })
  }

  // Destino: hijos SEG -> Odoo -> correo de confirmacion, via job con reintentos.
  let jobId = null
  try {
    const job = await repo.enqueueRegisterFollowup({ enrollmentId: newEid, userId })
    jobId = job.job_id
  } catch (qErr) {
    console.error('[reprogramEdition] enqueue register_followup fallo:', qErr.message)
  }

  repo.refreshMv('on-reprogram')
  return {
    result: 1,
    message: 'Edicion reprogramada correctamente',
    new_enrollment_id: newEid,
    email_pending: true,
    job_id: jobId
  }
}

// --- Cambio de curso -----------------------------------------------------

// Retira los modulos del paquete origen que todavia no empiezan y devuelve sus
// etiquetas para la bitacora. Espeja lo que ya hacian reprogramEdition y
// retireEnrollment; la regla de CUALES retirar vive en la entity.
async function retireUnstartedChildren ({ enrollmentId, destinationEnrollmentId, userId, justificacion, destinationLabel }) {
  const retId = await repo.resolveCatalogId(ALIAS.ENROLLMENT_STATUS_RETIRED)
  if (!retId) {
    console.warn('[courseChange] No se encontro catalogo Retirado: modulos del origen sin retirar')
    return []
  }
  const children = await repo.getActiveChildren(enrollmentId, retId)
  const porRetirar = selectChildrenToRetireOnCourseChange({
    children, destinationEnrollmentId, today: new Date()
  })
  const retirados = []
  for (const child of porRetirar) {
    await repo.retireChild(child.enrollment_id, retId)
    await repo.logAudit({
      enrollmentId: child.enrollment_id,
      action: 'retired',
      userId,
      justificacion,
      details: `Retirado por cambio de curso del programa padre #${enrollmentId} hacia ${destinationLabel} (nueva inscripcion #${destinationEnrollmentId})`
    })
    retirados.push(`${child.child_program_name || ''} ${child.edition_code || ''}`.trim())
  }
  return retirados
}

export async function courseChange ({ enrollmentId, newProgramVersionId, newEditionId, totalAmount, justificacion, userId, cat_currency, cat_method_payment, cat_business_entity, bank_account_id, transaction_code, ticket_payment_urls }) {
  const old = await repo.getCourseChangeOrigin(enrollmentId)
  if (!old) throw new DomainError('Inscripcion no encontrada')

  // Las membresias (WE PLUS/GOLD/PLAT/BLACK) no tienen program_editions: el CC
  // hacia una membresia llega sin new_edition_id y crea la inscripcion destino con
  // program_edition_id null (igual que una venta de membresia normal). Lo mismo
  // aplica a programas online sin ediciones vigentes; si el destino si tiene
  // ediciones para elegir, la edicion sigue siendo obligatoria.
  let newEd
  if (newEditionId) {
    newEd = await repo.getCourseChangeDestEdition(newEditionId, newProgramVersionId)
    if (!newEd) throw new DomainError('La edicion destino no existe o no pertenece al programa seleccionado')
  } else {
    newEd = await repo.getCourseChangeDestProgram(newProgramVersionId)
    if (!newEd) throw new DomainError('El programa destino no existe')
    // Sin edicion solo se acepta si el destino realmente no tiene ninguna que
    // elegir: membresia, o programa online sin ediciones vigentes publicadas.
    if (!newEd.is_membership && newEd.has_editions) throw new DomainError('Debe seleccionar una edicion destino')
  }

  const ccNote = `Cambio de curso desde inscripcion #${enrollmentId} (${old.old_program_name || ''} ${old.old_edition_code || ''})`
  const { ccContadoCatId, resolvedMethodPayment } = await repo.resolveCourseChangeMethod(enrollmentId)

  const inscription = buildCourseChangeInscription({
    old, newProgramVersionId, newEditionId, totalAmount, ccNote,
    cat_currency, cat_method_payment, cat_business_entity, bank_account_id,
    transaction_code, ticket_payment_urls,
    ccContadoCatId, resolvedMethodPayment, today: new Date().toISOString().slice(0, 10)
  })

  const newEnroll = await repo.registerDirect({ userId, inscription })
  if (newEnroll.result !== 1) {
    throw new DomainError(newEnroll.message || 'Error al crear la inscripcion destino')
  }
  const newEid = newEnroll.enrollment_id

  // Marcar el origen como "cambio de curso" recien cuando la inscripcion
  // destino ya existe: si registerDirect falla, el origen no debe quedar
  // marcado con un cambio que nunca ocurrio.
  await repo.setCourseChangedStatus(enrollmentId)

  const { oldAmount } = courseChangeAmountDifference(old.total_amount, old.discount_amount, totalAmount)

  if (newEid) {
    await repo.finalizeCourseChange({
      enrollmentId, newEid, old, newProgramVersionId, newEditionId,
      totalAmount, oldAmount, justificacion, userId,
      cat_method_payment, cat_business_entity, bank_account_id, transaction_code
    })

    // Destino paquete/especializacion: crear sus hijos SEG (uno por aula de la
    // estructura), igual que la venta directa y el modelo RP. Sin esto el
    // destino queda como "hoja" sentado en el aula del diploma y el padre
    // muestra AULA 1 en el cronograma (caso Diana Supo, CC #9). Si el destino
    // es un curso normal, createChildEnrollments sale solo (sin estructura).
    await safeAsync('[courseChange] crear hijos SEG del destino', () =>
      repo.createChildEnrollments({ enrollmentId: newEid, userId }))
  }

  // Modulos del paquete ORIGEN que aun no empiezan: el alumno se fue a otro
  // programa, ya no los va a llevar. Sin esto quedaban vivos ocupando asiento en
  // sus aulas (11 casos al 25/08/2026, ver selectChildrenToRetireOnCourseChange).
  const retiredChildren = await retireUnstartedChildren({
    enrollmentId, destinationEnrollmentId: newEid, userId, justificacion,
    destinationLabel: `${newEd.new_program_name || ''} ${newEd.global_code || ''}`.trim()
  })

  const fmtDate = d => d ? new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '---'
  const changes = {
    'Programa anterior': { old: `${old.old_program_name || '---'} - ${old.old_edition_code || '---'} (${fmtDate(old.old_start_date)})`, new: '---' },
    'Programa nuevo': { old: '---', new: `${newEd.new_program_name || '---'} - ${newEd.global_code || '---'} (${fmtDate(newEd.start_date)})` },
    'Nuevo enrollment': { old: '---', new: `#${newEid || '---'}` }
  }
  if (retiredChildren.length > 0) {
    changes['Modulos retirados'] = { old: '---', new: retiredChildren.join(', ') }
  }

  await repo.logAudit({
    enrollmentId,
    action: 'course_changed',
    userId,
    justificacion,
    changes,
    details: `Cambio de curso: ${old.old_program_name} ${old.old_edition_code} → ${newEd.new_program_name} ${newEd.global_code}`
  })

  if (newEid) {
    await repo.logAudit({
      enrollmentId: newEid,
      action: 'created_from_cc',
      userId,
      justificacion,
      changes: {
        'Programa origen': { old: '---', new: `${old.old_program_name || '---'} - ${old.old_edition_code || '---'} (${fmtDate(old.old_start_date)})` },
        'Programa destino': { old: '---', new: `${newEd.new_program_name || '---'} - ${newEd.global_code || '---'} (${fmtDate(newEd.start_date)})` },
        'Enrollment origen': { old: '---', new: `#${enrollmentId}` }
      },
      details: `Cambio de curso: ${old.old_program_name} ${old.old_edition_code} → ${newEd.new_program_name} ${newEd.global_code}`
    })
  }

  if (newEid) {
    await repo.unenrollFromOldOdoo({ enrollmentId, old })
    if (old.old_odoo_activation) {
      await repo.logAudit({ enrollmentId, action: 'odoo_unenrolled', userId, details: `Desinscrito de Odoo: ${old.old_odoo_activation}` })
    }

    const odoo = await safeAsync('[courseChange][Odoo] enroll new', () => repo.enrollInOdoo({ enrollmentId: newEid }))
    if (odoo?.success) {
      await repo.logAudit({ enrollmentId: newEid, action: 'odoo_enrolled', userId, details: `Inscrito en Odoo: user ${odoo.odoo_user_id}` })
    }

    const emailRes = await safeAsync('[courseChange][Email] send confirmation', () => repo.sendConfirmationEmail({ enrollmentId: newEid }))
    if (emailRes?.success) {
      await repo.logAudit({ enrollmentId: newEid, action: 'email_sent', userId, details: `Correo confirmacion CC: ${emailRes.messageId}` })
    }
  }

  return { result: 1, message: 'Cambio de curso realizado', new_enrollment_id: newEid }
}

// --- Snapshot / observar / reenviar -------------------------------------

export async function getEnrollmentSnapshot (enrollmentId) {
  return repo.getEnrollmentSnapshot(enrollmentId)
}

export async function rejectEnrollment ({ enrollmentId, reason, clearCcRequirement = false, userId }) {
  const data = await repo.getRejectTarget(enrollmentId)
  if (!data) throw new DomainError('Inscripcion no encontrada')

  await repo.setObservedStatus(enrollmentId)

  // El flag de copia requerida bloquea el envio del correo. Solo se puede bajar
  // aca: observar devuelve la venta al asesor, o sea que alguien queda enterado
  // de que la copia que pidio ya no se va a mandar. Queda en la auditoria.
  if (clearCcRequirement) {
    await repo.clearEmailCcRequirement(enrollmentId)
    await repo.logAudit({
      enrollmentId,
      action: 'observed',
      userId,
      justificacion: reason,
      details: 'Requerimiento de correo en copia retirado por FICO'
    })
  }
  const snapshot = await repo.getEnrollmentSnapshot(enrollmentId)

  await repo.logAudit({
    enrollmentId,
    action: 'observed',
    userId,
    justificacion: reason,
    changes: snapshot ? { _snapshot_before: snapshot } : null,
    details: `Inscripcion observada: ${data.program_name || ''}`
  })

  if (data.seller_agent_id) {
    try {
      await repo.notifyAdvisorObserved({
        sellerAgentId: data.seller_agent_id,
        leadId: data.lead_id,
        studentName: data.student_name,
        programName: data.program_name,
        reason
      })
    } catch (notifErr) {
      console.error('[rejectEnrollment] Error creando notificacion:', notifErr.message)
    }
  }

  try {
    const ficoAlias = await repo.getUserAlias(userId)
    const edDate = data.edition_start_date ? new Date(data.edition_start_date).toLocaleDateString('es-PE') : ''
    await repo.notifyEnrollmentObserved({
      studentName: data.student_name,
      programName: data.program_name,
      editionCode: data.edition_code,
      editionDate: edDate,
      advisorName: data.advisor_alias,
      reason,
      rejectedByName: ficoAlias || `Usuario ${userId}`
    })
  } catch (slackErr) {
    console.error('[rejectEnrollment] Slack:', slackErr.message)
  }

  repo.refreshMv('on-observe')
  return { result: 1, message: 'Inscripcion observada correctamente' }
}

export async function resubmitEnrollment ({ enrollmentId, userId }) {
  const obsCatId = await repo.resolveCatalogId(ALIAS.ENROLLMENT_STATUS_OBSERVED)
  if (!obsCatId) throw new DomainError('Catalogo de estado Observado no encontrado')

  const chk = await repo.getResubmitState(enrollmentId)
  if (!chk) throw new DomainError('Inscripcion no encontrada')
  if (chk.cat_fico_status !== obsCatId) throw new DomainError('La inscripcion no esta en estado Observado')

  const snapshotAfter = await repo.getEnrollmentSnapshot(enrollmentId)
  const prevSnapshot = await repo.getLastObservedAudit(enrollmentId)

  let diffChanges = {}
  if (prevSnapshot && snapshotAfter) {
    const before = typeof prevSnapshot === 'string' ? JSON.parse(prevSnapshot) : prevSnapshot
    const beforeData = before._snapshot_before || before
    for (const key of Object.keys(snapshotAfter)) {
      const oldVal = String(beforeData[key] || '---')
      const newVal = String(snapshotAfter[key] || '---')
      if (oldVal !== newVal) diffChanges[key] = { old: oldVal, new: newVal }
    }
  }
  const hasDiff = Object.keys(diffChanges).length > 0

  await repo.clearFicoStatus(enrollmentId)

  const allChanges = {}
  if (snapshotAfter && prevSnapshot) {
    const before = typeof prevSnapshot === 'string' ? JSON.parse(prevSnapshot) : prevSnapshot
    const beforeData = before._snapshot_before || before
    for (const key of Object.keys(snapshotAfter)) {
      allChanges[key] = { old: String(beforeData[key] || '---'), new: String(snapshotAfter[key] || '---') }
    }
  }

  await repo.logAudit({
    enrollmentId,
    action: 'resubmitted',
    userId,
    changes: Object.keys(allChanges).length ? allChanges : null,
    details: hasDiff ? `Reenviado con ${Object.keys(diffChanges).length} campo(s) modificado(s)` : 'Inscripcion reenviada a FICO para revision'
  })

  try {
    const ed = await repo.getResubmitNotice(enrollmentId, userId)
    if (ed) {
      const edDate = ed.edition_start_date ? new Date(ed.edition_start_date).toLocaleDateString('es-PE') : ''
      await repo.notifyEnrollmentResubmitted({
        studentName: ed.student_name,
        programName: ed.program_name,
        editionCode: ed.edition_code,
        editionDate: edDate,
        advisorName: ed.advisor_alias
      })
    }
  } catch (slackErr) {
    console.error('[resubmitEnrollment] Slack:', slackErr.message)
  }

  repo.refreshMv('on-resubmit')
  return { result: 1, message: 'Inscripcion reenviada correctamente' }
}

// --- Modalidad / asesor --------------------------------------------------

export async function changeModality ({ enrollmentId, newModalityId, justificacion, userId }) {
  const old = await repo.getModalityOrigin(enrollmentId)
  if (!old) throw new DomainError('Inscripcion no encontrada')
  assertModalityChangeNeeded({
    currentModalityId: old.cat_inscription_modality,
    newModalityId,
    childrenCount: old.children_count,
    childrenInModality: old.children_in_modality
  })

  const newDesc = await repo.getCatalogDescription(newModalityId)
  const updated = await repo.setModalityWithChildren(enrollmentId, newModalityId)
  const childrenUpdated = Math.max(updated - 1, 0)

  const changes = { 'Modalidad': { old: old.old_modality || '---', new: newDesc || '---' } }
  const childrenNote = childrenUpdated ? ` (+${childrenUpdated} curso(s) del paquete)` : ''
  await repo.logAudit({
    enrollmentId,
    action: 'modality_changed',
    userId,
    justificacion,
    changes,
    details: `Cambio de modalidad: ${changes['Modalidad'].old} → ${changes['Modalidad'].new}${childrenNote}`
  })

  repo.refreshMv('on-modality-change')
  return { result: 1, message: `Modalidad actualizada correctamente${childrenNote}` }
}

export async function editSellerAgent ({ enrollmentId, newSellerAgentId, newAgentOrigin, justificacion, userId }) {
  const old = await repo.getSellerAgentOrigin(enrollmentId)
  if (!old) throw new DomainError('Inscripcion no encontrada')
  assertChecked(old.fico_status_alias)

  const { newAgentId, newOrigin, isSinAsesor } = resolveSellerAgentChange({
    oldAgentId: old.old_agent_id,
    oldOrigin: old.old_origin,
    newSellerAgentId,
    newAgentOrigin
  })

  let newAlias = null
  if (!isSinAsesor) {
    newAlias = await repo.getUserAlias(newAgentId)
    if (!newAlias) throw new DomainError('Asesor seleccionado no existe')
  }

  await repo.setSellerAgent(enrollmentId, newAgentId, newOrigin)
  invalidateAdvisorsCache()

  const changes = {
    'Asesor': {
      old: fmtAgent(old.old_alias, old.old_origin),
      new: fmtAgent(newAlias, newOrigin)
    }
  }
  await repo.logAudit({
    enrollmentId,
    action: 'seller_agent_changed',
    userId,
    justificacion,
    changes,
    details: `Asesor: ${changes['Asesor'].old} → ${changes['Asesor'].new}`
  })

  return { result: 1, message: 'Asesor actualizado correctamente' }
}

// --- Retiro / eliminacion -----------------------------------------------

export async function retireEnrollment ({ enrollmentId, reason, hasRefund, refundAmount, justificacion, userId }) {
  const target = await repo.getRetireTarget(enrollmentId)
  if (!target) throw new DomainError('Inscripcion no encontrada')

  const retId = await repo.resolveCatalogId(ALIAS.ENROLLMENT_STATUS_RETIRED)
  if (!retId) throw new DomainError('Catalogo de estado Retirado no encontrado')

  const cancelledInstallments = await repo.retireParent(enrollmentId, retId)
  const childEnrollments = await repo.getActiveChildren(enrollmentId, retId)

  const retiredChildren = []
  for (const child of childEnrollments) {
    await repo.retireChild(child.enrollment_id, retId)
    await repo.logAudit({
      enrollmentId: child.enrollment_id,
      action: 'retired',
      userId,
      justificacion: reason,
      details: `Retirado por retiro del programa padre #${enrollmentId} (${target.program_name || ''} ${target.edition_code || ''})`
    })
    retiredChildren.push(`${child.child_program_name || ''} ${child.edition_code || ''} - ${child.start_date_fmt || '---'}`.trim())
  }

  const changes = {
    'Motivo': { old: '---', new: reason || '---' },
    'Devolucion': { old: '---', new: hasRefund ? `Si - S/. ${Number(refundAmount || 0).toFixed(2)}` : 'No' }
  }
  if (cancelledInstallments.length > 0) {
    changes['Cuotas eliminadas'] = { old: '---', new: `${cancelledInstallments.length} cuota(s) pendiente(s)` }
  }
  if (retiredChildren.length > 0) {
    changes['Modulos retirados'] = { old: '---', new: retiredChildren.join(', ') }
  }

  await repo.logAudit({
    enrollmentId,
    action: 'retired',
    userId,
    justificacion: justificacion || reason,
    changes,
    details: `Alumno retirado: ${target.program_name || ''} ${target.edition_code || ''}. ${hasRefund ? `Devolucion: S/. ${Number(refundAmount || 0).toFixed(2)}` : 'Sin devolucion'}${cancelledInstallments.length ? `. ${cancelledInstallments.length} cuota(s) pendiente(s) eliminada(s)` : ''}${retiredChildren.length ? `. ${retiredChildren.length} modulo(s) hijo(s) retirado(s)` : ''}`
  })

  await repo.unenrollOdooOnRetire({ enrollmentId, userId })

  repo.notifyStudentRetirement({
    studentName: target.student_name || '---',
    studentPhone: target.student_phone || '---',
    programName: target.program_name,
    editionCode: target.edition_code,
    reason,
    retiredChildren
  })

  repo.refreshMv('on-retire')
  return { result: 1, message: 'Alumno retirado correctamente' }
}

export async function deleteEnrollment ({ enrollmentId, userId }) {
  return repo.deleteEnrollmentCascade({ enrollmentId, userId })
}

// --- Flags / edicion de alumno ------------------------------------------

export async function getEnrollmentFlags ({ enrollmentId }) {
  return repo.getEnrollmentFlags(enrollmentId)
}

export async function editStudent ({ enrollmentId, firstName, lastName, documentNumber, originEmail, originPhone, odooEmail, newProfileId, justificacion, userId }) {
  const current = await repo.getEditStudentCurrent(enrollmentId)
  if (!current) throw new DomainError('Inscripcion no encontrada')

  const changes = {}
  if (firstName !== undefined && firstName !== current.first_name) changes['Nombre'] = { old: current.first_name || '---', new: firstName }
  if (lastName !== undefined && lastName !== current.last_name) changes['Apellido'] = { old: current.last_name || '---', new: lastName }
  if (documentNumber !== undefined && documentNumber !== current.document_number) changes['Documento'] = { old: current.document_number || '---', new: documentNumber }
  if (originEmail !== undefined && originEmail !== current.origin_email) changes['Email'] = { old: current.origin_email || '---', new: originEmail }
  if (originPhone !== undefined && originPhone !== current.origin_phone) changes['Telefono'] = { old: current.origin_phone || '---', new: originPhone }
  if (odooEmail !== undefined && odooEmail !== (current.odoo_email || '')) changes['Correo Odoo'] = { old: current.odoo_email || '---', new: odooEmail }
  if (newProfileId !== undefined && newProfileId !== current.cat_profile_id) {
    const newProf = await repo.getCatalogDescription(newProfileId)
    changes['Perfil'] = { old: current.profile_desc || '---', new: newProf || '---' }
  }

  if (Object.keys(changes).length === 0) throw new DomainError('No se detectaron cambios')

  if (changes['Nombre'] || changes['Apellido'] || changes['Documento']) {
    const updFields = []
    const updValues = []
    let idx = 1
    if (changes['Nombre']) { updFields.push(`first_name = $${idx++}`); updValues.push(firstName) }
    if (changes['Apellido']) { updFields.push(`last_name = $${idx++}`); updValues.push(lastName) }
    if (changes['Documento']) { updFields.push(`document_number = $${idx++}`); updValues.push(documentNumber) }
    updValues.push(current.person_id)
    await repo.updatePerson(current.person_id, updFields, updValues)
  }

  if (changes['Email'] || changes['Telefono']) {
    if (current.lead_id) {
      const updFields = []
      const updValues = []
      let idx = 1
      if (changes['Email']) { updFields.push(`origin_email = $${idx++}`); updValues.push(originEmail) }
      if (changes['Telefono']) { updFields.push(`origin_phone = $${idx++}`); updValues.push(originPhone) }
      updValues.push(current.lead_id)
      await repo.updateLeadContact(current.lead_id, updFields, updValues)
    }
    // person_contacts es la fuente de aulas/cronograma: mantener en espejo
    // aunque el contacto "oficial" viva en el lead.
    if (changes['Email']) await repo.updatePersonContactEmail(current.person_id, originEmail)
    if (changes['Telefono']) await repo.updatePersonContactPhone(current.person_id, originPhone)
  }

  if (changes['Perfil'] || changes['Correo Odoo']) {
    const eUpdFields = []
    const eUpdValues = []
    let eIdx = 1
    if (changes['Perfil']) { eUpdFields.push(`cat_profile_id = $${eIdx++}`); eUpdValues.push(newProfileId) }
    if (changes['Correo Odoo']) { eUpdFields.push(`odoo_email = $${eIdx++}`); eUpdValues.push(odooEmail) }
    eUpdValues.push(enrollmentId)
    await repo.updateEnrollmentStudentFields(enrollmentId, eUpdFields, eUpdValues)
  }

  const needsOdooSync = current.odoo_user_id && (
    changes['Nombre'] || changes['Apellido'] || changes['Documento'] ||
    changes['Telefono'] || changes['Correo Odoo']
  )
  if (needsOdooSync) {
    const finalFirst = changes['Nombre'] ? firstName : current.first_name
    const finalLast = changes['Apellido'] ? lastName : current.last_name
    // names/surnames: campos partidos del partner que lee Certificacion.
    // El name completo va en la misma convencion que el alta: "APELLIDOS NOMBRES".
    const { names, surnames } = buildOdooNameParts({
      firstName: finalFirst,
      lastName: finalLast,
      motherLastName: current.mother_last_name
    })
    const fullName = `${surnames} ${names}`.trim()
    await repo.syncStudentToOdoo(current.odoo_user_id, {
      name: fullName || undefined,
      login: changes['Correo Odoo'] ? odooEmail : undefined,
      phone: changes['Telefono'] ? originPhone : undefined,
      vat: changes['Documento'] ? documentNumber : undefined,
      names,
      surnames
    })
  }

  const details = Object.entries(changes).map(([k, v]) => `${k}: ${v.old} → ${v.new}`).join(', ')
  await repo.logAudit({ enrollmentId, action: 'student_edited', userId, justificacion, changes, details })

  return { result: 1, message: 'Datos del alumno actualizados' }
}

// --- enrollmentUpdate (datos de pago + cuotas) ---------------------------

export async function enrollmentUpdate ({ enrollmentId, fields, justificacion, userId }) {
  const changes = {}

  const oldE = await repo.getEnrollmentCurrency(enrollmentId)
  const oldP = await repo.getInitialPayment(enrollmentId)

  // 'notes' NO se acepta aqui: el modal de edicion no lo edita, solo lo re-enviaba
  // (siempre null porque sp_fico_payment_detail_get no lo devuelve) y borraba el
  // marcador 'Importacion masiva FICO' del que depende EXCLUDE_IMPORTED en el
  // sync a Google Sheets (las importaciones aparecian como ventas).
  const enrollmentFields = ['cat_currency']
  const eSets = []
  const eParams = []
  let eIdx = 1
  for (const key of enrollmentFields) {
    if (fields[key] !== undefined) {
      eSets.push(`${key} = $${eIdx}`)
      eParams.push(fields[key])
      eIdx++
    }
  }
  if (eSets.length > 0) {
    eParams.push(enrollmentId)
    await repo.updateEnrollmentFields(enrollmentId, eSets, eParams)
  }

  const paymentFields = { cat_payment_medium: 'cat_method_payment', transaction_code: 'transaction_code', bank_account_id: 'settled_in_account_id', payment_date: 'payment_date' }
  const pSets = []
  const pParams = []
  let pIdx = 1
  for (const [formKey, dbKey] of Object.entries(paymentFields)) {
    if (fields[formKey] !== undefined) {
      const cast = dbKey === 'payment_date' ? '::date' : ''
      pSets.push(`${dbKey} = $${pIdx}${cast}`)
      pParams.push(formKey === 'payment_date' ? (fields[formKey] || null) : fields[formKey])
      pIdx++
    }
  }
  if (pSets.length > 0) {
    if (oldP.payment_id) {
      pParams.push(oldP.payment_id)
      await repo.updatePaymentById(oldP.payment_id, pSets, pParams)
    } else {
      await repo.insertPrePaymentPlaceholder({ enrollmentId, fields, userId })
    }
  }

  if (fields.cat_currency !== undefined && fields.cat_currency !== oldE.cat_currency) {
    const oldLabel = await repo.resolveLabel(oldE.cat_currency)
    const newLabel = await repo.resolveLabel(fields.cat_currency)
    changes['Tipo Moneda'] = { old: oldLabel || '---', new: newLabel || '---' }
  }
  if (fields.cat_payment_medium !== undefined && fields.cat_payment_medium !== oldP.cat_method_payment) {
    const oldLabel = await repo.resolveLabel(oldP.cat_method_payment)
    const newLabel = await repo.resolveLabel(fields.cat_payment_medium)
    changes['Medio de Pago'] = { old: oldLabel || '---', new: newLabel || '---' }
  }
  if (fields.bank_account_id !== undefined && fields.bank_account_id !== oldP.settled_in_account_id) {
    const oldLabel = await repo.resolveBankLabel(oldP.settled_in_account_id)
    const newLabel = await repo.resolveBankLabel(fields.bank_account_id)
    changes['Cuenta Bancaria'] = { old: oldLabel || '---', new: newLabel || '---' }

    const oldEntity = await repo.resolveBusinessEntityFromAccount(oldP.settled_in_account_id)
    const newEntity = await repo.resolveBusinessEntityFromAccount(fields.bank_account_id)
    if (oldEntity !== newEntity) {
      changes['Entidad Empresa'] = { old: oldEntity || '---', new: newEntity || '---' }
    }
  }
  if (fields.transaction_code !== undefined && fields.transaction_code !== (oldP.transaction_code || '')) {
    changes['N. Operacion'] = { old: oldP.transaction_code || '---', new: fields.transaction_code || '---' }
  }
  if (fields.payment_date !== undefined) {
    const oldDateIso = oldP.payment_date ? new Date(oldP.payment_date).toISOString().slice(0, 10) : ''
    const newDateIso = fields.payment_date ? String(fields.payment_date).slice(0, 10) : ''
    if (oldDateIso !== newDateIso) {
      const fmt = iso => iso ? iso.split('-').reverse().join('/') : '---'
      changes['Fecha de Pago'] = { old: fmt(oldDateIso), new: fmt(newDateIso) }
    }
    // Siempre, no solo cuando hay diff vs el pago: leads.pay_date puede haber
    // quedado desalineado (ediciones previas) y es lo que manda en el F.PAGO
    // de las hojas; re-guardar debe re-alinearlo.
    if (newDateIso) await repo.syncLeadPayDate(enrollmentId, newDateIso, userId)
  }

  if (fields.installments && Array.isArray(fields.installments)) {
    for (const inst of fields.installments) {
      if (inst.installment_id) {
        await repo.updatePendingInstallment({ amount: inst.amount, dueDate: inst.due_date, installmentId: inst.installment_id, enrollmentId })
      }
    }
    changes['Cuotas'] = { updated: fields.installments.length }
    // Editar una cuota cambia el precio real de la venta: la cabecera tiene que
    // seguirla o el saldo y el listado quedan con el total viejo de FICO.
    const totalRecalc = await repo.recalcTotalsFromInstallments(enrollmentId)
    if (totalRecalc) {
      changes['Total Recalculado'] = { old: `S/. ${totalRecalc.old}`, new: `S/. ${totalRecalc.new}` }
    }
  }

  if (fields.paid_installments && Array.isArray(fields.paid_installments) && fields.paid_installments.length > 0) {
    const { totalRecalc } = await repo.applyPaidInstallmentEdits({ enrollmentId, paidInstallments: fields.paid_installments })
    if (totalRecalc) changes['Total Recalculado'] = totalRecalc

    for (const row of fields.paid_installments) {
      const lines = []
      const { before, after, installment_number } = row
      if (Number(after.amount) !== Number(before.amount)) lines.push(`monto S/. ${before.amount} → S/. ${after.amount}`)
      if ((after.due_date || null) !== (before.due_date || null)) {
        const fmtD = d => d ? d.split('-').reverse().join('/') : '---'
        lines.push(`vencimiento ${fmtD(before.due_date)} → ${fmtD(after.due_date)}`)
      }
      if ((after.cat_currency || null) !== (before.cat_currency || null)) {
        const o = await repo.resolveLabel(before.cat_currency); const n = await repo.resolveLabel(after.cat_currency)
        lines.push(`moneda ${o || '---'} → ${n || '---'}`)
      }
      if ((after.cat_payment_medium || null) !== (before.cat_payment_medium || null)) {
        const o = await repo.resolveLabel(before.cat_payment_medium); const n = await repo.resolveLabel(after.cat_payment_medium)
        lines.push(`medio ${o || '---'} → ${n || '---'}`)
      }
      if ((after.bank_account_id || null) !== (before.bank_account_id || null)) {
        const o = await repo.resolveBankLabel(before.bank_account_id); const n = await repo.resolveBankLabel(after.bank_account_id)
        lines.push(`cuenta ${o || '---'} → ${n || '---'}`)
      }
      if ((after.transaction_code || '') !== (before.transaction_code || '')) {
        lines.push(`n.op ${before.transaction_code || '---'} → ${after.transaction_code || '---'}`)
      }
      const beforePay = before.payment_date ? String(before.payment_date).slice(0, 10) : ''
      const afterPay = after.payment_date ? String(after.payment_date).slice(0, 10) : ''
      if (afterPay !== beforePay) {
        const fmtD = d => d ? d.split('-').reverse().join('/') : '---'
        lines.push(`fecha pago ${fmtD(beforePay)} → ${fmtD(afterPay)}`)
      }
      if (lines.length) changes[`Cuota #${installment_number}`] = { old: '(pagada)', new: lines.join(', ') }
    }
  }

  const detailLines = Object.entries(changes)
    .filter(([, v]) => v.old !== undefined && v.new !== undefined)
    .map(([k, v]) => `${k}: ${v.old} → ${v.new}`)
  const details = detailLines.length > 0 ? detailLines.join(' | ') : 'Sin cambios detectados'

  await repo.logAudit({ enrollmentId, action: 'edited', userId, justificacion, changes, details })

  return { result: 1, message: 'Inscripcion actualizada' }
}

// --- Aprobacion A5 (pending review) -------------------------------------

// Resuelve membresia + activacion diferida (mismas reglas que el legacy
// _resolveMembershipActivation): probe de membresia, validacion de formato y
// ventana, calculo de runAt en TZ Lima.
async function resolveMembershipActivation ({ enrollmentId, activationDate }) {
  if (!enrollmentId) return { isMembership: false }
  const row = await repo.probeMembership(enrollmentId)
  if (!row || !isMembership(row.abbreviation, row.is_membership)) {
    return { isMembership: false }
  }
  const raw = activationDate
  if (!raw) return { isMembership: true, deferred: false, activationDate: null }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw).trim())) {
    return { error: 'activation_date debe ser YYYY-MM-DD' }
  }
  const c = await repo.resolveActivationWindow(raw)
  if (!c) return { error: 'activation_date no se pudo parsear' }
  if (c.out_of_window) return { error: `activation_date excede la ventana permitida (${MEMBERSHIP_ACTIVATION_WINDOW_MONTHS} meses)` }
  if (c.is_today_or_past) {
    return { isMembership: true, deferred: false, activationDate: c.activation_date }
  }
  return { isMembership: true, deferred: true, activationDate: c.activation_date, runAt: c.run_at }
}

export async function approvePendingReview ({ enrollmentId, userId, activationDate = null }) {
  const activation = await resolveMembershipActivation({ enrollmentId, activationDate })
  if (activation.error) return { result: 0, message: activation.error }

  const summary = await repo.approvePendingReviewSp({ enrollmentId, userId })
  if (!summary || summary.result !== 1) {
    return summary || { result: 0, message: 'Sin respuesta del SP' }
  }

  if (activation.isMembership && activation.activationDate) {
    await repo.persistMembershipActivationDate(enrollmentId, activation.activationDate)
  }

  if (summary.is_parent) {
    await safeAsync('[A5Approve][Children] create', () => repo.createChildEnrollments({ enrollmentId, userId }))
  }

  if (activation.isMembership && activation.deferred) {
    try {
      const job = await repo.enqueueMembershipActivation({ enrollmentId, runAt: activation.runAt })
      summary.membership_deferred = true
      summary.activation_date = activation.activationDate
      summary.scheduled_job_id = job.job_id
      await repo.logAudit({
        enrollmentId,
        action: 'membership_activation_scheduled',
        userId,
        details: `Activacion programada para ${activation.activationDate} 09:00 (job=${job.job_id}, post-A5)`
      })
    } catch (qErr) {
      console.error('[approvePendingReview] No se pudo encolar membership_activation:', qErr.message)
    }
    return summary
  }

  const odooActivation = await repo.getProgramOdooActivation(enrollmentId)
  if (odooActivation) {
    await safeAsync('[A5Approve][Odoo] enroll new', async () => {
      const res = await repo.enrollInOdoo({ enrollmentId })
      if (res?.success) {
        await repo.logAudit({ enrollmentId, action: 'odoo_enrolled', userId, details: `Inscrito en Odoo por aprobacion de migracion A5` })
      } else {
        await repo.logAudit({ enrollmentId, action: 'odoo_enrolled', userId, details: `Pendiente inscripcion Odoo: ${res?.error || 'desconocido'}` })
      }
    })
  }

  await safeAsync('[A5Approve][Email] send', async () => {
    const res = await repo.sendConfirmationEmail({ enrollmentId })
    if (!res?.success) {
      await repo.logAudit({ enrollmentId, action: 'email_sent', userId, details: `Error enviando correo: ${res?.error || 'desconocido'}` })
    }
  })

  return summary
}
