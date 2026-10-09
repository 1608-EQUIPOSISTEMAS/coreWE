import { describe, it, expect } from 'vitest'
import { toTicketDto, toCommentDto, contentDisposition } from '../tickets.dto.js'

describe('contentDisposition', () => {
  it('respaldo ASCII sin tildes ni comillas + nombre real en filename* UTF-8', () => {
    expect(contentDisposition('captura ñandú "raro" (1).png')).toBe(
      'inline; filename="captura nandu _raro_ (1).png"; ' +
      "filename*=UTF-8''captura%20%C3%B1and%C3%BA%20%22raro%22%20%281%29.png")
  })

  it('sin nombre usa "archivo"', () => {
    expect(contentDisposition(null)).toBe('inline; filename="archivo"; filename*=UTF-8\'\'archivo')
  })
})

describe('toTicketDto', () => {
  it('las personas llevan su id (el front compara por id, no por nombre)', () => {
    const dto = toTicketDto({
      ticket_id: 1, created_by_id: 3, creador: 'Camilo', creador_alias: 'CA36',
      assigned_to_id: 9, asignado: 'Fernando', asignado_alias: 'ADMIN'
    })
    expect(dto.creadoPor).toEqual({ id: 3, nombre: 'Camilo', alias: 'CA36' })
    expect(dto.asignadoA).toEqual({ id: 9, nombre: 'Fernando', alias: 'ADMIN' })
  })

  it('sin agente, asignadoA es null', () => {
    expect(toTicketDto({ ticket_id: 1, creador: 'Camilo', assigned_to_id: null }).asignadoA).toBeNull()
  })
})

describe('toCommentDto', () => {
  it('el autor lleva su id', () => {
    expect(toCommentDto({ ticket_comment_id: 1, author_id: 2, autor: 'Arleth', autor_alias: 'AE30' }).autor)
      .toEqual({ id: 2, nombre: 'Arleth', alias: 'AE30' })
  })
})
