// Firma unica de los correos transaccionales: la misma tarjeta para
// confirmacion de inscripcion, confirmacion online, cuotas y bienvenida de
// membresia.
//
// Estaba cuadruplicada y las cuatro copias ya habian divergido: dos decian
// "Encargado de pagos", una "Encargado de Finanzas" y la de membresia
// "Ejecutivo de pagos". Cambiar el cargo exigia tocar cuatro archivos y en
// 08/2026 uno quedo viejo (ver el historial de confirmacion-pago.js). Un solo
// lugar para que eso no vuelva a pasar.
//
// ponytail: template literal, sin libreria de templating. Las tablas anidadas
// y el Tahoma inline son obligatorios para Outlook.

// El cargo es lo que cambia cuando rota la persona del area; el resto de la
// tarjeta es estable.
const CARGO = 'Coordinador de Finanzas'
const TELEFONO = '+51 943 882 766'

// La firma vieja apuntaba a http://www.we-educacion/TC.com: ese host no tiene
// TLD, no resuelve, y llevaba meses saliendo asi a los alumnos. Esta es la URL
// viva, la que ya usaba el correo de cuotas.
const POLITICAS_URL = 'https://we-educacion.com/politicas-privacidadwe'

const LOGO_URL = 'https://ci3.googleusercontent.com/mail-sig/AIorK4zCXJR1jwmEHVcU8GNE_r7fng1f3_VzVw1uOP18czCf2df7R8l1PVG6tGVM27KRHMTnIpVPd1c'

export function buildFirmaHTML () {
  return `  <table border="0" cellpadding="0" cellspacing="0">
    <tbody>
      <tr>
        <td valign="top" style="padding-right:15px">
          <img src="${LOGO_URL}" width="96px" height="96px" alt="Logo WE">
        </td>
        <td valign="top">
          <table style="line-height:16px; font-family: Tahoma, sans-serif; font-size: 12px; color: #000000;">
            <tbody>
              <tr><td><b>Raul Rivera</b></td></tr>
              <tr><td>${CARGO}</td></tr>
              <tr><td><b>${TELEFONO}</b></td></tr>
              <tr><td><span style="color: #444;">Revisa TC y Políticas de privacidad y tratamiento de datos</span></td></tr>
              <tr><td><a href="${POLITICAS_URL}" style="color:rgb(17,85,204); text-decoration: underline;" target="_blank">we-educacion.com/politicas-privacidadwe</a></td></tr>
              <tr><td style="color:rgb(17,85,204); padding-top: 2px;">Av. Rep. de Panamá 3418-Piso 2 / San Isidro</td></tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>`
}
