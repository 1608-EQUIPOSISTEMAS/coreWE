import * as defaultRepo from './daily-plan.repository.js'
import {
  pickPlanLeads, advisorMonth, advisorFacts, fallbackFocus,
  buildWhatsappMessages, buildFocusMessages, buildTeamMessages,
  cleanModelText, mentionsMoney
} from './daily-plan.entity.js'
import { fetchComercialRaw } from '../results/comercial.repository.js'
import { teamScopeFor } from '../dashboard.entity.js'
import { AREA_OF_LEADER } from '../../../shared/organigrama.js'
import { ollamaChatMessages, ollamaModel } from '../../../shared/adapters/llm/ollama.adapter.js'
import { areaResults } from '../results/results.usecases.js'
import {
  AREA_PLANS, enabledAreas, areaForRoles, extractPendientes, areaFacts, buildAreaMessages, buildAreaPayload
} from './area-plan.entity.js'

// Comercial tiene plan por asesor (reglas de ventas en daily-plan.entity). Las
// demas areas tienen un plan comun del area (area-plan.entity), ver AREA_PLANS.
const AREA = 'COMERCIAL'
const ADVISOR_ROLE = 'COMERCIAL'
const LEADER_ROLE = 'LIDER_COMERCIAL'

// Tras estas fallas seguidas del modelo se deja de llamarlo en esta corrida:
// con Ollama caido, 40 llamadas x 2 min de timeout serian una hora perdida.
const MAX_LLM_FAILS = 2

// Genera el plan del dia de las areas encendidas (AI_DAILY_PLAN_AREAS).
// Corre de madrugada (cron) y a pedido del lider. Serie a proposito: el modelo
// atiende de a una peticion y en paralelo solo se encolarian.
export async function generateDailyPlans ({
  now = new Date(),
  areas = enabledAreas(),
  repo = defaultRepo,
  fetchStats = fetchComercialRaw,
  fetchAreaResults = areaResults,
  llm = ollamaChatMessages,
  persist = true,
  log = console
} = {}) {
  return repo.withGenerationLock(async () => {
    const t0 = Date.now()
    const planDate = await repo.currentDate()

    let fallas = 0
    const redactar = async (messages, opts) => {
      if (fallas >= MAX_LLM_FAILS) return null
      try {
        const text = cleanModelText(await llm(messages, opts))
        fallas = 0
        return text || null
      } catch (err) {
        fallas++
        log.warn(`[daily-plan] modelo fallo (${fallas}/${MAX_LLM_FAILS}): ${err.message}`)
        return null
      }
    }
    const ctx = { now, planDate, repo, redactar, persist, log }

    const out = { planDate, areas: {} }
    for (const area of areas) {
      try {
        out.areas[area] = area === AREA
          ? await generateComercial({ ...ctx, fetchStats })
          : await generateArea({ ...ctx, area, fetchAreaResults })
      } catch (err) {
        // Un area que falla (consulta rota, tabla sin DDL) no deja sin plan a las demas.
        log.error(`[daily-plan] ${area} fallo: ${err.message}`)
        out.areas[area] = { error: err.message }
      }
    }

    out.segundos = Math.round((Date.now() - t0) / 1000)
    log.log(`[daily-plan] ${planDate}: ${areas.join(', ')} en ${out.segundos}s`)
    return out
  })
}

async function generateComercial ({ now, planDate, repo, redactar, persist, fetchStats }) {
  const advisors = await repo.fetchAdvisors(ADVISOR_ROLE)
  const [leads, stats] = await Promise.all([
    repo.fetchCandidateLeads(advisors.map(a => a.user_id)),
    fetchStats({ areaRoles: [...AREA_OF_LEADER[LEADER_ROLE]] })
  ])

  const statsByUser = new Map(stats.asesores.map(r => [r.user_id, r]))
  const segByUser = new Map(stats.seguimiento.filter(r => r.reciente && r.user_id).map(r => [r.user_id, r]))
  const resultados = []

  for (const advisor of advisors) {
    const propios = leads.filter(l => l.user_id === advisor.user_id)
    const plan = pickPlanLeads(propios, now)
    const mes = advisorMonth(statsByUser.get(advisor.user_id), segByUser.get(advisor.user_id), now)

    let borradores = 0
    for (const lead of plan.leads) {
      const texto = await redactar(buildWhatsappMessages(lead), { maxTokens: 140, temperature: 0.4 })
      if (texto && !mentionsMoney(texto)) {
        lead.whatsapp = texto
        borradores++
      }
    }

    // Sin consultas ni ventas no hay nada que redactar: basta la cifra.
    const conActividad = plan.candidatos > 0 || mes.ventas > 0
    const facts = advisorFacts(advisor.name, mes, plan)
    const enfoqueAsesor = conActividad ? await redactar(buildFocusMessages('asesor', facts), { maxTokens: 120 }) : null
    const notaLider = conActividad ? await redactar(buildFocusMessages('lider', facts), { maxTokens: 120 }) : null
    const respaldo = fallbackFocus(advisor.name, mes, plan)

    const payload = {
      nombre: advisor.name,
      mes,
      plan,
      enfoque_asesor: enfoqueAsesor ?? respaldo,
      nota_lider: notaLider ?? respaldo,
      ia: { borradores, enfoque: !!enfoqueAsesor, nota: !!notaLider }
    }
    resultados.push({ user_id: advisor.user_id, ...payload })
    if (persist) await repo.savePlan({ planDate, area: AREA, userId: advisor.user_id, payload, model: ollamaModel() })
  }

  const conPlan = resultados.filter(r => r.plan.candidatos > 0 || r.mes.ventas > 0)
  const resumen = conPlan.length ? await redactar(buildTeamMessages(conPlan), { maxTokens: 200 }) : null
  const equipo = {
    resumen,
    asesores: resultados.length,
    priorizadas: resultados.reduce((a, r) => a + r.plan.leads.length, 0),
    ventas: resultados.reduce((a, r) => a + r.mes.ventas, 0),
    meta: resultados.some(r => r.mes.meta) ? resultados.reduce((a, r) => a + (r.mes.meta ?? 0), 0) : null,
    sin_gestion: resultados.reduce((a, r) => a + r.mes.sin_gestion, 0)
  }
  if (persist) await repo.savePlan({ planDate, area: AREA, userId: null, payload: equipo, model: ollamaModel() })
  return { equipo, asesores: resultados }
}

