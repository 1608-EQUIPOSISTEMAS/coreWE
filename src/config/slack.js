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

async function notifyStudentRetirement ({ studentName, studentPhone, programName, editionCode, reason, retiredChildren }) {
  try {
    const blocks = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `:x: *RETIRO*` }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `:small_blue_diamond: *Alumno:*\n${studentName}` },
          { type: 'mrkdwn', text: `:small_blue_diamond: *Celular:*\n${studentPhone}` }
        ]
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `:small_blue_diamond: *Programa:*\n${programName || '---'} ${editionCode || ''}` }
        ]
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `:small_blue_diamond: *Observacion:*\n${reason || '---'}` }
      }
    ]

    if (retiredChildren && retiredChildren.length > 0) {
      const childList = retiredChildren.map(c => `• ${c}`).join('\n')
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `:small_blue_diamond: *Modulos retirados:*\n${childList}` }
      })
    }

    blocks.push({ type: 'divider' })

    await post({ channel: SLACK_CHANNEL, blocks })
  } catch (err) {
    console.error('[slack] notifyStudentRetirement:', err.message)
  }
}

const SLACK_CHANNEL_FICO = process.env.SLACK_CHANNEL_FICO || 'C0AJDKB1692'

async function notifyEnrollmentObserved ({ studentName, programName, editionCode, editionDate, advisorName, reason, rejectedByName }) {
  try {
    await post({
      channel: SLACK_CHANNEL_FICO,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `:warning: *INSCRIPCION OBSERVADA*` }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `:bust_in_silhouette: *Alumno:*\n${studentName || '---'}` },
            { type: 'mrkdwn', text: `:mortar_board: *Programa:*\n${programName || '---'}` }
          ]
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `:calendar: *Edicion:*\n${editionCode || ''} ${editionDate || ''}` },
            { type: 'mrkdwn', text: `:briefcase: *Registrado por:*\n${advisorName || '---'}` }
          ]
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `:memo: *Motivo:*\n${reason || '---'}` }
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `:no_entry_sign: *Rechazado por:* ${rejectedByName || '---'}` }
          ]
        },
        { type: 'divider' }
      ]
    })
  } catch (err) {
    console.error('[slack] notifyEnrollmentObserved:', err.message)
  }
}

async function notifyEnrollmentResubmitted ({ studentName, programName, editionCode, editionDate, advisorName }) {
  try {
    await post({
      channel: SLACK_CHANNEL_FICO,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `:white_check_mark: *OBSERVACIONES SUBSANADAS*` }
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `El asesor *${advisorName || '---'}* ya subsano las observaciones para la inscripcion de *${studentName || '---'}* en *${programName || '---'}* (${editionCode || ''} ${editionDate || ''}).` }
        },
        { type: 'divider' }
      ]
    })
  } catch (err) {
    console.error('[slack] notifyEnrollmentResubmitted:', err.message)
  }
}

async function notifyTokenCreated ({ studentName, programName, editionCode, paymentType, amount, currency, notes, requestedByName }) {
  try {
    await post({
      channel: SLACK_CHANNEL_FICO,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `:ticket: *TOKEN SOLICITADO*` }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `:bust_in_silhouette: *Alumno:*\n${studentName || '---'}` },
            { type: 'mrkdwn', text: `:mortar_board: *Programa:*\n${programName || '---'} ${editionCode || ''}` }
          ]
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `:credit_card: *Tipo:*\n${paymentType === 'credito' ? 'Credito' : 'Debito'}` },
            { type: 'mrkdwn', text: `:moneybag: *Monto:*\n${currency} ${amount}` }
          ]
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `:memo: *Nota:*\n${notes || '---'}` }
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `:raising_hand: *Solicitado por:* ${requestedByName || '---'}` }
          ]
        },
        { type: 'divider' }
      ]
    })
  } catch (err) {
    console.error('[slack] notifyTokenCreated:', err.message)
  }
}

async function notifyTokenLinkAdded ({ studentName, programName, advisorName, createdByName, paymentUrl }) {
  try {
    await post({
      channel: SLACK_CHANNEL_FICO,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `:link: *TOKEN - LINK GENERADO*` }
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `Se ha generado el link de pago por *${createdByName || '---'}* para *${studentName || '---'}* en *${programName || '---'}*.` }
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `:briefcase: El asesor *${advisorName || '---'}*, por favor pasarselo al alumno.` }
        },
        { type: 'divider' }
      ]
    })
  } catch (err) {
    console.error('[slack] notifyTokenLinkAdded:', err.message)
  }
}

export default { notifyInstructorCredentials, notifyStudentRetirement, notifyEnrollmentObserved, notifyEnrollmentResubmitted, notifyTokenCreated, notifyTokenLinkAdded }