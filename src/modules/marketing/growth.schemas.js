// JSON schemas (Fastify/AJV) de Crecimiento RRSS.
//
// Fastify corre AJV con removeAdditional y coerceTypes: lo que no esté declarado
// aquí se borra del request en silencio, así que agregar un campo nuevo al
// frontend obliga a declararlo también acá.

const weekDate = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }

export const socialAccountListSchema = {
  tags: ['Marketing'],
  summary: 'Cuentas cuyo crecimiento se mide (alimenta el formulario de carga manual)'
}

export const socialGrowthListSchema = {
  tags: ['Marketing'],
  summary: 'Serie semanal de seguidores por cuenta, con el crecimiento derivado',
  querystring: {
    type: 'object',
    required: ['from', 'to'],
    additionalProperties: false,
    properties: {
      // El rango es obligatorio a propósito: quien pinta la tabla ya sabe qué
      // semanas muestra, y así el backend no tiene un "últimas N semanas"
      // implícito que dependa de su propio reloj.
      from: weekDate,
      to: weekDate,
      brand: { type: 'string' }
    }
  }
}

export const socialGrowthSaveSchema = {
  tags: ['Marketing'],
  summary: 'Carga manual de seguidores (LinkedIn, grupos de Facebook, WhatsApp)',
  body: {
    type: 'object',
    required: ['account_id', 'week_start', 'followers'],
    additionalProperties: false,
    properties: {
      account_id: { type: 'integer', minimum: 1 },
      week_start: weekDate,
      followers: { type: 'integer', minimum: 0 }
    }
  }
}

export const socialGrowthSyncSchema = {
  tags: ['Marketing'],
  summary: 'Dispara la captura de seguidores contra las APIs, sin esperar al cron'
}
