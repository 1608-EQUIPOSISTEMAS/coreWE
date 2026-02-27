// src/services/notification.service.js
import { pool } from '../plugins/db.js'

/**
 * Notificaciones para la campanita:
 * - Todas las no leídas
 * - Últimas 5 leídas (para contexto)
 */
// Cambiar ambos SELECT del UNION ALL para incluir read_at:

export async function getUnreadNotifications(userId) {
  const result = await pool.query(`
    (
      SELECT notification_id, lead_id, title, message, is_read, read_at, created_at
      FROM public.notifications
      WHERE user_id = $1 AND is_read = false
      ORDER BY created_at DESC
    )
    UNION ALL
    (
      SELECT notification_id, lead_id, title, message, is_read, read_at, created_at
      FROM public.notifications
      WHERE user_id = $1 AND is_read = true
      ORDER BY created_at DESC
      LIMIT 5
    )
    ORDER BY created_at DESC
  `, [userId])
  return result.rows
}

/**
 * Contar solo las no leídas (circulito rojo)
 */
export async function countUnreadNotifications(userId) {
  const result = await pool.query(`
    SELECT COUNT(*) AS unread_count
    FROM public.notifications
    WHERE user_id = $1 AND is_read = false
  `, [userId])
  return parseInt(result.rows[0].unread_count)
}

/**
 * Marcar todas como leídas
 */
export async function markAllAsRead(userId) {
  await pool.query(`
    UPDATE public.notifications
    SET is_read = true,
        read_at = NOW()       -- ← aquí se guarda el momento exacto
    WHERE user_id = $1 AND is_read = false
  `, [userId])
}

export default { getUnreadNotifications, countUnreadNotifications, markAllAsRead }