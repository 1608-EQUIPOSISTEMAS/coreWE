import { importerPorts } from '../importer.ports.js'
import { cellText, normText, buildHeaderIndex, findCol } from '../importer.xlsx.js'

// Adaptador "Hoja FICO": ingiere la planilla operativa real de FICO (pestaña
// "INS - N" de las hojas MBA/PEE/ESP/CURSOS) directamente desde el Google Sheet
// (CSV, con formulas evaluadas) o desde un .xlsx subido. Empareja columnas por
// ENCABEZADO (tolerante a las variantes entre tipos de programa) y reconstruye
// la inscripcion + el cronograma de cuotas (formato ancho FCn/Cn).
//
// FASE 1: inscripcion + cronograma (cuotas pendientes). La pestaña "Cuota INS-N"
// con el detalle de pagos por cuota es FASE 2.

// --- Alias de encabezado (las 4 hojas comparten el nucleo; difieren en N de
// cursos/cuotas y algun renombre). El emparejado es por estos alias. ---------
const H = {
  document_number: ['dni', 'documento'],
  full_name: ['nombres y apellidos'],
  email: ['correo'],
  phone: ['celular'],
  ocup: ['ocup'],
  edition: ['ed'],
  course_code: ['cod'], // columna COD = version_code del curso (ej "IA-CZ-03")
  modality: ['modalidad'],
  currency: ['tipo de moneda', 'moneda'],
  payment_medium: ['medio de pago'],
  transaction_code: ['n° operacion', 'n operacion', 'numero operacion'],
  payment_date: ['f. pago', 'f pago'],
  down_payment: ['inicial'],
  ingreso: ['ingreso'],
  saldo: ['saldo'],
  // Columna J: tipo de membresia (WE BLACK / WE GOLD / ...). Con valor = el
  // alumno es miembro y el curso es beneficio (precio 0 legitimo); vacia = no.
  member_type: ['tip_member', 'tip member', 'tipo de miembro', 'tipo miembro', 'membresia'],
  // Columna AS: codigo del asesor/agente (ej "AE30"); = users.alias.
  agent_code: ['as', 'asesor', 'agente', 'cod asesor', 'codigo asesor', 'cod. asesor'],
  // Entidad empresa: la razon social que factura (WEC/WEEE/WEL/WEF/...). -> cat_business_entity.
  business_entity: ['entidad empresa', 'empresa', 'razon social', 'entidad'],
  // Entidad financiera: el banco donde se deposito (BCP/BBVA/...). Junto con empresa
  // y moneda resuelve la cuenta bancaria (bank_account_id).
  financial_entity: ['entidad financiera', 'banco', 'cuenta', 'cuenta bancaria'],
  // Tipo de descuento: con valor "BECA" = beca (precio 0 legitimo, via is_scholarship
  // del SP). El nombre del encabezado varia entre hojas; se detecta por VALOR ("beca").
  scholarship: ['tipo dscto', 'tipo de descuento', 'tipo descuento', 'tipo dsct', 'tipo de dscto', 'beca', 'descuento']
}
const MAX_CUOTAS = 6 // FC1/C1 .. FC6/C6 (CURSOS llega a 5; sobran columnas se ignoran)

// --- Columnas logicas (para chequeo de obligatorios y previsualizacion) -----
// `key` debe coincidir con las claves que produce ingest().
const columns = [
  { key: 'document_number', header: 'Documento (DNI)', required: true },
  { key: 'full_name', header: 'Nombres y apellidos', required: true },
  { key: 'email', header: 'Correo', required: false },
  { key: 'phone', header: 'Celular', required: false },
  { key: 'edition', header: 'Edicion (ED)', required: true },
  { key: 'total_amount', header: 'Monto total', required: false },
  { key: 'payment_way', header: 'Forma de pago', required: false }
]

