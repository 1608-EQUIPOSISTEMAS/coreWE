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
      benefitlink: 'http://bit.ly/GBMPlatWE'
    },
    GOLD: {
      bannerid: '1_wXIDeem4GJiE6um_eKxH6GhNF-zq_pM',
      benefitlink: 'http://bit.ly/GBMBlackWe'
    },
    PLUS: {
      bannerid: '1StopsX6rjJ80Mg7VhsUAX70-xetGT4CL',
      benefitlink: 'http://bit.ly/GBMPlusWe'
    },
    BLACK: {
      bannerid: '1i7iD6NIBEnMx6QGOSHgLY9qEpsN6oBCY',
      benefitlink: 'http://bit.ly/GBMBlackWe'
    }
  }
  return map[tipo] || map.GOLD
}

// Equivalente exacto a obtenerConfiguracionMembresia() del Apps Script.
// Devuelve { beneficios, whatsapp } por tipo de membresia.
function getMembershipConfig (tipo) {
  const defaultWsp = 'https://chat.whatsapp.com/EcbSmYfB8Rb4aYBL1xVikZ'
  let beneficios = ''
  let whatsapp = defaultWsp

  switch (tipo) {
    case 'PLATINUM':
      beneficios = `
        <ol style="margin-top:5px;">
        <li><strong>Acceso al 100% de cursos online</strong> actuales y nuevos programas.</li>
        <li>Acceso todo incluido a <strong>5 programas Zoom</strong>.<br>Comunicate: <a href="https://wa.me/51946912021?text=Hola.%20Soy%20Member%20PLATINIUM%20y%20quiero%20inscribirme%20a%20un%20%2Aprograma%20Zoom%2A." target="_blank" style="color:blue; text-decoration:none;"><strong>+51 946 912 021</strong></a></li>
        <li>Acceso con 60% dscto. en otros programas Zoom.</li>
        </ol>`
      break

    case 'GOLD':
      beneficios = `
        <ol style="margin-top:5px;">
        <li><strong>Acceso al 100% de cursos online</strong> actuales y nuevos programas.</li>
        <li>Acceso todo incluido a <strong>2 programas Zoom</strong>.<br>Comunicate: <a href="https://wa.me/51946912021?text=Hola.%20Soy%20Member%20GOLD%20y%20quiero%20inscribirme%20a%20un%20%2Aprograma%20Zoom%2A." target="_blank" style="color:blue; text-decoration:none;"><strong>+51 946 912 021</strong></a></li>
        <li>Acceso con 60% dscto. en otros programas Zoom.</li>
        <li>Acceso al <strong>servidor SAP</strong> durante 6 meses.<br>Solicita usuario: <a href="https://wa.me/51943882766?text=Hola%20soy%20member%20we%2C%20solicito%20mi%20usuario%20y%20contrase%C3%B1a%20SAP." target="_blank" style="color:blue; text-decoration:none;"><strong>+51 986115148</strong></a></li>
       </ol>`
      break

    case 'PLUS':
      whatsapp = 'https://chat.whatsapp.com/IjyWpnOZGuG62Xuzt7IXWk'
      beneficios = `
        <ol style="margin-top:5px;">
        <li><strong>Acceso al 100% de cursos online</strong> actuales y nuevos programas.</li>
        <li>Acceso con 60% dscto. en programas Zoom.<br>Comunicate: <a href="https://wa.me/51946912021?text=Hola.%20Soy%20Member%20PLUS%20y%20quiero%20inscribirme%20a%20un%20%2Aprograma%20Zoom%2A." target="_blank" style="color:blue; text-decoration:none;"><strong>+51 946 912 021</strong></a></li>
        <li>Acceso al <strong>servidor SAP</strong> durante 6 meses.<br>Solicita usuario: <a href="https://wa.me/51943882766?text=Hola%20soy%20member%20we%2C%20solicito%20mi%20usuario%20y%20contrase%C3%B1a%20SAP." target="_blank" style="color:blue; text-decoration:none;"><strong>+51 943 882 766</strong></a></li>
        </ol>`
      break

    case 'BLACK':
      beneficios = `
        <ol style="margin-top:5px;">
        <li><strong>Acceso al 100% de cursos online</strong> actuales y nuevos programas.</li>
        <li>Acceso a <strong>TODOS los programas Zoom</strong>.<br>Comunicate: <a href="https://wa.me/51946912021?text=Hola.%20Soy%20Member%20BLACK%20y%20quiero%20inscribirme%20a%20un%20%2Aprograma%20Zoom%2A." target="_blank" style="color:blue; text-decoration:none;"><strong>+51 946 912 021</strong></a></li>
        <li>Acceso Premium todo incluido a eventos virtuales y presenciales.</li>
        <li>Acceso al <strong>servidor SAP</strong> durante 6 meses.<br>Solicita usuario: <a href="https://wa.me/51943882766?text=Hola%20soy%20member%20we%2C%20solicito%20mi%20usuario%20y%20contrase%C3%B1a%20SAP." target="_blank" style="color:blue; text-decoration:none;"><strong>+51 943 882 766</strong></a></li>
        </ol>`
      break
  }

  return { beneficios, whatsapp }
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
  const config = getMembershipConfig(tipo)
  const tablaHTML = installmentsHTML || ''
  // Si no nos pasaron beneficios desde el caller, los toma del config por tipo.
  const beneficiosHTML = bloqueBeneficios || config.beneficios
  // Link al grupo de WhatsApp del tipo (PLUS tiene grupo distinto al resto).
  const whatsappLink = config.whatsapp
  // Ficha de registro: misma URL fija que usa el GAS para todas las membresias.
  const fichaLink = fichaRegistroLink || 'https://docs.google.com/forms/d/e/1FAIpQLScBPUFPYM665vzPSPqoQR_c-W-gqziFsJYQQp441_SArEWQ8g/viewform'

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
                        <font face="Tahoma" size="2">Tu cuenta ya est\u00e1 activa. Si olvidaste tu contrase\u00f1a, <a href="https://we-educacion.com/web/reset_password" target="_blank" style="color:#1155cc;"><strong>recup\u00e9rala aqu\u00ed</strong></a>.</font>
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

    ${tablaHTML ? `
    <tr>
        <td align="center" style="padding: 5px 0px;">
            <hr width="400" align="center" color="#cccccc">
        </td>
    </tr>
    <tr>
        <td align="center">${tablaHTML}</td>
    </tr>` : ''}

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
              <a href="${whatsappLink}" target="_blank">
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

export { detectMembershipType, getMembershipAssets, getMembershipConfig }
