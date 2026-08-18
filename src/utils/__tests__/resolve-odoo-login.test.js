import { describe, it, expect } from 'vitest'
import { resolveOdooLogin } from '../fico-odoo.helper.js'

const createEmail = 'perez.maria@weeducacion.edu.pe'

// Cliente Odoo falso: `users` es lo que devuelve read(res.users) y `byEmail` el
// match de searchUserByEmail. null = no existe.
function fakeOdoo ({ users = null, byEmail = null } = {}) {
  return {
    callKw: async () => users,
    searchUserByEmail: async () => byEmail
  }
}

describe('resolveOdooLogin', () => {
  it('prioriza el login del odoo_user_id previo del mismo DNI', async () => {
    const client = fakeOdoo({ users: [{ login: 'previo@odoo.com' }], byEmail: { login: 'porreal@odoo.com' } })
    expect(await resolveOdooLogin({ prevOdooUserId: 7, originEmail: 'real@gmail.com', createEmail }, client))
      .toBe('previo@odoo.com')
  })

  // El bug de membresia: alumno con cuenta Odoo creada por otro flujo.
  it('reusa la cuenta encontrada por el correo real cuando no hay DNI previo', async () => {
    const client = fakeOdoo({ byEmail: { login: 'porreal@odoo.com' } })
    expect(await resolveOdooLogin({ prevOdooUserId: null, originEmail: '  Real@Gmail.COM ', createEmail }, client))
      .toBe('porreal@odoo.com')
  })

  it('cae al email sintetico cuando el alumno no existe en Odoo', async () => {
    expect(await resolveOdooLogin({ prevOdooUserId: null, originEmail: 'real@gmail.com', createEmail }, fakeOdoo()))
      .toBe(createEmail)
  })

  it('no revienta si Odoo falla: cae al sintetico', async () => {
    const client = { callKw: async () => { throw new Error('odoo caido') }, searchUserByEmail: async () => { throw new Error('odoo caido') } }
    expect(await resolveOdooLogin({ prevOdooUserId: 7, originEmail: 'real@gmail.com', createEmail }, client))
      .toBe(createEmail)
  })
})
