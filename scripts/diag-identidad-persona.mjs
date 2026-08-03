// ¿Se puede identificar a la persona por (correo + apellidos) cuando no hay DNI?
// El SP hoy no fusiona por correo porque "familiares comparten email". Esto mide
// si ese caso existe de verdad y cuánto costaría la regla rígida.
import { q, pool } from './db.mjs'

const show = (t, rows) => { console.log(`\n=== ${t} (${rows.length}) ===`); if (rows.length) console.table(rows) }

// normalizacion: sin tildes, sin espacios dobles, mayusculas
const NORM = `UPPER(TRIM(REGEXP_REPLACE(TRANSLATE($COL, 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'), '\\s+', ' ', 'g')))`
const norm = col => NORM.replace('$COL', col)

try {
  const { rows: familias } = await q(`
    WITH p AS (
      SELECT per.person_id, lower(TRIM(pc.value)) AS email,
             ${norm('per.last_name')} AS apellidos,
             ${norm('per.first_name')} AS nombres,
             per.document_number AS doc
        FROM public.person_contacts pc
        JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
        JOIN public.persons per ON per.person_id = pc.person_id AND per.active = 'Y'
       WHERE pc.active = 'Y' AND NULLIF(TRIM(pc.value), '') IS NOT NULL
    ), g AS (
      SELECT email, COUNT(DISTINCT person_id)::int AS personas,
             COUNT(DISTINCT apellidos)::int AS apellidos_distintos,
             COUNT(DISTINCT apellidos || '|' || nombres)::int AS nombres_distintos,
             COUNT(DISTINCT doc) FILTER (WHERE doc IS NOT NULL)::int AS docs_distintos
        FROM p GROUP BY email HAVING COUNT(DISTINCT person_id) > 1
    )
    SELECT COUNT(*)::int                                              AS correos_con_varias_personas,
           COUNT(*) FILTER (WHERE nombres_distintos = 1)::int         AS mismo_nombre_completo,
           COUNT(*) FILTER (WHERE apellidos_distintos = 1
                              AND nombres_distintos > 1)::int         AS mismo_apellido_otro_nombre,
           COUNT(*) FILTER (WHERE apellidos_distintos > 1)::int       AS apellidos_distintos_familia,
           COUNT(*) FILTER (WHERE docs_distintos > 1)::int            AS con_dos_dni_reales
      FROM g
  `)
  show('Correos compartidos: ¿duplicado o familia?', familias)

  const { rows: ejemplos } = await q(`
    WITH p AS (
      SELECT per.person_id, lower(TRIM(pc.value)) AS email,
             ${norm('per.last_name')} AS apellidos, ${norm('per.first_name')} AS nombres
        FROM public.person_contacts pc
        JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
        JOIN public.persons per ON per.person_id = pc.person_id AND per.active = 'Y'
       WHERE pc.active = 'Y'
    )
    SELECT email, string_agg(DISTINCT apellidos || ', ' || nombres, ' | ') AS personas
      FROM p GROUP BY email
    HAVING COUNT(DISTINCT person_id) > 1 AND COUNT(DISTINCT apellidos) > 1
     ORDER BY 1 LIMIT 12
  `)
  show('Correos con APELLIDOS distintos (las familias reales)', ejemplos)

  // ¿La regla (correo + apellidos) habria evitado los gemelos actuales?
  const { rows: cobertura } = await q(`
    WITH p AS (
      SELECT per.person_id, lower(TRIM(pc.value)) AS email, ${norm('per.last_name')} AS apellidos,
             per.document_number AS doc
        FROM public.person_contacts pc
        JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
        JOIN public.persons per ON per.person_id = pc.person_id AND per.active = 'Y'
       WHERE pc.active = 'Y'
    )
    SELECT COUNT(*)::int AS grupos_fusionables,
           SUM(personas - 1)::int AS personas_que_no_debieron_existir
      FROM (SELECT email, apellidos, COUNT(DISTINCT person_id)::int AS personas,
                   COUNT(DISTINCT doc) FILTER (WHERE doc IS NOT NULL)::int AS docs
              FROM p GROUP BY email, apellidos) x
     WHERE personas > 1 AND docs <= 1
  `)
  show('Gemelos que la regla (correo+apellidos) habria evitado', cobertura)

  // Identidad imposible: ni doc ni correo.
  const { rows: sinNada } = await q(`
    SELECT COUNT(*)::int AS personas_sin_doc_ni_correo
      FROM public.persons per
     WHERE per.active = 'Y' AND per.document_number IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.person_contacts pc
                        JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact
                                               AND c.alias = 'we_way_contact_email'
                       WHERE pc.person_id = per.person_id AND pc.active = 'Y'
                         AND NULLIF(TRIM(pc.value), '') IS NOT NULL)
  `)
  show('Sin documento NI correo (identidad imposible)', sinNada)

  // DNI duplicado por tipeo/ceros: el otro lado de la misma moneda.
  const { rows: docsRaros } = await q(`
    SELECT LTRIM(document_number, '0') AS doc_normalizado,
           string_agg(person_id::text || ':' || document_number, ' | ') AS personas
      FROM public.persons
     WHERE active = 'Y' AND document_number IS NOT NULL
     GROUP BY 1 HAVING COUNT(*) > 1
     ORDER BY 1 LIMIT 10
  `)
  show('Mismo DNI con ceros a la izquierda distintos', docsRaros)
} finally {
  await pool.end()
}
