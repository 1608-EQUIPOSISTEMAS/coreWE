import { describe, it, expect } from 'vitest'
import { resolveOdooLogin } from '../fico-odoo.helper.js'

const createEmail = 'perez.maria@weeducacion.edu.pe'

// Cliente Odoo falso: `users` es lo que devuelve read(res.users), `byEmail` el
// match de searchUserByEmail y `byDocument` el de searchUsersByDocument.
// null / [] = no existe.
function fakeOdoo ({ users = null, byEmail = null, byDocument = [] } = {}) {
  return {
    callKw: async () => users,
    searchUserByEmail: async () => byEmail,
    searchUsersByDocument: async () => byDocument
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
    const client = {
      callKw: async () => { throw new Error('odoo caido') },
      searchUserByEmail: async () => { throw new Error('odoo caido') },
      searchUsersByDocument: async () => { throw new Error('odoo caido') }
    }
    expect(await resolveOdooLogin({ prevOdooUserId: 7, documentNumber: '75858170', originEmail: 'real@gmail.com', createEmail }, client))
      .toBe(createEmail)
  })

  describe('busqueda por documento', () => {
    // El caso que origino el fix: el correo del lead venia mal escrito, asi que
    // la busqueda por correo no lo encontraba y se le creaba un login nuevo con
    // sufijo. El DNI si lo encuentra.
    it('encuentra al alumno por DNI cuando el correo del lead esta mal escrito', async () => {
      const client = fakeOdoo({
        byEmail: null,
        byDocument: [{ id: 41342, login: 'fercarbajalcarbajal@gmail.com' }]
      })
      expect(await resolveOdooLogin({
        prevOdooUserId: null, documentNumber: '75858170',
        originEmail: 'fercarbajal@gmail.com', createEmail
      }, client)).toBe('fercarbajalcarbajal@gmail.com')
    })

    it('entre varios logins del mismo alumno prefiere el correo real al sintetico', async () => {
      const client = fakeOdoo({
        byDocument: [
          { id: 49492, login: 'carbajal.fernando2@weeducacion.edu.pe' },
          { id: 41342, login: 'fercarbajalcarbajal@gmail.com' },
          { id: 49413, login: 'carbajal.fer@weeducacion.edu.pe' }
        ]
      })
      expect(await resolveOdooLogin({ prevOdooUserId: null, documentNumber: '75858170', createEmail }, client))
        .toBe('fercarbajalcarbajal@gmail.com')
    })

    it('si todos los logins son sinteticos toma el mas antiguo', async () => {
      const client = fakeOdoo({
        byDocument: [
          { id: 49492, login: 'carbajal.fernando2@weeducacion.edu.pe' },
          { id: 46607, login: 'carbajal.fernando@weeducacion.edu.pe' }
        ]
      })
      expect(await resolveOdooLogin({ prevOdooUserId: null, documentNumber: '75858170', createEmail }, client))
        .toBe('carbajal.fernando@weeducacion.edu.pe')
    })

    // vat no es llave unica en Odoo: hay partners con el DNI de otra persona.
    // searchUsersByDocument devuelve vacio ante ambiguedad y aca no se adivina.
    it('con documento ambiguo no elige a nadie y sigue al correo real', async () => {
      const client = fakeOdoo({ byDocument: [], byEmail: { login: 'porreal@odoo.com' } })
      expect(await resolveOdooLogin({ prevOdooUserId: null, documentNumber: '75858170', originEmail: 'real@gmail.com', createEmail }, client))
        .toBe('porreal@odoo.com')
    })

    it('el user previo sigue mandando por encima del DNI', async () => {
      const client = fakeOdoo({
        users: [{ login: 'previo@odoo.com' }],
        byDocument: [{ id: 1, login: 'pordni@gmail.com' }]
      })
      expect(await resolveOdooLogin({ prevOdooUserId: 7, documentNumber: '75858170', createEmail }, client))
        .toBe('previo@odoo.com')
    })
  })
})
