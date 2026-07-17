import { describe, it, expect } from 'vitest'
import { AuthRepository } from '../auth.repository.js'

// El SP solo entiende alias: un login con email debe resolverse a alias antes.
describe('AuthRepository.login con email', () => {
  function makeRepo (emailRows) {
    const calls = { sp: null }
    const db = { query: async () => ({ rows: emailRows }) }
    const sp = async (_db, _name, params) => { calls.sp = params; return [{ result: { ok: true } }] }
    return { repo: new AuthRepository(db, sp), calls }
  }

  it('traduce el email a su alias', async () => {
    const { repo, calls } = makeRepo([{ alias: 'FCARBAJAL' }])
    await repo.login('Fer@Correo.com', 'secreto')
    expect(calls.sp).toEqual(['FCARBAJAL', 'secreto'])
  })

  it('sin coincidencia pasa el email tal cual (401 genérico en el SP)', async () => {
    const { repo, calls } = makeRepo([])
    await repo.login('nadie@correo.com', 'secreto')
    expect(calls.sp).toEqual(['nadie@correo.com', 'secreto'])
  })

  it('un alias normal no consulta la tabla de emails', async () => {
    const db = { query: async () => { throw new Error('no debía consultar') } }
    const sp = async () => [{ result: { ok: true } }]
    const repo = new AuthRepository(db, sp)
    await expect(repo.login('FCARBAJAL', 'secreto')).resolves.toEqual({ ok: true })
  })
})
