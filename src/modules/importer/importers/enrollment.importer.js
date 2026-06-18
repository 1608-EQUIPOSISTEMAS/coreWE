import { importerPorts } from '../importer.ports.js'

// Importador de Inscripciones FICO. Define las columnas de la plantilla, como
// traducir los nombres legibles del Excel a los IDs de catalogo que exige el
// SP, las reglas de validacion y como confirmar cada fila (reusa el caso de uso
// ficoEnrollmentRegister, que ya hace dedupe + auditoria). NO reimplementa el
// alta: orquesta.

// --- Columnas de la plantilla ---------------------------------------------
// El ORDEN define el orden de columnas en el Excel. `key` es el identificador
// interno; `header` lo ve el usuario; `required` marca obligatoriedad (la valida
// el usecase generico); `example`/`help` alimentan la plantilla descargable.
const columns = [
  { key: 'document_type', header: 'Tipo de documento', required: true, example: 'DNI', help: 'DNI, CE (carne de extranjeria) o Pasaporte.' },
  { key: 'document_number', header: 'Numero de documento', required: true, example: '70123456', help: 'Solo numeros/letras, sin espacios.' },
  { key: 'first_name', header: 'Nombres', required: true, example: 'Maria Fernanda', help: 'Nombres del alumno.' },
  { key: 'last_name', header: 'Apellidos', required: true, example: 'Quispe Rojas', help: 'Apellidos del alumno.' },
  { key: 'email', header: 'Correo', required: true, example: 'maria@correo.com', help: 'Correo de contacto del alumno.' },
  { key: 'phone', header: 'Telefono', required: true, example: '987654321', help: 'Celular de contacto.' },
  { key: 'program', header: 'Programa', required: true, example: 'WE MBA', help: 'Nombre/abreviatura del programa tal como aparece en el sistema.' },
  { key: 'edition', header: 'Edicion', required: true, example: 'MBA-2024-01', help: 'Codigo de la edicion del programa.' },
  { key: 'modality', header: 'Modalidad', required: true, example: 'En vivo', help: 'Modalidad de inscripcion (En vivo, Online, etc.).' },
  { key: 'currency', header: 'Moneda', required: true, example: 'PEN', help: 'PEN (soles) o USD (dolares).' },
  { key: 'payment_way', header: 'Forma de pago', required: true, example: 'Contado', help: 'Contado o Cuotas. Si es Cuotas, detalla el cronograma en la hoja "Cuotas".' },
  { key: 'payment_medium', header: 'Medio de pago', required: false, example: 'Transferencia', help: 'Opcional. Transferencia, Tarjeta, etc. (medio del pago inicial).' },
  { key: 'total_amount', header: 'Monto total', required: true, example: '5000', help: 'Precio total de la inscripcion. Numero sin simbolo de moneda.' },
  { key: 'down_payment', header: 'Adelanto (cuotas)', required: false, example: '1000', help: 'Solo para Cuotas: monto pagado al inscribir (adelanto/reserva). En Contado dejalo vacio.' },
  { key: 'transaction_code', header: 'Codigo de operacion', required: false, example: 'OP-99887', help: 'Opcional. Numero de operacion del pago inicial.' },
  { key: 'payment_date', header: 'Fecha de pago', required: false, example: '2024-05-01', help: 'Opcional. Formato AAAA-MM-DD.' },
  { key: 'observations', header: 'Observaciones', required: false, example: '', help: 'Opcional.' }
]

// --- Hoja de detalle "Cuotas" (padre-hijo, ligada por documento) -----------
// Una fila por cuota FUTURA del cronograma. Se enlaza con la inscripcion por el
// numero de documento. Diseñada para que la fase 2 (marcar cuotas ya pagadas)
// solo agregue columnas aqui (Pagada / Medio / Operacion / Fecha pago) sin
// cambiar la estructura.
const installmentColumns = [
  { key: 'document_number', header: 'Numero de documento', required: true, example: '70123456', help: 'Mismo documento del alumno en la hoja Datos. Asi se enlaza la cuota con su inscripcion.' },
  { key: 'installment_number', header: 'N de cuota', required: true, example: '1', help: 'Orden de la cuota: 1, 2, 3...' },
  { key: 'amount', header: 'Monto', required: true, example: '1000', help: 'Monto de esta cuota. Numero sin simbolo de moneda.' },
  { key: 'due_date', header: 'Fecha de vencimiento', required: true, example: '2024-07-01', help: 'Cuando vence la cuota. Formato AAAA-MM-DD.' }
]

// --- Contexto compartido ---------------------------------------------------
// Se carga UNA vez por archivo (no por fila) y se pasa a resolveRow. Evita N
// queries de catalogos/programas. `listEditions` queda memoizado por version.
async function loadContext () {
  const [catalog, versionsPage] = await Promise.all([
    importerPorts.getCatalog(),
    importerPorts.listProgramVersions({ active: 'Y', size: 1000 })
  ])

  const programVersions = versionsPage?.items ?? []
  const editionCache = new Map()

  async function listEditions (programVersionId) {
    if (editionCache.has(programVersionId)) return editionCache.get(programVersionId)
    const editions = await importerPorts.listEditionsByVersion(programVersionId)
    editionCache.set(programVersionId, editions || [])
    return editions || []
  }

  return { catalog, programVersions, listEditions }
}

