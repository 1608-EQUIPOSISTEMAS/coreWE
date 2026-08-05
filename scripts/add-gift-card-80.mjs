// Alta de la GIFT CARD de S/80 en el catalogo de descuentos.
// Idempotente: si el alias ya existe no inserta, solo reporta.
//
//   cd Backend && node scripts/add-gift-card-80.mjs
import { q, pool } from './db.mjs'

// Se copian de las gift cards que ya existen (19, 24, 48, 50) en vez de
// escribir los ids a mano: si manana cambia el tipo o la moneda, la nueva
// nace igual que sus hermanas.
const { rows } = await q(`
  INSERT INTO public.discounts
    (description, alias, cat_discount_type, value, is_global,
     start_date, active, cat_currency_type)
  SELECT 'GIFT CARD 80', 'gift_card_80', d.cat_discount_type, 80.00, true,
         d.start_date, true, d.cat_currency_type
    FROM public.discounts d
   WHERE d.alias = 'gift_card_50'
     AND NOT EXISTS (SELECT 1 FROM public.discounts x WHERE x.alias = 'gift_card_80')
  RETURNING discount_id, description, alias, value
`)

console.log(rows.length ? 'creada:' : 'ya existia, no se toco nada:')
console.table(rows.length
  ? rows
  : (await q(`SELECT discount_id, description, alias, value, active FROM discounts WHERE alias='gift_card_80'`)).rows)

console.log('\nGift cards vigentes:')
console.table((await q(`
  SELECT discount_id, description, value, active FROM public.discounts
   WHERE alias LIKE 'gift_card_%' ORDER BY value::numeric`)).rows)

await pool.end()
