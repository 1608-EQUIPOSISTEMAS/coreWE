// Schemas AJV de las rutas JSON.
//
// Las dos rutas multipart (/create y /comment) NO llevan schema.body a
// proposito: AJV con removeAdditional vaciaria el body del multipart. Su
// validacion vive entera en tickets.entity (validateTicketInput,
// validateComment) y tickets.files, que ademas las comparte el slash command de
// Slack, que tampoco pasa por AJV.

const TAG = ['Tickets']

const ok = (dataSchema = { type: 'object', additionalProperties: true }) => ({
  200: {
    type: 'object',
    properties: { ok: { type: 'boolean' }, data: dataSchema },
    additionalProperties: true
  }
})

export const listSchema = {
  tags: TAG,
  summary: 'Bandeja de tickets segun el alcance del usuario',
  body: {
    type: 'object',
    properties: {
      filtro: { type: 'string', enum: ['TODOS', 'MIOS', 'SIN_ASIGNAR', 'POR_VENCER', 'VENCIDOS'], default: 'TODOS' },
      busqueda: { type: 'string', maxLength: 120, default: '' },
      orden: { type: 'string', enum: ['sla', 'fecha'], default: 'sla' },
      user_id: { type: 'integer' }
    },
    additionalProperties: false
  },
  response: ok()
}

export const detailSchema = {
  tags: TAG,
  summary: 'Detalle de un ticket',
  body: {
    type: 'object',
    required: ['ticket_id'],
    properties: { ticket_id: { type: 'integer', minimum: 1 }, user_id: { type: 'integer' } },
    additionalProperties: false
  },
  response: ok()
}

export const commentsSchema = {
  tags: TAG,
  summary: 'Hilo de comentarios de un ticket',
  body: {
    type: 'object',
    required: ['ticket_id'],
    properties: { ticket_id: { type: 'integer', minimum: 1 }, user_id: { type: 'integer' } },
    additionalProperties: false
  },
  response: ok({ type: 'array' })
}

export const statusSchema = {
  tags: TAG,
  summary: 'Avanzar el estado de un ticket (solo el agente asignado)',
  body: {
    type: 'object',
    required: ['ticket_id', 'estado'],
    properties: {
      ticket_id: { type: 'integer', minimum: 1 },
      // ABIERTO no esta: es el estado inicial, no un destino.
      estado: { type: 'string', enum: ['EN_PROGRESO', 'CERRADO'] },
      user_id: { type: 'integer' }
    },
    additionalProperties: false
  },
  response: ok()
}

export const assigneesSchema = {
  tags: TAG,
  summary: 'Agentes que pueden recibir tickets',
  body: { type: 'object', properties: { user_id: { type: 'integer' } }, additionalProperties: false },
  response: ok({ type: 'array' })
}

export const reassignSchema = {
  tags: TAG,
  summary: 'Reasignar un ticket a otro agente',
  body: {
    type: 'object',
    required: ['ticket_id', 'asignado_a_id'],
    properties: {
      ticket_id: { type: 'integer', minimum: 1 },
      asignado_a_id: { type: 'integer', minimum: 1 },
      user_id: { type: 'integer' }
    },
    additionalProperties: false
  },
  response: ok()
}

export const slaPoliciesSchema = {
  tags: TAG,
  summary: 'Politicas de SLA vigentes',
  body: { type: 'object', properties: { user_id: { type: 'integer' } }, additionalProperties: false },
  response: ok({ type: 'array' })
}

export const slaPolicySaveSchema = {
  tags: TAG,
  summary: 'Guardar los plazos de una prioridad',
  body: {
    type: 'object',
    required: ['prioridad', 'minutos_primera_respuesta', 'minutos_resolucion'],
    properties: {
      prioridad: { type: 'string', enum: ['ALTA', 'MEDIA', 'BAJA'] },
      // El rango tambien esta en el CHECK de la tabla y en la entity: aca solo
      // para que un disparate ni siquiera llegue al caso de uso.
      minutos_primera_respuesta: { type: 'integer', minimum: 1, maximum: 43200 },
      minutos_resolucion: { type: 'integer', minimum: 1, maximum: 43200 },
      user_id: { type: 'integer' }
    },
    additionalProperties: false
  },
  response: ok()
}

export const attachmentSchema = {
  tags: TAG,
  summary: 'Descargar un adjunto',
  params: {
    type: 'object',
    required: ['attachmentId'],
    properties: { attachmentId: { type: 'integer', minimum: 1 } }
  }
}
