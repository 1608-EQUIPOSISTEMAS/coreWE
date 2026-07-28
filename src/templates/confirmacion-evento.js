import { buildWeFooterHTML } from './partials/we-footer.js'
import { capitalizeName } from './confirmacion-inscripcion.js'

// Correo de confirmacion de inscripcion a un EVENTO / CONGRESO.
//
// Se separa de confirmacion-inscripcion.js porque un asistente a congreso no
// recibe lo mismo que un alumno de curso: no hay campus ni credenciales, no hay
// cronograma de sesiones semanales ni tabla de cuotas, y si hay tres formularios
// propios del evento.
//
// El detalle de sesiones NO se calcula: es texto libre cargado por edicion
// (session_detail_virtual / session_detail_onsite). El render elige cual segun
// la categoria de entrada de la inscripcion. Se hizo asi porque el formato real
// ("Dia 1: Viernes 19 de Junio de 5pm a 9:20pm - Via Zoom (Hora Peru)") mezcla
// fecha, hora y modalidad de una forma que ningun generador acierta.

// Escapa el texto libre que carga Producto y respeta sus saltos de linea.
// Va directo al HTML de un correo, asi que no puede confiarse en el contenido.
function escapeMultiline (text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, '<br>')
}

// Boton de tabla con el navy de marca. Mismo look que "MEDIOS DE PAGO" de la
// plantilla de curso; se usa tabla y no <button> porque Outlook no estila botones.
// Devuelve '' si no hay link: nunca debe emitirse un <a href=""> muerto.
function buildButton (href, label, background = 'rgb(5,36,103)') {
  if (!href) return ''
  return `
      <table align="center" style="padding: 7px;border-radius:9px;background-color:${background}; width: 450px; margin-top: 10px;">
        <tr align="center"><td>
          <a href="${href}" target="_blank" style="text-decoration-line:none;color: white;">
            <FONT FACE="tahoma" size="4"><strong>${label}</strong></FONT>
          </a>
        </td></tr>
      </table>`
}

export function buildConfirmacionEventoHTML (data) {
  const {
    studentName,
    eventName,
    categoryLabel,
    sessionDetail,
    bannerUrl,
    whatsappLink,
    certificateFormLink,
    businessCardLink
  } = data

  const nombre = capitalizeName(studentName)
  const evento = (eventName || '').toUpperCase()

  const bannerImg = bannerUrl
    ? `<img src="${bannerUrl}" style="width: 100%; max-width: 500px; height: auto;">`
    : ''

  // Badge con la categoria de entrada (VIP / GENERAL / PREMIUM / VIRTUAL).
  const categoryBadge = categoryLabel
    ? `<table align="center" style="margin-top:6px"><tr><td style="padding:3px 14px;border-radius:12px;background-color:#fef3c7;border:1px solid #fde68a">
         <font face="Tahoma" size="2" color="#92400e"><strong>ENTRADA ${String(categoryLabel).toUpperCase()}</strong></font>
       </td></tr></table>`
    : ''

  // Bloque de sesiones: se omite entero si la edicion no tiene el texto cargado.
  const sessionBlock = sessionDetail
    ? `<div style="margin-top:14px">
         <font face="Tahoma" size="4">${escapeMultiline(sessionDetail)}</font>
       </div>`
    : ''

  const buttons = [
    buildButton(certificateFormLink, 'REGISTRA TUS DATOS PARA EL CERTIFICADO'),
    buildButton(whatsappLink, 'ÚNETE A GRUPO DE WHATSAPP AQUÍ', 'rgb(240,173,20)'),
    buildButton(businessCardLink, 'SUBE AQUÍ TU TARJETA DE PRESENTACIÓN')
  ].join('')

  return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirmación de Inscripción</title>
</head>
<body>

    <!-- HEADER -->
  <header>
    <div>
      <table align="center" style="width:100%;max-width:500px">
        <tr align="center"><td>${bannerImg}</td></tr>
      </table>
    </div>
  </header>

  <main>
    <div>
      <table align="center" style="width:100%;max-width:500px">
        <tr align="center"><td>
          <br>
          <font face="Tahoma" size="5"><strong>¡Hola, ${nombre}!</strong></font>
          <br><br>
          <font face="Tahoma" size="4">Estamos encantados de que formes parte de nuestra comunidad WE</font>
          <br>
          <font face="Tahoma" size="4">Confirmamos tu inscripción al:</font>
          <br><br>
          <font face="Tahoma" size="4"><strong>${evento}</strong></font>
          ${categoryBadge}
          ${sessionBlock}
        </td></tr>
      </table>

      <table align="center" style="width:100%;max-width:500px">
        <tr align="center"><td>
          <br>
          <font face="Tahoma" size="4"><strong>IMPORTANTE:</strong> 48 horas antes del evento, te enviaremos por correo electrónico los detalles para acceder al mismo.</font>
          <br><br>
          <hr width="400px" align="center">
        </td></tr>
      </table>

      <table align="center" style="width:100%;max-width:500px">
        <tr><td>
          <font face="Tahoma" size="4"><strong>RECUERDA:</strong></font>
          <ol>
            <li><font face="Tahoma" size="3">Es importante completar la FICHA DE REGISTRO (Datos como figura en el DNI) para la certificación.</font></li>
            <li><font face="Tahoma" size="3">Cualquier error en los datos personales del formulario será responsabilidad del participante.</font></li>
            <li><font face="Tahoma" size="3">La emisión de un nuevo certificado tendrá un costo adicional.</font></li>
            <li><font face="Tahoma" size="3">Sube aquí tu tarjeta de presentación y conecta con profesionales, empresas y personas que apuestan por el crecimiento y la colaboración.</font></li>
          </ol>
        </td></tr>
      </table>
${buttons}
    </div>
  </main>

${buildWeFooterHTML()}

</body>
</html>`
}
