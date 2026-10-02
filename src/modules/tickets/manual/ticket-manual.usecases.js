import { readFile } from 'node:fs/promises'
import { ticketsRepository } from '../tickets.repository.js'
import { attachmentPath } from '../tickets.files.js'
import { formatTicketCode } from '../tickets.entity.js'
import * as defaultSlack from '../../../shared/adapters/slack/tickets-slack.adapter.js'
import { generarJson, geminiConfigurado } from '../../../shared/adapters/ai/gemini.adapter.js'
import { bloquesDeManual } from '../slack/slack.blocks.js'
import {
  INSTRUCCION_MANUAL, SCHEMA_MANUAL, RESPUESTA_MANUAL, VENTANA_MANUAL_MINUTOS, PREGUNTA_VENCIDA,
  textoParaElegir, elegirDocumento, vencimiento, textoDeCierre
} from './ticket-manual.entity.js'

// Orquestacion del manual como solucion (reglas en ticket-manual.entity.js).
// Todo best-effort: si algo falla el ticket sigue su curso normal con el
// agente, que es exactamente lo que pasaba antes de que esto existiera.
//
// Las dependencias entran por parametro (con defaults) para testearlo sin BD
// ni Slack, igual que ai-note/. `onCambio` es el aviso en vivo (SSE) de
// tickets.usecases: se recibe en vez de importarse para no crear un ciclo.

// APAGABLE: TICKETS_MANUAL_DISABLED=true deja de ofrecer manuales.
export const manualHabilitado = (env = process.env) => env.TICKETS_MANUAL_DISABLED !== 'true'

const deps = (o = {}) => ({
  repo: ticketsRepository,
  slack: defaultSlack,
  ia: generarJson,
  iaLista: geminiConfigurado,
  leerArchivo: async storedName => readFile(await attachmentPath(storedName)),
  onCambio: () => {},
  ...o
})

/**
 * Busca un manual para el ticket recien creado y, si hay uno, lo envia al DM
 * con la pregunta y el plazo. La oferta se sella en la BD SOLO despues de que
 * la pregunta llego: un ticket nunca se cierra por silencio ante una pregunta
 * que nadie vio. Devuelve el documento enviado, o null.
 */
export async function ofrecerManual (ticket, canal, opciones = {}) {
  const { repo, slack, ia, iaLista, leerArchivo } = deps(opciones)
  const ahora = opciones.ahora ?? (() => new Date())

  try {
    if (!canal || !manualHabilitado(opciones.env) || !iaLista() || !slack.slackBotConfigurado()) return null

    const documentos = await repo.listDocuments()
    if (!documentos.length) return null

    const salida = await ia({
      instruccion: INSTRUCCION_MANUAL,
      texto: textoParaElegir(ticket, documentos),
      schema: SCHEMA_MANUAL,
      maxTokens: 40
    })
    const elegido = elegirDocumento(salida, documentos)
    if (!elegido) return null

    if (elegido.kind === 'PDF') {
      const documento = await repo.document(elegido.ticket_document_id)
      if (!documento?.stored_name) return null
      const subido = await slack.subirArchivoADm(canal, {
        buffer: await leerArchivo(documento.stored_name),
        nombre: documento.original_name || `${documento.title}.pdf`,
        titulo: documento.title
      })
      if (!subido) return null
    }

    const mensaje = await slack.postearMensaje(canal, bloquesDeManual({
      codigo: formatTicketCode(ticket.ticket_id),
      documento: elegido,
      minutos: VENTANA_MANUAL_MINUTOS,
      ticketId: ticket.ticket_id
    }))
    if (!mensaje) return null

    const enviadoEn = ahora()
    await repo.saveManualOffer(ticket.ticket_id, {
      documentId: elegido.ticket_document_id,
      sentAt: enviadoEn,
      deadlineAt: vencimiento(enviadoEn),
      messageTs: mensaje.ts
    })
    return elegido
  } catch (err) {
    console.error(`[tickets][manual] ticket #${ticket.ticket_id}:`, err.message)
    return null
  }
}

/**
 * Respuesta a los botones "Si / No". `canal` es el DM donde se pulso: tiene que
 * ser el del ticket, asi nadie responde por un ticket ajeno con un value armado
 * a mano. Devuelve el texto que reemplaza a la pregunta.
 */
export async function responderManual ({ ticketId, canal, resuelto }, opciones = {}) {
  const { repo, slack, onCambio } = deps(opciones)
  const ahora = (opciones.ahora ?? (() => new Date()))()

  const ticket = await repo.detail(ticketId)
  if (!ticket || !canal || ticket.slack_channel_id !== canal) return PREGUNTA_VENCIDA

  const datos = {
    codigo: formatTicketCode(ticket.ticket_id),
    titulo: await tituloDelManual(repo, ticket),
    url: slack.enlaceAlTicket(ticket.ticket_id)
  }

  if (!resuelto) {
    const habiaPregunta = await repo.declineManual(ticketId, ahora)
    return habiaPregunta ? textoDeCierre(RESPUESTA_MANUAL.NO, datos) : PREGUNTA_VENCIDA
  }

  const previo = await repo.resolveByManual(ticketId, RESPUESTA_MANUAL.SI, ahora)
  if (previo === null) return PREGUNTA_VENCIDA
  await avisarCierre(repo, slack, onCambio, ticketId, previo)
  return textoDeCierre(RESPUESTA_MANUAL.SI, datos)
}

/**
 * Barrido (cada minuto, desde tickets-autoassign.cron.js): las preguntas
 * vencidas sin respuesta cierran su ticket y la pregunta se reemplaza por el
 * aviso, sin botones. Devuelve cuantos cerro.
 */
export async function runManualSweep (ahora = new Date(), opciones = {}) {
  const { repo, slack, onCambio } = deps(opciones)
  const vencidas = await repo.expiredManualOffers(ahora)

  let cerrados = 0
  for (const { ticket_id: ticketId } of vencidas) {
    try {
      const previo = await repo.resolveByManual(ticketId, RESPUESTA_MANUAL.SIN_RESPUESTA, ahora)
      // Otro (el boton, otra replica) gano el candado entre la consulta y aca.
      if (previo === null) continue
      cerrados++

      const ticket = await avisarCierre(repo, slack, onCambio, ticketId, previo)
      if (ticket?.slack_channel_id && ticket.manual_message_ts) {
        await slack.actualizarMensaje(ticket.slack_channel_id, ticket.manual_message_ts, textoDeCierre(
          RESPUESTA_MANUAL.SIN_RESPUESTA, {
            codigo: formatTicketCode(ticketId),
            titulo: await tituloDelManual(repo, ticket),
            url: slack.enlaceAlTicket(ticketId)
          }))
      }
    } catch (err) {
      console.error(`[tickets][manual] cierre por silencio del ticket #${ticketId}:`, err.message)
    }
  }
  return cerrados
}

// El canal de tickets se entera del cierre como de cualquier otro, salvo que
// un agente ya lo hubiera cerrado (ese aviso ya salio).
async function avisarCierre (repo, slack, onCambio, ticketId, previo) {
  const ticket = await repo.detail(ticketId)
  onCambio(ticketId)
  if (previo !== 'CERRADO' && ticket) void slack.notificarTicketCerrado(ticket)
  return ticket
}

async function tituloDelManual (repo, ticket) {
  if (!ticket.manual_document_id) return 'enviado'
  const documento = await repo.document(ticket.manual_document_id)
  return documento?.title ?? 'enviado'
}
