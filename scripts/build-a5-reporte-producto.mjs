// Genera el reporte HTML de ediciones A5 varadas a partir de
// _a5_detalle_producto.json. Se genera con script y no a mano porque son 27
// ediciones y 71 alumnos: transcribirlos seria pedir un error de dato.
//
//   node scripts/build-a5-reporte-producto.mjs <ruta-salida.html>
import { readFileSync, writeFileSync } from 'node:fs'

const datos = JSON.parse(readFileSync(new URL('./_a5_detalle_producto.json', import.meta.url), 'utf8'))
const salida = process.argv[2]
if (!salida) throw new Error('Falta la ruta de salida')

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const yaEmpezo = (iso) => new Date(iso) < new Date()

const migrables = datos.filter((e) => e.migrable)
const bloqueadas = datos.filter((e) => !e.migrable)
const suma = (lista, campo) => lista.reduce((s, e) => s + e[campo].length, 0)
const dinero = (lista) =>
  lista.reduce((s, e) => s + e.alumnos.reduce((t, a) => t + Number(a.pagado || 0), 0), 0)

const filaAlumno = (a) => `
        <tr>
          <td class="mono num">${a.enrollment_id}</td>
          <td><span class="tipo ${a.is_child ? 'tipo-hijo' : 'tipo-top'}">${a.is_child ? 'MÓDULO' : 'VENTA'}</span></td>
          <td class="nombre">${esc(a.full_name)}</td>
          <td class="mono num dni">${esc(a.document_number || '—')}</td>
          <td class="mono num monto">${Number(a.pagado) > 0 ? soles(a.pagado) : '—'}</td>
          <td class="padre">${a.parent_program_name ? esc(a.parent_program_name) + ' · ' + esc(a.parent_edition_code || '') : '—'}</td>
        </tr>`

const bloqueHijos = (e) =>
  e.hijosFuera.length === 0
    ? ''
    : `
      <div class="hijos">
        <div class="hijos-tit">Ocupando ${e.hijosFuera.length} silla${e.hijosFuera.length > 1 ? 's' : ''} en aulas que sí se dictan</div>
        <ul class="hijos-lista">
          ${e.hijosFuera
            .map((h) => `<li><span class="mono">${h.enrollment_id}</span> ${esc(h.full_name)} — <b>${esc(h.program_name || '?')} ${esc(h.global_code || '')}</b> <span class="dim">${fecha(h.inicio)}</span></li>`)
            .join('\n          ')}
        </ul>
      </div>`

const tarjeta = (e) => `
    <article class="ed ${e.migrable ? 'ed-ok' : 'ed-stop'}">
      <header class="ed-head">
        <div class="ed-id">
          <span class="cod">${esc(e.global_code)}</span>
          <span class="mono edid">#${e.edition_num_id}</span>
        </div>
        <h3 class="ed-prog">${esc(e.program_name)}</h3>
        <div class="ed-meta">
          <span>${fecha(e.inicio)} → ${fecha(e.fin)}</span>
          ${yaEmpezo(e.inicio) ? '<span class="ya">ya debía haber empezado</span>' : ''}
          <span class="cuenta">${e.alumnos.length} alumno${e.alumnos.length > 1 ? 's' : ''}</span>
        </div>
      </header>

      <div class="tabla-wrap">
        <table>
          <thead>
            <tr><th>Inscripción</th><th>Tipo</th><th>Alumno</th><th>DNI</th><th>Pagado</th><th>Cuelga de</th></tr>
          </thead>
          <tbody>${e.alumnos.map(filaAlumno).join('')}
          </tbody>
        </table>
      </div>
      ${bloqueHijos(e)}
      ${
        e.migrable
          ? `<div class="dest">
        <div class="dest-tit">Ediciones destino disponibles — elegir una</div>
        <div class="chips">${e.candidatas.map((c, i) => `<span class="chip${i === 0 ? ' chip-prox' : ''}">${esc(c.global_code)} · ${fecha(c.inicio)} <span class="mono dim">#${c.edition_num_id}</span></span>`).join('')}</div>
      </div>`
          : `<div class="sin">
        <div class="sin-tit">No existe ninguna edición futura de este programa</div>
        <p>La reprogramación exige que el destino sea del mismo programa, así que no hay a dónde mover a estos alumnos. Decisión de Producto: retiro, cambio de curso a otro programa, o abrir una edición nueva.</p>
      </div>`
      }
    </article>`

