import { DomainError } from '../../shared/errors.js'

// Reglas del consultor de Ingresos Operativos (reemplaza el sheet "Ing.
// Operativos - GRUPO WE"). Funciones puras: ni BD ni HTTP.

// FICO registra en el ERP desde abril 2026; enero-marzo es historico importado
// y queda fuera del alcance (docs/plans/ingresos-operativos.md).
export const PRIMER_MES = '2026-04'
// Un año de pagos son ~9.000 filas: el filtrado del detalle se hace en el
// navegador, asi que se acota el rango para no mandar mas que eso.
export const MAX_MESES = 12
// Mismo tipo fijo que el panel FICO y los dashboards (decision pendiente #2:
// el sheet usa 3.60 manual). La pantalla deja cambiarlo.
export const TIPO_CAMBIO_DEFAULT = 3.75

const USD = 3042
const LINEA = { EN_VIVO: 3225, ONLINE: 3226, FUNDACION: 3227 }
const MODALIDAD_ONLINE = 2623
const TIPO_CONGRESO = 2507
// Pago de Certificado, de Reasignacion y Diferencia por Cambio de Curso: sin
// cuota son los "Pagos extras / Adicionales" del sheet, no una venta.
const TIPOS_ADICIONAL = new Set([5061, 5064, 5065])

