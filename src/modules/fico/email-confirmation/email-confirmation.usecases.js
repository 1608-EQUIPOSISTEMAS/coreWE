import { ALIAS } from '../../../utils/catalog-aliases.js'
import { getCatalogIdByAlias } from '../../../utils/catalog-helper.js'
import { safeAsync } from '../../../shared/utils/safe-async.js'
import { resolveCc } from '../../../utils/email-cc.js'
import {
  MEMBERSHIP_DURATION_MONTHS,
  formatCalendarDate,
  addMonthsCalendar,
  isMembership
} from '../../../utils/fico-formatters.js'
import { getEnrollmentOdoo } from '../../../utils/fico-queries.sql.js'
import { email } from '../../../shared/adapters/email/email.adapter.js'
import { renderConfirmationEmail, resolveConfirmationTemplate, buildConfirmationSubject } from './email-confirmation.render.js'
import { buildConfirmacionPagoHTML } from '../../../templates/confirmacion-pago.js'
import { buildMembresiaHTML, detectMembershipType } from '../../../templates/bienvenida-membresia.js'
import { generateCronogramaPdf } from '../../../services/pdf.service.js'
import { emailConfirmationRepository } from './email-confirmation.repository.js'
import {
  MEMBERSHIP_DEFAULT_PASSWORD,
  firstWord,
  synthesizeOdooEmail,
  normalizeSapCredentials,
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

// Efectos externos. enrollInOdoo / createMembershipOdooUser viven en el subdominio
// de inscripcion en Odoo; el orquestador los inyecta para evitar un ciclo de
// import entre subdominios. Hasta entonces lanzan un error explicito si se usan.
const deps = {
  sendEmail: email.sendEmail,
  sendFicoEmail: email.sendFicoEmail,
  generateCronogramaPdf,
  getEnrollmentOdoo,
  enrollInOdoo: async () => { throw new Error('enrollInOdoo no inyectado en email-confirmation.usecases') },
  createMembershipOdooUser: async () => { throw new Error('createMembershipOdooUser no inyectado en email-confirmation.usecases') }
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

// CC del envio, con las dos reglas del flujo comercial -> FICO:
//
//   1. PERSISTE. El CC que FICO escribe en el preview se pega al enrollment, asi
//      las cuotas, la membresia y el RP heredado salen con copia sin re-tipearlo.
//   2. BLOQUEA. Si comercial marco `requires_email_cc` y no hay CC por ningun
//      lado, no sale el correo. Es el mismo gate que la UI, repetido aca porque
//      hay entradas que no pasan por el preview (panel lateral, reenvios, cola).
//      Bajar el flag es decision de FICO y pasa por observar la inscripcion.
//
// Devuelve { list, error }: si `error` viene, el caller aborta sin enviar.
const CC_REQUIRED_ERROR = 'Esta venta requiere correo en copia: el asesor lo pidio al enviarla. Ingresa el CC en el preview antes de enviar, o quita el requerimiento observando la inscripcion.'

async function resolveCcForSend ({ enrollmentId, cc, stored }) {
  const list = resolveCc(cc, stored)

  if (list.length > 0) {
    const joined = list.join(',')
    if (joined !== (stored || '')) {
      await safeAsync('[resolveCcForSend] persistir email_cc', () => repo.saveEmailCc(enrollmentId, joined))
    }
    return { list }
  }

  const requires = await repo.requiresEmailCc(enrollmentId)
  return requires ? { list, error: CC_REQUIRED_ERROR } : { list }
}

// Determina si el correo de confirmacion va como alumno nuevo o retornante.
async function resolveModeFromDb ({ enrollmentId, odooEmail }) {
  const isFirstSend = !(await repo.hasPriorSuccessfulSend(enrollmentId, 'confirmacion'))
  const hasPriorEnrollment = await repo.hasPriorOdooEnrollment(enrollmentId)
  return resolveConfirmationEmailMode({ isFirstSend, hasPriorEnrollment, odooEmail })
}

// ---------------------------------------------------------------------------
// PREVIEW


// ── BANNER DEL EVENTO ────────────────────────────────────────────────────────
// El banner vive como bytea en program_editions, no como archivo servido por
// HTTP. Asi no depende de que /uploads este publicado ni de que el volumen del
// contenedor sobreviva un redeploy: la BD ya persiste por definicion.
//
// El correo lo lleva incrustado como adjunto CID. El preview no puede usar
// cid: (lo renderiza un navegador, no un cliente de correo), asi que ahi se
// devuelve un data: URI con los mismos bytes.
const EVENT_BANNER_CID = 'evento-banner'

async function resolveEventBanner ({ data, isEvent, forPreview }) {
  if (!isEvent || !data.has_banner_image) return { bannerUrl: null, attachments: [] }

  const row = await repo.findEditionBanner(data.edition_num_id)
  if (!row?.banner_image) return { bannerUrl: null, attachments: [] }

  const mime = row.banner_mime || data.banner_mime || 'image/jpeg'
  const buffer = Buffer.isBuffer(row.banner_image) ? row.banner_image : Buffer.from(row.banner_image)

  if (forPreview) {
    return { bannerUrl: `data:${mime};base64,${buffer.toString('base64')}`, attachments: [] }
  }
  return {
    bannerUrl: `cid:${EVENT_BANNER_CID}`,
    attachments: [{
      filename: `banner.${mime.includes('png') ? 'png' : 'jpg'}`,
      content: buffer,
      cid: EVENT_BANNER_CID,
      contentDisposition: 'inline'
    }]
  }
}

export async function previewConfirmationEmail ({ enrollmentId, overrideEditionId = null, overrideProgramVersionId = null, activationDate = null, sapUsername = null, sapPassword = null, overrideInstallments = null }) {
  // overrideProgramVersionId: el cambio de curso previsualiza el correo con el
  // programa destino (el enrollment nuevo aun no existe en este punto).
  const check = await repo.findPreviewMembershipCheck(enrollmentId, overrideProgramVersionId)
  if (check && isMembership(check.abbreviation, check.is_membership)) {
    return previewMembershipEmail({ enrollmentId, overrideEditionId, overrideProgramVersionId, activationDate })
  }

  const editionId = overrideEditionId || null
  const data = await repo.findConfirmationDataForPreview(enrollmentId, editionId, overrideProgramVersionId)
  if (!data) return { html: null, error: 'Inscripcion no encontrada' }

  const onlineModalityId = await getCatalogIdByAlias(ALIAS.MODALITY_ONLINE)
  const isOnline = data.cat_model_modality === onlineModalityId
  const sapCategoryId = await getCatalogIdByAlias(ALIAS.PROGRAM_CATEGORY_SAP)
  const isSapOnline = !!(isOnline && sapCategoryId && data.cat_category === sapCategoryId)

  // El preview pinta las credenciales que FICO esta escribiendo en vivo; si aun
  // no escribio nada, muestra placeholders para que se vea la estructura.
  let sapCredentials = null
  if (isSapOnline) {
    const { username, password } = normalizeSapCredentials({ sapUsername, sapPassword })
    sapCredentials = {
      sap_username: username || 'SAP_XXXX',
      sap_password: password || '••••••'
    }
  }

  const sched = await repo.findScheduleForPreview(enrollmentId, editionId)
  const frequency = sched.map(s => s.day_name).filter(Boolean).join(', ')
  const schedule = sched.length > 0 ? `${sched[0].start_time || ''} - ${sched[0].end_time || ''}` : ''

  // overrideInstallments: la reprogramacion previsualiza con el plan de cuotas
  // que se trasladara al enrollment destino (que aun no existe en este paso).
  const instRows = Array.isArray(overrideInstallments)
    ? overrideInstallments
    : await repo.findInstallments(enrollmentId)

  const firstName = firstWord(data.first_name)
  const lastName = firstWord(data.last_name)
  const odooEmail = data.odoo_email || synthesizeOdooEmail(firstName, lastName)

  // Mismo check que el envio real: si ya hubo un envio exitoso, el preview
  // muestra el bloque "cuenta activa, recupera password".
  const isNew = !(await repo.hasPriorSuccessfulSend(enrollmentId, 'confirmacion'))

  const isParentProgram = await repo.isParentProgram(enrollmentId)

  const { isEvent } = resolveConfirmationTemplate(data)
  const { bannerUrl } = await resolveEventBanner({ data, isEvent, forPreview: true })

  const { html: htmlBody, kind } = renderConfirmationEmail({
    data, firstName, lastName, odooEmail, isNew,
    frequency, schedule, instRows, sapCredentials, isOnline, isParentProgram, bannerUrl
  })
  // Un evento no lleva PDF de cronograma: no tiene sesiones semanales.
  const isEventKind = kind === 'evento'

  return {
    html: htmlBody,
    to: data.origin_email || '---',
    subject: buildConfirmationSubject(data),
    hasAttachment: isParentProgram && !isOnline && !isEventKind,
    attachmentName: (isParentProgram && !isOnline && !isEventKind) ? `Cronograma-${(data.program_name || 'Programa').replace(/[^a-zA-Z0-9]+/g, '-')}.pdf` : null,
    // Senal para que el front muestre el formulario de credenciales SAP.
    isSapOnline
  }
}

export async function previewMembershipEmail ({ enrollmentId, overrideEditionId = null, overrideProgramVersionId = null, activationDate = null }) {
  const editionId = overrideEditionId || null
  const data = await repo.findMembershipDataForPreview(enrollmentId, editionId, overrideProgramVersionId)
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

export async function sendConfirmationEmail ({ enrollmentId, cc, sapUsername = null, sapPassword = null, enforceSapCredentials = false }) {
  // Reintento manual: limpiar fallos previos para dejar la timeline limpia.
  await repo.clearPriorEmailFailures(enrollmentId)

  const check = await repo.findMembershipCheck(enrollmentId)
  if (check && isMembership(check.abbreviation, check.is_membership)) {
    return sendMembershipEmail({ enrollmentId, cc })
  }

  const data = await repo.findConfirmationDataForSend(enrollmentId)
  if (!data) return { success: false, error: 'Inscripcion no encontrada' }

  // Se resuelve antes que nada porque un evento se salta Odoo por completo.
  const { isEvent } = resolveConfirmationTemplate(data)

  // Sin odoo_user_id las credenciales del correo son ficticias: reintentar la
  // creacion en Odoo antes de mandar nada.
  //
  // Los eventos quedan fuera: un congreso no se dicta en el campus, no hay
  // curso al que inscribir y el correo no lleva credenciales. Exigir un alumno
  // en Odoo bloqueaba el envio con "No se pudo crear el alumno en Odoo".
  if (!isEvent && check && !check.odoo_user_id) {
    console.log(`[sendConfirmationEmail] enrollment ${enrollmentId}: sin odoo_user_id, reintentando enrollInOdoo`)
    const odooRetry = await safeAsync('[sendConfirmationEmail][Odoo] retry', () => deps.enrollInOdoo({ enrollmentId }))
    // `success` no alcanza: enrollInOdoo tambien lo devuelve cuando se SALTA la
    // inscripcion (paquete sin modulos matriculados). Sin odoo_user_id no hay
    // alumno en Odoo y las credenciales del correo serian inventadas, que es
    // justo lo que esta guarda existe para impedir.
    if (odooRetry?.success && odooRetry.odoo_user_id) {
      const cursoLabel = odooRetry.course_search || 'Curso no especificado'
      await repo.logAudit({
        enrollmentId,
        action: 'odoo_enrolled',
        userId: null,
        details: `Odoo user ${odooRetry.odoo_user_id} - ${cursoLabel} (creado en reintento desde reenviar correo)`
      })
    } else {
      // El motivo importa: un skip deja `error` vacio y el mensaje quedaba en
      // "fallo desconocido", que fue lo que hizo invisible este caso.
      const motivo = odooRetry?.error ||
        (odooRetry?.reason ? `no se inscribio a nadie (${odooRetry.reason})` : 'fallo desconocido')
      console.error(`[sendConfirmationEmail] enrollInOdoo retry no exitoso para ${enrollmentId}:`, motivo)
      return {
        success: false,
        error: `No se pudo crear el alumno en Odoo (${motivo}). El correo NO fue enviado para evitar credenciales falsas.`
      }
    }
  }

  const onlineModalityId = await getCatalogIdByAlias(ALIAS.MODALITY_ONLINE)
  const isOnline = data.cat_model_modality === onlineModalityId
  const sapCategoryId = await getCatalogIdByAlias(ALIAS.PROGRAM_CATEGORY_SAP)
  const isSapOnline = !!(isOnline && sapCategoryId && data.cat_category === sapCategoryId)

  // Credenciales SAP: ya no se autogeneran, vienen del formulario de FICO.
  //   - completas       -> se persisten (registro) y se pintan en el correo.
  //   - faltantes       -> se recuperan las ya persistidas (reenvio, RP/CC, cola).
  //   - sin persistir + enforceSapCredentials (borde HTTP manual) -> aborta el envio.
  let sapCredentials = null
  if (isSapOnline) {
    const { username, password, complete } = normalizeSapCredentials({ sapUsername, sapPassword })
    sapCredentials = complete
      ? await repo.setSapCredentials(enrollmentId, username, password)
      : await repo.findSapCredentials(enrollmentId)

    if (!sapCredentials && enforceSapCredentials) {
      return {
        success: false,
        error: 'Debes ingresar el usuario y la contrasena SAP antes de enviar el correo.'
      }
    }
    // Un curso SAP online sin credenciales sale con el correo mutilado y nadie
    // se entera. Los llamadores internos no pueden abortar (romperian el RP/CC),
    // pero el aviso queda en el log y en la bitacora de la inscripcion.
    if (!sapCredentials) {
      console.warn(`[sendConfirmationEmail] enrollment ${enrollmentId}: curso SAP online SIN credenciales, el correo sale sin el bloque SAP`)
      await repo.logAudit({
        enrollmentId,
        action: 'sap_credentials_missing',
        userId: null,
        details: 'Correo de confirmacion enviado sin el bloque de credenciales SAP: no se registraron.'
      }).catch(() => {})
    }
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
  // Un evento tampoco lleva PDF de cronograma: no tiene sesiones semanales.
  // `isEvent` ya se resolvio arriba, antes del bloque de Odoo.
  if (isParentProgram && !isOnline && !isEvent) {
    console.log(`[sendConfirmationEmail] Generando PDF cronograma para parent enrollment #${enrollmentId}`)
    const pdfResult = await buildCronogramaAttachment({ enrollmentId, programName: data.program_name })
    if (pdfResult.error) return { success: false, error: pdfResult.error }
    attachments.push(...pdfResult.attachments)
  }

  const { bannerUrl, attachments: bannerAttachments } =
    await resolveEventBanner({ data, isEvent, forPreview: false })
  attachments.push(...bannerAttachments)

  const { html: htmlBody } = renderConfirmationEmail({
    data, firstName, lastName, odooEmail, isNew,
    frequency, schedule, instRows, sapCredentials, isOnline, isParentProgram, bannerUrl
  })

  // CC en cascada: parametro explicito (override) -> enrollments.email_cc.
  const { list: ccResolved, error: ccError } = await resolveCcForSend({ enrollmentId, cc, stored: data.email_cc })
  if (ccError) return { success: false, error: ccError }
  const ccForTransport = ccResolved.length > 0 ? ccResolved : undefined

  const subject = buildConfirmationSubject(data)
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

export async function sendPaymentConfirmationEmail ({ enrollmentId, cc }) {
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
    // "ULTIMO PAGO REALIZADO" es la fecha en que el alumno pago, no la del
    // vencimiento: si su cuota vencia el 10/08 y pago el 15/08, el correo dice
    // 15/08. El due_date queda de respaldo para las cuotas viejas que no tienen
    // fila en payments (importaciones masivas).
    lastPaymentDate: lastPaid?.paid_at || lastPaid?.due_date || new Date().toISOString(),
    nextPaymentDate: nextInstallment?.due_date || null,
    nextPaymentAmount: nextInstallment?.amount || 0,
    currencySymbol: data.currency_symbol || 'S/.'
  })

  const subject = isLastPayment
    ? `Pago Completado - ${data.program_name || 'WE Educacion'}`
    : `Confirmacion de Cuota - ${data.program_name || 'WE Educacion'}`

  const { list: ccResolved, error: ccError } = await resolveCcForSend({ enrollmentId, cc, stored: data.email_cc })
  if (ccError) return { success: false, error: ccError }
  const result = await deps.sendFicoEmail({
    to: toEmail,
    subject,
    htmlBody,
    cc: ccResolved.length > 0 ? ccResolved : undefined
  })

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

// skipIfSentAfter: instante a partir del cual un envio exitoso ya cuenta como
// hecho. Lo pasa el job de membresia con su created_at para no mandar dos veces
// el correo si otro camino se le adelanto. No aplica al reenvio manual de FICO,
// que llega sin este dato y siempre manda.
export async function sendMembershipEmail ({ enrollmentId, cc, skipIfSentAfter = null }) {
  try {
    return await sendMembershipEmailInner({ enrollmentId, cc, skipIfSentAfter })
  } catch (err) {
    console.error('[sendMembershipEmail] Throw inesperado:', err.message, err.stack)
    return { success: false, error: `sendMembershipEmail: ${err.message}` }
  }
}

async function sendMembershipEmailInner ({ enrollmentId, cc, skipIfSentAfter }) {
  if (skipIfSentAfter && await repo.hasSuccessfulSendSince(enrollmentId, 'membresia', skipIfSentAfter)) {
    return { success: true, skipped: true, message: 'El correo ya salio por otro camino' }
  }

  let data = await repo.findMembershipDataForSend(enrollmentId)
  if (!data) return { success: false, error: 'Inscripcion no encontrada' }

  const toEmail = data.origin_email
  if (!toEmail) return { success: false, error: 'Sin correo registrado' }

  // La bienvenida ya NO espera a la fecha de activacion: sale el dia de la
  // inscripcion con las credenciales del campus y la fecha en que arranca el
  // acceso. Por eso solo se crea el usuario en Odoo; los cursos los abre despues
  // el job 'membership_activation'.
  if (!data.odoo_user_id) {
    console.log(`[sendMembershipEmail] enrollment ${enrollmentId}: sin odoo_user_id, creando el usuario en Odoo`)
    const odooRes = await deps.createMembershipOdooUser({ enrollmentId })
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
  const { list: ccResolved, error: ccError } = await resolveCcForSend({ enrollmentId, cc, stored: data.email_cc })
  if (ccError) return { success: false, error: ccError }
  // Las membresias se mandan desde pagos@we-educacion.com (mismo sender que el GAS).
  const result = await deps.sendEmail({
    to: toEmail,
    subject,
    htmlBody,
    fromEmail: 'pagos@we-educacion.com',
    fromName: 'WE Educacion Ejecutiva',
    cc: ccResolved.length > 0 ? ccResolved : undefined
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
