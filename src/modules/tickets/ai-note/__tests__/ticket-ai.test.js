import { describe, it, expect } from 'vitest'
import { buildTicketFacts, parseTicketNote, noteFor, ticketFingerprint, MAX_FALTA } from '../ticket-ai.entity.js'
import { getTicketNote, startTicketNote } from '../ticket-ai.usecases.js'

const ON = { AI_TICKET_NOTES: 'true' }
const TICKET = { ticket_id: 5, title: 'No carga el cronograma', problem: 'Sale pantalla en blanco', link: null, adjuntos: 0, status: 'ABIERTO', area: 'Producto' }
const NOTA = { resumen: 'El cronograma no carga.', falta: ['Captura del error', 'Desde cuándo pasa'], respuesta_sugerida: 'Hola, lo revisamos. ¿Nos envías una captura?' }

describe('ticket-ai.entity', () => {
  it('los hechos dicen si hay link y adjuntos', () => {
    const f = buildTicketFacts({ ...TICKET, link: 'https://x', adjuntos: 2 })
    expect(f).toContain('Link adjunto: sí')
    expect(f).toContain('Archivos adjuntos: 2')
    expect(buildTicketFacts({ ...TICKET, creador: 'ROSA MARIA DIAZ' })).toContain('Quien reporta: Rosa (área Producto)')
  })

  it('parse: recorta "falta" y exige resumen y respuesta', () => {
    const p = parseTicketNote({ ...NOTA, falta: ['a b c', 'd e f', 'g h i', 'j k l', 12] })
    expect(p.falta).toHaveLength(MAX_FALTA)
    expect(parseTicketNote({ resumen: 'Algo pasa' })).toBeNull()
    expect(parseTicketNote({ ...NOTA, falta: 'no es lista' }).falta).toEqual([])
  })

  it('quien reporta no ve el borrador de respuesta; el agente sí', () => {
    expect(noteFor(NOTA, { canManage: false })).not.toHaveProperty('respuesta_sugerida')
    expect(noteFor(NOTA, { canManage: true })).toEqual(NOTA)
  })

  it('la huella cambia si se edita el contenido', () => {
    expect(ticketFingerprint(TICKET)).toBe(ticketFingerprint({ ...TICKET }))
    expect(ticketFingerprint({ ...TICKET, problem: 'otra cosa' })).not.toBe(ticketFingerprint(TICKET))
  })
})

function fakeRepo (guardada = null) {
  const repo = { guardadas: [], fetchNote: async () => guardada, saveNote: async (x) => { repo.guardadas.push(x) } }
  return repo
}

describe('ticket-ai.usecases', () => {
  it('apagado por defecto: ni genera ni lee', async () => {
    expect(await getTicketNote({ ticket: TICKET, canManage: true }, { repo: fakeRepo(), env: {} })).toEqual({ estado: 'apagado' })
    expect(await startTicketNote(TICKET, { repo: fakeRepo(), env: {} })).toBeNull()
  })

  it('nota al día: lista, filtrada según quién mira', async () => {
    const repo = fakeRepo({ fingerprint: ticketFingerprint(TICKET), payload: NOTA, generated_at: 'hoy' })
    const r = await getTicketNote({ ticket: TICKET, canManage: false }, { repo, env: ON })
    expect(r).toMatchObject({ estado: 'listo', resumen: NOTA.resumen })
    expect(r).not.toHaveProperty('respuesta_sugerida')
  })

  it('al crear se genera y se guarda; si falla no lanza', async () => {
    const repo = fakeRepo()
    await startTicketNote(TICKET, { repo, llm: async () => NOTA, env: ON })
    expect(repo.guardadas[0]).toMatchObject({ ticketId: 5, payload: NOTA })
    const roto = await startTicketNote({ ...TICKET, ticket_id: 6 }, { repo, llm: async () => { throw new Error('caido') }, env: ON })
    expect(roto).toBeNull()
  })

  it('tras una falla responde "error" en vez de reintentar en cada consulta', async () => {
    const t = { ...TICKET, ticket_id: 7 }
    await startTicketNote(t, { repo: fakeRepo(), llm: async () => { throw new Error('caido') }, env: ON })
    expect(await getTicketNote({ ticket: t, canManage: true }, { repo: fakeRepo(), env: ON })).toEqual({ estado: 'error' })
  })

  it('un ticket cerrado sin nota no gasta CPU', async () => {
    const r = await getTicketNote({ ticket: { ...TICKET, ticket_id: 8, status: 'CERRADO' }, canManage: true }, { repo: fakeRepo(), env: ON })
    expect(r).toEqual({ estado: 'sin_nota' })
  })
})
