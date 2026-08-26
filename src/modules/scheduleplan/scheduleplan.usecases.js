import { schedulePlanRepository } from './scheduleplan.repository.js'
import { NotFoundError } from '../../shared/errors.js'
import {
  SchedulePlanError,
  DATE_MODES,
  toPlanItem,
  toIsoDate,
  groupIntoWeeks,
  isPackage,
  withoutPackageModules,
  spillsInto,
  toCarryOverItem,
  formatSpecificCode,
  toRegisterPayload,
  toTreeRegisterPayload
} from './scheduleplan.entity.js'

const repo = schedulePlanRepository

const mesDelPlan = (mes, anio) => `${anio}-${String(mes).padStart(2, '0')}`
const monthOf = item => (toIsoDate(item?.start_date) || '').slice(0, 7)

async function requirePlan (planId) {
  const plan = await repo.get(Number(planId) || 0)
  if (!plan) throw new NotFoundError('El plan no existe')
  return { ...plan, items: Array.isArray(plan.items) ? plan.items : [] }
}

export async function listPlans ({ year = null } = {}) {
  return repo.list(year ? Number(year) : null)
}

export async function getPlan ({ plan_id } = {}) {
  return requirePlan(plan_id)
}

export async function createPlan ({ name, year, user_id = null } = {}) {
  const anio = Number(year) || 0
  if (!anio) throw new SchedulePlanError('Falta el anio del plan')
  if (!String(name || '').trim()) throw new SchedulePlanError('El plan necesita un nombre')
  return repo.insert({ name: String(name).trim(), year: anio, items: [], userId: user_id })
}

// El planner guarda el escenario completo, no item por item: el blob es chico
// (cientos de ediciones) y una sola escritura evita tener que resolver mezclas
// entre dos pestanas editando el mismo plan.
export async function savePlan ({ plan_id, name = null, items = [], user_id = null } = {}) {
  await requirePlan(plan_id)
  const guardado = await repo.saveItems({
    planId: Number(plan_id), name, items, userId: user_id
  })
  if (!guardado) throw new NotFoundError('El plan no existe')
  return guardado
}

export async function deletePlan ({ plan_id, user_id = null } = {}) {
  const borrado = await repo.softDelete({ planId: Number(plan_id) || 0, userId: user_id })
  if (!borrado) throw new NotFoundError('El plan no existe')
  return { plan_id: Number(plan_id) }
}

// ── Copiar el anio anterior ───────────────────────────────────────────────

// Los ids de dias/horas viajan dentro de schedules[] en el SP del cronograma, y
// cat_segment / vacant ni siquiera salen ahi. Se leen de program_editions en una
// sola consulta en vez de un sp_edition_tree_get por edicion (serian ~65 por mes).
function mergeRawColumns (item, crudo = {}) {
  const horario = (item.schedules || [])[0] || {}
  return {
    ...item,
    cat_segment_id: crudo.cat_segment_id ?? null,
    cat_day_combination_id: crudo.cat_day_combination_id ?? horario.cat_day_combination_id ?? null,
    cat_hour_combination_id: crudo.cat_hour_combination_id ?? horario.cat_hour_combination_id ?? null,
    vacant: crudo.vacant ?? item.vacant ?? null
  }
}

// Un paquete no se puede publicar con lo que devuelve el cronograma:
// tree_detail lista los modulos pero sin child_program_version_id. Ese dato solo
// lo da sp_edition_tree_get, asi que los paquetes (una minoria del mes) pagan
// una llamada extra cada uno.
//
// Se resuelve ANTES de toPlanItem, no despues: inyectar los hijos sobre el item
// ya transformado los dejaba con las fechas del anio de origen y apuntando a las
// ediciones viejas, y el cronograma rechazaba el paquete por chocar contra su
// propio modulo del anio pasado. Todo pasa por la transformacion pura, una vez.
async function withSourceChildren (row) {
  if (!isPackage(row) || !row.edition_num_id) return row
  const filas = await repo.editionTree(row.edition_num_id)
  const hijos = filas?.[0]?.children
  return Array.isArray(hijos) ? { ...row, children: hijos } : row
}

