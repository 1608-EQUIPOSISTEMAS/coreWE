// Humo del modulo Reprogramaciones contra la BD: la bandeja tiene que responder
// (query real del repo, no un SELECT a mano) y traer las ventas varadas por A5.
import 'dotenv/config'
import { reprogramacionRepository } from '../src/modules/reprogramacion/reprogramacion.repository.js'
import { pool } from '../src/shared/db/pool.js'

const bandeja = await reprogramacionRepository.listAffected()
console.log('filas en la bandeja:', bandeja.length)
console.table(bandeja.slice(0, 5).map(r => ({
  venta: r.enrollment_id,
  alumno: `${r.apellidos}, ${r.nombres}`.slice(0, 28),
  programa: (r.programa || '').slice(0, 30),
  caidas: (r.caidas || []).length,
  estado: r.status || '(sin tomar)'
})))
console.assert(bandeja.length > 0, 'la bandeja no deberia estar vacia: hay ediciones A5 vivas')
await pool.end()
