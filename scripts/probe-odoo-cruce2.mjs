// slide.group.student = "Cursos Zoom" (la lista que ve el docente).
import odoo from '../src/config/odooClient.js'
const PARTNERS = [28463, 23197, 341]   // Ricardo, Maricielo, Juan
const rows = await odoo.callKw('slide.group.student', 'search_read', [
  [['partner_id', 'in', PARTNERS]],
  ['id', 'partner_id', 'slide_group_id', 'slide_channel_id', 'create_date']
], { order: 'id' })
console.table(rows.map(r => ({
  id: r.id,
  partner: r.partner_id?.[1]?.slice(0, 28),
  grupo: r.slide_group_id?.[1]?.slice(0, 55),
  canal: r.slide_channel_id?.[1]?.slice(0, 35),
  creado: r.create_date
})))
console.log('\nIDs que el ERP guarda: 125501(13447 Ricardo) 125616(13525 Maricielo) 128161(18018 Juan)')
