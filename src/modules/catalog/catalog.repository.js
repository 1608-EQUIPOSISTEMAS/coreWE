import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../shared/db/sp.js'

// Persistencia del dominio catalog. Envuelve los stored procedures
// sp_catalog_list y sp_membership_list.
export class CatalogRepository {
  constructor (db = pool, sp = callProcedureReturningRows) {
    this.db = db
    this.sp = sp
  }

  async catalogList () {
    return this.sp(this.db, 'public.sp_catalog_list', [])
  }

  async membershipList (params) {
    return this.sp(this.db, 'public.sp_membership_list', params)
  }
}

export const catalogRepository = new CatalogRepository()
