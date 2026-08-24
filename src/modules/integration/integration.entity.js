// Reglas puras del dominio integration. Sin BD, googleapis, Slack ni red.
// Transforman filas de BD en las matrices de celdas que se escriben en Sheets
// y arman los bloques de presentacion de Slack.

// ponytail: lista fija de alumnos que la sincronizacion FICO manda SIEMPRE con
// monto 0 en TODAS las hojas con importe por alumno (Ventas, Aula, Consolidado,
// Cuotas, Adicionales). Pedido de negocio: estos enrollments no deben sumar a
// ingresos ni a los reportes. Match por correo normalizado (lower/trim); los
// emails aqui van en minuscula. Mover a config/BD si la lista crece.
// 2026-08-13: los 4 alumnos de Excel Intermedio (inicio 02/07/2026) salieron de
// la lista porque ya pagaron; vuelven a sumar con su monto real.
export const ZERO_AMOUNT_EMAILS = new Set([
  'wchambi@bancoripley.com.pe'
])

// True si el correo esta en la lista de monto-cero. Tolera null/undefined.
export function isZeroAmountEmail (correo) {
  if (!correo) return false
  return ZERO_AMOUNT_EMAILS.has(String(correo).trim().toLowerCase())
}

// Convierte un valor de BD a la representacion de celda de Sheets:
// null/undefined -> '', Date -> 'YYYY-MM-DD HH:MM:SS', resto -> String(val).
export function serializeSheetValue (val) {
  if (val === null || val === undefined) return ''
  if (val instanceof Date) return val.toISOString().replace('T', ' ').substring(0, 19)
  return String(val)
}

// Serializa una fila completa de BD a un arreglo de celdas, respetando el orden
// de las cabeceras dadas.
export function serializeSheetRow (row, headers) {
  return headers.map(h => serializeSheetValue(row[h]))
}

// Mapea un resultado de la query de ventas FICO a las 20 columnas A..T.
export function buildSalesRow (r) {
  const z = isZeroAmountEmail(r.correo)
  const money = (v) => (z ? 0 : (v || ''))
  return [
    r.cod || '', r.ed || '', r.f_inicio || '', r.f_pago || '',
    r.dni || '', r.nombres || '', r.celular || '', r.correo || '',
    r.ocup || '', r.asesor || '', r.estado || '', money(r.dsct),
    money(r.al_dia), money(r.inicial), money(r.saldo), money(r.ingreso),
    r.tipo_cliente || '', r.estado_alumno || '',
    r.membresia || '', r.flex || ''
  ]
}

// Hoja "Adicionales" (pagos sueltos: certificado de becados y reasignaciones):
// 19 columnas A..S. Fijas por regla de negocio: LINEA DE NEGOCIO='EN VIVO',
// ESTADO='EFECTUADO', REALIZADO?=TRUE, TIPO PROGRAMA='ADICIONALES'.
// ASUNTO viene de la query segun el tipo de pago ('Cert. becas' / 'REASIGNACIÓN').
// LINEA DE PRODUCTO: prefijo del version_code solo para reasignaciones.
// TIPO DE PAGO queda vacia (la gestionan a mano).
export const ADICIONALES_HEADER_ROW = [
  'N°', 'LÍNEA DE NEGOCIO', 'PROGRAMA', 'ASUNTO', 'F. PAGO',
  'NOMBRES Y APELLIDOS', 'CELULAR', 'CORREO', 'ESTADO', 'REALIZADO?',
  'MONTO', 'TIPO DE MONEDA', 'MEDIO DE PAGO', 'ENTIDAD EMPRESA',
  'ENTIDAD FINANCIERA', 'N° OPERACIÓN', 'TIPO PROGRAMA', 'LÌNEA DE PRODUCTO', 'TIPO DE PAGO'
]

export function buildAdicionalesRow (r, idx) {
  const monto = isZeroAmountEmail(r.correo) ? 0 : (r.monto || '')
  return [
    String(idx + 1), 'EN VIVO', r.programa || '', r.asunto || 'Cert. becas',
    r.f_pago || '', r.nombres || '', r.celular || '', r.correo || '',
    'EFECTUADO', 'TRUE', monto, r.tipo_moneda || '',
    r.medio_pago || '', r.entidad_empresa || '', r.entidad_financiera || '',
    r.n_operacion || '', 'ADICIONALES', r.linea_producto || '', ''
  ]
}

