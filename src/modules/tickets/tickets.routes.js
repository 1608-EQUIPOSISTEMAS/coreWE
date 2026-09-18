import { authenticate, ADMIN_ONLY, ALL_TICKETS_INTERNO } from '../../shared/http/auth.middleware.js'
import {
  listSchema, detailSchema, commentsSchema, statusSchema, assigneesSchema,
  reassignSchema, slaPoliciesSchema, slaPolicySaveSchema, attachmentSchema
} from './tickets.schemas.js'
import * as ctrl from './tickets.controller.js'
import { registrarParserSlack, verificarFirmaSlack } from './slack/slack.verify.js'
import { slashCommandHandler } from './slack/slack.command.js'

// Subir archivos es mas caro que una consulta: limite propio, mas holgado que
// el global por segundo pero acotado en el rato.
const LIMITE_SUBIDA = { rateLimit: { max: 40, timeWindow: '15 minutes' } }

export default async function ticketsRoutes (fastify) {
  // ── Lectura y alta: cualquier usuario con el modulo TICKETS ──────────────
  //
  // La autorizacion de que TICKETS ve cada quien sigue siendo de DATOS, no de
  // ruta: ticketScopeFor decide (ADMIN y GERENCIA todo, un lider lo de su
  // area, el resto lo suyo) y assertCanRead vuelve a preguntarlo en cada
  // recurso que entra por id. Pero entrar al modulo si es un gate de ruta:
  // ALL_TICKETS_INTERNO respeta la matriz de Roles y Permisos (modulo
  // TICKETS) y solo ADMIN la esquiva siempre.
  fastify.post('/list', { schema: listSchema, preHandler: [authenticate, ALL_TICKETS_INTERNO] }, ctrl.listHandler)
  fastify.post('/detail', { schema: detailSchema, preHandler: [authenticate, ALL_TICKETS_INTERNO] }, ctrl.detailHandler)
  fastify.post('/comments', { schema: commentsSchema, preHandler: [authenticate, ALL_TICKETS_INTERNO] }, ctrl.commentsHandler)

  // Multipart: sin schema.body (AJV con removeAdditional lo vaciaria). Validan
  // tickets.entity y tickets.files.
  fastify.post('/create', { config: LIMITE_SUBIDA, preHandler: [authenticate, ALL_TICKETS_INTERNO] }, ctrl.createHandler)
  fastify.post('/comment', { config: LIMITE_SUBIDA, preHandler: [authenticate, ALL_TICKETS_INTERNO] }, ctrl.commentCreateHandler)

  // Los adjuntos no se sirven como estaticos: pasan por aca para heredar el
  // control de acceso del ticket al que pertenecen.
  fastify.get('/attachment/:attachmentId', { schema: attachmentSchema, preHandler: [authenticate, ALL_TICKETS_INTERNO] }, ctrl.attachmentHandler)
  fastify.get('/comment-attachment/:attachmentId', { schema: attachmentSchema, preHandler: [authenticate, ALL_TICKETS_INTERNO] }, ctrl.commentAttachmentHandler)

  // ── Gestion: solo ADMIN ──────────────────────────────────────────────────
  //
  // ADMIN_ONLY se reutiliza tal cual de auth.hooks. No hace falta un gate nuevo
  // y asi se evita el problema de apilar varios hasRole (que los AND-ea).
  // Mover el estado exige ademas ser el agente asignado: lo comprueba nextStatus.
  fastify.post('/status', { schema: statusSchema, preHandler: [authenticate, ADMIN_ONLY] }, ctrl.statusHandler)
  fastify.post('/assignees', { schema: assigneesSchema, preHandler: [authenticate, ADMIN_ONLY] }, ctrl.assigneesHandler)
  fastify.post('/reassign', { schema: reassignSchema, preHandler: [authenticate, ADMIN_ONLY] }, ctrl.reassignHandler)
  fastify.post('/sla/policies', { schema: slaPoliciesSchema, preHandler: [authenticate, ADMIN_ONLY] }, ctrl.slaPoliciesHandler)
  fastify.post('/sla/policy-save', { schema: slaPolicySaveSchema, preHandler: [authenticate, ADMIN_ONLY] }, ctrl.slaPolicySaveHandler)

  // ── Slash command de Slack ───────────────────────────────────────────────
  //
  // Sub-plugin encapsulado: el parser de urlencoded solo rige aca dentro, no
  // cambia como parsea el resto de la aplicacion. No lleva authenticate (Slack
  // no tiene JWT): la autenticidad la da la firma HMAC del request.
  //
  // Si faltan las credenciales la ruta no se monta, igual que en el sistema
  // origen: mejor un 404 claro que un endpoint que siempre responde 503.
  if (process.env.SLACK_SIGNING_SECRET && process.env.SLACK_BOT_TOKEN) {
    await fastify.register(async (slack) => {
      registrarParserSlack(slack)
      slack.post('/commands', {
        schema: { tags: ['Tickets'], summary: 'Slash command /ticket (lo llama Slack, no el ERP)' },
        preHandler: [verificarFirmaSlack]
      }, slashCommandHandler)
    }, { prefix: '/slack' })
  } else {
    fastify.log?.warn?.('[tickets] SLACK_SIGNING_SECRET o SLACK_BOT_TOKEN sin configurar: /ticket deshabilitado')
  }
}
