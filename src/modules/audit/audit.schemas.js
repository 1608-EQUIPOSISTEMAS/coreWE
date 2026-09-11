import { AUDITED_TABLES, AUDITED_ACTIONS, SYSTEM_ACTIONS } from './audit.entity.js'

// api.js del frontend inyecta user_id en todos los POST, por eso el body lo
// acepta. El filtro por autor se llama user_id_filter para no chocar con él.
export const auditLogListSchema = {
  tags: ['Auditoria'],
  summary: 'Bitácora de movimientos del sistema (ADMIN y roles de liderazgo)',
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      user_id: { type: ['integer', 'null'] },
      table_name: { type: ['string', 'null'], enum: [...Object.keys(AUDITED_TABLES), null] },
      action: { type: ['string', 'null'], enum: [...AUDITED_ACTIONS, null] },
      user_id_filter: { type: ['integer', 'null'] },
      record_id: { type: ['integer', 'null'] },
      date_from: { type: ['string', 'null'], format: 'date' },
      date_to: { type: ['string', 'null'], format: 'date' },
      page: { type: ['integer', 'null'], minimum: 1 },
      page_size: { type: ['integer', 'null'], minimum: 10, maximum: 200 }
    }
  }
}

// El autor NO viaja en el body (sale del JWT); user_id se declara solo porque
// api.js lo inyecta en todos los POST y additionalProperties lo descartaria.
export const auditSystemActionSchema = {
  tags: ['Auditoria'],
  summary: 'Registra en la bitacora una accion del menu de usuario',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      user_id: { type: ['integer', 'null'] },
      action: { type: 'string', enum: SYSTEM_ACTIONS }
    }
  }
}
