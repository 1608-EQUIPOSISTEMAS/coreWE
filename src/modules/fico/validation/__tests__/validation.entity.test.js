import { describe, it, expect } from 'vitest'
import {
  buildValidationContext,
  buildEditionMap,
  buildTreeEditionMap,
  annotateChildrenWithTree,
  findUnassignableChildren,
  buildEditionPlan,
  buildValidationRows,
  EDITION_OVERRIDE
} from '../validation.entity.js'

describe('buildValidationContext', () => {
  it('marca como convalidados solo los que no son edition_override', () => {
    const { validatedSet } = buildValidationContext([
      { child_version_id: 10, validation_type: 'same_edition' },
      { child_version_id: 11, validation_type: 'cross_edition' },
      { child_version_id: 12, validation_type: EDITION_OVERRIDE }
    ])
    expect(validatedSet.has(10)).toBe(true)
    expect(validatedSet.has(11)).toBe(true)
    expect(validatedSet.has(12)).toBe(false)
  })

  it('indexa custom_edition_id por hijo, incluido el edition_override', () => {
    const { customEditions } = buildValidationContext([
      { child_version_id: 12, validation_type: EDITION_OVERRIDE, custom_edition_id: 555 },
      { child_version_id: 13, validation_type: 'cross_edition', custom_edition_id: null }
    ])
    expect(customEditions).toEqual({ 12: 555 })
  })
})

describe('buildEditionMap', () => {
  it('normaliza edition_id / edition_num_id a editionId', () => {
    const map = buildEditionMap([
      { child_program_version_id: 1, edition_id: 100, global_code: 'A1', start_date: '2026-01-01', sort_order: 1 },
      { child_program_version_id: 2, edition_num_id: 200 }
    ])
    expect(map[1].editionId).toBe(100)
    expect(map[1].globalCode).toBe('A1')
    expect(map[2].editionId).toBe(200)
  })

  it('ignora hijos sin edicion', () => {
    const map = buildEditionMap([{ child_program_version_id: 3 }])
    expect(map[3]).toBeUndefined()
  })
})

describe('findUnassignableChildren', () => {
  const childrenStruct = [
    { child_program_version_id: 1, child_name: 'Mod A' },
    { child_program_version_id: 2, child_name: 'Mod B' },
    { child_program_version_id: 3, child_name: 'Mod C' }
  ]

  it('no reporta hijos convalidados, en arbol o con custom edition', () => {
    const errors = findUnassignableChildren({
      childrenStruct,
      validatedSet: new Set([1]),
      editionMap: { 2: { editionId: 200 } },
      customEditions: { 3: 300 }
    })
    expect(errors).toEqual([])
  })

  it('reporta el hijo sin edicion en arbol y sin custom edition', () => {
    const errors = findUnassignableChildren({
      childrenStruct,
      validatedSet: new Set(),
      editionMap: { 1: { editionId: 100 }, 2: { editionId: 200 } },
      customEditions: {}
    })
    expect(errors).toHaveLength(1)
    expect(errors[0].child_program_version_id).toBe(3)
    expect(errors[0].child_name).toBe('Mod C')
  })
})

