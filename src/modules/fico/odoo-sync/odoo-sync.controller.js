import * as usecases from './odoo-sync.usecases.js'

// Adapter HTTP del sync Odoo. El endpoint legacy nunca propaga el error al
// status: ante cualquier fallo responde 200 con { ok: true, data: { error } }
// para que el frontend muestre el detalle sin tratarlo como caida HTTP. Se
// preserva ese contrato exacto, por eso este handler captura aqui en lugar de
// delegar al error handler global.
export async function enrollInOdooHandler (req, reply) {
  try {
    const data = await usecases.enrollInOdoo({ enrollmentId: req.body.enrollment_id })
    return reply.code(200).send({ ok: true, data })
  } catch (err) {
    console.error('[enrollInOdoo ERROR]', err.message)
    return reply.code(200).send({ ok: true, data: { error: err.message } })
  }
}
