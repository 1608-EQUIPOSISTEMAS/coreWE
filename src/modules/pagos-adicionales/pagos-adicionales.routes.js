import { authenticate, hasSubmoduleOrRole, hasRole } from '../../shared/http/auth.middleware.js'
import { consultar, detalle, registrar, editar, anular } from './pagos-adicionales.usecases.js'
import { LINEAS, ESTADOS, MONEDAS, ASUNTOS } from './pagos-adicionales.entity.js'

// Submodulo de Finanzas con casilla propia en la matriz (FICO >
// PAGOS_ADICIONALES, scripts/seed-pagos-adicionales.sql). Quien lo ve lo decide
// la matriz de Roles y Permisos; sin casilla solo entra ADMIN (el modulo aun no
// esta habilitado para el resto). Ademas: registrar y editar piden un rol de
// FICO y anular, LIDER_FICO; asi GERENCIA solo consulta aunque tenga la casilla.
const VE = hasSubmoduleOrRole('FICO', 'PAGOS_ADICIONALES', ['ADMIN'])
const REGISTRA = [VE, hasRole(['ADMIN', 'LIDER_FICO', 'FICO'])]
const ANULA = [VE, hasRole(['ADMIN', 'LIDER_FICO'])]

const MES = { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }
const ID = { type: 'integer', minimum: 1 }
const TEXTO = max => ({ type: ['string', 'null'], maxLength: max })
// api.js del front lo inyecta en todo POST; la identidad sale del token.
const USER_ID = { type: 'integer' }

const PAGO = {
  business_line: { type: 'string', enum: LINEAS },
  program: { type: 'string', minLength: 1, maxLength: 150 },
  subject: { type: 'string', enum: ASUNTOS },
  payment_date: { type: 'string', format: 'date' },
  full_name: { type: 'string', minLength: 1, maxLength: 200 },
  phone: TEXTO(30),
  email: TEXTO(200),
  status: { type: 'string', enum: ESTADOS },
  done: { type: 'boolean' },
  amount: { type: 'number', minimum: 0, maximum: 9999999 },
  currency: { type: 'string', enum: MONEDAS },
  cat_payment_medium: { type: ['integer', 'null'] },
  cat_business_entity: { type: ['integer', 'null'] },
  bank_account_id: { type: ['integer', 'null'] },
  transaction_code: TEXTO(60),
  product_line: TEXTO(40),
  payment_type: TEXTO(20)
}
const REQUERIDOS = ['business_line', 'program', 'subject', 'payment_date', 'full_name', 'amount', 'currency']

const tags = ['Pagos Adicionales']

const consultaSchema = {
  tags,
  summary: 'Pagos adicionales del rango de meses',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['desde'],
    properties: { desde: MES, hasta: MES, user_id: USER_ID }
  }
}

const detalleSchema = {
  tags,
  summary: 'Un pago adicional (para editarlo)',
  body: { type: 'object', additionalProperties: false, required: ['additional_payment_id'], properties: { additional_payment_id: ID, user_id: USER_ID } }
}

const registrarSchema = {
  tags,
  summary: 'Registra un pago adicional',
  body: { type: 'object', additionalProperties: false, required: REQUERIDOS, properties: { ...PAGO, user_id: USER_ID } }
}

const editarSchema = {
  tags,
  summary: 'Edita un pago adicional',
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['additional_payment_id', ...REQUERIDOS],
    properties: { additional_payment_id: ID, ...PAGO, user_id: USER_ID }
  }
}

const anularSchema = {
  tags,
  summary: 'Anula (baja lógica) un pago adicional',
  body: { type: 'object', additionalProperties: false, required: ['additional_payment_id'], properties: { additional_payment_id: ID, user_id: USER_ID } }
}

export default async function pagosAdicionalesRoutes (fastify) {
  fastify.post('/consulta', { schema: consultaSchema, preHandler: [authenticate, VE] }, async (req, reply) => {
    return reply.code(200).send({ ok: true, data: await consultar(req.body) })
  })
  fastify.post('/detalle', { schema: detalleSchema, preHandler: [authenticate, VE] }, async (req, reply) => {
    return reply.code(200).send({ ok: true, data: await detalle(req.body.additional_payment_id) })
  })
  fastify.post('/registrar', { schema: registrarSchema, preHandler: [authenticate, ...REGISTRA] }, async (req, reply) => {
    return reply.code(201).send({ ok: true, data: await registrar(req.body, req.user.id) })
  })
  fastify.post('/editar', { schema: editarSchema, preHandler: [authenticate, ...REGISTRA] }, async (req, reply) => {
    const { additional_payment_id: id, ...pago } = req.body
    return reply.code(200).send({ ok: true, data: await editar(id, pago, req.user.id) })
  })
  fastify.post('/anular', { schema: anularSchema, preHandler: [authenticate, ...ANULA] }, async (req, reply) => {
    return reply.code(200).send({ ok: true, data: await anular(req.body.additional_payment_id, req.user.id) })
  })
}
