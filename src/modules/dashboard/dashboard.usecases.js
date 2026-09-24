import { dashboardRepository } from './dashboard.repository.js'
import { ForbiddenError } from '../../shared/errors.js'
import { aggregateVentasCanal, teamScopeFor } from './dashboard.entity.js'
import { AUDITED_TABLES } from '../audit/audit.entity.js'
import { areaResults, myTicketReports, orgTicketReports } from './results/results.usecases.js'
import {
  toDashboardDto,
  toProgramGoalsDto,
  toGoalHistoryDto,
  toGerenciaFunnelDto,
  toLiderDto,
  toContactabilityDto,
  toAvailableWeeksDto,
  toDetailLeadsDto,
  toDetailSalesDto
} from './dashboard.dto.js'

const repo = dashboardRepository

// A qué módulo del ERP pertenece cada tabla auditada (uso del sistema).
const TABLE_MODULE = {
  enrollments: 'FICO',
  payments: 'FICO',
  installments: 'FICO',
  leads: 'Comercial',
  lead_contact_attempts: 'Comercial',
  sales_targets: 'Comercial',
  program_editions: 'Producto',
  edition_structure: 'Producto',
  programs: 'Producto',
  program_edition_goals: 'Producto',
  edition_session_control: 'Académica',
  customers: 'Cliente',
  users: 'Configuración'
}

export async function adminSummary () {
  const raw = await repo.adminSummary()

  // Acciones por módulo del ERP, separadas en mes actual y anterior
  const porMes = {}
  for (const { mes, table_name: t, acciones } of raw.modulosPorMes) {
    const mod = TABLE_MODULE[t] ?? 'Otros'
    const bucket = (porMes[mes] ??= {})
    bucket[mod] = (bucket[mod] ?? 0) + acciones
  }
  const meses = Object.keys(porMes).sort()
  const actual = porMes[meses[meses.length - 1]] ?? {}
  const prev = (meses.length > 1 ? porMes[meses[0]] : {}) ?? {}
  const total = (b) => Object.values(b).reduce((a, x) => a + x, 0)
  const totalActual = total(actual)
  const totalPrev = total(prev)
  const pct = (v, t) => (t ? Math.round((v / t) * 100) : 0)

  const modulos = Object.keys({ ...actual, ...prev })
    .map((m) => ({
      modulo: m,
      acciones: actual[m] ?? 0,
      accionesPrev: prev[m] ?? 0,
      pct: pct(actual[m] ?? 0, totalActual),
      deltaPts: pct(actual[m] ?? 0, totalActual) - pct(prev[m] ?? 0, totalPrev)
    }))
    .sort((a, b) => b.acciones - a.acciones)

  // El área de cada usuario top = módulo de la tabla que más toca
  const topUsuarios = raw.topUsuarios.map((u) => ({
    ...u,
    area: TABLE_MODULE[u.tabla_top] ?? 'Otros'
  }))

  // Soporte de toda la empresa: el ADMIN es el unico que ve tickets sin
  // filtrar por area ni autor. Best-effort (orgTicketReports ya no relanza):
  // si falla, el resto del panel de uso del sistema igual carga.
  const tickets = await orgTicketReports()

  return { ...raw, modulos, topUsuarios, totalAcciones: totalActual, tickets }
}

// Panel de equipo: lo que ve un lider de su area y un colaborador de si mismo.
//
// El lider ve IMPACTO: los indicadores de resultado de su area, incluido el
// estado del soporte (tickets). El uso del ERP (acciones, horarios, movimientos)
// solo lo ve el colaborador en su propio panel; al lider lo confundia y al ADMIN
// ya se lo da "Uso del sistema". Por eso esas cinco consultas no corren para el lider.
export async function teamSummary ({ roles = [], userId = null, viewAs = null } = {}) {
  const scope = teamScopeFor({ roles, userId, viewAs })

  const [uso, resultados, misTickets] = await Promise.all([
    scope.leaderKey ? Promise.resolve(null) : repo.teamSummary(scope),
    areaResults(scope.leaderKey),
    // Solo aplica a quien no tiene area propia (colaborador): un lider ya ve
    // el soporte de su area dentro de `resultados`, verlo dos veces confundiria.
    scope.leaderKey ? Promise.resolve(null) : myTicketReports(scope.userId)
  ])

  return {
    scope: { area: scope.area, isLeader: scope.isLeader },
    ...(uso && usageWithLabels(uso)),
    resultados,
    misTickets
  }
}

