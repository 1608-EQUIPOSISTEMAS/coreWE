// Sondeo del cruce de 3 alumnos en Odoo (solo lectura).
import odoo from '../src/config/odooClient.js'

const CORREOS = ['ricabellori0798@gmail.com', 'maricielojaurepe@gmail.com', 'juan.alpas2507@gmail.com']
const DOCS = ['73117361', '75462134', '78451212']

const partners = await odoo.callKw('res.partner', 'search_read', [
  ['|', '|', ['email', 'in', CORREOS], ['id', '=', 23499], ['vat', 'in', DOCS]],
  ['id', 'name', 'names', 'surnames', 'email', 'vat', 'phone', 'mobile', 'active']
], { context: { active_test: false } })
console.log('=== res.partner ===')
console.table(partners)

const ids = partners.map(p => p.id)
const users = await odoo.callKw('res.users', 'search_read', [
  ['|', ['partner_id', 'in', ids], ['login', 'in', CORREOS]],
  ['id', 'login', 'name', 'partner_id', 'active']
], { context: { active_test: false } })
console.log('\n=== res.users ===')
console.table(users.map(u => ({ ...u, partner_id: JSON.stringify(u.partner_id) })))

console.log('\n=== slide.channel.partner (matriculas) ===')
const scp = await odoo.callKw('slide.channel.partner', 'search_read', [
  [['partner_id', 'in', ids]],
  ['id', 'partner_id', 'channel_id']
], {})
console.table(scp.map(r => ({ id: r.id, partner: JSON.stringify(r.partner_id), canal: JSON.stringify(r.channel_id) })))
