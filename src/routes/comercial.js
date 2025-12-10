// src/routes/comercial.js
import comercialService from '../services/comercial.service.js'

export default async function comercialRoutes (fastify) {
  // registrar lead
  fastify.post('/leadregister', {
    schema: {
      body: {
        type: 'object',
        required: ['lead','user_id'],
        additionalProperties: false,
        properties: {
          lead: {
            type: 'object',
            additionalProperties: false,
            properties: {
              first_contact_date:   { type: ['string','null'] }, // ISO (date-time) o null
              program_version_id: { type: ['integer', 'null'] }, 
              program_edition_id:   { type: ['integer','null'] },
              cat_query:         { type: ['integer', 'null'] },     // <— NUEVO
              full_name:         { type: ['string', 'null'] },     // <— NUEVO
              pay_date:         { type: ['string', 'null'] },     // <— NUEVO
              // todos estos llegan ya como IDs desde el front
              cat_client_type:               { type: ['integer', 'null'] },
              cat_status_lead:      { type: ['integer','null'] },
              cat_code_country:     { type: ['integer','null'] },
              cat_interest_level:   { type: ['integer','null'] },
              cat_channel:          { type: ['integer','null'] },
              cat_medium_contact:   { type: ['integer','null'] },
              cat_frecuency_word:   { type: ['integer','null'] },
              cat_type_strategy:    { type: ['integer','null'] },
              cat_prospect_situation:{ type: ['integer','null'] },

              message_init_conversation: { type: ['string','null'] },
              observations:              { type: ['string','null'] },

              // origen (no creas persons)
              origin_phone:         { type: ['string','null'] },
              origin_email:         { type: ['string','null'] },

              planned_payment_date: { type: ['string','null'] }, // si algún día lo usas
              bot:                 { type: ['string','null'] }
            }
          },
          user_id: {
            type: 'integer',
            additionalProperties: true
          },
          person: {
            type: 'object',
            additionalProperties: true
          },
          contact_attempts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                attempt_number:   { type: ['integer','null'] },
                cat_status:       { type: ['integer','null'] },
                contact_datetime: { type: ['string','null'] },
                response:         { type: ['string','null'] }
              }
            },
            default: []
          }
        }
      }
    }
  }, async (req, reply) => {
    const payload = req.body
    console.log('INSCRIPCIÒN:\n')
    
    console.log(payload)
    const { lead_id, person_id } = await comercialService.leadRegister(payload)
    return reply.code(201).send({ ok: true, lead_id, person_id })
  })

  // actualizar lead
  fastify.post('/leadupdate', {
    schema: {
      body: {
        type: 'object',
        required: ['id', 'lead', 'user_id'],
        additionalProperties: false,
        properties: {
          id: { type: 'integer' },
          user_id: { type: 'integer' },
          lead: {
            type: 'object',
            additionalProperties: false,
            properties: {
              program_version_id:     { type: ['integer','null'] },
              program_edition_id:     { type: ['integer','null'] },
              cat_query:              { type: ['integer','null'] },
              full_name:              { type: ['string','null'] },
              cat_client_type:               { type: ['integer', 'null'] },
              pay_date:               { type: ['string','null'] },

              cat_status_lead:        { type: ['integer','null'] },
              cat_code_country:       { type: ['integer','null'] },
              cat_interest_level:     { type: ['integer','null'] },
              cat_channel:            { type: ['integer','null'] },
              cat_medium_contact:     { type: ['integer','null'] },
              cat_frecuency_word:     { type: ['integer','null'] },
              cat_type_strategy:      { type: ['integer','null'] },
              cat_prospect_situation: { type: ['integer','null'] },

              message_init_conversation: { type: ['string','null'] },
              observations:              { type: ['string','null'] },

              origin_phone:           { type: ['string','null'] },
              origin_email:           { type: ['string','null'] },

              source_campaign_id:     { type: ['integer','null'] },
              source_event_id:        { type: ['integer','null'] },
              agreed_amount:          { type: ['number','null'] },
              cat_proposed_method_payment: { type: ['integer','null'] },
              cat_proposed_way_payment:    { type: ['integer','null'] },
              active:                 { type: ['string','null'] },
              bot:                 { type: ['string','null'] }
            }
          },
          contact_attempts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id:   { type: ['integer','null'] },
                attempt_number:   { type: ['integer','null'] },
                cat_status:       { type: ['integer','null'] },
                contact_datetime: { type: ['string','null'] },
                response:         { type: ['string','null'] }
              }
            },
            default: []
          }
        }
      }
    }
  }, async (req, reply) => {
    const payload = req.body
    const { lead_id } = await comercialService.leadUpdate(payload)
    return reply.code(200).send({ ok: true, lead_id })
  })


 // inscribir desde el modal del LeadNew
  fastify.post('/enrollmentregister', {
    schema: {
      body: {
        type: 'object',
        // Validamos que venga la estructura básica necesaria
        required: ['inscription', 'user_id'], 
        properties: {
          user_id: { type: 'integer' },
          
          // El objeto principal que espera el SP
          inscription: {
            type: 'object',
            required: ['lead_id', 'program_version_id', 'cat_insc_modality', 'selectedCurrencyAlias'], 
            properties: {
              lead_id: { type: 'integer' },
              program_version_id: { type: 'integer' },
              program_edition_id: { type: ['integer', 'null'] },
              
              // Datos Persona
              document: { type: ['string', 'null'] },
              cat_type_document: { type: ['integer', 'null'] }, // ID o alias si lo manejas
              full_name: { type: ['string', 'null'] },
              last_name: { type: ['string', 'null'] },
              mother_last_name: { type: ['string', 'null'] },
              email: { type: ['string', 'null'] },
              
              // Datos Financieros
              cat_insc_modality: { type: ['integer', 'null'] },
              cat_type_payment: { type: ['integer', 'null'] }, // Alias o ID
              selectedCurrencyAlias: { type: ['string', 'null'] },
              montoFinal: { type: 'number' },
              saved_money: { type: 'number' },
              
              // Descuentos (IDs)
              dsct_porcent_id: { type: ['integer', 'null'] },
              dsct_stick_id: { type: ['integer', 'null'] },
              dsct_benefit_id: { type: ['integer', 'null'] },
              
              // B2B
              b2b_contract_id: { type: ['integer', 'null'] }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const payload = req.body
    
    // Pasamos todo el body al servicio
    const response = await comercialService.enrollmentRegister(payload)
    
    return reply.code(201).send({
      ok: true,
      ...response // devuelve enrollment_id, person_id, message
    })
  })


  
  fastify.post('/leadget', {
    schema: {
      body: {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: {
          id: {
            type: 'integer'
          }
        }
      }
    }
  }, async (req, reply) => {
    const payload = req.body
    
    const { data } = await comercialService.leadGet(payload)
    return reply.code(201).send({ ok: true, data })
  })


  fastify.post('/programVersionlist', async (req, reply) => {
    const data = await programVersionList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // NUEVO: lista de ediciones
  fastify.post('/editionlist', async (req, reply) => {
    const data = await  programEditionList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  fastify.post('/leadlist', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: true, // Permitimos propiedades extra por flexibilidad
        properties: {
          page: { type: 'integer' },
          size: { type: 'integer' },
          q: { type: ['string', 'null'] },
          from_date: { type: ['string', 'null'] },
          to_date: { type: ['string', 'null'] },
          updated_from: { type: ['string', 'null'] },
          updated_to: { type: ['string', 'null'] },
          
          // Alias (Strings)
          cat_status_lead: { type: ['string', 'null'] },
          cat_channel: { type: ['string', 'null'] },
          cat_interest_level: { type: ['string', 'null'] },
          cat_query: { type: ['string', 'null'] },
          cat_last_follow: { type: ['string', 'null'] },
          cat_type_program: { type: ['string', 'null'] },
          cat_model_modality: { type: ['string', 'null'] },
          
          // Textos
          program_text: { type: ['string', 'null'] },
          
          // Array de IDs de usuarios
          owner_user_ids: { 
            type: ['array', 'null'],
            items: { type: 'integer' } 
          }
        }
      }
    }
  }, async (req, reply) => {
    const data = await comercialService.leadList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // RUTA DE UPLOAD CORREGIDA
  fastify.post('/enrollment/upload', async (req, reply) => {
    const parts = req.parts();
    
    let enrollment_id = null;
    let paymentFileObj = null;
    let studentFileObj = null;

    // Iteramos los campos y archivos
    for await (const part of parts) {
      
      if (part.type === 'field') {
        // Campos de texto (enrollment_id)
        if (part.fieldname === 'enrollment_id') {
          enrollment_id = part.value;
        }
      } else if (part.type === 'file') {
        // Archivos: LOS CONSUMIMOS INMEDIATAMENTE
        // Esto evita que el bucle se congele
        const buffer = await part.toBuffer();
        
        // Guardamos un objeto simple con el buffer y el nombre
        const fileData = {
            filename: part.filename,
            mimetype: part.mimetype,
            buffer: buffer
        };

        if (part.fieldname === 'payment_file') {
          paymentFileObj = fileData;
        } else if (part.fieldname === 'student_file') {
          studentFileObj = fileData;
        }
      }
    }

    if (!enrollment_id) {
      return reply.code(400).send({ error: 'enrollment_id is required' });
    }

    // Llamamos al servicio pasando los objetos con buffer
    const result = await comercialService.uploadEnrollmentFiles({
      enrollment_id,
      paymentFile: paymentFileObj,
      studentFile: studentFileObj
    });

    return reply.send(result);
  });

  fastify.post('/searchcontact', {
    schema: {
      body: {
        type: 'object',
        required: ['phone'], // El teléfono es obligatorio
        additionalProperties: false,
        properties: {
          phone: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { phone } = req.body
    
    // Llamamos al servicio que consulta la DB
    const data = await comercialService.searchContact({ phone })
    
    // Devolvemos la data lista para que el front pinte los campos
    // data será algo como: { status: 'found_legacy', t_lead: 'COMUNIDAD', full_name: 'Juan Perez', ... }
    return reply.code(200).send({ ok: true, data })
  })

}