// Cablea fn_person_resolve dentro de sp_fico_enrollment_register_direct:
// reemplaza el bloque "1. Persona y customer" (lookup solo por documento +
// INSERT/UPDATE de persons) por una sola llamada. El resto del SP no cambia.
//
//   node scripts/parchar-sp-identidad.mjs            -> muestra el diff
//   node scripts/parchar-sp-identidad.mjs --aplicar
//
// Reversible: scripts/_sp_register_direct_backup_2026-08-03.sql es el original.
import fs from 'node:fs'
import { pool } from './db.mjs'

const APLICAR = process.argv.includes('--aplicar')
const BACKUP = 'scripts/_sp_register_direct_backup_2026-08-03.sql'

const VIEJO = `    -- 1. Persona y customer: lookup SOLO por documento.
    -- Sin documento = nueva persona siempre (evita fusionar identidades distintas que comparten email).
    IF v_document IS NOT NULL THEN
        SELECT person_id INTO v_person_id
        FROM public.persons
        WHERE document_number = v_document AND active = 'Y'
        LIMIT 1;
    END IF;

    IF v_person_id IS NULL THEN
        INSERT INTO public.persons (
            first_name, last_name, document_number, cat_type_document,
            active, registration_date, user_registration_id
        )
        VALUES (
            v_first_name, v_last_name, v_document, v_cat_type_document,
            'Y', NOW(), p_user_id
        )
        RETURNING person_id INTO v_person_id;
    ELSE
        UPDATE public.persons
        SET first_name           = COALESCE(v_first_name, first_name),
            last_name            = COALESCE(v_last_name, last_name),
            document_number      = COALESCE(document_number, v_document),
            cat_type_document    = COALESCE(cat_type_document, v_cat_type_document),
            modification_date    = NOW(),
            user_modification_id = p_user_id
        WHERE person_id = v_person_id;
    END IF;
`

const NUEVO = `    -- 1. Persona: REGLA UNICA DE IDENTIDAD (public.fn_person_resolve).
    -- documento normalizado > (correo + 1er apellido + 1er nombre) con candidato
    -- unico > persona nueva. El DNI no se puede exigir (la web no siempre lo da),
    -- asi que el documento que llega despues se ADOPTA sobre la persona que ya
    -- existe en vez de crear una gemela: antes cada venta sin DNI partia al
    -- alumno en dos y todo lo que se resuelve "por persona" (membresia, aula,
    -- Odoo) se rompia en silencio. Ver scripts/fn_person_resolve.sql.
    v_person_id := public.fn_person_resolve(
        v_document, v_cat_type_document, v_first_name, v_last_name, v_email, p_user_id);
`

// El SP en la BD tiene CRLF; los literales de arriba van con LF.
const original = fs.readFileSync(BACKUP, 'utf8').replace(/\r\n/g, '\n')
if (!original.includes(VIEJO)) {
  console.error('El SP no contiene el bloque esperado. Aborto (¿ya parchado o cambio?).')
  process.exit(1)
}
const parchado = original.replace(VIEJO, NUEVO)
console.log(`SP: ${original.length} -> ${parchado.length} bytes`)
console.log('\n--- bloque nuevo ---\n' + NUEVO)

if (!APLICAR) { console.log('sin --aplicar: no se desplego'); await pool.end(); process.exit(0) }

const c = await pool.connect()
try {
  await c.query(parchado)
  fs.writeFileSync('scripts/sp_fico_enrollment_register_direct.sql', parchado, 'utf8')
  const { rows: [v] } = await c.query(`
    SELECT position('fn_person_resolve' in pg_get_functiondef(p.oid)) > 0 AS cableado
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'sp_fico_enrollment_register_direct'`)
  console.log(`desplegado. fn_person_resolve cableado en el SP: ${v.cableado}`)
  console.log('canonico -> scripts/sp_fico_enrollment_register_direct.sql')
} finally {
  c.release()
  await pool.end()
}
