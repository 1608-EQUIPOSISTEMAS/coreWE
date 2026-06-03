import { ALIAS } from '../../../utils/catalog-aliases.js'
import { getCatalogIdByAlias } from '../../../utils/catalog-helper.js'
import { safeAsync } from '../../../shared/utils/safe-async.js'
import { parseEmailCc } from '../../../utils/email-cc.js'
import {
  MEMBERSHIP_DURATION_MONTHS,
  formatCalendarDate,
  addMonthsCalendar,
  isMembership
} from '../../../utils/fico-formatters.js'
import { getEnrollmentOdoo } from '../../../utils/fico-queries.sql.js'
import { email } from '../../../shared/adapters/email/email.adapter.js'
import { buildConfirmacionHTML } from '../../../templates/confirmacion-inscripcion.js'
import { buildConfirmacionOnlineHTML } from '../../../templates/confirmacion-online.js'
import { buildConfirmacionPagoHTML } from '../../../templates/confirmacion-pago.js'
import { buildMembresiaHTML, detectMembershipType } from '../../../templates/bienvenida-membresia.js'
import { generateCronogramaPdf } from '../../../services/pdf.service.js'
import { emailConfirmationRepository } from './email-confirmation.repository.js'
import {
  MEMBERSHIP_DEFAULT_PASSWORD,
  firstWord,
  synthesizeOdooEmail,
  resolveConfirmationEmailMode,
  resolveProgramTypeLabel,
  resolvePaymentProgress,
  buildInstallmentsTableHTML,
  resolvePreviewActivationStart,
  resolveSendActivationStart,
  safeAttachmentName,
  isSinglePayment
} from './email-confirmation.entity.js'

// Orquestacion de los 3 correos transaccionales FICO (confirmacion curso/online,
// confirmacion de cuota, bienvenida membresia). No contiene SQL (delega en el
// repository) ni reglas puras (delega en la entity). Los efectos externos
// (Odoo, email, PDF) entran por `deps` inyectable para poder mockearlos en tests
// sin tocar red ni BD; por defecto apuntan a los modulos legacy, exactamente
// como los disparaba fico.service.js (sincrono, en linea).

const repo = emailConfirmationRepository

// Efectos externos. enrollInOdoo / enrollMembershipInOdoo viven en el subdominio
// de inscripcion en Odoo; el orquestador los inyecta para evitar un ciclo de
// import entre subdominios. Hasta entonces lanzan un error explicito si se usan.
const deps = {
  sendEmail: email.sendEmail,
  sendFicoEmail: email.sendFicoEmail,
  generateCronogramaPdf,
  getEnrollmentOdoo,
  enrollInOdoo: async () => { throw new Error('enrollInOdoo no inyectado en email-confirmation.usecases') },
  enrollMembershipInOdoo: async () => { throw new Error('enrollMembershipInOdoo no inyectado en email-confirmation.usecases') }
}

// Punto de inyeccion para el orquestador (cablear deps cruzados) y para tests.
export function configureEmailDeps (overrides = {}) {
  Object.assign(deps, overrides)
}

