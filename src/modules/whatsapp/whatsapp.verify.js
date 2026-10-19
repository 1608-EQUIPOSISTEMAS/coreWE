import crypto from 'node:crypto'

// Verificación de que el webhook viene de Meta: cabecera X-Hub-Signature-256 =
// "sha256=" + HMAC-SHA256(App Secret, body crudo). Mismo patrón que Slack
// (tickets/slack/slack.verify.js): la firma se calcula sobre los bytes tal cual
// llegaron, no sobre el JSON ya parseado.

// Se registra DENTRO del plugin de WhatsApp: no cambia cómo parsea el resto del ERP.
export function registerRawJsonParser (fastify) {
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body
    try {
      done(null, body.length ? JSON.parse(body.toString('utf8')) : {})
    } catch (err) {
      err.statusCode = 400
      done(err)
    }
  })
}

export function isValidMetaSignature ({ rawBody, signature, appSecret }) {
  if (!rawBody || !signature) return false
  const expected = Buffer.from(`sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`)
  const received = Buffer.from(String(signature))
  return received.length === expected.length && crypto.timingSafeEqual(received, expected)
}

export async function verifyMetaSignature (request, reply) {
  const appSecret = process.env.WHATSAPP_APP_SECRET
  if (!appSecret) {
    return reply.code(503).send({ ok: false, message: 'Integración de WhatsApp no configurada' })
  }
  const signature = request.headers['x-hub-signature-256']
  if (!isValidMetaSignature({ rawBody: request.rawBody, signature, appSecret })) {
    return reply.code(401).send({ ok: false, message: 'Firma de Meta inválida' })
  }
}
