// JSON schemas (Fastify/AJV) del modulo Tickets de Alumnos.
// Toda propiedad que el front manda tiene que estar declarada aca: AJV corre con
// removeAdditional y borra en silencio lo que no figure.

const TAG = 'Tickets de Alumnos'

export const listSchema = {
  tags: [TAG],
  description: 'Bandeja de tramites abiertos por alumnos desde el portal. Por defecto solo los del area del usuario.',
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      // 'Y' trae tambien los cerrados; por defecto la bandeja muestra lo que
      // falta firmar, que es para lo que se abre la pantalla.
      incluir_cerrados: { type: 'boolean' },
      tipo: { type: ['string', 'null'], maxLength: 30 },
      q: { type: ['string', 'null'], maxLength: 100 }
    }
  }
}

export const firmaSchema = {
  tags: [TAG],
  description: 'Valida el tramite en el paso del area actual. Si era el ultimo paso, queda resuelto.',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['solicitud_id'],
    properties: {
      solicitud_id: { type: ['integer', 'string'] },
      // Lo que el alumno lee en su portal: Nexus muestra `respuesta` como la
      // respuesta de coordinacion.
      respuesta: { type: ['string', 'null'], maxLength: 2000 }
    }
  }
}
