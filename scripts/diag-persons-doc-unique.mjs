// Por que un alta desde un lead revienta con `persons_document_number_key`.
//
// sp_comercial_enrollment_register busca la persona con
//     document_number = j_insc->>'document' AND active = 'Y'
// (literal, y solo activas) mientras el UNIQUE de la tabla es sobre la columna
// cruda y NO mira `active`. Cuando la fusion de gemelas dejo a la duplicada en
// active='N' pero con su DNI puesto, y la sobreviviente guarda el MISMO DNI con
// otro formato ('3893811' vs '03893811'), el SP no encuentra a nadie, inserta y
// choca contra la muerta. FICO no sufre esto porque pasa por fn_person_resolve,
// que compara con fn_doc_key en ambos lados.
//
// Uso:  node scripts/diag-persons-doc-unique.mjs [--prod] [lead_id]
import fs from 'node:fs';
import pg from 'pg';
import 'dotenv/config';

const prod = process.argv.includes('--prod');
const leadId = Number(process.argv.find((a) => /^\d+$/.test(a)));
const url = prod
  ? fs.readFileSync('.env.bak-produccion', 'utf8').split(/\r?\n/)
      .find((l) => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length).trim()
  : process.env.DATABASE_URL;

const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 15000 });
const q = async (s, p) => (await pool.query(s, p)).rows;

console.log('BD:', (await q('SELECT current_database() db, inet_server_port() port'))[0]);

console.log('\n== inactivas que siguen ocupando el UNIQUE de document_number ==');
console.table(await q(`
  SELECT ina.person_id AS inactiva, ina.document_number AS doc_bloqueado,
         act.person_id AS activa,   act.document_number AS doc_activa,
         act.first_name || ' ' || act.last_name AS quien
    FROM persons ina
    LEFT JOIN persons act ON act.active = 'Y'
     AND public.fn_doc_key(act.document_number) = public.fn_doc_key(ina.document_number)
   WHERE ina.active = 'N' AND COALESCE(btrim(ina.document_number), '') <> ''
   ORDER BY ina.person_id DESC`));

if (leadId) {
  console.log(`\n== lead ${leadId} ==`);
  console.table(await q(`
    SELECT l.lead_id, l.person_id, l.full_name, l.registration_date, p.document_number, p.active
      FROM leads l LEFT JOIN persons p ON p.person_id = l.person_id
     WHERE l.lead_id = $1`, [leadId]));
}
await pool.end();
