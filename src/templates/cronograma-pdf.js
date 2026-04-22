const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

function fmt (d) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt)) return '—'
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${dt.getUTCFullYear()}`
}

function addDays (d, n) {
  if (!d) return null
  const dt = new Date(d)
  if (isNaN(dt)) return null
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt
}

export function buildCronogramaHTML ({ program, edition, modules, currentModule, headerImage }) {
  const moduleCount = modules.length
  const rows = modules.map((m, i) => `
    <tr>
      <td class="c-mod">${ROMAN[i] || (i + 1)}</td>
      <td class="c-nom">${m.name || '—'}</td>
      <td class="c-fecha">${fmt(m.start_date)}</td>
      <td class="c-doc">${m.instructor || '—'}</td>
      <td class="c-ses">${m.sessions != null ? m.sessions : '—'}</td>
      <td class="c-dia">${m.day || '—'}</td>
      <td class="c-hora">${m.hour || '—'}</td>
      <td class="c-fecha">${fmt(m.end_date)}</td>
    </tr>
  `).join('')

  const cm = currentModule || modules.find(m => m?.start_date) || modules[0] || {}
  const iniClass = fmt(cm.start_date)
  const entParcial = fmt(addDays(cm.start_date, 7))
  const entFinal = fmt(cm.end_date)
  const finClass = fmt(cm.end_date)
  const currentIdx = modules.indexOf(cm)
  const currentNum = currentIdx >= 0 ? (ROMAN[currentIdx] || String(currentIdx + 1)) : 'I'

  const headerBlock = headerImage
    ? `<img class="brand-img" src="${headerImage}" alt="WE Educación Ejecutiva">`
    : `<div class="brand-fallback"><span class="brand-mark">W<span class="sep">|</span>E</span><span class="brand-sub">Educación Ejecutiva</span></div>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Cronograma</title>
