// scripts/import_sheet_single.js
// Importa UN spreadsheet a staging_inscripciones_2026 + staging_cuotas_2026.
// Uso: node scripts/import_sheet_single.js <spreadsheet_id> <product_type>
// Ej:  node scripts/import_sheet_single.js 1p5KK0Ax8nCsT44gXNVMkw-hRU4VUlFWGFYlUGDd9g44 DIPLO
//
// Reglas:
//   - Solo filas con columna A (correlativo) no-vacia se insertan (filtro "2026-relevante" del sheet).
//   - Borra imports previos del mismo source_spreadsheet_id antes de reinsertar (idempotente).
//   - Pestana "1. INS - N"        -> staging_inscripciones_2026
//   - Pestana "2. Cuota INS - N" -> staging_cuotas_2026 (UNPIVOT 6 cuotas x fila).
//   - Cuota cargada solo si tiene fecha o monto — omite las vacias.

import 'dotenv/config'
import { google } from 'googleapis'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from '../src/config/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEY_FILE = path.resolve(__dirname, '../credentials/service.json')

const VALID_PRODUCT_TYPES = ['DIPLO', 'PEE', 'ESP', 'CURSO']
const TAB_INSCRIPCIONES = '1. INS - N'
const TAB_CUOTAS        = '2. Cuota INS - N'

// Mapeo columna-a-campo para INS-N. El orden importa: matchea las 65 columnas por indice.
const INS_COLUMN_MAP = [
  'correlativo', 'cod', 'dni', 'nombres_apellidos', 'celular', 'correo', 'ocup',
  'tip_cliente', 'tip_member', 'estado_alumno', 'modalidad', 'tipo_alumno', 'obs', 'f_retiro', 'ed',
  'curso_1', 'fi_1', 'curso_2', 'fi_2', 'curso_3', 'fi_3', 'curso_4', 'fi_4', 'curso_5', 'fi_5',
  'f_inicio', 'f_pago', 'asesor', 'estado', 'dsct', 'al_dia', 'inicial',
  'fc1', 'c1', 'fc2', 'c2', 'fc3', 'c3', 'fc4', 'c4', 'fc5', 'c5', 'fc6', 'c6',
  'saldo', 'ingreso', 'tipo_moneda', 'medio_pago', 'entidad_empresa', 'entidad_financiera', 'n_operacion',
  'envio', 'f_registro', 'canal', 'medio', 'palabra', 'estrategia', 'tipo_correo',
  'certificado', 'estado_member', 'nota_1', 'nota_2', 'nota_3', 'nota_4', 'nota_5'
]

// Columnas fijas al inicio de la pestana de cuotas (cols 1-11).
const CUOTAS_HEADER_COLS = {
  nro: 0, cod: 1, ed: 2, f_inicio: 3, nombres: 4, celular: 5, correo: 6,
  ocup: 7, asesor: 8, estado: 9, moneda: 10
}
// Bloque 1 (pagos reales con detalle bancario) — col 12..47 (0-indexed 11..46).
const PAID_BLOCK_START = 11
const PAID_BLOCK_SIZE  = 6
const CUOTAS_PER_ROW   = 6
// Bloque 2 (schedule reprogramado) — col 48..59 (0-indexed 47..58).
// Cada cuota: 2 cols [fecha, monto].
const SCHED_BLOCK_START = 47
const SCHED_BLOCK_SIZE  = 2

function s (v) {
  if (v === undefined || v === null) return null
  const str = String(v).trim()
  return str === '' ? null : str
}

// Parsea el codigo AS del sheet en { alias, canal }.
//   'CG37'       -> { alias: 'CG37', canal: null }
//   'CG37-B2B'   -> { alias: 'CG37', canal: 'B2B' }
//   'WEB-CG37'   -> { alias: 'CG37', canal: 'WEB' }
//   'B2B'        -> { alias: null,   canal: 'B2B' }
//   'WEB'        -> { alias: null,   canal: 'WEB' }
//   'S/A' | '-'  -> { alias: null,   canal: null }
function parseAsesor (raw) {
  if (!raw) return { alias: null, canal: null }
  const t = raw.trim().toUpperCase()
  if (t === 'S/A' || t === '-' || t === '') return { alias: null, canal: null }
  if (t === 'B2B' || t === 'WEB') return { alias: null, canal: t }
  const parts = t.split('-').map(p => p.trim()).filter(Boolean)
  const channels = new Set(['B2B', 'WEB'])
  const aliasPart = parts.find(p => !channels.has(p)) || null
  const canalPart = parts.find(p => channels.has(p)) || null
  return { alias: aliasPart, canal: canalPart }
}

async function getSheetsClient () {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  })
  const client = await auth.getClient()
  return google.sheets({ version: 'v4', auth: client })
}