describe('buildEditionPlan', () => {
  const childrenStruct = [
    { child_program_version_id: 1, child_name: 'Mod A', sort_order: 1 },
    { child_program_version_id: 2, child_name: 'Mod B', sort_order: 2 },
    { child_program_version_id: 3, child_name: 'Mod C', sort_order: 3 }
  ]

  it('sin convalidacion ni override el padre cubre a los hijos (no E0)', () => {
    const { editionPlan, skipped, isE0 } = buildEditionPlan({
      childrenStruct,
      validatedSet: new Set(),
      editionMap: {
        1: { editionId: 100, globalCode: 'A-26', sortOrder: 1 },
        2: { editionId: 200, globalCode: 'B-26', sortOrder: 2 },
        3: { editionId: 300, globalCode: 'C-26', sortOrder: 3 }
      },
      customEditions: {}
    })
    expect(skipped).toEqual([])
    expect(isE0).toBe(false)
    expect(editionPlan.map(p => p.childPvId)).toEqual([1, 2, 3])
  })

  // Escenario 1: convalida el modulo 1 -> solo se inscriben 2 y 3, y como el
  // slide_group del padre daria acceso tambien al convalidado, van individuales.
  it('convalidar un modulo salta ese hijo y fuerza E0 sobre el resto', () => {
    const { editionPlan, skipped, isE0 } = buildEditionPlan({
      childrenStruct,
      validatedSet: new Set([1]),
      editionMap: {
        2: { editionId: 200, globalCode: 'B-26', sortOrder: 2 },
        3: { editionId: 300, globalCode: 'C-26', sortOrder: 3 }
      },
      customEditions: {}
    })
    expect(skipped).toEqual([])
    expect(isE0).toBe(true)
    expect(editionPlan.map(p => p.childPvId)).toEqual([2, 3])
    expect(editionPlan[0]).toMatchObject({ editionId: 200, globalCode: 'B-26' })
  })

  // Escenario 2: los 3 se inscriben, pero el modulo 1 en su edicion elegida.
  it('custom edition gana sobre la del arbol y desengancha al padre', () => {
    const { editionPlan, isE0 } = buildEditionPlan({
      childrenStruct,
      validatedSet: new Set(),
      editionMap: {
        1: { editionId: 100, globalCode: 'A-tree', sortOrder: 1 },
        2: { editionId: 200, globalCode: 'B-26', sortOrder: 2 },
        3: { editionId: 300, globalCode: 'C-26', sortOrder: 3 }
      },
      customEditions: { 1: 999 }
    })
    expect(isE0).toBe(true)
    expect(editionPlan.map(p => p.editionId)).toEqual([999, 200, 300])
    expect(editionPlan[0].isOutsideTree).toBe(true)
    expect(editionPlan[1].isOutsideTree).toBe(false)
  })

  it('custom edition igual a la del arbol no cuenta como fuera del arbol', () => {
    const { isE0, editionPlan } = buildEditionPlan({
      childrenStruct: [childrenStruct[0]],
      validatedSet: new Set(),
      editionMap: { 1: { editionId: 100, globalCode: 'A-tree', sortOrder: 1 } },
      customEditions: { 1: '100' }
    })
    expect(isE0).toBe(false)
    expect(editionPlan[0].isOutsideTree).toBe(false)
  })

  it('marca E0 cuando un hijo fuera del arbol se inscribe via custom edition', () => {
    const { editionPlan, isE0 } = buildEditionPlan({
      childrenStruct: [childrenStruct[0]],
      validatedSet: new Set(),
      editionMap: {},
      customEditions: { 1: 999 }
    })
    expect(isE0).toBe(true)
    expect(editionPlan[0].isOutsideTree).toBe(true)
    expect(editionPlan[0].globalCode).toBe('(custom-999)')
  })

  it('hijo fuera del arbol sin custom edition se salta y no fuerza E0', () => {
    const { editionPlan, skipped, isE0 } = buildEditionPlan({
      childrenStruct: [childrenStruct[0]],
      validatedSet: new Set(),
      editionMap: {},
      customEditions: {}
    })
    expect(editionPlan).toEqual([])
    expect(skipped).toEqual([{ childPvId: 1, childName: 'Mod A' }])
    expect(isE0).toBe(false)
  })
})

describe('buildValidationRows', () => {
  it('clasifica convalidados y guarda la edicion elegida de los que SI se inscriben', () => {
    const rows = buildValidationRows({
      validatedChildren: [1],
      customEditions: { 2: 999 }
    })
    expect(rows).toEqual([
      { childVersionId: 1, validationType: 'same_edition', customEditionId: null },
      { childVersionId: 2, validationType: EDITION_OVERRIDE, customEditionId: 999 }
    ])
  })

  it('un convalidado con edicion propia es cross_edition, no override', () => {
    const rows = buildValidationRows({ validatedChildren: [1], customEditions: { 1: 555 } })
    expect(rows).toEqual([{ childVersionId: 1, validationType: 'cross_edition', customEditionId: 555 }])
  })

  it('sin convalidados devuelve solo los overrides', () => {
    const rows = buildValidationRows({ validatedChildren: [], customEditions: { 7: 42 } })
    expect(rows).toEqual([{ childVersionId: 7, validationType: EDITION_OVERRIDE, customEditionId: 42 }])
  })
})

describe('buildTreeEditionMap / annotateChildrenWithTree', () => {
  it('mapea cada hijo del arbol a su edicion y anota las filas del programa', () => {
    const treeMap = buildTreeEditionMap([
      { child_program_version_id: 1, edition_id: 100 },
      { child_program_version_id: 2, edition_num_id: 200 }
    ])
    const rows = [
      { child_program_version_id: 1, child_name: 'A' },
      { child_program_version_id: 9, child_name: 'Z' }
    ]
    const annotated = annotateChildrenWithTree(rows, treeMap)
    expect(annotated[0]).toMatchObject({ tree_edition_id: 100, is_in_parent_tree: true })
    expect(annotated[1]).toMatchObject({ tree_edition_id: null, is_in_parent_tree: false })
  })
})
