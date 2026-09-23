import { createReadStream } from 'node:fs'
import * as usecases from './tickets.usecases.js'
import { readMultipart, attachmentPath } from './tickets.files.js'
import { toTicketDto, toCommentDto, toAssigneeDto, toActivityDto } from './tickets.dto.js'

// Unico lugar que sabe de HTTP. Traduce request -> caso de uso y resultado -> reply.
//
// La identidad SIEMPRE sale del token (req.user), nunca del body: api.js del
// frontend inyecta user_id en cada request y aceptarlo dejaria que cualquiera
// se hiciera pasar por otro cambiando un numero.
const quien = req => ({ roles: req.user?.roles ?? [], userId: req.user?.id })

export async function listHandler (req, reply) {
  const data = await usecases.listTickets({ ...quien(req), ...req.body })
  return reply.code(200).send({
    ok: true,
    data: { ...data, tickets: data.tickets.map(toTicketDto) }
  })
}

export async function detailHandler (req, reply) {
  const data = await usecases.ticketDetail({ ...quien(req), ticketId: req.body.ticket_id })
  return reply.code(200).send({ ok: true, data: toTicketDto(data) })
}

export async function createHandler (req, reply) {
  const { campos, archivos } = await readMultipart(req)
  const data = await usecases.createTicket({
    userId: req.user?.id,
    titulo: campos.titulo,
    problema: campos.problema,
    link: campos.link,
    archivos
  })
  return reply.code(201).send({ ok: true, message: 'Ticket creado', data: toTicketDto(data) })
}

export async function statusHandler (req, reply) {
  const data = await usecases.changeStatus({
    ...quien(req),
    ticketId: req.body.ticket_id,
    estado: req.body.estado
  })
  return reply.code(200).send({ ok: true, data: toTicketDto(data) })
}

export async function reopenHandler (req, reply) {
  const data = await usecases.reopenTicket({ ...quien(req), ticketId: req.body.ticket_id })
  return reply.code(200).send({ ok: true, message: 'Ticket reabierto', data: toTicketDto(data) })
}

export async function assigneesHandler (req, reply) {
  const data = await usecases.listAssignees(quien(req))
  return reply.code(200).send({ ok: true, data: data.map(toAssigneeDto) })
}

export async function reassignHandler (req, reply) {
  const data = await usecases.reassign({
    ...quien(req),
    ticketId: req.body.ticket_id,
    nuevoAsignadoId: req.body.asignado_a_id
  })
  return reply.code(200).send({ ok: true, message: 'Ticket reasignado', data: toTicketDto(data) })
}

export async function commentsHandler (req, reply) {
  const data = await usecases.listComments({ ...quien(req), ticketId: req.body.ticket_id })
  return reply.code(200).send({ ok: true, data: data.map(toCommentDto) })
}

export async function activityHandler (req, reply) {
  const data = await usecases.ticketActivity({ ...quien(req), ticketId: req.body.ticket_id })
  return reply.code(200).send({ ok: true, data: data.map(toActivityDto) })
}

export async function commentCreateHandler (req, reply) {
  const { campos, archivos } = await readMultipart(req)
  const data = await usecases.addComment({
    ...quien(req),
    ticketId: Number(campos.ticket_id),
    cuerpo: campos.cuerpo,
    archivos
  })
  return reply.code(201).send({ ok: true, data: data.map(toCommentDto) })
}

// Descarga: el adjunto se sirve por endpoint autenticado y no por @fastify/static
// (que ademas solo publica /uploads fuera de produccion), para que el control de
// acceso del ticket valga tambien para sus archivos.
export async function attachmentHandler (req, reply) {
  return enviarAdjunto(req, reply, 'ticket')
}

export async function commentAttachmentHandler (req, reply) {
  return enviarAdjunto(req, reply, 'comment')
}

async function enviarAdjunto (req, reply, kind) {
  const adjunto = await usecases.downloadAttachment({
    ...quien(req),
    attachmentId: Number(req.params.attachmentId),
    kind
  })
  const ruta = await attachmentPath(adjunto.stored_name)

  // El nombre original solo viaja en la cabecera; en disco el archivo es un UUID.
  const nombre = adjunto.original_name.replace(/["\\]/g, '')
  return reply
    .type(adjunto.mime_type)
    .header('Content-Disposition', `inline; filename="${encodeURIComponent(nombre)}"`)
    .send(createReadStream(ruta))
}

export async function aiNoteHandler (req, reply) {
  const data = await usecases.ticketAiNote({ ...quien(req), ticketId: req.body.ticket_id })
  return reply.send({ ok: true, data })
}
