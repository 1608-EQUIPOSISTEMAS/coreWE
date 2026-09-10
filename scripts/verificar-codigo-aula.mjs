// Verifica que el codigo de aula del Control de Ediciones (class_code) sea el
// MISMO que publica Nexus en vw_aula_auditoria_resumen_2026. Si alguien toca la
// regla de siglas o el desempate por docente en un solo lado, esto falla.
//   node scripts/verificar-codigo-aula.mjs
import { editionRepository as repo } from '../src/modules/edition/edition.repository.js'

const SEMANAS = [
  ['2026-01-05', '2026-01-11'], ['2026-05-25', '2026-05-31'],
  ['2026-08-24', '2026-08-30'], ['2026-11-02', '2026-11-08']
]

let comparadas = 0
const diffs = []

for (const [desde, hasta] of SEMANAS) {
  const rows = await repo.weeklyControlEditions(desde, hasta)
  const { rows: nexus } = await repo.db.query(
    'SELECT edition_num_id, codigo FROM vw_aula_auditoria_resumen_2026 WHERE edition_num_id = ANY($1::int[])',
    [rows.map(r => r.edition_num_id)]
  )
  const esperado = new Map(nexus.map(r => [r.edition_num_id, r.codigo]))
  for (const r of rows) {
    if (!esperado.has(r.edition_num_id)) continue
    comparadas++
    if (esperado.get(r.edition_num_id) !== r.class_code) {
      diffs.push([r.edition_num_id, r.class_code, esperado.get(r.edition_num_id)])
    }
  }
}

// Pedir la edicion de a una tiene que dar el mismo codigo que dentro de la
// semana: el desempate se cuenta sobre toda la tabla, no sobre lo filtrado.
const CON_HOMONIMA = 15637
const suelta = await repo.controlEditionGet(CON_HOMONIMA)
const { rows: [enNexus] } = await repo.db.query(
  'SELECT codigo FROM vw_aula_auditoria_resumen_2026 WHERE edition_num_id = $1', [CON_HOMONIMA]
)
if (enNexus && suelta?.class_code !== enNexus.codigo) {
  diffs.push([CON_HOMONIMA, suelta?.class_code, enNexus.codigo])
}

console.log(`comparadas: ${comparadas} | discrepancias: ${diffs.length}`)
for (const [id, mio, nexusCod] of diffs) console.log(`  ${id}: ${mio} != ${nexusCod}`)
process.exit(diffs.length ? 1 : 0)
