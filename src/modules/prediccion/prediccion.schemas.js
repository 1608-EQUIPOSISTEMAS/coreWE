// El telefono llega como lo escribe el asesor ("+51 912 345 678"); lo normaliza
// fn_phone_key en la BD, la misma regla que arma la historia.
export const fichaSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['phone'],
    properties: { phone: { type: 'string', minLength: 6, maxLength: 30 } }
  }
}

// Sin user_id = la bandeja propia; con user_id, solo un lider (lo valida el usecase).
export const bandejaSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { user_id: { type: 'integer', minimum: 1 } }
  }
}

export const resultadoSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['assignment_id', 'outcome'],
    properties: {
      assignment_id: { type: 'integer', minimum: 1 },
      outcome: { type: 'string', enum: ['CONTESTO', 'NO_INTERESA', 'NO_CONTESTA', 'NUMERO_ERRADO'] },
      reason: { type: ['string', 'null'], enum: ['PRECIO', 'HORARIO', 'FECHA', 'LO_PENSARA', 'OTRO_PROGRAMA', 'COMPETENCIA', 'SIN_INTERES', null] }
    }
  }
}