// --- Ingesta a medida: workbook -> { rows } --------------------------------
// Lee la pestaña de inscripciones, empareja por encabezado y emite filas con
// claves limpias + un array `_installments` (cronograma reconstruido de FCn/Cn).
function ingest (wb) {
  const ws = findInscriptionSheet(wb)
  if (!ws) throw new Error('No se encontro la pestaña de inscripciones (con columna DNI).')

  const headerRow = findHeaderRow(ws)
  const idx = buildHeaderIndex(ws, headerRow)
  const col = {}
  for (const key in H) col[key] = findCol(idx, H[key])

  // Indices de FCn (fecha) y Cn (monto) del cronograma ancho.
  const fc = []; const cn = []
  for (let n = 1; n <= MAX_CUOTAS; n++) {
    fc[n] = findCol(idx, ['fc' + n])
    cn[n] = findCol(idx, ['c' + n])
  }

  const rows = []
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return
    const documento = col.document_number ? cellText(row.getCell(col.document_number).value) : ''
    if (!documento) return // sin DNI no es una inscripcion (filas de relleno/totales)

    const get = (key) => col[key] ? cellText(row.getCell(col[key]).value) : ''
    const total = num(get('ingreso')) + num(get('saldo'))

    const installments = []
    for (let n = 1; n <= MAX_CUOTAS; n++) {
      if (!cn[n]) continue
      const amount = num(row.getCell(cn[n]).value)
      if (amount <= 0) continue
      installments.push({
        installment_number: n,
        amount,
        due_date: fc[n] ? cellText(row.getCell(fc[n]).value) : ''
      })
    }

    rows.push({
      rowNumber,
      raw: {
        document_number: documento,
        full_name: get('full_name'),
        email: get('email'),
        phone: get('phone'),
        ocup: get('ocup'),
        edition: get('edition'),
        course_code: get('course_code'),
        modality: get('modality'),
        currency: get('currency'),
        payment_medium: get('payment_medium'),
        transaction_code: get('transaction_code'),
        payment_date: get('payment_date'),
        down_payment: num(get('down_payment')),
        total_amount: total,
        member_type: get('member_type'), // WE BLACK / WE GOLD / '' (col J)
        agent_code: get('agent_code'),    // codigo del asesor (col AS)
        business_entity: get('business_entity'), // ENTIDAD EMPRESA (razon social)
        financial_entity: get('financial_entity'), // ENTIDAD FINANCIERA (banco)
        scholarship: get('scholarship'), // TIPO DSCT: "BECA" = beca (precio 0)
        // Forma de pago inferida: si hay cuotas en el cronograma es "cuotas".
        payment_way: installments.length > 0 ? 'cuotas' : 'contado',
        _installments: installments
      }
    })
  })

  return { rows }
}

// Encuentra la pestaña de inscripciones: la primera cuyo encabezado contiene DNI.
// (CSV trae una sola hoja; el .xlsx descargado trae todas — "1. INS - N" etc.)
function findInscriptionSheet (wb) {
  for (const ws of wb.worksheets) {
    if (findHeaderRow(ws, true) !== null) return ws
  }
  return null
}

// Localiza la fila de encabezado (la que contiene "DNI"/"DOCUMENTO") en las
// primeras filas. Devuelve el numero de fila, o null si no la encuentra.
function findHeaderRow (ws, probeOnly = false) {
  const limit = Math.min(8, ws.rowCount || 8)
  for (let r = 1; r <= limit; r++) {
    let found = false
    ws.getRow(r).eachCell((cell) => {
      const t = normText(cell.value)
      if (t === 'dni' || t === 'documento') found = true
    })
    if (found) return r
  }
  return probeOnly ? null : 1
}

