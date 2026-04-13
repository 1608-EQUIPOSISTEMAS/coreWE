function capitalizeName (name) {
  if (!name) return ''
  return name.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase())
}

function detectMembershipType (programName) {
  const name = (programName || '').toUpperCase()
  if (name.includes('PLATINUM') || name.includes('PLAT')) return 'PLATINUM'
  if (name.includes('BLACK')) return 'BLACK'
  if (name.includes('PLUS')) return 'PLUS'
  return 'GOLD'
}

function getMembershipAssets (tipo) {
  const map = {
    PLATINUM: {
      bannerid: '1b0r-oURRlWgnOwDNKo8NOaQOhXGGShQd',
      benefitlink: 'http://bit.ly/GBMPlatWE',
      wspgrouplink: 'https://chat.whatsapp.com/EcbSmYfB8Rb4aYBL1xVikZ'
    },
    GOLD: {
      bannerid: '1_wXIDeem4GJiE6um_eKxH6GhNF-zq_pM',
      benefitlink: 'http://bit.ly/GBMBlackWe',
      wspgrouplink: 'https://chat.whatsapp.com/EcbSmYfB8Rb4aYBL1xVikZ'
    },
    PLUS: {
      bannerid: '1StopsX6rjJ80Mg7VhsUAX70-xetGT4CL',
      benefitlink: 'http://bit.ly/GBMPlusWe',
      wspgrouplink: 'https://chat.whatsapp.com/KYyUZ4vDV7TGRfwJKhinys'
    },
    BLACK: {
      bannerid: '1i7iD6NIBEnMx6QGOSHgLY9qEpsN6oBCY',
      benefitlink: 'http://bit.ly/GBMBlackWe',
      wspgrouplink: 'https://chat.whatsapp.com/EcbSmYfB8Rb4aYBL1xVikZ'
    }
  }
  return map[tipo] || map.GOLD
}