<style>
  :root {
    --navy-900: #0a1c3c;
    --navy-700: #1a3560;
    --gold-500: #c9a03c;
    --paper:    #faf7f1;
    --zebra:    #f5f1e8;
    --border:   #d6cfc0;
    --ink:      #1a1a1a;
    --muted:    #5a5142;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  html, body {
    font-family: Tahoma, Geneva, Verdana, sans-serif;
    color: var(--ink);
    font-size: 10pt;
    line-height: 1.4;
    background: #fff;
  }

  .wrap {
    position: relative;
    padding: 3mm 10mm 6mm 10mm;
  }

  .side-accent {
    position: absolute;
    left: 0;
    top: 50px;
    bottom: 60px;
    width: 3px;
    background: var(--gold-500);
  }

  /* Header image */
  .brand-img {
    display: block;
    width: 100%;
    max-width: 540px;
    height: auto;
    margin: 4mm auto 0 auto;
  }
  .brand-fallback {
    text-align: center;
    padding: 14px 0;
    border-bottom: 2px solid var(--navy-900);
  }
  .brand-mark {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 28pt;
    font-weight: 700;
    color: var(--navy-900);
  }
  .brand-mark .sep { color: var(--gold-500); font-weight: 400; margin: 0 3px; }
  .brand-sub {
    display: block;
    font-family: Georgia, serif;
    font-size: 9pt;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: var(--muted);
    margin-top: 3px;
  }

  /* Section banner — navy sólido + línea dorada de 2px debajo */
  .banner {
    background: var(--navy-900);
    color: #fff;
    padding: 7px 14px;
    font: 700 9.5pt/1 Tahoma, sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    border-bottom: 2px solid var(--gold-500);
    margin-top: 12px;
  }

  /* Info-box (Programación del Programa) */
  .info-box {
    background: var(--paper);
    border: 1px solid var(--border);
    border-top: none;
    padding: 9px 14px;
  }
  .info-line {
    display: flex;
    padding: 3px 0;
    font-size: 9.5pt;
    align-items: baseline;
  }
  .info-label {
    font-weight: 700;
    color: var(--navy-900);
    min-width: 85px;
  }
  .info-value { color: var(--ink); }
  .program-name {
    font: italic 600 11pt/1.3 Georgia, serif;
    color: var(--ink);
  }
  .middot { color: var(--gold-500); margin: 0 6px; font-weight: 700; }

  /* Tabla cronograma */
  table.cron {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    font-size: 9pt;
  }
  table.cron th {
    background: var(--navy-900);
    color: #fff;
    padding: 7px 5px;
    font: 700 8.5pt/1 Tahoma, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border: none;
    text-align: center;
  }
  table.cron td {
    padding: 7px 5px;
    border: 1px solid var(--border);
    text-align: center;
    vertical-align: middle;
  }
  table.cron tbody tr:nth-child(even) td { background: var(--zebra); }
  .c-mod {
    width: 7%;
    font: 700 11pt/1 Georgia, serif;
    color: var(--navy-900);
  }
  .c-nom {
    width: 26%;
    text-align: left !important;
    font-weight: 600;
    padding-left: 8px !important;
    font-size: 9pt;
  }
  .c-fecha {
    width: 11%;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .c-doc {
    width: 18%;
    text-align: left !important;
    padding-left: 6px !important;
    font-size: 8.5pt;
  }
  .c-ses { width: 6%; font-weight: 600; }
  .c-dia { width: 8%; }
  .c-hora {
    width: 13%;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  /* Programación del Curso */
  .course-header {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--paper);
    border: 1px solid var(--border);
    border-bottom: none;
    padding: 8px 14px;
  }
  .course-num {
    background: var(--navy-900);
    color: #fff;
    width: 22px; height: 22px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font: 700 10pt/1 Tahoma, sans-serif;
  }
  .course-label {
    font-weight: 700;
    color: var(--navy-900);
    font-size: 9.5pt;
  }
  .course-value {
    font: italic 600 10.5pt/1.3 Georgia, serif;
    color: var(--ink);
  }

  .dates {
    border: 1px solid var(--border);
    border-top: none;
  }
  .date-row {
    display: flex;
    padding: 8px 14px;
    border-bottom: 1px dotted var(--border);
    align-items: center;
  }
  .date-row:last-child { border-bottom: none; }
  .date-row .n {
    width: 22px;
    color: var(--navy-900);
    font-weight: 700;
    font-size: 9.5pt;
  }
  .date-row-date { font-size: 9.5pt; }
  .date-row-date .lbl { flex: 1; color: var(--ink); }
  .date-row-date .val {
    font: 700 11pt/1 Tahoma, sans-serif;
    color: var(--navy-900);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    text-align: right;
  }
  .date-row-info { font-size: 9pt; background: var(--paper); }
  .date-row-info .lbl { flex: 1; color: var(--muted); font-size: 9.5pt; }
  .date-row-info .val {
    font: italic 400 8.5pt/1.35 Georgia, serif;
    color: var(--muted);
    text-align: right;
    max-width: 310px;
  }

  /* Consideraciones */
  .cons-box {
    border: 1px solid var(--border);
    border-top: none;
    background: var(--paper);
  }
  .cons-row {
    display: flex;
    padding: 8px 14px;
    gap: 11px;
    align-items: flex-start;
    border-bottom: 1px dotted var(--border);
    font-size: 9pt;
    line-height: 1.45;
  }
  .cons-row:last-child { border-bottom: none; }
  .cons-n {
    width: 20px; height: 20px;
    flex-shrink: 0;
    background: var(--navy-900);
    color: #fff;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font: 700 9pt/1 Tahoma, sans-serif;
  }
  .cons-text { color: var(--ink); flex: 1; }
  .cons-text .mail { color: var(--navy-700); font-weight: 600; }
  .cons-text a { color: var(--navy-700); text-decoration: underline; font-weight: 600; }

  /* Footer */
  .footer {
    margin-top: 13px;
    padding-top: 10px;
    border-top: 2px solid var(--navy-900);
    text-align: center;
  }
  .footer-name {
    font: 700 11pt/1 Georgia, serif;
    color: var(--navy-900);
    letter-spacing: 0.01em;
  }
  .footer-role {
    font: italic 400 9pt/1.4 Georgia, serif;
    color: var(--muted);
    margin: 3px 0 6px;
  }
  .footer-contact {
    font: 400 8.5pt/1.5 Tahoma, sans-serif;
    color: var(--muted);
  }
</style>
</head>
<body>

  ${headerBlock}

<div class="wrap">
  <div class="side-accent"></div>

  <div class="banner">Programación del Programa</div>
  <div class="info-box">
    <div class="info-line">
      <span class="info-label">Programa:</span>
      <span class="program-name">${program.name || '—'}</span>
    </div>
    <div class="info-line">
      <span class="info-label">Edición:</span>
      <span class="info-value">
        ${edition.code || '—'}
        ${edition.start_date ? `<span class="middot">·</span>Inicio ${fmt(edition.start_date)}` : ''}
        ${edition.end_date ? `<span class="middot">·</span>Fin ${fmt(edition.end_date)}` : ''}
      </span>
    </div>
    <div class="info-line">
      <span class="info-label">Módulos:</span>
      <span class="info-value">${moduleCount} módulo${moduleCount !== 1 ? 's' : ''}</span>
    </div>
  </div>

  <table class="cron">
    <thead>
      <tr>
        <th>Mod</th>
        <th>Nombre</th>
        <th>Fecha Inicio</th>
        <th>Docente</th>
        <th>Ses</th>
        <th>Día</th>
        <th>Hora</th>
        <th>Fecha Fin</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="banner">Programación del Curso</div>
  <div class="course-header">
    <span class="course-num">${currentNum}</span>
    <span class="course-label">Curso:</span>
    <span class="course-value">${cm.name || '—'}</span>
  </div>
  <div class="dates">
    <div class="date-row date-row-date"><span class="n">1</span><span class="lbl">Inicio de Clases</span><span class="val">${iniClass}</span></div>
    <div class="date-row date-row-date"><span class="n">2</span><span class="lbl">Entregable Parcial</span><span class="val">${entParcial}</span></div>
    <div class="date-row date-row-date"><span class="n">3</span><span class="lbl">Entregable Final</span><span class="val">${entFinal}</span></div>
    <div class="date-row date-row-date"><span class="n">4</span><span class="lbl">Fin de Clases</span><span class="val">${finClass}</span></div>
    <div class="date-row date-row-info"><span class="n">5</span><span class="lbl">Certificación del Curso</span><span class="val">Máx. 7 días hábiles posterior al fin de clases</span></div>
    <div class="date-row date-row-info"><span class="n">6</span><span class="lbl">Certificación del Programa</span><span class="val">Máx. 15 días hábiles posterior al fin de clases del último módulo</span></div>
  </div>

  <div class="banner">Consideraciones del Programa</div>
  <div class="cons-box">
    <div class="cons-row">
      <span class="cons-n">1</span>
      <span class="cons-text">En caso de reprogramaciones de clases o inicios, estas serán comunicadas vía correo mediante el dominio <span class="mail">alumno.we@we-educacion.com</span>, y a través del grupo de WhatsApp del aula.</span>
    </div>
    <div class="cons-row">
      <span class="cons-n">2</span>
      <span class="cons-text">En caso de certificación internacional, avalada por FGU (Florida Global University), estas tienen un plazo de emisión de hasta 30 días hábiles posterior a la certificación del programa (emitida por WE Educación Ejecutiva).</span>
    </div>
    <div class="cons-row">
      <span class="cons-n">3</span>
      <span class="cons-text">Toda entrega de documentos y comunicación formal se realiza vía correo <span class="mail">alumno.we@we-educacion.com</span>.</span>
    </div>
    <div class="cons-row">
      <span class="cons-n">4</span>
      <span class="cons-text">Ante cualquier duda o consulta comunicarse al siguiente número <strong>+51 922 744 702</strong>, o al siguiente enlace <a href="https://bit.ly/3LbMuGm">https://bit.ly/3LbMuGm</a>.</span>
    </div>
  </div>

  <div class="footer">
    <div class="footer-name">Gianella Castellanos Trujillo</div>
    <div class="footer-role">Coordinación Académica</div>
    <div class="footer-contact">+51 922 744 702 · www.we-educacion.com</div>
    <div class="footer-contact">Av. Rep. de Panamá 3418 - Piso 2, San Isidro, Lima</div>
  </div>

</div>
</body>
</html>`
}
