// scripts/promote_staging.js
// Promueve staging_inscripciones_2026 + staging_cuotas_2026 a tablas reales:
//   persons, customers, users (asesores), enrollments, payment_installments, payments.
//
// Uso:
//   node scripts/promote_staging.js <spreadsheet_id>                 <- DRY RUN (default)
//   node scripts/promote_staging.js <spreadsheet_id> --execute       <- aplica cambios
//
// Dry run: imprime lo que haria sin escribir nada. Execute: transaccion atomica.

import 'dotenv/config'
import { pool } from '../src/config/db.js'

const DEFAULT_USER_REG = 9

const CAT = {
  type_status: { ACT: 3100, R: 3245, RP: 3240, CC: 3242 },
  // PP = al contado (paga todo al inscribirse) -> checked / aprobado
  // PT = cuotas (sigue pagando) -> pending
  fico_status: { PP: 3052, PT: 3051, BECA: 3051 },
  profile:     { NEW: 3086, CWE: 3086, REGULAR: 3086, LDS: 3200 },
  currency:    { PEN: 3041, USD: 3042 },
  channel:     { WEB: 4303, B2B: 3250, null: 4301 },
  modality:    { normal: 2626, flexible: 2625 },
  payment_way: { single: 2466, installments: 2467 },
  doc_type_dni: 2300,
  certificate_default:   2570,   // we_certificate_status_not_requested
  installment_pending:   2470,   // we_payment_status_pending
  installment_paid:      4454,   // we_inst_paid
  payment_type_initial:     3113,
  payment_type_installment: 3114,
  settlement_settled:    2572    // pagos historicos ya liquidados
}

const args = process.argv.slice(2)
const SPREADSHEET_ID = args[0]
const EXECUTE = args.includes('--execute')

if (!SPREADSHEET_ID) {
  console.error('Uso: node scripts/promote_staging.js <spreadsheet_id> [--execute]')
  process.exit(2)
}

// ---------- normalizadores ----------
function parseMoney (raw) {
  if (!raw) return null
  const t = String(raw).replace(/S\/\.?/gi, '').replace(/\$/g, '').replace(/,/g, '').trim()
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : null
}

function parsePercent (raw) {
  if (!raw) return null
  const t = String(raw).replace(/%/g, '').trim()
  const n = parseFloat(t)
  if (!Number.isFinite(n)) return null
  return n > 1 ? n / 100 : n
}

// Parsea fechas "d/m/yyyy" o "dd/mm/yyyy" o "d/m" (infiere año desde fallbackIso).
function parseDate (raw, fallbackIso = null) {
  if (!raw) return null
  const s = String(raw).trim()
  const parts = s.split('/')
  if (parts.length < 2) return null
  const d = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  let y = parts.length >= 3 ? parseInt(parts[2], 10) : null
  if (!y && fallbackIso) {
    const fb = new Date(fallbackIso)
    y = fb.getFullYear()
  }
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) return null
  if (y < 100) y += 2000
  const iso = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  return iso
}

function splitName (full) {
  if (!full) return { first: 'Sin Nombre', last: 'Sin Apellido', mother: null }
  const t = full.trim().replace(/\s+/g, ' ')
  const parts = t.split(' ')
  if (parts.length <= 1) return { first: t, last: 'Sin Apellido', mother: null }
  if (parts.length === 2) return { first: parts[1], last: parts[0], mother: null }
  if (parts.length === 3) return { first: parts[2], last: parts[0], mother: parts[1] }
  const first = parts.slice(2).join(' ')
  return { first, last: parts[0], mother: parts[1] }
}

function mapStatus (estado_alumno) {
  return CAT.type_status[estado_alumno] ?? CAT.type_status.ACT
}
function mapFico (estado) {
  return CAT.fico_status[estado] ?? CAT.fico_status.PP
}
function mapProfile (tip_cliente) {
  return CAT.profile[tip_cliente] ?? CAT.profile.NEW
}
function mapCurrency (tipo_moneda) {
  return CAT.currency[(tipo_moneda || 'PEN').toUpperCase()] ?? CAT.currency.PEN
}
function mapChannel (canal_inferido) {
  if (!canal_inferido) return CAT.channel[null]
  return CAT.channel[canal_inferido.toUpperCase()] ?? CAT.channel[null]
}

