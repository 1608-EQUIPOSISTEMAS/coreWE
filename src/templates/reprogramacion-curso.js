import { buildWeFooterHTML } from './partials/we-footer.js'

// Aviso de CURSO reprogramado dentro de un paquete (diplomado, especializacion,
// PEE). El alumno ya es alumno: tiene campus y grupo, asi que este correo no
// lleva bienvenida ni pasos de alta. Dice que curso se movio, a que fecha, que el
// resto del programa sigue igual y lo que le falta pagar (que no cambia).
//
// ponytail: template literal con tablas y <font face="Tahoma"> como el resto de
// plantillas; es lo que Outlook respeta.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function capitalizeName (name) {
  if (!name) return ''
  return name.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase())
}

// 'YYYY-MM-DD' -> "jueves 17 de diciembre de 2026" (sin pasar por la zona horaria).
export function fechaLarga (iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '—'
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function fila (label, value) {
  return `<tr>
              <td style="padding:6px;border:1px solid #1B2A47;background-color:rgb(5,36,103);color:white;width:150px"><font face="Tahoma" size="2">${label}</font></td>
              <td style="padding:6px;border:1px solid #1B2A47"><font face="Tahoma" size="2">${value}</font></td>
            </tr>`
}

export function buildReprogramacionCursoHTML ({
  studentName,
  courseName,
  programName,
  oldStartDate,
  newStartDate,
  newEndDate,
  frequency,
  schedule,
  installmentsHTML = ''
}) {
  const nombre = capitalizeName(studentName)
  const horario = [frequency, schedule].filter(Boolean).join(' · ')
  const cuotas = installmentsHTML
    ? `<p style="text-align:center;width:450px"><font face="Tahoma" size="3">Tus cuotas pendientes del programa <b>no cambian</b>:</font></p>
        ${installmentsHTML}`
    : ''

  return `<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
  </head>
  <body>
    <div style="display:grid; place-items:center">
      <table align="center" style="width:450px">
        <tr><td>
          <h2 style="font-family: Tahoma; text-align:center">Hola ${esc(nombre)},</h2>
          <p style="text-align:center;width:450px"><font face="Tahoma" size="3">
            Te confirmamos que el curso <b>${esc(courseName)}</b> de tu <b>${esc(programName)}</b>
            fue reprogramado.
          </font></p>
        </td></tr>
      </table>

      <table align="center" style="border-collapse:collapse;width:450px;text-align:left;margin:10px auto">
        <thead>
          <tr style="background-color:rgb(17,1,101);color:white;">
            <td colspan="2" style="padding:6px;text-align:center"><font face="Tahoma" size="3">CURSO REPROGRAMADO</font></td>
          </tr>
        </thead>
        <tbody>
            ${fila('Curso', esc(courseName))}
            ${fila('Fecha anterior', `<s>${fechaLarga(oldStartDate)}</s>`)}
            ${fila('Nuevo inicio', `<b>${fechaLarga(newStartDate)}</b>`)}
            ${newEndDate ? fila('Fin de clases', fechaLarga(newEndDate)) : ''}
            ${horario ? fila('Horario', esc(horario)) : ''}
        </tbody>
      </table>

      <table align="center" style="width:450px">
        <tr><td>
          <p style="text-align:center;width:450px"><font face="Tahoma" size="3">
            El resto de tu programa sigue igual. Te adjuntamos tu cronograma actualizado.
            El enlace de clase y el grupo de WhatsApp del curso te llegarán antes del nuevo inicio.
          </font></p>
          ${cuotas}
          <p style="text-align:center;width:450px"><font face="Tahoma" size="3">
            ¿Tienes dudas? Escríbenos al WhatsApp <b>+51 922 744 702</b>.
          </font></p>
        </td></tr>
      </table>
    </div>

${buildWeFooterHTML()}
  </body>
</html>`
}
