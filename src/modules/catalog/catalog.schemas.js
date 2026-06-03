// JSON schemas (Fastify/AJV) del dominio catalog. Los endpoints legacy no tenian
// schema y aceptaban cualquier body: se mantiene additionalProperties:true para
// no rechazar peticiones que antes pasaban.

export const catalogListSchema = {
  tags: ['Catalog'],
  summary: 'Devuelve el mapa de catalogos del sistema',
  body: {
    type: 'object',
    additionalProperties: true,
    properties: {}
  }
}

export const membershipListSchema = {
  tags: ['Catalog'],
  summary: 'Lista las membresias con filtros y paginacion',
  body: {
    type: 'object',
    additionalProperties: true,
    properties: {
      active: { type: ['boolean', 'string', 'null'] },
      q: { type: ['string', 'null'] },
      page: { type: ['integer', 'null'], default: 1 },
      size: { type: ['integer', 'null'], default: 25 }
    }
  }
}
