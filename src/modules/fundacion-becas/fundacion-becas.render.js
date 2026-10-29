// Correo diario a Fundacion con las becas que necesitan accion. Solo numero de
// beca, curso, aliado y fecha: nombre, DNI y contacto se ven en el ERP, no
// viajan por correo (Ley 29733).

const escapar = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fecha = d => d ? d.split('-').reverse().join('/') : ''

export const ALERTS_SUBJECT = total => `Becas: ${total} pendiente(s) de acción`

function seccion (titulo, nota, items, columnaFecha, valorFecha) {
  if (!items.length) return ''
  const filas = items.map(i => `
            <tr>
              <td style="padding:6px 8px;border-top:1px solid #e5e7eb">#${i.scholarship_id}</td>
              <td style="padding:6px 8px;border-top:1px solid #e5e7eb">${escapar(i.program_name)}</td>
              <td style="padding:6px 8px;border-top:1px solid #e5e7eb">${escapar(i.partner_name)}</td>
              <td style="padding:6px 8px;border-top:1px solid #e5e7eb;white-space:nowrap">${fecha(valorFecha(i))}</td>
            </tr>`).join('')
  return `
          <h3 style="margin:22px 0 4px;font-size:15px;color:#002060">${titulo} (${items.length})</h3>
          <p style="margin:0 0 8px;font-size:13px;color:#6b7280">${nota}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse">
            <tr style="background:#eef3fb;text-align:left">
              <th style="padding:6px 8px">Beca</th><th style="padding:6px 8px">Curso</th>
              <th style="padding:6px 8px">Aliado</th><th style="padding:6px 8px">${columnaFecha}</th>
            </tr>${filas}
          </table>`
}

export function renderAlertsDigest ({ today, stalePending, expiringSoon, url }) {
  return `<!doctype html>
<html lang="es"><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:10px;overflow:hidden">
        <tr><td style="background:#002060;padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold">Fundación WE · Becas al ${fecha(today)}</td></tr>
        <tr><td style="padding:8px 28px 28px;font-size:14px;line-height:1.5">
          ${seccion('Pendientes de activar', 'Registradas hace más de 3 días: el becario aún no puede empezar.', stalePending, 'Registrada', i => i.registration_date)}
          ${seccion('Por vencer', 'El curso termina en 7 días o menos.', expiringSoon, 'Termina', i => i.end_date)}
          ${url ? `<p style="margin:26px 0 0;text-align:center"><a href="${escapar(url)}" style="display:inline-block;background:#002060;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold">Abrir Becas en el ERP</a></p>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
