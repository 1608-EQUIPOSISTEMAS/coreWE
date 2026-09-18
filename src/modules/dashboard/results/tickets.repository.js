import { pool } from '../../../shared/db/pool.js'

// Filas crudas de los reportes de soporte: panel de lider (por area), panel de
// ADMIN (toda la empresa) y panel de colaborador (solo lo que el mismo reporto).
//
// El alcance de area es el mismo que usa el modulo Tickets: el area se deriva
// del ROL de quien creo el ticket. Se repite el EXISTS en vez de importar
// modules/tickets porque los modulos no se importan entre si; es una consulta,
// no una regla de negocio, y la regla (que area es cada rol) sigue viniendo de
// AREA_OF_LEADER en un solo lugar.
//
// userId es una segunda dimension de alcance, independiente de areaRoles: un
// colaborador no tiene area propia en el ticket, tiene AUTORIA. Ambos filtros
// son NULL-abiertos (NULL = sin restriccion) asi que "sin userId ni areaRoles"
// es, a proposito, "todos los tickets" (la vista del ADMIN).
// $1 = areaRoles, $2 = userId siempre, sin huecos: si una consulta ademas
// necesita una ventana de dias/meses, esa va en $3. Un placeholder que no
// aparece en el texto (p.ej. saltar a $3 sin usar $2) hace que Postgres no
// pueda inferirle tipo y falle con "could not determine data type of parameter".
const SCOPE_SQL = `
  ($1::text[] IS NULL
    OR EXISTS (SELECT 1 FROM public.user_roles ur
                 JOIN public.rol r ON r.rol_id = ur.rol_id
                WHERE ur.user_id = t.created_by_id AND r.alias = ANY($1)))
  AND ($2::int IS NULL OR t.created_by_id = $2)`

const VENTANA_ESTADO_DIAS = 30
const VENTANA_TIEMPOS_DIAS = 90
const MESES_TENDENCIA = 7

export async function fetchAreaTicketsRaw ({ areaRoles = null, userId = null } = {}, db = pool) {
  const [estado, abiertos, tiempos, tendencia] = await Promise.all([
    estadoDelMes(areaRoles, userId, db),
    sinCerrar(areaRoles, userId, db),
    tiemposDeRespuesta(areaRoles, userId, db),
    tendenciaMensual(areaRoles, userId, db)
  ])
  return { estado, abiertos, tiempos, tendencia }
}

// Reparto por estado de lo que el area reporto en los ultimos 30 dias.
// "vencidos" se cuenta aqui y no en JS porque es una suma, no un veredicto por
// fila: basta con mirar si el plazo ya paso y el reloj sigue corriendo.
async function estadoDelMes (areaRoles, userId, db) {
  const { rows } = await db.query(`
    SELECT COUNT(*) FILTER (WHERE t.status = 'ABIERTO')::int     AS abiertos,
           COUNT(*) FILTER (WHERE t.status = 'EN_PROGRESO')::int AS en_progreso,
           COUNT(*) FILTER (WHERE t.status = 'CERRADO')::int     AS cerrados,
           COUNT(*)::int                                          AS total,
           COUNT(*) FILTER (
             WHERE t.status <> 'CERRADO'
               AND (  (t.first_response_at IS NULL AND t.first_response_due_at < now())
                   OR (t.resolved_at       IS NULL AND t.resolution_due_at     < now()))
           )::int AS vencidos
      FROM public.tickets t
     WHERE t.active = 'Y'
       AND t.registration_date >= now() - ($3 || ' days')::interval
       AND (${SCOPE_SQL})`, [areaRoles, userId, VENTANA_ESTADO_DIAS])
  return rows[0]
}

