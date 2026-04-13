function capitalizeName (name) {
  if (!name) return ''
  return name.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase())
}

export function buildActivacionHTML (data) {
  const { studentName } = data
  const nombre = capitalizeName(studentName)

  return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Bienvenida WE Educaci\u00f3n</title>
    <style>
        /* --- FUENTES: Forzamos Tahoma --- */
        body, table, td, a, p, h1, h2, h3, span, div {
            font-family: tahoma !important;
        }

        /* Estilos generales */
        body, table, td, a { -webkit-text-size-adjust: none; -ms-text-size-adjust: none; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; display: block; }
        table { border-collapse: collapse !important; }
        body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; }
    </style>
</head>
<body style="margin: 0; padding: 0;">
  <br>
  <br>

    <table style="padding-top:20px!important" border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td align="center" style="padding: 20px 0;">

                <table border="0" cellpadding="0" cellspacing="0" width="750" style="width: 750px; min-width: 750px; margin: 0 auto;">

                    <tr>
                        <td align="center" style="padding: 0;">
                            <img src="https://lh3.googleusercontent.com/d/1f1nXEKYzv-Gk9P-G_3KWNthW9fXJk-AY"
                                 alt="Bienvenida"
                                 width="630"
                                 style="width: 630px; height: auto; display: block;">
                        </td>
                    </tr>

                    <tr>
                        <td align="center" style="padding: 10px 40px;">
                            <h1 style="margin: 0 0 10px 0; font-size: 24px; font-weight: bold; text-align: center; line-height: 1.3;">
                                \u00a1Hola ${nombre}</strong>!<img src="https://lh3.googleusercontent.com/d/1LnJWJM5g2ougTJU7Uh9B4wGXypLaDkXy" width="30" height="30" style="vertical-align: middle; margin-left: 5px; display: inline-block;">
                            </h1>
                            <p style="margin: 0 0 15px 0; font-size: 13px; text-align: center;">
                                Queremos contarte una muy buena noticia <img src="https://lh3.googleusercontent.com/d/1gwIbBwTqW90DmLC1yrjbMF30FnxLBzJt" width="17" height="17" style="vertical-align: middle; margin-left: 5px; display: inline-block;">
                            </p>
                            <p style="margin: 0; font-size: 13px; line-height: 1.5; text-align: center;font-family: sans-serif!important;">
                                <img src="https://lh3.googleusercontent.com/d/1QxDHktAEi54K1tgDx0N2l1hE3Hg_O7jG" width="17" height="17" style="vertical-align: middle; margin-right: 5px; display: inline-block;"> Tus cursos online gratuitos y materiales acad\u00e9micos ya est\u00e1n <strong>ACTIVOS</strong> <br/> en el <strong>Campus Virtual de W|E Educaci\u00f3n Ejecutiva</strong>.
                            </p>
                            <br>
                            <p style="margin: 0; font-size: 13px; text-align: center; line-height: 1.5;font-family: sans-serif!important;">
                                Esto significa que <strong>puedes empezar a aprender desde hoy</strong>, incluso antes del inicio de tu programa en vivo.
                            </p>
                        </td>
                    </tr>

                    <tr>
                        <td align="center" style="padding: 0;">
                             <img src="https://lh3.googleusercontent.com/d/1vF0bYYcxSVsZHUFlSo5_TwleCvHvwQl9"
                                 alt="Comunidad WE"
                                 width="630"
                                 style="width: 630px; height: auto; display: block;">
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 15px 40px; text-align: center;">

                            <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 25px;">
                                <tr>
                                    <td align="center" style="text-align: center;">
                                        <img src="https://lh3.googleusercontent.com/d/1Mj2GpJx4fluFRSVy56XYvE48xSMxhoNn" width="30" height="30" style="vertical-align: middle; margin-right: 5px; display: inline-block;">
                                        <p style="margin: 0; font-size: 14px; font-style: italic; display: inline; text-align: center; line-height: 1.4;font-family: sans-serif!important;">
                                            Estos contenidos est\u00e1n pensados para que empieces con ventaja desde el primer d\u00eda.
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <hr align="center" style="width: 50%; border: 0; border-top: 1px solid #cccccc; margin: 20px auto;">

                            <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="text-align: center;">
                                        <img src="https://lh3.googleusercontent.com/d/1xh8OOUV535yhNLrk5UTLNnslAjCn-wUL" width="20" height="20" style="vertical-align: middle; margin-right: 5px; display: inline-block;">
                                        <span style="margin: 0; font-size: 18px; display: inline; text-align: center;">Revisa el tutorial de tu <b>campus virtual</b></span>
                                    </td>
                                </tr>
                            </table>

                            <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="padding: 5px 0 20px 0;">
                                        <a href="https://www.youtube.com/watch?v=LgP2fc6ttgg" target="_blank">
                                            <img src="https://lh3.googleusercontent.com/d/1DvwmFheWSvGLx_nyncB1dDn_n5MtwgB7"
                                                 alt="Videotutorial Campus"
                                                 width="350" style="display: block; width: 350px; height: auto; border-radius: 50px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); margin: 0 auto;">
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <hr align="center" style="width: 50%; border: 0; border-top: 1px solid #cccccc; margin: 5px auto 11px auto;">

                            <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="text-align: center;">
                                        <img src="https://lh3.googleusercontent.com/d/1xh8OOUV535yhNLrk5UTLNnslAjCn-wUL" width="20" height="20" style="vertical-align: middle; margin-right: 5px; display: inline-block;">
                                        <span style="margin: 0; font-size: 18px; display: inline; text-align: center; line-height: 1.3;">Visualiza el <b>tutorial de Teams</b></span>
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="padding-top: 5px; text-align: center;">
                                        <p style="margin: 0; font-size: 14px; text-align: center;">
                                            Para que puedas ingresar correctamente a tus <b>clases En Vivo</b>
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="padding: 5px 0 10px 0;">
                                        <a href="https://bit.ly/3MbsJzk" target="_blank">
                                            <img src="https://lh3.googleusercontent.com/d/19JunDMxEaxzsA78IdfbPFHCWzRw-Da0W"
                                                 alt="Videotutorial Campus"
                                                 width="350" style="display: block; width: 350px; height: auto; border-radius: 50px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); margin: 0 auto;">
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <hr align="center" style="width: 50%; border: 0; border-top: 1px solid #cccccc; margin: 20px auto;">

                            <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 15px;">
                                <tr>
                                    <td align="center" style="text-align: center;">
                                        <img src="https://lh3.googleusercontent.com/d/1xh8OOUV535yhNLrk5UTLNnslAjCn-wUL" width="20" height="20" style="vertical-align: middle; margin-right: 5px; display: inline-block;">
                                        <span style="margin: 0; font-size: 18px; display: inline; text-align: center; line-height: 1.3;">\u00bfC\u00f3mo acceder al <b>Campus Virtual W|E?</b></span>
                                    </td>
                                </tr>
                            </table>

                            <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td align="center" style="text-align: center;">
                                        <img src="https://lh3.googleusercontent.com/d/1YfdR-G7TIGRi2OlugmHifuiaMulx6pJD" width="17" height="17" style="vertical-align: middle; margin-right: 5px; display: inline-block;">
                                        <p style="margin: 0; font-size: 13px; line-height: 1.5; display: inline; text-align: center;">
                                            Recuerda podr\u00e1s ingresar a tu <a href="https://intranet.we-educacion.com/" style="color: #0056b3;font-style: italic; text-decoration: underline;">campus virtual</a> con tu usuario y contrase\u00f1a, que fue enviado con el correo
                                            <br>
                                            <strong>(Asunto:</strong> Confirmaci\u00f3n de inscripci\u00f3n)
                                        </p>
                                    </td>
                                </tr>
                            </table>

                        </td>
                    </tr>

                    <tr>
                        <td align="center" style="padding: 0 40px 30px 40px; text-align: center;">
                            <hr align="center" style="width: 50%; border: 0; border-top: 1px solid #cccccc; margin: 20px auto;">

                            <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto 15px auto;">
                                <tr>
                                    <td align="center" style="text-align: center;">
                                        <img src="https://lh3.googleusercontent.com/d/1CE-HZycVc0gjD-LdKzN-LrS4_1rVE4ah" width="20" height="20" style="vertical-align: middle; margin-right: 5px; display: inline-block;">
                                        <h2 style="margin: 0; font-size: 20px; font-weight: bold; display: inline; text-align: center;">Importante:</h2>
                                    </td>
                                </tr>
                            </table>

                            <p style="margin: 0; font-size: 13px; text-align: center; line-height: 1.5;">
                                Los materiales oficiales del curso y los accesos a las sesiones en vivo<br>
                                se habilitar\u00e1n <strong>48 horas antes</strong> del inicio de tu programa.
                            </p>
                        </td>
                    </tr>

                    <tr>
                        <td align="center" style="padding: 0 40px 40px 40px; text-align: center;">
                            <p style="margin: 0 0 20px 0; font-size: 14px; text-align: center;font-family: sans-serif!important;">
                                Si presentas alg\u00fan inconveniente con tu campus virtual <a href="https://wa.me/51922744702" style="color: #0056b3; text-decoration: underline;">Contactanos</a>
                            </p>

                            <p style="margin: 0 0 5px 0; font-size: 15px; text-align: center;font-family: sans-serif!important;">
                                Nos alegra mucho acompa\u00f1arte en este nuevo paso de tu desarrollo profesional
                                <img src="https://lh3.googleusercontent.com/d/14W4lp6B67xKH5y0poJb5yCHoZhpjGnSp" width="17" height="17" style="vertical-align: middle; margin-right: 5px; display: inline-block;">
                            </p>

                            <p style="margin: 0; font-size: 12px; font-weight: bold; text-align: center;font-family: sans-serif!important;">
                                Tu experiencia W|E ya comenz\u00f3.
                            </p>
                        </td>
                    </tr>
                </table>
                </td>
        </tr>
    </table>

  <table align="left" border="0" cellpadding="0" cellspacing="0" width="700" style="width: 700px; min-width: 700px; margin: 0;">

    <tr>
      <td style="padding: 15px 40px;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td valign="top" width="110" style="width: 110px; padding-right: 10px;">
              <img  src="https://lh3.googleusercontent.com/d/1-hZSt2THqu5WI_Vd5NMHVaiAljiLg0Xe"
                    alt="WE Educaci\u00f3n"
                    width="110"
                    height="110"
                    style="display: block; border: 0;">
            </td>

            <td valign="top" style="line-height: 1.4; font-family: tahoma!important;">
              <p style="margin: 0 0 2px 0; font-size: 15px; color: #000000; font-weight: bold;">
                Gianella Castellanos
              </p>
              <p style="margin: 0 0 2px 0; font-size: 13px; color: #333333;">
                Coordinaci\u00f3n Acad\u00e9mica
              </p>
              <p style="margin: 0 0 2px 0; font-size: 13px; color: #333333; font-weight: bold;">
                +51 922 744 702
              </p>
              <p style="margin: 0 0 2px 0; font-size: 13px; color: #333333;">
              Revisa TC y Pol\u00edticas de privacidad y tratamiento de datos
              </p>
              <p style="margin: 0 0 2px 0; font-size: 13px;">
                <a href="http://www.we-educacion.com/" target="_blank" style="color: #1155cc; text-decoration: underline;">
                  www.we-educacion.com
                </a>
              </p>
              <p style="margin: 0 0 6px 0; font-size: 10px; color: #1155cc;">
                Av. Rep. de Panam\u00e1 3418-Piso 2 / San Isidro
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding: 10px 40px 15px 40px;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td align="left">
              <img src="https://lh3.googleusercontent.com/d/1oEbOYXIaf_ckV_iQobLmCINBYFp2fwP5"
                   alt="Empresas que conf\u00edan en nosotros"
                   style="max-width: 60%; height: auto; display: block;">
            </td>
          </tr>
        </table>
      </td>
    </tr>

  </table>

</body>
</html>`
}
