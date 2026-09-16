// Dos reprogramaciones se ejecutaron DOS veces (doble submit) y dejaron una
// inscripcion duplicada cada una, con su propia orden de venta en Odoo:
//
//   3585  -> 15997 (buena) / 16001 (copia, + hijos SEG 16002/16003/16004)
//   14884 -> 18922 (buena) / 18923 (copia, sin hijos)
//
// La copia no tiene plata: su cuota es de 0.00 con nota "pagos registrados en
// inscripcion #N" -- la rama `plan.length === 0` de transferInstallmentsForReprogram,
// que en la 2da corrida ya no encontro nada pendiente que trasladar. Los 700 y
// los 315 siguen pagados en el origen. Por eso se puede dar de baja logica sin
// mover un sol.
//
// Se conserva la PRIMERA de cada par: es la que corrio el flujo completo primero
// (children_created, Odoo, correo) y a la que apunta el primer audit del origen.
//
// Uso:
//   node scripts/fix-rp-dobles.mjs            # dry-run, no escribe nada
//   node scripts/fix-rp-dobles.mjs --aplicar  # baja logica en BD
//   node scripts/fix-rp-dobles.mjs --aplicar --con-odoo   # ademas cancela las SO
import { writeFileSync } from 'node:fs'
import { q, pool } from './db.mjs'

const APLICAR = process.argv.includes('--aplicar')
const CON_ODOO = process.argv.includes('--con-odoo')

// La copia a dar de baja, sus hijos SEG y la orden de venta que dejo en Odoo.
const COPIAS = [
  { copia: 16001, conserva: 15997, origen: 3585, hijos: [16002, 16003, 16004], odooOrderId: 5874977 },
  { copia: 18923, conserva: 18922, origen: 14884, hijos: [], odooOrderId: 6017689 }
]

const TODOS = COPIAS.flatMap((c) => [c.copia, ...c.hijos])

const { rows: [{ db }] } = await q('SELECT current_database() AS db')
console.log('BD:', db, APLICAR ? '| MODO APLICAR' : '| dry-run', '\n')

// --- Guardas: nunca dar de baja algo que tenga plata encima ------------------
const { rows: plata } = await q(
  `SELECT e.enrollment_id,
          e.total_amount,
          (SELECT COALESCE(SUM(pi.amount), 0) FROM public.payment_installments pi
            WHERE pi.enrollment_id = e.enrollment_id)                      AS cuotas,
          (SELECT COUNT(*) FROM public.payments p
            WHERE p.enrollment_id = e.enrollment_id AND p.active = 'Y')    AS pagos_activos,
          e.active
     FROM public.enrollments e
    WHERE e.enrollment_id = ANY($1)
    ORDER BY e.enrollment_id`,
  [TODOS]
)
console.log('== ESTADO ACTUAL DE LAS COPIAS ==')
console.table(plata)

const conPlata = plata.filter((r) => Number(r.cuotas) !== 0 || Number(r.pagos_activos) !== 0)
if (conPlata.length) {
  console.error('\nABORTA: hay copias con plata encima, esto ya no es el caso analizado:')
  console.table(conPlata)
  await pool.end()
  process.exit(1)
}

const faltantes = TODOS.filter((id) => !plata.some((r) => r.enrollment_id === id))
if (faltantes.length) {
  console.error('\nABORTA: estas inscripciones no existen en esta BD:', faltantes.join(', '))
  console.error('(el clon local puede ser anterior a las ventas del 14/09)')
  await pool.end()
  process.exit(1)
}

if (!APLICAR) {
  console.log('\nDry-run. Con --aplicar haria:')
  for (const c of COPIAS) {
    console.log(`  #${c.copia} -> active='N'` + (c.hijos.length ? ` (+ hijos ${c.hijos.join(', ')})` : ''))
    console.log(`     conserva #${c.conserva}; Odoo SO ${c.odooOrderId} ${CON_ODOO ? 'se cancela' : 'NO se toca'}`)
  }
  await pool.end()
  process.exit(0)
}

// --- Respaldo antes de escribir ---------------------------------------------
const { rows: respaldo } = await q(
  `SELECT * FROM public.enrollments WHERE enrollment_id = ANY($1)`,
  [TODOS]
)
const archivo = `scripts/_backup_rp_dobles_${new Date().toISOString().slice(0, 10)}.json`
writeFileSync(archivo, JSON.stringify(respaldo, null, 2))
console.log('respaldo en', archivo)

// --- Baja logica (idempotente) ----------------------------------------------
const { rows: bajadas } = await q(
  `UPDATE public.enrollments
      SET active = 'N',
          notes = COALESCE(notes || ' | ', '') || 'Copia por doble submit de RP, dada de baja el ' || CURRENT_DATE
    WHERE enrollment_id = ANY($1) AND active = 'Y'
    RETURNING enrollment_id`,
  [TODOS]
)
console.log('\ninscripciones dadas de baja:', bajadas.map((r) => r.enrollment_id).join(', ') || '(ninguna, ya estaban)')

for (const c of COPIAS) {
  await q(
    `INSERT INTO public.enrollment_audit_log (enrollment_id, action, details)
     VALUES ($1, 'deactivated', $2)`,
    [c.copia, `Copia generada por doble submit de la RP de #${c.origen}; se conserva #${c.conserva}`]
  )
}

// --- Odoo: cancelar la orden de venta duplicada -----------------------------
if (CON_ODOO) {
  const { odoo } = await import('../src/shared/adapters/odoo/odoo.adapter.js')
  for (const c of COPIAS) {
    const res = await odoo.cancelSaleOrder(c.odooOrderId)
    console.log(`Odoo SO ${c.odooOrderId}:`, res.success ? 'cancelada' : `FALLO -> ${res.error}`)
  }
} else {
  console.log('\nOdoo NO tocado. Ordenes pendientes de cancelar:', COPIAS.map((c) => c.odooOrderId).join(', '))
}

await pool.end()
