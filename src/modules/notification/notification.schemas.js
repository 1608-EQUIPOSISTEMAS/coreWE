// JSON schemas de validacion (Fastify/AJV) del dominio notification.
// Las rutas legacy no declaraban schema; aqui se valida el body de los dos POST
// sin endurecer additionalProperties para preservar la tolerancia previa.

export const notificationListSchema = {
  tags: ['Notifications'],
  summary: 'Listado paginado de notificaciones del usuario',
  body: {
    type: 'object',
    properties: {
      page: { type: ['integer', 'null'], minimum: 1, default: 1 },
      size: { type: ['integer', 'null'], minimum: 1, maximum: 100, default: 20 },
      is_read: { type: ['boolean', 'null'] }
    }
  }
}

export const notificationPushRestrictionsSchema = {
  tags: ['Notifications'],
  summary: 'Empuja a los asesores indicados la recarga de restricciones',
  body: {
    type: 'object',
    required: ['user_ids'],
    properties: {
      user_ids: {
        type: 'array',
        items: { type: ['integer', 'string'] }
      }
    }
  }
}