// ---------------------------------------------------------------------------
// PDF de cronograma para programas padre (no online). Si el PDF falla o sale
// vacio devuelve { error }; el caller DEBE abortar el envio para no entregar al
// alumno un correo de padre sin su cronograma adjunto.
async function buildCronogramaAttachment ({ enrollmentId, programName }) {
  let pdfBuffer
  try {
    pdfBuffer = await deps.generateCronogramaPdf({ enrollmentId })
  } catch (pdfErr) {
    console.error(`[sendConfirmationEmail] Error generando PDF cronograma para enrollment #${enrollmentId}:`, pdfErr.message, pdfErr.stack)
    return { error: `No se pudo generar el PDF de cronograma (${pdfErr.message}). El correo NO fue enviado para evitar entregar al alumno un correo de programa padre sin su cronograma adjunto.` }
  }
  if (!pdfBuffer || pdfBuffer.length === 0) {
    console.error(`[sendConfirmationEmail] PDF cronograma vacio para enrollment #${enrollmentId}`)
    return { error: 'El PDF de cronograma se genero vacio (0 bytes). El correo NO fue enviado.' }
  }
  const safeName = safeAttachmentName(programName)
  console.log(`[sendConfirmationEmail] PDF cronograma generado OK (${pdfBuffer.length} bytes) para enrollment #${enrollmentId}`)
  return {
    attachments: [{
      filename: `Cronograma-${safeName}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf'
    }]
  }
}

// Determina si el correo de confirmacion va como alumno nuevo o retornante.
async function resolveModeFromDb ({ enrollmentId, odooEmail }) {
  const isFirstSend = !(await repo.hasPriorSuccessfulSend(enrollmentId, 'confirmacion'))
  const hasPriorEnrollment = await repo.hasPriorOdooEnrollment(enrollmentId)
  return resolveConfirmationEmailMode({ isFirstSend, hasPriorEnrollment, odooEmail })
}

// ---------------------------------------------------------------------------
// PREVIEW

export async function previewConfirmationEmail ({ enrollmentId, overrideEditionId = null, activationDate = null }) {
  const check = await repo.findPreviewMembershipCheck(enrollmentId)
  if (check && isMembership(check.abbreviation, check.is_membership)) {
    return previewMembershipEmail({ enrollmentId, overrideEditionId, activationDate })
  }

  const editionId = overrideEditionId || null
  const data = await repo.findConfirmationDataForPreview(enrollmentId, editionId)
  if (!data) return { html: null, error: 'Inscripcion no encontrada' }

  const onlineModalityId = await getCatalogIdByAlias(ALIAS.MODALITY_ONLINE)
  const isOnline = data.cat_model_modality === onlineModalityId
  const sapCategoryId = await getCatalogIdByAlias(ALIAS.PROGRAM_CATEGORY_SAP)
  const isSapOnline = isOnline && sapCategoryId && data.cat_category === sapCategoryId

  let sapCredentials = null
  if (isSapOnline) {
    sapCredentials = await repo.findSapCredentialsForPreview(enrollmentId)
  }

  const sched = await repo.findScheduleForPreview(enrollmentId, editionId)
  const frequency = sched.map(s => s.day_name).filter(Boolean).join(', ')
  const schedule = sched.length > 0 ? `${sched[0].start_time || ''} - ${sched[0].end_time || ''}` : ''

  const instRows = await repo.findInstallments(enrollmentId)

  const firstName = firstWord(data.first_name)
  const lastName = firstWord(data.last_name)
  const odooEmail = data.odoo_email || synthesizeOdooEmail(firstName, lastName)

  // Mismo check que el envio real: si ya hubo un envio exitoso, el preview
  // muestra el bloque "cuenta activa, recupera password".
  const isNew = !(await repo.hasPriorSuccessfulSend(enrollmentId, 'confirmacion'))

  const isParentProgram = await repo.isParentProgram(enrollmentId)

  const htmlBody = isOnline
    ? buildConfirmacionOnlineHTML({
      studentName: `${firstName} ${lastName}`,
      programName: data.program_name,
      email: odooEmail,
      isNew,
      sapUser: sapCredentials?.sap_username || null,
      sapPassword: sapCredentials?.sap_password || null
    })
    : buildConfirmacionHTML({
      studentName: `${firstName} ${lastName}`,
      programName: data.program_name,
      startDate: data.start_date,
      frequency,
      schedule,
      whatsappLink: data.whatsapp_link || '',
      email: odooEmail,
      isNew,
      bannerUrl: data.banner_link || '',
      installments: isSinglePayment(data.payment_plan_alias) ? [] : instRows,
      currencySymbol: data.currency_symbol || 'S/.',
      hideWhatsapp: isParentProgram
    })

  return {
    html: htmlBody,
    to: data.origin_email || '---',
    subject: `Confirmacion de Inscripcion - ${data.program_name || 'WE Educacion'}`,
    hasAttachment: isParentProgram && !isOnline,
    attachmentName: (isParentProgram && !isOnline) ? `Cronograma-${(data.program_name || 'Programa').replace(/[^a-zA-Z0-9]+/g, '-')}.pdf` : null
  }
}

export async function previewMembershipEmail ({ enrollmentId, overrideEditionId = null, activationDate = null }) {
  const editionId = overrideEditionId || null
  const data = await repo.findMembershipDataForPreview(enrollmentId, editionId)
  if (!data) return { html: null, error: 'Inscripcion no encontrada' }

  const startDate = resolvePreviewActivationStart({
    activationDate,
    persistedDate: data.membership_activation_date,
    editionStartDate: data.start_date
  })
  const fechaAct = formatCalendarDate(startDate)
  const fechaRenov = formatCalendarDate(addMonthsCalendar(startDate, MEMBERSHIP_DURATION_MONTHS))

  const firstName = firstWord(data.first_name)
  const lastName = firstWord(data.last_name)
  const odooEmail = data.odoo_email || synthesizeOdooEmail(firstName, lastName)

  let installmentsHTML = ''
  if (!isSinglePayment(data.payment_plan_alias)) {
    const instRows = await repo.findInstallments(enrollmentId)
    installmentsHTML = buildInstallmentsTableHTML(instRows, data.currency_symbol || 'S/.')
  }

  const isFirstSend = !(await repo.hasPriorSuccessfulSend(enrollmentId, 'membresia'))

  const htmlBody = buildMembresiaHTML({
    studentName: [data.first_name, data.last_name, data.mother_last_name].filter(Boolean).join(' '),
    programName: data.program_name,
    email: odooEmail,
    password: MEMBERSHIP_DEFAULT_PASSWORD,
    isNew: isFirstSend,
    duracion: `${MEMBERSHIP_DURATION_MONTHS} meses`,
    fechaActivacion: fechaAct,
    fechaRenovacion: fechaRenov,
    installmentsHTML,
    bloqueBeneficios: undefined,
    fichaRegistroLink: undefined
  })

  const tipo = detectMembershipType(data.program_name)
  return {
    html: htmlBody,
    to: data.origin_email || '---',
    subject: `Bienvenido a tu Membresia ${tipo} - WE Educacion`,
    hasAttachment: false,
    attachmentName: null
  }
}

// ---------------------------------------------------------------------------
// ENVIO: confirmacion de inscripcion (curso / online / padre)

export async function sendConfirmationEmail ({ enrollmentId, cc }) {
  // Reintento manual: limpiar fallos previos para dejar la timeline limpia.
  await repo.clearPriorEmailFailures(enrollmentId)

  const check = await repo.findMembershipCheck(enrollmentId)
  if (check && isMembership(check.abbreviation, check.is_membership)) {
    return sendMembershipEmail({ enrollmentId })
  }

  // Sin odoo_user_id las credenciales del correo son ficticias: reintentar la
  // creacion en Odoo antes de mandar nada.
  if (check && !check.odoo_user_id) {
    console.log(`[sendConfirmationEmail] enrollment ${enrollmentId}: sin odoo_user_id, reintentando enrollInOdoo`)
    const odooRetry = await safeAsync('[sendConfirmationEmail][Odoo] retry', () => deps.enrollInOdoo({ enrollmentId }))
    if (odooRetry?.success) {
      const cursoLabel = odooRetry.course_search || 'Curso no especificado'
      await repo.logAudit({
        enrollmentId,
        action: 'odoo_enrolled',
        userId: null,
        details: `Odoo user ${odooRetry.odoo_user_id} - ${cursoLabel} (creado en reintento desde reenviar correo)`
      })
    } else {
      console.error(`[sendConfirmationEmail] enrollInOdoo retry no exitoso para ${enrollmentId}:`, odooRetry?.error || 'sin respuesta')
      return {
        success: false,
        error: `No se pudo crear el alumno en Odoo (${odooRetry?.error || 'fallo desconocido'}). El correo NO fue enviado para evitar credenciales falsas.`
      }
    }
  }

  const data = await repo.findConfirmationDataForSend(enrollmentId)
  if (!data) return { success: false, error: 'Inscripcion no encontrada' }

  const onlineModalityId = await getCatalogIdByAlias(ALIAS.MODALITY_ONLINE)
  const isOnline = data.cat_model_modality === onlineModalityId
  const sapCategoryId = await getCatalogIdByAlias(ALIAS.PROGRAM_CATEGORY_SAP)
  const isSapOnline = isOnline && sapCategoryId && data.cat_category === sapCategoryId

  let sapCredentials = null
  if (isSapOnline) {
    sapCredentials = await repo.assignSapCredentials(enrollmentId)
  }

  const toEmail = data.origin_email
  if (!toEmail) {
    await repo.logAudit({
      enrollmentId,
      action: 'email_failed',
      userId: null,
      details: 'Error al enviar correo: el alumno no tiene correo registrado'
    }).catch(() => {})
    return { success: false, error: 'El estudiante no tiene correo registrado' }
  }

  const sched = await repo.findScheduleForSend(enrollmentId)
  const frequency = sched.map(s => s.day_name).filter(Boolean).join(', ')
  const schedule = sched.length > 0 ? `${sched[0].start_time || ''} - ${sched[0].end_time || ''}` : ''

  const instRows = await repo.findInstallments(enrollmentId)

  const firstName = firstWord(data.first_name)
  const lastName = firstWord(data.last_name)

  const freshEnroll = await deps.getEnrollmentOdoo(enrollmentId)
  const odooEmail = freshEnroll?.odoo_email || data.odoo_email || synthesizeOdooEmail(firstName, lastName)

  const { isNew } = await resolveModeFromDb({ enrollmentId, odooEmail })

  const isParentProgram = await repo.isParentProgram(enrollmentId)

  // PDF de cronograma: solo programas padre no-online. Si el PDF falla, NO se
  // manda el correo (no shipear artefactos rotos en silencio).
  const attachments = []
  if (isParentProgram && !isOnline) {
    console.log(`[sendConfirmationEmail] Generando PDF cronograma para parent enrollment #${enrollmentId}`)
    const pdfResult = await buildCronogramaAttachment({ enrollmentId, programName: data.program_name })
    if (pdfResult.error) return { success: false, error: pdfResult.error }
    attachments.push(...pdfResult.attachments)
  }

  const htmlBody = isOnline
    ? buildConfirmacionOnlineHTML({
      studentName: `${firstName} ${lastName}`,
      programName: data.program_name,
      email: odooEmail,
      isNew,
      sapUser: sapCredentials?.sap_username || null,
      sapPassword: sapCredentials?.sap_password || null
    })
    : buildConfirmacionHTML({
      studentName: `${firstName} ${lastName}`,
      programName: data.program_name,
      startDate: data.start_date,
      frequency,
      schedule,
      whatsappLink: data.whatsapp_link || '',
      email: odooEmail,
      isNew,
      bannerUrl: data.banner_link || '',
      installments: isSinglePayment(data.payment_plan_alias) ? [] : instRows,
      currencySymbol: data.currency_symbol || 'S/.',
      hideWhatsapp: isParentProgram
    })

  // CC en cascada: parametro explicito (override) -> enrollments.email_cc.
  const ccResolved = parseEmailCc(cc != null ? cc : data.email_cc)
  const ccForTransport = ccResolved.length > 0 ? ccResolved : undefined

  const subject = `Confirmacion de Inscripcion - ${data.program_name || 'WE Educacion'}`
  const result = await deps.sendEmail({ to: toEmail, subject, htmlBody, attachments, cc: ccForTransport })

  try {
    await repo.insertEmailLog({
      enrollmentId,
      toEmail,
      subject,
      messageId: result.messageId,
      templateType: 'confirmacion',
      status: result.success ? 'sent' : 'failed'
    })
  } catch (logErr) {
    console.error('[EmailLog] Error registrando log:', logErr.message)
  }

  const ccDetail = ccResolved.length > 0 ? ` (cc: ${ccResolved.join(',')})` : ''
  if (result.success) {
    await repo.logAudit({ enrollmentId, action: 'email_sent', userId: null, details: `Correo confirmacion enviado a ${toEmail}${ccDetail}` })
  } else {
    await repo.logAudit({
      enrollmentId,
      action: 'email_failed',
      userId: null,
      details: `Error al enviar correo a ${toEmail}: ${result.error || 'desconocido'}`
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// ENVIO: confirmacion de cuota / pago completado

export async function sendPaymentConfirmationEmail ({ enrollmentId }) {
  const data = await repo.findPaymentConfirmationData(enrollmentId)
  if (!data) return { success: false, error: 'Inscripcion no encontrada' }

  const toEmail = data.origin_email
  if (!toEmail) return { success: false, error: 'El estudiante no tiene correo registrado' }

  const installments = await repo.findInstallmentsWithStatus(enrollmentId)
  const { isLastPayment, nextInstallment, lastPaid } = resolvePaymentProgress(installments)

  const htmlBody = buildConfirmacionPagoHTML({
    studentName: [data.first_name, data.last_name, data.mother_last_name].filter(Boolean).join(' '),
    programType: resolveProgramTypeLabel(data.category_description),
    isLastPayment,
    lastPaymentDate: lastPaid?.due_date || new Date().toISOString(),
    nextPaymentDate: nextInstallment?.due_date || null,
    nextPaymentAmount: nextInstallment?.amount || 0,
    currencySymbol: data.currency_symbol || 'S/.'
  })

  const subject = isLastPayment
    ? `Pago Completado - ${data.program_name || 'WE Educacion'}`
    : `Confirmacion de Cuota - ${data.program_name || 'WE Educacion'}`

  const result = await deps.sendFicoEmail({ to: toEmail, subject, htmlBody })

  try {
    await repo.insertEmailLog({
      enrollmentId,
      toEmail,
      subject,
      messageId: result.messageId,
      templateType: 'confirmacion_pago',
      status: result.success ? 'sent' : 'failed'
    })
  } catch (logErr) {
    console.error('[EmailLog] Error registrando log:', logErr.message)
  }

  return result
}

// ---------------------------------------------------------------------------
// ENVIO: bienvenida membresia

export async function sendMembershipEmail ({ enrollmentId }) {
  try {
    return await sendMembershipEmailInner({ enrollmentId })
  } catch (err) {
    console.error('[sendMembershipEmail] Throw inesperado:', err.message, err.stack)
    return { success: false, error: `sendMembershipEmail: ${err.message}` }
  }
}

async function sendMembershipEmailInner ({ enrollmentId }) {
  let data = await repo.findMembershipDataForSend(enrollmentId)
  if (!data) return { success: false, error: 'Inscripcion no encontrada' }

  // Activacion futura: el correo no sale hoy; el job en cola lo mandara al
  // llegar la fecha. success=true para no romper reintentos manuales en la UI.
  if (data.membership_activation_date) {
    const deferred = await repo.isMembershipActivationDeferred(data.membership_activation_date)
    if (deferred) {
      return {
        success: true,
        deferred: true,
        scheduled_for: data.membership_activation_date,
        message: 'Correo diferido — el job en cola lo enviara al llegar la fecha de activacion'
      }
    }
  }

  const toEmail = data.origin_email
  if (!toEmail) return { success: false, error: 'Sin correo registrado' }

  // Sin odoo_user_id: crear usuario + inscribir en cursos online antes de
  // mandar credenciales reales.
  if (!data.odoo_user_id) {
    console.log(`[sendMembershipEmail] enrollment ${enrollmentId}: sin odoo_user_id, ejecutando enrollMembershipInOdoo`)
    const odooRes = await deps.enrollMembershipInOdoo({ enrollmentId })
    if (!odooRes?.success) {
      const errMsg = odooRes?.error || 'fallo desconocido al crear usuario en Odoo'
      console.error(`[sendMembershipEmail] No se pudo crear user en Odoo para enrollment ${enrollmentId}: ${errMsg}`)
      return {
        success: false,
        error: `No se creo usuario en Odoo (${errMsg}). El correo NO fue enviado para evitar entregar credenciales falsas.`
      }
    }
    data = (await repo.findMembershipDataForSend(enrollmentId)) || data
  }

  if (!data.odoo_email) {
    return {
      success: false,
      error: 'No se pudo determinar odoo_email tras la inscripcion. Email no enviado.'
    }
  }

  const startDate = resolveSendActivationStart({
    persistedDate: data.membership_activation_date,
    editionStartDate: data.start_date
  })
  const fechaAct = formatCalendarDate(startDate)
  const fechaRenov = formatCalendarDate(addMonthsCalendar(startDate, MEMBERSHIP_DURATION_MONTHS))

  let installmentsHTML = ''
  if (!isSinglePayment(data.payment_plan_alias)) {
    const instRows = await repo.findInstallments(enrollmentId)
    installmentsHTML = buildInstallmentsTableHTML(instRows, data.currency_symbol || 'S/.')
  }

  // Primer envio: credenciales. Reenvio: solo usuario + recuperacion de password.
  const isFirstSend = !(await repo.hasPriorSuccessfulSend(enrollmentId, 'membresia'))

  const htmlBody = buildMembresiaHTML({
    studentName: [data.first_name, data.last_name, data.mother_last_name].filter(Boolean).join(' '),
    programName: data.program_name,
    email: data.odoo_email,
    password: MEMBERSHIP_DEFAULT_PASSWORD,
    isNew: isFirstSend,
    duracion: `${MEMBERSHIP_DURATION_MONTHS} meses`,
    fechaActivacion: fechaAct,
    fechaRenovacion: fechaRenov,
    installmentsHTML,
    bloqueBeneficios: undefined,
    fichaRegistroLink: undefined
  })

  const tipo = detectMembershipType(data.program_name)
  const subject = `Bienvenido a tu Membresia ${tipo} - WE Educacion`
  // Las membresias se mandan desde pagos@we-educacion.com (mismo sender que el GAS).
  const result = await deps.sendEmail({
    to: toEmail,
    subject,
    htmlBody,
    fromEmail: 'pagos@we-educacion.com',
    fromName: 'WE Educacion Ejecutiva'
  })

  try {
    await repo.insertEmailLog({
      enrollmentId,
      toEmail,
      subject,
      messageId: result.messageId,
      templateType: 'membresia',
      status: result.success ? 'sent' : 'failed'
    })
  } catch (logErr) { console.error('[EmailLog] Error:', logErr.message) }

  return result
}

// ---------------------------------------------------------------------------
// Timeline de correos del enrollment.

export async function getEmailLogs ({ enrollmentId }) {
  return repo.findEmailLogs(enrollmentId)
}
