function capitalizeName (name) {
  if (!name) return ''
  return name.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase())
}

function formatDate (dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const dias = ['Domingo', 'Lunes', 'Martes', 'Mi\u00e9rcoles', 'Jueves', 'Viernes', 'S\u00e1bado']
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
  return `${dias[d.getUTCDay()]} ${d.getUTCDate()} de ${meses[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function formatCurrency (amount, symbol) {
  return `${symbol || 'S/.'} ${Math.trunc(Number(amount || 0))}`
}

function calcFecha (dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  return `${dd} ${meses[d.getUTCMonth()]}`
}

function buildInstallmentsTable (installments, currencySymbol) {
  if (!installments || installments.length === 0) return ''

  const fechasCells = installments.map(i => `<td><font face="Tahoma" size="3">${calcFecha(i.due_date)}</font></td>`).join('')
  const pagosCells = installments.map(i => `<td><font face="Tahoma" size="3">${formatCurrency(i.amount, currencySymbol)}</font></td>`).join('')

  return `
      <table width="450px" border="2" align="center" border-collapse="collapse" style="border-collapse: collapse;text-align: center; height: 75; ">
        <thead>
          <tr>
            <td colspan="${installments.length + 1}" style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="3">CRONOGRAMA DE PAGOS</font></td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="3">Fechas</font></td>
            ${fechasCells}
          </tr>
          <tr>
            <td style="background-color:rgb(5,36,103);color:white;"><font face="Tahoma" size="3">Pago</font></td>
            ${pagosCells}
          </tr>
        </tbody>
      </table>
      <table align="center" style="width:450px">
        <tr><td><p>Se cobrar\u00e1n S/. 2 por d\u00eda de mora</p></td></tr>
      </table>
      <table align="center" style="padding: 7px;border-radius:9px;background-color:rgb(5,36,103); width: 450px;">
        <tr align="center"><td>
          <a href="https://drive.google.com/file/d/1_adDqUIAv-lxAkBuihQnBBcJmwJfj9wx/view" target="_blank" style="text-decoration-line:none;color: white;">
            <FONT FACE="tahoma" size="4"><strong>MEDIOS DE PAGO</strong></FONT>
          </a>
        </td></tr>
      </table>`
}

export function buildConfirmacionHTML (data) {
  const {
    studentName,
    programName,
    startDate,
    frequency,
    schedule,
    whatsappLink,
    email,
    isNew,
    bannerUrl,
    installments,
    currencySymbol,
    hideWhatsapp
  } = data

  const nombre = capitalizeName(studentName)
  const fechaInicio = formatDate(startDate)
  const installmentsHTML = buildInstallmentsTable(installments, currencySymbol)
  const academicaPhone = '51922744702'
  const waFallback = `https://wa.me/${academicaPhone}?text=${encodeURIComponent(`Hola, que tal, vengo del programa ${programName || ''}, me puedes pasar el link de mi grupo por favor.`)}`
  const waLink = whatsappLink || waFallback

  const bannerImg = bannerUrl
    ? `<img src="${bannerUrl}" style="width: 100%; max-width: 500px; height: auto;">`
    : ''

  const accessBlock = isNew
    ? `<table align="center" border="2" cellpadding="2" cellspacing="-1" style="border-collapse:collapse;margin:1 auto;width:420px">
          <tr style="text-align:center" align="center"><td>
            <font face="Tahoma" size="4">ACCESO PERSONAL</font>
          </td></tr>
          <tr style="color:black;text-align:center;max-height:50px"><td>
            <font face="Tahoma" size="4"><strong>USUARIO: </strong> ${email}</font>
            <br>
            <font face="Tahoma" size="4"><strong>CONTRASE\u00d1A: </strong> 1234567</font>
          </td></tr>
        </table>`
    : `<table align="center" style="width:450px">
          <tr style="text-align:center; height: 40px;"><td>
            <font face="Tahoma" size="4"><strong>Usuario: </strong>${email}</font>
          </td></tr>
          <tr style="text-align:center"><td>
            <font face="Tahoma" size="4"> Tu usuario ya est\u00e1 registrado en el Campus Virtual.</font>
          </td></tr>
          <tr style="text-align:center"><td>
            <font face="Tahoma" size="4"> Debes usar la misma contrase\u00f1a para ingresar. </font><br/>
          </td></tr><br/>
          <tr style="text-align:center"><td>
            <font face="Tahoma" size="4">\u00bfOlvidaste tu contrase\u00f1a? </font><a href="https://we-educacion.com/web/reset_password" target="_blank"><font face="Tahoma" size="4">Haz clic Aqu\u00ed</font></a>
          </td></tr>
        </table>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirmaci\u00f3n de Inscripci\u00f3n</title>
</head>
<body>

    <!-- HEADER -->
  <header>
    <div>
      <table align="center" style="width: 100%; max-width: 500px;">
        <tr><td>
          ${bannerImg}
        </td></tr>
      </table>
      <table align="center" style="width:450px; text-align: center;">
        <tr><td>
          <font face="Tahoma" size="6"><strong>\u00a1Hola ${nombre}!</strong></font><br><br>
          <font face="Tahoma" size="4">Estamos encantados de que formes parte de nuestra comunidad WE.
          Confirmamos tu inscripci\u00f3n a:</font>
        </td></tr>
      </table>
    </div>
  </header>

    <!-- MAIN -->
  <main>
    <div>
      <!-- HORARIO, PROGRAMA -->
      <table align="center" style="width: 100%; min-width: 470px; max-width: 600px;">
        <tr>
          <td align="center">
            <table align="center" style="width: 100%; max-width: 440px;">
              <tr>
                <td align="left"> <ol style="margin-left: 20px;">
                    <li><strong><font face="Tahoma" size="4">Programa:</font></strong> <font face="Tahoma" size="4">${programName || ''}</font></li>
                    <li><strong><font face="Tahoma" size="4">Inicio:</font></strong> <font face="Tahoma" size="4">${fechaInicio}</font></li>
                    <li><strong><font face="Tahoma" size="4">Horario:</font></strong> <font face="Tahoma" size="4">${frequency || ''} ${schedule || ''} (
                      <img src="https://lh3.googleusercontent.com/d/1gDkGBweHdVcdTyFAC4hUGs59Tv_8lrlg" width="22" height="22" style="vertical-align: middle; margin-right: 5px; display: inline-block;">
                      <img src="https://lh3.googleusercontent.com/d/1JW2PWvO0LW9UsE308zLR93nAVTLk-dlT" width="22" height="22" style="vertical-align: middle; margin-right: 5px; display: inline-block;">
                      <img src="https://lh3.googleusercontent.com/d/1wNwEHIIUMQdKtpz9Ouvg3LqU2v7gqNtJ" width="22" height="22" style="vertical-align: middle; margin-right: 5px; display: inline-block;"> GMT-5)</font></li>
                  </ol>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr style="text-align:center"><td>
          <font face="Tahoma" size="4"><img src="https://lh3.googleusercontent.com/d/100yF06wcwLvB-VoLDlR0PBHQM6t80O9B" width="22" height="22" style="vertical-align: middle; margin-right: 5px; display: inline-block;"><strong>IMPORTANTE</strong> <br/>

          <font face="Tahoma" size="4">Completa estos 3 pasos para iniciar tu experiencia W|E</font>
          <br/><br/>

          <font face="Tahoma" size="4">Para asegurar una correcta comunicaci\u00f3n, acceso a contenidos y emisi\u00f3n </font><br/>

          <font face="Tahoma" size="4">de tu certificado, es indispensable que completes los siguientes pasos:</font><br/><br/>
        </td></tr>

        <!--DATOS DE BOTONES LINKS-->
        ${hideWhatsapp ? `
        <tr style="text-align:center">
            <td>
              <font face="Tahoma" size="4"><img src="https://lh3.googleusercontent.com/d/13MP8w4XnvbuEgnoa0xoUW3pB3QLpvJ6a" width="22" height="22" style="vertical-align: middle; margin-right: 5px; display: inline-block;"><strong>Cronograma acad\u00e9mico</strong>
              <br/><br/>
              <font face="Tahoma" size="4">Adjuntamos en este correo el <strong>cronograma completo del programa</strong> en formato PDF con las fechas, docentes, horarios y sesiones de cada m\u00f3dulo.</font>
              <br/><br/>
            </td>
        </tr>
        ` : `
        <tr style="text-align:center">
            <td>
              <font face="Tahoma" size="4"><img src="https://lh3.googleusercontent.com/d/1pBX3L1-9k-9q8TON5W1OhatayiYBUxWr" width="22" height="22" style="vertical-align: middle; margin-right: 5px; display: inline-block;"><strong>${whatsappLink ? '\u00danete al grupo oficial de WhatsApp' : 'Solicita el link de tu grupo de WhatsApp'}</strong>
              <br/><br/>
              <font face="Tahoma" size="4">${whatsappLink ? '\u00danete aqu\u00ed al grupo de WhatsApp de tu programa aqu\u00ed:' : 'Escr\u00edbenos para que te compartamos el enlace de tu grupo:'}</font>
              <br/>

            </td>
        </tr>
        <tr>
              <td align="center" style="padding: 5px 0 10px 0;">
                  <a href="${waLink}" target="_blank">
                      <img src="https://lh3.googleusercontent.com/d/1e6GYu7I85fF9CZY6pwWRS65oB5cw7BGN"
                            alt="Unirse al Grupo de WhatsApp"
                            width="350" style="display: block; width: 100%; max-width: 350px; height: auto; border-radius: 50px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); margin: 0 auto;">
                  </a>
              </td>
        </tr>
        `}
        <tr style="text-align:center">
            <td>
              <font face="Tahoma" size="4"><img src="https://lh3.googleusercontent.com/d/13MP8w4XnvbuEgnoa0xoUW3pB3QLpvJ6a" width="22" height="22" style="vertical-align: middle; margin-right: 5px; display: inline-block;"><strong>Completa tus datos para el certificado</strong>
              <br/>
              <font face="Tahoma" size="4"> La informaci\u00f3n que registres ser\u00e1 utilizada tal cual para la emisi\u00f3n </font>
              <br/>

              <font face="Tahoma" size="4">de tu certificado digital</font><br/>

              <i style="color: #666666;"> <font face="Tahoma" size="4"><img src="https://lh3.googleusercontent.com/d/1slHkjdJETgxA1ARW8vxy8CMSdXpI9fWM" width="22" height="22" style="vertical-align: middle; margin-right: 5px; display: inline-block;">Revisa cuidadosamente tus datos antes de enviar el formulario.</font></i><br/>

            </td>
        </tr>
        <tr>
              <td align="center" style="padding: 5px 0 10px 0;">
                  <a href="https://we-educacion-certificacion.com/" target="_blank">
                      <img src="https://lh3.googleusercontent.com/d/1wRh6pGY2FplPmam_LkAJXI3CsWeyMQtq"
                            alt="Completar datos certificado"
                            width="350" style="display: block; width: 100%; max-width: 350px; height: auto; border-radius: 50px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); margin: 0 auto;">
                  </a>
              </td>
        </tr>
        <tr style="text-align:center">
            <td>
              <font face="Tahoma" size="4"><img src="https://lh3.googleusercontent.com/d/1LLBfsoK3XzSZNuC1oQTLEvqy-Ky1tgQb" width="22" height="22" style="vertical-align: middle; margin-right: 5px; display: inline-block;"><strong>Accede a tu campus virtual W|E</strong>
              <br/>  <br/>
              <font face="Tahoma" size="4">Dentro de <strong>max. 24 horas</strong> en el campus encontrar\u00e1s: </font>
              <br/>

              <font face="Tahoma" size="4">
                  <span style="text-decoration: underline; text-decoration-color: black;">
                      cursos online gratuitos, recursos complementarios y el reglamento.
                  </span>
              </font>
              <br/>
              <font face="Tahoma" size="4">Te enviaremos otro email confirmando lo anterior.</font><br/>
            </td>
        </tr>
      </table>

      <!-- ACCESOS -->
      <br>
      ${accessBlock}

      <!-- BOTON CAMPUS -->
      <table align="center" style="width: 100%; max-width: 450px;">
        <tr>
              <td align="center" style="padding: 5px 0 10px 0;">
                  <a href="https://we-educacion.com/web/login" target="_blank">
                      <img src="https://lh3.googleusercontent.com/d/14Ue_o6uQiobvl43mNa9zwcybGOfPB0E8"
                            alt="Ingresar al Campus Virtual"
                            width="350" style="display: block; width: 100%; max-width: 350px; height: auto; border-radius: 50px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); margin: 0 auto;">
                  </a>
              </td>
        </tr>
      </table>

      <!-- VIDEO -->
      <table align="center" style="width:500px">
        <tr>
            <td>
                <a href="https://www.youtube.com/watch?v=LgP2fc6ttgg" target="_blank">
                    <img src="https://lh3.googleusercontent.com/d/1dQnzpVcHtkt4ftvGIVfw9ilHTcx0CT1R"
                         alt="Ver en YouTube"
                         style="max-width:500px; width:100%; display:block;"
                         class="CToWUd">
                </a>
            </td>
        </tr>
      </table>
      <br>

      <!-- TABLA CRONOGRAMA -->
      ${installmentsHTML}

      <br>
      <!-- RECUERDA -->
      <table align="center" style="width:450px">
        <tr style="text-align:center"><td><font face="Tahoma" size="4"><img src="https://lh3.googleusercontent.com/d/1-LNLs1MkpM-1bpsRPu-MLLgqnyJdmqcd" width="22" height="22" style="vertical-align: middle; margin-right: 5px; display: inline-block;"><strong>RECUERDA:</strong></font></td></tr>
        <tr><td>
          <ol type="1">
            <font face="Tahoma" size="4">
              <li>Inscripciones el mismo d\u00eda del inicio: se enviar\u00e1 <br>el <strong>enlace Teams por WhatsApp.</strong></li>
              <br>
              <li>Podr\u00e1s <strong> reprogramar tu curso hasta 72 horas</strong> antes del inicio y evitar gastos administrativos.</li>
              <br>
            </font>
          </ol>
        </td></tr>

        <tr style="text-align:center">
            <td>
              <font face="Tahoma" size="4"><strong>\u00bfNecesitas ayuda?</strong>
              <br/>
              <font face="Tahoma" size="4">Comun\u00edcate al WhatsApp  <a href="https://wa.me/51922744702" style="color: #0056b3; text-decoration: underline;">+51 922744702</a> </font>
            </td>
        </tr>
        <tr style="text-align:center">
            <td>
              <font face="Tahoma" size="4"> <a href="https://we-educacion.com/terminos-condiciones" style="color:rgb(17,85,204); text-decoration: underline;" target="_blank"><br><br>T\u00e9rminos y Condiciones</a> </font>
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

  </footer>

</body>
</html>`
}
