// src/services/comercial.service.js
import {pool} from '../plugins/db.js'
import { callProcedureReturningRows } from '../plugins/spHelper.js'

export async function getCatalog() {
  const rows = await callProcedureReturningRows(pool, 'public.sp_catalog_list', []);
  const json = rows?.[0]?.result ?? {};
  return json
}