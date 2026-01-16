// src/routes/programs.js
import programService from '../services/program.service.js'

export default async function programRoutes (fastify) {
  
  // REGISTRAR PROGRAMA
  fastify.post('/programregister', {
    schema: {
      body: {
        type: 'object',
        required: ['program'],
        additionalProperties: false,
        properties: {
          // CAMBIO: Solo user_id
          user_id: { 
            type: 'integer', 
            additionalProperties: true 
          },
          program: {
            type: 'object',
            additionalProperties: false,
            properties: {
              program_name:         { type: ['string', 'null'] },
              cat_type_program:     { type: ['integer', 'null'] },
              link:               { type: ['string', 'null'] },
              cat_category:         { type: ['integer', 'null'] },
              cat_model_modality:   { type: ['integer', 'null'] },
              active:               { type: ['string', 'null'] }, // 'Y' | 'N'
              skem_clasification:       { type: ['string', 'null'] },
              
              program_versions: {
                type: ['array', 'null'],
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    program_version_id: { type: ['integer', 'null'] },
                    cat_course_category: { type: ['integer', 'null'] },
                    version_code:       { type: ['string', 'null'] },
                    brand_name:       { type: ['string', 'null'] },
                    expedient_link:   { type: ['string', 'null'] },
                    sessions:           { type: ['integer', 'null'] },
                    active:             { type: ['string', 'null'] },
                    observations:       { type: ['string', 'null'] },
                    description:        { type: ['string', 'null'] },
                    abbreviation:       { type: ['string', 'null'] },
                    children_ids: {
                      type: ['array', 'null'],
                      items: { type: 'integer' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    // Pasamos el user_id al servicio
    const payload = req.body
    const { program_id, program_versions } = await programService.programRegister(payload)

    return reply.code(201).send({
      ok: true,
      program_id,
      program_versions
    })
  })

  // LISTAR PROGRAMAS
  fastify.post('/programlist', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          active:             { type: ['boolean', 'string', 'null'] },
          cat_type_program:   { type: ['integer', 'null'] },
          cat_category:       { type: ['integer', 'null'] },
          cat_model_modality: { type: ['integer', 'null'] },
          q:                  { type: ['string', 'null'] },
          page:               { type: ['integer', 'null'], default: 1 },
          size:               { type: ['integer', 'null'], default: 25 }
        }
      }
    }
  }, async (req, reply) => {
    const data = await programService.programList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // OBTENER PROGRAMA POR ID
  fastify.post('/programget', {
    schema: {
      body: {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: {
          id: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    const { data } = await programService.programGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // ACTUALIZAR PROGRAMA
  fastify.post('/programupdate', {
    schema: {
      body: {
        type: 'object',
        required: ['id', 'program'],
        additionalProperties: false,
        properties: {
          id: { type: 'integer' },
          // CAMBIO: user_id genérico para quien modifica
          user_id: { type: ['integer', 'null'] },
          
          program: {
            type: 'object',
            additionalProperties: false,
            properties: {
              program_name:         { type: ['string', 'null'] },
              cat_type_program:     { type: ['integer', 'null'] },
              link:               { type: ['string', 'null'] },
              cat_category:         { type: ['integer', 'null'] },
              cat_model_modality:   { type: ['integer', 'null'] },
              active:               { type: ['string', 'null'] },
              
              skem_clasification:       { type: ['string', 'null'] },
              program_versions: {
                type: ['array', 'null'],
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['program_version_id'],
                  properties: {
                    program_version_id: { type: ['integer', 'null'] },
                    cat_course_category: { type: ['integer', 'null'] },
                    expedient_link:   { type: ['string', 'null'] },
                    version_code:       { type: ['string', 'null'] },
                    brand_name:       { type: ['string', 'null'] },
                    sessions:           { type: ['integer', 'null'] },
                    observations:       { type: ['string', 'null'] },
                    description:        { type: ['string', 'null'] },
                    active:             { type: ['string', 'null'] },
                    abbreviation:       { type: ['string', 'null'] },
                    children_ids: {
                      type: ['array', 'null'],
                      items: { type: 'integer' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const { program_id, program_versions } = await programService.programUpdate(req.body)

    return reply.code(200).send({
      ok: true,
      program_id,
      program_versions
    })
  })
  
  // BUSCAR VERSIONES (Caller)
  fastify.post('/programversioncaller', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cat_model_modality: { type: ['integer', 'null'] },
          not_modality:       { type: ['integer', 'null'] },
          cat_type_program:   { type: ['integer', 'null'] },
          active:     { type: ['string', 'null'] },
          q:                  { type: ['string', 'null'] }
        }
      }
    }
  }, async (req, reply) => {
    const data = await programService.programVersionCaller(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // LISTA DE PRECIOS
  fastify.post('/pricelist', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          character: { type: ['string', 'null'] }
        }
      }
    }
  }, async (req, reply) => {
    const data = await programService.priceList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // LISTAR VERSIONES DE PROGRAMA (List)
  fastify.post('/programversionlist', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          program_version_id: { type: ['integer', 'null'] },
          program_id:         { type: ['integer', 'null'] },
          active:             { type: ['boolean', 'string', 'null'] },
          q:                  { type: ['string', 'null'] },
          cat_type_program:   { type: ['integer', 'null'] },
          cat_category:       { type: ['integer', 'null'] },
          cat_model_modality: { type: ['integer', 'null'] },
          page:               { type: ['integer', 'null'], default: 1 },
          size:               { type: ['integer', 'null'], default: 25 }
        }
      }
    }
  }, async (req, reply) => {
    const data = await programService.programVersionList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // ACTUALIZAR PRECIOS (usa user_id)
  fastify.post('/programversionupdate', {
    schema: {
      body: {
        type: 'object',
        required: ['program_version_id'],
        additionalProperties: false,
        properties: {
          program_version_id:         { type: 'integer' },
          price_student_soles:        { type: ['number', 'null'] },
          price_student_dollars:      { type: ['number', 'null'] },
          price_professional_soles:   { type: ['number', 'null'] },
          price_professional_dollars: { type: ['number', 'null'] },
          active:                     { type: 'boolean' },
          price_list_id:              { type: ['integer', 'null'], default: 1 },
          user_id:                    { type: ['integer', 'null'], default: 1 }
        }
      }
    }
  }, async (req, reply) => {
    const result = await programService.priceUpdate(req.body)
    return reply.code(200).send({ ok: true, data: result })
  })

  // BUSCADOR DE PROGRAMAS (Caller)
  fastify.post('/programcaller', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          q:                { type: ['string', 'null'] },
          cat_type_program: { type: ['integer', 'null'] },
          active:           { type: ['string', 'boolean', 'null'] }
        }
      }
    }
  }, async (req, reply) => {
    const data = await programService.programCaller(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  //programVersionDetailGet
  fastify.post('/programversiondetailget', {
    schema: {
      body: {
        type: 'object',
        required: ['program_version_id'],
        additionalProperties: false,
        properties: {
          program_version_id: { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    const { data } = await programService.programVersionDetailGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })
  
}