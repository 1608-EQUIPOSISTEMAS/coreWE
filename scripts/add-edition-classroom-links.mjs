// Agrega los links de aula FICHA y LISTA DE NOTAS a program_editions y los
// engancha en los SPs que ya mueven whatsapp_link / teams_link.
//
// Los SPs no estan versionados en el repo: se parchean por anclas exactas sobre
// pg_get_functiondef y se re-crean. El respaldo de cada uno vive en
// scripts/sp-backup-<nombre>.sql (volcado antes de tocar nada).
//
// Idempotente: si el SP ya menciona ficha_link, no se toca.
import { q, pool } from './db.mjs'

const COLUMNAS = `
  ALTER TABLE public.program_editions
    ADD COLUMN IF NOT EXISTS ficha_link  text,
    ADD COLUMN IF NOT EXISTS grades_link text;

  COMMENT ON COLUMN public.program_editions.ficha_link IS
    'Link a la ficha del curso de esa edicion. Lo edita Academica/Admin desde Producto > Cronograma.';
  COMMENT ON COLUMN public.program_editions.grades_link IS
    'Link a la lista de notas de esa edicion. Lo edita Academica/Admin desde Producto > Cronograma.';
`

// Cada parche: ancla (regex, debe casar UNA vez) -> texto que la reemplaza.
// Las anclas son cortas a proposito: la alineacion de espacios del SP guardado
// no es la del fuente original y romperia un match literal.
const arm = (columna) =>
  `    ${columna} = CASE WHEN p_edition ? '${columna}' THEN p_edition->>'${columna}' ELSE ${columna} END`

const PARCHES = {
  sp_edition_update: [
    {
      ancla: /ELSE teams_link END/,
      nuevo: `ELSE teams_link END,\n${arm('ficha_link')},\n${arm('grades_link')}`
    }
  ],
  sp_edition_by_week_list: [
    { ancla: /^\s*pe\.teams_link,$/m, nuevo: '      pe.teams_link,\n      pe.ficha_link,\n      pe.grades_link,' },
    { ancla: /^\s*er\.teams_link,$/m, nuevo: '      er.teams_link,\n      er.ficha_link,\n      er.grades_link,' },
    {
      ancla: /'teams_link',\s*f\.teams_link,/,
      nuevo:
        "'teams_link', f.teams_link,\n" +
        "                   'ficha_link', f.ficha_link,\n" +
        "                   'grades_link', f.grades_link,"
    }
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

await q(COLUMNAS)
console.log('columnas ficha_link / grades_link listas')

for (const [nombre, parches] of Object.entries(PARCHES)) {
  const src = await definicion(nombre)
  if (src.includes('ficha_link')) {
    console.log(`${nombre}: ya parcheado, se omite`)
    continue
  }
  await q(aplicarParches(nombre, src, parches))
  console.log(`${nombre}: parcheado`)
}

const { rows } = await q(`
  SELECT p.proname,
         (pg_get_functiondef(p.oid) LIKE '%ficha_link%')  AS ficha,
         (pg_get_functiondef(p.oid) LIKE '%grades_link%') AS notas
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = ANY($1)
`, [Object.keys(PARCHES)])
console.table(rows)

await pool.end()
