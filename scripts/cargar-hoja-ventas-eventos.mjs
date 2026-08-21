// Carga la hoja "4. Ventas Eventos" del Sheet FICO leyendo de PRODUCCION.
//
// El usecase usa el repositorio singleton, cuyo pool sale del .env (que apunta a
// la BD local de pruebas). Aqui se le cambia el `db` por un pool contra el tunel
// para ejercitar el MISMO codigo que corre desplegado, sin duplicar el usecase.
// Google Sheets no depende del pool: se autentica con credentials/service.json.
//
// Sin argumentos solo lee y muestra lo que subiria. Con --escribir escribe.
import 'dotenv/config'
import fs from 'fs'
import pg from 'pg'
import { integrationRepository } from '../src/modules/integration/integration.repository.js'
import { syncFicoEventosToSheet } from '../src/modules/integration/integration.usecases.js'
import { buildEventosRow, EVENTOS_HEADER_ROW } from '../src/modules/integration/integration.entity.js'

const escribir = process.argv.includes('--escribir')

// La cadena de produccion vive comentada en Backend/.env (la activa apunta a la
// BD local de pruebas). Se lee de ahi para no pasar la contraseña por linea de
// comandos ni escribirla en el repo. PGPASSWORD, si esta, gana.
function cadenaDeProduccion () {
  if (process.env.PGPASSWORD) {
    return `postgresql://postgres:${process.env.PGPASSWORD}@127.0.0.1:55432/neondb`
  }
  const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  const hit = env.match(/^#\s*DATABASE_URL=(postgresql:\/\/\S*127\.0\.0\.1:55432\/neondb)\s*$/m)
  if (!hit) throw new Error('no encontre la cadena del tunel en .env; exporta PGPASSWORD')
  return hit[1]
}

const prod = new pg.Pool({
  connectionString: cadenaDeProduccion(),
  max: 2,
  connectionTimeoutMillis: 10000,
  keepAlive: true
})
prod.on('error', err => console.error('[tunel] socket idle perdido:', err.message))

integrationRepository.db = prod

const { rows: [{ db }] } = await prod.query('SELECT current_database() AS db')
console.log('BD:', db)

const rows = await integrationRepository.getFicoEventos()
console.log('filas de evento confirmadas:', rows.length)
console.log(EVENTOS_HEADER_ROW.join(' | '))
for (const r of rows) console.log(buildEventosRow(r).join(' | '))

// La hoja ya existia en el Sheet (la creo el usuario), asi que ensureAndWrite
// respeta su fila 1 y solo pisa de A2 hacia abajo: si sus cabeceras no estan en
// el mismo orden que EVENTOS_HEADER_ROW, la data entra descuadrada sin que nada
// falle. Por eso se comparan antes de dar el trabajo por bueno.
const cabecera = (await integrationRepository.readRange(
  integrationRepository.SPREADSHEET.fico, "'4. Ventas Eventos'!A1:N1"
))[0] || []
const iguales = EVENTOS_HEADER_ROW.every((h, i) => String(cabecera[i] || '').trim().toUpperCase() === h.toUpperCase())
console.log('\ncabecera en la hoja:', cabecera.join(' | '))
console.log(iguales ? 'OK: coincide con el orden que escribe el sync' : 'OJO: NO coincide, las columnas quedarian cruzadas')

if (escribir) {
  console.log('\nescribiendo en el Sheet FICO...')
  console.log(await syncFicoEventosToSheet())
} else {
  console.log('\n(solo lectura: agrega --escribir para subirlo)')
}
await prod.end()