// Mapea un resultado de la query de aula FICO a las 16 columnas A..P.
export function buildAulaRow (r) {
  const z = isZeroAmountEmail(r.correo)
  const money = (v) => (z ? 0 : (v || ''))
  return [
    r.curso || '', r.catg || '', r.f_inicio || '', r.dni || '',
    r.nombres || '', r.celular || '', r.correo || '', r.ocup || '',
    r.asesor || '', r.estado_alumno || '', money(r.al_dia), money(r.saldo),
    r.estado_pago || '', money(r.descuento), r.tipo_cliente || '', r.es_member || ''
  ]
}

// Cabecera de "7. Convenios" (ventas B2B). Solo se escribe si la hoja no
// existe todavia: ensureAndWrite respeta los headers que ya puso el usuario.
export const CONVENIOS_HEADER_ROW = [
  'FECHA', 'EMPRESA', 'TIPO DE CLIENTE', 'PROGRAMA', 'NOMBRE', 'NÚMERO',
  'NOMBRE P.', 'F.PROGRAMA', 'OCUP.', 'F. PAGO', 'MONEDA', 'MONTO',
  'TIPO PAGO', 'MES', 'AÑO', 'CORREO', 'PAGO EFECTUADO', 'TIPO PROGRAM',
  'UNIDAD', 'AS'
]

// Mapea un resultado de la query de convenios FICO a las 20 columnas A..T.
// EMPRESA, TIPO DE CLIENTE y PROGRAMA salen del contrato B2B: hoy llegan
// vacias porque las ventas todavia no guardan la empresa, y se llenan solas
// cuando el formulario la pida.
export function buildConveniosRow (r) {
  const z = isZeroAmountEmail(r.correo)
  const money = (v) => (z ? 0 : (v || ''))
  return [
    r.fecha || '', r.empresa || '', r.tipo_cliente || '', r.programa || '',
    r.nombres || '', r.numero || '', r.nombre_p || '', r.f_programa || '',
    r.ocup || '', r.f_pago || '', r.moneda || '', money(r.monto),
    r.tipo_pago || '', r.mes || '', r.anio || '', r.correo || '',
    money(r.pago_efectuado), r.tipo_program || '', r.unidad || '', r.asesor || ''
  ]
}

// Cabecera de "5. Membresias". Solo se escribe si la hoja no existe todavia:
// ensureAndWrite respeta los headers que ya puso el usuario.
export const MEMBRESIAS_HEADER_ROW = [
  'NOMBRES', 'APELLIDOS', 'CELULAR', 'CORREO', 'MEMBRESIA', 'VENCIMIENTO'
]

// Mapea un resultado de la query de membresias FICO a las 6 columnas A..F.
export function buildMembresiasRow (r) {
  return [
    r.nombres || '', r.apellidos || '', r.celular || '',
    r.correo || '', r.membresia || '', r.vencimiento || ''
  ]
}

// Cabecera de "4. Ventas Eventos" (ventas de congresos/eventos). Solo se
// escribe si la hoja no existe todavia: ensureAndWrite respeta los headers que
// ya puso el usuario.
export const EVENTOS_HEADER_ROW = [
  'F. PAGO', 'DNI', 'NOMBRES', 'APELLIDOS', 'CELULAR', 'CORREO', 'OCUP',
  'ESTADO', 'DSCTAL', 'INICIAL', 'SALDO', 'INGRESO', 'MODALIDAD', 'N° DE ASIENTO'
]

