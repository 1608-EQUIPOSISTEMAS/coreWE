import fs from 'fs'
import path from 'path'
import { integrationRepository, IntegrationRepository } from './integration.repository.js'
import { ficoAutosyncRepository } from './fico-autosync.repository.js'
import { AUTOSYNC, observeChanges, decideAutoSync, shouldAlertFailures } from './fico-autosync.entity.js'
import { syncPool } from '../../shared/db/pool.js'
import { slack } from '../../shared/adapters/slack/slack.adapter.js'
import { editionRepository } from '../edition/edition.repository.js'
import {
  serializeSheetRow,
  buildSalesRow,
  buildAdicionalesRow,
  buildConveniosRow,
  CONVENIOS_HEADER_ROW,
  ADICIONALES_HEADER_ROW,
  buildAulaRow,
  buildConsolidadoRow,
  buildCuotasRow,
  buildCuotasHeaderRow,
  buildEventosRow,
  EVENTOS_HEADER_ROW,
  buildCronogramaRow,
  CRONOGRAMA_HEADER_ROW,
  buildMembresiasRow,
  MEMBRESIAS_HEADER_ROW,
  buildSlackEnrollmentBlocks
} from './integration.entity.js'

const repo = integrationRepository
// Las 9 hojas FICO consultan por el pool del sync (3 conexiones, timeout 60 s)
// para no competir con el API por conexiones.
const ficoRepo = new IntegrationRepository(syncPool)
const autosyncRepo = ficoAutosyncRepository

// Sincroniza el ODS de leads de un usuario a su Google Sheet personal.
export async function syncLeadsToSheet ({ user_id }) {
  const user = await repo.getUserSheetConfig(user_id)
  if (!user) {
    return { ok: false, message: 'Usuario no encontrado en la base de datos.' }
  }
  if (!user.sheet_id || !user.sheet_spring) {
    return {
      ok: false,
      message: 'El usuario no tiene un Google Sheet o nombre de hoja configurado.'
    }
  }

  const spreadsheetId = user.sheet_id
  const sheetName = user.sheet_spring

  const rows = await repo.getLeadsReport(user_id)
  if (rows.length === 0) {
    return {
      ok: true,
      message: 'El ODS se generó vacío. No se actualizó el Sheet.',
      rows_generated: 0
    }
  }

  const headers = Object.keys(rows[0])
  const values = rows.map(row => serializeSheetRow(row, headers))

  const updatedCells = await repo.overwriteFromA2(spreadsheetId, sheetName, values)

  return {
    ok: true,
    rows_generated: rows.length,
    sheet_updated_cells: updatedCells
  }
}

// Anexa una inscripcion al final de la hoja "2. Base".
export async function syncInscToSheet ({ enrollment_id }) {
  const spreadsheetId = repo.SPREADSHEET.insc
  const sheetName = '2. Base'

  const rows = await repo.getEnrollmentLead(enrollment_id)
  if (rows.length === 0) {
    return {
      ok: true,
      message: 'El ODS se generó vacío. No se actualizó el Sheet.',
      rows_generated: 0
    }
  }

  const headers = Object.keys(rows[0])
  const values = rows.map(row => serializeSheetRow(row, headers))

  const updatedCells = await repo.appendRows(spreadsheetId, sheetName, values)

  return {
    ok: true,
    rows_generated: rows.length,
    sheet_updated_cells: updatedCells
  }
}

// Sobreescribe la hoja PLANEAMIENTO con el reporte de ediciones de programas.
export async function syncScheduleToSheet () {
  const spreadsheetId = repo.SPREADSHEET.schedule
  const sheetName = 'PLANEAMIENTO'

  const rows = await repo.getScheduleReport()
  const headers = Object.keys(rows[0])
  const values = rows.map(row => serializeSheetRow(row, headers))

  const updatedCells = await repo.overwriteFromA2(spreadsheetId, sheetName, values)

  return {
    ok: true,
    rows_generated: rows.length,
    sheet_updated_cells: updatedCells
  }
}

