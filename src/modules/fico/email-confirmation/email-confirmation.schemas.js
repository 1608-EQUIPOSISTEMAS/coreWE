// JSON schemas de validacion de entrada (Fastify/AJV) para las rutas de correos
// transaccionales FICO. Identicos a los que vivian inline en routes/fico.js.

export const sendConfirmationEmailSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    properties: {
      enrollment_id: { type: 'integer' },
      cc: { type: ['string', 'array', 'null'], items: { type: 'string' } },
      // Credenciales SAP escritas a mano por FICO (solo cursos SAP online).
      sap_username: { type: ['string', 'null'] },
      sap_password: { type: ['string', 'null'] }
    }
  }
}

export const sendPaymentConfirmationEmailSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    properties: {
      enrollment_id: { type: 'integer' }
    }
  }
}

export const previewEmailSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    properties: {
      enrollment_id: { type: 'integer' },
      override_edition_id: { type: ['integer', 'null'] },
      // Cambio de curso: previsualiza con el programa destino (el enrollment
      // nuevo aun no existe cuando se muestra el preview).
      override_program_version_id: { type: ['integer', 'null'] },
      // Solo membresias. Permite ver el preview con la fecha que el usuario
      // esta a punto de elegir, antes de persistirla en BD.
      activation_date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      // Credenciales SAP en vivo: el preview pinta lo que FICO va escribiendo.
      sap_username: { type: ['string', 'null'] },
      sap_password: { type: ['string', 'null'] }
    }
  }
}

export const emailLogsSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    properties: {
      enrollment_id: { type: 'integer' }
    }
  }
}
