// src/services/comercial.service.js
import {pool} from '../plugins/db.js'
import { callProcedureReturningRows } from '../plugins/spHelper.js'

export async function getCatalog() {
  const rows = await callProcedureReturningRows(pool, 'public.sp_catalog_list', []);
  const json = rows?.[0]?.result ?? {};
  return json
}
export async function getMembershipList({ active, q, page, size }) {
  // Mapeamos los parámetros en el orden exacto del SP:
  // IN p_active boolean, IN p_q text, IN p_page int, IN p_size int
  const params = [
    active ?? null, // Si es undefined, enviamos null
    q || null,      // Si es string vacío o undefined, null
    page || 1,      // Default página 1
    size || 25      // Default 25 registros
  ];

  // Llamada al SP
  const rows = await callProcedureReturningRows(pool, 'public.sp_membership_list', params);
  
  // Como este SP devuelve una lista paginada (filas), devolvemos el array directamente.
  // Si tu helper devuelve un objeto complejo, ajusta a "return rows.rows" según tu configuración.
  return rows || [];
}