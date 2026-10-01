import { describe, it, expect } from 'vitest'
import { AUTOSYNC, observeChanges, decideAutoSync, shouldAlertFailures, buildReplacement, columnWidth } from '../fico-autosync.entity.js'

const MIN = 60_000
// 2026-10-01 10:00 en Lima (15:00 UTC): horario de oficina.
const T0 = Date.UTC(2026, 9, 1, 15, 0, 0)
const fresh = { version: 0, changedAt: null, pendingSince: null }

describe('observeChanges', () => {
  it('marca pendiente desde la primera vez que el contador supera lo sincronizado', () => {
    const s1 = observeChanges(fresh, { version: 5, syncedVersion: 3, now: T0 })
    expect(s1).toEqual({ version: 5, changedAt: T0, pendingSince: T0 })
    const s2 = observeChanges(s1, { version: 6, syncedVersion: 3, now: T0 + MIN })
    expect(s2.pendingSince).toBe(T0)
    expect(s2.changedAt).toBe(T0 + MIN)
  })

  it('deja de estar pendiente cuando la corrida alcanza al contador', () => {
    const s = observeChanges({ version: 6, changedAt: T0, pendingSince: T0 }, { version: 6, syncedVersion: 6, now: T0 + MIN })
    expect(s.pendingSince).toBeNull()
  })
})

describe('decideAutoSync', () => {
  const pending = (changedAt, pendingSince) => ({ version: 9, changedAt, pendingSince })

  it('espera mientras FICO sigue cambiando cosas', () => {
    const state = pending(T0 - 30_000, T0 - 2 * MIN)
    expect(decideAutoSync({ state, now: T0 })).toEqual({ run: false })
  })

  it('corre cuando pasa un minuto sin cambios', () => {
    const state = pending(T0 - AUTOSYNC.quietMs, T0 - 2 * MIN)
    expect(decideAutoSync({ state, now: T0 })).toEqual({ run: true, trigger: 'changes' })
  })

  it('corre a los 5 minutos aunque no paren los cambios', () => {
    const state = pending(T0 - 10_000, T0 - AUTOSYNC.maxWaitMs)
    expect(decideAutoSync({ state, now: T0 })).toEqual({ run: true, trigger: 'changes' })
  })

  it('nunca corre dos veces en menos de 3 minutos', () => {
    const state = pending(T0 - 10 * MIN, T0 - 10 * MIN)
    expect(decideAutoSync({ state, now: T0, lastRunAt: T0 - 2 * MIN })).toEqual({ run: false })
  })

  it('sin cambios, corre la red de seguridad si pasó una hora en horario de oficina', () => {
    expect(decideAutoSync({ state: fresh, now: T0, lastOkAt: T0 - 61 * MIN }))
      .toEqual({ run: true, trigger: 'safety' })
    expect(decideAutoSync({ state: fresh, now: T0, lastOkAt: T0 - 30 * MIN })).toEqual({ run: false })
  })

  it('de noche no corre la red de seguridad (23:00 Lima)', () => {
    const night = Date.UTC(2026, 9, 2, 4, 0, 0)
    expect(decideAutoSync({ state: fresh, now: night, lastOkAt: night - 5 * 60 * MIN })).toEqual({ run: false })
  })

  it('de noche sí sube cambios reales', () => {
    const night = Date.UTC(2026, 9, 2, 4, 0, 0)
    const state = pending(night - 2 * MIN, night - 2 * MIN)
    expect(decideAutoSync({ state, now: night })).toEqual({ run: true, trigger: 'changes' })
  })
})

describe('shouldAlertFailures', () => {
  it('avisa una sola vez por racha, al llegar a 3', () => {
    expect([1, 2, 3, 4, 9].map(shouldAlertFailures)).toEqual([false, false, true, false, false])
  })
})

describe('buildReplacement', () => {
  it('rellena cada fila al ancho de la hoja y convierte null en vacío', () => {
    expect(buildReplacement([[1, null], ['a']], 3, 0)).toEqual([[1, '', ''], ['a', '', '']])
  })

  it('pisa con vacío las filas viejas que sobran (la hoja tenía 4, ahora van 2)', () => {
    const out = buildReplacement([[1], [2]], 2, 4)
    expect(out).toEqual([[1, ''], [2, ''], ['', ''], ['', '']])
  })

  it('con cero filas nuevas deja la hoja en blanco, no la salta', () => {
    expect(buildReplacement([], 2, 2)).toEqual([['', ''], ['', '']])
  })

  it('columnWidth: T=20, AE=31, BV=74', () => {
    expect(['T', 'AE', 'BV'].map(columnWidth)).toEqual([20, 31, 74])
  })
})
