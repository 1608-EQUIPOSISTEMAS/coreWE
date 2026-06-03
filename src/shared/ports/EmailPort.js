// Contrato del puerto de email transaccional. La implementacion concreta vive en
// shared/adapters/email sobre el cliente ZeptoMail legacy. Los dominios que envian
// correo (FICO: confirmaciones, membresia, cuotas) dependen de este puerto y no del
// cliente concreto, de modo que cambiar de proveedor (ZeptoMail -> Resend, etc.) no
// toque la logica de dominio.
//
// @typedef {Object} EmailPort
// @property {(p: {to, subject, htmlBody, replyTo?, attachments?, fromEmail?, fromName?, cc?, bcc?}) => Promise<any>} sendEmail
// @property {(p: {to, subject, htmlBody}) => Promise<any>} sendFicoEmail

export {}
