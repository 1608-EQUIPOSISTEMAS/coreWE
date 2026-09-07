// Quita de la cuenta de Ricardo (partner 28463) los accesos a cursos online que
// se le colaron por el cruce de identidad: los cursos de regalo de las ventas de
// Maricielo (13525) y de Juan Alpas (18018), que se registraron con el DNI de
// Ricardo. Autorizado por FICO el 2026-09-07.
//
// Los 9 ya existen en la cuenta de su dueno real (verificado en
// probe-odoo-online-ricardo.mjs), asi que nadie pierde acceso.
import { writeFileSync } from 'node:fs'
import odoo from '../src/config/odooClient.js'

const RICARDO = 28463
const A_QUITAR = {
  'venta 13525 - Maricielo Jauregui': [571908, 571909, 571910, 571911],
  'venta 18018 - Juan Alpas': [606554, 606555, 606556, 606557, 606558]
}
const IDS = Object.values(A_QUITAR).flat()

// Se respalda con los campos de avance: si alguien pregunta manana que se borro,
// la respuesta tiene que incluir si el alumno habia entrado al curso.
const CAMPOS = ['id', 'partner_id', 'channel_id', 'create_date', 'completion', 'completed', 'points', 'last_slide']

const existentes = await odoo.callKw('slide.channel.partner', 'search_read', [
  [['id', 'in', IDS]], CAMPOS
], { order: 'id' })

if (existentes.length !== IDS.length) {
  console.warn(`OJO: se esperaban ${IDS.length} filas y Odoo devolvio ${existentes.length}. ` +
               `Faltan: ${IDS.filter(id => !existentes.some(f => f.id === id))}`)
}

// Guarda para el que no fue: cada acceso ajeno debe seguir perteneciendo a
// Ricardo. Si alguno cambio de dueno desde el sondeo, no se borra nada.
const ajenos = existentes.filter(f => f.partner_id?.[0] !== RICARDO)
if (ajenos.length) {
  console.error('ABORTADO: estos ya no son del partner de Ricardo:', ajenos.map(f => f.id))
  process.exit(1)
}

writeFileSync('scripts/_backup_odoo_online_ricardo_2026-09-07.json',
  JSON.stringify({ fecha: new Date().toISOString(), partner: RICARDO, motivo: A_QUITAR, filas: existentes }, null, 2))
console.log('backup escrito: scripts/_backup_odoo_online_ricardo_2026-09-07.json')
console.table(existentes.map(f => ({ id: f.id, canal: f.channel_id?.[1]?.slice(0, 45), avance: f.completion })))

await odoo.callKw('slide.channel.partner', 'unlink', [existentes.map(f => f.id)])

const quedan = await odoo.callKw('slide.channel.partner', 'search', [[['id', 'in', IDS]]], {})
console.log(quedan.length === 0
  ? `\nOK - ${existentes.length} accesos eliminados`
  : `\nFALLO: siguen vivos ${quedan}`)
