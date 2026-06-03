import { describe, it, expect } from 'vitest'

// Ejemplo de test unitario de una "entity" (logica de dominio pura, sin BD ni
// red). Es el patron que seguiran las reglas extraidas en Fase 2 (B2B, LAPTOP,
// E0, hijos SEG, montos de token, etc.): funcion pura -> assert sin mocks.
//
// Cuando exista modules/fico/.../enrollment.entity.js, este archivo se borra y
// se reemplaza por enrollment.entity.test.js con las reglas reales.

function hasLaptopPromo (discountName = '') {
  return /laptop/i.test(discountName)
}

describe('hasLaptopPromo (ejemplo de entity pura)', () => {
  it('detecta la promo LAPTOP sin importar mayusculas', () => {
    expect(hasLaptopPromo('Descuento LAPTOP 2026')).toBe(true)
    expect(hasLaptopPromo('beca laptop')).toBe(true)
  })

  it('no marca descuentos sin laptop', () => {
    expect(hasLaptopPromo('Beca convenio')).toBe(false)
    expect(hasLaptopPromo('')).toBe(false)
  })
})
