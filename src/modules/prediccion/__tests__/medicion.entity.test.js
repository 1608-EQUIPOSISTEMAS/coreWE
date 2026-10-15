import { describe, it, expect } from 'vitest'
import { buildMeasurement, differsBeyondChance, MIN_GROUP_SAMPLE } from '../medicion.entity.js'
import { isControl, controlWithinReach, CONTROL_SHARE } from '../bandeja.entity.js'

describe('isControl', () => {
  it('es fijo por telefono: el mismo numero siempre cae en el mismo grupo', () => {
    expect(isControl('912345678')).toBe(isControl('912345678'))
  })

  it(`sortea ~${CONTROL_SHARE}% de los telefonos`, () => {
    const phones = Array.from({ length: 20000 }, (_, i) => String(900000000 + i * 37))
    const share = (100 * phones.filter(isControl).length) / phones.length
    expect(share).toBeGreaterThan(CONTROL_SHARE - 1.5)
    expect(share).toBeLessThan(CONTROL_SHARE + 1.5)
  })
})

describe('buildMeasurement', () => {
  const fila = (is_control, probability, total, compraron) => ({ is_control, probability, total, compraron })

  it('compara llamados contra control dentro del mismo segmento y saca el lift', () => {
    const [nueve] = buildMeasurement([fila(false, 9, 400, 60), fila(true, 9, 100, 5)])
    expect(nueve).toMatchObject({
      segmento: 'Cliente, consultó 2+ veces',
      llamados: { n: 400, compraron: 60, tasa: 15 },
      control: { n: 100, compraron: 5, tasa: 5 },
      lift: 3,
      significativo: true,
      veredicto: 'FUNCIONA'
    })
  })

  it('la prueba A/A del 15/10/26 (nadie llamo) NO se declara ganadora: es azar', () => {
    const [s] = buildMeasurement([fila(false, 4.4, 1247, 54), fila(true, 4.4, 340, 8)])
    expect(s).toMatchObject({ lift: 1.8, significativo: false, veredicto: 'AZAR' })
  })

  it('la significancia crece con la muestra: la misma diferencia con 10x casos ya no es azar', () => {
    expect(differsBeyondChance({ n: 1247, compraron: 54 }, { n: 340, compraron: 8 })).toBe(false)
    expect(differsBeyondChance({ n: 12470, compraron: 540 }, { n: 3400, compraron: 80 })).toBe(true)
  })

  it(`con menos de ${MIN_GROUP_SAMPLE} por lado no inventa lift ni calibracion`, () => {
    const [s] = buildMeasurement([fila(false, 4.4, 200, 20), fila(true, 4.4, MIN_GROUP_SAMPLE - 1, 1)])
    expect(s).toMatchObject({ lift: null, calibrado: null, veredicto: 'SIN_MUESTRA' })
  })

  it('calibrado = lo esperado cae dentro del margen de error del control', () => {
    expect(buildMeasurement([fila(false, 9, 100, 10), fila(true, 9, 300, 27)])[0].calibrado).toBe(true)
    // 9% esperado y el control compra 1%: el % que ve el asesor esta inflado.
    expect(buildMeasurement([fila(false, 9, 100, 10), fila(true, 9, 300, 3)])[0].calibrado).toBe(false)
  })

  it('ordena del segmento mas probable al menos', () => {
    const out = buildMeasurement([fila(false, 4.4, 10, 1), fila(false, 9, 10, 1)])
    expect(out.map((s) => s.esperado)).toEqual([9, 4.4])
  })
})

describe('controlWithinReach', () => {
  const c = (phone_key, rank) => ({ phone_key, rank })

  it('el control solo entra hasta donde llego el cupo de los llamados', () => {
    const out = controlWithinReach({ control: [c('a', 9), c('b', 4.4), c('z', 2.2)], assigned: [c('x', 9), c('y', 4.4)] })
    expect(out.map((x) => x.phone_key)).toEqual(['a', 'b'])
  })

  it('si no se asigno a nadie no hay control (no hay contra que comparar)', () => {
    expect(controlWithinReach({ control: [c('a', 9)], assigned: [] })).toEqual([])
  })
})
