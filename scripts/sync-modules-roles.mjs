// Sincroniza las tablas `modules` / `submodules` (matriz de Configuración →
// Roles y Permisos) con el catálogo real del sidebar (`Frontend/src/_nav.js`).
//
// Es la ÚNICA fuente de verdad del panel de Roles: si un módulo no está aquí,
// no aparece como opción marcable y solo se accede por rol hardcodeado.
//
// Idempotente: correrlo N veces deja el mismo estado.
//   - lo que está en CATALOGO  -> upsert (active='Y', nombre/orden actualizado)
//   - lo que NO está           -> active='N' (nunca DELETE: borraría los
//                                 permisos ya otorgados por CASCADE)
//
//   node scripts/sync-modules-roles.mjs           # aplica
//   node scripts/sync-modules-roles.mjs --dry     # solo muestra el diff
import { q, pool } from './db.mjs'

const DRY = process.argv.includes('--dry')

// Espejo de _nav.js + router/index.js. Al agregar un módulo/submódulo nuevo al
// sidebar, agregarlo TAMBIÉN aquí y correr el script.
const CATALOGO = [
  ['DASHBOARD',     'Dashboard',      '/dashboard',              []],
  ['FICO',          'Finanzas',       '/fico',                   [
    ['INSCRIPCIONES', 'Inscripciones'],
    ['TOKENS',        'Tokens de Pago'],
    ['COBRANZAS',     'Cobranzas'],
  ]],
  ['PRODUCTO',      'Producto',       '/producto',               [
    ['PROGRAMAS',     'Programas'],
    ['DOCENTES',      'Docentes'],
    ['CRONOGRAMA',    'Cronograma'],
    ['PRECIOS',       'Lista de Precios'],
    ['LINKS',         'Carga de Links'],
  ]],
  ['COMERCIAL',     'Comercial',      '/comercial',              [
    ['LEADS',                 'Comercial (Leads)'],
    ['CONTROL_GESTION',       'Control - Gestion'],
    ['MARKETING_GESTION',     'Marketing - Gestion'],
    ['LLAMADA_GESTION',       'Llamada - Gestion'],
    ['ASESOR_OBJETIVOS',      'Asesor - Objetivos'],
    ['CRONOGRAMA_OBJETIVOS',  'Cronograma - Objetivos'],
    ['DESCUENTOS',            'Descuentos'],
  ]],
  ['FUNDACION',     'Fundacion',      '/fundacion',              [
    ['LEADS',     'Leads Fundacion'],
    ['EVENTOS',   'Eventos'],
    ['OBJETIVOS', 'Objetivos'],
  ]],
  ['B2B',           'B2B',            '/business',               [
    ['LEADS',           'Leads B2B'],
    ['LEADS_EMPRESAS',  'Leads Empresas'],
    ['EMPRESAS',        'Empresas'],
    ['CONTRATOS',       'Contratos'],
  ]],
  ['ACADEMICA',     'Academica',      '/academica',              [
    ['AULAS',             'Aulas'],
    ['SEMANAL',           'Vista Semanal'],
    ['CONTROL_EDICIONES', 'Control de Ediciones'],
    ['SEGUIMIENTO_B2B',   'Seguimiento B2B'],
    ['REPORTE',           'Reporte Academico'],
    ['BOT',               'Bot Academico'],
  ]],
  ['GERENCIA',      'Gerencia',       '/gerencia',               [
    ['EMBUDO',           'Embudo Consultas-Ventas'],
    ['REPORTE_COMPLETO', 'Reporte Completo'],
  ]],
  ['MARKETING',     'Marketing',      '/marketing',              [
    ['PUBLICACIONES', 'Publicaciones RRSS'],
    ['CRECIMIENTO',   'Crecimiento RRSS'],
  ]],
  ['CLIENTE',       'Cliente',        '/general/cliente',        []],
  ['NOTIFICACIONES','Notificaciones', '/general/notificaciones', []],
  ['CONFIGURACION', 'Configuracion',  '/configuracion',          [
    ['USUARIOS',          'Usuarios'],
    ['ROLES',             'Roles y Permisos'],
    ['IMPORTACION',       'Importacion'],
    ['MEMBRESIA_CURSOS',  'Cursos de Membresia'],
  ]],
]

