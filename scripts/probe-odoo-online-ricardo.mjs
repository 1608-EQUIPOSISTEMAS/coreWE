// Solo lectura: separa los accesos online legitimos de Ricardo (partner 28463)
// de los que se le colaron por el cruce de identidad con Maricielo y Juan.
// La fecha de creacion es lo que los distingue: cada tanda coincide con la venta
// que la origino (07/07 y 08/07 Ricardo, 08/07-tarde Maricielo, 28/08 Juan).
import odoo from '../src/config/odooClient.js'

const RICARDO = 28463
const MARICIELO = 23197
const JUAN = 341

const leer = async (partnerId) => odoo.callKw('slide.channel.partner', 'search_read', [
  [['partner_id', '=', partnerId]],
  ['id', 'channel_id', 'create_date']
], { order: 'id' })

const [ricardo, maricielo, juan] = await Promise.all([leer(RICARDO), leer(MARICIELO), leer(JUAN)])

console.log('=== accesos online de RICARDO (28463) ===')
console.table(ricardo.map(r => ({ id: r.id, canal: r.channel_id?.[1]?.slice(0, 45), creado: r.create_date })))

const canalesDe = filas => new Map(filas.map(f => [f.channel_id[0], f.id]))
const enMaricielo = canalesDe(maricielo)
const enJuan = canalesDe(juan)

console.log('\n=== cotejo: cuales tambien estan en la cuenta del dueno real ===')
console.table(ricardo.map(r => ({
  id: r.id,
  canal: r.channel_id?.[1]?.slice(0, 45),
  creado: r.create_date,
  'tambien en Maricielo': enMaricielo.get(r.channel_id[0]) ?? '-',
  'tambien en Juan': enJuan.get(r.channel_id[0]) ?? '-'
})))