// =============================================================================
// resolveRow — traduce `raw` (campos limpios) + `installments` a IDs de dominio.
// =============================================================================
// Catalogos -> IDs por alias/texto; ED -> edicion via el indice ctx.editionsByCode
// (cargado una vez por archivo en loadContext, no 1 query por fila).
async function resolveRow (raw, ctx, installments = []) {
  const errors = []
  const { firstName, lastName } = splitName(raw.full_name)
  // Columna J con valor (WE BLACK/GOLD/...) = miembro: el curso es cortesia de su
  // membresia, precio 0 legitimo. NO es beca: entra por la via is_membership_benefit
  // del SP. Vacia = inscripcion normal (precio debe ser > 0). Ademas se resuelve la
  // version del programa-membresia para crear la inscripcion que marca al miembro.
  const memberType = (raw.member_type || '').trim()
  const isMembershipBenefit = memberType !== ''
  // Precio 0 = pago cero via is_scholarship del SP (de otro modo rechaza list_price
  // <= 0). Aplica a: columna de descuento "BECA", o cualquier fila con total 0 que
  // no sea membresia (descuento 100%, B2B totalmente cubierto, etc.). Una membresia
  // tiene su propia via, por eso se excluye.
  const isScholarship = !isMembershipBenefit &&
    (normText(raw.scholarship).includes('beca') || (Number(raw.total_amount) || 0) <= 0)
  let membershipVersionId = null
  let membershipProgramId = null
  if (isMembershipBenefit) {
    const tier = (ctx?.membershipByName || new Map()).get(normText(memberType)) || null
    membershipVersionId = tier?.version_id || null
    membershipProgramId = tier?.program_id || null
    if (!membershipVersionId) {
      errors.push(`Membresia "${memberType}" (columna J) no coincide con ningun programa de membresia (WE BLACK/GOLD/PLAT/PLUS).`)
    }
  }
  const data = {
    document_number: raw.document_number ? String(raw.document_number).trim() : null,
    first_name: firstName,
    last_name: lastName,
    email: raw.email || null,
    phone: raw.phone ? String(raw.phone).trim() : null,
    total_amount: raw.total_amount || 0,
    list_price: raw.total_amount || 0,
    saved_money: raw.down_payment || 0,
    transaction_code: raw.transaction_code || null,
    payment_date: normalizeDate(raw.payment_date),
    observations: isMembershipBenefit
      ? `Importacion masiva FICO (hoja) - beneficio de membresia ${memberType}`
      : isScholarship
        ? 'Importacion masiva FICO (hoja) - BECA'
        : 'Importacion masiva FICO (hoja)',
    is_scholarship: isScholarship,
    is_membership_benefit: isMembershipBenefit,
    member_type: isMembershipBenefit ? memberType : null,
    membership_version_id: membershipVersionId, // version del programa-membresia
    // Tier normalizado en el curso (columna MEMBRESIA del sheet lo lee de aqui).
    membership_program_id: membershipProgramId,
    // OCUP -> perfil de cliente (determinista, sin catalogo).
    client_profile: profileFromOcup(raw.ocup)
  }

  // Agente (columna AS). Dos casos:
  //  - Marcador de CANAL (S/A, SA, WEB, B2B, WE): va a agent_origin, sin asesor.
  //    "S/A"/"SA" = sin asesor -> 'SA' (asi se muestra en el listado).
  //  - Codigo de asesor (ej "AE30"): resuelve seller_agent_id por alias. NO se mete
  //    en agent_origin (eso producia el duplicado "AE30 - AE30").
  const agentCode = (raw.agent_code || '').trim()
  if (agentCode) {
    const n = normText(agentCode)
    const isChannel = (x) => x === 'web' || x === 'b2b' || x === 'we'
    if (n === 's/a' || n === 'sa') {
      data.agent_origin = 'SA'
    } else if (isChannel(n)) {
      data.agent_origin = n.toUpperCase()
    } else if (n.includes('-')) {
      // Combo "JF39-B2B" / "B2B-JF39": separa canal y codigo de asesor.
      const parts = agentCode.split('-').map(s => s.trim()).filter(Boolean)
      const channel = parts.find(p => isChannel(normText(p)))
      const code = parts.find(p => !isChannel(normText(p)))
      if (channel) data.agent_origin = channel.toUpperCase()
      if (code) data.seller_agent_id = (ctx?.agentsByAlias || new Map()).get(normText(code)) || null
    } else {
      data.seller_agent_id = (ctx?.agentsByAlias || new Map()).get(n) || null
    }
  }

  // Cronograma (FCn/Cn). ingest lo reconstruye en raw._installments; el pipeline
  // generico pasa [] como 3er arg (solo se usa con hojas de detalle, que FICO no
  // tiene), asi que se cae a raw._installments. Sin esto las cuotas se perdian.
  const schedule = installments.length > 0 ? installments : (raw._installments || [])
  if (schedule.length > 0) {
    data.installment_plan = schedule
      .map(c => ({
        installment_number: Number(c.installment_number),
        amount: Number(c.amount),
        due_date: normalizeDate(c.due_date)
      }))
      .filter(c => c.installment_number && c.amount > 0 && c.due_date)
      .sort((a, b) => a.installment_number - b.installment_number)
  }

  // --- Catalogos -> IDs (ctx.catalog viene de loadContext/getCatalog) --------
  // Solo cat_insc_modality es obligatorio en el SP (el resto tiene default),
  // pero resolvemos moneda/forma de pago para no guardar valores equivocados.
  const cat = ctx?.catalog || {}
  // Modalidad de inscripcion = eje Normal/Flexible (NO presencial/online). La hoja
  // no trae este dato, asi que default "Modalidad Normal" (92% de los registros).
  // ponytail: default normal; mapear desde la hoja si algun dia trae la columna.
  data.cat_insc_modality = catByText(cat, 'we_insc_modality', raw.modality) ||
    catByAlias(cat, 'we_insc_modality', 'we_insc_modality_normal')
  // Forma de pago: ya inferida (contado/cuotas) de forma determinista en ingest.
  data.cat_payment_way = catByAlias(cat, 'we_payment_way',
    raw.payment_way === 'cuotas' ? 'we_payment_way_installments' : 'we_payment_way_single')
  // Moneda: la hoja trae PEN/USD; el catalogo usa SOLES/DOLARES (aliases _soles/
  // _dollars). El grupo we_currency esta inactivo y no llega en getCatalog, asi que
  // se resuelve por ctx.currencyByAlias (puerto listCurrencies). Default soles.
  const curAlias = currencyAliasFor(raw.currency)
  const currencyByAlias = ctx?.currencyByAlias || new Map()
  data.cat_currency = currencyByAlias.get(curAlias) || currencyByAlias.get('we_currency_soles') || null
  // Medio de pago (opcional): transferencia/yape/deposito/etc. null si no matchea.
  data.cat_payment_medium = catByText(cat, 'we_payment_medium', raw.payment_medium)

  // Entidad empresa (ENTIDAD EMPRESA): razon social que factura -> cat_business_entity.
  // Match por descripcion/codigo o por sufijo de alias (WEC/WEEE/WEL/WEF/...).
  const beId = matchBusinessEntity(cat, raw.business_entity)
  if (beId) data.cat_business_entity = beId

  // Cuenta bancaria (ENTIDAD FINANCIERA): banco + empresa + moneda -> bank_account_id.
  // El input del sistema es la cuenta (settled_in_account_id), no el banco a secas;
  // empresa+moneda desambiguan (ej BCP tiene 8 cuentas). Sin match unico: null.
  const accId = matchBankAccount(ctx?.bankAccounts || [], raw.financial_entity, beId, raw.currency)
  if (accId) data.bank_account_id = accId

  // --- ED -> edicion + programa via puerto -----------------------------------
  // Match por (codigo de curso, ED): global_code "E1" se repite, pero el par
  // version_code+global_code es unico entre ediciones activas.
  //
  // CASO ESPECIAL ED "E0" = CONVALIDACION: el alumno lleva el curso suelto (ya
  // curso otro de la especializacion, o lo toma en una fecha sin edicion
  // programada). No hay edicion que asociar: se resuelve solo el curso (version)
  // por COD y program_edition_id queda null (igual que una venta de membresia).
  if (!raw.course_code) {
    errors.push('Falta el codigo de curso para resolver la edicion (columna no encontrada).')
  } else if (isConvalidation(raw.edition)) {
    const versionId = versionIdByCode(ctx, raw.course_code)
    if (versionId) {
      data.program_version_id = versionId
      data.program_edition_id = null
      data.observations = 'Importacion masiva FICO (hoja) - convalidacion (ED E0, sin edicion)'
    } else {
      errors.push(`Convalidacion (ED E0): curso "${raw.course_code}" no existe como version de programa (revisa el codigo COD).`)
    }
  } else {
    // Resuelve contra el indice ya cargado (1 query por archivo, no por fila).
    const ed = (ctx?.editionsByCode || new Map()).get(editionKey(raw.course_code, raw.edition))
    if (ed) {
      data.program_edition_id = ed.program_edition_id
      data.program_version_id = ed.program_version_id
      data.is_package = ed.is_package === true
    } else {
      errors.push(`Edicion no encontrada: curso "${raw.course_code}" + ED "${raw.edition}"`)
    }
  }

  // Si la edicion resuelta es PADRE (paquete), adjuntar sus aulas hijas: el alumno
  // que compra el padre se inscribe en todas. commitRow las crea como hijas.
  if (data.program_edition_id) {
    const children = (ctx?.childEditionsByParent || new Map()).get(Number(data.program_edition_id))
    if (children && children.length) data.child_editions = children
  }

  return { data, errors }
}