// Sobreescribe la hoja "3. SYSTEM" con la vista vw_r_prospectos.
export async function syncRprospectos () {
  const spreadsheetId = repo.SPREADSHEET.prospectos
  const sheetName = '3. SYSTEM'

  const rows = await repo.getProspectos()
  if (rows.length === 0) {
    return {
      ok: true,
      message: 'La vista vw_r_prospectos no devolvió datos. No se actualizó el Sheet.',
      rows_generated: 0
    }
  }

  const headers = Object.keys(rows[0])
  const values = rows.map(row => serializeSheetRow(row, headers))

  const updatedCells = await repo.overwriteFromA2(spreadsheetId, sheetName, values)

  return {
    ok: true,
    rows_generated: rows.length,
    sheet_updated_cells: updatedCells
  }
}

// Vuelca el reporte completo de enrollments a SISTEMA-ORIGINAL y las filas
// nuevas (FLAG_SEND = 'N') a SISTEMA-PILOTO, marcandolas como enviadas en BD.
export async function syncEnrollmentToSheet () {
  const spreadsheetId = repo.SPREADSHEET.enrollment

  const rowsAll = await repo.getEnrollmentReportAll()
  if (rowsAll.length > 0) {
    const headers = Object.keys(rowsAll[0])
    const valuesAll = rowsAll.map(row => serializeSheetRow(row, headers))
    await repo.writeEnrollmentOriginal(spreadsheetId, headers, valuesAll)
  }

  const rowsNew = await repo.getEnrollmentReportNew()
  let pilotoResult = { rows_inserted: 0, sheet_updated_cells: 0 }

  if (rowsNew.length > 0) {
    const headers = Object.keys(rowsNew[0])
    const valuesNew = rowsNew.map(row => serializeSheetRow(row, headers))

    const updatedCells = await repo.appendEnrollmentPiloto(spreadsheetId, valuesNew)

    const sentIds = rowsNew.map(r => r['ID'])
    await repo.markEnrollmentsSent(sentIds)

    pilotoResult.sheet_updated_cells = updatedCells
    pilotoResult.rows_inserted = rowsNew.length
  }

  return {
    ok: true,
    original_rows_synced: rowsAll.length,
    piloto_rows_inserted: pilotoResult.rows_inserted,
    piloto_cells_updated: pilotoResult.sheet_updated_cells,
  }
}

// FICO -> hoja "0. Ventas Sistemas". 20 columnas A..T, sobreescritura total.
export async function syncFicoSalesToSheet () {
  const SPREADSHEET_ID = ficoRepo.SPREADSHEET.fico
  const SHEET_NAME = '0. Ventas Sistemas'

  const rows = await ficoRepo.getFicoSales()
  const values = rows.map(buildSalesRow)

  await ficoRepo.replaceRows(SPREADSHEET_ID, SHEET_NAME, 'T', values)

  return { rows_synced: values.length, sheet: SHEET_NAME }
}

// FICO -> hoja "1. Aula Sistemas". Vista academica de 16 columnas A..P.
export async function syncFicoAulaToSheet () {
  const SPREADSHEET_ID = ficoRepo.SPREADSHEET.fico
  const SHEET_NAME = '1. Aula Sistemas'

  const rows = await ficoRepo.getFicoAula()
  const values = rows.map(buildAulaRow)

  await ficoRepo.replaceRows(SPREADSHEET_ID, SHEET_NAME, 'P', values)

  return { rows_synced: values.length, sheet: SHEET_NAME }
}

// FICO -> hoja "2. Consolidado". Vista financiera detallada de 31 columnas A..AE.
export async function syncFicoConsolidadoToSheet () {
  const SPREADSHEET_ID = ficoRepo.SPREADSHEET.fico
  const SHEET_NAME = '2. Consolidado'

  const rows = await ficoRepo.getFicoConsolidado()
  const values = rows.map(buildConsolidadoRow)

  await ficoRepo.replaceRows(SPREADSHEET_ID, SHEET_NAME, 'AE', values)

  return { rows_synced: values.length, sheet: SHEET_NAME }
}

