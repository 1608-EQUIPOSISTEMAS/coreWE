// Reglas puras del modulo Planificacion. Sin I/O: se testean solas.
//
// Un "plan" es un escenario de programacion de un anio futuro. Sus items son
// ediciones que todavia no existen: se copian del anio anterior, se mueven a
// mano y recien al final se publican como ediciones reales.

export class SchedulePlanError extends Error {
  constructor (message) {
    super(message)
    this.name = 'SchedulePlanError'
    this.statusCode = 400
  }
}

// ── Fechas ────────────────────────────────────────────────────────────────

// Las fechas llegan como 'YYYY-MM-DD' (sp_edition_by_week_list) o como ISO con
// hora (sp_edition_tree_get devuelve la medianoche de Lima en UTC: 05:00Z). En
// ambos casos los primeros 10 caracteres son el dia correcto; un `new Date()`
// de por medio lo correria un dia en zonas al oeste de Lima.
export function toIsoDate (value) {
  if (!value) return null
  if (value instanceof Date) {
    const mes = String(value.getMonth() + 1).padStart(2, '0')
    const dia = String(value.getDate()).padStart(2, '0')
    return `${value.getFullYear()}-${mes}-${dia}`
  }
  const texto = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10) : null
}

const DIA_MS = 86400000

// La aritmetica de fechas se hace TODA en UTC y nunca en hora local: en Lima
// (UTC-5) la medianoche UTC del 2-jun es el 1-jun local, asi que mezclar
// Date.UTC() al construir con getFullYear()/getDate() al leer corre cada fecha
// del plan un dia hacia atras sin que nadie lo note.
function fromIsoDate (iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const toIsoUtc = fecha => fecha.toISOString().slice(0, 10)

export const DATE_MODES = ['weekday', 'same_date']

// Copiar un anio al siguiente tiene dos lecturas y las dos son legitimas:
//
//   'weekday'   +52 semanas exactas. El 3-jun-2026 (miercoles) cae en el
//               2-jun-2027 (miercoles). Es el default porque una edicion se
//               dicta "Mie 7PM-10PM": conservar el dia de la semana conserva el
//               horario, y correr la fecha un dia no le importa a nadie.
//   'same_date' +1 anio calendario. El 3-jun-2026 cae en el 3-jun-2027, que es
//               jueves. Sirve cuando la fecha manda (un congreso, un aniversario)
//               y el dia de la semana es lo que se acomoda despues.
export function shiftDate (value, { mode = 'weekday', years = 1 } = {}) {
  const iso = toIsoDate(value)
  if (!iso) return null
  if (!DATE_MODES.includes(mode)) throw new SchedulePlanError(`Modo de fecha desconocido: ${mode}`)

  if (mode === 'weekday') {
    return toIsoUtc(new Date(fromIsoDate(iso).getTime() + years * 52 * 7 * DIA_MS))
  }

  const [y, m, d] = iso.split('-').map(Number)
  // El 29-feb no existe todos los anios: Date lo empuja al 1-mar, que es el
  // comportamiento util (no perder la edicion) y no hace falta un caso aparte.
  return toIsoUtc(new Date(Date.UTC(y + years, m - 1, d)))
}

// Semana del mes tal como la numera sp_edition_by_week_list: semanas de lunes a
// domingo, la 1 es la que contiene al dia 1. El preview del plan tiene que
// reproducir esta numeracion o las tarjetas caen en la fila equivocada.
export function weekOfMonth (value) {
  const iso = toIsoDate(value)
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  const lunesCero = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  return Math.floor((d - 1 + lunesCero) / 7) + 1
}

export const SEMANAS_POR_MES = 6

// Envuelve los items en el mismo sobre [{ schedule, items }] que devuelve el SP
// del cronograma, para que la vista de solo lectura los pinte sin enterarse de
// que son ediciones imaginarias.
export function groupIntoWeeks (items = [], { month, year } = {}) {
  const semanas = Array.from({ length: SEMANAS_POR_MES }, (_, i) => ({ schedule: i + 1, items: [] }))
  for (const item of items) {
    const iso = toIsoDate(item.start_date)
    if (!iso) continue
    const [y, m] = iso.split('-').map(Number)
    if (month && (m !== Number(month) || y !== Number(year))) continue
    const semana = weekOfMonth(iso)
    if (semana >= 1 && semana <= SEMANAS_POR_MES) semanas[semana - 1].items.push(item)
  }
  return semanas
}

// ── Items del plan ────────────────────────────────────────────────────────

const flagSiNo = v => (v === true || v === 'Y' ? 'Y' : 'N')

// ── Poda del ruido de origen ──────────────────────────────────────────────

// El planner manda el escenario COMPLETO en cada guardado, asi que todo campo
// muerto se paga en cada save: con 500 ediciones sin podar el POST pesaba 1.85 MB
// y Fastify lo cortaba en 1 MB (413) — el usuario solo veia "no se pudo guardar".
//
// `tree_detail` es el 32% del blob y describe los paquetes PADRE de la edicion
// de origen: en un borrador apunta a ediciones del anio pasado y no lo lee nadie
// (la vista de preview lo trata como opcional). Los links de aula tampoco valen:
// un borrador no tiene aula. Las metricas y fechas de auditoria son del origen.
const CAMPOS_DE_ORIGEN = [
  'tree_detail', 'family_filter_value',
  'registration_date', 'modification_date', 'user_registration_id', 'user_modification_id',
  'whatsapp_link', 'teams_link', 'ficha_link', 'grades_link', 'banner_link',
  'calc_da', 'calc_dp', 'cat_status_edition', 'cat_type_approved',
  'cnt_ventas', 'cnt_segui', 'cnt_memb', 'cnt_b2b', 'cnt_becas', 'cnt_aula', 'cnt_total'
]

// En los modulos se hace al reves —lista de lo que SE QUEDA— porque
// sp_edition_tree_get devuelve decenas de columnas y basta con lo que necesitan
// el payload de alta y el modal de modulos.
const CAMPOS_DE_MODULO = [
  'sort_order', 'child_program_version_id', 'abbreviation', 'sessions',
  'instructor_id', 'instructor_label', 'start_date', 'end_date',
  'cat_day_combination_id', 'cat_hour_combination_id',
  'expedient', 'upgrade', 'preconfirmation', 'confirmation', 'active',
  'new', 'edition_id', 'source_edition_id'
]

const sinCamposDeOrigen = (row = {}) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !CAMPOS_DE_ORIGEN.includes(k)))