function usageWithLabels (uso) {
  return {
    ...uso,
    porTabla: uso.porTabla.map(fila => ({ ...fila, label: etiquetaDeTabla(fila.table_name) })),
    movimientos: uso.movimientos.map(m => ({ ...m, label: etiquetaDeTabla(m.table_name) }))
  }
}

// Nombre legible de la tabla auditada. Primero el catalogo de la Auditoria (que
// nombra la accion: "Inscripciones", "Pagos"); si no esta, el modulo del ERP al
// que pertenece; y en ultimo caso el nombre crudo, que es mejor que mentir.
function etiquetaDeTabla (tableName) {
  return AUDITED_TABLES[tableName] ?? TABLE_MODULE[tableName] ?? tableName
}

export async function dashboardList (payload = {}) {
  const {
    year = 2026,
    modality = 'NO_ONLINE',
    date_start = null,
    date_end = null,
    month = null,
    period = null
  } = payload

  const rows = await repo.dashboardComercial({ year, modality, date_start, date_end, month, period })
  return toDashboardDto(rows)
}

export async function programGoalsList (payload = {}) {
  const { year = 2026, month_num = 1 } = payload
  const rows = await repo.programGoals({ year, month_num })
  // La fecha la calcula Postgres y viaja al front para que pinte el candado con
  // el mismo corte que el backend aplica; calcularla dos veces es la forma segura
  // de que la pantalla y la regla se contradigan. Sin ventana viaja en null y la
  // pantalla deja de mostrar candados sola.
  const editableDesde = DIAS_DE_VENTANA === null ? null : await repo.editionWindowStart(DIAS_DE_VENTANA)
  return { ...toProgramGoalsDto(rows), editable_desde: editableDesde }
}

export async function gerenciaFunnelList (payload = {}) {
  const { year = 2026, month_num = 1 } = payload
  const rows = await repo.gerenciaFunnel({ year, month_num })
  return toGerenciaFunnelDto(rows)
}

// Ventana de edicion: Gerencia y el lider comercial solo pueden mover el
// objetivo de una edicion que empiece de HOY + N DIAS en adelante, porque lo que
// arranca antes ya se esta vendiendo. ADMIN queda fuera para corregir un error.
//
// **Hoy esta SUSPENDIDA** (null = sin ventana), por decision del usuario del
// 24/09/2026: los dos roles editan cualquier mes mientras se carga el ano. Para
// reactivarla basta poner aqui los dias; el resto del camino sigue montado.
// El lider comercial conserva su OTRA restriccion: solo las ventas de sus canales.
const DIAS_DE_VENTANA = null
const SIN_VENTANA = 'ADMIN'
const puedeSaltarLaVentana = (roles = []) => roles.includes(SIN_VENTANA)

async function exigirVentanaDeEdicion (editionIds, roles) {
  if (DIAS_DE_VENTANA === null || puedeSaltarLaVentana(roles)) return
  const fuera = await repo.editionsOutsideWindow(editionIds, DIAS_DE_VENTANA)
  if (!fuera.length) return
  const desde = await repo.editionWindowStart(DIAS_DE_VENTANA)
  const detalle = fuera.map((e) => `${e.programa} ${e.codigo} (${e.inicio})`).join(', ')
  throw new ForbiddenError(
    `Solo se pueden editar ediciones que empiecen desde el ${desde}. Fuera de plazo: ${detalle}`)
}