// Mapea un resultado de la query de eventos FICO a las 14 columnas A..N.
// MODALIDAD es la categoria de entrada (VIP/GENERAL/PREMIUM/VIRTUAL) y el
// asiento solo lo traen las VIP; ambos van vacios en los congresos viejos, que
// se vendieron antes de que existiera la categoria.
export function buildEventosRow (r) {
  const z = isZeroAmountEmail(r.correo)
  const money = (v) => (z ? 0 : (v || ''))
  return [
    r.f_pago || '', r.dni || '', r.nombres || '', r.apellidos || '',
    r.celular || '', r.correo || '', r.ocup || '', r.estado || '',
    money(r.dsct), money(r.inicial), money(r.saldo), money(r.ingreso),
    r.modalidad || '', r.asiento || ''
  ]
}

// Mapea un resultado de la query de consolidado FICO a las 31 columnas A..AE.
export function buildConsolidadoRow (r) {
  const z = isZeroAmountEmail(r.correo)
  const money = (v) => (z ? 0 : (v || ''))
  return [
    r.cod || '', r.ed || '', r.f_inicio || '', r.f_pago || '',
    r.dni || '', r.nombres || '', r.celular || '', r.correo || '',
    r.ocup || '', r.asesor || '', r.estado || '', money(r.dsct),
    r.status_pago || '', money(r.inicial),
    r.fc1 || '', money(r.c1), r.fc2 || '', money(r.c2),
    r.fc3 || '', money(r.c3), r.fc4 || '', money(r.c4),
    r.fc5 || '', money(r.c5),
    money(r.saldo), money(r.ingreso),
    r.tipo_moneda || '', r.medio_pago || '',
    r.entidad_empresa || '', r.entidad_financiera || '',
    r.n_operacion || ''
  ]
}

// Expande la fila de cuotas FICO en columnas pivot: 10 base + MAX_CUOTAS grupos
// de 6 columnas de pago real + MAX_CUOTAS grupos de 2 columnas de proyeccion.
// Devuelve la fila aplanada junto con el detalle de cuotas truncadas (las que
// exceden MAX_CUOTAS) para que el llamador pueda observar la perdida de datos.
export function buildCuotasRow (r, MAX_CUOTAS) {
  const z = isZeroAmountEmail(r.correo)
  const baseCols = [
    r.cod || '', r.ed || '', r.f_inicio || '',
    r.nombres || '', r.celular || '', r.correo || '',
    r.ocup || '', r.asesor || '', r.estado || '', r.moneda || ''
  ]
  const cuotas = Array.isArray(r.cuotas_json) ? r.cuotas_json : []
  const truncated = cuotas.length > MAX_CUOTAS ? cuotas.length - MAX_CUOTAS : 0

  const cuotaCols = []
  const proyeccionCols = []
  for (let i = 0; i < MAX_CUOTAS; i++) {
    const cuota = cuotas[i]
    if (cuota) {
      cuotaCols.push(
        cuota.fc || '',
        z ? 0 : (cuota.monto || ''),
        cuota.medio_pago || '',
        cuota.entidad_empresa || '',
        cuota.entidad_financiera || '',
        cuota.n_operacion || ''
      )
      proyeccionCols.push(
        cuota.fc_proyeccion || '',
        z ? 0 : (cuota.monto_proyeccion || '')
      )
    } else {
      cuotaCols.push('', '', '', '', '', '')
      proyeccionCols.push('', '')
    }
  }
  return { row: [...baseCols, ...cuotaCols, ...proyeccionCols], truncated }
}

// Construye la fila de cabeceras de la hoja "3. Cuotas" para MAX_CUOTAS cuotas:
// 10 columnas base + MAX_CUOTAS x 6 (pago real) + MAX_CUOTAS x 2 (proyeccion).
export function buildCuotasHeaderRow (MAX_CUOTAS) {
  const headers = ['COD', 'ED', 'F. INICIO', 'NOMBRES Y APELLIDOS', 'CELULAR', 'CORREO', 'OCUP', 'AS', 'ESTADO', 'MONEDA']
  for (let i = 1; i <= MAX_CUOTAS; i++) {
    headers.push(`FC${i}`, `C${i}`, 'MEDIO DE PAGO', 'ENTIDAD EMPRESA', 'ENTIDAD FINANCIERA', 'N° OPERACION')
  }
  for (let i = 1; i <= MAX_CUOTAS; i++) {
    headers.push(`F.PAGO C${i}`, `C${i}`)
  }
  return headers
}

