import { authenticate, hasSubmoduleOrRole, hasRole } from '../../shared/http/auth.middleware.js'
import {
  listScholarships, listCourses, registerScholarship, updateScholarship, deleteScholarship, activateScholarship
} from './fundacion-becas.usecases.js'
import { AGREEMENT_TYPES, SCHOLARSHIP_TYPES } from './fundacion-becas.entity.js'

// Expone DNI y contacto de los becarios (Ley 29733): entra quien tenga la casilla
// FUNDACION > BECAS en Roles y Permisos; sin casilla, solo ADMIN.
const VE_BECAS = hasSubmoduleOrRole('FUNDACION', 'BECAS', ['ADMIN'])
// Registrar y activar es trabajo de Fundacion: GERENCIA solo consulta.
const GESTIONA = [VE_BECAS, hasRole(['ADMIN', 'LIDER_FUNDACION', 'FUNDACION'])]

const text = (maxLength) => ({ type: 'string', minLength: 1, maxLength })
const optionalText = (maxLength) => ({ type: ['string', 'null'], maxLength })

const registerSchema = {
  tags: ['Fundacion Becas'],
  summary: 'Registra una beca (queda pendiente hasta activarla)',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['agreement_type', 'partner_name', 'beneficiary_name', 'document_number', 'program_id', 'scholarship_type'],
    properties: {
      agreement_type: { type: 'string', enum: AGREEMENT_TYPES },
      partner_name: text(150),
      beneficiary_name: text(200),
      document_number: { type: 'string', pattern: '^[0-9A-Za-z]{6,20}$' },
      email: { type: ['string', 'null'], maxLength: 150, format: 'email' },
      phone: optionalText(20),
      career: optionalText(150),
      program_id: { type: 'integer', minimum: 1 },
      program_edition_id: { type: ['integer', 'null'], minimum: 1 },
      scholarship_type: { type: 'string', enum: SCHOLARSHIP_TYPES },
      access_until: { type: ['string', 'null'], format: 'date' },
      // api.js del front lo inyecta en todo POST; la identidad sale del token.
      user_id: { type: 'integer' }
    }
  }
}

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } }

const activateSchema = { tags: ['Fundacion Becas'], summary: 'Marca la beca como activada hoy', params: idParams }
const updateSchema = { ...registerSchema, summary: 'Corrige los datos de una beca (no cambia su activacion)', params: idParams }
const deleteSchema = { tags: ['Fundacion Becas'], summary: 'Elimina una beca registrada por error', params: idParams }

export default async function fundacionBecasRoutes (fastify) {
  fastify.get('/', { preHandler: [authenticate, VE_BECAS] }, async (req, reply) => {
    return reply.send({ ok: true, data: await listScholarships() })
  })
  fastify.get('/cursos', { preHandler: [authenticate, ...GESTIONA] }, async (req, reply) => {
    return reply.send({ ok: true, data: await listCourses() })
  })
  fastify.post('/', { schema: registerSchema, preHandler: [authenticate, ...GESTIONA] }, async (req, reply) => {
    const { user_id: _ignored, ...data } = req.body
    const id = await registerScholarship(data, req.user.id)
    return reply.code(201).send({ ok: true, data: { scholarship_id: id } })
  })
  fastify.put('/:id', { schema: updateSchema, preHandler: [authenticate, ...GESTIONA] }, async (req, reply) => {
    const { user_id: _ignored, ...data } = req.body
    await updateScholarship(req.params.id, data)
    return reply.send({ ok: true })
  })
  fastify.delete('/:id', { schema: deleteSchema, preHandler: [authenticate, ...GESTIONA] }, async (req, reply) => {
    await deleteScholarship(req.params.id)
    return reply.send({ ok: true })
  })
  fastify.post('/:id/activar', { schema: activateSchema, preHandler: [authenticate, ...GESTIONA] }, async (req, reply) => {
    await activateScholarship(req.params.id)
    return reply.send({ ok: true })
  })
}
