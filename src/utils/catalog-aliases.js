// Source of Truth para aliases del catalog que el codigo de aplicacion conoce.
// Si renombras un alias en BD, actualizar SOLO aqui afecta a todos los consumidores.
// Si el alias no existe en BD, getCatalogIdByAlias retorna null y la operacion falla limpio.

export const ALIAS = Object.freeze({
  // Contactos (person_contacts.cat_way_contact)
  WAY_CONTACT_EMAIL:                'we_way_contact_email',
  WAY_CONTACT_PHONE:                'we_way_contact_phone',

  // Estados de certificado (enrollments.cat_certificate_status)
  CERTIFICATE_STATUS_PAID:          'we_certificate_status_paid',

  // Estados de inscripcion FICO (enrollments.cat_fico_status)
  ENROLLMENT_STATUS_TRACKING:       'we_enrollment_status_tracking',
  ENROLLMENT_STATUS_CHECKED:        'we_enrollment_status_checked',
  ENROLLMENT_STATUS_PENDING:        'we_enrollment_status_pending',
  ENROLLMENT_STATUS_OBSERVED:       'we_enrollment_status_observed',
  ENROLLMENT_STATUS_RETIRED:        'we_enrollment_status_retired',
  ENROLLMENT_STATUS_REPROGRAMMED:   'we_enrollment_status_reprogrammed',
  ENROLLMENT_STATUS_COURSE_CHANGED: 'we_enrollment_status_course_changed',
  ENROLLMENT_STATUS_PENDING_REVIEW: 'we_enrollment_status_pending_review',

  // Inscripcion (enrollments.cat_type_status)
  INSCRIPTION_WAY_ACT:              'we_inscription_way_act',

  // Estados de pago/cuota (payment_installments.cat_status)
  PAYMENT_STATUS_PAID:              'we_payment_status_paid',
  PAYMENT_STATUS_PENDING:           'we_payment_status_pending',
  PAYMENT_STATUS_DRAFT:             'we_payment_status_draft',

  // Tipos de pago (payments.cat_payment_type)
  PAYMENT_TYPE_INITIAL:             'we_payment_type_initial',
  PAYMENT_TYPE_PAYMENT:             'we_payment_type_payment',
  PAYMENT_TYPE_SINGLE:              'we_payment_type_single',

  // Estado de liquidacion bancaria (payments.cat_settlement_status)
  SETTLEMENT_STATUS_PENDING:        'we_settlement_status_pending',
  SETTLEMENT_STATUS_SETTLED:        'we_settlement_status_settled',

  // Modalidad de pago (enrollments.cat_payment_plan)
  PAYMENT_WAY_SINGLE:               'we_payment_way_single',
  PAYMENT_WAY_INSTALLMENTS:         'we_payment_way_installments',

  // Metodos de pago (payments.cat_method_payment)
  PAYMENT_METHOD_TRANSFER:          'we_payment_method_transfer',

  // Canales de pago (enrollments.cat_payment_channel)
  CHANNEL_GENERAL:                  'we_channel_general',
  CHANNEL_TOKEN:                    'we_channel_token',
  CHANNEL_WEB:                      'we_channel_web',

  // Modalidad del programa
  MODALITY_ONLINE:                  'we_modality_online',

  // Perfiles del alumno (enrollments.cat_profile_id)
  PROFILE_PROFESSIONAL:             'we_profile_professional',
  PROFILE_STUDENT:                  'we_profile_student',
  PROFILE_GENERAL:                  'we_profile_general',

  // Tipos de documento B2B (enrollments.cat_b2b_doctype)
  B2B_DOCTYPE_SERVICE_ORDER:        'we_enrollment_b2b_doctype_service_order',
  B2B_DOCTYPE_PURCHASE_ORDER:       'we_enrollment_b2b_doctype_purchase_order',
  B2B_DOCTYPE_COMPROMISE_LETTER:    'we_enrollment_b2b_doctype_compromise_letter',
})