// Trae un mes del cronograma real convertido en items de plan. No guarda nada:
// eso lo deciden seedMonthFromYear y seedYearFromYear, que difieren solo en
// cuantos meses juntan antes de escribir.
async function buildMonthItems ({ month, sourceYear, years, mode }) {
  const semanas = await repo.monthEditions({ month, year: sourceYear })
  const origen = (semanas || []).flatMap(s => (Array.isArray(s.items) ? s.items : []))
  const crudos = await repo.rawEditionColumns(origen.map(e => e.edition_num_id))

  const items = []
  for (const fila of origen) {
    const completa = await withSourceChildren(fila)
    const item = toPlanItem(completa, { uid: `s${fila.edition_num_id}`, mode, years })
    items.push(mergeRawColumns(item, crudos[fila.edition_num_id]))
  }
  return items
}

// Ediciones que arrancaron el anio anterior y siguen dictandose dentro del anio
// del plan. Se recorre el anio previo completo porque una edicion larga (un
// diplomado de 24 sesiones) puede haber empezado en cualquier mes.
//
// Queda fuera lo que arranco hace DOS anios y todavia sigue: no existe hoy un
// programa tan largo, y buscarlo costaria otros 12 recorridos.
async function buildCarryOvers (planYear) {
  const arrastres = []
  for (let mes = 1; mes <= 12; mes++) {
    const semanas = await repo.monthEditions({ month: mes, year: planYear - 1 })
    const filas = (semanas || []).flatMap(s => (Array.isArray(s.items) ? s.items : []))
    for (const fila of filas.filter(f => spillsInto(f, planYear))) {
      const completa = await withSourceChildren(fila)
      arrastres.push(toCarryOverItem(completa, { uid: `a${fila.edition_num_id}` }))
    }
  }
  return arrastres
}

function assertSeedArgs ({ sourceYear, mode }) {
  if (!sourceYear) throw new SchedulePlanError('Falta el anio de origen')
  if (!DATE_MODES.includes(mode)) throw new SchedulePlanError(`Modo de fecha desconocido: ${mode}`)
}

export async function seedMonthFromYear ({
  plan_id, month, source_year, mode = 'weekday', user_id = null
} = {}) {
  const plan = await requirePlan(plan_id)
  const mes = Number(month) || 0
  const anioOrigen = Number(source_year) || 0
  if (mes < 1 || mes > 12) throw new SchedulePlanError('Mes invalido')
  assertSeedArgs({ sourceYear: anioOrigen, mode })

  const nuevos = await buildMonthItems({
    month: mes, sourceYear: anioOrigen, years: plan.year - anioOrigen, mode
  })

  // Re-sembrar el mismo mes lo reemplaza en vez de duplicarlo, pero jamas toca
  // lo ya publicado: esa edicion existe de verdad y borrarla del plan seria
  // perderle el rastro.
  const conservados = plan.items.filter(item =>
    item.published_edition_id || monthOf(item) !== mesDelPlan(mes, plan.year))

  return guardarSembrado({ plan, conservados, nuevos, userId: user_id, month: mes })
}