// --- Helpers de matching (reutilizables por el resolver) -------------------
// Normaliza texto para comparar sin importar mayusculas/acentos/espacios.
function norm (value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos/diacriticos
}

// Busca una opcion dentro de una categoria del mapa de catalogos comparando
// contra description/abbreviation/alias. Devuelve la opcion o null.
function matchCatalog (catalog, categoryAlias, text) {
  const options = catalog?.[categoryAlias]
  if (!Array.isArray(options) || !text) return null
  const target = norm(text)
  return options.find(opt =>
    norm(opt.description) === target ||
    norm(opt.abbreviation) === target ||
    norm(opt.alias) === target
  ) || null
}

// =============================================================================
// resolveRow — CONTRIBUCION DEL USUARIO (logica de dominio FICO)
// =============================================================================
// Recibe la fila cruda (raw[col.key] con los nombres legibles del Excel) y el
// contexto cargado. Debe devolver { data, errors }:
//   - data:   el objeto "inscription" con los IDs ya resueltos, listo para
//             ficoEnrollmentRegister (ver buildDirectInscription para el shape).
//   - errors: array de strings; cada nombre que no se pudo traducir suma un
//             error legible. Si errors tiene elementos, la fila se marca
//             invalida y NO se importa.
//
// Decisiones de dominio que SOLO tu puedes tomar (por eso lo dejo a ti):
//   1. CATEGORY_ALIASES: el alias EXACTO de cada categoria en el mapa de
//      catalogos (getCatalog). Ej: el tipo de documento podria ser
//      'we_type_document', la modalidad 'we_inscription_modality', la moneda
//      'we_currency', la forma de pago 'we_payment_plan'... Revisa la respuesta
//      real de /api/catalog/cataloglist para confirmar las claves.
//   2. Como emparejar el PROGRAMA: ctx.programVersions trae objetos con
//      program_version_id y un nombre (abbreviation / program_type_for_iu).
//      Decide contra que campo comparar y que hacer si hay varios que coinciden
//      (ambiguo -> error, o tomar el activo mas reciente).
//   3. Como emparejar la EDICION dentro del programa: await ctx.listEditions(id)
//      devuelve [{ edition_num_id, global_code, start_date }]. Decide si el
//      usuario escribe global_code u otra cosa.
//
// El tercer parametro `installments` son las filas de la hoja "Cuotas"
// enlazadas a esta inscripcion (por documento). El orquestador ya hizo el join;
// aqui solo se arma el installment_plan.
//
// Te dejo el esqueleto con los campos directos (identidad, montos, cronograma de
// cuotas) ya resueltos y el patron de error. Completa los TODO de catalogos.
async function resolveRow (raw, ctx, installments = []) {
  const errors = []
  const data = {
    // Identidad y contacto: pasan tal cual (saneados).
    document_number: raw.document_number ? String(raw.document_number).trim() : null,
    first_name: raw.first_name ?? null,
    last_name: raw.last_name ?? null,
    email: raw.email ?? null,
    phone: raw.phone ? String(raw.phone).trim() : null,
    // Montos: el Excel trae numero o texto; normaliza a numero.
    total_amount: parseAmount(raw.total_amount),
    list_price: parseAmount(raw.total_amount),
    // saved_money = adelanto pagado al inscribir (relevante en Cuotas).
    saved_money: parseAmount(raw.down_payment),
    transaction_code: raw.transaction_code ?? null,
    payment_date: raw.payment_date ?? null,
    observations: raw.observations || 'Importacion masiva FICO',
    is_scholarship: false
  }

  // --- Cronograma de cuotas (hoja "Cuotas") ----------------------------------
  // Arma installment_plan a partir de las filas enlazadas. Validacion estructural
  // aqui; la regla "si es Cuotas debe haber plan" depende de payment_way, que se
  // resuelve en el TODO 2 (ver nota al final).
  if (installments.length > 0) {
    const plan = buildInstallmentPlan(installments, errors)
    if (plan.length > 0) data.installment_plan = plan
  }

  // --- TODO 1: alias EXACTOS de las categorias de catalogo (confirmar contra
  // la respuesta real de cataloglist). ----------------------------------------
  const CATEGORY_ALIASES = {
    document: 'we_type_document', // tipo de documento
    modality: 'we_inscription_modality', // modalidad de inscripcion
    currency: 'we_currency', // moneda
    paymentWay: 'we_payment_plan', // forma de pago (contado/cuotas)
    paymentMedium: 'we_method_payment' // medio de pago (opcional)
  }

  // --- TODO 2: resolver cada catalogo nombre -> id usando matchCatalog. -------
  // Ejemplo del patron (descomenta y ajusta los alias de arriba):
  //
  // const docType = matchCatalog(ctx.catalog, CATEGORY_ALIASES.document, raw.document_type)
  // if (docType) data.cat_type_document = docType.id
  // else errors.push(`Tipo de documento no reconocido: "${raw.document_type}"`)
  //
  // ...repetir para modality -> cat_insc_modality, currency -> cat_currency,
  //    payment_way -> cat_payment_way, payment_medium -> cat_payment_medium.

  // --- TODO 3: resolver PROGRAMA -> program_version_id. ----------------------
  // const prog = ctx.programVersions.find(p => norm(p.abbreviation) === norm(raw.program))
  // if (prog) data.program_version_id = prog.program_version_id
  // else errors.push(`Programa no encontrado: "${raw.program}"`)

  // --- TODO 4: resolver EDICION -> program_edition_id (depende del programa). -
  // if (data.program_version_id) {
  //   const editions = await ctx.listEditions(data.program_version_id)
  //   const ed = editions.find(e => norm(e.global_code) === norm(raw.edition))
  //   if (ed) data.program_edition_id = ed.edition_num_id
  //   else errors.push(`Edicion no encontrada para ese programa: "${raw.edition}"`)
  // }

  // --- TODO 5 (cuotas): cuando ya resuelvas payment_way (TODO 2), valida la
  // coherencia del cronograma. Ejemplo:
  //   const esCuotas = norm(raw.payment_way) === 'cuotas' // o por id/alias
  //   if (esCuotas) {
  //     if (!data.installment_plan) errors.push('Forma de pago Cuotas pero sin filas en la hoja "Cuotas".')
  //     if (data.saved_money <= 0) errors.push('Cuotas requiere un adelanto (> 0).')
  //     const sumCuotas = (data.installment_plan || []).reduce((a, c) => a + c.amount, 0)
  //     const esperado = data.total_amount - data.saved_money // redondea a 2 si hace falta
  //     if (data.installment_plan && Math.abs(sumCuotas - esperado) > 0.01) {
  //       errors.push(`Las cuotas (${sumCuotas}) + adelanto (${data.saved_money}) no suman el total (${data.total_amount}).`)
  //     }
  //   } else if (data.installment_plan) {
  //     errors.push('Hay cuotas en la hoja "Cuotas" pero la forma de pago no es Cuotas.')
  //   }

  return { data, errors }
}