// Cabeceras de la hoja "CONT SISTEMAS" (cronograma con contadores por canal).
// Mismos titulos que la hoja manual de control, saltos de linea incluidos.
export const CRONOGRAMA_HEADER_ROW = [
  'CATEG', 'COD', 'PROGRAMA', 'ED.',
  'CUR1', 'INI CUR1', 'CUR2', 'INI CUR2', 'CUR3', 'INI CUR3',
  'CUR4', 'INI CUR4', 'CUR5', 'INI CUR5',
  'F INICIO', 'COD_C1', 'CURSO',
  'AULA\n(contempla becados, memb, b2b)',
  'B2B', 'BECAS', 'MEMB',
  'PRG  NETO \n(no becados)',
  'SEGUIMIENTO NETO\n (no becados)',
  'AULA NUEVA\n(aula real: padre 0, sin becas)',
  'RP'
]

// Mapea una edicion del cronograma + sus metricas por canal a las 25 columnas
// A..Y de "CONT SISTEMAS". `m` viene de classroomChannelMetricsList (puede ser
// undefined si la edicion no tiene inscritos). La columna CURSO va fija en 0
// (confirmado con negocio: no se usa). AULA = headcount del salon incluyendo
// becados (cnt_total); AULA NUEVA = cnt_aula, la misma columna AULA del
// cronograma ERP (padre/diploma 0, hijo con su salon completo, sin becas).
export function buildCronogramaRow (r, m) {
  const cursos = r.cursos || {}
  const slots = []
  for (let i = 1; i <= 5; i++) {
    const c = cursos[String(i)]
    slots.push(c?.name || '', c?.ini || '')
  }
  const ventas = m?.cnt_ventas ?? 0
  const segui = m?.cnt_segui ?? 0
  const memb = m?.cnt_memb ?? 0
  const b2b = m?.cnt_b2b ?? 0
  return [
    r.categ || '', r.cod || '', r.programa || '', r.ed || '',
    ...slots,
    r.f_inicio || '', r.cod || '',
    0,                        // CURSO: fijo en 0
    m?.cnt_total ?? 0,        // AULA (contempla becados, memb, b2b)
    b2b,
    m?.cnt_becas ?? 0,
    memb,
    ventas,                   // PRG NETO
    segui,                    // SEGUIMIENTO NETO
    // AULA NUEVA = columna AULA del cronograma ERP (cnt_aula): el PADRE/diploma
    // va en 0 (su venta se registra arriba pero no es un salon) y el HIJO lleva
    // el aula completa (incluye 1er curso cuya venta vive en el padre), sin becas.
    m?.cnt_aula ?? 0,
    r.cnt_rp ?? 0
  ]
}

// Construye el array blocks[] de Slack para la notificacion de un pago web.
// Logica de presentacion sin I/O: recibe la fila ya consultada y la lista de
// adjuntos del lead.
export function buildSlackEnrollmentBlocks (d, attachments = []) {
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🌐 Nuevo Pago Web Registrado', emoji: true } },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*📚 Programa:*\n${d.program_name || '—'}` },
        { type: 'mrkdwn', text: `*📅 Fecha Inicio:*\n${d.fecha_inicio || '—'}` },
        { type: 'mrkdwn', text: `*📞 Celular:*\n${d.celular || '—'}` },
        { type: 'mrkdwn', text: `*🎯 Asesor:*\n${d.asesor || '—'}` },
        { type: 'mrkdwn', text: `*📋 Obs:*\n${d.notes || '—'}` }
      ]
    }
  ]

  if (attachments.length > 0) {
    const linksText = attachments
      .map((a, i) => `• <${a.url}|${a.name || `Adjunto ${i + 1}`}>`)
      .join('\n')

    blocks.push({ type: 'divider' })
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📎 Constancias adjuntas (${attachments.length}):*\n${linksText}`
      }
    })
  } else {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '⚠️ Sin constancias adjuntas' }]
    })
  }

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Matrícula #${d.enrollment_id} · Registrada el ${d.fecha_registro}`
    }]
  })

  return blocks
}
