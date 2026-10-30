import { DomainError } from '../../../shared/errors.js'

// Reglas del modulo Pagos Adicionales (reemplaza el sheet de pagos adicionales
// de FICO, pestaña "1. Pago Adicional"). Funciones puras: ni BD ni HTTP.

// Datos desde 2026 (los años anteriores se quedan en el sheet).
export const PRIMER_MES = '2026-01'
// Un año entero son ~300 pagos: se manda todo y se filtra en el navegador.
export const MAX_MESES = 12

export const LINEAS = ['EN VIVO', 'ONLINE', 'FUNDACIÓN WE']
export const ESTADOS = ['EFECTUADO', 'PENDIENTE']
export const MONEDAS = ['PEN', 'USD']
// Asuntos de la pestaña "5. Lista" del sheet, sin los de certificado (esos se
// cobran en FICO > Inscripciones). Lista cerrada, como en el sheet.
export const ASUNTOS = [
  'Cobr. Mora', 'Reprog.', 'Serv. SAP', 'Act. datos', 'Ex. Susti.', 'Camb. Curso', 'Const. Webinar',
  'Const. Curso', 'Grabaciones y materiales', 'Visita Tecnica', 'G-metrix', 'Ex. Internacional',
  'Pagos no identificados', 'Pago Excedente', 'Reserva', 'Nuevo intento examen', 'Alquiler Laptop', 'Otros'
]
// Columna fija del sheet: todo lo de este modulo es un adicional.
export const TIPO_PROGRAMA = 'ADICIONALES'

// Nombre corto de la entidad empresa, como lo escribe el sheet.
const EMPRESA_CORTA = {
  we_business_entity_wec: 'WE Consulting',
  we_business_entity_weee: 'WE Educación',
  we_business_entity_wel: 'WE Educación Latam',
  we_business_entity_wef: 'WE Foundation'
}

