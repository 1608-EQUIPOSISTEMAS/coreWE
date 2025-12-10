// src/services/auth.service.js
import { pool } from '../plugins/db.js'

/**
 * LOGIN
 * Verifica usuario y contraseña contra la BD
 */
async function login({ username, password }) {
  try {
    console.log('Intentando login para:', username)
    
    // Llamamos al SP pasando alias (username) y password
    const result = await pool.query(
      'SELECT * FROM public.sp_auth_login($1, $2)',
      [username, password]
    )
    
    console.log('Resultado de la query:', result.rows)
    
    // El resultado está en result.rows, no en result directamente
    const user = result.rows[0] || null
    
    if (!user) {
      throw new Error('Credenciales inválidas')
    }
    
    // Aquí retornamos la data del usuario
    return {
      user: {
        user_id: user.user_id,
        person_id: user.person_id,
        alias: user.alias,
        email: user.email,
        rol_id: user.rol_id,
        full_name: user.full_name
      }
    }
  } catch (error) {
    console.error('Error en login service:', error)
    throw new Error('Error al autenticar: ' + error.message)
  }
}

/**
 * userList
 * Obtiene la lista de usuarios desde la base de datos.
 */
async function userList() {
  try {
    const result = await pool.query('SELECT * FROM public.sp_user_list()');
    console.log(result)
    return result.rows;
  } catch (error) {
    console.error('Error en userList service:', error);
    throw new Error('Error al obtener la lista de usuarios: ' + error.message);
  }
}

export default {
  login,
  userList
  
}