// Copiar el anio entero. No es un for de 12 llamadas al endpoint mensual: eso
// releeria y reescribiria el blob del plan 12 veces (y el blob es el anio
// completo). Aca se junta todo y se guarda una sola vez.
export async function seedYearFromYear ({
  plan_id, source_year, mode = 'weekday', user_id = null
} = {}) {
  const plan = await requirePlan(plan_id)
  const anioOrigen = Number(source_year) || 0
  assertSeedArgs({ sourceYear: anioOrigen, mode })

  const desfase = plan.year - anioOrigen
  const nuevos = []
  for (let mes = 1; mes <= 12; mes++) {
    nuevos.push(...await buildMonthItems({ month: mes, sourceYear: anioOrigen, years: desfase, mode }))
  }

  // Los arrastres se recalculan siempre: son un espejo del cronograma real, no
  // algo que el usuario edite, asi que la version vieja se descarta.
  nuevos.push(...await buildCarryOvers(plan.year))

  // Del plan viejo solo sobrevive lo que el plan publico: copiar el anio entero
  // es "empezar de nuevo" y conservar borradores sueltos dejaria repetidos. Los
  // arrastres se excluyen aca porque se acaban de reconstruir.
  const conservados = plan.items.filter(item => item.published_edition_id && !item.carry_over)

  const res = await guardarSembrado({ plan, conservados, nuevos, userId: user_id, month: null })
  return { ...res, carry_overs: nuevos.filter(i => i.carry_over).length }
}

// El descarte de modulos sueltos corre sobre el plan COMPLETO y no sobre el mes:
// un paquete de junio puede tener un modulo que arranca en julio, asi que el
// duplicado aparece recien cuando estan los dos meses, en el orden que sea.
async function guardarSembrado ({ plan, conservados, nuevos, userId, month }) {
  const items = withoutPackageModules([...conservados, ...nuevos])
  await repo.saveItems({ planId: plan.plan_id, name: null, items, userId })
  return {
    plan_id: plan.plan_id,
    month,
    added: nuevos.length,
    dropped_modules: conservados.length + nuevos.length - items.length,
    total: items.length
  }
}

// ── Preview ───────────────────────────────────────────────────────────────

// Devuelve el mes del plan con el mismo sobre que sp_edition_by_week_list, para
// que la vista de solo lectura del cronograma lo pinte sin cambios.
export async function previewMonth ({ plan_id, month, year = null } = {}) {
  const plan = await requirePlan(plan_id)
  const mes = Number(month) || 0
  if (mes < 1 || mes > 12) throw new SchedulePlanError('Mes invalido')
  return {
    plan: { plan_id: plan.plan_id, name: plan.name, year: plan.year },
    items: groupIntoWeeks(plan.items, { month: mes, year: Number(year) || plan.year })
  }
}

// ── Publicar al cronograma real ───────────────────────────────────────────

// sp_edition_register contesta { result, message, id }. Es la unica forma de
// saber que edicion se creo, y sin ese id la guarda de idempotencia no sirve:
// volver a publicar crearia todo de nuevo. `response` queda como respaldo por
// si sp_edition_tree_register usa el nombre viejo.
function newEditionId (fila = {}) {
  const directo = fila.id ?? fila.edition_num_id ?? fila.edition_id
  if (directo) return Number(directo)

  const respuesta = fila.response
  if (respuesta && typeof respuesta === 'object') {
    return Number(respuesta.edition_num_id ?? respuesta.edition_id ?? respuesta.id) || null
  }
  return Number(respuesta) || null
}

// sp_edition_register numera bien el specific_code cuando llega en null, pero
// sp_edition_tree_register NO: le pone siempre "E1-<anio>", asi que la segunda
// edicion del mismo paquete choca contra el indice unico
// uk_specific_code_version_active. En el cronograma real no salta porque
// Producto escribe el codigo a mano en el modal.
//
// Hasta que se arregle el SP, el plan numera los paquetes por su cuenta (el SP
// si respeta un codigo explicito). `secuencias` recuerda lo asignado en esta
// misma publicacion: si no, dos ediciones del mismo paquete tomarian el mismo
// numero, que es exactamente el bug que se esta esquivando.
async function nextSpecificCode (programVersionId, year, secuencias) {
  const desdeBd = secuencias.has(programVersionId)
    ? secuencias.get(programVersionId)
    : await repo.maxSpecificCodeSeq(programVersionId)
  const seq = desdeBd + 1
  secuencias.set(programVersionId, seq)
  return formatSpecificCode(seq, year)
}

