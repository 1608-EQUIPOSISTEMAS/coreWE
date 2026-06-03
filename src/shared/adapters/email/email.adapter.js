import { sendEmail, sendFicoEmail } from '../../../config/zeptomail.js'

// Adapter del EmailPort sobre el cliente ZeptoMail legacy. Expone el envio de
// correo que consumen los dominios migrados (FICO), de modo que los usecases
// dependan de este puerto y no del cliente concreto. Mockeable en tests.
export function createEmailAdapter (client = { sendEmail, sendFicoEmail }) {
  return {
    sendEmail: (...args) => client.sendEmail(...args),
    sendFicoEmail: (...args) => client.sendFicoEmail(...args)
  }
}

export const email = createEmailAdapter()
