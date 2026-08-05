// One-off 2026-08-05: arreglos de datos del V CONGRESO DE DIRECCIÓN (edicion
// 15933 / program_version 239) detectados revisando los correos de confirmacion.
//
//  1. business_card_link apuntaba a la carpeta Drive del congreso anterior.
//  2. Faltaba la direccion de la sede. Va en session_detail_onsite (texto libre
//     por edicion) porque ese campo SOLO lo leen las entradas presenciales
//     VIP/GENERAL: las VIRTUAL leen session_detail_virtual. Sin codigo nuevo.
//  3. Tres inscripciones se registraron sin cat_event_category: FICO anoto la
//     modalidad y el asiento a mano en notes. Sin la categoria el correo sale
//     sin badge de modalidad y sin el boton del grupo de WhatsApp.
import { q, pool } from './db.mjs'

const EDICION = 15933
const VIP = 5069
const DIRECCION = 'Centro de Convenciones - Colegio de Ingenieros del Perú CD Lima (Calle Barcelona 240, San Isidro 15076)'
const CARD_LINK = 'https://drive.google.com/drive/folders/1X_fbwI9hGKiWYPT6uYZXC37E3MQd8jJP'

// notes de FICO -> asiento. Los tres son VIP (ver notes en la BD).
const SIN_CATEGORIA = [
  { id: 15805, seat: '23' },
  { id: 15807, seat: '24' },
  { id: 15828, seat: '16' }
]

const { rows: [antes] } = await q(
  'SELECT business_card_link, session_detail_onsite FROM program_editions WHERE edition_num_id = $1', [EDICION])
console.log('ANTES:', antes)

await q('UPDATE program_editions SET business_card_link = $2 WHERE edition_num_id = $1', [EDICION, CARD_LINK])

// Idempotente: no vuelve a pegar la direccion si ya esta.
await q(`
  UPDATE program_editions
     SET session_detail_onsite = session_detail_onsite || E'\\n' || $2
   WHERE edition_num_id = $1
     AND POSITION($2 IN COALESCE(session_detail_onsite, '')) = 0`, [EDICION, DIRECCION])

for (const { id, seat } of SIN_CATEGORIA) {
  await q(`UPDATE enrollments
              SET cat_event_category = COALESCE(cat_event_category, $2),
                  event_seat         = COALESCE(event_seat, $3)
            WHERE enrollment_id = $1`, [id, VIP, seat])
}

const { rows: [despues] } = await q(
  'SELECT business_card_link, session_detail_onsite FROM program_editions WHERE edition_num_id = $1', [EDICION])
console.log('DESPUES:', despues)

const { rows: insc } = await q(`
  SELECT e.enrollment_id, c.description AS modalidad, e.event_seat, ecp.whatsapp_link
    FROM enrollments e
    LEFT JOIN catalog c ON c.catalog_id = e.cat_event_category
    LEFT JOIN event_category_prices ecp ON ecp.program_version_id = 239
         AND ecp.cat_event_category = e.cat_event_category
   WHERE e.program_edition_id = $1 ORDER BY e.enrollment_id`, [EDICION])
console.table(insc)

await pool.end()
