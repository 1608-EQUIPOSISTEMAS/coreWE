// Crea las tablas de Crecimiento RRSS y siembra el catalogo de cuentas.
//
//   node scripts/seed-social-accounts.mjs --dry   # muestra el diff, no guarda
//   node scripts/seed-social-accounts.mjs         # aplica
//
// Idempotente igual que sync-modules-roles.mjs: upsert de lo que esta en
// CATALOGO, baja logica (active='N') de lo que ya no esta. Nunca DELETE, que se
// llevaria por delante los snapshots ya capturados.
//
// external_id NULL = no hay API de la cual leerla, se carga a mano:
// LinkedIn (sin acceso concedido), los grupos de Facebook (Meta elimino la
// Groups API el 22/04/2024) y WhatsApp (son contactos, no una red).
import { q, pool } from './db.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'

const DRY = process.argv.includes('--dry')

// El unico external_id que ya tenemos: la cuenta de Instagram que el modulo de
// Publicaciones RRSS viene usando. Se lee del .env para no versionar el id.
const IG_USER_ID = process.env.IG_USER_ID || null

// Espejo de las pestanas vivas del Sheet. Las de CONGRESO LOGISTICA, CONGRESO
// DATA ANALYTICS y FERIA LABORAL no tienen datos desde 2023: se dan por muertas.
const CATALOGO = [
  ['WE EDUCACION', [
    ['FACEBOOK',  'Fan Page', null],
    ['INSTAGRAM', 'Perfil',   IG_USER_ID],
    ['LINKEDIN',  'Pagina',   null],
    ['YOUTUBE',   'Canal',    null],
    ['TIKTOK',    'Perfil',   null],
    ['WHATSAPP',  'Contactos', null],
  ]],
  ['WE FOR BUSINESS', [
    ['FACEBOOK',  'Fan Page', null],
    ['INSTAGRAM', 'Perfil',   null],
    ['LINKEDIN',  'Pagina',   null],
    ['TIKTOK',    'Perfil',   null],
  ]],
  ['WE ONLINE', [
    ['FACEBOOK',  'Fan Page', null],
    ['INSTAGRAM', 'Perfil',   null],
    ['LINKEDIN',  'Pagina',   null],
    ['TIKTOK',    'Perfil',   null],
    ['YOUTUBE',   'Canal',    null],
  ]],
  ['IIM', [
    ['FACEBOOK',  'Fan Page', null],
    ['INSTAGRAM', 'Perfil',   null],
    ['LINKEDIN',  'Pagina',   null],
    ['TIKTOK',    'Perfil',   null],
  ]],
  ['WE INMOBILIARIA', [
    ['FACEBOOK',  'Fan Page', null],
    ['INSTAGRAM', 'Perfil',   null],
    ['LINKEDIN',  'Pagina',   null],
  ]],
  ['HR LATAM', [
    ['FACEBOOK',  'Fan Page', null],
    ['INSTAGRAM', 'Perfil',   null],
    ['LINKEDIN',  'Pagina',   null],
  ]],
  // Los grupos de Facebook cuelgan de WE EDUCACION: en la hoja alimentaban las
  // columnas GRUPOS FB y Total WE Group.
  ['WE EDUCACION', [
    ['FACEBOOK_GROUP', 'Cursos de SAP', null],
    ['FACEBOOK_GROUP', 'Cursos de EXCEL (Basico-Intermedio-Avanzado)', null],
    ['FACEBOOK_GROUP', 'Cursos y Diplomados en Gestion Logistica', null],
    ['FACEBOOK_GROUP', 'Cursos de Analisis de Datos', null],
    ['FACEBOOK_GROUP', 'Comunidad WE', null],
    ['FACEBOOK_GROUP', 'Cursos de Metodologias Agiles', null],
    ['FACEBOOK_GROUP', 'Cursos y Capacitaciones Normas ISO', null],
    ['FACEBOOK_GROUP', 'Cursos y Diplomados en Gestion de Proyectos', null],
  ]],
]

async function main () {
  const ddl = await fs.readFile(
    path.join(import.meta.dirname, 'create-social-growth.sql'), 'utf8')

  await q('BEGIN')
  await q(ddl)

  const vivas = []
  for (const [brand, cuentas] of CATALOGO) {
    for (const [network, displayName, externalId] of cuentas) {
      const { rows: [a] } = await q(
        `INSERT INTO public.social_accounts (brand, network, display_name, external_id, active)
         VALUES ($1, $2, $3, $4, 'Y')
         ON CONFLICT (brand, network, display_name) DO UPDATE
           SET external_id = COALESCE(EXCLUDED.external_id, public.social_accounts.external_id),
               active = 'Y'
         RETURNING account_id, (xmax = 0) AS creada`,
        [brand, network, displayName, externalId])
      if (a.creada) console.log(`+ ${brand} / ${network} / ${displayName}`)
      vivas.push(a.account_id)
    }
  }

  const off = await q(
    `UPDATE public.social_accounts SET active = 'N'
     WHERE active = 'Y' AND account_id <> ALL($1::int[])
     RETURNING brand, network, display_name`, [vivas])
  off.rows.forEach(r => console.log(`- ${r.brand} / ${r.network} / ${r.display_name} (inactiva)`))

  const { rows: [{ total, con_api }] } = await q(
    `SELECT count(*) AS total, count(external_id) AS con_api
     FROM public.social_accounts WHERE active = 'Y'`)
  console.log(`\n${total} cuentas activas, ${con_api} con external_id (el resto es carga manual)`)

  await q(DRY ? 'ROLLBACK' : 'COMMIT')
  console.log(DRY ? '[--dry] revertido, no se guardo nada.' : 'OK: catalogo sembrado.')
}

// El tunel SSH se cae seguido: un reintento completo, todo dentro de la misma
// transaccion, asi un corte a media corrida no deja el catalogo a medias.
try {
  await main()
} catch (err) {
  console.warn('fallo, reintentando:', err.message)
  await q('ROLLBACK').catch(() => {})
  await main()
} finally {
  await pool.end()
}
