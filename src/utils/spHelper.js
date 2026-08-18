// spHelper.js
/**
 * Llama a un PROCEDURE que devuelve un REFCURSOR (INOUT p_cur REFCURSOR)
 * y retorna todas las filas del cursor.
 */
export async function callProcedureReturningRows(pool, procName, params = [], options = {}) {
  const externalClient = options.client ?? null;
  const client = externalClient ?? await pool.connect();
  const cursorName = `cur_${Date.now()}_${Math.floor(Math.random() * 1e6)}`.replace(/[^a-zA-Z0-9_]/g, '_');

  try {
    await client.query('BEGIN');

    if (options.statementTimeoutMs && options.statementTimeoutMs > 0) {
      await client.query(`SET LOCAL statement_timeout = ${Math.floor(options.statementTimeoutMs)}`);
    }

    const placeholders = params.map((_, i) => `$${i + 1}`).join(',');
    const sqlCall = `CALL ${procName}(${placeholders}${placeholders ? ',' : ''}$${params.length + 1})`;
    await client.query(sqlCall, [...params, cursorName]);

    const { rows } = await client.query(`FETCH ALL FROM ${cursorName}`);
    await client.query(`CLOSE ${cursorName}`);
    await client.query('COMMIT');

    return rows;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    if (!externalClient) client.release();
  }
}

/**
 * Llama a un PROCEDURE que informa el resultado en parametros OUT escalares
 * (el patron `OUT result integer, OUT message text[, OUT <algo>_id integer]`)
 * y devuelve esa fila.
 *
 * `outputs` es cuantos OUT tiene el SP: PostgreSQL exige que los marcadores
 * aparezcan en el CALL, y van como NULL literal y no como parametro porque de
 * un `$n` sin usar no puede deducir el tipo.
 *
 * No confundir con callProcedureNoCursor, que descarta la respuesta: si el SP
 * contesta `result = 0, message = 'Falta la empresa'`, ese mensaje es lo unico
 * que el usuario va a ver.
 */
export async function callProcedureReturningResult(pool, procName, params = [], options = {}) {
  const externalClient = options.client ?? null;
  const client = externalClient ?? await pool.connect();

  try {
    await client.query('BEGIN');

    if (options.statementTimeoutMs && options.statementTimeoutMs > 0) {
      await client.query(`SET LOCAL statement_timeout = ${Math.floor(options.statementTimeoutMs)}`);
    }

    const placeholders = params.map((_, i) => `$${i + 1}`);
    const salidas = Array.from({ length: options.outputs ?? 0 }, () => 'NULL');
    const { rows } = await client.query(
      `CALL ${procName}(${[...placeholders, ...salidas].join(',')})`, params);

    await client.query('COMMIT');
    return rows;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    if (!externalClient) client.release();
  }
}

/** Llama a un PROCEDURE sin cursor (solo IN/OUT escalares). */
export async function callProcedureNoCursor(pool, procName, params = [], options = {}) {
  const externalClient = options.client ?? null;
  const client = externalClient ?? await pool.connect();

  try {
    await client.query('BEGIN');

    if (options.statementTimeoutMs && options.statementTimeoutMs > 0) {
      await client.query(`SET LOCAL statement_timeout = ${Math.floor(options.statementTimeoutMs)}`);
    }

    const placeholders = params.map((_, i) => `$${i + 1}`).join(',');
    const sqlCall = `CALL ${procName}(${placeholders})`;
    await client.query(sqlCall, params);

    await client.query('COMMIT');
    return;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    if (!externalClient) client.release();
  }
}
