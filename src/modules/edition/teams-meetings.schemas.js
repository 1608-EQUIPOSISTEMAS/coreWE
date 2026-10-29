export const teamsSyncStartSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      // Sin edition_ids = todas las aulas activas.
      edition_ids: { type: ['array', 'null'], items: { type: 'integer', minimum: 1 }, maxItems: 500 },
      // true = solo calcula lo que haria, sin tocar Teams ni la BD.
      dry_run: { type: 'boolean' }
    }
  }
}

export const teamsSyncStatusSchema = {
  body: {
    type: 'object',
    required: ['job_id'],
    additionalProperties: false,
    properties: { job_id: { type: 'string', minLength: 1, maxLength: 64 } }
  }
}

export const teamsEditionLinksSchema = {
  body: {
    type: 'object',
    required: ['edition_num_id'],
    additionalProperties: false,
    properties: { edition_num_id: { type: 'integer', minimum: 1 } }
  }
}
