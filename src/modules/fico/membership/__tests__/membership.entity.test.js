import { describe, it, expect } from 'vitest'
import { DomainError } from '../../../../shared/errors.js'
import {
  MEMBERSHIP_ACTIVATION_WINDOW_MONTHS,
  isMembership,
  validateActivationDateFormat,
  classifyActivation,
  assertReschedulable,
  resolveMembershipChannels
} from '../membership.entity.js'

describe('isMembership (flag explicito prioritario)', () => {
  it('el flag true manda sobre el nombre', () => {
    expect(isMembership('PROGRAMA REGULAR', true)).toBe(true)
  })
  it('el flag false manda aunque el nombre parezca membresia', () => {
    expect(isMembership('MEMBRESIA GOLD', false)).toBe(false)
  })
  it('sin flag cae a la heuristica de nombre', () => {
    expect(isMembership('CLUB GOLD')).toBe(true)
    expect(isMembership('DIPLOMADO X')).toBe(false)
  })
})

describe('validateActivationDateFormat', () => {
  it('acepta YYYY-MM-DD y devuelve el valor trimmeado', () => {
    expect(validateActivationDateFormat('  2026-06-01 ')).toEqual({ ok: true, value: '2026-06-01' })
  })
  it('rechaza formatos no calendario', () => {
    expect(validateActivationDateFormat('01/06/2026').ok).toBe(false)
    expect(validateActivationDateFormat('2026-6-1').ok).toBe(false)
    expect(validateActivationDateFormat(null).ok).toBe(false)
  })
})

describe('classifyActivation', () => {
  it('fuera de ventana tiene prioridad sobre todo', () => {
    expect(classifyActivation({ isTodayOrPast: true, outOfWindow: true, activationDate: '2027-01-01', runAt: 'x' }))
      .toEqual({ mode: 'out_of_window' })
  })
  it('hoy o pasado es inmediato (flujo sincrono)', () => {
    expect(classifyActivation({ isTodayOrPast: true, outOfWindow: false, activationDate: '2026-05-29', runAt: 'x' }))
      .toEqual({ mode: 'immediate', activationDate: '2026-05-29' })
  })
  it('futuro dentro de ventana es diferido (job a las 09:00)', () => {
    expect(classifyActivation({ isTodayOrPast: false, outOfWindow: false, activationDate: '2026-08-01', runAt: 'RUNAT' }))
      .toEqual({ mode: 'deferred', activationDate: '2026-08-01', runAt: 'RUNAT' })
  })
})

describe('assertReschedulable', () => {
  const future = { mode: 'deferred', activationDate: '2026-08-01', runAt: 'x' }

  it('no lanza cuando es membresia, sin activar y con fecha futura valida', () => {
    expect(() => assertReschedulable(
      { found: true, isMembershipProgram: true, alreadyActivated: false }, future
    )).not.toThrow()
  })

  it('lanza NotFound cuando la inscripcion no existe', () => {
    try {
      assertReschedulable({ found: false, isMembershipProgram: false, alreadyActivated: false }, future)
      throw new Error('debio lanzar')
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError)
      expect(e.statusCode).toBe(404)
    }
  })

  it('lanza si la inscripcion no es membresia', () => {
    expect(() => assertReschedulable(
      { found: true, isMembershipProgram: false, alreadyActivated: false }, future
    )).toThrow(DomainError)
  })

  // El candado dejo de ser el correo (que ahora sale el dia de la inscripcion) y
  // paso a ser la activacion: con los cursos ya abiertos, la fecha no significa nada.
  it('lanza si la membresia ya fue activada', () => {
    expect(() => assertReschedulable(
      { found: true, isMembershipProgram: true, alreadyActivated: true }, future
    )).toThrow(/ya fue activada/i)
  })

  it('lanza si la fecha es hoy o pasado (debe usar envio directo)', () => {
    expect(() => assertReschedulable(
      { found: true, isMembershipProgram: true, alreadyActivated: false },
      { mode: 'immediate', activationDate: '2026-05-29' }
    )).toThrow(/posterior a hoy/i)
  })

  it('lanza si la fecha excede la ventana permitida', () => {
    expect(() => assertReschedulable(
      { found: true, isMembershipProgram: true, alreadyActivated: false },
      { mode: 'out_of_window' }
    )).toThrow(/ventana permitida/i)
  })
})

describe('resolveMembershipChannels (curaduria del catalogo de membresia)', () => {
  const published = [
    { id: 10, name: 'Excel Avanzado' },
    { id: 11, name: 'Power BI' },
    { id: 12, name: 'Curso recien publicado' }
  ]

  it('inscribe solo los canales configurados', () => {
    const { channels, usedFallback } = resolveMembershipChannels(published, [10, 11])
    expect(channels.map(c => c.id)).toEqual([10, 11])
    expect(usedFallback).toBe(false)
  })

  it('un curso nuevo publicado en el Campus NO entra solo', () => {
    const { channels } = resolveMembershipChannels(published, [10, 11])
    expect(channels.map(c => c.id)).not.toContain(12)
  })

  it('ignora ids configurados que ya no existen en Odoo', () => {
    const { channels } = resolveMembershipChannels(published, [10, 999])
    expect(channels.map(c => c.id)).toEqual([10])
  })

  it('sin lista configurada cae a todos los publicados y lo marca', () => {
    const { channels, usedFallback } = resolveMembershipChannels(published, [])
    expect(channels).toHaveLength(3)
    expect(usedFallback).toBe(true)
  })

  it('tolera argumentos ausentes', () => {
    expect(resolveMembershipChannels().channels).toEqual([])
  })
})