export function buildMembresiaHTML (data) {
  const {
    studentName,
    programName,
    email,
    password,
    isNew,
    duracion,
    fechaActivacion,
    fechaRenovacion,
    installmentsHTML,
    bloqueBeneficios,
    fichaRegistroLink
  } = data

  const nombre = capitalizeName(studentName)
  const tipo = detectMembershipType(programName)
  const assets = getMembershipAssets(tipo)
  const tablaHTML = installmentsHTML || ''
  const beneficiosHTML = bloqueBeneficios || ''
  const fichaLink = fichaRegistroLink || 'https://we-educacion-certificacion.com/'

  const accessBlock = isNew
    ? `<tr style="background-color: #ffffff; color:black; text-align: center;">
                    <td align="center" style="padding: 10px;">
                        <font face="Tahoma" size="2"><strong>USUARIO: ${email}</strong></font><br>
                        <font face="Tahoma" size="2"><strong>CONTRASE\u00d1A: ${password || '1234567'}</strong></font>
                    </td>
                </tr>`
    : `<tr style="background-color: #ffffff; color:black; text-align: center;">
                    <td align="center" style="padding: 10px;">
                        <font face="Tahoma" size="2"><strong>USUARIO: ${email}</strong></font><br>
                        <font face="Tahoma" size="2">Si ya cuentas con un usuario, podr\u00e1s acceder con la contrase\u00f1a que creaste.</font>
                    </td>
                </tr>`

  return `<!DOCTYPE html>
<html>
<head>
<base target="_top">
</head>
<body style="margin:0; padding:0; background-color:#ffffff; font-family: Tahoma, sans-serif;">

<table align="center" border="0" cellpadding="0" cellspacing="0" width="550" style="border-collapse: collapse; margin: 0 auto;">

    <tr>
        <td align="center" style="padding-bottom: 10px;">
            <img src="https://lh3.googleusercontent.com/d/${assets.bannerid}" width="550" style="display: block; border: 0;" alt="Header">
        </td>
    </tr>

    <tr>
        <td align="center" style="padding: 5px 0;">
            <font face="Tahoma" size="5" color="#000000"><strong>\u00a1Hola ${nombre}!</strong><img src="https://lh3.googleusercontent.com/d/1Q3NFnPS_d-c5yjh9ipAgoVCG1BVPZXew" width="36" height="36" style="vertical-align: middle; margin-left: 5px; display: inline-block;"></font><br><br>
            <font face="Tahoma" size="2" color="#000000">Te damos la bienvenida a nuestra <b>Comunidad de Members W|E</b></font>
        </td>
    </tr>
    <tr>
        <td align="center" style="padding: 5px 0;">
            <font face="Tahoma" size="2" color="#000000">\u00a1Aprovecha al m\u00e1ximo tu <strong> MEMBRES\u00cdA ${tipo} </strong>y certif\u00edcate a tu propio ritmo!</font>
        </td>
    </tr>

    <tr>
        <td align="center" style="padding: 10px 0;">
            <table width="450" align="center">
                <tr>
                    <td align="left">
                        <ol style="margin: 0; padding-left: 40px;">
                            <font face="Tahoma" size="2">
                            <li><strong>Duraci\u00f3n :</strong> ${duracion || '---'}</li>
                            <li><strong>Fecha de activaci\u00f3n :</strong> ${fechaActivacion || '---'}</li>
                            <li><strong>Fecha de renovaci\u00f3n :</strong> ${fechaRenovacion || '---'}</li>
                            </font>
                        </ol>
                    </td>
                </tr>
            </table>
        </td>
    </tr>

    <tr>
        <td align="center" style="padding: 5px 0px;">
            <hr width="400" align="center" color="#cccccc">
        </td>
    </tr>
    <tr>
        <td align="center">${tablaHTML}</td>
    </tr>

    <tr>
        <td align="center" style="padding-top: 20px;text-align:center">
            <div style="width: 450px; margin: 0 auto; text-align:center">
                <font face="Tahoma" size="3"><img src="https://lh3.googleusercontent.com/d/1-LNLs1MkpM-1bpsRPu-MLLgqnyJdmqcd" width="22" height="22" style="vertical-align: middle; margin-right: 5px; display: inline-block;"><strong>IMPORTANTE</strong></font> <br/>
                <font face="Tahoma" size="2">Con los siguientes datos podr\u00e1s <strong>acceder a tus cursos online:</strong></font> <br/>
            </div>
        </td>
    </tr>
    <tr>
        <td align="center" style="padding: 5px 0 10px 0;">
            <table align="center" border="2" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 440px; border-color: #000000;">
                <tr style="background-color: #ffffff; color: black;">
                    <td align="center">
                        <font face="Tahoma" size="2"><strong> ACCESO PERSONAL</strong></font>
                    </td>
                </tr>
                ${accessBlock}
            </table>
        </td>
    </tr>

    <tr>
          <td align="center" style="padding: 5px 0 10px 0;">
              <a href="https://we-educacion.com/web/login" target="_blank">
                  <img src="https://lh3.googleusercontent.com/d/14Ue_o6uQiobvl43mNa9zwcybGOfPB0E8"
                        alt="Campus Virtual"
                        width="350" style="display: block; width: 100%; max-width: 350px; height: auto; border-radius: 50px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); margin: 0 auto;">
              </a>
          </td>
    </tr>
    <tr><td height="15"></td></tr>
    <tr>
      <td align="center" width="550">
        <table width="100%" align="center">
          <tr>
            <td style="padding: 0 30px;">
              <font face="Tahoma" size="3">
                <img src="https://lh3.googleusercontent.com/d/1xh8OOUV535yhNLrk5UTLNnslAjCn-wUL"
                    width="22" height="22"
                    style="vertical-align: middle; margin-right:5px;">
                Tu <strong>Membres\u00eda ${tipo}</strong> te brinda los siguientes beneficios</font>
              <div style="height:8px;"></div>
              <div style="text-align:left; font-family: Tahoma; font-size:13px;padding: 10px 0;">
                ${beneficiosHTML}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
          <td align="center" style="padding: 5px 0 10px 0;">
              <a href="${assets.benefitlink}" target="_blank">
                  <img src="https://lh3.googleusercontent.com/d/1Pw-3kthkk83mouM4D23m2AdnlVUmPdlX"
                        alt="BENEFICIOS"
                        width="350" style="display: block; width: 100%; max-width: 350px; height: auto; border-radius: 50px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); margin: 0 auto;">
              </a>
          </td>
    </tr>

    <tr>
        <td align="center" style="padding-top: 20px;">
            <hr width="400" align="center" color="#cccccc">
        </td>
    </tr>

    <tr>
        <td style="padding: 20px 20px;">
            <div style="width: 450px; margin: 0 auto;text-align:center">
                <font face="Tahoma" size="3"><img src="https://lh3.googleusercontent.com/d/1-LNLs1MkpM-1bpsRPu-MLLgqnyJdmqcd" width="22" height="22" style="vertical-align: middle; margin-right: 5px; display: inline-block;"><strong>RECUERDA</strong></font> <br/>
            </div>
        </td>
    </tr>
    <tr>
        <td align="left">
            <ul style="font-family: Tahoma; font-size:13px;margin: 0;">
                <font face="Tahoma" size="2">
                  <li>Es importante completar la <strong>FICHA DE REGISTRO</strong> (datos como figura en el DNI) para acceder a tus beneficios</li>
                </font>
            </ul>
        </td>
    </tr>
    <tr>
          <td align="center" style="padding: 5px 0 10px 0;">
              <a href="${fichaLink}" target="_blank">
                  <img src="https://lh3.googleusercontent.com/d/1UBEVpKtw3_xx00W8Kn8VSa9jOBR8mc-z"
                        alt="FICHA REGISTRO"
                        width="350" style="display: block; width: 100%; max-width: 350px; height: auto; border-radius: 50px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); margin: 0 auto;">
              </a>
          </td>
    </tr>

    <tr>
        <td align="left">
            <ul style="font-family: Tahoma; font-size:13px;margin: 0;">
                <font face="Tahoma" size="2">
                  <li>Cualquier error en los datos personales del formulario ser\u00e1 <strong>responsabilidad del participante.</strong></li>
                </font>
            </ul>
        </td>
    </tr>
    <tr>
        <td align="center" style="padding: 20px 0 10px 0;">
            <hr width="400" align="center" color="#cccccc">
        </td>
    </tr>

    <tr>
        <td align="left" style="text-align:center">
          <font face="Tahoma" size="2">
            \u00a1\u00danete a nuestro <strong>GRUPO EXCLUSIVO de Members!</strong>
          </font>
        </td>
    </tr>
    <tr>
          <td align="center" style="padding: 5px 0 10px 0;">
              <a href="${assets.wspgrouplink}" target="_blank">
                  <img src="https://lh3.googleusercontent.com/d/1brFYxzYxWNeliQvIU9dhc62X888rlQJB"
                        alt="GRUPO WHATSAPP"
                        width="350" style="display: block; width: 100%; max-width: 350px; height: auto; border-radius: 50px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); margin: 0 auto;">
              </a>
          </td>
    </tr>

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
    <font face="Tahoma" size="2"><b>S\u00edguenos en nuestras redes para seguir en contacto</b></font>
  </p>

  <br><br>
</footer>
</table>

<table align="left" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-left:0;">
  <tr>
    <td style="padding: 20px 20px 10px 20px;">
      <table border="0" cellpadding="0" cellspacing="0">
        <tr>
          <td valign="top" style="padding-right:15px">
            <img src="https://ci3.googleusercontent.com/mail-sig/AIorK4zCXJR1jwmEHVcU8GNE_r7fng1f3_VzVw1uOP18czCf2df7R8l1PVG6tGVM27KRHMTnIpVPd1c" width="96" height="96" alt="Logo WE">
          </td>
          <td valign="top" style="font-family: Tahoma, sans-serif; font-size: 12px; color: #000;">
            <b>Raul Rivera</b><br>
            Ejecutivo de <span style="background-color:#ffe599;">pagos</span><br>
            <b>+51 943 882 766</b><br>
            <span style="color:#444;">Revisa TC y Pol\u00edticas de privacidad y tratamiento de datos</span><br>
            <a href="http://www.we-educacion/TC.com" style="color:#1155cc;" target="_blank">www.we-educacion/TC.com</a><br>
            <span style="color:#1155cc;">Av. Rep. de Panam\u00e1 3418-Piso 2 / San Isidro</span>
          </td>
        </tr>
      </table>
      <br>
      <img src="https://lh3.googleusercontent.com/d/1oEbOYXIaf_ckV_iQobLmCINBYFp2fwP5"
           alt="Empresas que conf\u00edan en nosotros" width="500" style="max-width:100%; height:auto; display:block;">
      <br>
      <div style="font-family: Tahoma, sans-serif; font-size: 11px; color: #cc0000; font-style: italic; line-height: 1.4;">
        <ol style="margin:0; padding-left:18px;">
          <li>No se aceptan cambios ni devoluciones posteriores al pago</li>
          <li>W|E se reserva el derecho de apertura de curso sujeto al m\u00ednimo de participantes, la apertura se confirmar\u00e1 2 d\u00edas previos al inicio del curso.</li>
          <li>W|E se reserva el derecho a cambio o modificaci\u00f3n de plana docentes en caso de fuerza mayor</li>
        </ol>
      </div>
    </td>
  </tr>
</table>

</body>
</html>`
}

export { detectMembershipType }
