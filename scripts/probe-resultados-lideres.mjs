// Imprime los indicadores de resultado de un área tal cual los recibe el panel
// de líder (dashboard/results). Solo lectura.
//
// Uso:  node scripts/probe-resultados-lideres.mjs LIDER_COMERCIAL
//       node scripts/probe-resultados-lideres.mjs            (las seis áreas)
//
// Va a la BD de DATABASE_URL (Backend/.env = pruebas en 5433). Producción solo
// con visto bueno del usuario.
import { pool } from '../src/shared/db/pool.js'
import { AREA_OF_LEADER } from '../src/modules/audit/audit.entity.js'
import { areaResults } from '../src/modules/dashboard/results/results.usecases.js'

const leaders = process.argv[2] ? [process.argv[2]] : Object.keys(AREA_OF_LEADER)

try {
  for (const leader of leaders) {
    const started = Date.now()
    const resultados = await areaResults(leader)
    console.log(`\n=== ${leader} (${Date.now() - started} ms) ===`)
    console.log(JSON.stringify(resultados, null, 2))
  }
} finally {
  await pool.end()
  // Importar edition.usecases (Académica) programa el cron de refresco de la
  // matview; sin salir explícito el script quedaría vivo para siempre.
  process.exit(process.exitCode ?? 0)
}
