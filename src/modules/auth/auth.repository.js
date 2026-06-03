import { pool } from '../../shared/db/pool.js'
import { callProcedureReturningRows } from '../../shared/db/sp.js'

// Persistencia del dominio auth. Envuelve los stored procedures sp_auth_login,
// sp_user_list y sp_user_list_by_role.
export class AuthRepository {
  constructor (db = pool, sp = callProcedureReturningRows) {
    this.db = db
    this.sp = sp
  }

  async login (username, password) {
    const rows = await this.sp(this.db, 'public.sp_auth_login', [username, password])
    return rows?.[0]?.result
  }

  async userList () {
    const rows = await this.sp(this.db, 'public.sp_user_list', [])
    return rows
  }

  async userListByRole (roleAlias) {
    const rows = await this.sp(this.db, 'public.sp_user_list_by_role', [roleAlias])
    return rows
  }
}

export const authRepository = new AuthRepository()
