// ponytail: SOLO LECTURA. Llama al usecase real leadList con el payload exacto
// que arma buildLeadPayload() en views/b2b/Leads.vue, para ver si el 0 de la
// pantalla viene del servidor o del cliente.
import 'dotenv/config'
import * as comercial from '../src/modules/comercial/comercial.usecases.js'

// Payload por defecto de la vista: todo vacio salvo el universo de asesores.
const base = {
  cat_business_line_id: 3228,
  q: null, origin_seller_phone: null, program_text: null, web: null, b2b: null,
  order_by: 0, page: 1, size: 25,
  payment_channel_ids: [], membership_moment_ids: [], fico_status_ids: [],
  profile_ids: [], currency_ids: [], inscription_modality_ids: [],
  installment_status_ids: [], payment_method_ids: [], settlement_status_ids: [],
  status_lead_ids: [], last_follow_ids: [], program_version_ids: [],
  prospect_situation_ids: [], interest_level_ids: [], channel_ids: [],
  query_ids: [], type_program_ids: [], attempt_origin_ids: [],
  model_modality_ids: [], strategy_ids: [], word_ids: [],
  medium_contact_ids: [], code_country_ids: [], moment_ids: []
}

const escenarios = [
  ['lider: universo B2B completo [40,39,38]', [40, 39, 38]],
  ['asesor Jorge [40]',                       [40]],
  ['asesora Nataly [38]',                     [38]],
  ['fallback fail-closed [-1]',               [-1]]
]

for (const [etiqueta, owner_user_ids] of escenarios) {
  try {
    const r = await comercial.leadList({ ...base, owner_user_ids })
    console.log(`${etiqueta.padEnd(42)} -> total=${r.total}, items=${r.items.length}`)
  } catch (err) {
    console.log(`${etiqueta.padEnd(42)} -> ERROR: ${err.message}`)
  }
}
process.exit(0)
