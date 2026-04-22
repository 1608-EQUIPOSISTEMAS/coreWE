import nodemailer from 'nodemailer'

const transport = nodemailer.createTransport({
  host: 'smtp.zeptomail.com',
  port: 587,
  auth: {
    user: 'emailapikey',
    pass: process.env.ZEPTOMAIL_API_KEY || ''
  }
})

const transportFico = nodemailer.createTransport({
  host: 'smtp.zeptomail.com',
  port: 587,
  auth: {
    user: 'emailapikey',
    pass: process.env.ZEPTOMAIL_FICO_API_KEY || ''
  }
})

const FROM_EMAIL = process.env.ZEPTOMAIL_FROM_EMAIL || 'noreply@we-educacion.com'
const FROM_NAME = process.env.ZEPTOMAIL_FROM_NAME || 'WE Educacion Ejecutiva'

export async function sendEmail ({ to, subject, htmlBody, replyTo, attachments }) {
  if (!process.env.ZEPTOMAIL_API_KEY) {
    console.warn('[ZeptoMail] API key no configurada, email no enviado')
    return { success: false, error: 'API key no configurada' }
  }

  try {
    const info = await transport.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      html: htmlBody,
      ...(replyTo && { replyTo }),
      ...(Array.isArray(attachments) && attachments.length > 0 && { attachments })
    })
    console.log(`[ZeptoMail] Email enviado a ${to} | messageId: ${info.messageId}`)
    return { success: true, messageId: info.messageId }
  } catch (err) {
    console.error(`[ZeptoMail] Error enviando a ${to}:`, err.message)
    return { success: false, error: err.message }
  }
}

export async function sendFicoEmail ({ to, subject, htmlBody }) {
  if (!process.env.ZEPTOMAIL_FICO_API_KEY) {
    console.warn('[ZeptoMail-FICO] API key no configurada, email no enviado')
    return { success: false, error: 'FICO API key no configurada' }
  }

  try {
    const info = await transportFico.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      html: htmlBody
    })
    console.log(`[ZeptoMail-FICO] Email enviado a ${to} | messageId: ${info.messageId}`)
    return { success: true, messageId: info.messageId }
  } catch (err) {
    console.error(`[ZeptoMail-FICO] Error enviando a ${to}:`, err.message)
    return { success: false, error: err.message }
  }
}