// --- Resolucion de catalogo ------------------------------------------------
// El mapa de catalogos viene como { grupo: [{ alias, description, codigo, catalogo_id }] }.
function catId (entry) { return entry ? Number(entry.catalogo_id ?? entry.id) : null }

function catByAlias (catalog, group, alias) {
  return catId((catalog?.[group] || []).find(e => e.alias === alias))
}

// Match por descripcion o codigo normalizados (tolerante a may/min y acentos).
function catByText (catalog, group, text) {
  const t = normText(text)
  if (!t) return null
  const list = catalog?.[group] || []
  const hit = list.find(e => normText(e.description) === t || normText(e.codigo) === t) ||
    list.find(e => normText(e.description).startsWith(t) || t.startsWith(normText(e.description)))
  return catId(hit)
}

// Moneda de la hoja (PEN/USD/SOLES/DOLARES/$) -> alias del catalogo. null si vacio
// o no reconocible (resolveRow cae al default soles).
function currencyAliasFor (raw) {
  const t = normText(raw)
  if (!t) return null
  if (/usd|dolar|\$/.test(t)) return 'we_currency_dollars'
  if (/pen|sol/.test(t)) return 'we_currency_soles'
  return null
}

// Codigo de moneda PEN/USD para comparar contra bank_accounts.currency. null si
// no se reconoce (no filtra por moneda al resolver la cuenta).
function currencyCode (raw) {
  const t = normText(raw)
  if (/usd|dolar|\$/.test(t)) return 'USD'
  if (/pen|sol/.test(t)) return 'PEN'
  return null
}

