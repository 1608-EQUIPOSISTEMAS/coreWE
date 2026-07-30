// Verificacion de la rama "modulo ONLINE sin edicion" de buildEditionPlan /
// findUnassignableChildren (fix 30/07/2026, caso 14709 ESP. EN ANALISIS DE DATOS).
//
// Es pura: no toca BD ni red. Corre con:  node scripts/verifica-hijos-online-sin-edicion.mjs
// Sale con codigo != 0 si la rama se rompe.
import assert from 'node:assert/strict'
import { buildEditionPlan, findUnassignableChildren } from '../src/modules/fico/validation/validation.entity.js'

const vacio = { validatedSet: new Set(), editionMap: {}, customEditions: {} }
let ok = 0
const check = (nombre, fn) => {
  try { fn(); ok++; console.log('  OK   ' + nombre) } catch (e) { console.error('  FALLA ' + nombre + '\n        ' + e.message); process.exitCode = 1 }
}

console.log('\n[1] Modulo ONLINE (has_own_editions=false) -> se inscribe con edicion NULL')
// Caso real 14709: ESP. EN ANALISIS DE DATOS = SQL SERVER + PYTHON + POWER BI,
// ninguno con program_editions. Antes del fix los 3 caian en `skipped`.
const online = [
  { child_program_version_id: 119, sort_order: 1, child_name: 'SQL SERVER', has_own_editions: false },
  { child_program_version_id: 121, sort_order: 2, child_name: 'PYTHON', has_own_editions: false },
  { child_program_version_id: 120, sort_order: 3, child_name: 'POWER BI: APLICATIVO', has_own_editions: false }
]
const rOnline = buildEditionPlan({ childrenStruct: online, ...vacio })
check('los 3 modulos entran al plan', () => assert.equal(rOnline.editionPlan.length, 3))
check('ninguno queda saltado', () => assert.equal(rOnline.skipped.length, 0))
check('todos con editionId null', () => assert.ok(rOnline.editionPlan.every(p => p.editionId === null)))
check('NO dispara E0 (nada de desinscribir al padre ni correos individuales)', () => assert.equal(rOnline.isE0, false))
check('conserva el sort_order de la estructura', () => assert.deepEqual(rOnline.editionPlan.map(p => p.sortOrder), [1, 2, 3]))
check('no bloquea la confirmacion', () => assert.equal(findUnassignableChildren({ childrenStruct: online, ...vacio }).length, 0))

console.log('\n[2] Modulo PRESENCIAL mal configurado (has_own_editions=true) -> se sigue saltando')
// Esta es la proteccion que NO debe cambiar: el modulo tiene ediciones pero
// ninguna asignada en el arbol del padre => el operador debe convalidar o elegir.
const malConfig = [{ child_program_version_id: 49, sort_order: 1, child_name: 'GEST. COMP. Y PROV.', has_own_editions: true }]
const rMal = buildEditionPlan({ childrenStruct: malConfig, ...vacio })
check('no entra al plan', () => assert.equal(rMal.editionPlan.length, 0))
check('queda en skipped', () => assert.equal(rMal.skipped.length, 1))
check('sigue bloqueando la confirmacion', () => assert.equal(findUnassignableChildren({ childrenStruct: malConfig, ...vacio }).length, 1))

console.log('\n[3] Sin el flag (undefined) el comportamiento historico se mantiene')
// Cualquier llamador viejo que no traiga has_own_editions no debe cambiar.
const sinFlag = [{ child_program_version_id: 999, sort_order: 1, child_name: 'LEGACY' }]
const rSinFlag = buildEditionPlan({ childrenStruct: sinFlag, ...vacio })
check('se salta como antes', () => assert.equal(rSinFlag.skipped.length, 1))
check('sigue bloqueando como antes', () => assert.equal(findUnassignableChildren({ childrenStruct: sinFlag, ...vacio }).length, 1))

console.log('\n[4] Paquete MIXTO: modulo con edicion del arbol + modulo online')
const mixto = [
  { child_program_version_id: 200, sort_order: 1, child_name: 'PLAN. Y PRONOSTICO', has_own_editions: false },
  { child_program_version_id: 49, sort_order: 2, child_name: 'GEST. COMP. Y PROV.', has_own_editions: true }
]
const rMixto = buildEditionPlan({
  childrenStruct: mixto,
  validatedSet: new Set(),
  editionMap: { 49: { editionId: 15045, globalCode: 'E18', sortOrder: 2 } },
  customEditions: {}
})
check('entran los 2 (uno con edicion, otro null)', () => assert.equal(rMixto.editionPlan.length, 2))
check('el online va con null y el otro con su edicion', () => {
  assert.equal(rMixto.editionPlan.find(p => p.childPvId === 200).editionId, null)
  assert.equal(rMixto.editionPlan.find(p => p.childPvId === 49).editionId, 15045)
})
check('el modulo online NO fuerza E0', () => assert.equal(rMixto.isE0, false))

console.log('\n[5] E0 real (edicion custom fuera del arbol) sigue funcionando')
const e0 = [{ child_program_version_id: 30, sort_order: 1, child_name: 'MODULO', has_own_editions: true }]
const rE0 = buildEditionPlan({ childrenStruct: e0, validatedSet: new Set(), editionMap: {}, customEditions: { 30: 14790 } })
check('entra al plan con la edicion custom', () => assert.equal(rE0.editionPlan[0].editionId, 14790))
check('marca isE0', () => assert.equal(rE0.isE0, true))

console.log(`\n${process.exitCode ? 'FALLARON verificaciones' : 'TODO OK'} (${ok} asserts)\n`)