// FICO -> hoja "3. Cuotas". Una fila por inscripcion PP con cuotas pivotadas.
export async function syncFicoCuotasToSheet () {
  const SPREADSHEET_ID = ficoRepo.SPREADSHEET.fico
  const SHEET_NAME = '3. Cuotas'
  const MAX_CUOTAS = 8

  const rows = await ficoRepo.getFicoCuotas()

  // Un solo aviso por corrida con los ids: el sync automatico corre varias veces
  // por hora y una linea por inscripcion llenaba el log.
  let truncatedCuotas = 0
  const truncatedIds = []
  const values = rows.map(r => {
    const { row, truncated } = buildCuotasRow(r, MAX_CUOTAS)
    if (truncated > 0) {
      truncatedCuotas += truncated
      truncatedIds.push(r.enrollment_id)
    }
    return row
  })

  if (truncatedIds.length > 0) {
    console.warn(`[syncFicoCuotasToSheet] ${truncatedIds.length} inscripciones con mas de ${MAX_CUOTAS} cuotas ` +
      `(${truncatedCuotas} cuotas no caben): ${truncatedIds.join(', ')}`)
  }

  const HEADER_ROW = buildCuotasHeaderRow(MAX_CUOTAS)
  const created = await ficoRepo.ensureAndReplaceRows(
    SPREADSHEET_ID, SHEET_NAME, HEADER_ROW, 'BV', values
  )

  return {
    rows_synced: values.length,
    sheet: SHEET_NAME,
    sheet_created: created,
    truncated_cuotas: truncatedCuotas,
    truncated_enrollments: truncatedIds.length
  }
}

// FICO -> hoja "4. Ventas Eventos". Solo las ventas de congresos/eventos
// confirmadas por FICO: 17 columnas A..Q. Crea la hoja con headers si no existe.
// Estas ventas siguen apareciendo tambien en "0. Ventas Sistemas": esta hoja es
// una vista aparte con la modalidad y el asiento, que las otras no llevan.
export async function syncFicoEventosToSheet () {
  const SPREADSHEET_ID = ficoRepo.SPREADSHEET.fico
  const SHEET_NAME = '4. Ventas Eventos'

  const rows = await ficoRepo.getFicoEventos()
  const values = rows.map(buildEventosRow)

  const created = await ficoRepo.ensureAndReplaceRows(
    SPREADSHEET_ID, SHEET_NAME, EVENTOS_HEADER_ROW, 'Q', values
  )

  return { rows_synced: values.length, sheet: SHEET_NAME, sheet_created: created }
}

// FICO -> hoja "CONT SISTEMAS". Cronograma: una fila por edicion (desde jun-2025)
// con sus cursos hijos (CUR1..CUR5 por slot del curriculum) y los contadores por
// canal del cronograma (classroomChannelMetricsList, reglas confirmadas con
// negocio). Data fija, sin formulas. Crea la hoja con headers si no existe.
//
// Orden de filas: espejo EXACTO de '0. Planeamiento 26' (spreadsheet cronograma
// 2026), fila a fila desde la fila 2, para que el usuario copie el bloque de
// contadores y lo pegue directo sin descuadrar. Filas del planeamiento sin
// edicion en el sistema (eventos, separadores en blanco) quedan en blanco;
// ediciones que no estan en el planeamiento van al final.
export async function syncFicoCronogramaToSheet () {
  const SPREADSHEET_ID = ficoRepo.SPREADSHEET.fico
  const SHEET_NAME = 'CONT SISTEMAS'

  const rows = await ficoRepo.getFicoCronograma()
  const ids = rows.map(r => Number(r.edition_num_id))
  const metrics = ids.length ? await editionRepository.classroomChannelMetricsList(ids) : []
  const byId = new Map(metrics.map(m => [Number(m.edition_num_id), m]))

  const entries = rows.map(r => ({
    active: r.active === 'Y',
    recent: r.recent === true,
    cod: String(r.cod || '').trim(),
    ed: String(r.ed || '').trim(),
    row: buildCronogramaRow(r, byId.get(Number(r.edition_num_id)))
  }))
  const values = await alignToPlaneamiento26(entries)

  const created = await ficoRepo.ensureAndReplaceRows(
    SPREADSHEET_ID, SHEET_NAME, CRONOGRAMA_HEADER_ROW, 'Y', values
  )

  return { rows_synced: values.length, sheet: SHEET_NAME, sheet_created: created }
}

