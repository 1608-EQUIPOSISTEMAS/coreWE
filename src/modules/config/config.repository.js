import { pool, withTransaction } from '../../shared/db/pool.js'

// Persistencia del dominio config. SQL plano (sin SPs): las tablas modules y
// rol_module_permission son nuevas y su DDL vive versionado en
// src/sql/config_module.sql.
export class ConfigRepository {
  constructor (db = pool) {
    this.db = db
  }

  // ── Usuarios ──────────────────────────────────────────────

  async userList () {
    const { rows } = await this.db.query(`
      SELECT
        u.user_id,
        u.person_id,
        u.alias,
        u.email,
        (u.active = 'Y') AS active,
        COALESCE(u.telefonos, ARRAY[]::text[]) AS telefonos,
        p.first_name,
        p.last_name,
        COALESCE(
          json_agg(
            json_build_object('rol_id', r.rol_id, 'alias', r.alias, 'description', r.description)
            ORDER BY r.rol_id
          ) FILTER (WHERE r.rol_id IS NOT NULL),
          '[]'::json
        ) AS roles
      FROM public.users u
      INNER JOIN public.persons p ON p.person_id = u.person_id
      LEFT JOIN public.user_roles ur ON ur.user_id = u.user_id
      LEFT JOIN public.rol r ON r.rol_id = ur.rol_id
      GROUP BY u.user_id, u.person_id, u.alias, u.email, u.active, u.telefonos,
               p.first_name, p.last_name
      ORDER BY u.user_id DESC
    `)
    return rows
  }

  async aliasExists (alias, excludeUserId = null) {
    const { rows } = await this.db.query(
      `SELECT 1 FROM public.users
       WHERE upper(alias) = $1 AND ($2::int IS NULL OR user_id <> $2)
       LIMIT 1`,
      [alias, excludeUserId]
    )
    return rows.length > 0
  }

  // Crea persona + usuario + roles en una sola transacción: si falla cualquier
  // paso no quedan personas huérfanas.
  async userCreate ({ alias, firstName, lastName, email, password, active, phones, roleIds }, registrationUserId) {
    return withTransaction(async (client) => {
      const { rows: [person] } = await client.query(
        `INSERT INTO public.persons (first_name, last_name, active, user_registration_id, registration_date)
         VALUES ($1, $2, 'Y', $3, now())
         RETURNING person_id`,
        [firstName, lastName, registrationUserId]
      )
      const { rows: [user] } = await client.query(
        `INSERT INTO public.users (person_id, alias, email, password, active, telefonos, name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING user_id`,
        [person.person_id, alias, email, password, active, phones, firstName]
      )
      for (const rolId of roleIds) {
        await client.query(
          'INSERT INTO public.user_roles (user_id, rol_id) VALUES ($1, $2)',
          [user.user_id, rolId]
        )
      }
      return { user_id: user.user_id, person_id: person.person_id }
    })
  }

  async userUpdate (userId, { alias, firstName, lastName, email, password, active, phones, roleIds }, modificationUserId) {
    return withTransaction(async (client) => {
      const { rows: [user] } = await client.query(
        `UPDATE public.users
         SET alias = $2, email = $3, active = $4, telefonos = $5, name = $6,
             password = COALESCE($7, password)
         WHERE user_id = $1
         RETURNING user_id, person_id`,
        [userId, alias, email, active, phones, firstName, password]
      )
      if (!user) return null

      await client.query(
        `UPDATE public.persons
         SET first_name = $2, last_name = $3, user_modification_id = $4, modification_date = now()
         WHERE person_id = $1`,
        [user.person_id, firstName, lastName, modificationUserId]
      )

      // Reemplazo completo de roles: el formulario siempre envía la lista final.
      await client.query('DELETE FROM public.user_roles WHERE user_id = $1', [userId])
      for (const rolId of roleIds) {
        await client.query(
          'INSERT INTO public.user_roles (user_id, rol_id) VALUES ($1, $2)',
          [userId, rolId]
        )
      }
      return { user_id: userId, person_id: user.person_id }
    })
  }

  // ── Roles ─────────────────────────────────────────────────

  async roleList () {
    const { rows } = await this.db.query(`
      SELECT
        r.rol_id,
        r.description,
        r.alias,
        COUNT(DISTINCT ur.user_id)::int AS user_count,
        COALESCE(
          array_agg(DISTINCT pm.module_id) FILTER (WHERE pm.module_id IS NOT NULL AND pm.can_access),
          ARRAY[]::int[]
        ) AS module_ids,
        COALESCE(
          array_agg(DISTINCT ps.submodule_id) FILTER (WHERE ps.submodule_id IS NOT NULL AND ps.can_access),
          ARRAY[]::int[]
        ) AS submodule_ids
      FROM public.rol r
      LEFT JOIN public.user_roles ur ON ur.rol_id = r.rol_id
      LEFT JOIN public.rol_module_permission pm ON pm.rol_id = r.rol_id
      LEFT JOIN public.rol_submodule_permission ps ON ps.rol_id = r.rol_id
      GROUP BY r.rol_id, r.description, r.alias
      ORDER BY r.rol_id
    `)
    return rows
  }

