// ¿Qué programas disparan el bloque de credenciales SAP en la confirmación de correo?
// Regla (email-confirmation.usecases.js y enrollment.repository.js -> is_sap_online):
//   programs.cat_category = we_program_category_sap  AND  cat_model_modality = we_modality_online
import { q, pool } from './db.mjs'

const { rows } = await q(`
  SELECT p.program_id, p.program_name, pv.program_version_id, pv.abbreviation,
         (p.cat_category = cat_sap.catalog_id
          AND p.cat_model_modality = mod_online.catalog_id) AS pide_credenciales_sap
  FROM public.programs p
  JOIN public.program_versions pv ON pv.program_id = p.program_id
  CROSS JOIN LATERAL (SELECT catalog_id FROM public.catalog WHERE alias = 'we_program_category_sap') cat_sap
  CROSS JOIN LATERAL (SELECT catalog_id FROM public.catalog WHERE alias = 'we_modality_online') mod_online
  WHERE p.cat_category = cat_sap.catalog_id
  ORDER BY pide_credenciales_sap DESC, pv.abbreviation`)
console.table(rows)
await pool.end()