const soloCamposDeModulo = (hijo = {}) =>
  Object.fromEntries(CAMPOS_DE_MODULO.filter(k => k in hijo).map(k => [k, hijo[k]]))

// Del horario solo sobrevive el primero: es el unico que el planner muestra y el
// unico que viaja al SP de alta (cat_day/hour_combination_id son singulares).
const primerHorario = (row = {}) =>
  Array.isArray(row.schedules) && row.schedules.length ? [row.schedules[0]] : []

// Del item del cronograma real al item del plan: mismas claves (el preview y el
// formulario las leen igual) pero sin ninguna atadura a la edicion de origen.
// `source_edition_id` queda solo como rastro de que curso se copio.
export function toPlanItem (row = {}, { uid, mode = 'weekday', years = 1 } = {}) {
  if (!uid) throw new SchedulePlanError('Todo item del plan necesita un uid')
  const hijos = Array.isArray(row.children) ? row.children : []

  return {
    ...sinCamposDeOrigen(row),
    schedules: primerHorario(row),
    uid,
    edition_num_id: null,
    source_edition_id: row.edition_num_id ?? null,
    published_edition_id: null,
    // Los codigos NO se copian: son unicos por version de programa, asi que
    // heredar el "E21" del ano anterior hace que el SP rechace la edicion
    // ("Ya existe otra edicion con el codigo global E21"). En null, el
    // cronograma los numera solo al publicar (E36 / E3-27) y con la numeracion
    // del ano nuevo, que es la correcta.
    global_code: null,
    specific_code: null,
    start_date: shiftDate(row.start_date, { mode, years }),
    end_date: shiftDate(row.end_date, { mode, years }),
    children: hijos.map((hijo, i) => ({
      ...soloCamposDeModulo(hijo),
      sort_order: hijo.sort_order ?? i + 1,
      // El modulo de origen se guarda porque VARIOS paquetes comparten la misma
      // edicion de modulo (ESPEC. EXCEL y ESP. EXCEL EXP comparten los tres).
      // Sin este rastro, al publicar cada paquete crearia su propia copia del
      // modulo compartido y el cronograma lo rechaza por choque de docente.
      source_edition_id: hijo.edition_id ?? null,
      edition_id: null,
      new: true,
      start_date: shiftDate(hijo.start_date, { mode, years }),
      end_date: shiftDate(hijo.end_date, { mode, years })
    }))
  }
}

