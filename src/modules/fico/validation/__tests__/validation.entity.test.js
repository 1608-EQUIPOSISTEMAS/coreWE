import { describe, it, expect } from 'vitest'
import {
  buildValidationContext,
  buildEditionMap,
  buildTreeEditionMap,
  annotateChildrenWithTree,
  findUnassignableChildren,
  buildEditionPlan,
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

  it('salta convalidados y planifica el resto desde el arbol (no E0)', () => {
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
    expect(isE0).toBe(false)
    expect(editionPlan.map(p => p.childPvId)).toEqual([2, 3])
    expect(editionPlan[0]).toMatchObject({ editionId: 200, isOutsideTree: false, globalCode: 'B-26' })
  })

  it('custom edition gana sobre la edicion del arbol', () => {
    const { editionPlan } = buildEditionPlan({
      childrenStruct: [childrenStruct[0]],
      validatedSet: new Set(),
      editionMap: { 1: { editionId: 100, globalCode: 'A-tree', sortOrder: 1 } },
      customEditions: { 1: 999 }
    })
    expect(editionPlan[0].editionId).toBe(999)
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