const html = `<title>Ediciones A5 Varadas</title>
<style>
  :root {
    --navy:      #002060;
    --acento:    #1c4ea8;
    --tinta:     #11172a;
    --tinta-sec: #4a5473;
    --tinta-ter: #7b849f;
    --fondo:     #f4f6fa;
    --sup:       #ffffff;
    --linea:     #dde2ed;
    --ambar:     #8a5000;
    --ambar-bg:  #fdf4e4;
    --carmin:    #9b1c31;
    --carmin-bg: #fdeef0;
    --serif: Georgia, "Iowan Old Style", "Times New Roman", serif;
    --sans: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --navy:      #8faadc;
      --acento:    #a8c0e8;
      --tinta:     #e7eaf3;
      --tinta-sec: #a3adc6;
      --tinta-ter: #737d96;
      --fondo:     #0d1220;
      --sup:       #161d2f;
      --linea:     #2a3350;
      --ambar:     #e0aa5e;
      --ambar-bg:  #2a2113;
      --carmin:    #ef8496;
      --carmin-bg: #2d151b;
    }
  }
  :root[data-theme="dark"] {
    --navy:      #8faadc;
    --acento:    #a8c0e8;
    --tinta:     #e7eaf3;
    --tinta-sec: #a3adc6;
    --tinta-ter: #737d96;
    --fondo:     #0d1220;
    --sup:       #161d2f;
    --linea:     #2a3350;
    --ambar:     #e0aa5e;
    --ambar-bg:  #2a2113;
    --carmin:    #ef8496;
    --carmin-bg: #2d151b;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--fondo);
    color: var(--tinta);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .marco { max-width: 1080px; margin: 0 auto; padding: 56px 24px 96px; }

  .masthead { border-bottom: 3px solid var(--navy); padding-bottom: 22px; margin-bottom: 34px; }
  .eyebrow {
    font-family: var(--mono); font-size: 11px; letter-spacing: .16em;
    text-transform: uppercase; color: var(--tinta-ter); margin: 0 0 12px;
  }
  h1 {
    font-family: var(--serif); font-weight: 700; font-size: clamp(30px, 5vw, 46px);
    line-height: 1.08; letter-spacing: -.015em; margin: 0 0 14px;
    color: var(--navy); text-wrap: balance;
  }
  .bajada { margin: 0; max-width: 64ch; color: var(--tinta-sec); font-size: 16px; }

  .resumen { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-bottom: 44px; }
  .kpi { background: var(--sup); border: 1px solid var(--linea); border-radius: 4px; padding: 16px 18px; border-top: 3px solid var(--tinta-ter); }
  .kpi-ok { border-top-color: var(--ambar); }
  .kpi-stop { border-top-color: var(--carmin); }
  .kpi-n { font-family: var(--serif); font-size: 38px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
  .kpi-ok .kpi-n { color: var(--ambar); }
  .kpi-stop .kpi-n { color: var(--carmin); }
  .kpi-lbl { font-size: 13px; color: var(--tinta-sec); margin-top: 8px; }

  .seccion { margin-top: 52px; }
  .sec-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  h2 { font-family: var(--serif); font-size: 26px; font-weight: 700; margin: 0; letter-spacing: -.01em; }
  .sec-n { font-family: var(--mono); font-size: 12px; color: var(--tinta-ter); letter-spacing: .1em; }
  .sec-desc { margin: 0 0 26px; color: var(--tinta-sec); max-width: 66ch; }

  .ed { background: var(--sup); border: 1px solid var(--linea); border-left: 4px solid var(--tinta-ter); border-radius: 4px; padding: 20px 22px; margin-bottom: 16px; }
  .ed-ok { border-left-color: var(--ambar); }
  .ed-stop { border-left-color: var(--carmin); }
  .ed-head { margin-bottom: 16px; }
  .ed-id { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .cod { font-family: var(--mono); font-weight: 700; font-size: 13px; color: var(--navy); letter-spacing: .04em; }
  .edid { font-size: 12px; color: var(--tinta-ter); }
  .ed-prog { font-family: var(--serif); font-size: 19px; font-weight: 700; margin: 0 0 8px; line-height: 1.25; text-wrap: balance; }
  .ed-meta { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 13px; color: var(--tinta-sec); }
  .ya { color: var(--carmin); font-weight: 600; }
  .cuenta { color: var(--tinta-ter); }

  .tabla-wrap { overflow-x: auto; border: 1px solid var(--linea); border-radius: 3px; }
  table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
  th {
    text-align: left; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--tinta-ter); font-weight: 600; padding: 9px 12px;
    background: var(--fondo); border-bottom: 1px solid var(--linea); white-space: nowrap;
  }
  td { padding: 9px 12px; border-bottom: 1px solid var(--linea); vertical-align: middle; }
  tbody tr:last-child td { border-bottom: none; }
  .mono { font-family: var(--mono); }
  .num { font-variant-numeric: tabular-nums; }
  .dni { color: var(--tinta-sec); font-size: 12.5px; }
  .monto { font-weight: 600; white-space: nowrap; }
  .nombre { font-weight: 600; }
  .padre { color: var(--tinta-sec); font-size: 12.5px; }
  .dim { color: var(--tinta-ter); }

  .tipo { font-family: var(--mono); font-size: 10px; letter-spacing: .08em; padding: 2px 7px; border-radius: 2px; white-space: nowrap; }
  .tipo-top { background: var(--navy); color: var(--sup); }
  .tipo-hijo { background: var(--fondo); color: var(--tinta-sec); border: 1px solid var(--linea); }

  .hijos { margin-top: 14px; padding: 12px 14px; background: var(--carmin-bg); border-radius: 3px; }
  .hijos-tit { font-size: 12px; font-weight: 700; color: var(--carmin); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 7px; }
  .hijos-lista { margin: 0; padding-left: 18px; font-size: 13px; color: var(--tinta-sec); }
  .hijos-lista li { margin-bottom: 3px; }
  .hijos-lista b { color: var(--tinta); }

  .dest { margin-top: 14px; padding: 12px 14px; background: var(--ambar-bg); border-radius: 3px; }
  .dest-tit { font-size: 12px; font-weight: 700; color: var(--ambar); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 9px; }
  .chips { display: flex; flex-wrap: wrap; gap: 7px; }
  .chip { font-size: 12.5px; background: var(--sup); border: 1px solid var(--linea); border-radius: 3px; padding: 4px 9px; white-space: nowrap; }
  .chip-prox { border-color: var(--ambar); font-weight: 600; }
  .chip .mono { font-size: 11px; }

  .sin { margin-top: 14px; padding: 12px 14px; background: var(--carmin-bg); border-radius: 3px; }
  .sin-tit { font-size: 12px; font-weight: 700; color: var(--carmin); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
  .sin p { margin: 0; font-size: 13.5px; color: var(--tinta-sec); max-width: 70ch; }

  .ed-info { border-left-color: var(--acento); }
  .alerta { background: var(--carmin-bg); border: 1px solid var(--carmin); border-radius: 4px; padding: 16px 18px; margin-bottom: 18px; }
  .alerta-tit { font-family: var(--serif); font-size: 17px; font-weight: 700; color: var(--carmin); margin-bottom: 6px; }
  .alerta p { margin: 0; font-size: 14px; color: var(--tinta-sec); max-width: 72ch; }
  .alerta b { color: var(--tinta); }

  .nota { margin-top: 56px; padding-top: 22px; border-top: 1px solid var(--linea); font-size: 13.5px; color: var(--tinta-sec); }
  .nota h3 { font-family: var(--serif); font-size: 17px; margin: 0 0 10px; color: var(--tinta); }
  .nota p { max-width: 70ch; }
  .nota code { font-family: var(--mono); font-size: 12.5px; background: var(--sup); border: 1px solid var(--linea); padding: 1px 5px; border-radius: 3px; }
</style>

<div class="marco">
  <header class="masthead">
    <p class="eyebrow">System ERP · Producto · ${fecha(new Date().toISOString())}</p>
    <h1>Ediciones A5 varadas</h1>
    <p class="bajada">
      Estas ${datos.length} ediciones se cancelaron pero nadie reubicó a sus alumnos. Siguen matriculados,
      y sus módulos ocupan sillas en aulas de otros cursos que sí se dictan — inflando esos contadores
      sin que se note, porque el cronograma oculta las filas A5. Cada edición necesita una decisión.
    </p>
  </header>

  <section class="resumen">
    <div class="kpi kpi-ok">
      <div class="kpi-n">${migrables.length}</div>
      <div class="kpi-lbl">ediciones con destino posible<br><b>${suma(migrables, 'alumnos')} alumnos</b> · falta elegir edición</div>
    </div>
    <div class="kpi kpi-stop">
      <div class="kpi-n">${bloqueadas.length}</div>
      <div class="kpi-lbl">ediciones sin destino posible<br><b>${suma(bloqueadas, 'alumnos')} alumnos</b> · programa descontinuado</div>
    </div>
    <div class="kpi">
      <div class="kpi-n">${suma(datos, 'hijosFuera')}</div>
      <div class="kpi-lbl">módulos ocupando aulas ajenas<br>hoy mismo, en cursos que sí se dictan</div>
    </div>
    <div class="kpi">
      <div class="kpi-n" style="font-size:28px">${soles(dinero(datos))}</div>
      <div class="kpi-lbl">cobrado a estos alumnos<br>ninguno fue devuelto ni reubicado</div>
    </div>
  </section>

  <section class="seccion aviso-sec">
    <div class="sec-head">
      <h2>Lo anunciado hoy</h2>
      <span class="sec-n">CRONOGRAMA · 17 AGO · SALVADOR CHIRINOS</span>
    </div>
    <p class="sec-desc">
      Los dos avisos de cronograma de hoy, cruzados contra la base. El segundo son
      cancelaciones: si se ejecutan como se vienen ejecutando, suman 26 alumnos más a la lista de abajo.
    </p>

    <div class="alerta">
      <div class="alerta-tit">El arreglo del flujo A5 todavía no está desplegado</div>
      <p>
        Cancelar cualquiera de las ediciones de FINANZAS hoy repite exactamente el problema de esta
        página: la edición desaparece del cronograma y sus 26 alumnos quedan matriculados en aulas
        que ya no se dictan. Con el arreglo puesto, el sistema obliga a reubicarlos antes de dejar
        cancelar. <b>Conviene subirlo antes de tocar estas ediciones.</b>
      </p>
    </div>

    <article class="ed ed-info">
      <header class="ed-head">
        <div class="ed-id"><span class="cod">CAMBIO DE FECHA</span><span class="edid">16/08 → 23/08 · Dom 9AM–12PM · actualización interna</span></div>
        <h3 class="ed-prog">Las tres de Excel se mueven una semana</h3>
        <div class="ed-meta"><span>Sin riesgo de alumnos varados: cambia la fecha, no se cancela nada.</span></div>
      </header>
      <div class="tabla-wrap">
        <table>
          <thead><tr><th>Edición</th><th>Programa</th><th>Alumnos</th><th>Detalle</th></tr></thead>
          <tbody>
            <tr><td class="mono num">#15611 E82</td><td class="nombre">ESPECIALIZACIÓN EN MICROSOFT EXCEL</td><td class="mono num">20</td><td class="padre">20 ventas</td></tr>
            <tr><td class="mono num">#15606 E47</td><td class="nombre">ESPECIALIZACIÓN EN EXCEL EXPERT</td><td class="mono num">14</td><td class="padre">14 ventas · se mueve con sus seguimientos</td></tr>
            <tr><td class="mono num">#15607 E85</td><td class="nombre">MICROSOFT EXCEL BÁSICO</td><td class="mono num">42</td><td class="padre">8 ventas + 34 módulos de paquetes</td></tr>
          </tbody>
        </table>
      </div>
      <div class="hijos">
        <div class="hijos-tit">Ojo con el campus</div>
        <ul class="hijos-lista">
          <li>Las aulas en Odoo se llaman <b>Especialización en Microsoft Excel (16/08)</b>, <b>… Excel Expert (16/08)</b> y <b>Microsoft Excel Básico (16/08)</b> — grupos 3246, 3242 y 3227.</li>
          <li>Cambiar la fecha en el ERP <b>no las renombra</b>: los 76 alumnos van a seguir viendo 16/08 en el campus hasta que alguien las corrija a mano en Odoo.</li>
        </ul>
      </div>
      <div class="dest">
        <div class="dest-tit">Se mantienen — no requieren acción</div>
        <div class="chips"><span class="chip">EXCEL INTERMEDIO</span><span class="chip">EXCEL AVANZADO</span><span class="chip">PROGRAMACIÓN VBA MACROS</span></div>
      </div>
    </article>

    <article class="ed ed-stop">
      <header class="ed-head">
        <div class="ed-id"><span class="cod">ELIMINACIÓN</span><span class="edid">DIP y ESP FINANZAS + seguimientos</span></div>
        <h3 class="ed-prog">26 alumnos quedarían varados</h3>
        <div class="ed-meta"><span class="ya">requiere reubicar antes de cancelar</span></div>
      </header>
      <div class="tabla-wrap">
        <table>
          <thead><tr><th>Edición</th><th>Programa</th><th>Inicio</th><th>Alumnos</th><th>A dónde pueden ir</th></tr></thead>
          <tbody>
            <tr><td class="mono num">#15434 E8</td><td class="nombre">DIPLOMADO EN GESTIÓN FINANCIERA</td><td class="mono num">23 ago</td><td class="mono num"><b>5 ventas</b></td><td class="padre">E9 22/10 · E10 19/12</td></tr>
            <tr><td class="mono num">#15137 E11</td><td class="nombre">CONTABILIDAD FINANCIERA CON ERP</td><td class="mono num">11 oct</td><td class="mono num">6</td><td class="padre">E12 19/11 · E13 06/02</td></tr>
            <tr><td class="mono num">#15210 E75</td><td class="nombre">SAP S/4 HANA FI</td><td class="mono num">10 ene</td><td class="mono num">5</td><td class="padre">E72 27/08 · E74 17/09 · E80 02/01</td></tr>
            <tr><td class="mono num">#15732 E8</td><td class="nombre">COSTOS Y PRESUPUESTOS</td><td class="mono num">29 nov</td><td class="mono num">5</td><td class="padre">E17 20/08 · E18 17/12 · E19 20/03</td></tr>
            <tr><td class="mono num">#15733 E30</td><td class="nombre">GESTIÓN FINANCIERA DE PROYECTOS</td><td class="mono num">21 feb</td><td class="mono num">5</td><td class="padre">E18 19/08 · E21 26/09 · E22 15/10</td></tr>
            <tr><td class="mono num">#15444 E11</td><td class="nombre">ESP. EN FINANZAS APLICADAS</td><td class="mono num">11 oct</td><td class="mono num">0</td><td class="padre">vacía — se cancela sin problema</td></tr>
          </tbody>
        </table>
      </div>
      <div class="dest">
        <div class="dest-tit">La buena noticia: son 5 movimientos, no 6 cancelaciones</div>
        <p style="margin:0;font-size:13.5px;color:var(--tinta-sec);max-width:70ch">
          Los 20 alumnos de los cuatro seguimientos son <b>los mismos 5 compradores del DIPLOMADO</b>.
          Reprogramando esas 5 ventas, sus módulos viajan solos al árbol nuevo y las cuatro ediciones
          de seguimiento se vacían sin tocarlas. Quedan sueltos: <b>1 venta directa</b> en CONTABILIDAD
          FINANCIERA CON ERP, que necesita su propio destino.
        </p>
      </div>
      <div class="hijos">
        <div class="hijos-tit">No tocar</div>
        <ul class="hijos-lista">
          <li><span class="mono">#15100</span> <b>PLANEAMIENTO FINANCIERO E9 · 23 ago</b> — marcado "Se Mantiene" en el aviso, y tiene <b>16 alumnos vivos</b> adentro.</li>
        </ul>
      </div>
    </article>
  </section>

  <section class="seccion">
    <div class="sec-head">
      <h2>Se pueden reprogramar</h2>
      <span class="sec-n">${migrables.length} EDICIONES · ${suma(migrables, 'alumnos')} ALUMNOS</span>
    </div>
    <p class="sec-desc">
      Hay al menos una edición futura del mismo programa, así que la reprogramación es posible.
      Producto elige el destino de cada una; la primera opción de cada lista es la más próxima.
    </p>
    ${migrables.map(tarjeta).join('\n')}
  </section>

  <section class="seccion">
    <div class="sec-head">
      <h2>Sin destino posible</h2>
      <span class="sec-n">${bloqueadas.length} EDICIONES · ${suma(bloqueadas, 'alumnos')} ALUMNOS</span>
    </div>
    <p class="sec-desc">
      No queda ninguna edición futura de estos programas: dejaron de dictarse. La reprogramación
      no es una opción técnica acá, así que cada caso necesita una salida decidida por Producto.
    </p>
    ${bloqueadas.map(tarjeta).join('\n')}
  </section>

  <section class="nota">
    <h3>Cómo se llegó a esta lista</h3>
    <p>
      Cuenta como alumno vivo toda inscripción activa y aprobada por FICO que no esté retirada,
      cambiada de curso ni reprogramada — el mismo criterio con que el cronograma arma sus contadores
      de aula. Una edición se considera cancelada por <code>cat_segment = A5</code>, que es
      independiente de <code>active</code>.
    </p>
    <p>
      El flujo de cancelación del módulo de Producto ya quedó arreglado: de ahora en adelante no se
      puede marcar A5 una edición con alumnos vivos sin reubicarlos primero. Esta lista es el arrastre
      de antes de ese arreglo. Ninguna inscripción fue modificada para generar este reporte.
    </p>
  </section>
</div>
`

writeFileSync(salida, html)
console.log(`OK -> ${salida}`)
console.log(`${migrables.length} migrables (${suma(migrables, 'alumnos')} alumnos) · ${bloqueadas.length} bloqueadas (${suma(bloqueadas, 'alumnos')} alumnos)`)