// "Reporte Completo" vivía en MARKETING.INGRESOS_DIARIOS; se mudó a
// GERENCIA.REPORTE_COMPLETO. Los permisos ya otorgados viajan con él.
const MUDANZAS = [
  { de: ['MARKETING', 'INGRESOS_DIARIOS'], a: ['GERENCIA', 'REPORTE_COMPLETO'] },
]

async function main() {
  await q('BEGIN')

  const vivos = []   // codigos de modulo del catalogo
  const subVivos = [] // pares "MODULO/SUB"

  for (const [i, [code, name, route, subs]] of CATALOGO.entries()) {
    const { rows: [m] } = await q(
      `INSERT INTO public.modules (code, name, route, sort_order, active)
       VALUES ($1, $2, $3, $4, 'Y')
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, route = EXCLUDED.route,
             sort_order = EXCLUDED.sort_order, active = 'Y'
       RETURNING module_id, (xmax = 0) AS creado`,
      [code, name, route, i + 1]
    )
    if (m.creado) console.log(`+ modulo ${code}`)
    vivos.push(code)

    for (const [j, [sCode, sName]] of subs.entries()) {
      const { rows: [s] } = await q(
        `INSERT INTO public.submodules (module_id, code, name, sort_order, active)
         VALUES ($1, $2, $3, $4, 'Y')
         ON CONFLICT (module_id, code) DO UPDATE
           SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, active = 'Y'
         RETURNING (xmax = 0) AS creado`,
        [m.module_id, sCode, sName, j + 1]
      )
      if (s.creado) console.log(`+ submodulo ${code}/${sCode}`)
      subVivos.push(`${code}/${sCode}`)
    }
  }

  // Copia de permisos de los submodulos que se mudaron de modulo.
  for (const { de, a } of MUDANZAS) {
    const { rowCount } = await q(
      `INSERT INTO public.rol_submodule_permission (rol_id, submodule_id, can_access)
       SELECT p.rol_id, dst.submodule_id, p.can_access
       FROM public.rol_submodule_permission p
       JOIN public.submodules org ON org.submodule_id = p.submodule_id
       JOIN public.modules  om  ON om.module_id = org.module_id AND om.code = $1
       JOIN public.modules  dm  ON dm.code = $3
       JOIN public.submodules dst ON dst.module_id = dm.module_id AND dst.code = $4
       WHERE org.code = $2
       ON CONFLICT (rol_id, submodule_id) DO NOTHING`,
      [de[0], de[1], a[0], a[1]]
    )
    if (rowCount) console.log(`~ ${rowCount} permiso(s) migrados ${de.join('/')} -> ${a.join('/')}`)
  }

  // Baja logica de lo que ya no existe en el sidebar.
  const off = await q(
    `UPDATE public.modules SET active = 'N'
     WHERE active = 'Y' AND code <> ALL($1::text[]) RETURNING code`, [vivos])
  off.rows.forEach(r => console.log(`- modulo ${r.code} (inactivo)`))

  const subOff = await q(
    `UPDATE public.submodules s SET active = 'N'
     FROM public.modules m
     WHERE m.module_id = s.module_id AND s.active = 'Y'
       AND (m.code || '/' || s.code) <> ALL($1::text[])
     RETURNING m.code AS m, s.code AS s`, [subVivos])
  subOff.rows.forEach(r => console.log(`- submodulo ${r.m}/${r.s} (inactivo)`))

  await q(DRY ? 'ROLLBACK' : 'COMMIT')
  console.log(DRY ? '\n[--dry] revertido, no se guardo nada.' : '\nOK: matriz sincronizada.')
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
