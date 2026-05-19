// Fragmentos SQL reusables para resolver datos de contacto del alumno.
// Las inscripciones FICO directas no crean lead, por lo que `leads.origin_email`
// puede ser NULL: el correo y telefono pueden vivir solo en `person_contacts`.
//
// Cualquier query que necesite estos datos debe componer estos fragmentos.
// Requiere que el SELECT base tenga los alias `l` (leads) y `per` (persons).

export const STUDENT_EMAIL_SQL = `
  COALESCE(
    l.origin_email,
    (SELECT pc.value FROM person_contacts pc
       WHERE pc.person_id = per.person_id
         AND pc.cat_way_contact = (SELECT catalog_id FROM catalog WHERE alias = 'we_way_contact_email' LIMIT 1)
         AND pc.active = 'Y'
       ORDER BY pc.registration_date DESC LIMIT 1)
  )`

export const STUDENT_PHONE_SQL = `
  COALESCE(
    l.origin_phone,
    (SELECT pc.value FROM person_contacts pc
       WHERE pc.person_id = per.person_id
         AND pc.cat_way_contact = (SELECT catalog_id FROM catalog WHERE alias = 'we_way_contact_phone' LIMIT 1)
         AND pc.active = 'Y'
       ORDER BY pc.registration_date DESC LIMIT 1)
  )`
