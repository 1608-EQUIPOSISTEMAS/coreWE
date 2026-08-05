// Campos de la inscripcion que los SP de alta (sp_comercial_enrollment_register)
// no conocen y se escriben con un UPDATE aparte justo despues del alta.
//
// ponytail: un UPDATE suelto en vez de reescribir un SP grande. Ninguno de estos
// campos participa de un calculo del procedimiento. Si algun dia el SP necesita
// leerlos, moverlos al JSON de entrada y borrar este modulo.
//
// Nunca revierte la inscripcion si falla: la venta ya quedo registrada y estos
// datos son de reporte / notificacion. El error queda en log para corregirlo.
import { parseEmailCc } from './email-cc.js'

export async function saveLooseInscriptionFields (db, enrollmentId, inscription = {}) {
  const sets = []
  const params = []

  if (inscription.cat_event_category) {
    sets.push(`cat_event_category = $${params.push(inscription.cat_event_category)}`)
  }

  // Asiento asignado de la entrada VIP ("A-12", "Mesa 3"). Texto tal cual lo
  // escribe el operador; solo se recorta el espacio sobrante.
  const seat = String(inscription.event_seat || '').trim()
  if (seat) {
    sets.push(`event_seat = $${params.push(seat)}`)
  }

  // Canal de la venta cuando lo fija el modulo de origen (Fundacion => 'FWE').
  // Whitelist: el SP no lo escribe y esto entra por el body del request.
  //
  // El asesor se borra a proposito: en los canales WE el canal ES el asesor, no
  // se acredita a la persona que tipeo la venta. Misma convencion que el alta
  // directa de FICO (categoria WE => seller_agent_id null). Sin esto el listado
  // muestra 'FWE - VAFUN' en vez de 'FWE'.
  if (['FWE', 'TWE'].includes(inscription.agent_origin)) {
    sets.push(`agent_origin = $${params.push(inscription.agent_origin)}`)
    sets.push('seller_agent_id = NULL')
  }

  const ccList = parseEmailCc(inscription.email_cc)
  if (ccList.length > 0) {
    sets.push(`email_cc = $${params.push(ccList.join(','))}`)
  }

  // Solo se levanta, nunca se baja: bajarlo es decision de FICO y pasa por la
  // observacion de la inscripcion, no por un alta.
  if (inscription.requires_email_cc === true) {
    sets.push('requires_email_cc = true')
  }

  if (sets.length === 0) return

  try {
    await db.query(
      `UPDATE public.enrollments SET ${sets.join(', ')} WHERE enrollment_id = $${params.push(enrollmentId)}`,
      params
    )
  } catch (err) {
    console.error('[saveLooseInscriptionFields] no se pudieron guardar:', err.message)
  }
}