// Nombres amigables del dropdown "ENTIDAD EMPRESA" de la hoja -> alias del catalogo.
// La hoja NO usa la razon social (ej "WE Consulting" != "WORLD ENTERPRISE CONSULTING
// S.A.C.", "WE LATAM" != "WE EDUCACION LATAM S.A.C."), de ahi el mapa explicito.
const BUSINESS_ENTITY_ALIAS = {
  'we educacion': 'we_business_entity_weee',
  'we consulting': 'we_business_entity_wec',
  'we foundation': 'we_business_entity_wef',
  'we latam': 'we_business_entity_wel',
  'johan palomino': 'we_business_entity_johan'
}

// ENTIDAD EMPRESA -> catalog_id de we_business_entity. 1) mapa de nombres amigables
// de la hoja; 2) descripcion/codigo (catByText); 3) sufijo de alias (WEC/WEEE/...).
function matchBusinessEntity (cat, text) {
  const t = normText(text)
  if (!t) return null
  const group = cat?.we_business_entity || []
  const mappedAlias = BUSINESS_ENTITY_ALIAS[t]
  if (mappedAlias) {
    const hit = group.find(e => e.alias === mappedAlias)
    if (hit) return catId(hit)
  }
  const byText = catByText(cat, 'we_business_entity', text)
  if (byText) return byText
  const hit = group.find(e => normText(String(e.alias || '').replace(/^we_business_entity_/, '')) === t)
  return hit ? catId(hit) : null
}

// ENTIDAD FINANCIERA -> bank_account_id. Filtra por banco (nombre) y, cuando estan,
// por empresa (business_entity) y moneda, que desambiguan cuentas del mismo banco.
// Devuelve la cuenta solo si el match es unico; ante ambiguedad real, null (no
// adivina una cuenta equivocada).
function matchBankAccount (accounts, bankText, businessEntityId, currencyRaw) {
  const t = normText(bankText)
  if (!t || !accounts.length) return null
  // Match exacto de banco primero (asi "BCP" NO engancha "BCP-PROINNOVATE"); solo
  // si no hay exacto se cae a prefijo.
  let candidates = accounts.filter(a => normText(a.bank_name) === t)
  if (!candidates.length) {
    candidates = accounts.filter(a => {
      const name = normText(a.bank_name)
      return name.startsWith(t) || t.startsWith(name)
    })
  }
  if (businessEntityId) {
    const byEntity = candidates.filter(a => Number(a.business_entity_catalog_id) === Number(businessEntityId))
    if (byEntity.length) candidates = byEntity
  }
  const cur = currencyCode(currencyRaw)
  if (cur) {
    const byCur = candidates.filter(a => String(a.currency).toUpperCase() === cur)
    if (byCur.length) candidates = byCur
  }
  return candidates.length === 1 ? Number(candidates[0].account_id) : null
}

// ED "E0" = convalidacion: curso suelto, sin edicion programada que asociar.
function isConvalidation (edition) {
  return normText(edition) === 'e0'
}

// Clave del indice de ediciones: par (version_code de COD, global_code de ED),
// normalizado (may/min y acentos). Unico entre ediciones activas. null si falta.
function editionKey (courseCode, editionCode) {
  const v = normText(courseCode); const ed = normText(editionCode)
  return v && ed ? `${v}|${ed}` : null
}

