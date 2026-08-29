function capitalizeName (name) {
  if (!name) return ''
  return name.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase())
}

function formatCurrency (amount, symbol) {
  return `${symbol || 'S/.'} ${Math.trunc(Number(amount || 0))}`
}

function calcFecha (dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${dd}/${mm}/${yyyy}`
}

// Firma del area de Finanzas. Unica para las dos ramas del correo (cuota
// pagada y pago completado): estaban duplicadas y la de pago completado quedo
// con la encargada anterior hasta 08/2026.
function firmaFinanzas () {
  return `    <table><tr><td rowspan="5" style="padding-right:10px"><img src="https://ci3.googleusercontent.com/mail-sig/AIorK4zCXJR1jwmEHVcU8GNE_r7fng1f3_VzVw1uOP18czCf2df7R8l1PVG6tGVM27KRHMTnIpVPd1c" width="96px" height="96px"></td><td>
    <table style="line-height:14px"><tr><td>Raul Rivera</td></tr>
        <tr><td>Encargado de Finanzas</td></tr>
        <tr><td><b>+51 943 882 766</b></td></tr>
        <tr><td><a href="https://we-educacion.com/politicas-privacidadwe" target="_blank" style="color:rgb(17,85,204)">Revisa TC y Pol\u00edticas de privacidad y tratamiento de datos</a></td></tr>
        <tr><td style="color:rgb(17,85,204)">Av. Rep. de Panam\u00e1 3418-Piso 2 / San Isidro</td></tr></table>
</td></tr></table>
<table><tr><td><img width="450" src="https://ci3.googleusercontent.com/mail-sig/AIorK4w-9ncNp5__1uLTZl_JQGHDDN7VKBtIZMx5wsKgHZri8lvyhzNGSFc5oHSLGGGQZAijQlaMtCs"></td></tr></table>`
}

export function buildConfirmacionPagoHTML (data) {
  const {
    studentName,
    programType,
    isLastPayment,
    lastPaymentDate,
    nextPaymentDate,
    nextPaymentAmount,
    currencySymbol
  } = data

  const nombre = capitalizeName(studentName)
  const cat = programType || 'curso'

  if (isLastPayment) {
    return `<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
  </head>
  <body>
    <div style="display:grid; place-items:center">
        <div style="display: grid; place-items: center;">
          <table align="center" style="width:450px">
            <tr><td>
              <img src="https://lh3.googleusercontent.com/d/1mAEZ2CDNi7BEG_-iTK8OIyMWP2d6uoks" style="max-width: 480px">
            </td></tr>
          </table>
        </div>
        <div style="display: grid; place-items: center; justify-content: center;">
          <table align="center" style="width:450px">
            <tr><td>
              <h2 style="font-family: Tahoma; font-style: normal; font-variant: normal;text-align:center">Hola ${nombre},</h2>
              <p style="width:450px; font-family: Tahoma,Verdana,Segoe,sans-serif;font-style: normal; font-variant: normal;text-align: center">
                <font size="3">Te saludamos reiterando nuestro compromiso en acompa\u00f1arte con la mejor calidad en educaci\u00f3n.
                  Asimismo nos alegra informarte que has terminado de cancelar el total de tu ${cat}.</font>
              </p>
            </td></tr>
          </table>
        </div>
        <table align="center" style="border-collapse: collapse; width:440px; text-align:center;padding-bottom:25px">
          <thead style="border: 2px solid black;">
            <tr style="background-color:rgb(17,1,101);color:white;"><td colspan="2" style="padding:4px">
              <font size="3">\u00daLTIMO PAGO REALIZADO</font>
            </td></tr>
            <tr style="background-color:rgb(17,1,101);color:white;">
              <td style="padding:5px;border: 2px solid black">
                <font face="Tahoma" size="3">FECHA</font>
              </td>
              <td style="padding:5px;border: 2px solid black">
                <font face="Tahoma" size="3">SITUACI\u00d3N</font>
              </td>
            </tr>
          </thead>
          <tbody style="border: 2px solid black;">
            <tr>
              <td style="padding:5px;border: 2px solid black">
                <font face="Tahoma" size="3">${calcFecha(lastPaymentDate)}</font>
              </td>
              <td style="padding:5px;border: 2px solid black;color:red">
                <font face="Tahoma" size="3">Sin deuda</font>
              </td>
            </tr>
          </tbody>
        </table>
    </div>

${firmaFinanzas()}

  </body>
</html>`
  }

  return `<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
  </head>
  <body>
    <div style="display:grid; place-items:center">
        <div style="display:grid; place-items:center">
          <table align="center" style="width:450px">
            <tr><td>
              <img src="https://lh3.googleusercontent.com/d/1TGBywF62iDCZc_GWBG8Nu5jIMvW1dJ_y" style="max-width: 480px;">
            </td></tr>
          </table>
        </div>
        <div style="display:grid; place-items:center">
          <table align="center" style="width:450px">
            <tr><td>
            <h2 style="text-align:center">Hola ${nombre}</h2>
            <p style="text-align:center; width:450px"><font face="tahoma" size="3">Te saludamos reiterando nuestro compromiso en acompa\u00f1arte con la mejor calidad en educaci\u00f3n</font></p>
            <p style="text-align:center; width:450px"><font face="tahoma" size="3">Asimismo nos alegra informarte que has cancelado la cuota de tu ${cat} </font></p>
            </td></tr>
          </table>
        </div>
        <div style="display:grid; place-items:center; justify-content: center; padding-bottom: 25px;">
          <table style="border-collapse:collapse;width: 350px; text-align:center;" align="center">
            <thead>
              <tr style="background-color:rgb(17,1,101);color:white;">
                <td colspan="2" style="padding:5px; border:1px solid black"><font face="Tahoma" size="3">Tu siguiente cuota</font></td>
              </tr>
              <tr style="background-color:rgb(17,1,101);color:white;">
                <td style="padding:5px;border:1px solid black"><font face="Tahoma" size="3">Fecha de Pago</font></td>
                  <td style="padding:5px;border:1px solid black"><font face="Tahoma" size="3">Monto a Pagar</font></td>
                </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding:5px;border:1px solid black"><font face="Tahoma" size="3">${calcFecha(nextPaymentDate)}</font></td>
                <td style="padding:5px;border:1px solid black"><font face="Tahoma" size="3">${formatCurrency(nextPaymentAmount, currencySymbol)}</font></td>
              </tr>
            </tbody>
          </table>
        </div>
    </div>

${firmaFinanzas()}

  </body>
</html>`
}