// Gerencia y ADMIN mueven cualquier cifra. El lider comercial tambien edita
// DIRECTO (ya no pide aprobacion), pero solo las VENTAS de sus dos canales.
const EDITAN_TODO = ['ADMIN', 'GERENCIA']
const CANALES_DEL_LIDER = ['COMERCIAL', 'OTROS']
const editaTodo = (roles = []) => roles.some((rol) => EDITAN_TODO.includes(rol))

// El OBJ es la suma de sus canales, nunca un campo aparte: en el plan las dos
// cifras se declaraban por separado y llegaron a contradecirse.
const sumaDeCanales = (canales) => Object.values(canales).reduce((t, c) => ({
  target_vacants: t.target_vacants + (Number(c?.ventas) || 0),
  target_leads: t.target_leads + (Number(c?.consultas) || 0)
}), { target_vacants: 0, target_leads: 0 })

// Reconstruye cada meta desde lo GUARDADO y le aplica unicamente las ventas de
// los canales del lider. Se hace aca y no solo en la pantalla porque un payload
// armado a mano llegaria igual a la BD y moveria canales ajenos.
async function soloVentasDelLider (goals) {
  const guardadas = await repo.currentGoals(goals.map((g) => g.edition_num_id))
  return goals.map((g) => {
    const actual = guardadas.get(g.edition_num_id)
    const canales = { ...(actual?.channel_goals ?? {}) }
    for (const canal of CANALES_DEL_LIDER) {
      const pedido = g.channel_goals?.[canal]?.ventas
      canales[canal] = { ...canales[canal], ventas: Number(pedido ?? canales[canal]?.ventas ?? 0) }
    }
    return {
      edition_num_id: g.edition_num_id,
      channel_goals: canales,
      // El objetivo de ingresos no sale del plan ni lo toca esta pantalla:
      // mandarlo en 0 lo borraria.
      target_revenue: actual?.revenue_goal ?? 0,
      ...sumaDeCanales(canales)
    }
  })
}

export async function saveProgramGoals ({ goals = [], userId, roles }) {
  await exigirVentanaDeEdicion(goals.map((g) => g.edition_num_id), roles)
  const aGuardar = editaTodo(roles) ? goals : await soloVentasDelLider(goals)
  return repo.saveProgramGoals({ goals: aGuardar, userId })
}

export async function goalHistoryList (payload = {}) {
  const { year = 2026, month_num = 1 } = payload
  const rows = await repo.goalHistory({ year, month_num })
  return { items: rows.map(toGoalHistoryDto) }
}

export async function leadsPerEdition (payload = {}) {
  const { edition_ids = [] } = payload
  return repo.leadsPerEdition({ edition_ids })
}

export async function dashboardTargetRegister ({ target = {} } = {}) {
  return repo.registerTarget(target)
}

export async function liderList (payload = {}) {
  const { year = 2026, month = 1, advisor = 'all' } = payload
  const rows = await repo.lider({ year, month, advisor })
  return toLiderDto(rows)
}

export async function contactabilityList (payload = {}) {
  const { year = 2026, month = 1, advisor = 'all' } = payload
  const rows = await repo.contactability({ year, month, advisor })
  return toContactabilityDto(rows)
}

export async function ventasCanalList (payload = {}) {
  const { year = 2026, month_num = 1, advisor = 'all' } = payload
  const rows = await repo.ventasCanal({ year, month_num, advisor })
  return aggregateVentasCanal(rows)
}

export async function availableWeeks (payload = {}) {
  const { year = 2026, modality = 'NO_ONLINE' } = payload
  const rows = await repo.availableWeeks({ year, modality })
  return toAvailableWeeksDto(rows)
}

export async function detailLeads (payload = {}) {
  const { cod_asesor, date, page = 1, size = 100 } = payload
  const offset = (page - 1) * size
  const rows = await repo.detailLeads({ cod_asesor, date, size, offset })
  return { data: toDetailLeadsDto(rows), page, size }
}

export async function detailSales (payload = {}) {
  const { cod_asesor, date, page = 1, size = 100 } = payload
  const offset = (page - 1) * size
  const rows = await repo.detailSales({ cod_asesor, date, size, offset })
  return { data: toDetailSalesDto(rows), page, size }
}