// Reordena las filas de CONT SISTEMAS al orden de '0. Planeamiento 26'.
// Clave de match: COD (col D del planeamiento) + ED.HIST (col K). Las ediciones
// inactivas solo sirven de respaldo para filas del plan (el plan sigue
// trabajando ediciones desactivadas); las activas van primero en cada clave.
// Si el plan repite una edicion (aparece en dos meses), ambas filas reciben los
// mismos contadores. Al final se anexan solo las ACTIVAS recientes (desde
// jun-2025) que no estan en el plan. Si el planeamiento no se puede leer, se
// conserva el orden original (solo activas recientes): el sync no debe caerse
// por permisos del otro spreadsheet.
async function alignToPlaneamiento26 (entries) {
  let plan
  try {
    plan = await ficoRepo.readRange(ficoRepo.SPREADSHEET.cronograma26, "'0. Planeamiento 26'!D2:K")
  } catch (err) {
    console.warn('CONT SISTEMAS: no se pudo leer 0. Planeamiento 26, se mantiene orden por fecha:', err.message)
    return entries.filter(e => e.active && e.recent).map(e => e.row)
  }

  const groups = new Map() // key -> { list, next }
  for (const e of entries) {
    const k = `${e.cod}|${e.ed}`
    if (!groups.has(k)) groups.set(k, { list: [], next: 0 })
    groups.get(k).list.push(e)
  }
  // activas y recientes primero dentro de cada clave (sort estable conserva
  // el orden por fecha entre iguales)
  for (const g of groups.values()) {
    g.list.sort((a, b) => (Number(b.active) - Number(a.active)) || (Number(b.recent) - Number(a.recent)))
  }

  const ordered = plan.map(row => {
    const k = `${String(row[0] || '').trim()}|${String(row[7] || '').trim()}` // D=COD, K=ED.HIST
    const g = groups.get(k)
    if (!g || g.list.length === 0) return ['']
    const e = g.list[Math.min(g.next, g.list.length - 1)]
    g.next++
    return e.row
  })
  for (const g of groups.values()) {
    ordered.push(...g.list.slice(g.next).filter(e => e.active && e.recent).map(e => e.row))
  }
  return ordered
}

// FICO -> hoja "6. Adicionales". Pagos de certificado de becados: 19 columnas A..S,
// sobreescritura total desde A2 (igual que las demas hojas). Crea la hoja con
// headers si no existe.
export async function syncFicoAdicionalesToSheet () {
  const SPREADSHEET_ID = ficoRepo.SPREADSHEET.fico
  const SHEET_NAME = '6. Adicionales'

  const rows = await ficoRepo.getFicoAdicionales()
  const values = rows.map(buildAdicionalesRow)

  const created = await ficoRepo.ensureAndReplaceRows(
    SPREADSHEET_ID, SHEET_NAME, ADICIONALES_HEADER_ROW, 'S', values
  )

  return { rows_synced: values.length, sheet: SHEET_NAME, sheet_created: created }
}

// FICO -> hoja "5. Membresias". Una fila por membresia vendida con la fecha en
// que se le retira el beneficio (un anio desde que arranco). 6 columnas A..F.
// Crea la hoja con headers si no existe.
export async function syncFicoMembresiasToSheet () {
  const SPREADSHEET_ID = ficoRepo.SPREADSHEET.fico
  const SHEET_NAME = '5. Membresias'

  const rows = await ficoRepo.getFicoMembresias()
  const values = rows.map(buildMembresiasRow)

  const created = await ficoRepo.ensureAndReplaceRows(
    SPREADSHEET_ID, SHEET_NAME, MEMBRESIAS_HEADER_ROW, 'F', values
  )

  return { rows_synced: values.length, sheet: SHEET_NAME, sheet_created: created }
}

