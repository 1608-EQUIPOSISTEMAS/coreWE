import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  RUBRIC_KEYS_V1,
  RUBRIC_KEYS_V2,
  NOTA_MAXIMA_RUBRICA,
  FECHA_CORTE_RUBRICA,
  rubricaDe,
  notaRubrica,
  attachSessionAudits
} from '../edition.entity.js'

// Las dos rubricas viven en dos lados que nada ata en runtime: RUBRIC_V1/V2 en
// el .vue (lo que ve el auditor) y RUBRIC_KEYS_* en la entidad (lo que califica
// el SQL). El .vue se lee como TEXTO porque no exporta nada; es la unica red
// contra la deriva silenciosa entre ambos.
const vue = readFileSync(
  fileURLToPath(new URL('../../../../../Frontend/src/views/academica/AulaDetail.vue', import.meta.url)),
  'utf8'
)
const clavesDelFrontend = (desde, hasta) => [
  ...vue.slice(vue.indexOf(desde), vue.indexOf(hasta))
    .matchAll(/'((?:interaction|content|environment|communication)\.\d+)'/g)
].map((m) => m[1])

const marcarTodo = (keys) => Object.fromEntries(keys.map((k) => [k, true]))

describe('rubrica de auditoria de aula', () => {
  it('marcar todos los criterios da la nota maxima en las dos versiones', () => {
    expect(notaRubrica(marcarTodo(RUBRIC_KEYS_V1), '2026-08-20')).toBe(NOTA_MAXIMA_RUBRICA)
    expect(notaRubrica(marcarTodo(RUBRIC_KEYS_V2), '2026-09-20')).toBe(NOTA_MAXIMA_RUBRICA)
  })

  it('la vigente son 10 criterios de 2 puntos; la anterior 20 de 1', () => {
    expect(RUBRIC_KEYS_V2).toHaveLength(10)
    expect(rubricaDe(null).puntosPorCriterio).toBe(2)
    expect(RUBRIC_KEYS_V1).toHaveLength(20)
    expect(rubricaDe('2026-01-01').puntosPorCriterio).toBe(1)
  })

  it('el corte parte el 15/09: ese dia todavia es la rubrica anterior', () => {
    expect(rubricaDe(`${FECHA_CORTE_RUBRICA}T23:59:00Z`).version).toBe(1)
    expect(rubricaDe('2026-09-16T00:01:00Z').version).toBe(2)
    // Sin fecha es una rubrica que se esta llenando ahora.
    expect(rubricaDe(null).version).toBe(2)
  })

  it('una auditoria vieja conserva su nota aunque la rubrica haya cambiado', () => {
    // 16 de los 20 criterios viejos marcados = 16/20, no 16 sobre 10.
    const criteria = marcarTodo(RUBRIC_KEYS_V1.slice(0, 16))
    expect(notaRubrica(criteria, '2026-08-20')).toBe(16)
  })

  it('las marcas retiradas no suman en una auditoria nueva', () => {
    const criteria = { ...marcarTodo(RUBRIC_KEYS_V1), ...marcarTodo(RUBRIC_KEYS_V2) }
    expect(notaRubrica(criteria, '2026-09-20')).toBe(NOTA_MAXIMA_RUBRICA)
  })

  it('la rubrica que ve el auditor es la que califica el backend', () => {
    const v1 = clavesDelFrontend('const RUBRIC_V1 = [', '// VIGENTE.')
    const v2 = clavesDelFrontend('const RUBRIC_V2 = [', 'const NOTA_MAXIMA_RUBRICA')
    expect([...v1].sort()).toEqual([...RUBRIC_KEYS_V1].sort())
    expect([...v2].sort()).toEqual([...RUBRIC_KEYS_V2].sort())
    expect(new Set(v1).size).toBe(v1.length)
    expect(new Set(v2).size).toBe(v2.length)
  })

  it('pega la nota /20 que ya viene calculada del repositorio', () => {
    const row = { edition_num_id: 7, sessions: [{ session_number: 1 }, { session_number: 2 }] }
    const { sessions } = attachSessionAudits(row, [
      { program_edition_id: 7, session_number: 1, manual_score20: 18, ai_score20: 16 }
    ])
    expect(sessions[0].manual_20).toBe(18)
    // Sin fila de rubrica la nota es null: "no auditada" no es "auditada en cero".
    expect(sessions[1].manual_20).toBeNull()
  })
})
