// Lista la matriz vigente de Configuración → Roles y Permisos tal como la ve
// el panel (modules + submodules activos).  node scripts/probe-modules.mjs
import { q, pool } from './db.mjs'

const { rows } = await q(`
  SELECT m.module_id, m.code, m.name, m.route, m.sort_order,
    COALESCE(json_agg(json_build_object('id', s.submodule_id, 'code', s.code, 'name', s.name)
      ORDER BY s.sort_order, s.submodule_id)
      FILTER (WHERE s.submodule_id IS NOT NULL AND s.active = 'Y'), '[]') AS subs
  FROM public.modules m
  LEFT JOIN public.submodules s ON s.module_id = m.module_id
  WHERE m.active = 'Y'
  GROUP BY m.module_id ORDER BY m.sort_order, m.module_id`)

for (const r of rows) {
  console.log(`\n[${r.module_id}] ${r.code} — ${r.name} (${r.route}) sort=${r.sort_order}`)
  for (const s of r.subs) console.log(`    (${s.id}) ${s.code} — ${s.name}`)
}
console.log(`\n${rows.length} módulos, ${rows.reduce((n, r) => n + r.subs.length, 0)} submódulos.`)
await pool.end()
