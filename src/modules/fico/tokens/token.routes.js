import { authenticate, hasRole } from '../../../shared/http/auth.middleware.js'
import {
  createTokenSchema, updateTokenSchema, markPaidSchema, confirmTokenSchema,
  groupTokensSchema, editInscriptionSchema, ungroupSchema
} from './token.schemas.js'
import * as ctrl from './token.controller.js'

// FUNDACION/LIDER_FUNDACION y B2B entran aqui porque /fundacion/leads y
// /b2b/leads montan el mismo formulario que comercial (useLeadForm) y su boton
// INSCRIPCION TOKEN pega a estos endpoints. Sin ellos el asesor veia
// "Acceso denegado" (403) al Crear Token.
const VIEW_ROLES = ['ADMIN', 'GERENCIA', 'FICO', 'LIDER_FICO', 'LIDER_COMERCIAL', 'COMERCIAL', 'FUNDACION', 'LIDER_FUNDACION', 'B2B']
const CREATE_ROLES = ['ADMIN', 'FICO', 'LIDER_FICO', 'LIDER_COMERCIAL', 'COMERCIAL', 'FUNDACION', 'LIDER_FUNDACION', 'B2B']
const LINK_ROLES = ['ADMIN', 'FICO', 'LIDER_FICO', 'LIDER_COMERCIAL']
const CONFIRM_ROLES = ['ADMIN', 'FICO', 'LIDER_FICO']

export default async function tokenRoutes (fastify) {
  fastify.get('/list', { preHandler: [authenticate, hasRole(VIEW_ROLES)] }, ctrl.listHandler)
  fastify.get('/stats', { preHandler: [authenticate, hasRole(VIEW_ROLES)] }, ctrl.statsHandler)
  fastify.get('/:id', { preHandler: [authenticate, hasRole(VIEW_ROLES)] }, ctrl.getByIdHandler)

  fastify.post('/create', { preHandler: [authenticate, hasRole(CREATE_ROLES)], schema: createTokenSchema }, ctrl.createHandler)
  fastify.put('/update', { preHandler: [authenticate, hasRole(LINK_ROLES)], schema: updateTokenSchema }, ctrl.updateHandler)
  fastify.post('/markpaid', { preHandler: [authenticate, hasRole(CONFIRM_ROLES)], schema: markPaidSchema }, ctrl.markPaidHandler)
  fastify.post('/confirm', { preHandler: [authenticate, hasRole(CONFIRM_ROLES)], schema: confirmTokenSchema }, ctrl.confirmHandler)
  fastify.delete('/delete/:id', { preHandler: [authenticate, hasRole(LINK_ROLES)] }, ctrl.deleteHandler)
  fastify.post('/group', { preHandler: [authenticate, hasRole(CREATE_ROLES)], schema: groupTokensSchema }, ctrl.groupHandler)
  fastify.put('/edit-inscription', { preHandler: [authenticate, hasRole(CREATE_ROLES)], schema: editInscriptionSchema }, ctrl.editInscriptionHandler)
  fastify.post('/ungroup', { preHandler: [authenticate, hasRole(CREATE_ROLES)], schema: ungroupSchema }, ctrl.ungroupHandler)
}
