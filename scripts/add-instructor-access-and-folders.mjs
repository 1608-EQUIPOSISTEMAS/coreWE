// Docentes: usuarios de Odoo / Teams y carpetas de clase (lista variable).
//
// - instructors.odoo_username / teams_username: dos columnas de texto.
// - instructor_class_folders: tabla hija, misma forma que
//   instructor_financial_attachments (lista de URLs con reemplazo completo).
//
// Los SPs no estan versionados en el repo: se parchean por anclas sobre
// pg_get_functiondef. Respaldo previo en scripts/sp-backup-<nombre>.sql.
// Idempotente: si el SP ya menciona class_folders, no se toca.
//
// sp_instructor_register queda fuera a proposito: estos campos son de la ficha
// del docente ya creado, igual que el CV y los financials (v-if="isEdit").
import { q, pool } from './db.mjs'

const ESQUEMA = `
  ALTER TABLE public.instructors
    ADD COLUMN IF NOT EXISTS odoo_username  text,
    ADD COLUMN IF NOT EXISTS teams_username text;

  COMMENT ON COLUMN public.instructors.odoo_username IS
    'Usuario con el que el docente entra a Odoo. Es dato de contacto, NO la FK odoo_user_id.';
  COMMENT ON COLUMN public.instructors.teams_username IS
    'Usuario / correo del docente en Microsoft Teams.';

  CREATE TABLE IF NOT EXISTS public.instructor_class_folders (
    instructor_class_folder_id serial PRIMARY KEY,
    instructor_id integer NOT NULL REFERENCES public.instructors(instructor_id) ON DELETE CASCADE,
    label      text,
    folder_url text NOT NULL,
    active     character(1) NOT NULL DEFAULT 'Y',
    created_at timestamp NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS ix_instructor_class_folders_instructor
    ON public.instructor_class_folders (instructor_id);

  COMMENT ON TABLE public.instructor_class_folders IS
    'Carpetas de clase de un docente (1..N). La ficha reemplaza la lista completa en cada guardado.';
`

const BLOQUE_CARPETAS = `  -- 5. CARPETAS DE CLASE
  -- Se reemplaza la lista completa: la ficha manda las filas que quedan, asi que
  -- borrar una en pantalla tiene que borrarla aca. Mismo criterio que los
  -- attachments de financials. Si la clave no viene, no se toca nada.
  IF p_instructor ? 'class_folders' AND jsonb_typeof(p_instructor->'class_folders') = 'array' THEN
      DELETE FROM public.instructor_class_folders WHERE instructor_id = p_instructor_id;

      INSERT INTO public.instructor_class_folders (instructor_id, label, folder_url, active)
      SELECT p_instructor_id,
             NULLIF(TRIM(cf->>'label'), ''),
             TRIM(cf->>'folder_url'),
             'Y'
        FROM jsonb_array_elements(p_instructor->'class_folders') AS cf
       WHERE COALESCE(TRIM(cf->>'folder_url'), '') <> '';
  END IF;

`

const SUBQUERY_CARPETAS = `      ) AS programs,

      -- 2b. SUBQUERY CARPETAS DE CLASE
      (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'instructor_class_folder_id', cf.instructor_class_folder_id,
              'label',      cf.label,
              'folder_url', cf.folder_url
            ) ORDER BY cf.instructor_class_folder_id ASC
          ),
          '[]'::jsonb
        )
        FROM public.instructor_class_folders cf
        WHERE cf.instructor_id = i.instructor_id
          AND cf.active = 'Y'
      ) AS class_folders,
`

// Un campo de texto se limpia mandando '': por eso CASE + NULLIF y no el
// COALESCE(NULLIF(...), i.campo) de las columnas vecinas, que nunca deja borrar.
const columna = (nombre) =>
  `    ${nombre} = CASE WHEN p_instructor ? '${nombre}' THEN NULLIF(p_instructor->>'${nombre}', '') ELSE i.${nombre} END`

const PARCHES = {
  sp_instructor_update: [
    {
      ancla: /modification_date\s*=\s*NOW\(\)\s*\n\s*WHERE i\.instructor_id = p_instructor_id;/,
      nuevo: `${columna('odoo_username')},\n${columna('teams_username')},\n    modification_date    = NOW()\n  WHERE i.instructor_id = p_instructor_id;`
    },
    { ancla: /^\s*-- Salida del Cursor.*$/m, nuevo: `${BLOQUE_CARPETAS}  -- Salida del Cursor` }
  ],
  sp_instructor_get: [
    { ancla: /^\s*i\.relevant_work,$/m, nuevo: '      i.relevant_work,\n      i.odoo_username,\n      i.teams_username,' },
    { ancla: /^\s*\) AS programs,$/m, nuevo: SUBQUERY_CARPETAS }
  ]
}

async function definicion (nombre) {
  const { rows } = await q(
    `SELECT pg_get_functiondef(p.oid) AS src
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [nombre]
  )
  if (rows.length !== 1) throw new Error(`${nombre}: se esperaba 1 definicion, hay ${rows.length}`)
  return rows[0].src
}

function aplicarParches (nombre, src, parches) {
  return parches.reduce((acc, { ancla, nuevo }) => {
    const veces = (acc.match(new RegExp(ancla.source, ancla.flags.replace('m', '') + 'gm')) || []).length
    if (veces !== 1) throw new Error(`${nombre}: el ancla casa ${veces} veces, se esperaba 1: ${ancla}`)
    return acc.replace(ancla, nuevo)
  }, src)
}

await q(ESQUEMA)
console.log('columnas + tabla instructor_class_folders listas')

for (const [nombre, parches] of Object.entries(PARCHES)) {
  const src = await definicion(nombre)
  if (src.includes('class_folders')) {
    console.log(`${nombre}: ya parcheado, se omite`)
    continue
  }
  await q(aplicarParches(nombre, src, parches))
  console.log(`${nombre}: parcheado`)
}

const { rows } = await q(`
  SELECT p.proname,
         (pg_get_functiondef(p.oid) LIKE '%class_folders%')  AS carpetas,
         (pg_get_functiondef(p.oid) LIKE '%odoo_username%')  AS odoo,
         (pg_get_functiondef(p.oid) LIKE '%teams_username%') AS teams
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = ANY($1)
`, [Object.keys(PARCHES)])
console.table(rows)

await pool.end()
