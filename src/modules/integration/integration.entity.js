// Reglas puras del dominio integration. Sin BD, googleapis, Slack ni red.
// Transforman filas de BD en las matrices de celdas que se escriben en Sheets
// y arman los bloques de presentacion de Slack.

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
  return [
    r.cod || '', r.ed || '', r.f_inicio || '', r.f_pago || '',
    r.dni || '', r.nombres || '', r.celular || '', r.correo || '',
    r.ocup || '', r.asesor || '', r.estado || '', r.dsct || '',
    r.al_dia || '', r.inicial || '', r.saldo || '', r.ingreso || '',
    r.tipo_cliente || '', r.estado_alumno || '',
    r.membresia || '', r.flex || ''
  ]
}

// Mapea un resultado de la query de aula FICO a las 16 columnas A..P.
export function buildAulaRow (r) {
  return [
    r.curso || '', r.catg || '', r.f_inicio || '', r.dni || '',
    r.nombres || '', r.celular || '', r.correo || '', r.ocup || '',
    r.asesor || '', r.estado_alumno || '', r.al_dia || '', r.saldo || '',
    r.estado_pago || '', r.descuento || '', r.tipo_cliente || '', r.es_member || ''
  ]
}

// Mapea un resultado de la query de consolidado FICO a las 31 columnas A..AE.
export function buildConsolidadoRow (r) {
  return [
    r.cod || '', r.ed || '', r.f_inicio || '', r.f_pago || '',
    r.dni || '', r.nombres || '', r.celular || '', r.correo || '',
    r.ocup || '', r.asesor || '', r.estado || '', r.dsct || '',
    r.status_pago || '', r.inicial || '',
    r.fc1 || '', r.c1 || '', r.fc2 || '', r.c2 || '',
    r.fc3 || '', r.c3 || '', r.fc4 || '', r.c4 || '',
    r.fc5 || '', r.c5 || '',
    r.saldo || '', r.ingreso || '',
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
        cuota.monto || '',
        cuota.medio_pago || '',
        cuota.entidad_empresa || '',
        cuota.entidad_financiera || '',
        cuota.n_operacion || ''
      )
      proyeccionCols.push(
        cuota.fc_proyeccion || '',
        cuota.monto_proyeccion || ''
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