// Indexa las ediciones activas por editionKey. Pares ambiguos (raro: el par es
// unico entre activas) se guardan como null = no resoluble, igual que antes el
// LIMIT 2 devolvia null si habia mas de un match.
function indexEditions (editions = []) {
  const map = new Map()
  for (const e of editions) {
    const key = editionKey(e.version_code, e.global_code)
    if (!key) continue
    map.set(key, map.has(key) ? null : { program_edition_id: e.program_edition_id, program_version_id: e.program_version_id, is_package: e.is_package === true })
  }
  return map
}

// Resuelve program_version_id por version_code (columna COD) desde el contexto
// ya cargado (programVersions activas). Para convalidaciones, donde no hay
// edicion pero si un curso. Match exacto, normalizado (may/min y acentos).
function versionIdByCode (ctx, courseCode) {
  const t = normText(courseCode)
  if (!t) return null
  const hit = (ctx?.programVersions || []).find(v => normText(v.version_code) === t)
  return hit ? Number(hit.program_version_id) : null
}

// OCUP: P -> profesional, E -> estudiante (confirmado: no hay otros codigos).
function profileFromOcup (ocup) {
  const v = normText(ocup)
  if (v === 'e') return 'estudiante'
  if (v === 'p') return 'profesional'
  return null
}

// Parte "APELLIDOS NOMBRES" en last_name / first_name. Heuristica: los primeros
// 2 tokens son apellidos (convencion peruana); el resto, nombres. Con <=2 tokens
// reparte mitad y mitad. ES UNA SUPOSICION: si tu hoja usa otro orden, ajustala.
function splitName (full) {
  const tokens = String(full || '').trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { firstName: null, lastName: null }
  if (tokens.length === 1) return { firstName: null, lastName: tokens[0] }
  if (tokens.length === 2) return { firstName: tokens[1], lastName: tokens[0] }
  return { firstName: tokens.slice(2).join(' '), lastName: tokens.slice(0, 2).join(' ') }
}

