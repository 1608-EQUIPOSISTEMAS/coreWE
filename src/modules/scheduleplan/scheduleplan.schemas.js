// JSON schemas (Fastify/AJV) del modulo Planificacion.
//
// OJO con el JSONB: AJV corre con removeAdditional y borra en silencio lo que no
// este declarado. Los items del plan son la fila cruda de sp_edition_tree_get
// (decenas de campos, y crecen cada vez que el cronograma gana una columna), asi
// que se declaran como objetos libres A PROPOSITO. Poner additionalProperties
// false ahi dejaria el plan sin fechas ni programa y sin ningun error.

const TAG = 'Planificacion'

const PLAN_ITEMS = {
  type: 'array',
  items: { type: 'object' }
}

export const planListSchema = {
  tags: [TAG],
  description: 'Escenarios de programacion guardados',
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { year: { type: ['integer', 'string', 'null'] } }
  }
}

export const planGetSchema = {
  tags: [TAG],
  description: 'Un escenario con todos sus items',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['plan_id'],
    properties: { plan_id: { type: ['integer', 'string'] } }
  }
}

export const planCreateSchema = {
  tags: [TAG],
  description: 'Crea un escenario vacio para un anio',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'year'],
    properties: {
      name: { type: 'string', minLength: 1 },
      year: { type: ['integer', 'string'] }
    }
  }
}

export const planSaveSchema = {
  tags: [TAG],
  description: 'Guarda el escenario completo (el planner escribe el blob entero)',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['plan_id', 'items'],
    properties: {
      plan_id: { type: ['integer', 'string'] },
      name: { type: ['string', 'null'] },
      items: PLAN_ITEMS
    }
  }
}

export const planDeleteSchema = {
  tags: [TAG],
  description: 'Baja logica de un escenario',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['plan_id'],
    properties: { plan_id: { type: ['integer', 'string'] } }
  }
}

export const planSeedSchema = {
  tags: [TAG],
  description: 'Copia un mes del cronograma real al escenario, con las fechas corridas',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['plan_id', 'month', 'source_year'],
    properties: {
      plan_id: { type: ['integer', 'string'] },
      month: { type: ['integer', 'string'] },
      source_year: { type: ['integer', 'string'] },
      mode: { type: 'string', enum: ['weekday', 'same_date'] }
    }
  }
}

export const planSeedYearSchema = {
  tags: [TAG],
  description: 'Copia los 12 meses del cronograma real al escenario, con las fechas corridas',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['plan_id', 'source_year'],
    properties: {
      plan_id: { type: ['integer', 'string'] },
      source_year: { type: ['integer', 'string'] },
      mode: { type: 'string', enum: ['weekday', 'same_date'] }
    }
  }
}

export const planPreviewSchema = {
  tags: [TAG],
  description: 'Un mes del escenario con el sobre del cronograma (para la vista de solo lectura)',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['plan_id', 'month'],
    properties: {
      plan_id: { type: ['integer', 'string'] },
      month: { type: ['integer', 'string'] },
      year: { type: ['integer', 'string', 'null'] }
    }
  }
}

export const planPublishSchema = {
  tags: [TAG],
  description: 'Crea las ediciones reales a partir del escenario (sin Odoo)',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['plan_id'],
    properties: {
      plan_id: { type: ['integer', 'string'] },
      uids: { type: ['array', 'null'], items: { type: 'string' } }
    }
  }
}