export const GRUPOS = [
  { id: 'EN_VIVO_VENTAS', label: 'Ventas Zoom', linea: 'EN VIVO' },
  { id: 'EN_VIVO_CUOTAS', label: 'Cuotas Zoom', linea: 'EN VIVO' },
  { id: 'ONLINE', label: 'Ventas Online', linea: 'ONLINE' },
  { id: 'FUNDACION', label: 'Fundación WE', linea: 'FUNDACIÓN' },
  { id: 'EXTRAS', label: 'Pagos extras', linea: 'ADICIONALES' }
]

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const mesIndex = ym => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1
const mesDe = idx => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`

// desde/hasta 'YYYY-MM' (hasta opcional = un solo mes) → rango de fechas
// [inicio, fin) para el WHERE.
export function parsePeriodo ({ desde, hasta } = {}) {
  const to = hasta || desde
  if (!MES_RE.test(desde || '') || !MES_RE.test(to || '')) {
    throw new DomainError('Mes inválido: usa el formato AAAA-MM', { code: 'MES_INVALIDO' })
  }
  if (desde < PRIMER_MES) {
    throw new DomainError('Los ingresos están en el ERP desde abril 2026', { code: 'FUERA_DE_ALCANCE' })
  }
  if (to < desde) throw new DomainError('El mes final es anterior al inicial', { code: 'RANGO_INVALIDO' })
  if (mesIndex(to) - mesIndex(desde) + 1 > MAX_MESES) {
    throw new DomainError(`El rango no puede pasar de ${MAX_MESES} meses`, { code: 'RANGO_INVALIDO' })
  }
  return { desde, hasta: to, inicio: `${desde}-01`, fin: `${mesDe(mesIndex(to) + 1)}-01` }
}

// Tipo de pago del sheet. Sale de la forma de pago de la INSCRIPCION
// (cat_payment_plan), la misma regla de FICO > Inscripciones y de la
// sincronizacion al sheet (integration.repository: BECA / PT / PP). El
// cat_payment_type del pago no sirve: marca muchas cuotas como "Pago Unico".
//   adicional sin cuota              → ADICIONAL
//   inscripcion de total 0 o monto 0 → BECA
//   forma de pago contado            → PT (pago total)
//   en cuotas: la primera (0 o 1)    → PP (pago inicial)
//   en cuotas: el resto              → CUOTA
// Sin forma de pago cargada se deduce del cronograma (una sola cuota = PT).
const PLAN_CONTADO = 'we_payment_way_single'
const PLAN_CUOTAS = 'we_payment_way_installments'

export function tipoPago (row) {
  const sinCuota = row.installment_number == null
  if (sinCuota && TIPOS_ADICIONAL.has(row.payment_type_id)) return 'ADICIONAL'
  if (Number(row.monto) === 0 || Number(row.enrollment_total) === 0) return 'BECA'
  const contado = row.payment_plan === PLAN_CONTADO ||
    (row.payment_plan !== PLAN_CUOTAS && Number(row.total_installments) <= 1)
  if (contado || sinCuota) return 'PT'
  return row.installment_number === row.min_number ? 'PP' : 'CUOTA'
}

// Linea de negocio. Unos pocos programas no la tienen cargada (o tienen
// "Educación"): congresos van a Fundacion y el resto sale de la modalidad.
export function lineaNegocio (row) {
  if (row.business_line_id === LINEA.EN_VIVO) return 'EN VIVO'
  if (row.business_line_id === LINEA.ONLINE) return 'ONLINE'
  if (row.business_line_id === LINEA.FUNDACION) return 'FUNDACIÓN'
  if (row.type_program_id === TIPO_CONGRESO) return 'FUNDACIÓN'
  return row.modality_id === MODALIDAD_ONLINE ? 'ONLINE' : 'EN VIVO'
}

// Fila del resumen a la que suma el pago. Las membresias GOLD y BLACK se
// reparten antes en toDetalles.
export function grupoDe (linea, tipo) {
  if (tipo === 'ADICIONAL') return 'EXTRAS'
  if (linea === 'ONLINE') return 'ONLINE'
  if (linea === 'FUNDACIÓN') return 'FUNDACION'
  return tipo === 'CUOTA' ? 'EN_VIVO_CUOTAS' : 'EN_VIVO_VENTAS'
}

const round2 = n => Math.round(n * 100) / 100

export function toDetalle (row) {
  const linea = lineaNegocio(row)
  const tipo = tipoPago(row)
  return {
    paymentId: row.payment_id,
    enrollmentId: row.enrollment_id,
    fechaPago: row.fecha_pago,
    celular: row.celular ?? null,
    alumno: row.alumno ?? null,
    lineaNegocio: linea,
    tipoPrograma: row.tipo_programa ?? null,
    lineaProducto: row.linea_producto ?? null,
    curso: row.curso ?? null,
    edicion: row.edicion ?? null,
    tipoPago: tipo,
    moneda: row.currency_id === USD ? 'USD' : 'PEN',
    monto: Number(row.monto),
    medioPago: row.medio_pago ?? null,
    entidadEmpresa: row.entidad_empresa ?? null,
    entidadFinanciera: row.entidad_financiera ?? null,
    nOper: row.n_oper || null,
    estadoLiquidacion: row.estado_liquidacion ?? null,
    grupo: grupoDe(linea, tipo)
  }
}

// Membresias GOLD y BLACK: el sheet parte cada venta en la parte de programas
// online y la de Zoom (columnas "PAGO ONLINE" / "PAGO ZOOM" de las hojas
// WE-MB). FICO pidio la misma estructura (26/10/2026):
//   venta (PT o PP inicial) → hasta 250 en ONLINE (tipo PT) + el resto en EN VIVO
//   cuotas                  → todo en EN VIVO
// WE PLUS y WE PLAT quedan enteras en su linea (ONLINE).
const MEMBRESIAS_PARTIDAS = new Set(['MEMB-02', 'MEMB-04'])
// Tope de la parte ONLINE por moneda (FICO, 26/10/2026: S/ 250 o US$ 75).
export const PARTE_ONLINE = { PEN: 250, USD: 75 }

// Filas de detalle de un pago: una, o dos si es venta de membresia partida.
// Las dos mitades comparten paymentId; `parte` las distingue.
export function toDetalles (row) {
  const d = toDetalle(row)
  if (!MEMBRESIAS_PARTIDAS.has(row.version_code)) return [d]
  if (d.tipoPago === 'CUOTA') return [{ ...d, lineaNegocio: 'EN VIVO', grupo: 'EN_VIVO_CUOTAS' }]
  if (d.tipoPago !== 'PT' && d.tipoPago !== 'PP') return [d]
  const online = Math.min(d.monto, PARTE_ONLINE[d.moneda])
  const filas = [{ ...d, parte: 'ONLINE', lineaNegocio: 'ONLINE', tipoPago: 'PT', monto: online, grupo: 'ONLINE' }]
  const zoom = round2(d.monto - online)
  if (zoom > 0) filas.push({ ...d, parte: 'EN VIVO', lineaNegocio: 'EN VIVO', monto: zoom, grupo: 'EN_VIVO_VENTAS' })
  return filas
}

// Pago de FICO > Pagos Adicionales. Siempre suma a "Pagos extras" (linea
// ADICIONALES del sheet), sea cual sea su linea de negocio. paymentId negativo:
// la tabla usa paymentId como clave de fila y no choca con los de payments.
export function toDetalleAdicional (row) {
  return {
    paymentId: -row.additional_payment_id,
    additionalPaymentId: row.additional_payment_id,
    enrollmentId: null,
    fechaPago: row.fecha_pago,
    celular: row.phone ?? null,
    alumno: row.full_name ?? null,
    lineaNegocio: row.business_line === 'FUNDACIÓN WE' ? 'FUNDACIÓN' : row.business_line,
    tipoPrograma: 'ADICIONALES',
    lineaProducto: row.product_line ?? null,
    curso: row.program ?? null,
    edicion: null,
    asunto: row.subject ?? null,
    tipoPago: 'ADICIONAL',
    moneda: row.currency === 'USD' ? 'USD' : 'PEN',
    monto: Number(row.monto),
    medioPago: row.medio_pago ?? null,
    entidadEmpresa: row.entidad_empresa ?? null,
    entidadFinanciera: row.entidad_financiera ?? null,
    nOper: row.transaction_code || null,
    estadoLiquidacion: row.status ?? null,
    grupo: 'EXTRAS'
  }
}

// Resumen del bloque azul del sheet: cada fila en PEN, USD, total en soles y
// participacion. El front lo recalcula igual sobre lo filtrado.
export function buildResumen (detalle, tipoCambio = TIPO_CAMBIO_DEFAULT) {
  const filas = GRUPOS.map(g => ({ ...g, pen: 0, usd: 0, soles: 0, pagos: 0, pct: 0 }))
  const porId = Object.fromEntries(filas.map(f => [f.id, f]))
  for (const d of detalle) {
    const f = porId[d.grupo]
    if (d.moneda === 'USD') f.usd += d.monto
    else f.pen += d.monto
    f.pagos += 1
  }
  let total = 0
  for (const f of filas) {
    f.pen = round2(f.pen)
    f.usd = round2(f.usd)
    f.soles = round2(f.pen + f.usd * tipoCambio)
    total += f.soles
  }
  for (const f of filas) f.pct = total ? round2((f.soles / total) * 100) : 0
  return {
    tipoCambio,
    filas,
    total: {
      pen: round2(filas.reduce((a, f) => a + f.pen, 0)),
      usd: round2(filas.reduce((a, f) => a + f.usd, 0)),
      soles: round2(total),
      pagos: detalle.length
    }
  }
}
