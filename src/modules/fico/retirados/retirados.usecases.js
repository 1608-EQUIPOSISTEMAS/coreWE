import { DomainError } from '../../../shared/errors.js'
import { email } from '../../../shared/adapters/email/email.adapter.js'
import { retiradosRepository as repo } from './retirados.repository.js'
import { buildRetirados } from './retirados.entity.js'
import { ASUNTO_ENCUESTA_RETIRO, renderEncuestaRetiro } from './retirados.render.js'

// Orquestacion del modulo Retirados: lista los retiros del año con el estado de
// su encuesta y manda el correo con el link personal a Nexus.

// Universo pedido por FICO (19/10/26): retiros de 2026. Fijo a proposito: si
// cambia, que sea una decision visible en el codigo y no un filtro olvidado.
const RETIRADOS_DESDE = '2026-01-01'

const NEXUS_URL = process.env.NEXUS_PUBLIC_URL || 'https://weforms.we-educacion-certificacion.com'

export async function listRetirados () {
  return buildRetirados(await repo.listRetirados({ desde: RETIRADOS_DESDE }))
}

/**
 * Envia (o reenvia) la encuesta a cada inscripcion pedida. Uno por uno y sin
 * cortar el lote: un correo rebotado no frena a los demas, y solo se marca como
 * enviada la fila cuyo correo salio de verdad.
 */
export async function enviarEncuestas ({ enrollmentIds, userId }) {
  const { items } = buildRetirados(await repo.listRetirados({ desde: RETIRADOS_DESDE, enrollmentIds }))
  if (!items.length) throw new DomainError('Ninguna de las inscripciones es un retiro de este año')

  const resultado = { enviados: 0, omitidos: [], fallidos: [] }
  for (const r of items) {
    if (r.bloqueo_envio) {
      resultado.omitidos.push({ enrollment_id: r.enrollment_id, full_name: r.full_name, motivo: r.bloqueo_envio })
      continue
    }
    const envio = await enviarEncuesta(r)
    if (envio.success) {
      await repo.marcarEnviada({ enrollmentId: r.enrollment_id, userId })
      resultado.enviados++
    } else {
      resultado.fallidos.push({ enrollment_id: r.enrollment_id, full_name: r.full_name, motivo: envio.error || 'Error de envio' })
    }
  }
  return resultado
}

async function enviarEncuesta (retirado) {
  const token = await repo.ensureEncuesta({ enrollmentId: retirado.enrollment_id, email: retirado.email })
  return email.sendEmail({
    to: retirado.email,
    subject: ASUNTO_ENCUESTA_RETIRO,
    htmlBody: renderEncuestaRetiro({
      nombre: retirado.first_name,
      programa: retirado.program_name,
      url: `${NEXUS_URL}/encuesta-retiro/${token}`
    })
  })
}