// Convierte las filas de la hoja "Cuotas" en el shape que espera el SP:
// [{ installment_number, amount, due_date }], ordenado por numero. Acumula
// errores estructurales (numero/monto/fecha invalidos) en `errors`.
function buildInstallmentPlan (installments, errors) {
  const plan = []
  for (const c of installments) {
    const number = parseInt(c.installment_number, 10)
    const amount = parseAmount(c.amount)
    const dueDate = normalizeDate(c.due_date)
    if (!Number.isInteger(number) || number < 1) {
      errors.push(`Cuota con numero invalido: "${c.installment_number}".`)
      continue
    }
    if (amount <= 0) {
      errors.push(`Cuota ${number} con monto invalido: "${c.amount}".`)
      continue
    }
    if (!dueDate) {
      errors.push(`Cuota ${number} con fecha de vencimiento invalida: "${c.due_date}".`)
      continue
    }
    plan.push({ installment_number: number, amount, due_date: dueDate })
  }
  return plan.sort((a, b) => a.installment_number - b.installment_number)
}

// Normaliza una fecha (Date de Excel o texto AAAA-MM-DD) a 'YYYY-MM-DD'.
// Devuelve null si no es interpretable.
function normalizeDate (value) {
  if (!value) return null
  if (value instanceof Date && !isNaN(value)) return value.toISOString().slice(0, 10)
  const s = String(value).trim()
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

// Normaliza un monto que puede venir como numero o como texto ("S/ 5,000.00").
function parseAmount (value) {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return value
  const cleaned = String(value).replace(/[^0-9.-]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

// --- Confirmacion de una fila ----------------------------------------------
// Llama al caso de uso de registro directo y traduce su respuesta al shape
// uniforme que espera el orquestador. result===1 ok; result===2 duplicado;
// cualquier otro -> error con el mensaje del SP.
async function commitRow (data, { userId }) {
  const resp = await importerPorts.registerEnrollment({ data, userId })
  if (resp?.result === 1 && resp.enrollment_id) {
    return { ok: true, id: resp.enrollment_id, message: 'Inscripcion creada' }
  }
  if (resp?.result === 2) {
    return { ok: false, duplicate: true, message: resp.message || 'Inscripcion duplicada' }
  }
  return { ok: false, message: resp?.message || 'El registro no devolvio exito' }
}

export const enrollmentImporter = {
  key: 'enrollment',
  label: 'Inscripciones',
  description: 'Carga masiva de inscripciones directas a /fico/inscripciones.',
  templateFilename: 'plantilla-inscripciones.xlsx',
  columns,
  // Hoja de detalle padre-hijo: cuotas enlazadas por numero de documento.
  detail: {
    sheet: 'Cuotas',
    help: 'Solo para inscripciones a Cuotas: una fila por cuota futura, enlazada por el numero de documento.',
    linkTo: 'document_number', // columna de la hoja principal
    linkColumn: 'document_number', // columna de esta hoja que enlaza
    columns: installmentColumns
  },
  loadContext,
  resolveRow,
  commitRow
}
