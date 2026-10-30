import { pool, withTransaction } from '../../shared/db/pool.js'

// Unico que habla con la BD. Los sueldos entran y salen cifrados: este archivo
// nunca ve un monto en claro (eso lo hace planilla.crypto en el caso de uso).
export class PlanillaRepository {
  constructor (db = pool) {
    this.db = db
  }

  async listarPersonal () {
    const { rows } = await this.db.query(
      `SELECT personal_id, codigo, dni, nombre, area,
              to_char(hora_ingreso, 'HH24:MI') AS hora_ingreso,
              to_char(hora_salida, 'HH24:MI')  AS hora_salida,
              sueldo_cifrado, activo, updated_at
         FROM public.planilla_personal
        ORDER BY activo DESC, nombre`
    )
    return rows
  }

  // Alta o actualizacion por codigo de huellero. No toca a quien no viene en el archivo.
  async guardarPersonal (personal, { userId, archivo }) {
    return withTransaction(async client => {
      for (const p of personal) {
        await client.query(
          `INSERT INTO public.planilla_personal
                  (codigo, dni, nombre, area, hora_ingreso, hora_salida, sueldo_cifrado, activo, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8)
           ON CONFLICT (codigo) DO UPDATE SET
                  dni = EXCLUDED.dni, nombre = EXCLUDED.nombre, area = EXCLUDED.area,
                  hora_ingreso = EXCLUDED.hora_ingreso, hora_salida = EXCLUDED.hora_salida,
                  sueldo_cifrado = EXCLUDED.sueldo_cifrado, activo = TRUE,
                  updated_at = now(), updated_by = EXCLUDED.updated_by`,
          [p.codigo, p.dni, p.nombre, p.area, p.hora_ingreso, p.hora_salida, p.sueldo_cifrado, userId]
        )
      }
      await client.query(
        `INSERT INTO public.planilla_importacion (tipo, archivo, filas, user_id) VALUES ('PERSONAL', $1, $2, $3)`,
        [archivo, personal.length, userId]
      )
      return personal.length
    })
  }

  async actualizarPersonal (personalId, { area, hora_ingreso, hora_salida, activo }, userId) {
    const { rows } = await this.db.query(
      `UPDATE public.planilla_personal
          SET area = COALESCE($2, area),
              hora_ingreso = COALESCE($3::time, hora_ingreso),
              hora_salida = COALESCE($4::time, hora_salida),
              activo = COALESCE($5, activo),
              updated_at = now(), updated_by = $6
        WHERE personal_id = $1
        RETURNING personal_id`,
      [personalId, area ?? null, hora_ingreso ?? null, hora_salida ?? null, activo ?? null, userId]
    )
    return rows[0] ?? null
  }

  async guardarAsistencia (dias, { userId, archivo, desde, hasta }) {
    return withTransaction(async client => {
      const { rows } = await client.query(
        `INSERT INTO public.planilla_importacion (tipo, archivo, desde, hasta, filas, user_id)
         VALUES ('HUELLERO', $1, $2, $3, $4, $5) RETURNING importacion_id`,
        [archivo, desde, hasta, dias.length, userId]
      )
      const importacionId = rows[0].importacion_id
      for (const d of dias) {
        // Reimportar respeta la justificacion que Talento ya habia puesto.
        await client.query(
          `INSERT INTO public.planilla_asistencia (codigo, nombre_huellero, fecha, entrada, salida, marcas, importacion_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (codigo, fecha) DO UPDATE SET
                  nombre_huellero = EXCLUDED.nombre_huellero, entrada = EXCLUDED.entrada,
                  salida = EXCLUDED.salida, marcas = EXCLUDED.marcas,
                  importacion_id = EXCLUDED.importacion_id`,
          [d.codigo, d.nombre || null, d.fecha, d.entrada, d.salida, d.marcas, importacionId]
        )
      }
      return importacionId
    })
  }

  async asistenciaDelPeriodo (desde, hasta) {
    const { rows } = await this.db.query(
      `SELECT a.asistencia_id, a.codigo, a.nombre_huellero,
              to_char(a.fecha, 'YYYY-MM-DD') AS fecha,
              to_char(a.entrada, 'HH24:MI:SS') AS entrada,
              to_char(a.salida, 'HH24:MI:SS')  AS salida,
              a.marcas, a.justificado, a.justificacion
         FROM public.planilla_asistencia a
        WHERE a.fecha BETWEEN $1 AND $2
        ORDER BY a.codigo, a.fecha`,
      [desde, hasta]
    )
    return rows
  }

  async getAsistencia (asistenciaId) {
    const { rows } = await this.db.query(
      `SELECT asistencia_id, codigo, to_char(fecha, 'YYYY-MM-DD') AS fecha
         FROM public.planilla_asistencia WHERE asistencia_id = $1`,
      [asistenciaId]
    )
    return rows[0] ?? null
  }

  async justificar (asistenciaId, justificado, motivo) {
    const { rows } = await this.db.query(
      `UPDATE public.planilla_asistencia
          SET justificado = $2, justificacion = $3
        WHERE asistencia_id = $1
        RETURNING asistencia_id, justificado, justificacion`,
      [asistenciaId, justificado, justificado ? motivo : null]
    )
    return rows[0] ?? null
  }

  async getPeriodo (anio, mes) {
    const { rows } = await this.db.query(
      `SELECT p.anio, p.mes, p.estado, p.cerrado_at, u.name AS cerrado_por
         FROM public.planilla_periodo p
         LEFT JOIN public.users u ON u.user_id = p.cerrado_por
        WHERE p.anio = $1 AND p.mes = $2`,
      [anio, mes]
    )
    return rows[0] ?? null
  }

  async cerrarPeriodo (anio, mes, userId) {
    await this.db.query(
      `INSERT INTO public.planilla_periodo (anio, mes, estado, cerrado_por)
       VALUES ($1, $2, 'CERRADO', $3) ON CONFLICT (anio, mes) DO NOTHING`,
      [anio, mes, userId]
    )
  }

  async reabrirPeriodo (anio, mes) {
    await this.db.query('DELETE FROM public.planilla_periodo WHERE anio = $1 AND mes = $2', [anio, mes])
  }

  async importaciones (limite = 20) {
    const { rows } = await this.db.query(
      `SELECT i.importacion_id, i.tipo, i.archivo,
              to_char(i.desde, 'YYYY-MM-DD') AS desde, to_char(i.hasta, 'YYYY-MM-DD') AS hasta,
              i.filas, i.created_at, u.name AS usuario
         FROM public.planilla_importacion i
         LEFT JOIN public.users u ON u.user_id = i.user_id
        ORDER BY i.created_at DESC LIMIT $1`,
      [limite]
    )
    return rows
  }

  async auditar (userId, accion, detalle = {}) {
    await this.db.query(
      'INSERT INTO public.planilla_auditoria (user_id, accion, detalle) VALUES ($1, $2, $3)',
      [userId ?? null, accion, JSON.stringify(detalle)]
    )
  }
}

export const planillaRepository = new PlanillaRepository()
