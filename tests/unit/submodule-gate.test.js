import { describe, it, expect, vi } from 'vitest'

// La matriz otorga solo CONCILIACION a FICO: aisla el gate de submodulo.
vi.mock('../../src/shared/security/module-access.js', () => ({
  userHasModule: async () => false,
  userHasSubmodule: async (roles, moduleCode, subCode) =>
    roles.includes('FICO') && moduleCode === 'IMPORTACION' && subCode === 'CONCILIACION'
}))

const { hasSubmoduleOrRole } = await import('../../src/middlewares/auth.hooks.js')

function fakeReply () {
  const denials = []
  return { denials, code: (status) => ({ send: (body) => denials.push({ status, body }) }) }
}

async function passes (gate, roles) {
  const reply = fakeReply()
  await gate({ user: { roles } }, reply)
  return reply.denials.length === 0
}

// Modulo Importacion: importar ESCRIBE datos y conciliar solo lee, asi que cada
// submodulo es un permiso distinto. Tener uno no da el otro.
describe('hasSubmoduleOrRole (modulo Importacion)', () => {
  const CAN_IMPORT = hasSubmoduleOrRole('IMPORTACION', 'CARGA', ['ADMIN'])
  const CAN_RECONCILE = hasSubmoduleOrRole('IMPORTACION', 'CONCILIACION', ['ADMIN'])

  it('ADMIN entra a los dos por rol fijo', async () => {
    expect(await passes(CAN_IMPORT, ['ADMIN'])).toBe(true)
    expect(await passes(CAN_RECONCILE, ['ADMIN'])).toBe(true)
  })

  it('la matriz da CONCILIACION a FICO, pero eso no lo deja importar', async () => {
    expect(await passes(CAN_RECONCILE, ['FICO'])).toBe(true)
    expect(await passes(CAN_IMPORT, ['FICO'])).toBe(false)
  })

  it('sin permiso responde 403', async () => {
    const reply = fakeReply()
    await CAN_IMPORT({ user: { roles: ['COMERCIAL'] } }, reply)
    expect(reply.denials[0].status).toBe(403)
  })
})
