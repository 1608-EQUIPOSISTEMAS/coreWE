// Diccionario de la bitácora: traduce una columna de la BD a lo que el usuario
// entiende. Sin I/O: son datos puros y por eso se testean solos.
//
// Existe porque changed_fields guarda la columna tal cual ('cat_type_status')
// y su valor tal cual (3245). Auditar es leer QUÉ hizo alguien, no adivinar a
// qué tabla pertenece un número.

// A qué tabla hay que ir a buscar el significado de un valor.
export const REFERENCE = {
  CATALOGO: 'catalogo',
  USUARIO: 'usuario',
  EDICION: 'edicion',
  VERSION: 'version',
  EMPRESA: 'empresa'
}

// Campos cuyo valor es el id de otra tabla. Todo `cat_*` es del catálogo y se
// resuelve por prefijo, no columna por columna.
const REFERENCIA_POR_CAMPO = {
  user_id: REFERENCE.USUARIO,
  user_registration_id: REFERENCE.USUARIO,
  user_modification_id: REFERENCE.USUARIO,
  user_validator_id: REFERENCE.USUARIO,
  updated_by: REFERENCE.USUARIO,
  seller_agent_id: REFERENCE.USUARIO,
  instructor_id: REFERENCE.USUARIO,
  program_edition_id: REFERENCE.EDICION,
  program_version_id: REFERENCE.VERSION,
  company_id: REFERENCE.EMPRESA
}

const CAMPOS_MONTO = new Set([
  'total_amount', 'discount_amount', 'list_price', 'amount', 'agreed_amount'
])

const CAMPOS_FECHA = new Set([
  'registration_date', 'modification_date', 'payment_date', 'pay_date',
  'start_date', 'end_date', 'contact_datetime', 'first_contact_date',
  'membership_activation_date', 'new_date', 'updated_at'
])

// Columnas 'Y'/'N' de toda la vida. Se listan porque el nombre no lo delata:
// 'upgrade' o 'confirmation' suenan a texto y son banderas.
const CAMPOS_BANDERA = new Set([
  'active', 'bot', 'web', 'b2b', 'flag_send', 'flag_history', 'upgrade',
  'requires_email_cc', 'confirmation', 'preconfirmation', 'new_methodology'
])

