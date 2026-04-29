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

async function notifyTokenCreated ({ studentName, programName, editionCode, paymentType, amount, currency, isInstallment, notes, requestedByName }) {
  try {
    const amountLabel = isInstallment ? 'Monto inicial' : 'Monto'
    const blocks = [
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
          { type: 'mrkdwn', text: `:moneybag: *${amountLabel}:*\n${currency} ${amount}` }
        ]
      }
    ]

    if (isInstallment) {
      blocks.push({
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `:repeat: _Inscripcion en cuotas — el link cobra solo la inicial._` }
        ]
      })
    }

    blocks.push(
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
    )

    await post({ channel: SLACK_CHANNEL_FICO, blocks })
  } catch (err) {
    console.error('[slack] notifyTokenCreated:', err.message)
  }
}

async function notifyTokenLinkAdded ({ students, groupTotal, currency, advisorName, createdByName, paymentUrl }) {
  try {
    const list             = Array.isArray(students) ? students : []
    const isGroup          = list.length > 1
    const anyInstallment   = list.some(s => s.isInstallment)
    const totalLabel       = anyInstallment ? 'total inicial' : 'total'

    const header = isGroup
      ? `:link: *TOKEN - LINK GENERADO (GRUPO de ${list.length})*`
      : `:link: *TOKEN - LINK GENERADO*`

    let summary
    if (isGroup) {
      summary = `Se ha generado un link unico por *${createdByName || '---'}* que cubre *${list.length} inscripciones* por un ${totalLabel} de *${currency || ''} ${Number(groupTotal || 0).toFixed(2)}*:`
    } else {
      const single = list[0]
      const inicialNote = single?.isInstallment ? ' _(inicial de plan en cuotas)_' : ''
      summary = `Se ha generado el link de pago por *${createdByName || '---'}* para *${single?.name || '---'}* en *${single?.programName || '---'}*${inicialNote}.`
    }

    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: header } },
      { type: 'section', text: { type: 'mrkdwn', text: summary } }
    ]

    if (isGroup) {
      const lines = list.map(s => {
        const tag = s.isInstallment ? ' _(inicial)_' : ''
        return `• *${s.name}* — ${s.programName} (${s.currency} ${Number(s.amount).toFixed(2)}${tag})`
      }).join('\n')
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines } })

      if (anyInstallment) {
        blocks.push({
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: ':repeat: _Los montos marcados como (inicial) son la primera cuota; el resto se cobra fuera del link._' }
          ]
        })
      }
    }

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `:briefcase: El asesor *${advisorName || '---'}*, por favor pasarselo al alumno${isGroup ? 's' : ''}.` }
    })
    blocks.push({ type: 'divider' })

    await post({ channel: SLACK_CHANNEL_FICO, blocks })
  } catch (err) {
    console.error('[slack] notifyTokenLinkAdded:', err.message)
  }
}

export default { notifyInstructorCredentials, notifyStudentRetirement, notifyEnrollmentObserved, notifyEnrollmentResubmitted, notifyTokenCreated, notifyTokenLinkAdded }