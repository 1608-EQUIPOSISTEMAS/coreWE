import { describe, it, expect, vi } from 'vitest'

// Sin permiso de modulo en la matriz: aisla el gate a su lista fija de roles,
// que es lo que se quiere fijar aca.
vi.mock('../../src/shared/security/module-access.js', () => ({
  userHasModule: async () => false
}))

const { ALL_COMERCIAL, PRODUCTO_COMERCIAL, ALL_B2B, ALL_INTERNAL } = await import('../../src/middlewares/auth.hooks.js')

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

// /b2b/leads/new postea a /comercial/leadregister (mismo useLeadForm). El rol
// B2B no estaba en ALL_COMERCIAL ni tenia el modulo COMERCIAL en la matriz, asi
// que recibia 403 y el formulario solo decia "Error inesperado al guardar".
describe('gate del alta de consultas B2B', () => {
  it('ALL_COMERCIAL deja registrar consultas al rol B2B', async () => {
    expect(await passes(ALL_COMERCIAL, ['B2B'])).toBe(true)
    expect(await passes(ALL_COMERCIAL, ['GERENCIA'])).toBe(true)
  })

  // /b2b/leads lista con comercialService.leadList, que pega a
  // /comercial/leadlist. LIDER_B2B (creado 2026-08-28) no estaba en la lista y
  // sin el modulo COMERCIAL en la matriz recibia 403, que la pantalla mostraba
  // como "0 de 0" en vez de como error.
  it('ALL_COMERCIAL y ALL_B2B dejan pasar a LIDER_B2B por rol, sin depender de la matriz', async () => {
    expect(await passes(ALL_COMERCIAL, ['LIDER_B2B'])).toBe(true)
    expect(await passes(ALL_B2B, ['LIDER_B2B'])).toBe(true)
    expect(await passes(ALL_INTERNAL, ['LIDER_B2B'])).toBe(true)
  })
})

// El combo "Empresa vinculada" (formulario de leads y ficha de cliente) pega a
// /b2b/companylist y /b2b/companycaller, y el alta de empresa a
// /b2b/companyregister. ALL_B2B no incluia a Comercial: el asesor recibia 403 y
// SearchSelect lo pintaba como "No se encontraron resultados".
describe('gate del modulo B2B desde Comercial', () => {
  it('ALL_B2B deja pasar a Comercial y Lider Comercial', async () => {
    expect(await passes(ALL_B2B, ['COMERCIAL'])).toBe(true)
    expect(await passes(ALL_B2B, ['LIDER_COMERCIAL'])).toBe(true)
  })

  it('conserva a quienes ya entraban', async () => {
    for (const rol of ['ADMIN', 'B2B', 'LIDER_B2B', 'GERENCIA', 'FUNDACION', 'LIDER_FUNDACION']) {
      expect(await passes(ALL_B2B, [rol])).toBe(true)
    }
  })

  it('no abre la puerta a cualquiera', async () => {
    expect(await passes(ALL_B2B, ['ACADEMICA'])).toBe(false)
    expect(await passes(ALL_B2B, [])).toBe(false)
  })
})
