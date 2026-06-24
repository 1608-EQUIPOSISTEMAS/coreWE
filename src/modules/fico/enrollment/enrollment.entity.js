import { DomainError } from '../../../shared/errors.js'

// Reglas e invariantes puras del agregado raiz "enrollment". Sin BD, red ni
// reloj oculto: todo (incluyendo "ahora") entra por parametros. Esto las hace
// testeables sin levantar Postgres ni Odoo.

// Estados de cuota considerados "saldados". Conviven dos namespaces: legacy
// (we_inst_paid = 4454) y nuevo (we_payment_status_paid = 2471). Los flujos que
// desplazan o cancelan cuotas deben excluir AMBOS.
export const PAID_INSTALLMENT_CAT_IDS = [4454, 2471]

// Ventana maxima de activacion diferida de membresias (meses).
export const MEMBERSHIP_ACTIVATION_WINDOW_MONTHS = 6

// Composicion del nombre de "Asesor" tal como se muestra en el listado FICO y
// en los audit logs: 'origin - alias' / alias / origin / placeholder.
export function fmtAgent (alias, origin) {
  if (alias && origin) return `${origin} - ${alias}`
  if (alias) return alias
  if (origin) return origin
  return '(sin asesor)'
}

// Mismo CASE WHEN que arma sp_fico_enrollment_list para seller_agent_name, en
// forma de funcion pura para derivar la etiqueta del dropdown de asesores.
export function composeAdvisorName (agentOrigin, alias) {
  if (agentOrigin && alias) return `${agentOrigin} - ${alias}`
  if (agentOrigin) return agentOrigin
  return alias || null
}

// Etiqueta legible del tipo de programa para el listado/detalle FICO.
export function resolveProgramTypeLabel (raw) {
  const v = String(raw || '').toUpperCase()
  if (v.includes('ESP')) return 'ESP'
  if (v.includes('DIPLOM')) return 'Diplomado'
  if (v.includes('PEE')) return 'PEE'
  return 'Curso'
}

// Aplana las filas de sp_fico_kpis_daily a { today, yesterday } para que el
// frontend no tenga que rebuscar por day_label.
export function flattenDailyKpis (rows = []) {
  const out = { today: null, yesterday: null }
  for (const r of rows) {
    const bucket = {
      total: Number(r.total),
      confirmed: Number(r.confirmed),
      pending: Number(r.pending),
      amount: Number(r.amount)
    }
    if (r.day_label === 'today') out.today = bucket
    else if (r.day_label === 'yesterday') out.yesterday = bucket
  }
  return out
}

// Resuelve seller_agent_id + agent_origin destino para editSellerAgent.
//
// Dos modos:
//  - Legacy (sin newAgentOrigin): el canal se deriva por heuristica. Sin asesor
//    -> 'SA'; al volver de 'SA' a un asesor real -> limpia (null); resto preserva.
//  - Explicito (con newAgentOrigin): se persiste el canal tal cual lo eligio la
//    UI; '' o null = comercial sin canal.
//
// Lanza DomainError si el resultado coincide con el estado actual (no-op).
//
// @returns {{ newAgentId: number|null, newOrigin: string|null, isSinAsesor: boolean }}
export function resolveSellerAgentChange ({ oldAgentId, oldOrigin, newSellerAgentId, newAgentOrigin }) {
  const isSinAsesor = newSellerAgentId === null || newSellerAgentId === undefined
  const newAgentId = isSinAsesor ? null : Number(newSellerAgentId)
  const useExplicitOrigin = newAgentOrigin !== undefined
  const explicitOrigin = (newAgentOrigin === '' || newAgentOrigin === null) ? null : newAgentOrigin

  let newOrigin
  if (useExplicitOrigin) {
    newOrigin = explicitOrigin
  } else if (isSinAsesor) {
    newOrigin = 'SA'
  } else if (oldOrigin === 'SA') {
    newOrigin = null
  } else {
    newOrigin = oldOrigin
  }

  const oldAgentIdN = oldAgentId == null ? null : Number(oldAgentId)
  if (oldAgentIdN === newAgentId && (oldOrigin || null) === (newOrigin || null)) {
    throw new DomainError('No hay cambios: el canal y el asesor son los mismos que los actuales')
  }

  return { newAgentId, newOrigin, isSinAsesor }
}

// Verifica que el enrollment este en estado aprobado (checked) antes de permitir
// editar su asesor. Lanza DomainError si no.
export function assertChecked (ficoStatusAlias) {
  if (ficoStatusAlias !== 'we_enrollment_status_checked') {
    throw new DomainError('Solo se puede editar el asesor en inscripciones aprobadas')
  }
}

// Dias de desplazamiento entre dos fechas de inicio de edicion. Usado para
// correr las cuotas pendientes al reprogramar. Devuelve 0 si falta alguna fecha.
export function editionShiftDays (oldStartDate, newStartDate) {
  if (!oldStartDate || !newStartDate) return 0
  const oldStart = new Date(oldStartDate)
  const newStart = new Date(newStartDate)
  return Math.round((newStart - oldStart) / (1000 * 60 * 60 * 24))
}

// Mensaje de duplicado para el registro directo FICO. Compone "quien" registro
// la inscripcion previa (alias + canal) y "cuando" en formato es-PE/Lima.
export function buildDuplicateResponse (duplicate) {
  const who = [duplicate.seller_agent_alias, duplicate.agent_origin].filter(Boolean).join(' - ') || 'otro asesor'
  const when = duplicate.registration_date
    ? new Date(duplicate.registration_date).toLocaleDateString('es-PE', { timeZone: 'America/Lima' })
    : 'fecha no registrada'
  return {
    result: 2,
    message: `No se puede registrar: ${duplicate.existing_student_name || 'el alumno'} ya esta inscrito en ${duplicate.program_name || 'este programa'} ${duplicate.edition_code || ''} (registrado por ${who} el ${when}).`,
    duplicate_info: {
      enrollment_id: duplicate.enrollment_id,
      student_name: duplicate.existing_student_name,
      document_number: duplicate.existing_document,
      program_name: duplicate.program_name,
      edition_code: duplicate.edition_code,
      registration_date: duplicate.registration_date,
      registered_by: who
    }
  }
}