// Nombre humano de cada columna de las 6 tablas con trigger de auditoría.
// Una columna que no esté aquí cae en humanizar(): se lee peor, no rompe.
export const FIELD_LABELS = {
  // Comunes a varias tablas
  active: 'Estado del registro',
  notes: 'Observaciones',
  observations: 'Observaciones',
  registration_date: 'Fecha de registro',
  modification_date: 'Fecha de modificación',
  user_registration_id: 'Registrado por',
  user_modification_id: 'Modificado por',
  user_id: 'Usuario',
  program_edition_id: 'Edición',
  program_version_id: 'Versión del programa',
  company_id: 'Empresa',
  company_name: 'Nombre de la empresa',
  enrollment_id: 'Inscripción',

  // Inscripciones
  total_amount: 'Monto total',
  list_price: 'Precio de lista',
  discount_amount: 'Descuento',
  cat_type_status: 'Estado de la inscripción',
  cat_fico_status: 'Estado FICO',
  cat_certificate_status: 'Estado del certificado',
  cat_inscription_modality: 'Modalidad de inscripción',
  cat_payment_plan: 'Plan de pago',
  cat_payment_channel: 'Canal de pago',
  cat_currency: 'Moneda',
  cat_profile_id: 'Perfil del alumno',
  cat_anulment_reason: 'Motivo de anulación',
  cat_academic_result: 'Resultado académico',
  cat_event_category: 'Categoría de entrada',
  cat_b2b_doctype: 'Tipo de documento B2B',
  parent_enrollment_id: 'Inscripción padre',
  customer_id: 'Cliente',
  seller_agent_id: 'Asesor',
  user_validator_id: 'Validado por',
  b2b_contract_id: 'Contrato B2B',
  agreement_id: 'Convenio',
  agent_origin: 'Origen del asesor',
  membership_program_id: 'Membresía',
  membership_activation_date: 'Activación de la membresía',
  student_attachment_url: 'Adjunto del alumno',
  event_seat: 'Asiento del evento',
  email_cc: 'Correos en copia',
  requires_email_cc: 'Requiere copia en el correo',
  flag_send: 'Correo enviado',
  odoo_user_id: 'Usuario de Odoo',
  odoo_student_id: 'Alumno en Odoo',
  odoo_email: 'Correo de Odoo',
  odoo_password: 'Contraseña de Odoo',
  odoo_order_id: 'Pedido de Odoo',

  // Pagos
  amount: 'Monto',
  payment_date: 'Fecha de pago',
  installment_id: 'Cuota',
  transaction_code: 'Código de operación',
  evidence_url: 'Comprobante',
  cat_method_payment: 'Método de pago',
  cat_payment_type: 'Tipo de pago',
  cat_settlement_status: 'Estado de conciliación',
  settled_in_account_id: 'Cuenta de abono',
  cat_token_provider: 'Pasarela de pago',

  // Consultas (leads)
  full_name: 'Nombre del prospecto',
  person_id: 'Persona',
  origin_email: 'Correo de origen',
  origin_phone: 'Teléfono de origen',
  origin_seller_phone: 'Teléfono del asesor',
  agreed_amount: 'Monto acordado',
  pay_date: 'Fecha de pago',
  first_contact_date: 'Primer contacto',
  message_init_conversation: 'Mensaje inicial',
  lead_member_history: 'Historial de membresía',
  membership_moment_id: 'Momento de membresía',
  source_campaign_id: 'Campaña de origen',
  source_event_id: 'Evento de origen',
  bot: 'Atendido por bot',
  web: 'Vino de la web',
  b2b: 'Es B2B',
  cat_channel: 'Canal',
  cat_medium_contact: 'Medio de contacto',
  cat_status_lead: 'Estado de la consulta',
  cat_interest_level: 'Nivel de interés',
  cat_prospect_situation: 'Situación del prospecto',
  cat_type_strategy: 'Estrategia',
  cat_type_client: 'Tipo de cliente',
  cat_client_moment: 'Momento del cliente',
  cat_query: 'Tipo de consulta',
  cat_code_country: 'País',
  cat_frecuency_word: 'Frecuencia',
  cat_program_type: 'Tipo de programa',
  cat_program_modality: 'Modalidad del programa',
  cat_business_line_id: 'Línea de negocio',

  // Intentos de contacto
  attempt_number: 'N° de intento',
  contact_datetime: 'Fecha y hora del contacto',
  contact_duration: 'Duración del contacto',
  response: 'Respuesta',
  cat_result: 'Resultado',
  cat_type_attempt: 'Tipo de intento',
  cat_creation_origin: 'Origen del registro',
  cat_reschedule_origin: 'Origen de la reprogramación',

  // Ediciones y cronograma
  specific_code: 'Código de edición',
  global_code: 'Código global',
  code_version: 'Código de versión',
  start_date: 'Fecha de inicio',
  end_date: 'Fecha de fin',
  instructor_id: 'Docente',
  instructor_name: 'Nombre del docente',
  vacant: 'Vacantes',
  expedient: 'Expediente',
  confirmation: 'Confirmada',
  preconfirmation: 'Preconfirmada',
  upgrade: 'Upgrade',
  new_methodology: 'Metodología nueva',
  clasification: 'Clasificación',
  flag_history: 'Es histórica',
  cat_status_edition: 'Estado de la edición',
  cat_type_approved: 'Tipo de aprobación',
  cat_segment: 'Segmento',
  cat_day_combination_id: 'Combinación de días',
  cat_hour_combination_id: 'Combinación de horas',
  whatsapp_link: 'Enlace de WhatsApp',
  teams_link: 'Enlace de Teams',
  ficha_link: 'Enlace de la ficha',
  grades_link: 'Enlace de la lista de notas',
  certificate_form_link: 'Formulario de certificados',
  business_card_link: 'Tarjeta de presentación',
  banner_image: 'Banner',
  banner_mime: 'Formato del banner',
  banner_link: 'Enlace del banner',
  session_detail_virtual: 'Detalle de sesiones virtuales',
  session_detail_onsite: 'Detalle de sesiones presenciales',

  // Control de sesiones
  session_number: 'Sesión',
  status: 'Estado de la sesión',
  new_date: 'Nueva fecha',
  repro_times: 'Veces reprogramada',
  updated_by: 'Actualizado por',
  updated_at: 'Fecha de actualización'
}

// Último recurso para una columna sin etiqueta: al menos se lee como frase.
function humanizar (field) {
  const limpio = field.replace(/^cat_/, '').replace(/_id$/, '').replace(/_/g, ' ')
  return limpio.charAt(0).toUpperCase() + limpio.slice(1)
}

export function labelForField (field) {
  return FIELD_LABELS[field] || humanizar(field)
}

// A qué tabla hay que ir a traducir el valor de este campo, si a alguna.
export function referenceForField (field) {
  if (field.startsWith('cat_')) return REFERENCE.CATALOGO
  return REFERENCIA_POR_CAMPO[field] || null
}

const BANDERAS = { Y: 'Sí', N: 'No', true: 'Sí', false: 'No' }

// 'active' es la baja lógica del ERP, no una pregunta de sí/no: se lee como el
// estado que realmente comunica.
const BAJA_LOGICA = { Y: 'Activo', N: 'Anulado' }

const MONTO = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Texto final del valor. `resuelto` es la etiqueta que trajo el repository para
// los campos que son un id (null si ese id ya no existe en su tabla).
export function formatFieldValue (field, value, resuelto) {
  if (value === null || value === undefined || value === '') return null

  if (referenceForField(field)) return resuelto || `#${value}`
  if (field === 'active') return BAJA_LOGICA[String(value)] ?? String(value)
  if (CAMPOS_BANDERA.has(field)) return BANDERAS[String(value)] ?? String(value)
  if (CAMPOS_MONTO.has(field)) return `S/ ${MONTO.format(Number(value))}`
  if (CAMPOS_FECHA.has(field)) return formatDate(value)

  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

// Las fechas viajan en el jsonb como ISO. Se recortan a mano en vez de pasar
// por Date: 'YYYY-MM-DD' se interpreta en UTC y en Lima muestra el día anterior.
function formatDate (value) {
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}))?/)
  if (!iso) return String(value)
  const [, anio, mes, dia, hora] = iso
  return `${dia}/${mes}/${anio}${hora ? ` ${hora}` : ''}`
}