// FICO -> hoja "7. Convenios". Ventas B2B pagadas desde CONVENIOS_FROM_DATE:
// 20 columnas A..T. Crea la hoja con headers si no existe.
export async function syncFicoConveniosToSheet () {
  const SPREADSHEET_ID = ficoRepo.SPREADSHEET.fico
  const SHEET_NAME = '7. Convenios'

  const rows = await ficoRepo.getFicoConvenios()
  const values = rows.map(buildConveniosRow)

  const created = await ficoRepo.ensureAndReplaceRows(
    SPREADSHEET_ID, SHEET_NAME, CONVENIOS_HEADER_ROW, 'T', values
  )

  return { rows_synced: values.length, sheet: SHEET_NAME, sheet_created: created }
}

// Las 9 hojas FICO, de 3 en 3: en paralelo total eran ~25 llamadas a Google en
// rafaga y 9 consultas a la vez contra la BD. Cada hoja se reemplaza entera y de
// forma atomica (ensureAndReplaceRows), asi que si una falla las demas quedan
// bien y la siguiente corrida la corrige.
const FICO_SHEETS = [
  ['ventas', syncFicoSalesToSheet], ['aula', syncFicoAulaToSheet],
  ['consolidado', syncFicoConsolidadoToSheet], ['cuotas', syncFicoCuotasToSheet],
  ['eventos', syncFicoEventosToSheet], ['cronograma', syncFicoCronogramaToSheet],
  ['adicionales', syncFicoAdicionalesToSheet], ['membresias', syncFicoMembresiasToSheet],
  ['convenios', syncFicoConveniosToSheet]
]
const SHEETS_PER_BATCH = 3

export async function syncFicoToSheets () {
  const result = {}
  const errors = []
  for (let i = 0; i < FICO_SHEETS.length; i += SHEETS_PER_BATCH) {
    const batch = FICO_SHEETS.slice(i, i + SHEETS_PER_BATCH)
    const settled = await Promise.allSettled(batch.map(([, sync]) => sync()))
    settled.forEach((r, j) => {
      const name = batch[j][0]
      if (r.status === 'fulfilled') result[name] = r.value.rows_synced
      else errors.push(`${name}: ${r.reason?.message ?? r.reason}`)
    })
  }
  if (errors.length) {
    const err = new Error(errors.join(' | '))
    err.rowsBySheet = result
    throw err
  }
  return result
}

