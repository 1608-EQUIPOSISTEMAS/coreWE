import { buildWeFooterHTML } from './partials/we-footer.js'
import { capitalizeName } from './confirmacion-inscripcion.js'
import { buildButton, buildInstallmentsTable, escapeMultiline } from './confirmacion-evento.js'

// Correo de confirmacion de la FERIA LABORAL.
//
// Es un evento, pero Fundacion la comunica distinto a un congreso: no hay
// certificado que registrar ni tarjeta de presentacion, asi que no lleva
// RECUERDA ni esos dos botones. En su lugar va un bloque de "Consideraciones"
// que cambia segun la entrada: la VIP suma sus beneficios y el envio del
// certificado. Replica el correo que FICO mandaba a mano (25/09/26).

const BASE_CONSIDERATIONS = [
  '48 horas antes del evento se compartirán los enlaces de zoom para las sesiones de la Feria Laboral.'
]
const VIP_CONSIDERATIONS = [
  'Los beneficios de la modalidad VIP se aplicarán post evento.',
  'Los certificados de participación se enviarán al correo de registro.'
]

// "Dia 1: Jueves..." es texto libre de la edicion: se resalta solo la etiqueta
// del dia, igual que en el correo manual, sin obligar a Producto a cargar HTML.
function highlightDayLabels (sessionDetail) {
  return escapeMultiline(sessionDetail).replace(/(^|<br>)(D[ií]a \d+:)/gi, '$1<b>$2</b>')
}

function buildConsiderations (isVip) {
  const items = isVip ? [...BASE_CONSIDERATIONS, ...VIP_CONSIDERATIONS] : BASE_CONSIDERATIONS
  return items.map(text => `<p style="text-align:center;margin:6px 0"><font face="Tahoma" size="3">• ${text}</font></p>`).join('')
}

export function buildConfirmacionFeriaLaboralHTML (data) {
  const {
    studentName,
    eventName,
    categoryLabel,
    sessionDetail,
    bannerUrl,
    whatsappLink,
    isVip = false,
    installments = [],
    currencySymbol = 'S/.'
  } = data

  const nombre = capitalizeName(studentName)
  const evento = (eventName || '').toUpperCase()

  const bannerImg = bannerUrl
    ? `<img src="${bannerUrl}" style="width: 100%; max-width: 550px; height: auto;">`
    : ''

  const categoryLine = categoryLabel
    ? `<br><font face="arial, sans-serif" size="4" color="#b45f06"><b><span style="background-color:#fef3c7">ENTRADA ${escapeMultiline(String(categoryLabel).toUpperCase())}</span></b></font>`
    : ''

  const sessionBlock = sessionDetail
    ? `<p style="text-align:center"><font face="Tahoma" size="4">${highlightDayLabels(sessionDetail)}</font></p>`
    : ''

  // ponytail: la feria siempre fue por Zoom; si un dia es presencial, pasar la
  // modalidad desde la edicion en vez de este literal.
  return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirmación de Inscripción</title>
</head>
<body>

  <header>
    <table align="center" style="width:100%;max-width:550px">
      <tr align="center"><td>${bannerImg}</td></tr>
    </table>
  </header>

  <main>
    <table align="center" style="width:100%;max-width:550px">
      <tr align="center"><td>
        <p style="text-align:center"><font face="arial narrow, sans-serif" size="6" color="#000000"><b>¡Hola, ${nombre}!</b></font></p>
        <p style="text-align:center"><font face="Tahoma" size="4">Gracias por participar en la ${evento}. Confirmamos tu participación:</font></p>
        <p style="text-align:center">
          <font face="Tahoma" size="4"><b>${evento}</b></font>
          ${categoryLine}
        </p>
        ${sessionBlock}
        <p style="text-align:center"><font face="Tahoma" size="4"><b>Modalidad:</b> Virtual Vía Zoom</font></p>
        <p style="text-align:center"><font face="Tahoma" size="4"><b>Consideraciones:</b></font></p>
        ${buildConsiderations(isVip)}
      </td></tr>
    </table>

    ${buildInstallmentsTable(installments, currencySymbol)}
${buildButton(whatsappLink, 'ÚNETE A GRUPO DE WHATSAPP AQUÍ', 'rgb(240,173,20)')}
    <br>
  </main>

${buildWeFooterHTML()}

</body>
</html>`
}
