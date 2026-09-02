// JSON schemas (Fastify/AJV) del modulo Reprogramaciones.
// Toda propiedad que el front manda tiene que estar declarada aca: AJV corre con
// removeAdditional y borra en silencio lo que no figure (ya paso con los links
// de aula del cronograma, que llegaban vacios al SP sin ningun error).

const TAG = 'Reprogramaciones'

export const listSchema = {
  tags: [TAG],
  description: 'Bandeja de alumnos varados por una edicion cancelada (A5). Una fila por venta.',
  body: { type: 'object', additionalProperties: false }
}

export const destinationsSchema = {
  tags: [TAG],
  description: 'Ediciones futuras disponibles como destino para un programa',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['program_version_id'],
    properties: {
      program_version_id: { type: ['integer', 'string'] }
    }
  }
}

export const proposeSchema = {
  tags: [TAG],
  description: 'Academica decide que pasa con el alumno: reubicarlo, reservarle la vacante o reembolsarle (no ejecuta nada)',
  body: {
    type: 'object',
    additionalProperties: false,
    // dest_program_version_id no es required: reserva y reembolso no tienen
    // destino. Que falte cuando SI hace falta lo decide resolveDestKind, no AJV.
    required: ['enrollment_id'],
    properties: {
      enrollment_id: { type: ['integer', 'string'] },
      dest_program_version_id: { type: ['integer', 'string', 'null'] },
      dest_edition_id: { type: ['integer', 'string', 'null'] },
      salida: { type: 'string', enum: ['reubicar', 'reserva', 'reembolso'] }
    }
  }
}

export const contactSchema = {
  tags: [TAG],
  description: 'Marca al alumno como contactado y guarda la nota de la conversacion',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['enrollment_id'],
    properties: {
      enrollment_id: { type: ['integer', 'string'] },
      notes: { type: ['string', 'null'], maxLength: 2000 }
    }
  }
}

export const verdictSchema = {
  tags: [TAG],
  description: 'Veredicto de FICO. Aceptar ejecuta el movimiento (ERP + Odoo + correo).',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['enrollment_id'],
    properties: {
      enrollment_id: { type: ['integer', 'string'] },
      notes: { type: ['string', 'null'], maxLength: 2000 }
    }
  }
}
