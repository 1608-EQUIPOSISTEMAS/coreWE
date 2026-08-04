import { describe, it, expect, vi } from 'vitest'

// Sin permiso de modulo en la matriz: aisla el gate a su lista fija de roles,
// que es lo que se quiere fijar aca.
vi.mock('../../src/shared/security/module-access.js', () => ({
  userHasModule: async () => false
}))

const { ALL_COMERCIAL, PRODUCTO_COMERCIAL } = await import('../../src/middlewares/auth.hooks.js')

// Un gate que rechaza responde 403; uno que deja pasar no toca el reply.
function fakeReply () {
  const denials = []
  return { denials, code: (status) => ({ send: (body) => denials.push({ status, body }) }) }
}

async function passes (gate, roles) {
  const reply = fakeReply()
  await gate({ user: { roles } }, reply)
  return reply.denials.length === 0
}

// /program/eventcategorylist nacio para el formulario de Comercial y quedo con
// ALL_COMERCIAL. Cuando FICO empezo a inscribir a eventos desde
// /fico/inscripciones/new, el select de categoria salia vacio: 403 que el front
// solo logueaba en consola. El gate correcto es PRODUCTO_COMERCIAL.
describe('gates de las rutas que consume el alta de inscripcion', () => {
  it('PRODUCTO_COMERCIAL deja pasar a FICO', async () => {
    expect(await passes(PRODUCTO_COMERCIAL, ['FICO'])).toBe(true)
    expect(await passes(PRODUCTO_COMERCIAL, ['LIDER_FICO'])).toBe(true)
  })

  it('sigue cubriendo a Comercial, Fundacion y Producto', async () => {
    for (const rol of ['COMERCIAL', 'FUNDACION', 'PRODUCTO', 'ADMIN']) {
      expect(await passes(PRODUCTO_COMERCIAL, [rol])).toBe(true)
    }
  })

  it('no abre la puerta a cualquiera', async () => {
    expect(await passes(PRODUCTO_COMERCIAL, ['ACADEMICA'])).toBe(false)
    expect(await passes(PRODUCTO_COMERCIAL, [])).toBe(false)
  })

  // El gate anterior: documenta por que hubo que cambiarlo.
  it('ALL_COMERCIAL deja fuera a FICO', async () => {
    expect(await passes(ALL_COMERCIAL, ['FICO'])).toBe(false)
  })
})
