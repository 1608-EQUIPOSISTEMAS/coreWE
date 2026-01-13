// src/services/auth.service.js
import { pool } from '../plugins/db.js'
import { callProcedureReturningRows } from '../plugins/spHelper.js'
/**
 * LOGIN
 * Verifica usuario y contraseña contra la BD
 */
// authService.js
export async function login({ username, password }) {
  try {
    // 1. Llamamos al SP usando tu helper
    // Pasamos los parámetros en orden (p_alias, p_password). 
    // El cursor lo maneja el helper internamente.
    const rows = await callProcedureReturningRows(pool, 'public.sp_auth_login', [username, password]);

    // 2. Extraemos el JSON (Postgres lo devuelve en la columna 'result')
    // Si no hay filas (credenciales mal), user será undefined
    const user = rows?.[0]?.result;

    if (!user) {
      throw new Error('Usuario o contraseña incorrectos');
    }

    // 3. Retornamos la estructura que espera tu controlador
    // Como el JSON ya viene armado desde SQL, solo lo envolvemos en el objeto que necesitas
    return {
      user // Contiene: { user_id, alias, roles: [...], etc }
    }

  } catch (error) {
    console.error('Error en login service:', error);
    // Es buena práctica no revelar errores de BD al cliente final en el login, 
    // pero mantenemos tu estructura de throw
    throw error; 
  }
}

export async function userList() {
  try {
    const rows = await callProcedureReturningRows(pool, 'public.sp_user_list', []);
    return rows;
  } catch (error) {
    console.error('Error in userList service:', error);
    throw error;
  }
}

export default {
  login,
  userList
  
}