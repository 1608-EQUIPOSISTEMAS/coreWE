import crypto from 'node:crypto'

// Verificacion de que el request viene realmente de Slack.
// https://api.slack.com/authentication/verifying-requests-from-slack

const TOLERANCIA_SEGUNDOS = 60 * 5

/**
 * Parser de application/x-www-form-urlencoded que ademas conserva el body
 * crudo, que es sobre lo que se calcula la firma (el objeto ya parseado no
 * sirve: reordenar las claves cambiaria el HMAC).
 *
 * Fastify no trae este content type y el ERP no tiene @fastify/formbody. Se
 * registra DENTRO del plugin de rutas de Slack, asi que queda encapsulado y no
 * cambia como parsea el resto de la aplicacion.
 */
export function registrarParserSlack (fastify) {
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'buffer' },
    (req, body, done) => {
      req.rawBody = body
      try {
        done(null, Object.fromEntries(new URLSearchParams(body.toString('utf8'))))
      } catch (err) {
        done(err)
      }
    })

  // La Events API no manda formularios sino JSON, asi que el parser propio de
  // Fastify tampoco sirve: descarta el buffer original y la firma se calcula
  // sobre el body crudo. Se sobreescribe solo dentro de este plugin.
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' },
    (req, body, done) => {
      req.rawBody = body
      try {
        done(null, body.length ? JSON.parse(body.toString('utf8')) : {})
      } catch (err) {
        done(err)
      }
    })
}

/**
 * preHandler: firma HMAC-SHA256 de `v0:{timestamp}:{rawBody}`, comparada en
 * tiempo constante, mas rechazo de timestamps viejos (anti-replay).
 */
export async function verificarFirmaSlack (request, reply) {
  const secret = process.env.SLACK_SIGNING_SECRET
  if (!secret) {
    return reply.code(503).send({ ok: false, message: 'Integración de Slack no configurada' })
  }

  const timestamp = request.headers['x-slack-request-timestamp']
  const firma = request.headers['x-slack-signature']
  if (!timestamp || !firma || request.rawBody === undefined) {
    return reply.code(401).send({ ok: false, message: 'Falta la firma de Slack' })
  }

  const ahora = Math.floor(Date.now() / 1000)
  if (Math.abs(ahora - Number(timestamp)) > TOLERANCIA_SEGUNDOS) {
    return reply.code(401).send({ ok: false, message: 'Timestamp de Slack fuera de rango' })
  }

  const base = `v0:${timestamp}:${request.rawBody.toString('utf8')}`
  const esperada = `v0=${crypto.createHmac('sha256', secret).update(base).digest('hex')}`

  const recibido = Buffer.from(String(firma))
  const calculado = Buffer.from(esperada)
  const coincide = recibido.length === calculado.length && crypto.timingSafeEqual(recibido, calculado)

  if (!coincide) {
    return reply.code(401).send({ ok: false, message: 'Firma de Slack inválida' })
  }
}
