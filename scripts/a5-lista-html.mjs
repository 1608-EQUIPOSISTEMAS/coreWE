// Genera el fragmento HTML de las dos listas (con destino / sin destino) para el
// artifact "Ediciones A5 varadas". Usa las mismas reglas que
// lista-a5-alumnos-destinos.mjs; imprime a stdout.
//
// --excluir=222,333 saca inscripciones puntuales. Sirve cuando el tunel a
// produccion esta caido y hay que generar desde el clon local: se excluyen las
// que ya se resolvieron en produccion despues del ultimo refresco del clon.
import { q, pool } from './db.mjs'

const excluidas = (process.argv.find(a => a.startsWith('--excluir=')) || '')
  .replace('--excluir=', '').split(',').filter(Boolean).map(Number)

const { rows: crudas } = await q(`
  SELECT * FROM (
  SELECT v.*,
         (SELECT string_agg('#' || d.edition_num_id || ' ' || to_char(d.start_date,'DD/MM/YY'),
                            '  ·  ' ORDER BY d.start_date)
            FROM program_editions d
            LEFT JOIN catalog dseg ON dseg.catalog_id = d.cat_segment
           WHERE d.program_version_id = v.pvid AND d.edition_num_id <> v.ed_a5
             AND d.active = 'Y' AND d.start_date > CURRENT_DATE
             AND (dseg.alias IS NULL OR dseg.alias <> 'we_segment_a5')) AS destinos
    FROM (
    SELECT e.enrollment_id, e.parent_enrollment_id, pe.edition_num_id AS ed_a5,
           pe.specific_code AS cod, pe.start_date::date AS ini, pe.program_version_id AS pvid,
           p.program_name AS curso, per.document_number AS dni,
           TRIM(concat_ws(' ', per.first_name, per.last_name)) AS alumno,
           ppar.program_name AS paquete
      FROM enrollments e
      JOIN catalog cf ON cf.catalog_id = e.cat_fico_status AND cf.alias = 'we_enrollment_status_checked'
      LEFT JOIN catalog cts ON cts.catalog_id = e.cat_type_status
      JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      JOIN catalog cseg ON cseg.catalog_id = pe.cat_segment AND cseg.alias = 'we_segment_a5'
      JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
      JOIN programs p ON p.program_id = pv.program_id
      JOIN customers cu ON cu.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cu.person_id
      LEFT JOIN enrollments par ON par.enrollment_id = e.parent_enrollment_id
      LEFT JOIN program_versions ppv ON ppv.program_version_id = par.program_version_id
      LEFT JOIN programs ppar ON ppar.program_id = ppv.program_id
     WHERE e.active = 'Y'
       AND (cts.alias IS NULL OR cts.alias NOT IN ('we_enrollment_status_retired',
            'we_enrollment_status_course_changed','we_enrollment_status_reprogrammed'))) v) x
   ORDER BY x.ini, x.ed_a5, x.alumno`)

const rows = crudas.filter(r => !excluidas.includes(r.enrollment_id))

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
const fecha = d => d.toISOString().slice(8, 10) + '/' + d.toISOString().slice(5, 7) + '/' + d.toISOString().slice(2, 4)

const porEdicion = (lista) => {
  const mapa = new Map()
  for (const r of lista) {
    if (!mapa.has(r.ed_a5)) mapa.set(r.ed_a5, { ...r, alumnos: [] })
    mapa.get(r.ed_a5).alumnos.push(r)
  }
  return [...mapa.values()]
}

const filaAlumno = a => `            <tr><td class="mono num">${a.enrollment_id}</td>`
  + `<td><span class="tipo ${a.parent_enrollment_id ? 'tipo-hijo">MÓDULO' : 'tipo-top">VENTA'}</span></td>`
  + `<td class="nombre">${esc(a.alumno)}</td><td class="mono num dni">${esc(a.dni) || '—'}</td>`
  + `<td class="padre">${a.paquete ? 'cuelga de ' + esc(a.paquete) : '—'}</td></tr>`

const tarjeta = (ed, conDestino) => `
    <article class="ed ${conDestino ? 'ed-ok' : 'ed-stop'}">
      <header class="ed-head">
        <div class="ed-id"><span class="cod">${esc(ed.cod)}</span><span class="mono edid">#${ed.ed_a5}</span></div>
        <h3 class="ed-prog">${esc(ed.curso)}</h3>
        <div class="ed-meta"><span>inicio ${fecha(ed.ini)}</span><span class="cuenta">${ed.alumnos.length} alumno${ed.alumnos.length === 1 ? '' : 's'}</span></div>
      </header>
      <div class="tabla-wrap">
        <table>
          <thead><tr><th>Inscripción</th><th>Tipo</th><th>Alumno</th><th>DNI</th><th>Cuelga de</th></tr></thead>
          <tbody>
${ed.alumnos.map(filaAlumno).join('\n')}
          </tbody>
        </table>
      </div>
${conDestino
  ? `      <div class="dest">
        <div class="dest-tit">Ediciones destino disponibles — elegir una</div>
        <div class="chips">${ed.destinos.split('  ·  ').map((d, i) => `<span class="chip${i === 0 ? ' chip-prox' : ''}">${esc(d)}</span>`).join('')}</div>
      </div>`
  : `      <div class="sin">
        <div class="sin-tit">No existe ninguna edición futura de este programa</div>
        <p>La reprogramación exige que el destino sea del mismo programa. Decisión de Producto: retiro, cambio de curso a otro programa, o abrir una edición nueva.</p>
      </div>`}
    </article>`

const con = porEdicion(rows.filter(r => r.destinos))
const sin = porEdicion(rows.filter(r => !r.destinos))
const n = g => g.reduce((a, e) => a + e.alumnos.length, 0)

console.log(`  <section class="seccion">
    <div class="sec-head">
      <h2>Se pueden reprogramar</h2>
      <span class="sec-n">${con.length} EDICIONES · ${n(con)} ALUMNOS</span>
    </div>
    <p class="sec-desc">
      Hay al menos una edición futura del mismo programa, así que la reprogramación es posible.
      Producto elige el destino de cada una; la primera opción de cada lista es la más próxima.
      Reprogramar una <b>VENTA</b> arrastra sus módulos: no hay que mover cada fila por separado.
    </p>
${con.map(e => tarjeta(e, true)).join('\n')}
  </section>

  <section class="seccion">
    <div class="sec-head">
      <h2>Sin destino posible</h2>
      <span class="sec-n">${sin.length} EDICIONES · ${n(sin)} ALUMNOS</span>
    </div>
    <p class="sec-desc">
      El programa no tiene ninguna edición futura, así que el RP no aplica. Cada uno necesita una
      decisión distinta de Producto.
    </p>
${sin.map(e => tarjeta(e, false)).join('\n')}
  </section>`)
await pool.end()
