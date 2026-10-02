import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  elegirDocumento, textoParaElegir, vencimiento, textoDeCierre, RESPUESTA_MANUAL, PREGUNTA_VENCIDA
} from '../ticket-manual.entity.js'
import { ofrecerManual, responderManual, runManualSweep } from '../ticket-manual.usecases.js'

const AHORA = new Date('2026-10-02T15:00:00Z')

const DOCUMENTOS = [
  { ticket_document_id: 3, title: 'Qué hacer si los datos del Sheets no cargan', description: 'Base de ventas desactualizada: cómo forzar la recarga', kind: 'ENLACE', url: 'https://docs.test/sheets' },
  { ticket_document_id: 5, title: 'Cómo registrar una venta B2B', kind: 'PDF', url: null }
]

const ticket = (o = {}) => ({
  ticket_id: 42, title: 'El Sheets de ventas no carga datos', problem: 'Desde ayer la base no está actualizada',
  slack_channel_id: 'D1', manual_document_id: 3, manual_message_ts: '99.1', status: 'ABIERTO', ...o
})

describe('ticket-manual.entity', () => {
  it('solo acepta un id de la lista que se le dio al modelo', () => {
    expect(elegirDocumento({ document_id: 3 }, DOCUMENTOS)).toBe(DOCUMENTOS[0])
    expect(elegirDocumento({ document_id: 0 }, DOCUMENTOS)).toBeNull()
    expect(elegirDocumento({ document_id: 999 }, DOCUMENTOS)).toBeNull()
    expect(elegirDocumento({ document_id: '3' }, DOCUMENTOS)).toBe(DOCUMENTOS[0])
    expect(elegirDocumento(null, DOCUMENTOS)).toBeNull()
  })

  it('le muestra al modelo el ticket y los títulos con su id', () => {
    const texto = textoParaElegir(ticket(), DOCUMENTOS)
    expect(texto).toMatch(/El Sheets de ventas no carga datos/)
    expect(texto).toMatch(/3 \| Qué hacer si los datos del Sheets no cargan \| Base de ventas desactualizada/)
    expect(texto).toMatch(/5 \| Cómo registrar una venta B2B \| \(sin descripcion\)/)
  })

  it('el plazo son 7 minutos desde el envío', () => {
    expect(vencimiento(AHORA, 7).toISOString()).toBe('2026-10-02T15:07:00.000Z')
  })

  it('cada desenlace tiene su texto, con el enlace para reabrir', () => {
    const datos = { codigo: '00042', titulo: 'Datos que no cargan', url: 'https://erp.test/tickets/42', minutos: 7 }
    expect(textoDeCierre(RESPUESTA_MANUAL.SI, datos)).toMatch(/resuelto[\s\S]*https:\/\/erp\.test/)
    expect(textoDeCierre(RESPUESTA_MANUAL.NO, datos)).toMatch(/sigue abierto/)
    expect(textoDeCierre(RESPUESTA_MANUAL.SIN_RESPUESTA, datos)).toMatch(/7 minutos sin respuesta/)
  })
})

describe('ofrecerManual', () => {
  let repo, slack, ia

  beforeEach(() => {
    repo = {
      listDocuments: vi.fn(async () => DOCUMENTOS),
      document: vi.fn(async id => ({ ...DOCUMENTOS.find(d => d.ticket_document_id === id), stored_name: 'abc.pdf', original_name: 'venta.pdf' })),
      saveManualOffer: vi.fn(async () => {})
    }
    slack = {
      slackBotConfigurado: () => true,
      subirArchivoADm: vi.fn(async () => true),
      postearMensaje: vi.fn(async () => ({ canal: 'D1', ts: '123.4' }))
    }
    ia = vi.fn(async () => ({ document_id: 3 }))
  })

  const ofrecer = (o = {}) => ofrecerManual(ticket(), 'D1', {
    repo, slack, ia, iaLista: () => true, leerArchivo: async () => Buffer.from('%PDF'), ahora: () => AHORA, env: {}, ...o
  })

  it('envía el manual con la pregunta y sella el plazo después de que llegó', async () => {
    expect(await ofrecer()).toBe(DOCUMENTOS[0])

    const payload = slack.postearMensaje.mock.calls[0][1]
    expect(JSON.stringify(payload.blocks)).toMatch(/https:\/\/docs\.test\/sheets/)
    expect(repo.saveManualOffer).toHaveBeenCalledWith(42, {
      documentId: 3, sentAt: AHORA, deadlineAt: new Date('2026-10-02T15:07:00Z'), messageTs: '123.4'
    })
    expect(slack.subirArchivoADm).not.toHaveBeenCalled()
  })

  it('un PDF se sube al DM antes de preguntar', async () => {
    ia.mockResolvedValue({ document_id: 5 })
    await ofrecer()
    expect(slack.subirArchivoADm).toHaveBeenCalledWith('D1', expect.objectContaining({ nombre: 'venta.pdf' }))
    expect(repo.saveManualOffer).toHaveBeenCalled()
  })

  it('si el PDF no se pudo subir, no pregunta nada', async () => {
    ia.mockResolvedValue({ document_id: 5 })
    slack.subirArchivoADm.mockResolvedValue(false)
    expect(await ofrecer()).toBeNull()
    expect(slack.postearMensaje).not.toHaveBeenCalled()
  })

  it('sin un manual que corresponda, no envía nada', async () => {
    ia.mockResolvedValue({ document_id: 0 })
    expect(await ofrecer()).toBeNull()
    expect(slack.postearMensaje).not.toHaveBeenCalled()
  })

  it('si la pregunta no llegó, no queda plazo corriendo: nadie cierra por un silencio que no existió', async () => {
    slack.postearMensaje.mockResolvedValue(null)
    expect(await ofrecer()).toBeNull()
    expect(repo.saveManualOffer).not.toHaveBeenCalled()
  })

  it('se puede apagar por env', async () => {
    expect(await ofrecer({ env: { TICKETS_MANUAL_DISABLED: 'true' } })).toBeNull()
    expect(ia).not.toHaveBeenCalled()
  })

  it('nunca lanza: un fallo deja el ticket seguir su curso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    repo.listDocuments.mockRejectedValue(new Error('db caida'))
    expect(await ofrecer()).toBeNull()
  })
})