// Los que siguen sin cerrarse, sin ventana de tiempo: un ticket de hace dos
// meses que nadie cerro es justamente el que el lider tiene que ver.
// El estado del reloj (POR_VENCER / VENCIDO) lo decide la entity con
// evaluarReloj, para no reimplementar el umbral del SLA en SQL.
async function sinCerrar (areaRoles, userId, db) {
  const { rows } = await db.query(`
    SELECT t.ticket_id, t.title, t.priority, t.status, t.registration_date,
           t.first_response_due_at, t.first_response_at,
           t.resolution_due_at, t.resolved_at,
           EXTRACT(DAY FROM now() - t.registration_date)::int AS dias,
           cu.name AS creador
      FROM public.tickets t
      JOIN public.users cu ON cu.user_id = t.created_by_id
     WHERE t.active = 'Y'
       AND t.status <> 'CERRADO'
       AND (${SCOPE_SQL})
     ORDER BY t.registration_date
     LIMIT 50`, [areaRoles, userId])
  return rows
}

// Cumplimiento y medianas de los ultimos 90 dias. Los veredictos agregados se
// calculan en SQL porque son sumas sobre plazos ya congelados; el resultado no
// depende de cuando se mire.
async function tiemposDeRespuesta (areaRoles, userId, db) {
  const { rows } = await db.query(`
    WITH periodo AS (
      SELECT t.*
        FROM public.tickets t
       WHERE t.active = 'Y'
         AND t.registration_date >= now() - ($3 || ' days')::interval
         AND (${SCOPE_SQL})
    )
    SELECT
      COUNT(*) FILTER (WHERE first_response_at IS NOT NULL
                         AND first_response_at <= first_response_due_at)::int AS resp_a_tiempo,
      COUNT(*) FILTER (WHERE first_response_at IS NOT NULL
                         AND first_response_at >  first_response_due_at)::int AS resp_tarde,
      COUNT(*) FILTER (WHERE resolved_at IS NOT NULL
                         AND resolved_at <= resolution_due_at)::int           AS res_a_tiempo,
      COUNT(*) FILTER (WHERE resolved_at IS NOT NULL
                         AND resolved_at >  resolution_due_at)::int           AS res_tarde,
      COUNT(*) FILTER (WHERE status <> 'CERRADO'
                         AND (  (first_response_at IS NULL AND first_response_due_at < now())
                             OR (resolved_at       IS NULL AND resolution_due_at     < now())))::int AS vencidos_ahora,
      COUNT(*) FILTER (WHERE escalated_at IS NOT NULL)::int                   AS escalados,
      COUNT(*) FILTER (WHERE status = 'ABIERTO')::int                         AS sin_tomar,
      ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (first_response_at - registration_date)) / 3600.0))::numeric, 1)
        AS mediana_resp_horas,
      ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (resolved_at - registration_date)) / 3600.0))::numeric, 1)
        AS mediana_res_horas
      FROM periodo`, [areaRoles, userId, VENTANA_TIEMPOS_DIAS])
  return rows[0]
}

// Siete meses con meses_atras, la forma que espera monthlyChart. FILTER en vez
// de un WHERE global: asi un mes cuenta TODO lo creado, y cada mediana ignora
// solo las filas que todavia no tienen esa marca (respondido / cerrado), sin
// vaciar el mes entero por los tickets que aun estan en curso.
async function tendenciaMensual (areaRoles, userId, db) {
  const { rows } = await db.query(`
    SELECT (EXTRACT(YEAR  FROM age(date_trunc('month', now()), date_trunc('month', t.registration_date))) * 12
          + EXTRACT(MONTH FROM age(date_trunc('month', now()), date_trunc('month', t.registration_date))))::int AS meses_atras,
           COUNT(*)::int AS tickets,
           ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (t.first_response_at - t.registration_date)) / 3600.0)
             FILTER (WHERE t.first_response_at IS NOT NULL))::numeric, 1)
             AS mediana_resp_horas,
           ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (t.resolved_at - t.registration_date)) / 3600.0)
             FILTER (WHERE t.resolved_at IS NOT NULL))::numeric, 1)
             AS mediana_res_horas
      FROM public.tickets t
     WHERE t.active = 'Y'
       AND t.registration_date >= date_trunc('month', now()) - (($3 - 1) || ' months')::interval
       AND (${SCOPE_SQL})
     GROUP BY 1
     ORDER BY 1`, [areaRoles, userId, MESES_TENDENCIA])
  return rows
}