  async roleGet (rolId) {
    const { rows } = await this.db.query(
      'SELECT rol_id, description, alias FROM public.rol WHERE rol_id = $1',
      [rolId]
    )
    return rows[0] || null
  }

  async roleAliasExists (alias) {
    const { rows } = await this.db.query(
      'SELECT 1 FROM public.rol WHERE upper(alias) = $1 LIMIT 1',
      [alias]
    )
    return rows.length > 0
  }

  async roleCreate ({ description, alias }) {
    const { rows: [row] } = await this.db.query(
      'INSERT INTO public.rol (description, alias) VALUES ($1, $2) RETURNING rol_id',
      [description, alias]
    )
    return row.rol_id
  }

  async roleUpdate (rolId, description) {
    const { rowCount } = await this.db.query(
      'UPDATE public.rol SET description = $2 WHERE rol_id = $1',
      [rolId, description]
    )
    return rowCount > 0
  }

  // ── Módulos y permisos ────────────────────────────────────

  // Módulos con sus submódulos anidados (para la matriz de permisos).
  async moduleList () {
    const { rows } = await this.db.query(`
      SELECT
        m.module_id, m.code, m.name, m.icon, m.route, m.sort_order, (m.active = 'Y') AS active,
        COALESCE(
          json_agg(
            json_build_object(
              'submodule_id', s.submodule_id,
              'code', s.code,
              'name', s.name,
              'route', s.route
            ) ORDER BY s.sort_order, s.submodule_id
          ) FILTER (WHERE s.submodule_id IS NOT NULL AND s.active = 'Y'),
          '[]'::json
        ) AS submodules
      FROM public.modules m
      LEFT JOIN public.submodules s ON s.module_id = m.module_id
      WHERE m.active = 'Y'
      GROUP BY m.module_id, m.code, m.name, m.icon, m.route, m.sort_order, m.active
      ORDER BY m.sort_order, m.module_id
    `)
    return rows
  }

  // Reemplaza la matriz completa de un rol (módulos y submódulos) en una
  // transacción: el formulario siempre envía el estado final de ambos niveles.
  async permissionReplace (rolId, moduleIds, submoduleIds = []) {
    return withTransaction(async (client) => {
      await client.query('DELETE FROM public.rol_module_permission WHERE rol_id = $1', [rolId])
      await client.query('DELETE FROM public.rol_submodule_permission WHERE rol_id = $1', [rolId])
      for (const moduleId of moduleIds) {
        await client.query(
          'INSERT INTO public.rol_module_permission (rol_id, module_id, can_access) VALUES ($1, $2, TRUE)',
          [rolId, moduleId]
        )
      }
      for (const submoduleId of submoduleIds) {
        await client.query(
          'INSERT INTO public.rol_submodule_permission (rol_id, submodule_id, can_access) VALUES ($1, $2, TRUE)',
          [rolId, submoduleId]
        )
      }
      return moduleIds.length
    })
  }

  // ── Cursos online incluidos en la membresia ───────────────

  // DDL idempotente ejecutado una sola vez por proceso. Mismo criterio que
  // edition.repository (ADD COLUMN IF NOT EXISTS inline): el repo no tiene
  // sistema de migraciones y una tabla faltante en prod romperia Configuracion
  // y la activacion de membresias a la vez.
  // ponytail: memoizado en memoria; si algun dia entran migraciones de verdad,
  // esto sale y el DDL se mueve alla.
  async ensureMembershipCoursesTable () {
    if (!this._membershipCoursesReady) {
      this._membershipCoursesReady = this.db.query(`
        CREATE TABLE IF NOT EXISTS public.membership_online_courses (
          odoo_channel_id INTEGER PRIMARY KEY,
          name            TEXT,
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_by      INTEGER
        )
      `).catch(err => {
        this._membershipCoursesReady = null // reintenta al proximo llamado
        throw err
      })
    }
    return this._membershipCoursesReady
  }

  async membershipCourseList () {
    await this.ensureMembershipCoursesTable()
    const { rows } = await this.db.query(`
      SELECT odoo_channel_id, name, updated_at
        FROM public.membership_online_courses
       ORDER BY name NULLS LAST, odoo_channel_id
    `)
    return rows
  }

  // Reemplazo completo: el formulario siempre manda la lista final (mismo
  // contrato que permissionReplace). En transaccion para que un fallo a medias
  // no deje la membresia con media lista.
  async membershipCourseReplace (courses = [], userId = null) {
    await this.ensureMembershipCoursesTable()
    return withTransaction(async (client) => {
      await client.query('DELETE FROM public.membership_online_courses')
      for (const c of courses) {
        await client.query(
          `INSERT INTO public.membership_online_courses (odoo_channel_id, name, updated_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (odoo_channel_id) DO UPDATE SET name = EXCLUDED.name`,
          [c.id, c.name ?? null, userId]
        )
      }
      return courses.length
    })
  }
}

export const configRepository = new ConfigRepository()
