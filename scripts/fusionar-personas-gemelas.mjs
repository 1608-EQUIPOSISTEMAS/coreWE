// Fusiona las personas gemelas que dejó el lookup "solo por documento":
// misma clave (correo + 1er apellido + 1er nombre) y a lo más UN documento
// real entre ellas. La superviviente es la que tiene documento (o la más
// antigua); las demás quedan active='N' con sus datos repuntados.
//
//   node scripts/fusionar-personas-gemelas.mjs          -> simulacion
//   node scripts/fusionar-personas-gemelas.mjs --aplicar
//
// Idempotente: al terminar no quedan grupos, correrlo de nuevo no hace nada.
import { pool } from './db.mjs'

const APLICAR = process.argv.includes('--aplicar')
const SOLO_MEMBRESIA = process.argv.includes('--solo-membresia')
const USER_ID = 9 // ADMIN

const KEY_APE = `split_part(public.fn_txt_key(per.last_name), ' ', 1)`
const KEY_NOM = `split_part(public.fn_txt_key(per.first_name), ' ', 1)`

const c = await pool.connect()
try {
  const { rows: grupos } = await c.query(`
    WITH p AS (
      SELECT per.person_id, per.document_number, per.cat_type_document,
             per.registration_date,
             lower(TRIM(pc.value)) AS email, ${KEY_APE} AS ape1, ${KEY_NOM} AS nom1
        FROM public.persons per
        JOIN public.person_contacts pc ON pc.person_id = per.person_id AND pc.active = 'Y'
        JOIN public."catalog" cc ON cc.catalog_id = pc.cat_way_contact
                                AND cc.alias = 'we_way_contact_email'
       WHERE per.active = 'Y' AND NULLIF(TRIM(pc.value), '') IS NOT NULL
    ), g AS (
      SELECT email, ape1, nom1,
             array_agg(DISTINCT person_id ORDER BY person_id) AS ids,
             COUNT(DISTINCT public.fn_doc_key(document_number))
               FILTER (WHERE document_number IS NOT NULL)::int AS docs
        FROM p GROUP BY 1, 2, 3
    )
    SELECT g.email, g.ape1, g.nom1, g.ids
      FROM g
     WHERE array_length(g.ids, 1) > 1 AND g.docs <= 1
       -- nunca fusionar a alguien que es usuario del sistema o instructor
       AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.person_id = ANY(g.ids))
       AND NOT EXISTS (SELECT 1 FROM public.instructors i WHERE i.person_id = ANY(g.ids))
       ${SOLO_MEMBRESIA ? `AND EXISTS (
         SELECT 1 FROM public.enrollments em
           JOIN public.customers cm ON cm.customer_id = em.customer_id
           JOIN public.program_versions pvm ON pvm.program_version_id = em.program_version_id
           JOIN public.programs pm ON pm.program_id = pvm.program_id AND pm.is_membership = true
          WHERE cm.person_id = ANY(g.ids) AND em.active = 'Y')` : ''}
     ORDER BY g.email
  `)

  console.log(`grupos a fusionar: ${grupos.length}  (modo: ${APLICAR ? 'APLICAR' : 'simulacion'})`)
  let personasFusionadas = 0

  for (const g of grupos) {
    // superviviente: la que tiene documento; si ninguna, la mas antigua.
    const { rows: cand } = await c.query(`
      SELECT person_id, document_number, cat_type_document
        FROM public.persons WHERE person_id = ANY($1::int[])
       ORDER BY (document_number IS NOT NULL) DESC, person_id ASC`, [g.ids])
    const [survivor, ...losers] = cand
    console.log(`\n${g.email} [${g.ape1}, ${g.nom1}] -> sobrevive ${survivor.person_id}` +
                ` (doc ${survivor.document_number || 'SIN'}), absorbe ${losers.map(l => l.person_id).join(', ')}`)

    if (!APLICAR) { personasFusionadas += losers.length; continue }

    await c.query('BEGIN')
    try {
      for (const l of losers) {
        // documento: si el perdedor lo tenia y el superviviente no.
        await c.query(`
          UPDATE public.persons s SET document_number = l.document_number,
                 cat_type_document = l.cat_type_document,
                 modification_date = NOW(), user_modification_id = $3
            FROM public.persons l
           WHERE s.person_id = $1 AND l.person_id = $2
             AND s.document_number IS NULL AND l.document_number IS NOT NULL`,
        [survivor.person_id, l.person_id, USER_ID])

        // leads
        await c.query('UPDATE public.leads SET person_id = $1 WHERE person_id = $2',
          [survivor.person_id, l.person_id])

        // contactos: mover los que no existan ya en el superviviente, borrar el resto
        await c.query(`
          UPDATE public.person_contacts pc SET person_id = $1
           WHERE pc.person_id = $2
             AND NOT EXISTS (SELECT 1 FROM public.person_contacts x
                              WHERE x.person_id = $1
                                AND x.cat_way_contact = pc.cat_way_contact
                                AND lower(TRIM(x.value)) = lower(TRIM(pc.value)))`,
        [survivor.person_id, l.person_id])
        await c.query('DELETE FROM public.person_contacts WHERE person_id = $1', [l.person_id])

        // customers: si el superviviente ya tiene uno, se repuntan las ventas;
        // si no, se le traspasa el customer entero.
        const { rows: [sc] } = await c.query(
          'SELECT customer_id FROM public.customers WHERE person_id = $1 ORDER BY customer_id LIMIT 1',
          [survivor.person_id])
        if (sc) {
          const { rows: lcs } = await c.query(
            'SELECT customer_id FROM public.customers WHERE person_id = $1', [l.person_id])
          for (const lc of lcs) {
            await c.query('UPDATE public.enrollments SET customer_id = $1 WHERE customer_id = $2',
              [sc.customer_id, lc.customer_id])
            await c.query('UPDATE public.course_changes SET customer_id = $1 WHERE customer_id = $2',
              [sc.customer_id, lc.customer_id])
            await c.query(`UPDATE public.customers SET active = 'N', modification_date = NOW(),
                             user_modification_id = $2 WHERE customer_id = $1`, [lc.customer_id, USER_ID])
          }
        } else {
          await c.query('UPDATE public.customers SET person_id = $1 WHERE person_id = $2',
            [survivor.person_id, l.person_id])
        }

        await c.query(`UPDATE public.persons SET active = 'N', modification_date = NOW(),
                         user_modification_id = $2 WHERE person_id = $1`, [l.person_id, USER_ID])
        personasFusionadas++
      }
      await c.query('COMMIT')
      console.log('   ok')
    } catch (e) {
      await c.query('ROLLBACK')
      console.error(`   FALLO (grupo revertido): ${e.message}`)
    }
  }

  console.log(`\npersonas ${APLICAR ? 'fusionadas' : 'que se fusionarian'}: ${personasFusionadas}`)
  if (!APLICAR) console.log('vuelve a correrlo con --aplicar para ejecutarlo')
} finally {
  c.release()
  await pool.end()
}
