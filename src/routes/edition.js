// src/routes/editions.js
import editionService from '../services/edition.service.js'

export default async function editionRoutes (fastify) {
  /**
   * REGISTRAR EDICIÓN (simple)
   */
  fastify.post('/editionregister', {
    schema: {
      body: {
        type: 'object',
        required: ['edition', 'user_id'],
        additionalProperties: false,
        properties: {
          // AQUI: user_id en la raíz (antes user_registration_id)
          user_id: {
            type: 'integer',
            additionalProperties: true
          },
          edition: {
            type: 'object',
            additionalProperties: false,
            properties: {
              program_version_id:      { type: ['integer', 'null'] },
              instructor_id:           { type: ['integer', 'null'] },
              start_date:              { type: ['string', 'null'] }, // 'YYYY-MM-DD'
              end_date:                { type: ['string', 'null'] }, // 'YYYY-MM-DD'
              cat_type_approved:       { type: ['integer', 'null'] },
              cat_segment_id:                { type: ['integer', 'null'] },
              cat_status_edition:      { type: ['integer', 'null'] },
              vacant:                  { type: ['integer', 'null'] },
              notes:                   { type: ['string', 'null'] },

              specific_code:           { type: ['string', 'null'] },
              global_code:             { type: ['string', 'null'] },

              upgrade:               { type: ['string', 'null'] },
              expedient:               { type: ['string', 'null'] }, // 'Y' | 'N'
              preconfirmation:         { type: ['string', 'null'] }, // 'Y' | 'N'
              confirmation:            { type: ['string', 'null'] }, // 'Y' | 'N'
              active:                  { type: ['string', 'null'] }, // 'Y' | 'N'

              cat_day_combination_id:  { type: ['integer', 'null'] },
              cat_hour_combination_id: { type: ['integer', 'null'] },

              // schedules queda por compatibilidad
              schedules: {
                type: ['array', 'null'],
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    cat_day_id: { type: ['integer', 'null'] },
                    start_time: { type: ['string', 'null'] }, // 'HH:mm'
                    end_time:   { type: ['string', 'null'] }  // 'HH:mm'
                  }
                }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    
    const response = await editionService.editionRegister(req.body);
    return reply.code(201).send(response);
  })

  /**
   * REGISTRAR ÁRBOL DE EDICIONES (padre + hijos)
   * Usa sp_edition_tree_register
   */
  fastify.post('/editiontreeregister', {
    schema: {
      body: {
        type: 'object',
        required: ['edition', 'user_id'],
        additionalProperties: false,
        properties: {
          // AQUI: user_id en la raíz
          user_id: {
            type: 'integer',
            additionalProperties: true
          },
          edition: {
            type: 'object',
            additionalProperties: false,
            properties: {
              // campos del padre
              program_version_id:      { type: ['integer', 'null'] },
              instructor_id:           { type: ['integer', 'null'] },
              start_date:              { type: ['string', 'null'] },
              end_date:                { type: ['string', 'null'] },
              cat_type_approved:       { type: ['integer', 'null'] },
              cat_status_edition:      { type: ['integer', 'null'] },
              year:                   { type: ['integer', 'null'] },
              cat_segment_id:          { type: ['integer', 'null'] },
              vacant:                  { type: ['integer', 'null'] },
              notes:                   { type: ['string', 'null'] },

              specific_code:           { type: ['string', 'null'] },
              global_code:             { type: ['string', 'null'] },

              upgrade:               { type: ['string', 'null'] },
              expedient:               { type: ['string', 'null'] },
              preconfirmation:         { type: ['string', 'null'] },
              confirmation:            { type: ['string', 'null'] },
              active:                  { type: ['string', 'null'] },

              cat_day_combination_id:  { type: ['integer', 'null'] },
              cat_hour_combination_id: { type: ['integer', 'null'] },

              // hijos
              children: {
                type: ['array', 'null'],
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    // control nuevo / existente
                    new:        { type: ['boolean', 'null'] },
                    edition_id: { type: ['integer', 'null'] }, // hijo existente

                    // hijo NUEVO
                    child_program_version_id: { type: ['integer', 'null'] },
                    instructor_id:            { type: ['integer', 'null'] },
                    start_date:               { type: ['string', 'null'] },
                    end_date:                 { type: ['string', 'null'] },

                    cat_type_approved:        { type: ['integer', 'null'] },
                    cat_status_edition:       { type: ['integer', 'null'] },
                    vacant:                   { type: ['integer', 'null'] },

                    specific_code:            { type: ['string', 'null'] },
                    global_code:              { type: ['string', 'null'] },

                    expedient:                { type: ['string', 'null'] },
                    preconfirmation:          { type: ['string', 'null'] },
                    confirmation:             { type: ['string', 'null'] },
                    active:                   { type: ['string', 'null'] },

                    cat_day_combination_id:   { type: ['integer', 'null'] },
                    cat_hour_combination_id:  { type: ['integer', 'null'] },

                    user_id:                  { type: ['integer', 'null'] }, // unificado también aquí
                    sort_order:               { type: ['integer', 'null'] }
                  }
                }
              },

              // campo opcional para notas
              notes: { type: ['string', 'null'] }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    
    const response = await editionService.editionTreeRegister(req.body);
    return reply.code(201).send(response);
  })


  /**
   * LISTAR EDICIONES
   */
  fastify.post('/editionlist', {
    schema: {
      body: {
        type: 'object',
        // additionalProperties: true, // Opcional: cámbialo a true si quieres ser menos estricto mientras pruebas
        properties: {
          // --- Filtros Simples (Se mantienen igual) ---
          date_from:          { type: ['string', 'null'] },
          date_to:            { type: ['string', 'null'] },
          program_version_id: { type: ['integer', 'null'] }, // Este sigue siendo simple según tu código anterior
          clasification:      { type: ['string', 'null'] },
          q:                  { type: ['string', 'null'] },
          page:               { type: ['integer', 'null'], default: 1 },
          size:               { type: ['integer', 'null'], default: 25 },
          active:             { type: ['boolean', 'string', 'null'] },

          // --- NUEVOS Filtros MultiSelect (Arrays de Objetos) ---
          
          // 1. Instructores
          instructores_seleccionados: { 
            type: ['array', 'null'],
            items: { 
              type: 'object', 
              properties: { value: { type: 'integer' } } // Solo validamos que tenga 'value'
            }
          },

          // 2. Líneas de Negocio (category_ids)
          category_ids: { 
            type: ['array', 'null'],
            items: { type: 'object', properties: { value: { type: 'integer' } } }
          },

          // 3. Categorías (type_program_ids - antes cat_type_program)
          type_program_ids: { 
            type: ['array', 'null'],
            items: { type: 'object', properties: { value: { type: 'integer' } } }
          },

          // 4. Días (combination_days_ids - antes cat_day_combination)
          combination_days_ids: { 
            type: ['array', 'null'],
            items: { type: 'object', properties: { value: { type: 'integer' } } }
          },

          // 5. Horas (hour_combination_ids - antes cat_hour_combination)
          hour_combination_ids: { 
            type: ['array', 'null'],
            items: { type: 'object', properties: { value: { type: 'integer' } } }
          },

          // 6. Segmentos (segment_ids - antes cat_segment)
          segment_ids: { 
            type: ['array', 'null'],
            items: { type: 'object', properties: { value: { type: 'integer' } } }
          },

          // 7. Modalidad (model_modality_ids - antes cat_model_modality)
          model_modality_ids: { 
            type: ['array', 'null'],
            items: { type: 'object', properties: { value: { type: 'integer' } } }
          },

          // 8. Seguimiento Edición (course_category_ids - antes cat_course_category)
          course_category_ids: { 
            type: ['array', 'null'],
            items: { type: 'object', properties: { value: { type: 'integer' } } }
          }
        }
      }
    }
  }, async (req, reply) => {
    const data = await editionService.editionList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  /**
   * LISTAR EDICIONES POR SEMANA EN ABSE A AÑO Y MES
   */
  fastify.post('/editionbyweeklist', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          selectedMonth:      { type: ['integer', 'null'] },
          selectedYear:       { type: ['integer', 'null'] },

          program_version_id: { type: ['integer', 'null'] },
          instructor_id:      { type: ['integer', 'null'] },
          active:             { type: ['boolean', 'string', 'null'] },
          cat_status_edition: { type: ['integer', 'null'] },
          q:                  { type: ['string', 'null'] },

          page:               { type: ['integer', 'null'], default: 1 },
          size:               { type: ['integer', 'null'], default: 25 }
        }
      }
    }
  }, async (req, reply) => {
    const data = await editionService.editionByWeeklist(req.body)
    return reply.code(200).send({ ok: true, data })
  })


  /**
   * OBTENER EDICIÓN POR ID (usa sp_edition_tree_get)
   */
  fastify.post('/editionget', {
    schema: {
      body: {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: {
          id: { type: ['integer', 'null'] }
        }
      }
    }
  }, async (req, reply) => {
    const { id } = req.body
    const data = await editionService.editionGet({ id })

    return reply.code(200).send({
      ok: true,
      data
    })
  })



  /**
   * ACTUALIZAR EDICIÓN (simple)
   */
  fastify.post('/editionupdate', {
    schema: {
      body: {
        type: 'object',
        required: ['id', 'edition', 'user_id'],
        additionalProperties: false,
        properties: {
          id: { type: 'integer' }, // edition_num_id
          // AQUI: user_id en la raíz (antes user_modification_id)
          user_id: {
            type: 'integer',
            additionalProperties: true
          },
          edition: {
            type: 'object',
            additionalProperties: false,
            properties: {
              program_version_id:      { type: ['integer', 'null'] },
              instructor_id:           { type: ['integer', 'null'] },
              start_date:              { type: ['string', 'null'] },
              end_date:                { type: ['string', 'null'] },
              cat_segment_id:                { type: ['integer', 'null'] },
              cat_type_approved:       { type: ['integer', 'null'] },
              cat_status_edition:      { type: ['integer', 'null'] },
              vacant:                  { type: ['integer', 'null'] },
              notes: { type: ['string', 'null'] },
              

              specific_code:           { type: ['string', 'null'] },
              global_code:             { type: ['string', 'null'] },

              upgrade:               { type: ['string', 'null'] },
              expedient:               { type: ['string', 'null'] },
              preconfirmation:         { type: ['string', 'null'] },
              confirmation:            { type: ['string', 'null'] },
              active:                  { type: ['string', 'null'] },

              cat_day_combination_id:  { type: ['integer', 'null'] },
              cat_hour_combination_id: { type: ['integer', 'null'] },

              schedules: {
                type: ['array', 'null'],
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    schedule_id: { type: ['integer', 'null'] },
                    cat_day_id:  { type: ['integer', 'null'] },
                    start_time:  { type: ['string', 'null'] },
                    end_time:    { type: ['string', 'null'] }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const response = await editionService.editionUpdate(req.body)

    return reply.code(201).send(response)
  })

    /**
   * CALLER PARA EDICIONES (combo, SearchSelect, etc.)
   * Usa sp_edition_caller
   */
  fastify.post('/editioncaller', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          program_version_id: { type: ['integer', 'null'] },
          active:             { type: ['boolean', 'string', 'null'] }, // true/false o 'Y'/'N'
          cat_status_edition: { type: ['integer', 'null'] },
          year:               { type: ['integer', 'null'] },
          month:              { type: ['integer', 'null'] },
          q:                  { type: ['string', 'null'] } // busca en global, clasification, specific
        }
      }
    }
  }, async (req, reply) => {
    const items = await editionService.editionCaller(req.body)
    return reply.code(200).send({ ok: true, items })
  })

  
  /**
   * ACTUALIZAR ÁRBOL DE EDICIONES (padre + hijos)
   * Usa sp_edition_tree_update
   */
  fastify.post('/editiontreeupdate', {
    schema: {
      body: {
        type: 'object',
        required: ['edition', 'user_id'],
        additionalProperties: false,
        properties: {
          // AQUI: user_id en la raíz (antes user_modification_id)
          user_id: {
            type: 'integer',
            additionalProperties: true
          },
          edition: {
            type: 'object',
            required: ['edition_id'],
            additionalProperties: false,
            properties: {
              // ID del padre
              edition_id:             { type: 'integer' },

              // campos del padre (opcionales)
              program_version_id:      { type: ['integer', 'null'] },
              instructor_id:           { type: ['integer', 'null'] },
              start_date:              { type: ['string', 'null'] },
              end_date:                { type: ['string', 'null'] },
              cat_type_approved:       { type: ['integer', 'null'] },
              cat_segment_id:                { type: ['integer', 'null'] },
              cat_status_edition:      { type: ['integer', 'null'] },
              vacant:                  { type: ['integer', 'null'] },

              specific_code:           { type: ['string', 'null'] },
              global_code:             { type: ['string', 'null'] },

              upgrade:               { type: ['string', 'null'] },
              expedient:               { type: ['string', 'null'] },
              preconfirmation:         { type: ['string', 'null'] },
              confirmation:            { type: ['string', 'null'] },
              active:                  { type: ['string', 'null'] },

              cat_day_combination_id:  { type: ['integer', 'null'] },
              cat_hour_combination_id: { type: ['integer', 'null'] },

              notes:                   { type: ['string', 'null'] },

              // hijos
              children: {
                type: ['array', 'null'],
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    new:        { type: ['boolean', 'null'] },
                    edition_id: { type: ['integer', 'null'] }, // hijo existente

                    child_program_version_id: { type: ['integer', 'null'] },
                    instructor_id:            { type: ['integer', 'null'] },
                    start_date:               { type: ['string', 'null'] },
                    end_date:                 { type: ['string', 'null'] },

                    cat_type_approved:        { type: ['integer', 'null'] },
                    cat_status_edition:       { type: ['integer', 'null'] },
                    vacant:                   { type: ['integer', 'null'] },

                    specific_code:            { type: ['string', 'null'] },
                    global_code:              { type: ['string', 'null'] },

                    expedient:                { type: ['string', 'null'] },
                    preconfirmation:          { type: ['string', 'null'] },
                    confirmation:             { type: ['string', 'null'] },
                    active:                   { type: ['string', 'null'] },

                    cat_day_combination_id:   { type: ['integer', 'null'] },
                    cat_hour_combination_id:  { type: ['integer', 'null'] },

                    user_id:                  { type: ['integer', 'null'] }, // unificado también aquí
                    sort_order:               { type: ['integer', 'null'] }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const response = await editionService.editionTreeUpdate(req.body);
    return reply.code(201).send(response);
  })

}