const withTimeout = (promise, ms) => {
  let timer
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Sync cancelado: paso de ${ms / 1000} s`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Una corrida completa, automatica o manual. Devuelve null si ya hay otra en
// curso (el advisory lock lo decide, no un booleano en memoria). El contador se
// lee ANTES de consultar: lo que cambie mientras corre queda por encima y lo
// toma la siguiente corrida.
export async function runFicoSheetsSync ({ trigger, requestedBy = null }) {
  return autosyncRepo.withLock(async () => {
    await autosyncRepo.closeOrphanRuns()
    const watermark = await autosyncRepo.changeVersion()
    const runId = await autosyncRepo.startRun({ trigger, watermark, requestedBy })
    const t0 = Date.now()
    try {
      const rowsBySheet = await withTimeout(syncFicoToSheets(), AUTOSYNC.runTimeoutMs)
      await autosyncRepo.finishRun(runId, { status: 'ok', rowsBySheet })
      console.log(`[fico-sheets] ${trigger} OK en ${Date.now() - t0} ms`)
      return { run_id: runId, status: 'ok', rows_by_sheet: rowsBySheet }
    } catch (err) {
      await autosyncRepo.finishRun(runId, { status: 'failed', rowsBySheet: err.rowsBySheet ?? null, error: err.message })
      console.error(`[fico-sheets] ${trigger} FALLO en ${Date.now() - t0} ms:`, err.message)
      const failures = await autosyncRepo.consecutiveFailures()
      if (shouldAlertFailures(failures)) {
        await slack.notifySheetsSyncFailing({ failures, error: err.message })
      }
      return { run_id: runId, status: 'failed', error: err.message }
    }
  })
}

// Boton manual: arranca en segundo plano y responde al instante.
export async function startFicoSyncInBackground (requestedBy = null) {
  if (await autosyncRepo.isRunning()) return { started: false, already_running: true }
  runFicoSheetsSync({ trigger: 'manual', requestedBy })
    .catch((err) => console.error('[fico-sheets] manual no pudo arrancar:', err.message))
  return { started: true }
}

// Lo que ve FICO en Inscripciones: si esta corriendo, cuando quedo al dia y si
// hay cambios esperando subir.
export async function getFicoSyncStatus () {
  const [{ last, last_ok: lastOk }, version, running] = await Promise.all([
    autosyncRepo.lastRuns(), autosyncRepo.changeVersion(), autosyncRepo.isRunning()
  ])
  return {
    running,
    last_status: last?.status ?? null,
    last_error: last?.status === 'failed' ? last.error : null,
    last_ok_at: lastOk?.finished_at ?? null,
    pending_changes: version > Number(lastOk?.watermark ?? 0)
  }
}

// Una vuelta del vigilante (cron cada minuto). Guarda su memoria en `state`
// entre vueltas; la decision es pura (fico-autosync.entity.js).
export async function ficoAutosyncTick (state, now = Date.now()) {
  const [{ last, last_ok: lastOk }, version] = await Promise.all([
    autosyncRepo.lastRuns(), autosyncRepo.changeVersion()
  ])
  const next = observeChanges(state, { version, syncedVersion: Number(lastOk?.watermark ?? 0), now })
  const decision = decideAutoSync({
    state: next,
    now,
    lastRunAt: last ? new Date(last.started_at).getTime() : null,
    lastOkAt: lastOk ? new Date(lastOk.finished_at).getTime() : null
  })
  if (decision.run) await runFicoSheetsSync({ trigger: decision.trigger })
  return next
}

// Publica un reporte (titulo + texto + adjuntos) en Slack. Resuelve los adjuntos
// a buffers desde buffers dados o rutas locales en disco, descartando los que no
// existan. Nunca lanza al caller: devuelve { ok, error } igual que el legacy.
export async function sendReportToSlack ({ titulo, texto, imagenes = [], imagenesUrls = [] }) {
  try {
    const todasImagenes = [...imagenes, ...imagenesUrls]

    const fileUploads = todasImagenes.map((img) => {
      if (img && img.buffer) {
        return { file: img.buffer, filename: img.filename || 'imagen.jpg' }
      }

      const rawPath = typeof img === 'string' ? img : null
      if (!rawPath) return null

      const localPath = rawPath.startsWith('http')
        ? path.join(process.cwd(), rawPath.replace(/^https?:\/\/[^/]+/, ''))
        : path.join(process.cwd(), rawPath)

      if (fs.existsSync(localPath)) {
        return { file: fs.readFileSync(localPath), filename: path.basename(localPath) }
      }

      console.warn('⚠️ Imagen no encontrada en disco:', localPath)
      return null
    }).filter(f => f !== null)

    await repo.postReportToSlack({ titulo, texto, fileUploads })
    return { ok: true }
  } catch (error) {
    console.error('❌ Error enviando a Slack:', error)
    return { ok: false, error: error.message }
  }
}

// Publica en Slack la notificacion de un nuevo pago web. Side-effect invocado
// tambien por el modulo comercial. Nunca lanza al caller: devuelve { ok, error }.
export async function sendEnrollmentWebToSlack ({ enrollment_id }) {
  try {
    const rows = await repo.getEnrollmentWebForSlack(enrollment_id)
    if (rows.length === 0) {
      return { ok: false, error: `Enrollment ${enrollment_id} no encontrado` }
    }

    const d = rows[0]
    const attachments = d.lead_attachments || []
    const blocks = buildSlackEnrollmentBlocks(d, attachments)

    await repo.postEnrollmentWebToSlack({
      blocks,
      text: `🌐 Nuevo Pago Web — ${d.program_name} — ${d.alumno}`
    })

    return { ok: true, enrollment_id }
  } catch (error) {
    console.error('❌ Error en sendEnrollmentWebToSlack:', error)
    return { ok: false, error: error.message }
  }
}
