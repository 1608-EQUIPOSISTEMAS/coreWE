// Pie compartido de los correos transaccionales: redes, firma, banner de
// empresas y disclaimer legal.
//
// Extraido tal cual de confirmacion-inscripcion.js para que la plantilla de
// eventos no lo duplique. La salida debe ser byte a byte identica a la de
// antes: lo garantizan los snapshots de tests/templates/.
//
// ponytail: sigue siendo un template literal, sin libreria de templating. Las
// tablas anidadas y <font face="Tahoma"> son obligatorias para Outlook.
export function buildWeFooterHTML () {
  return `    <!-- FOOTER -->
  <footer>
  <hr width="400px" align="center">

  <table align="center">
    <tr>
        <td><a href="https://www.facebook.com/WE.Educacion" target="_blank"><img src="https://lh3.googleusercontent.com/d/1ruZs5Q4oCfD6VTLuljARmfLD5R08b573" style="width:35px"></a></td>
        <td><a href="https://we-educacion.com/" target="_blank"><img src="https://lh3.googleusercontent.com/d/1KP1A8uyvC548JcDFU0pAJcdxjwLIdrZL" style="width: 35px;"></a></td>
        <td><a href="https://www.instagram.com/we.educacion/" target="_blank"><img src="https://lh3.googleusercontent.com/d/1iDkuUEUx7cB2i2UujZDYEiJlmEiZSrIO" style="width:35px"></a></td>
        <td><a href="https://www.youtube.com/channel/UC1S6B-SesTdxvQvzpib3gYA?view_as=subscriber" target="_blank"><img src="https://lh3.googleusercontent.com/d/1ts8pZaf5tWpZdnq_yW9ZlLJ7skV-r8u-" style="width:35px"></a></td>
        <td><a href="https://pe.linkedin.com/school/we-educacion-ejecutiva1/" target="_blank"><img src="https://lh3.googleusercontent.com/d/1cVuOKQb2NlxblGfvYwGc1AKoO4yXtKxF" style="width:35px"></a></td>
        <td><a href="https://www.tiktok.com/@weeducacionejecutiva" target="_blank"><img src="https://lh3.googleusercontent.com/d/1XHO8x0z4BmS1UczTBuQmL1WV5lB3kUTw" style="width: 35px;"></a></td>
    </tr>
  </table>

  <p style="text-align:center">
    <font face="Tahoma" size="3">S\u00edguenos en nuestras redes para seguir en contacto</font>
  </p>

  <br>
  <br>

  <table border="0" cellpadding="0" cellspacing="0">
    <tbody>
      <tr>
        <td valign="top" style="padding-right:15px">
          <img src="https://ci3.googleusercontent.com/mail-sig/AIorK4zCXJR1jwmEHVcU8GNE_r7fng1f3_VzVw1uOP18czCf2df7R8l1PVG6tGVM27KRHMTnIpVPd1c" width="96px" height="96px" alt="Logo WE">
        </td>
        <td valign="top">
          <table style="line-height:16px; font-family: Tahoma, sans-serif; font-size: 12px; color: #000000;">
            <tbody>
              <tr><td><b>Raul Rivera</b></td></tr>
              <tr><td>Encargado de <span style="background-color: #ffe599;">pagos</span></td></tr>
              <tr><td><b>+51 943 882 766</b></td></tr>
              <tr><td><span style="color: #444;">Revisa TC y Pol\u00edticas de privacidad y tratamiento de datos</span></td></tr>
              <tr><td><a href="http://www.we-educacion/TC.com" style="color:rgb(17,85,204); text-decoration: underline;" target="_blank">www.we-educacion/TC.com</a></td></tr>
              <tr><td style="color:rgb(17,85,204); padding-top: 2px;">Av. Rep. de Panam\u00e1 3418-Piso 2 / San Isidro</td></tr>
            </tbody>
          </table>
        </td>
      </tr>
    </tbody>
  </table>

  <br>

  <div style="width: 100%; max-width: 500px;">
      <img src="https://lh3.googleusercontent.com/d/1oEbOYXIaf_ckV_iQobLmCINBYFp2fwP5"
           alt="Empresas que conf\u00edan en nosotros"
           style="width: 100%; height: auto; display: block;">
  </div>

  <br>

  <div style="font-family: Tahoma, sans-serif; font-size: 11px; color: #cc0000; font-style: italic; line-height: 1.4;">
    <ol type="1" style="margin-top: 0; padding-left: 20px;">
      <li style="margin-bottom: 5px;">No se aceptan cambios ni devoluciones posteriores al pago</li>
      <li style="margin-bottom: 5px;">WE se reserva el derecho de apertura de curso sujeto al m\u00ednimo de participantes, la apertura se confirmar\u00e1 2 d\u00edas previos al inicio del curso.</li>
      <li>WE se reserva el derecho a cambio o modificaci\u00f3n de plana docentes en caso de fuerza mayor</li>
    </ol>
  </div>

  </footer>`
}