// Un plan por area: dos redacciones (lider y colaborador) sobre el panel de
// resultados que el lider ya ve, asi la IA y el panel nunca dicen cifras distintas.
async function generateArea ({ now, planDate, repo, redactar, persist, area, fetchAreaResults }) {
  const def = AREA_PLANS[area]
  const results = await fetchAreaResults(def.leaderRole, now)
  const pendientes = extractPendientes(results)
  const facts = areaFacts(def.label, results, pendientes)
  const resumenLider = await redactar(buildAreaMessages('lider', facts), { maxTokens: 200 })
  const enfoqueColaborador = await redactar(buildAreaMessages('colaborador', facts), { maxTokens: 140 })
  const payload = buildAreaPayload({ area, results, resumenLider, enfoqueColaborador, pendientes })
  if (persist) await repo.savePlan({ planDate, area, userId: null, payload, model: ollamaModel() })
  return payload
}

// Genera en segundo plano (no bloquea la respuesta HTTP). Una sola a la vez por
// proceso; entre procesos manda el advisory lock.
let enCurso = null
export function startDailyPlanGeneration (opts = {}) {
  if (enCurso) return { started: false, running: true }
  enCurso = generateDailyPlans(opts)
    .catch(err => console.error('[daily-plan] generacion fallo:', err.message))
    .finally(() => { enCurso = null })
  return { started: true, running: true }
}

export function isGenerating () {
  return !!enCurso
}

// Lo que ve cada quien.
// · Comercial: el lider (o ADMIN mirando Comercial) ve el equipo y el plan de
//   cada asesor con su nota; el asesor ve SOLO el suyo y sin la nota al lider.
// · Otras areas: un plan comun; el lider lo ve entero, el colaborador sin el
//   resumen dirigido al lider.
export async function getDailyPlan ({ roles = [], userId = null, viewAs = null } = {}, repo = defaultRepo, areas = enabledAreas()) {
  const scope = teamScopeFor({ roles, userId, viewAs })
  const generando = isGenerating()

  if (scope.leaderKey === LEADER_ROLE && areas.includes(AREA)) {
    const rows = await repo.fetchLatestPlans({ area: AREA })
    if (!rows.length) return { tipo: 'comercial', rol: 'lider', generando, plan_date: null }
    const equipo = rows.find(r => r.user_id === null)
    return {
      tipo: 'comercial',
      rol: 'lider',
      generando,
      plan_date: rows[0].plan_date,
      generated_at: rows[0].generated_at,
      equipo: equipo?.payload ?? null,
      asesores: rows.filter(r => r.user_id !== null).map(r => ({ user_id: r.user_id, ...r.payload }))
    }
  }

  const otras = areas.filter(a => a !== AREA)
  const liderDe = otras.find(a => AREA_PLANS[a].leaderRole === scope.leaderKey)
  if (liderDe) return areaView(liderDe, 'lider', repo, generando)

  if (!scope.isLeader && roles.includes(ADVISOR_ROLE) && areas.includes(AREA)) {
    const rows = await repo.fetchLatestPlans({ area: AREA, userId })
    const mio = rows.find(r => r.user_id === userId)
    if (!mio) return { tipo: 'comercial', rol: 'asesor', plan_date: null }
    const { nota_lider: _omit, ...plan } = mio.payload
    return { tipo: 'comercial', rol: 'asesor', plan_date: mio.plan_date, generated_at: mio.generated_at, plan }
  }

  const propia = scope.isLeader ? null : areaForRoles(roles, otras)
  if (propia) return areaView(propia.area, 'colaborador', repo, generando)

  return { rol: null }
}

async function areaView (area, rol, repo, generando) {
  const rows = await repo.fetchLatestPlans({ area })
  const fila = rows.find(r => r.user_id === null)
  const base = { tipo: 'area', area, label: AREA_PLANS[area].label, rol, generando }
  if (!fila) return { ...base, plan_date: null }
  const { resumen_lider: resumenLider, ...resto } = fila.payload
  return {
    ...base,
    plan_date: fila.plan_date,
    generated_at: fila.generated_at,
    plan: rol === 'lider' ? { ...resto, resumen_lider: resumenLider } : resto
  }
}

// Que areas puede regenerar quien pide: la que lidera, o todas si es ADMIN
// (viewAs acota a una). [] = no puede regenerar nada.
export function regenerableAreas ({ roles = [], viewAs = null } = {}, areas = enabledAreas()) {
  const areaDeLider = (leaderRole) => (leaderRole === LEADER_ROLE ? AREA : Object.keys(AREA_PLANS).find(a => AREA_PLANS[a].leaderRole === leaderRole))
  if (roles.includes('ADMIN')) {
    const una = viewAs ? areaDeLider(viewAs) : null
    return una ? areas.filter(a => a === una) : areas
  }
  const propias = roles.map(areaDeLider).filter(Boolean)
  return areas.filter(a => propias.includes(a))
}