// ── Arrastres del anio anterior ───────────────────────────────────────────

// Una edicion que arranco antes del anio del plan pero sigue dictandose dentro
// de el. Al planificar 2027 el calendario no esta vacio: un diplomado que
// empezo en noviembre de 2026 ocupa aula y docente hasta marzo de 2027.
export function spillsInto (row = {}, year) {
  const inicio = toIsoDate(row.start_date)
  const fin = toIsoDate(row.end_date)
  if (!inicio || !fin) return false
  const primeroDeEnero = `${year}-01-01`
  return inicio < primeroDeEnero && fin >= primeroDeEnero
}

// El arrastre NO es un borrador: la edicion ya existe en program_editions. Entra
// al plan marcada como publicada, y eso solo le da todo lo que necesita:
// publishPlan la saltea, no cuenta como pendiente, la UI la muestra de solo
// lectura, y withoutPackageModules no le toca los modulos.
//
// Las fechas y los codigos van SIN correr, al reves que en toPlanItem: no es una
// copia del anio pasado, es la edicion de verdad.
export function toCarryOverItem (row = {}, { uid } = {}) {
  if (!uid) throw new SchedulePlanError('Todo item del plan necesita un uid')
  return {
    ...sinCamposDeOrigen(row),
    schedules: primerHorario(row),
    uid,
    carry_over: true,
    source_edition_id: row.edition_num_id ?? null,
    published_edition_id: row.edition_num_id ?? null,
    start_date: toIsoDate(row.start_date),
    end_date: toIsoDate(row.end_date),
    children: (row.children || []).map((hijo, i) => ({
      ...soloCamposDeModulo(hijo),
      sort_order: hijo.sort_order ?? i + 1,
      source_edition_id: hijo.edition_id ?? null,
      start_date: toIsoDate(hijo.start_date),
      end_date: toIsoDate(hijo.end_date)
    }))
  }
}

// Mueve un item (y sus modulos en bloque) N dias. Es el "juego" del planner:
// arrastrar una edicion de semana sin recalcular nada a mano.
export function moveItemDays (item = {}, days = 0) {
  const corrido = value => {
    const iso = toIsoDate(value)
    return iso ? toIsoUtc(new Date(fromIsoDate(iso).getTime() + days * DIA_MS)) : null
  }
  return {
    ...item,
    start_date: corrido(item.start_date),
    end_date: corrido(item.end_date),
    children: (item.children || []).map(hijo => ({
      ...hijo,
      start_date: corrido(hijo.start_date),
      end_date: corrido(hijo.end_date)
    }))
  }
}

// Un curso y un congreso/evento se registran igual (sp_edition_register, fechas
// propias); todo lo demas es un arbol padre+modulos. Es el mismo criterio que
// `isCourse` en el modal de Producto > Cronograma: tratar un evento como paquete
// lo manda al SP del arbol y lo rechaza por "no tiene modulos".
const TIPOS_SIN_MODULOS = ['we_program_type_course', 'we_program_type_event']

export const isPackage = item =>
  !TIPOS_SIN_MODULOS.includes(item?.cat_type_program_alias || item?.program_type_alias)

// En el cronograma un modulo de paquete es TAMBIEN una edicion por derecho
// propio: "POWER APPS Y AUT." aparece suelto y ademas como hijo de "ESP. POWER
// APPS Y AUT.". Copiar el mes se lleva los dos, y al publicar el modulo se
// crearia dos veces: una dentro del arbol (sp_edition_tree_register crea a sus
// hijos) y otra suelto.
//
// Se quedan los paquetes y se descartan sus modulos sueltos. La comparacion es
// contra la edicion de ORIGEN, que es la unica identidad que ambos comparten.
// Lo ya publicado nunca se descarta: existe de verdad y perderlo del plan seria
// perderle el rastro.
export function withoutPackageModules (items = []) {
  const modulosDePaquete = new Set()
  for (const item of items) {
    if (!isPackage(item)) continue
    for (const hijo of item.children || []) {
      const origen = hijo.source_edition_id ?? hijo.edition_id
      if (origen) modulosDePaquete.add(Number(origen))
    }
  }
  if (!modulosDePaquete.size) return items

  return items.filter(item =>
    isPackage(item) ||
    item.published_edition_id ||
    !modulosDePaquete.has(Number(item.source_edition_id)))
}

// ── Publicacion ───────────────────────────────────────────────────────────