describe('responderManual / runManualSweep', () => {
  let repo, slack, onCambio

  beforeEach(() => {
    repo = {
      detail: vi.fn(async () => ticket()),
      document: vi.fn(async () => ({ title: 'Datos que no cargan' })),
      resolveByManual: vi.fn(async () => 'ABIERTO'),
      declineManual: vi.fn(async () => true),
      expiredManualOffers: vi.fn(async () => [{ ticket_id: 42 }])
    }
    slack = {
      enlaceAlTicket: id => `https://erp.test/tickets/${id}`,
      notificarTicketCerrado: vi.fn(async () => true),
      actualizarMensaje: vi.fn(async () => true)
    }
    onCambio = vi.fn()
  })

  const deps = { get repo () { return repo }, get slack () { return slack }, get onCambio () { return onCambio }, ahora: () => AHORA }

  it('"Sí" cierra el ticket y avisa al canal', async () => {
    const texto = await responderManual({ ticketId: 42, canal: 'D1', resuelto: true }, { ...deps })
    expect(repo.resolveByManual).toHaveBeenCalledWith(42, 'RESUELTO', AHORA)
    expect(slack.notificarTicketCerrado).toHaveBeenCalled()
    expect(onCambio).toHaveBeenCalledWith(42)
    expect(texto).toMatch(/Datos que no cargan/)
  })

  it('"No" deja el ticket abierto', async () => {
    const texto = await responderManual({ ticketId: 42, canal: 'D1', resuelto: false }, { ...deps })
    expect(repo.declineManual).toHaveBeenCalledWith(42, AHORA)
    expect(repo.resolveByManual).not.toHaveBeenCalled()
    expect(texto).toMatch(/sigue abierto/)
  })

  it('desde otro DM no se puede responder por el ticket', async () => {
    expect(await responderManual({ ticketId: 42, canal: 'D9', resuelto: true }, { ...deps })).toBe(PREGUNTA_VENCIDA)
    expect(repo.resolveByManual).not.toHaveBeenCalled()
  })

  it('si ya se respondió o venció, lo dice y no toca nada', async () => {
    repo.resolveByManual.mockResolvedValue(null)
    expect(await responderManual({ ticketId: 42, canal: 'D1', resuelto: true }, { ...deps })).toBe(PREGUNTA_VENCIDA)
    expect(slack.notificarTicketCerrado).not.toHaveBeenCalled()
  })

  it('pasado el plazo sin respuesta, da el ticket por resuelto y quita los botones', async () => {
    expect(await runManualSweep(AHORA, { ...deps })).toBe(1)
    expect(repo.resolveByManual).toHaveBeenCalledWith(42, 'SIN_RESPUESTA', AHORA)
    expect(slack.notificarTicketCerrado).toHaveBeenCalled()
    expect(slack.actualizarMensaje).toHaveBeenCalledWith('D1', '99.1', expect.stringMatching(/sin respuesta/))
  })

  it('si un agente ya lo había cerrado, no repite el aviso de cierre', async () => {
    repo.resolveByManual.mockResolvedValue('CERRADO')
    await runManualSweep(AHORA, { ...deps })
    expect(slack.notificarTicketCerrado).not.toHaveBeenCalled()
  })

  it('si el botón ganó el candado entre la consulta y el cierre, no cuenta', async () => {
    repo.resolveByManual.mockResolvedValue(null)
    expect(await runManualSweep(AHORA, { ...deps })).toBe(0)
    expect(slack.actualizarMensaje).not.toHaveBeenCalled()
  })
})
