import { AUDITED_TABLES, AUDITED_ACTIONS } from './audit.entity.js'

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
