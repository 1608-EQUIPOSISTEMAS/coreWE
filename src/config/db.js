import 'dotenv/config';
import pg from 'pg';

// Ahora solo usará SSL si explícitamente se lo decimos en el .env (que en tu VPS será falso o no existirá)
const isSSL = process.env.DATABASE_SSL?.toLowerCase() === 'true'; 

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isSSL ? { rejectUnauthorized: false } : false,
  // Ajustes opcionales del pool:
  max: Number(process.env.PG_POOL_MAX ?? 20),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT ?? 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT ?? 10000),
  // TCP keepalive: sin esto, un corte de red deja sockets muertos en el pool
  // y el proceso recien se entera al usarlos (timeouts de 10s en cascada).
  keepAlive: true,
});

// Un socket idle del pool que muere (red inestable hacia el VPS) emite 'error';
// sin este handler el evento queda sin escuchar y TUMBA el proceso Node entero.
pool.on('error', (err) => {
  console.error('[pg-pool] Conexion idle perdida (se repondra sola):', err.message);
});

// Opcional: setea cosas por sesión (timezone, app name, etc.)
pool.on('connect', (client) => {
  client.query(`SET application_name = 'we-edu-app'`);
  client.query(`SET TIME ZONE 'America/Lima'`);
  // Si quieres un statement_timeout global por conexión:
  if (process.env.PG_STATEMENT_TIMEOUT_MS) {
    client.query(`SET statement_timeout = ${Number(process.env.PG_STATEMENT_TIMEOUT_MS)}`);
  }
});

/** Acceso directo tipo antes: */
export const query = (text, params) => pool.query(text, params);

/** Helper opcional para ejecutar una función dentro de una transacción. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try { 
    await client.query('BEGIN');
    const result = await fn(client);     // <-- usa este client dentro
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/** Default export para compatibilidad con tu código actual */
export default {
  pool,
  query,
  withTransaction,
};