// ---------- main ----------
async function main () {
  const mode = EXECUTE ? 'EXECUTE' : 'DRY RUN'
  console.log(`\n=== PROMOCION STAGING → BD (${mode}) ===`)
  console.log(`Spreadsheet: ${SPREADSHEET_ID}\n`)

  const client = await pool.connect()
  const stats = {
    persons_existentes: 0, persons_a_crear: 0,
    customers_existentes: 0, customers_a_crear: 0,
    users_a_crear: new Set(),
    enrollments_a_crear: 0,
    installments_a_crear: 0,
    payments_a_crear: 0,
    warnings: [],
    by_status: {}
  }

  try {
    if (EXECUTE) await client.query('BEGIN')

    const { rows: ins } = await client.query(
      'SELECT * FROM staging_inscripciones_2026 WHERE source_spreadsheet_id = $1 ORDER BY source_row_num',
      [SPREADSHEET_ID]
    )
    const { rows: allCuotas } = await client.query(
      'SELECT * FROM staging_cuotas_2026 WHERE source_spreadsheet_id = $1 ORDER BY source_row_num, cuota_num',
      [SPREADSHEET_ID]
    )

    const cuotasByCorr = new Map()
    for (const c of allCuotas) {
      const key = c.correlativo
      if (!cuotasByCorr.has(key)) cuotasByCorr.set(key, [])
      cuotasByCorr.get(key).push(c)
    }

    console.log(`Leidos: ${ins.length} inscripciones, ${allCuotas.length} registros de cuotas\n`)

    // Pre-cargar lookups en memoria (evita N+1 queries).
    const dnis = [...new Set(ins.map(r => r.dni).filter(Boolean))]
    const cods = [...new Set(ins.map(r => r.cod).filter(Boolean))]
    const eds  = [...new Set(ins.map(r => r.ed).filter(Boolean))]
    const aliases = [...new Set(ins.map(r => r.asesor_alias_clean).filter(Boolean))]

    const personMap = new Map()
    if (dnis.length) {
      const { rows } = await client.query(
        'SELECT person_id, document_number FROM persons WHERE document_number = ANY($1)', [dnis])
      rows.forEach(p => personMap.set(p.document_number, p.person_id))
    }

    const customerMap = new Map()
    if (personMap.size) {
      const { rows } = await client.query(
        'SELECT customer_id, person_id FROM customers WHERE person_id = ANY($1)',
        [[...personMap.values()]])
      rows.forEach(c => customerMap.set(c.person_id, c.customer_id))
    }

    const pvMap = new Map()
    if (cods.length) {
      const { rows } = await client.query(
        'SELECT program_version_id, version_code FROM program_versions WHERE version_code = ANY($1)', [cods])
      rows.forEach(p => pvMap.set(p.version_code, p.program_version_id))
    }

    const edMap = new Map()  // key: `${pvid}|${ed}` -> edition_num_id
    if (pvMap.size) {
      const { rows } = await client.query(`
        SELECT edition_num_id, program_version_id, code_version, global_code, specific_code
        FROM program_editions WHERE program_version_id = ANY($1)`,
        [[...pvMap.values()]])
      rows.forEach(pe => {
        for (const k of [pe.code_version, pe.global_code, pe.specific_code]) {
          if (k) edMap.set(`${pe.program_version_id}|${k}`, pe.edition_num_id)
        }
      })
    }

    const userCache = new Map()
    if (aliases.length) {
      const { rows } = await client.query(
        'SELECT user_id, alias FROM users WHERE alias = ANY($1)', [aliases])
      rows.forEach(u => userCache.set(u.alias, u.user_id))
      for (const a of aliases) if (!userCache.has(a)) userCache.set(a, null)
    }

    // Usuarios a crear
    for (const [alias, uid] of userCache) {
      if (uid === null) stats.users_a_crear.add(alias)
    }

    if (EXECUTE) {
      for (const alias of stats.users_a_crear) {
        const { rows: np } = await client.query(
          `INSERT INTO persons (first_name, last_name, active, user_registration_id, registration_date)
           VALUES ($1, '(auto-import)', 'Y', $2, NOW()) RETURNING person_id`,
          [alias, DEFAULT_USER_REG]
        )
        const email = `${alias}@we-educacion.com`
        const { rows: newU } = await client.query(
          `INSERT INTO users (person_id, alias, email, name, active)
           VALUES ($1, $2, $3, $4, 'N') RETURNING user_id`,
          [np[0].person_id, alias, email, `${alias} (auto-import)`]
        )
        userCache.set(alias, newU[0].user_id)
      }
    }

    for (const r of ins) {
      // status tracking
      stats.by_status[r.estado_alumno || 'NULL'] = (stats.by_status[r.estado_alumno || 'NULL'] || 0) + 1

      if (!r.dni) { stats.warnings.push(`row ${r.source_row_num}: sin DNI`); continue }

      // person (lookup en memoria)
      let personId = personMap.get(r.dni)
      if (personId) {
        stats.persons_existentes++
      } else {
        stats.persons_a_crear++
        if (EXECUTE) {
          const { first, last, mother } = splitName(r.nombres_apellidos)
          const { rows: np } = await client.query(
            `INSERT INTO persons (first_name, last_name, mother_last_name, document_number, cat_type_document, active, user_registration_id, registration_date)
             VALUES ($1, $2, $3, $4, $5, 'Y', $6, NOW()) RETURNING person_id`,
            [first, last, mother, r.dni, CAT.doc_type_dni, DEFAULT_USER_REG]
          )
          personId = np[0].person_id
          personMap.set(r.dni, personId)
        }
      }

      // customer (lookup en memoria)
      let customerId = personId ? customerMap.get(personId) : null
      if (customerId) {
        stats.customers_existentes++
      } else if (personId) {
        stats.customers_a_crear++
        if (EXECUTE) {
          const { rows: nc } = await client.query(
            `INSERT INTO customers (person_id, active, user_registration_id, registration_date)
             VALUES ($1, 'Y', $2, NOW()) RETURNING customer_id`,
            [personId, DEFAULT_USER_REG]
          )
          customerId = nc[0].customer_id
          customerMap.set(personId, customerId)
        }
      }

      // program_version (lookup en memoria)
      const programVersionId = pvMap.get(r.cod)
      if (!programVersionId) { stats.warnings.push(`row ${r.source_row_num}: COD ${r.cod} sin program_version`); continue }

      // edition (NULL para E0, lookup en memoria)
      let editionId = null
      if (r.ed && r.ed !== 'E0') {
        editionId = edMap.get(`${programVersionId}|${r.ed}`) ?? null
      }

      const isE0 = !r.ed || r.ed === 'E0'
      const modality = isE0 ? CAT.modality.flexible : CAT.modality.normal
      const sellerId = r.asesor_alias_clean ? userCache.get(r.asesor_alias_clean) : null

      // montos y descuento
      const inicial = parseMoney(r.inicial) || 0
      const ingreso = parseMoney(r.ingreso) || 0
      const saldo   = parseMoney(r.saldo) || 0
      const dscto   = parsePercent(r.dsct) || 0
      const total_amount = inicial + ingreso + saldo
      const list_price   = total_amount / Math.max(1 - dscto, 0.01)

      // plan de pago: PP = al contado (single), PT = cuotas (installments).
      // Fallback si estado no es ninguno: heuristica por # de cuotas.
      const cuotaCount = ['c1','c2','c3','c4','c5','c6'].filter(k => parseMoney(r[k]) > 0).length
      let paymentWay = CAT.payment_way.single
      if (r.estado === 'PT') paymentWay = CAT.payment_way.installments
      else if (r.estado === 'PP') paymentWay = CAT.payment_way.single
      else paymentWay = cuotaCount >= 2 ? CAT.payment_way.installments : CAT.payment_way.single

      const notesParts = []
      if (isE0) notesParts.push('E0 - convalidacion pendiente asignar edicion')
      if (r.obs) notesParts.push(`Obs: ${r.obs}`)
      if (r.f_retiro) notesParts.push(`Retiro: ${r.f_retiro}`)
      if (r.estado === 'BECA') notesParts.push('BECA')
      if (r.tip_member) notesParts.push(`Member: ${r.tip_member}`)
      const notes = notesParts.join(' | ') || null

      let enrollmentId = null
      stats.enrollments_a_crear++

      if (EXECUTE) {
        const { rows: ne } = await client.query(
          `INSERT INTO enrollments (
            customer_id, program_version_id, program_edition_id,
            total_amount, discount_amount, list_price,
            cat_currency, cat_inscription_modality, cat_payment_channel, cat_payment_plan,
            cat_fico_status, cat_type_status, cat_certificate_status, cat_profile_id,
            seller_agent_id, active, user_registration_id, registration_date,
            notes, flag_send
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), $18, 'N'
          ) RETURNING enrollment_id`,
          [
            customerId, programVersionId, editionId,
            total_amount, total_amount * dscto, list_price,
            mapCurrency(r.tipo_moneda), modality, mapChannel(r.canal_inferido), paymentWay,
            mapFico(r.estado), mapStatus(r.estado_alumno), CAT.certificate_default, mapProfile(r.tip_cliente),
            sellerId, r.estado_alumno === 'R' ? 'N' : 'Y', DEFAULT_USER_REG,
            notes
          ]
        )
        enrollmentId = ne[0].enrollment_id
      }

      const cuotasForRow = cuotasByCorr.get(r.correlativo) || []
      const fallbackDate = parseDate(r.f_inicio) || parseDate(r.f_pago) || '2026-01-01'
      const installmentMap = new Map()

      // INICIAL: si aparece monto, el area asume que se cobro (regla del usuario).
      // Este criterio es distinto del de cuotas (que SI exige evidencia medio/N° op).
      const inicialPagado = inicial > 0
      if (inicial > 0) {
        stats.installments_a_crear++
        const status = inicialPagado ? CAT.installment_paid : CAT.installment_pending
        if (EXECUTE) {
          const { rows: ri } = await client.query(
            `INSERT INTO payment_installments (enrollment_id, installment_number, amount, due_date, cat_status)
             VALUES ($1, 0, $2, $3, $4) RETURNING installment_id`,
            [enrollmentId, inicial, parseDate(r.f_pago) || fallbackDate, status]
          )
          installmentMap.set(0, ri[0].installment_id)

          if (inicialPagado) {
            stats.payments_a_crear++
            await client.query(
              `INSERT INTO payments (enrollment_id, installment_id, amount, payment_date,
                 transaction_code, cat_method_payment, cat_payment_type, cat_settlement_status,
                 active, user_registration_id, registration_date)
               VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'Y', $8, NOW())`,
              [enrollmentId, ri[0].installment_id, inicial,
               parseDate(r.f_pago) || fallbackDate,
               r.n_operacion || null,
               CAT.payment_type_initial, CAT.settlement_settled, DEFAULT_USER_REG]
            )
          }
        } else if (inicialPagado) {
          stats.payments_a_crear++
        }
      }

      // Cuotas 1-6: schedule desde staging_cuotas (block 2) con fallback a INS-N FC/C.
      const cuotasByNum = new Map()
      for (const c of cuotasForRow) cuotasByNum.set(c.cuota_num, c)

      for (let k = 1; k <= 6; k++) {
        const cuotaRow = cuotasByNum.get(k)
        const schedMonto = parseMoney(cuotaRow?.scheduled_monto) || parseMoney(r[`c${k}`])
        const schedFecha = parseDate(cuotaRow?.scheduled_fecha, r.f_inicio) || parseDate(r[`fc${k}`], r.f_inicio)

        if (!schedMonto || schedMonto <= 0) continue

        const isPaid = cuotaRow && (cuotaRow.medio_pago || cuotaRow.n_operacion)
        const paidMonto = parseMoney(cuotaRow?.monto)

        stats.installments_a_crear++
        const instStatus = isPaid ? CAT.installment_paid : CAT.installment_pending

        if (EXECUTE) {
          const { rows: ri } = await client.query(
            `INSERT INTO payment_installments (enrollment_id, installment_number, amount, due_date, cat_status)
             VALUES ($1, $2, $3, $4, $5) RETURNING installment_id`,
            [enrollmentId, k, schedMonto, schedFecha || fallbackDate, instStatus]
          )
          installmentMap.set(k, ri[0].installment_id)

          if (isPaid && paidMonto > 0) {
            stats.payments_a_crear++
            await client.query(
              `INSERT INTO payments (enrollment_id, installment_id, amount, payment_date,
                 transaction_code, cat_method_payment, cat_payment_type, cat_settlement_status,
                 active, user_registration_id, registration_date)
               VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'Y', $8, NOW())`,
              [enrollmentId, ri[0].installment_id, paidMonto,
               parseDate(cuotaRow.fecha_cuota, r.f_inicio) || schedFecha || fallbackDate,
               cuotaRow.n_operacion || null,
               CAT.payment_type_installment, CAT.settlement_settled, DEFAULT_USER_REG]
            )
          }
        } else if (isPaid && paidMonto > 0) {
          stats.payments_a_crear++
        }
      }
    }

    if (EXECUTE) await client.query('COMMIT')

    // ---------- reporte ----------
    console.log('\n=== RESULTADO ===')
    console.log(`Persons:   ${stats.persons_existentes} existentes, ${stats.persons_a_crear} a crear`)
    console.log(`Customers: ${stats.customers_existentes} existentes, ${stats.customers_a_crear} a crear`)
    console.log(`Users (asesores) a crear: ${stats.users_a_crear.size} → [${[...stats.users_a_crear].join(', ')}]`)
    console.log(`Enrollments:             ${stats.enrollments_a_crear}`)
    console.log(`Payment_installments:    ${stats.installments_a_crear}`)
    console.log(`Payments:                ${stats.payments_a_crear}`)
    console.log('\nDistribucion por estado_alumno:')
    for (const [k, v] of Object.entries(stats.by_status)) console.log(`  ${k}: ${v}`)
    if (stats.warnings.length) {
      console.log(`\nWarnings (${stats.warnings.length}):`)
      stats.warnings.slice(0, 20).forEach(w => console.log('  ' + w))
      if (stats.warnings.length > 20) console.log(`  ... y ${stats.warnings.length - 20} mas`)
    }
    console.log(`\n${EXECUTE ? 'COMMIT OK — cambios aplicados' : 'DRY RUN — sin cambios'}`)
  } catch (err) {
    if (EXECUTE) await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  await pool.end()
}

main().catch(err => {
  console.error('\nERROR:', err.message)
  if (err.stack) console.error(err.stack.split('\n').slice(1, 6).join('\n'))
  process.exit(1)
})
