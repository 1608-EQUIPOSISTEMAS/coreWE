// JSON schema de validacion de entrada (Fastify/AJV) para la exportacion del
// aula. Identico al que vivia inline en routes/fico.js.

export const exportClassroomSchema = {
  querystring: {
    type: 'object',
    required: ['programVersionId', 'editionNumId'],
    properties: {
      programVersionId: { type: 'integer' },
      editionNumId: { type: 'integer' }
    }
  }
}
