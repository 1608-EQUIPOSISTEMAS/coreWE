import { describe, it, expect } from 'vitest'
import { attemptsFingerprint, leadFacts, parseSummary, MAX_ATTEMPTS_IN_PROMPT } from '../lead-summary.entity.js'
import { getLeadSummary, prewarmLeadSummaries } from '../lead-summary.usecases.js'

const ON = { AI_LEAD_SUMMARY: 'true' }
const LEAD = { lead_id: 10, full_name: 'Carla Rojas', programa: 'POWER BI', estado: 'Interesado', interes: 'Alto', registration_date: new Date(2026, 8, 2), observations: null }
const intento = (id, dia, over = {}) => ({
  lead_contact_attempt_id: id, contact_datetime: new Date(2026, 8, dia, 10), contact_duration: null,
  response: null, tipo: 'Llamada', resultado: 'No contesta', modificado: `2026-09-${dia}`, ...over
})

describe('lead-summary.entity', () => {
  it('la huella cambia con un intento nuevo o editado', () => {
    const a = [intento(1, 2), intento(2, 3)]
    expect(attemptsFingerprint(a)).toBe(attemptsFingerprint([...a]))
    expect(attemptsFingerprint([...a, intento(3, 4)])).not.toBe(attemptsFingerprint(a))
    expect(attemptsFingerprint([a[0], { ...a[1], modificado: '2026-09-09' }])).not.toBe(attemptsFingerprint(a))
    expect(attemptsFingerprint([])).toBe('vacio')
  })

  it('la línea de tiempo va en orden y trae la nota del asesor', () => {
    const facts = leadFacts(LEAD, [intento(2, 5, { response: 'pide  temario', resultado: 'Revisará' }), intento(1, 3)], new Date(2026, 8, 8))
    expect(facts).toContain('hace 6 días')
    expect(facts.indexOf('03/09')).toBeLessThan(facts.indexOf('05/09'))
    expect(facts).toContain('nota: "pide temario"')
  })

  it('recorta a los intentos más recientes', () => {
    const muchos = Array.from({ length: 15 }, (_, i) => intento(i + 1, i + 1))
    const facts = leadFacts(LEAD, muchos, new Date(2026, 8, 20))
    expect(facts).toContain(`se muestran los ${MAX_ATTEMPTS_IN_PROMPT} más recientes`)
    expect(facts).not.toContain('- 01/09')
  })

  it('parseSummary exige las dos claves con texto', () => {
    expect(parseSummary({ resumen: 'Pidió el temario y responde el viernes.', siguiente_paso: 'Llamarla el viernes.' }))
      .toEqual({ resumen: 'Pidió el temario y responde el viernes.', siguiente_paso: 'Llamarla el viernes.' })
    expect(parseSummary({ resumen: 'algo más largo que diez' })).toBeNull()
    expect(parseSummary(null)).toBeNull()
  })
})

function fakeRepo ({ attempts = [intento(1, 2)], guardado = null } = {}) {
  const repo = {
    guardados: [],
    fetchLead: async (id) => (id === LEAD.lead_id ? LEAD : null),
    fetchAttempts: async () => attempts,
    fetchSummary: async () => guardado,
    saveSummary: async (x) => { repo.guardados.push(x) },
    fetchPrewarmCandidates: async () => [LEAD.lead_id]
  }
  return repo
}

const RESPUESTA = { resumen: 'No contestó el primer intento.', siguiente_paso: 'Volver a llamar hoy.' }

describe('getLeadSummary', () => {
  it('apagado por defecto: no consulta nada', async () => {
    expect(await getLeadSummary({ leadId: 10 }, { repo: fakeRepo(), env: {} })).toEqual({ estado: 'apagado' })
  })

  it('sin intentos no hay qué resumir', async () => {
    expect(await getLeadSummary({ leadId: 10 }, { repo: fakeRepo({ attempts: [] }), env: ON })).toEqual({ estado: 'sin_intentos' })
  })

  it('con la huella al día responde lo guardado sin llamar al modelo', async () => {
    const attempts = [intento(1, 2)]
    const guardado = { fingerprint: attemptsFingerprint(attempts), payload: RESPUESTA, generated_at: '2026-09-22 05:50' }
    const llm = async () => { throw new Error('no debia llamarse') }
    const r = await getLeadSummary({ leadId: 10 }, { repo: fakeRepo({ attempts, guardado }), llm, env: ON })
    expect(r).toMatchObject({ estado: 'listo', ...RESPUESTA })
  })

  it('huella vieja: responde "generando" con lo anterior y guarda el nuevo', async () => {
    const repo = fakeRepo({ guardado: { fingerprint: 'otra', payload: RESPUESTA, generated_at: 'ayer' } })
    let resolver
    const listo = new Promise(r => { resolver = r })
    const llm = async () => { resolver(); return RESPUESTA }
    const r = await getLeadSummary({ leadId: 10 }, { repo, llm, env: ON })
    expect(r.estado).toBe('generando')
    expect(r.anterior.resumen).toBe(RESPUESTA.resumen)
    await listo
    await new Promise(r => setTimeout(r, 0))
    expect(repo.guardados[0]).toMatchObject({ leadId: 10, payload: RESPUESTA })
  })

  it('lead inexistente = 404', async () => {
    await expect(getLeadSummary({ leadId: 99 }, { repo: fakeRepo(), env: ON })).rejects.toThrow('Lead no encontrado')
  })
})

describe('prewarmLeadSummaries', () => {
  it('genera los candidatos y reintenta una vez si el JSON viene incompleto', async () => {
    const repo = fakeRepo()
    let n = 0
    const llm = async () => (++n === 1 ? { resumen: 'x' } : RESPUESTA)
    const r = await prewarmLeadSummaries({ repo, llm, log: { log () {}, warn () {} } })
    expect(r).toEqual({ candidatos: 1, hechos: 1 })
    expect(n).toBe(2)
  })
})
