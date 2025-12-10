// src/routes/customers.js
import customerService from '../services/customer.service.js'

export default async function customerRoutes (fastify) {
  
  // registrar cliente
  fastify.post('/customerregister', {
    schema: {
      body: {
        type: 'object',
        required: ['customer'],
        additionalProperties: false,
        properties: {
          customer: {
            type: 'object',
            additionalProperties: false,
            properties: {
              // Campos generales / identificación
              document_number:    { type: ['string','null'] },
              active:             { type: ['boolean','string','null'] }, // Acepta 'Y' o true
              
              // Campos Persona
              person_id:          { type: ['integer','null'] }, // Si ya existe la persona
              first_name:         { type: ['string','null'] },
              last_name:          { type: ['string','null'] },
              mother_last_name:   { type: ['string','null'] },
              cat_occupation:     { type: ['integer','null'] },
              cat_type_document:  { type: ['integer','null'] }, // Sirve para ambos
              cat_person_status:  { type: ['integer','null'] },
              cat_country:        { type: ['integer','null'] },

              // Campos Empresa
              company_id:         { type: ['integer','null'] }, // Si ya existe la empresa
              razon_social:       { type: ['string','null'] },
              razon_comercial:    { type: ['string','null'] },

              // Campos Cliente
              cat_customer_segment: { type: ['integer','null'] },
              cat_customer_status:  { type: ['integer','null'] }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const payload = req.body
    const { customer_id } = await customerService.customerRegister(payload)
    return reply.code(201).send({ ok: true, customer_id })
  })

  // listar clientes
  fastify.post('/customerlist', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          active:               { type: ['string','null'] }, // 'Y' o 'N'
          cat_customer_segment: { type: ['integer','null'] },
          cat_customer_status:  { type: ['integer','null'] },
          q:                    { type: ['string','null'] },
          page:                 { type: ['integer','null'], default: 1 },
          size:                 { type: ['integer','null'], default: 25 }
        }
      }
    }
  }, async (req, reply) => {
    const data = await customerService.customerList(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // obtener cliente por id
  fastify.post('/customerget', {
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
    const { data } = await customerService.customerGet(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  // actualizar cliente
  fastify.post('/customerupdate', {
    schema: {
      body: {
        type: 'object',
        required: ['id','customer'],
        additionalProperties: false,
        properties: {
          id: { type: 'integer' },
          customer: {
            type: 'object',
            additionalProperties: false,
            properties: {
              // Misma estructura que register, pero todo es opcional para update parcial
              document_number:      { type: ['string','null'] },
              active:               { type: ['string','boolean','null'] },
              
              first_name:           { type: ['string','null'] },
              last_name:            { type: ['string','null'] },
              mother_last_name:     { type: ['string','null'] },
              cat_occupation:       { type: ['integer','null'] },
              cat_type_document:    { type: ['integer','null'] },
              cat_person_status:    { type: ['integer','null'] },
              cat_country:          { type: ['integer','null'] },

              razon_social:         { type: ['string','null'] },
              razon_comercial:      { type: ['string','null'] },

              cat_customer_segment: { type: ['integer','null'] },
              cat_customer_status:  { type: ['integer','null'] }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const { customer_id } = await customerService.customerUpdate(req.body)
    return reply.code(200).send({ ok: true, customer_id })
  })

  // caller para selects
  fastify.post('/customercaller', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          q:      { type: ['string', 'null'] },
          active: { type: ['string', 'null'], default: 'Y' }
        }
      }
    }
  }, async (req, reply) => {
    const data = await customerService.customerCaller(req.body)
    return reply.code(200).send({ ok: true, data })
  })

  //SUNATGET
  fastify.post('/sunatget', async (req, reply) => {
    const { document } = req.body // Suponiendo que el document viene en el body
    const token = '0d2b243a-9ff4-437a-aa6c-5dc2d209269e-f36a909e-caac-4018-a125-560262c9cb3f' // Tu token

    const payload = {
      token: token,
      ...(String(document).length === 11 ? { ruc: document } : { dni: document })
    }

    try {
      const response = await fetch('https://ruc.com.pe/api/v1/consultas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
      const apiResponse = await response.json()

      if (!apiResponse.success) {
        throw new Error(apiResponse.message || 'La consulta a la API de RUC.com.pe no fue exitosa.')
      }

      let mappedData = {}
      if (apiResponse.ruc) {
        // Es una consulta RUC
        mappedData = {
          document_type: 'RUC',
          document_number: apiResponse.ruc,
          nombre_o_razon_social: apiResponse.nombre_o_razon_social
        }
      } else if (apiResponse.dni) {
        mappedData = {
          document_type: 'DNI',
          document_number: apiResponse.dni,
          nombre_o_razon_social: apiResponse.nombre_completo
        }
      } else {
        throw new Error('Tipo de documento no reconocido en la respuesta de la API.')
      }
      
      return reply.code(200).send({ ok: true, data: mappedData })
      
    } catch (error) {
      fastify.log.error(`Error consultando SUNAT para document ${document}:`, error)
      return reply.code(500).send({ ok: false, message: error.message || 'Error al consultar SUNAT' })
    }
    
  })
}