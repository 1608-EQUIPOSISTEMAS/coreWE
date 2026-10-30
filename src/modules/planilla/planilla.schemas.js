// JSON schemas (Fastify/AJV) del modulo Planilla. Los endpoints de archivo no
// declaran body: @fastify/multipart lo parsea a mano en el controller.

const TAG = 'Planilla'

const periodo = {
  type: 'object',
  additionalProperties: false,
  required: ['anio', 'mes'],
  properties: {
    anio: { type: 'integer', minimum: 2020, maximum: 2100 },
    mes: { type: 'integer', minimum: 1, maximum: 12 }
  }
}

export const periodoSchema = { tags: [TAG], body: periodo }

export const justificarSchema = {
  tags: [TAG],
  description: 'Exonera (o deja de exonerar) la tardanza de un dia: permiso, comision, descanso medico...',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['asistencia_id', 'justificado'],
    properties: {
      asistencia_id: { type: 'integer' },
      justificado: { type: 'boolean' },
      motivo: { type: ['string', 'null'], maxLength: 300 }
    }
  }
}

export const actualizarPersonalSchema = {
  tags: [TAG],
  params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      area: { type: ['string', 'null'], maxLength: 60 },
      hora_ingreso: { type: ['string', 'null'], pattern: '^\d{2}:\d{2}$' },
      hora_salida: { type: ['string', 'null'], pattern: '^\d{2}:\d{2}$' },
      activo: { type: ['boolean', 'null'] }
    }
  }
}