// Los certificados (y su duplicado o conversion) se cobran en FICO >
// Inscripciones (nav Adicionales), ligados a la inscripcion: aca no entran.
const ASUNTO_CERTIFICADO = /\bcert/i
export const esCertificado = asunto => ASUNTO_CERTIFICADO.test(String(asunto ?? ''))

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const FECHA_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const mesIndex = ym => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1
const mesDe = i => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`

// Rango de meses [desde, hasta] → [inicio, fin) en fechas.
export function parsePeriodo ({ desde, hasta } = {}) {
  const to = hasta || desde
  if (!MES_RE.test(desde || '') || !MES_RE.test(to || '')) {
    throw new DomainError('Mes inválido: usa el formato AAAA-MM', { code: 'MES_INVALIDO' })
  }
  if (desde < PRIMER_MES) {
    throw new DomainError('Los pagos adicionales están en el ERP desde enero 2026', { code: 'FUERA_DE_ALCANCE' })
  }
  if (to < desde) throw new DomainError('El mes final es anterior al inicial', { code: 'RANGO_INVALIDO' })
  if (mesIndex(to) - mesIndex(desde) + 1 > MAX_MESES) {
    throw new DomainError(`El rango no puede pasar de ${MAX_MESES} meses`, { code: 'RANGO_INVALIDO' })
  }
  return { desde, hasta: to, inicio: `${desde}-01`, fin: `${mesDe(mesIndex(to) + 1)}-01` }
}

const texto = v => (v == null ? '' : String(v).trim())
const opcional = v => texto(v) || null

function fechaValida (s) {
  if (!FECHA_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return d.toISOString().slice(0, 10) === s
}

// Normaliza y valida lo que llega del formulario. Devuelve el registro listo
// para la BD (snake_case). `cuenta` es la fila de bank_accounts elegida (o
// null): la cuenta tiene que ser de la empresa y de la moneda del pago.
export function buildPago (input = {}, { cuenta = null } = {}) {
  const pago = {
    business_line: texto(input.business_line),
    program: texto(input.program),
    subject: texto(input.subject),
    payment_date: texto(input.payment_date),
    full_name: texto(input.full_name),
    phone: opcional(input.phone),
    email: opcional(input.email),
    status: texto(input.status) || 'EFECTUADO',
    done: input.done === true,
    amount: Number(input.amount),
    currency: texto(input.currency) || 'PEN',
    cat_payment_medium: input.cat_payment_medium || null,
    cat_business_entity: input.cat_business_entity || null,
    bank_account_id: input.bank_account_id || null,
    transaction_code: opcional(input.transaction_code),
    product_line: opcional(input.product_line),
    payment_type: opcional(input.payment_type)
  }

  const faltan = [
    ['business_line', 'Línea de negocio'],
    ['program', 'Programa'],
    ['subject', 'Asunto'],
    ['payment_date', 'F. pago'],
    ['full_name', 'Nombres y apellidos']
  ].filter(([k]) => !pago[k]).map(([, label]) => label)
  if (faltan.length) throw new DomainError(`Falta: ${faltan.join(', ')}`, { code: 'CAMPOS_REQUERIDOS' })

  if (esCertificado(pago.subject)) {
    throw new DomainError('Los certificados se registran en FICO > Inscripciones, en la inscripción del alumno', { code: 'ASUNTO_CERTIFICADO' })
  }
  if (!ASUNTOS.includes(pago.subject)) throw new DomainError('Asunto no válido: elige uno de la lista', { code: 'ASUNTO_INVALIDO' })
  if (!LINEAS.includes(pago.business_line)) throw new DomainError('Línea de negocio no válida', { code: 'LINEA_INVALIDA' })
  if (!ESTADOS.includes(pago.status)) throw new DomainError('Estado no válido', { code: 'ESTADO_INVALIDO' })
  if (!MONEDAS.includes(pago.currency)) throw new DomainError('Moneda no válida', { code: 'MONEDA_INVALIDA' })
  if (!fechaValida(pago.payment_date)) throw new DomainError('F. pago inválida', { code: 'FECHA_INVALIDA' })
  if (pago.payment_date < `${PRIMER_MES}-01`) {
    throw new DomainError('Solo se registran pagos desde enero 2026', { code: 'FUERA_DE_ALCANCE' })
  }
  if (!Number.isFinite(pago.amount) || pago.amount < 0) throw new DomainError('Monto inválido', { code: 'MONTO_INVALIDO' })
  pago.amount = Math.round(pago.amount * 100) / 100
  if (pago.email && !EMAIL_RE.test(pago.email)) throw new DomainError('Correo inválido', { code: 'CORREO_INVALIDO' })

  if (pago.bank_account_id) {
    if (!cuenta) throw new DomainError('La cuenta bancaria no existe', { code: 'CUENTA_INVALIDA' })
    if (!pago.cat_business_entity) pago.cat_business_entity = cuenta.business_entity_catalog_id
    if (Number(cuenta.business_entity_catalog_id) !== Number(pago.cat_business_entity)) {
      throw new DomainError('La cuenta bancaria no es de la entidad empresa elegida', { code: 'CUENTA_INVALIDA' })
    }
    if (cuenta.currency && cuenta.currency !== pago.currency) {
      throw new DomainError(`La cuenta bancaria es en ${cuenta.currency} y el pago en ${pago.currency}`, { code: 'CUENTA_INVALIDA' })
    }
  }
  return pago
}

// Fila de la BD → fila de la tabla (mismas columnas y orden que el sheet).
export function toFila (r) {
  return {
    id: r.additional_payment_id,
    lineaNegocio: r.business_line,
    programa: r.program,
    asunto: r.subject,
    fechaPago: r.payment_date,
    nombre: r.full_name,
    celular: r.phone || '',
    correo: r.email || '',
    estado: r.status,
    realizado: !!r.done,
    monto: Number(r.amount),
    moneda: r.currency,
    medioPago: r.medio_pago || '',
    entidadEmpresa: EMPRESA_CORTA[r.empresa_alias] || r.empresa || '',
    entidadFinanciera: r.banco || '',
    nOper: r.transaction_code || '',
    tipoPrograma: TIPO_PROGRAMA,
    lineaProducto: r.product_line || '',
    tipoPago: r.payment_type || '',
    // Ids crudos para editar sin volver a buscar.
    catPaymentMedium: r.cat_payment_medium,
    catBusinessEntity: r.cat_business_entity,
    bankAccountId: r.bank_account_id,
    registradoPor: r.registrado_por || ''
  }
}