// Normaliza el payload del registro directo FICO al shape de "inscription" que
// consume sp_fico_enrollment_register_direct. Logica pura: no toca BD.
export function buildDirectInscription (data) {
  return {
    document_number: data.document_number,
    cat_type_document: data.cat_type_document,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    phone: data.phone,
    program_version_id: data.program_version_id,
    program_edition_id: data.program_edition_id,
    cat_insc_modality: data.cat_insc_modality,
    cat_payment_channel: data.cat_payment_channel || null,
    cat_currency: data.cat_currency,
    cat_payment_way: data.cat_payment_way,
    cat_payment_medium: data.cat_payment_medium || null,
    cat_business_entity: data.cat_business_entity || null,
    bank_account_id: data.bank_account_id || null,
    transaction_code: data.transaction_code || null,
    payment_date: data.payment_date || null,
    list_price: data.list_price || 0,
    total_amount: data.total_amount || 0,
    saved_money: data.saved_money || 0,
    is_scholarship: data.is_scholarship === true,
    // Beneficio de membresia: curso de cortesia (precio 0) sin ser beca. Tercera
    // via de "pago cero" del SP (ver sp_fico_enrollment_register_direct.sql).
    is_membership_benefit: data.is_membership_benefit === true,
    // Tier de membresia normalizado: FK a la fila real en programs (is_membership=Y).
    // NULL = sin membresia. Reemplaza el prefijo de texto que vivia en notes.
    membership_program_id: data.membership_program_id || null,
    // Hijo de paquete: liga al padre y entra como pago cero (la venta vive en el
    // padre). Ver sp_fico_enrollment_register_direct.sql.
    parent_enrollment_id: data.parent_enrollment_id || null,
    cat_b2b_doctype: data.cat_b2b_doctype || null,
    seller_agent_id: data.seller_agent_id || null,
    agent_origin: data.agent_origin || null,
    client_profile: data.client_profile || null,
    observations: data.observations || 'Registro directo FICO',
    ticket_payment_urls: Array.isArray(data.ticket_payment_urls) ? data.ticket_payment_urls : [],
    installment_plan: data.installment_plan || null,
    // Descuentos en cascada (porcentaje -> promo stick -> beneficios). Si no
    // vienen, el SP respeta total_amount y deja discount_amount en 0.
    dsct_porcent_id: data.dsct_porcent_id ?? null,
    dsct_stick_id: data.dsct_stick_id ?? null,
    dsct_benefit_ids: Array.isArray(data.dsct_benefit_ids) ? data.dsct_benefit_ids : []
  }
}

// Arma la inscripcion de la NUEVA venta en un cambio de curso. La venta nueva
// nunca se acredita a un asesor (la original ya quedo registrada), de ahi la
// convencion "Sin Asesor": agent_origin='SA', seller_agent_id=null. Reusa
// identidad y modalidad del origen. Logica pura: los catalog_id resueltos y el
// metodo de pago previo entran por parametros.
export function buildCourseChangeInscription ({
  old, newProgramVersionId, newEditionId, totalAmount, ccNote,
  cat_currency, cat_method_payment, cat_business_entity, bank_account_id,
  transaction_code, ticket_payment_urls,
  ccContadoCatId, resolvedMethodPayment, today
}) {
  return {
    document_number: old.document_number,
    cat_type_document: old.cat_type_document,
    first_name: old.first_name,
    last_name: old.last_name,
    email: old.origin_email,
    phone: old.origin_phone,
    program_version_id: newProgramVersionId,
    program_edition_id: newEditionId,
    cat_insc_modality: old.cat_inscription_modality,
    cat_payment_channel: old.cat_payment_channel,
    cat_currency: cat_currency || old.cat_currency,
    cat_payment_way: ccContadoCatId || old.cat_payment_plan,
    cat_payment_medium: cat_method_payment || resolvedMethodPayment,
    cat_business_entity: cat_business_entity || null,
    bank_account_id: bank_account_id || null,
    transaction_code: transaction_code || null,
    payment_date: today,
    list_price: totalAmount || 0,
    total_amount: totalAmount,
    saved_money: 0,
    // CC sin pago adicional (lo pagado en el origen cubre el curso nuevo):
    // monto 0 entra por la via "pago cero" del SP, que de otro modo rechaza
    // list_price <= 0. El SP crea una cuota pagada de 0 sin fila de pago.
    is_scholarship: !(Number(totalAmount) > 0),
    cat_b2b_doctype: null,
    seller_agent_id: null,
    agent_origin: 'SA',
    // El SP exige perfil cuando la edicion destino existe. Se hereda del origen;
    // sin alias de estudiante se asume profesional (mismo default que usan las
    // hojas FICO al exportar OCUP).
    client_profile: old.old_profile_alias === 'we_profile_student' ? 'estudiante' : 'profesional',
    observations: ccNote,
    ticket_payment_urls: ticket_payment_urls || [],
    installment_plan: null
  }
}

// Diferencia de monto del cambio de curso: total nuevo - total viejo (neto de
// descuento del origen).
export function courseChangeAmountDifference (oldTotal, oldDiscount, newTotal) {
  const oldAmount = Number(oldTotal || 0) - Number(oldDiscount || 0)
  return { oldAmount, amountDifference: Number(newTotal || 0) - oldAmount }
}
