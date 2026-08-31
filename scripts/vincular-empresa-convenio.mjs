// Vincula la empresa del convenio al lead de una venta B2B ya cerrada.
//
// La hoja "7. Convenios" saca EMPRESA de leads.company_id (la empresa que el
// asesor elige en la consulta). El formulario recien la guarda desde el
// 2026-08-24: las ventas anteriores quedaron con el lead sin empresa y la
// columna sale vacia. Este script las repara una por una.
//
//   node scripts/vincular-empresa-convenio.mjs 16394 "CLINICA INTERNACIONAL" [--prod]
//
// Es idempotente: si el lead ya apunta a esa empresa no escribe nada.
//
// El trigger block_update_when_enrolled congela la consulta apenas se convierte
// en venta, asi que hay que apagarlo para esta transaccion. Se apaga SOLO ese:
// trg_audit_leads sigue vivo y el cambio queda en la bitacora.
import fs from 'fs'

// Sin --prod escribe en la BD local de pruebas. Se toca DATABASE_URL, nunca
// PGPASSWORD: PGPASSWORD gana sobre el .env y parte los pools en dos BD.
if (process.argv.includes('--prod')) {
  process.env.DATABASE_URL = fs.readFileSync('.env.bak-produccion', 'utf8').match(/postgresql:\/\/\S+/)[0]
}
const { q, pool } = await import('./db.mjs')

const [enrollmentId, razonSocial] = process.argv.slice(2).filter((a) => a !== '--prod')

if (!enrollmentId || !razonSocial) {
  console.error('uso: node scripts/vincular-empresa-convenio.mjs <enrollment_id> "<razon social>"')
  process.exit(1)
}

const fallar = async (mensaje) => {
  console.error(mensaje)
  await pool.end()
  process.exit(1)
}

const { rows: leads } = await q(`
  SELECT l.lead_id, l.company_id, comp.razon_social
    FROM public.leads l
    LEFT JOIN public.companies comp ON comp.company_id = l.company_id
   WHERE l.enrollment_id = $1`, [enrollmentId])

if (leads.length !== 1) await fallar(`la venta ${enrollmentId} tiene ${leads.length} leads: no se puede decidir cual vincular`)

const { rows: empresas } = await q(`
  SELECT company_id, razon_social
    FROM public.companies
   WHERE active = 'Y' AND razon_social ILIKE '%' || $1 || '%'`, [razonSocial])

if (empresas.length !== 1) {
  await fallar(`"${razonSocial}" coincide con ${empresas.length} empresas: ` +
    JSON.stringify(empresas.map((e) => e.razon_social)))
}

const lead = leads[0]
const empresa = empresas[0]

if (lead.company_id === empresa.company_id) {
  console.log(`lead ${lead.lead_id} ya apunta a ${empresa.razon_social}: nada que hacer`)
} else {
  const cliente = await pool.connect()
  try {
    await cliente.query('BEGIN')
    await cliente.query('ALTER TABLE public.leads DISABLE TRIGGER block_update_when_enrolled')
    await cliente.query('UPDATE public.leads SET company_id = $1 WHERE lead_id = $2', [empresa.company_id, lead.lead_id])
    await cliente.query('ALTER TABLE public.leads ENABLE TRIGGER block_update_when_enrolled')
    await cliente.query('COMMIT')
  } catch (error) {
    await cliente.query('ROLLBACK')
    throw error
  } finally {
    cliente.release()
  }
  console.log(`lead ${lead.lead_id}: ${lead.razon_social || '(sin empresa)'} -> ${empresa.razon_social}`)
}

await pool.end()
