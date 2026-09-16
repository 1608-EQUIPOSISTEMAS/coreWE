import { buildFirmaHTML } from './we-firma.js'

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

${buildFirmaHTML()}

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
