import { authenticate, ADMIN_ONLY, ALL_TICKETS_INTERNO } from '../../shared/http/auth.middleware.js'
import {
  listSchema, detailSchema, commentsSchema, statusSchema, assigneesSchema,
  reassignSchema, slaPoliciesSchema, slaPolicySaveSchema, attachmentSchema
} from './tickets.schemas.js'
import * as ctrl from './tickets.controller.js'
import { registrarParserSlack, verificarFirmaSlack } from './slack/slack.verify.js'
import { eventsHandler } from './slack/slack.events.js'
import { interactionsHandler } from './slack/slack.interactions.js'

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
  // Nota IA: 'listo' desde la tabla, o 'generando' y el front vuelve a consultar.
  fastify.post('/ai-note', { schema: detailSchema, preHandler: [authenticate, ALL_TICKETS_INTERNO] }, ctrl.aiNoteHandler)

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

  // ── Slack ────────────────────────────────────────────────────────────────
  //
  // Sub-plugin encapsulado: los parsers de urlencoded y JSON solo rigen aca
  // dentro, no cambian como parsea el resto de la aplicacion. Ninguna de estas
  // rutas lleva authenticate (Slack no tiene JWT): la autenticidad la da la
  // firma HMAC del request, que es lo que verifica verificarFirmaSlack.
  //
  // Si faltan las credenciales las rutas no se montan, igual que en el sistema
  // origen: mejor un 404 claro que un endpoint que siempre responde 503.
  if (process.env.SLACK_SIGNING_SECRET && process.env.SLACK_BOT_TOKEN) {
    await fastify.register(async (slack) => {
      registrarParserSlack(slack)

      // Via principal: DM en texto plano al bot. Lo lee la IA y devuelve un
      // borrador con botones, que se resuelven en /interactions.
      slack.post('/events', {
        schema: { tags: ['Tickets'], summary: 'Events API: DM al bot (lo llama Slack, no el ERP)' },
        preHandler: [verificarFirmaSlack]
      }, eventsHandler)

      slack.post('/interactions', {
        schema: { tags: ['Tickets'], summary: 'Botones del borrador de ticket (lo llama Slack, no el ERP)' },
        preHandler: [verificarFirmaSlack]
      }, interactionsHandler)
    }, { prefix: '/slack' })
  } else {
    fastify.log?.warn?.('[tickets] SLACK_SIGNING_SECRET o SLACK_BOT_TOKEN sin configurar: bot de tickets por DM deshabilitado')
  }
}
