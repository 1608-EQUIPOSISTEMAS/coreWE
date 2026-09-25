import { describe, it, expect, vi } from 'vitest'
import { NotificationRepository } from '../notification.repository.js'

const conexion = () => ({ raw: { write: vi.fn() } })

describe('NotificationRepository · broadcast', () => {
  it('escribe en todas las conexiones vivas, de todos los usuarios', () => {
    const repo = new NotificationRepository({}, vi.fn())
    const a1 = conexion(); const a2 = conexion(); const b = conexion()
    repo.addClient(1, a1); repo.addClient(1, a2); repo.addClient(2, b)

    expect(repo.broadcast('data: {}\n\n')).toBe(3)
    for (const c of [a1, a2, b]) expect(c.raw.write).toHaveBeenCalledWith('data: {}\n\n')
  })

  it('una conexion cerrada ya no recibe', () => {
    const repo = new NotificationRepository({}, vi.fn())
    const c = conexion()
    const quitar = repo.addClient(1, c)
    quitar()

    expect(repo.broadcast('x')).toBe(0)
    expect(c.raw.write).not.toHaveBeenCalled()
  })
})

describe('NotificationRepository · notify', () => {
  it('publica por pg_notify en el canal que escucha el listener', async () => {
    const db = { query: vi.fn().mockResolvedValue({}) }
    const repo = new NotificationRepository(db, vi.fn())

    await repo.notify({ tipo_evento: 'tickets_actualizados', ticket_id: 5, broadcast: true })

    expect(db.query).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', [
      'canal_crm_notificaciones',
      JSON.stringify({ tipo_evento: 'tickets_actualizados', ticket_id: 5, broadcast: true })
    ])
  })
})