// Que un item este listo para volverse edicion real. Se valida aca y no en el
// SP porque publicar es masivo: mas vale rechazar la fila con un motivo legible
// que recibir 40 mensajes de error de Postgres.
export function assertPublishable (item = {}) {
  if (item.published_edition_id) throw new SchedulePlanError('El item ya fue publicado')
  if (!item.program_version_id) throw new SchedulePlanError('Falta el programa')
  if (!item.start_date) throw new SchedulePlanError('Falta la fecha de inicio')
  if (isPackage(item)) {
    const hijos = item.children || []
    if (!hijos.length) throw new SchedulePlanError('Un paquete sin modulos no se puede publicar')
    const sinPrograma = hijos.find(h => !h.child_program_version_id)
    if (sinPrograma) throw new SchedulePlanError(`El modulo "${sinPrograma.abbreviation || sinPrograma.sort_order}" no tiene programa`)
  } else if (!item.cat_day_combination_id) {
    throw new SchedulePlanError('Falta la combinacion de dias')
  }
}

// Codigo especifico de una edicion: "E<secuencia>-<anio en dos digitos>".
export const formatSpecificCode = (seq, year) => `E${seq}-${String(year).slice(-2)}`

// Payload de sp_edition_register. Es, campo por campo, el que arma el modal de
// Producto > Cronograma (Editions.vue, persistEditionUpdate): si ese cambia,
// este tiene que cambiar igual o el plan publicaria ediciones a medias.
export function toRegisterPayload (item = {}, year) {
  assertPublishable(item)
  return {
    program_version_id: item.program_version_id,
    instructor_id: item.instructor_id || null,
    year: Number(year),
    start_date: item.start_date,
    end_date: item.end_date,
    vacant: item.vacant ?? null,
    cat_segment_id: item.cat_segment_id || null,
    global_code: item.global_code || null,
    specific_code: item.specific_code || null,
    cat_day_combination_id: item.cat_day_combination_id,
    cat_hour_combination_id: item.cat_hour_combination_id,
    expedient: flagSiNo(item.expedient),
    upgrade: flagSiNo(item.upgrade),
    preconfirmation: flagSiNo(item.preconfirmation),
    confirmation: flagSiNo(item.confirmation),
    notes: item.notes || null,
    active: flagSiNo(item.active)
  }
}

// Payload de sp_edition_tree_register (paquetes: padre + modulos).
//
// `modulosYaPublicados` mapea la edicion de modulo del anio de origen a la que
// ya se creo en esta publicacion. Un modulo compartido entre paquetes se crea
// UNA vez y los siguientes lo reusan (new:false + edition_id), que es como lo
// guarda el cronograma real. Sin esto el SP rechaza el segundo paquete porque
// el docente ya tiene esa clase a la misma hora.
export function toTreeRegisterPayload (item = {}, year, modulosYaPublicados = new Map()) {
  assertPublishable(item)
  const reusado = hijo => {
    const origen = hijo.source_edition_id ?? hijo.edition_id
    return origen ? modulosYaPublicados.get(Number(origen)) ?? null : null
  }
  return {
    edition_id: null,
    program_version_id: item.program_version_id,
    vacant: item.vacant ?? null,
    active: flagSiNo(item.active),
    notes: item.notes || null,
    year: Number(year),
    global_code: item.global_code || null,
    specific_code: item.specific_code || null,
    expedient: flagSiNo(item.expedient),
    upgrade: flagSiNo(item.upgrade),
    cat_segment_id: item.cat_segment_id || null,
    preconfirmation: flagSiNo(item.preconfirmation),
    confirmation: flagSiNo(item.confirmation),
    children: (item.children || []).map((hijo, i) => ({
      sort_order: hijo.sort_order ?? i + 1,
      child_program_version_id: hijo.child_program_version_id,
      instructor_id: hijo.instructor_id || null,
      new: !reusado(hijo),
      edition_id: reusado(hijo),
      start_date: hijo.start_date || null,
      end_date: hijo.end_date || null,
      cat_day_combination_id: hijo.cat_day_combination_id || null,
      cat_hour_combination_id: hijo.cat_hour_combination_id || null,
      expedient: flagSiNo(hijo.expedient),
      upgrade: flagSiNo(hijo.upgrade),
      preconfirmation: flagSiNo(hijo.preconfirmation),
      confirmation: flagSiNo(hijo.confirmation),
      active: flagSiNo(hijo.active)
    }))
  }
}
