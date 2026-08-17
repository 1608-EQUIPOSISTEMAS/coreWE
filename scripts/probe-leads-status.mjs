// One-off: dado un listado de celulares, devuelve el estado CRM (cat_status_lead)
// del lead mas reciente de cada numero.
//
// El telefono se guarda con formatos sucios (espacios, +51, guiones): se compara
// por los ultimos 9 digitos, que es lo unico estable de un celular peruano.
import { q, pool } from './db.mjs'

const PHONES = `
923467675 902663854 969572511 972559772 964137841 962205862 937275767 996389392
941442353 921680785 921276378 933936139 927562344 937719955 936647877 912513227
961222916 991296074 902600693 970783074 987655970 981474699 934318967 937378654
960149313 988566545 923750227 957768017 947747712 939869492 939390703 948688503
921363446 926380821 943776862 955484570 999723537 947244443 993132524 913767592
981115128 998471838 989917716 998155292 956296790 937197386 921612745 971667161
950750020 942477519 937399976 941448717
`.trim().split(/\s+/)

const { rows } = await q(`
  WITH pedido AS (SELECT unnest($1::text[]) AS phone),
  norm AS (
    SELECT l.*,
           RIGHT(regexp_replace(COALESCE(l.origin_phone,''), '\\D', '', 'g'), 9) AS tel9
    FROM leads l
  ),
  ranked AS (
    SELECT p.phone,
           n.lead_id, n.full_name, n.registration_date, n.pay_date, n.agreed_amount,
           n.cat_status_lead, n.active,
           ROW_NUMBER() OVER (PARTITION BY p.phone ORDER BY n.registration_date DESC) AS rn
    FROM pedido p
    JOIN norm n ON n.tel9 = p.phone
  )
  SELECT r.phone,
         r.lead_id,
         r.full_name,
         c.description AS estado,
         r.active,
         r.registration_date::date AS registro,
         r.pay_date,
         r.agreed_amount
  FROM pedido pd
  LEFT JOIN ranked r ON r.phone = pd.phone AND r.rn = 1
  LEFT JOIN catalog c ON c.catalog_id = r.cat_status_lead
  ORDER BY array_position($1::text[], pd.phone)
`, [PHONES])

console.table(rows.map(r => ({
  telefono: r.phone,
  lead: r.lead_id ?? '—',
  nombre: r.full_name ?? '—',
  estado: r.estado ?? (r.lead_id ? '(sin estado)' : 'NO EXISTE'),
  registro: r.registro ?? '',
  pay_date: r.pay_date ?? ''
})))

await pool.end()
