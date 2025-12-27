// src/routes/instructors.js
import instructorService from '../services/instructor.service.js'

export default async function instructorRoutes (fastify) {
  // REGISTRAR INSTRUCTOR (crea/usa persona + instructor)
  fastify.post('/instructorregister', {
    schema: {
      body: {
        type: 'object',
        required: ['instructor'],
        additionalProperties: false,
        properties: {
          instructor: {
            type: 'object',
            additionalProperties: false,
            properties: {
              // persona (opcionalmente puedes mandar person_id para reutilizar persona)
              person_id:          { type: ['integer', 'null'] },
              first_name:         { type: ['string', 'null'] },
              last_name:          { type: ['string', 'null'] },
              mother_last_name:   { type: ['string', 'null'] },
              document_number:    { type: ['string', 'null'] },
              cat_type_document:  { type: ['integer', 'null'] },
              cat_occupation:     { type: ['integer', 'null'] },
              cat_person_status:  { type: ['integer', 'null'] },
              cat_country:        { type: ['integer', 'null'] },
              birthday:           { type: ['string', 'null'] }, // 'YYYY-MM-DD'

              // flags de activo
              person_active:      { type: ['string', 'null'] },     // 'Y' | 'N'
              instructor_active:  { type: ['string', 'null'] },     // 'Y' | 'N'

              // auditoría
              user_registration_id: { type: ['integer', 'null'] }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const payload = req.body
    const { instructor_id, person_id, data } =
      await instructorService.instructorRegister(payload)
    return reply.code(201).send({
      ok: true,
      instructor_id,
      person_id,
      data
    })
  })

  // LISTAR INSTRUCTORES
  fastify.post('/instructorlist', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // instructor.active
          active:            { type: ['boolean', 'string', 'null'] }, // true/false o 'Y'/'N'
          cat_occupation:    { type: ['integer', 'null'] },
          cat_person_status: { type: ['integer', 'null'] },
          q:                 { type: ['string', 'null'] }, // busca en nombre/apellidos/dni
          page:              { type: ['integer', 'null'], default: 1 },
          size:              { type: ['integer', 'null'], default: 25 }
        }
      }
    }
  }, async (req, reply) => {
    const data = await instructorService.instructorList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // OBTENER INSTRUCTOR POR ID (incluye datos de persona)
  fastify.post('/instructorget', {
    schema: {
      body: {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: {
          id: { type: 'integer' } // instructor_id
        }
      }
    }
  }, async (req, reply) => {
    const { data } = await instructorService.instructorGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

 // ACTUALIZAR INSTRUCTOR + PERSONA + DOCUMENTOS
  fastify.post('/instructorupdate', {
    schema: {
  body: {
    type: 'object',
    required: ['instructor'], // 'id' suele venir en params, pero si viene en body, agrégalo
    additionalProperties: false,
    properties: {
      id: { type: 'integer' }, 
      
      instructor: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // --- DATOS PERSONALES ---
          first_name:         { type: ['string', 'null'] },
          last_name:          { type: ['string', 'null'] },
          mother_last_name:   { type: ['string', 'null'] },
          document_number:    { type: ['string', 'null'] },
          cat_type_document:  { type: ['integer', 'null'] },
          cat_occupation:     { type: ['integer', 'null'] },
          cat_person_status:  { type: ['integer', 'null'] },
          cat_country:        { type: ['integer', 'null'] },
          profile_resume:     { type: ['string', 'null'] },
          birthday:           { type: ['string', 'null'] },
          phone:              { type: ['string', 'null'] },
          email:              { type: ['string', 'null'] },
          
          
          // --- DATOS PROFESIONALES (NUEVOS) ---
          linkedin:           { type: ['string', 'null'] },
          relevant_company:   { type: ['string', 'null'] }, 
          relevant_work:      { type: ['string', 'null'] }, 

          // --- CVS ---
          cv_url:             { type: ['string', 'null'] },
          cv_documents_url:   { type: ['string', 'null'] },
          // --- ARRAY DE PROGRAMAS (NUEVO) ---
          programs: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              required: ['program_id'], 
              additionalProperties: false,
              properties: {
                instructor_program_id: { type: ['integer', 'null'] }, 
                program_id:            { type: 'integer' },
                profile_summary:       { type: ['string', 'null'] },
                active:                { type: ['string', 'null'] } // Recibe 'Y' o 'N'
              }
            }
          },
          // --- ARRAY DE FINANCIEROS (ACTUALIZADO) ---
          financials: {
             type: ['array', 'null'],
             items: {
               type: 'object',
               additionalProperties: false,
               properties: {
                 instructor_financial_id: { type: ['integer', 'null'] },
                 
                 // CAMBIO: bank_id eliminado, entra bank_name
                 bank_name:            { type: ['string', 'null'] }, 
                 
                 cat_payment_type:     { type: ['integer', 'null'] },
                 cat_currency:         { type: ['integer', 'null'] },
                 
                 // CAMBIO: hourly_rate eliminado, entra cat_rate_pay_id
                 cat_rate_pay_id:      { type: ['integer', 'null'] },
                 
                 observations:         { type: ['string', 'null'] },
                 
                 // Array de URLs
                 attachments: { 
                    type: ['array', 'null'],
                    items: { type: 'string' } 
                 }
               }
             }
          },

          // --- METADATA ---
          person_active:        { type: ['string', 'null'] },
          instructor_active:    { type: ['string', 'null'] },
          user_modification_id: { type: ['integer', 'null'] }
        }
      }
    }
  }
}
  }, async (req, reply) => {
    const { instructor_id, person_id, data } =
      await instructorService.instructorUpdate(req.body)

    return reply.code(200).send({
      ok: true,
      instructor_id,
      person_id,
      data
    })
  })

    // CALLER PARA COMBOS (SearchSelect, etc.)
  fastify.post('/instructorcaller', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // mismo criterio que list, pero sin paginación
          active:            { type: ['boolean', 'string', 'null'] }, // true/false o 'Y'/'N'
          cat_occupation:    { type: ['integer', 'null'] },
          cat_person_status: { type: ['integer', 'null'] },
          q:                 { type: ['string', 'null'] } // busca en nombre/apellidos/dni
        }
      }
    }
  }, async (req, reply) => {
    const items = await instructorService.instructorCaller(req.body)
    return reply.code(200).send({ ok: true, items })
  })

}
