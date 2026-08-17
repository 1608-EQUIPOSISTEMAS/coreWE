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

// El año viaja como entero y no como fecha: el objetivo es anual, y aceptar un
// 'YYYY-MM-DD' invitaría a creer que la meta se puede fijar por mes.
const year = { type: 'integer', minimum: 2020, maximum: 2100 }

export const socialGoalListSchema = {
  tags: ['Marketing'],
  summary: 'Objetivo anual de seguidores por marca',
  querystring: {
    type: 'object',
    required: ['year'],
    additionalProperties: false,
    properties: { year }
  }
}

export const socialGoalSaveSchema = {
  tags: ['Marketing'],
  summary: 'Fija el objetivo anual de seguidores de una marca',
  body: {
    type: 'object',
    required: ['brand', 'year', 'followers_goal'],
    additionalProperties: false,
    properties: {
      brand: { type: 'string', minLength: 1 },
      year,
      followers_goal: { type: 'integer', minimum: 1 }
    }
  }
}

export const socialGrowthSyncSchema = {
  tags: ['Marketing'],
  summary: 'Dispara la captura de seguidores contra las APIs, sin esperar al cron'
}
