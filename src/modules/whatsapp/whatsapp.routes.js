import { registerRawJsonParser, verifyMetaSignature } from './whatsapp.verify.js'
import { authenticate, hasSubmoduleOrRole } from '../../shared/http/auth.middleware.js'
import { LEADER_ROLES } from './whatsapp.entity.js'
import * as schemas from './whatsapp.schemas.js'
import * as ctrl from './whatsapp.controller.js'

// El bot trabaja como un asesor más y por ahora lo opera solo Líder Comercial.
// Por submódulo: abrírselo a otro rol es una casilla en Roles y Permisos, no un deploy.
const BANDEJA = hasSubmoduleOrRole('COMERCIAL', 'WHATSAPP_BANDEJA', LEADER_ROLES)
const CONFIG = hasSubmoduleOrRole('COMERCIAL', 'WHATSAPP_CONFIG', LEADER_ROLES)

export default async function whatsappRoutes (fastify) {
  registerRawJsonParser(fastify)

  // El webhook no lleva JWT: lo llama Meta y se autentica con la firma del App Secret.
  fastify.get('/webhook', ctrl.verifySubscriptionHandler)
  fastify.post('/webhook', { preHandler: [verifyMetaSignature] }, ctrl.webhookHandler)

  // Bandeja y configuración del ERP: plugin hijo para que el JWT no toque el webhook.
  fastify.register(async erp => {
    erp.addHook('preHandler', authenticate)
    erp.post('/conversaciones', { schema: schemas.listConversationsSchema, preHandler: BANDEJA }, ctrl.listConversationsHandler)
    erp.post('/conversaciones/detalle', { schema: schemas.conversationSchema, preHandler: BANDEJA }, ctrl.conversationHandler)
    erp.post('/conversaciones/responder', { schema: schemas.replySchema, preHandler: BANDEJA }, ctrl.replyHandler)
    erp.post('/config', { preHandler: CONFIG }, ctrl.settingsHandler)
    erp.post('/config/numero', { schema: schemas.saveNumberSchema, preHandler: CONFIG }, ctrl.saveNumberHandler)
    erp.post('/config/programa', { schema: schemas.saveProgramAdvisorSchema, preHandler: CONFIG }, ctrl.saveProgramAdvisorHandler)
    erp.post('/config/programa/quitar', { schema: schemas.programSchema, preHandler: CONFIG }, ctrl.deleteProgramAdvisorHandler)
    // La corre el cron cada 5 min; el botón es para quien opera el bot (prueba, cron apagado).
    erp.post('/derivaciones/ejecutar', { preHandler: CONFIG }, ctrl.runHandoffsHandler)
  })
}
