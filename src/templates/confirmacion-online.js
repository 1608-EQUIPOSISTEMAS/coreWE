function capitalizeName (name) {
  if (!name) return ''
  return name.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase())
}

const BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL || 'https://api.we-educacion.com'
const ONLINE_BANNER_URL = `${BACKEND_PUBLIC_URL}/uploads/onlineCorreo.jpg`
const CAMPUS_LOGIN_URL = 'https://we-educacion.com/web/login'
const VIDEO_TUTORIAL_URL = 'https://www.youtube.com/watch?v=LgP2fc6ttgg'
const VIDEO_TUTORIAL_THUMB = 'https://lh3.googleusercontent.com/d/1dQnzpVcHtkt4ftvGIVfw9ilHTcx0CT1R'

export function buildConfirmacionOnlineHTML (data) {
  const {
    studentName,
    programName,
    email,
    isNew,
    sapUser,
    sapPassword
  } = data

  const nombre = capitalizeName(studentName)
  const upperName = (programName || '').toUpperCase()
  const courseTitle = upperName.endsWith('ONLINE') ? upperName : `${upperName} - ONLINE`

  const sapBlock = sapUser
    ? `<br>
        <table align="center" border="2" cellpadding="2" cellspacing="-1" style="border-collapse:collapse;margin:1 auto;width:420px;border-color:#052467">
          <tr style="background-color:#052467;color:white;text-align:center"><td>
            <font face="Tahoma" size="4"><strong>ACCESO AL SERVIDOR SAP</strong></font>
          </td></tr>
          <tr style="color:black;text-align:center;max-height:50px"><td>
            <font face="Tahoma" size="4"><strong>USUARIO: </strong>${sapUser}</font>
            <br>
            <font face="Tahoma" size="4"><strong>CONTRASEÑA: </strong>${sapPassword || '1234567'}</font>
          </td></tr>
        </table>
        <table align="center" style="width:450px">
          <tr style="text-align:center"><td>
            <font face="Tahoma" size="3" color="#052467"><i>Estas credenciales son personales y te dan acceso al servidor SAP durante tu curso.</i></font>
          </td></tr>
        </table>`
    : ''

  const accessBlock = isNew
    ? `<table align="center" border="2" cellpadding="2" cellspacing="-1" style="border-collapse:collapse;margin:1 auto;width:420px">
          <tr style="text-align:center" align="center"><td>
            <font face="Tahoma" size="4"><strong>ACCESO PERSONAL</strong></font>
          </td></tr>
          <tr style="color:black;text-align:center;max-height:50px"><td>
            <font face="Tahoma" size="4"><strong>USUARIO: </strong> ${email}</font>
            <br>
            <font face="Tahoma" size="4"><strong>CONTRASEÑA: </strong> 1234567</font>
          </td></tr>
        </table>
        <br>
        <table align="center" style="width:450px">
          <tr style="text-align:center"><td>
            <font face="Tahoma" size="3" color="#cc0000"><i>Si cuentas con un usuario registrado con tu correo DEBES de usar la contraseña que creaste</i></font>
          </td></tr>
        </table>`
    : `<table align="center" style="width:450px">
          <tr style="text-align:center; height: 40px;"><td>
            <font face="Tahoma" size="4"><strong>Usuario: </strong>${email}</font>
          </td></tr>
          <tr style="text-align:center"><td>
            <font face="Tahoma" size="4"> Tu usuario ya está registrado en el Campus Virtual.</font>
          </td></tr>
          <tr style="text-align:center"><td>
            <font face="Tahoma" size="4"> Debes usar la misma contraseña para ingresar.</font><br/>
          </td></tr>
          <tr style="text-align:center"><td>
            <font face="Tahoma" size="4">¿Olvidaste tu contraseña? </font><a href="https://we-educacion.com/web/reset_password" target="_blank"><font face="Tahoma" size="4">Haz clic Aquí</font></a>
          </td></tr>
        </table>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirmación de Inscripción Online</title>
</head>
<body>

  <!-- HEADER -->
  <header>
    <div>
      <table align="center" style="width: 100%; max-width: 500px;">
        <tr><td>
          <img src="${ONLINE_BANNER_URL}" style="width: 100%; max-width: 500px; height: auto;">
        </td></tr>
      </table>
      <table align="center" style="width:450px; text-align: center;">
        <tr><td>
          <font face="Tahoma" size="6"><strong>¡Hola ${nombre}!</strong></font><br><br>
          <font face="Tahoma" size="4">Estamos encantados de que formes parte de nuestra comunidad WE.<br>
          Confirmamos tu inscripción al curso:</font><br><br>
          <font face="Tahoma" size="5"><strong>${courseTitle}</strong></font>
        </td></tr>
      </table>
    </div>
  </header>

  <!-- MAIN -->
  <main>
    <div>
      <!-- Banner azul: PASOS PARA INGRESAR -->
      <table align="center" style="width:100%; max-width: 500px; margin: 20px auto;">
        <tr>
          <td align="center" style="background-color:#052467; color:white; border-radius: 25px; padding: 12px;">
            <font face="Tahoma" size="4" color="#ffffff"><strong>PASOS PARA INGRESAR AL CAMPUS VIRTUAL</strong></font>
          </td>
        </tr>
      </table>

      <!-- Pasos i-iv -->
      <table align="center" style="width: 100%; max-width: 500px;">
        <tr>
          <td align="left" style="padding: 0 30px;">
            <ol type="i" style="font-family: Tahoma, sans-serif; font-size: 16px; line-height: 1.8;">
              <li>Dar clic en el botón "Ingresar" <a href="${CAMPUS_LOGIN_URL}" target="_blank" style="color:#1155cc;">aquí</a>.</li>
              <li>Ingresa tu usuario y contraseña.</li>
              <li>Dar clic en "Iniciar sesión".</li>
              <li>Ir al Panel y hacer clic en "Cursos Online".</li>
            </ol>
          </td>
        </tr>
      </table>

      <!-- ACCESO PERSONAL -->
      <br>
      ${accessBlock}

      ${sapBlock}

      <!-- Botón video tutorial (naranja) -->
      <br>
      <table align="center" style="width:100%; max-width: 500px;">
        <tr>
          <td align="center" style="padding: 5px 0 10px 0;">
            <a href="${VIDEO_TUTORIAL_URL}" target="_blank" style="display: inline-block; background-color:#f4a623; color:#000000; padding: 12px 40px; border-radius: 8px; text-decoration: none; font-family: Tahoma, sans-serif; font-size: 16px; font-weight: bold;">
              ACCEDE AL VIDEO TUTORIAL
            </a>
          </td>
        </tr>
      </table>

      <!-- Video thumbnail -->
      <table align="center" style="width:100%; max-width: 500px;">
        <tr>
          <td>
            <a href="${VIDEO_TUTORIAL_URL}" target="_blank">
              <img src="${VIDEO_TUTORIAL_THUMB}"
                   alt="Ver video tutorial"
                   style="max-width:500px; width:100%; display:block;">
            </a>
          </td>
        </tr>
      </table>

      <!-- Botón: completar datos para certificado -->
      <br>
      <table align="center" style="width:100%; max-width: 500px;">
        <tr>
          <td align="center" style="padding: 5px 0 10px 0;">
            <a href="https://we-educacion-certificacion.com/" target="_blank">
              <img src="https://lh3.googleusercontent.com/d/1wRh6pGY2FplPmam_LkAJXI3CsWeyMQtq"
                   alt="Completar datos certificado"
                   width="350" style="display: block; width: 100%; max-width: 350px; height: auto; border-radius: 50px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); margin: 0 auto;">
            </a>
          </td>
        </tr>
      </table>

      <br>
      <!-- Ayuda y TC -->
      <table align="center" style="width:450px">
        <tr style="text-align:center">
          <td>
            <font face="Tahoma" size="4"><strong>¿Necesitas ayuda?</strong>
            <br/>
            Comunícate al WhatsApp <a href="https://wa.me/51922744702" style="color: #0056b3; text-decoration: underline;">+51 922744702</a>
            </font>
          </td>
        </tr>
        <tr style="text-align:center">
          <td>
            <font face="Tahoma" size="4"><a href="https://we-educacion.com/terminos-condiciones" style="color:rgb(17,85,204); text-decoration: underline;" target="_blank"><br><br>Términos y Condiciones</a></font>
          </td>
        </tr>
      </table>
    </div>
  </main>

  <!-- FOOTER -->
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
      <font face="Tahoma" size="3">Síguenos en nuestras redes para seguir en contacto</font>
    </p>

    <br><br>

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
                <tr><td><span style="color: #444;">Revisa TC y Políticas de privacidad y tratamiento de datos</span></td></tr>
                <tr><td><a href="http://www.we-educacion/TC.com" style="color:rgb(17,85,204); text-decoration: underline;" target="_blank">www.we-educacion/TC.com</a></td></tr>
                <tr><td style="color:rgb(17,85,204); padding-top: 2px;">Av. Rep. de Panamá 3418-Piso 2 / San Isidro</td></tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>

    <br>

    <div style="width: 100%; max-width: 500px;">
      <img src="https://lh3.googleusercontent.com/d/1oEbOYXIaf_ckV_iQobLmCINBYFp2fwP5"
           alt="Empresas que confían en nosotros"
           style="width: 100%; height: auto; display: block;">
    </div>

    <br>

    <div style="font-family: Tahoma, sans-serif; font-size: 11px; color: #cc0000; font-style: italic; line-height: 1.4;">
      <ol type="1" style="margin-top: 0; padding-left: 20px;">
        <li style="margin-bottom: 5px;">No se aceptan cambios ni devoluciones posteriores al pago</li>
        <li style="margin-bottom: 5px;">WE se reserva el derecho de apertura de curso sujeto al mínimo de participantes, la apertura se confirmará 2 días previos al inicio del curso.</li>
        <li>WE se reserva el derecho a cambio o modificación de plana docentes en caso de fuerza mayor</li>
      </ol>
    </div>

  </footer>

</body>
</html>`
}