async function readTab (sheets, spreadsheetId, tab) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!A1:ZZ`
  })
  return res.data.values || []
}

async function importInscripciones (client, sheets, spreadsheetId, productType) {
  const rows = await readTab(sheets, spreadsheetId, TAB_INSCRIPCIONES)
  if (rows.length < 2) {
    console.log(`  ${TAB_INSCRIPCIONES}: sin datos (${rows.length} filas)`)
    return { inserted: 0, skipped: 0 }
  }

  const dataRows = rows.slice(1)
  let inserted = 0
  let skipped  = 0

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    const correlativo = s(row[0])
    if (!correlativo) { skipped++; continue }

    const values = INS_COLUMN_MAP.map((_, idx) => s(row[idx]))
    const asesorIdx = INS_COLUMN_MAP.indexOf('asesor')
    const { alias, canal } = parseAsesor(values[asesorIdx])

    const allCols = [...INS_COLUMN_MAP, 'asesor_alias_clean', 'canal_inferido']
    const allValues = [...values, alias, canal]
    const placeholders = allCols.map((_, idx) => `$${idx + 4}`).join(', ')
    const colNames = allCols.join(', ')

    await client.query(
      `INSERT INTO public.staging_inscripciones_2026
         (source_spreadsheet_id, product_type, source_row_num, ${colNames})
       VALUES ($1, $2, $3, ${placeholders})`,
      [spreadsheetId, productType, i + 2, ...allValues]
    )
    inserted++
  }

  return { inserted, skipped }
}

async function importCuotas (client, sheets, spreadsheetId) {
  const rows = await readTab(sheets, spreadsheetId, TAB_CUOTAS)
  if (rows.length < 3) {
    console.log(`  ${TAB_CUOTAS}: sin datos (${rows.length} filas, esperaba >= 3 por doble header)`)
    return { rows: 0, cuotas: 0 }
  }

  // Fila 1 = mega-header (CUOTA 1, CUOTA 2...), Fila 2 = sub-header (FC1, C1, ...). Datos desde fila 3.
  const dataRows = rows.slice(2)
  let rowsProcessed = 0
  let cuotasInserted = 0

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    const nro = s(row[CUOTAS_HEADER_COLS.nro])
    if (!nro) continue

    const cod = s(row[CUOTAS_HEADER_COLS.cod])
    const ed  = s(row[CUOTAS_HEADER_COLS.ed])
    const sourceRow = i + 3

    for (let k = 0; k < CUOTAS_PER_ROW; k++) {
      // Bloque 1 — pagos reales
      const baseP = PAID_BLOCK_START + (k * PAID_BLOCK_SIZE)
      const paidFecha     = s(row[baseP + 0])
      const paidMonto     = s(row[baseP + 1])
      const medioPago     = s(row[baseP + 2])
      const entEmpresa    = s(row[baseP + 3])
      const entFinanciera = s(row[baseP + 4])
      const nOperacion    = s(row[baseP + 5])

      // Bloque 2 — schedule reprogramado
      const baseS = SCHED_BLOCK_START + (k * SCHED_BLOCK_SIZE)
      const schedFecha = s(row[baseS + 0])
      const schedMonto = s(row[baseS + 1])

      const anyData = paidFecha || paidMonto || medioPago || nOperacion || schedFecha || schedMonto
      if (!anyData) continue

      await client.query(
        `INSERT INTO public.staging_cuotas_2026
           (source_spreadsheet_id, source_row_num, correlativo, cod, ed, cuota_num,
            fecha_cuota, monto, medio_pago, entidad_empresa, entidad_financiera, n_operacion,
            scheduled_fecha, scheduled_monto)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [spreadsheetId, sourceRow, nro, cod, ed, k + 1,
         paidFecha, paidMonto, medioPago, entEmpresa, entFinanciera, nOperacion,
         schedFecha, schedMonto]
      )
      cuotasInserted++
    }
    rowsProcessed++
  }

  return { rows: rowsProcessed, cuotas: cuotasInserted }
}

async function main () {
  const [, , spreadsheetId, productType] = process.argv
  if (!spreadsheetId || !productType) {
    console.error('Uso: node scripts/import_sheet_single.js <spreadsheet_id> <product_type>')
    console.error(`Product types validos: ${VALID_PRODUCT_TYPES.join(', ')}`)
    process.exit(2)
  }
  if (!VALID_PRODUCT_TYPES.includes(productType)) {
    console.error(`product_type invalido: ${productType}. Validos: ${VALID_PRODUCT_TYPES.join(', ')}`)
    process.exit(2)
  }

  console.log(`Importando ${spreadsheetId} (${productType})`)
  const sheets = await getSheetsClient()

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const delIns = await client.query(
      'DELETE FROM public.staging_inscripciones_2026 WHERE source_spreadsheet_id = $1',
      [spreadsheetId]
    )
    const delCuotas = await client.query(
      'DELETE FROM public.staging_cuotas_2026 WHERE source_spreadsheet_id = $1',
      [spreadsheetId]
    )
    console.log(`  Borrados previos — inscripciones: ${delIns.rowCount}, cuotas: ${delCuotas.rowCount}`)

    const insResult = await importInscripciones(client, sheets, spreadsheetId, productType)
    console.log(`  ${TAB_INSCRIPCIONES}: ${insResult.inserted} insertadas, ${insResult.skipped} skipeadas (col A vacia)`)

    const cuotasResult = await importCuotas(client, sheets, spreadsheetId)
    console.log(`  ${TAB_CUOTAS}: ${cuotasResult.rows} filas procesadas, ${cuotasResult.cuotas} cuotas insertadas`)

    await client.query('COMMIT')
    console.log('\nCOMMIT OK')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  await pool.end()
}

main().catch(err => {
  console.error('\nERROR:', err.message)
  if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'))
  process.exit(1)
})
