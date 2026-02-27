import 'dotenv/config'

const REQUIRED_ENV = ['SLACK_TOKEN', 'SLACK_CHANNEL']
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`[slack] Variable de entorno requerida: ${key}`)
}

const { SLACK_TOKEN, SLACK_CHANNEL } = process.env

// ─── Error tipado ─────────────────────────────────────────────────────────────
export class SlackError extends Error {
  constructor (message, code = null) {
    super(message)
    this.name = 'SlackError'
    this.code = code
  }
}

// ─── Transporte ───────────────────────────────────────────────────────────────
async function post (payload) {
  let res
  try {
    res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SLACK_TOKEN}`
      },
      body: JSON.stringify(payload)
    })
  } catch (err) {
    throw new SlackError(`No se pudo conectar con Slack: ${err.message}`, 'NETWORK_ERROR')
  }

  if (!res.ok) throw new SlackError(`HTTP ${res.status}`, 'HTTP_ERROR')

  const json = await res.json()
  if (!json.ok) throw new SlackError(json.error || 'Slack error desconocido', 'API_ERROR')

  return json
}

// ─── Notificación de credenciales ─────────────────────────────────────────────
/**
 * Envía las credenciales del instructor recién creado a Slack.
 * Nunca lanza al caller — solo loguea si falla.
 */
async function notifyInstructorCredentials ({ fullName, email, password, instructorId }) {
  try {
    await post({
      channel: SLACK_CHANNEL,
      blocks: [
        {
          type: 'header',
          text: {
            type:  'plain_text',
            text:  '🎓 Nuevo Docente Registrado',
            emoji: true
          }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Nombre:*\n${fullName}` },
          ]
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Correo:*\n${email}` },
            { type: 'mrkdwn', text: `*Contraseña Asignada:*\n\`${password}\`` }
          ]
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '*Nota:* No pasar esta información a nadie más que al docente.'
            }
          ]
        },
        { type: 'divider' }
      ]
    })
  } catch (err) {
    console.error('[slack] notifyInstructorCredentials:', err.message)
  }
}

export default { notifyInstructorCredentials }