async function publishItem (item, year, userId, { modulosYaPublicados, secuencias }) {
  const paquete = isPackage(item)
  const payload = paquete
    ? toTreeRegisterPayload(
        { ...item, specific_code: item.specific_code || await nextSpecificCode(item.program_version_id, year, secuencias) },
        year, modulosYaPublicados)
    : toRegisterPayload(item, year)
  const filas = paquete
    ? await repo.registerEditionTree(payload, userId)
    : await repo.registerEdition(payload, userId)

  const fila = filas?.[0] || {}
  if (Number(fila.result) !== 1) {
    throw new SchedulePlanError(fila.message || 'El cronograma rechazo la edicion')
  }

  // El SP del arbol no devuelve el id; se busca la edicion recien creada. Si ni
  // asi aparece se corta: marcar el item como publicado sin id dejaria la guarda
  // de idempotencia muerta y la siguiente publicacion crearia todo de nuevo.
  const editionId = newEditionId(fila) ?? await repo.lastEditionIdOf(item.program_version_id)
  if (!editionId) {
    throw new SchedulePlanError('La edicion se creo pero no se pudo identificar: revisala en el cronograma antes de reintentar')
  }

  if (paquete) await registerCreatedModules(item, editionId, modulosYaPublicados)
  return editionId
}

// Anota que edicion nueva le corresponde a cada modulo del paquete recien
// creado, para que el siguiente paquete que comparta ese modulo lo reuse en vez
// de crear una copia. El emparejamiento va por sort_order, que es el orden en el
// que se mandaron los hijos.
async function registerCreatedModules (item, parentEditionId, modulosYaPublicados) {
  const filas = await repo.editionTree(parentEditionId)
  const creados = filas?.[0]?.children || []
  for (const hijoPlan of item.children || []) {
    const origen = hijoPlan.source_edition_id
    if (!origen || modulosYaPublicados.has(Number(origen))) continue
    const creado = creados.find(c => Number(c.sort_order) === Number(hijoPlan.sort_order))
    if (creado?.edition_id) modulosYaPublicados.set(Number(origen), Number(creado.edition_id))
  }
}

// Pasa el plan al modulo real. NO toca Odoo: sp_edition_register y
// sp_edition_tree_register solo escriben en program_editions (el aula de Odoo la
// crea despues el flujo de matriculas), asi que publicar un plan no puede
// ensuciar el Odoo de produccion.
//
// Cada item se publica por separado y a proposito: si uno falla (fecha invalida,
// codigo repetido) los demas igual entran y el error viaja con el uid para
// corregirlo en el planner. El uid publicado queda marcado en el blob, de modo
// que volver a darle a Publicar no duplica nada.
export async function publishPlan ({ plan_id, uids = null, user_id = null } = {}) {
  const plan = await requirePlan(plan_id)
  const seleccion = Array.isArray(uids) && uids.length ? new Set(uids.map(String)) : null

  const publicados = []
  const fallidos = []
  const items = [...plan.items]
  // Vive durante toda la publicacion: es lo que hace que un modulo compartido
  // entre paquetes se cree una sola vez.
  const modulosYaPublicados = new Map()
  // Ultima secuencia de specific_code entregada por version de programa.
  const secuencias = new Map()

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.published_edition_id) continue
    if (seleccion && !seleccion.has(String(item.uid))) continue

    try {
      const editionId = await publishItem(item, plan.year, user_id, { modulosYaPublicados, secuencias })
      items[i] = { ...item, published_edition_id: editionId }
      publicados.push({ uid: item.uid, edition_num_id: editionId })
    } catch (err) {
      // No se traga el error: viaja al planner con el uid para que el usuario
      // vea exactamente que fila hay que corregir.
      fallidos.push({
        uid: item.uid,
        label: item.abbreviation || item.program_abreviature || item.program_public_label || '',
        message: err.message
      })
    }
  }

  if (publicados.length) {
    await repo.saveItems({ planId: plan.plan_id, name: null, items, userId: user_id })
  }

  return { plan_id: plan.plan_id, published: publicados, failed: fallidos }
}
