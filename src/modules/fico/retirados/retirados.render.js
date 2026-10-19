// Correo que invita al retirado a responder la encuesta en Nexus. Promete el
// sorteo de la beca online y dice para que se usan sus respuestas (Ley 29733).

const escapar = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const ASUNTO_ENCUESTA_RETIRO = 'Cuéntanos por qué te retiraste y participa por una beca online'

export function renderEncuestaRetiro ({ nombre, programa, url }) {
  return `<!doctype html>
<html lang="es"><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden">
        <tr><td style="background:#002060;padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold">WE Educación Ejecutiva</td></tr>
        <tr><td style="padding:28px;font-size:15px;line-height:1.6">
          <p style="margin:0 0 14px">Hola ${escapar(nombre)},</p>
          <p style="margin:0 0 14px">Sabemos que dejaste <strong>${escapar(programa)}</strong> y queremos entender por qué, para mejorar.
            Son <strong>3 preguntas</strong> y te toma menos de un minuto.</p>
          <p style="margin:0 0 22px;padding:14px 16px;background:#eef3fb;border-radius:8px">
            🎓 Si respondes, <strong>participas en el sorteo de una beca para un curso online</strong>.</p>
          <p style="margin:0 0 26px;text-align:center">
            <a href="${escapar(url)}" style="display:inline-block;background:#002060;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:bold">Responder la encuesta</a></p>
          <p style="margin:0;font-size:12px;color:#6b7280">El link es personal: no lo compartas. Usaremos tus respuestas solo para mejorar nuestros programas y para el sorteo.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
