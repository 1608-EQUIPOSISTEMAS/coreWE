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
      outcome: { type: 'string', enum: ['INSCRITO', 'LO_PIENSO', 'CARO', 'NO_CONTESTA', 'OTRO_PROGRAMA', 'NO_INTERESA', 'NUMERO_ERRADO'] }
    }
  }
}

export const seguimientoSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['followup_id'],
    properties: { followup_id: { type: 'integer', minimum: 1 } }
  }
}

export const manualSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['program_id'],
    properties: { program_id: { type: 'integer', minimum: 1 } }
  }
}
