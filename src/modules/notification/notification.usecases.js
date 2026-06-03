import { DomainError } from '../../shared/errors.js'
import { notificationRepository } from './notification.repository.js'
import { countUnread, buildSseEventData, buildListFilters } from './notification.entity.js'
import { toNotificationDto, toListDto } from './notification.dto.js'

const repo = notificationRepository

// Asegura que el listener de NOTIFY este corriendo. Invocado al registrar el
// modulo, sustituye al efecto secundario en import del codigo legacy.
export function startNotificationListener () {
  return repo.startPgListener()
}

// Notificaciones de la campanita: no leidas mas las 5 ultimas leidas.
export async function getBellNotifications (userId) {
  const rows = await repo.getUnreadNotifications(userId)
  const notifications = rows.map(toNotificationDto)
  return { notifications, unread_count: countUnread(notifications) }
}

// Conteo de no leidas para el indicador rojo.
export async function getUnreadCount (userId) {
  return repo.countUnreadNotifications(userId)
}

// Marca como leidas todas las notificaciones del usuario.
export async function markAllRead (userId) {
  await repo.markAllAsRead(userId)
}

// Listado paginado completo del modulo de notificaciones.
export async function listNotifications ({ user_id, page, size, is_read }) {
  const filters = buildListFilters({ user_id, page, size, is_read })
  const rows = await repo.list(filters)
  return toListDto(rows)
}

// Empuja a los asesores indicados el evento de recarga de restricciones via SSE.
export async function pushRestrictionsUpdate (userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new DomainError('user_ids requerido')
  }

  const eventData = buildSseEventData({ tipo_evento: 'restricciones_actualizadas' })
  let notificados = 0

  for (const uid of userIds) {
    const userId = Number(uid)
    if (repo.pushTo(userId, eventData)) {
      notificados++
      console.log(`[NOTIFY] ✅ restricciones_actualizadas → userId=${userId}`)
    } else {
      console.log(`[NOTIFY] ⚠️  Sin SSE activo para userId=${userId} (se aplicará al próximo login)`)
    }
  }

  return { notificados }
}