// Parsea montos tolerando AMBOS formatos: coma decimal peruana ("220,00" = 220.00,
// "1.507,00") y punto decimal con coma de miles ("1,507.00"). Antes se borraba la
// coma a secas, convirtiendo "220,00" en 22000 -> el SP rechazaba el plan de cuotas.
// Regla: si hay dos separadores, el ULTIMO es el decimal; si solo hay coma, es
// decimal cuando va seguida de 1-2 digitos (si no, es separador de miles).
export function num (v) {
  let s = cellText(v)
  if (!s) return 0
  s = s.replace(/s\/\.?|us\$|\$/gi, '') // quita simbolo de soles "S/." y dolares ANTES de parsear
  s = s.replace(/[^0-9.,-]/g, '')       // quita "%", espacios, letras restantes
  if (!s) return 0
  const c = s.lastIndexOf(','); const d = s.lastIndexOf('.')
  if (c > -1 && d > -1) {
    s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (c > -1) {
    const dec = s.length - c - 1
    s = (dec === 1 || dec === 2) ? s.replace(',', '.') : s.replace(/,/g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

// Normaliza fecha a 'YYYY-MM-DD'. Acepta ISO (xlsx -> Date) y el formato
// peruano D/M/AAAA o D-M-AAAA (CSV de Google -> texto). Devuelve null si no es
// interpretable.
function normalizeDate (value) {
  const s = cellText(value)
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s)
  if (m) {
    const [, d, mo, y] = m
    const dd = String(d).padStart(2, '0')
    const mm = String(mo).padStart(2, '0')
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) {
      return `${y}-${mm}-${dd}`
    }
  }
  return null
}

async function commitRow (data, { userId }) {
  // Importacion masiva = SOLO insertar. skipFollowup corta correo + Odoo + MV;
  // dedupeByVersion hace idempotentes las convalidaciones (ED E0, sin edicion).
  const resp = await importerPorts.registerEnrollment({ data, userId, skipFollowup: true, dedupeByVersion: true })

  // Si la fila trae tier (columna J), asegurar la inscripcion de membresia que
  // marca a la persona como miembro en el sistema. Se intenta SIEMPRE (aunque el
  // curso salga duplicado en un re-run), y es idempotente por dedupeByVersion.
  if (data.membership_version_id) {
    try {
      await importerPorts.registerEnrollment({
        data: membershipInscription(data), userId, skipFollowup: true, dedupeByVersion: true
      })
    } catch (err) {
      // No abortar la fila por esto; el curso ya se proceso. Queda en log.
      console.error('[importer] No se pudo crear la membresia', data.member_type, err.message)
    }
  }

  // Paquete (especializacion): el padre no tiene aula propia. Crear las hijas en
  // cada aula hija, ligadas al padre. parentId sale del create o del duplicado
  // (re-import), asi el backfill de hijas funciona aunque el padre ya exista.
  // El SP devuelve result=1 (creada) o 2 (ya existia, idempotente por findDuplicate);
  // cualquier otro valor o excepcion es un FALLO REAL que antes se tragaba en
  // silencio (por eso aparecian padres sin hijas). Ahora se cuenta y se reporta.
  const parentId = resp?.enrollment_id || resp?.duplicate_info?.enrollment_id
  const childFails = []
  if (parentId && Array.isArray(data.child_editions) && data.child_editions.length) {
    for (const child of data.child_editions) {
      try {
        const cresp = await importerPorts.registerEnrollment({
          data: childInscription(data, child, parentId), userId, skipFollowup: true
        })
        if (cresp?.result !== 1 && cresp?.result !== 2) {
          childFails.push(`aula ${child.edition_id}: ${cresp?.message || 'sin exito'}`)
        }
      } catch (err) {
        childFails.push(`aula ${child.edition_id}: ${err.message}`)
      }
    }
  }
  // Paquete SIN estructura: la edicion es un paquete (diploma/espec/PEE) pero no
  // tiene aulas hijas en edition_structure, asi que no se creo NINGUNA. Antes esto
  // pasaba en silencio (padre creado, cero hijas) => se avisa para que no vuelva a
  // pasar desapercibido: falta cargar edition_structure de esa edicion.
  const noStructure = data.is_package === true &&
    (!Array.isArray(data.child_editions) || data.child_editions.length === 0)
  const childNote = childFails.length
    ? ` ADVERTENCIA: ${childFails.length} de ${data.child_editions.length} aula(s) hija(s) no se crearon (${childFails.join('; ')}).`
    : noStructure
      ? ' ADVERTENCIA: paquete SIN estructura de aulas hijas (edition_structure vacia para esta edicion); no se creo ninguna aula hija.'
      : ''

  if (resp?.result === 1 && resp.enrollment_id) {
    // Si fallaron hijas O el paquete no tiene estructura, la fila se marca como
    // error visible (no como exito limpio): el paquete quedo incompleto.
    return (childFails.length || noStructure)
      ? { ok: false, id: resp.enrollment_id, message: `Inscripcion creada pero incompleta.${childNote}` }
      : { ok: true, id: resp.enrollment_id, message: 'Inscripcion creada' }
  }
  if (resp?.result === 2) {
    // Ya existia (re-import): completar/actualizar el asesor sobre la existente,
    // que en la primera carga pudo haber quedado vacio.
    const dupId = resp?.duplicate_info?.enrollment_id
    if (dupId && (data.seller_agent_id || data.agent_origin)) {
      try {
        await importerPorts.updateEnrollmentAgent({
          enrollmentId: dupId, sellerAgentId: data.seller_agent_id ?? null, agentOrigin: data.agent_origin ?? null
        })
      } catch (err) {
        console.error('[importer] No se pudo actualizar el asesor de la inscripcion', dupId, err.message)
      }
    }
    return { ok: false, duplicate: true, message: `${resp.message || 'Inscripcion duplicada'}${childNote}` }
  }
  return { ok: false, message: `${resp?.message || 'El registro no devolvio exito'}${childNote}` }
}

// Inscripcion de la MEMBRESIA (WE BLACK/GOLD/...) a partir de la fila de curso ya
// resuelta. Reusa identidad + modalidad/moneda/perfil. Sin edicion, precio 0 (via
// is_membership_benefit = pago cero, opcion A: migracion sin pago). is_membership
// del programa la marca como miembro; el dedup evita duplicarla en re-runs.
function membershipInscription (data) {
  return {
    document_number: data.document_number,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    phone: data.phone,
    program_version_id: data.membership_version_id,
    program_edition_id: null,
    cat_insc_modality: data.cat_insc_modality,
    cat_currency: data.cat_currency,
    cat_payment_way: data.cat_payment_way,
    list_price: 0,
    total_amount: 0,
    is_membership_benefit: true,
    client_profile: data.client_profile,
    seller_agent_id: data.seller_agent_id ?? null,
    agent_origin: data.agent_origin ?? null,
    observations: `Migracion masiva FICO - membresia ${data.member_type} (sin pago)`
  }
}

// Inscripcion HIJA de paquete: misma identidad/perfil que el padre, pero en el
// aula hija (program_version/edition del hijo), ligada al padre y SIN pago (la
// venta vive en el padre; el SP la trata como pago cero por tener padre).
function childInscription (data, child, parentEnrollmentId) {
  return {
    document_number: data.document_number,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    phone: data.phone,
    program_version_id: child.version_id,
    program_edition_id: child.edition_id,
    parent_enrollment_id: parentEnrollmentId,
    cat_insc_modality: data.cat_insc_modality,
    cat_currency: data.cat_currency,
    cat_payment_way: data.cat_payment_way,
    list_price: 0,
    total_amount: 0,
    client_profile: data.client_profile,
    seller_agent_id: data.seller_agent_id ?? null,
    agent_origin: data.agent_origin ?? null,
    observations: 'Importacion masiva FICO - hijo de paquete'
  }
}

// Contexto compartido (catalogos + programas), cargado una vez por archivo.
async function loadContext () {
  const [catalog, versionsPage, editions, memberships, agents, structure, bankAccounts, currencies] = await Promise.all([
    importerPorts.getCatalog(),
    // SIN filtro active: una convalidacion (ED E0) acredita un curso viejo/cerrado,
    // cuya version puede estar inactiva (ej PC-DZ-04 reemplazado por PC-DZ-05). Solo
    // alimenta versionIdByCode (convalidaciones); las filas normales usan ediciones
    // activas, asi que incluir inactivas aqui no las afecta.
    importerPorts.listProgramVersions({ size: 1000 }),
    importerPorts.listActiveEditions(),
    importerPorts.listMembershipVersions(),
    importerPorts.listAgents(),
    importerPorts.listEditionStructure(),
    importerPorts.listBankAccounts(),
    importerPorts.listCurrencies()
  ])
  return {
    catalog,
    programVersions: versionsPage?.items ?? [],
    editionsByCode: indexEditions(editions),
    // tier normalizado (WE BLACK/GOLD/...) -> { version_id, program_id } de la membresia.
    membershipByName: indexMemberships(memberships),
    // alias normalizado (codigo agente) -> user_id.
    agentsByAlias: indexAgents(agents),
    // edicion-padre -> [aulas hijas]; presencia = es padre (paquete).
    childEditionsByParent: indexStructure(structure),
    // cuentas bancarias (para resolver ENTIDAD FINANCIERA -> bank_account_id).
    bankAccounts: bankAccounts || [],
    // alias de moneda -> catalog_id (we_currency esta inactivo, no llega en catalog).
    currencyByAlias: indexCurrencies(currencies)
  }
}

// Indexa las monedas por alias (we_currency_soles/_dollars) -> catalog_id.
function indexCurrencies (currencies = []) {
  const map = new Map()
  for (const c of currencies) {
    if (c.alias) map.set(c.alias, Number(c.catalog_id))
  }
  return map
}

// Indexa edition_structure: parent_edition_id -> [{ edition_id, version_id }].
function indexStructure (rows = []) {
  const map = new Map()
  for (const r of rows) {
    const pid = Number(r.parent_edition_id)
    if (!map.has(pid)) map.set(pid, [])
    map.get(pid).push({ edition_id: Number(r.child_edition_id), version_id: Number(r.child_version_id) })
  }
  return map
}

// Indexa los programas-membresia por abreviatura normalizada (= valor columna J).
function indexMemberships (memberships = []) {
  const map = new Map()
  for (const m of memberships) {
    const key = normText(m.abbreviation)
    if (key) map.set(key, { version_id: Number(m.program_version_id), program_id: Number(m.program_id) })
  }
  return map
}

// Indexa asesores por alias normalizado (= valor columna AS) -> user_id.
function indexAgents (agents = []) {
  const map = new Map()
  for (const a of agents) {
    const key = normText(a.alias)
    if (key) map.set(key, Number(a.user_id))
  }
  return map
}

export const enrollmentFicoImporter = {
  key: 'enrollment_fico',
  label: 'Hoja FICO (Google Sheet)',
  description: 'Importa la pestaña "INS - N" de las hojas FICO (MBA/PEE/ESP/CURSOS) por URL o archivo.',
  templateFilename: 'hoja-fico.xlsx',
  acceptsUrl: true,
  columns,
  ingest,
  loadContext,
  resolveRow,
  commitRow
}
