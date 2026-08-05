// Chequeo runnable del reporte de objetivos del evento (Fundacion > Objetivos).
// Corre contra la BD real: es una regla de atribucion, no aritmetica, y lo que
// puede romperse es que un alias del catalogo cambie y las ventas se caigan a
// "Otros" sin que nadie se entere.
//
//   cd Backend && node scripts/check-event-goals.mjs
import assert from 'node:assert/strict'
import { eventGoalsReport, eventGoalsSave } from '../src/modules/edition/edition.usecases.js'

const ED = 15933 // V CONGRESO DE DIRECCION

const r = await eventGoalsReport({ edition_num_id: ED })
assert.ok(r, 'el reporte no puede venir nulo para una edicion existente')

// 1. Toda inscripcion viva cae en exactamente un area: la suma de las areas
//    tiene que dar el total, sin dobles conteos ni ventas perdidas.
const suma = r.areas.reduce((a, x) => a + x.avance, 0)
assert.equal(suma, r.avance_total, 'la suma por area no cuadra con el total')

// 2. Y dentro del area, la suma por modalidad no puede pasarse del avance
//    (puede quedar corta: las inscripciones viejas no tienen categoria).
for (const a of r.areas) {
  const porMod = r.modalidades.reduce((acc, m) => acc + (a[m.key] || 0), 0)
  assert.ok(porMod + a.sin_categoria === a.avance,
    `${a.name}: modalidades (${porMod}) + sin categoria (${a.sin_categoria}) != avance (${a.avance})`)
}

// 3. Los hijos de Members reparten el total del padre, no lo duplican.
const members = r.areas.find(a => a.code === '1.7')
if (members?.children?.length) {
  const hijos = members.children.reduce((acc, c) => acc + c.avance, 0)
  assert.equal(hijos, members.avance, 'los tiers no suman el total de Members')
}

// 4. El objetivo se guarda saneado: areas desconocidas y negativos se caen.
const antes = structuredClone(r.goals)
const { goals } = await eventGoalsSave({
  edition_num_id: ED,
  goals: { ...antes, '9.9': { vip: 5 }, '1.3': { vip: -3, general: 2 } },
  user_id: 9
})
assert.ok(!goals['9.9'], 'guardo un area que no existe')
assert.ok(!goals['1.3']?.vip, 'guardo un objetivo negativo')
assert.equal(goals['1.3']?.general, 2, 'perdio un objetivo valido')
await eventGoalsSave({ edition_num_id: ED, goals: antes, user_id: 9 }) // deja todo como estaba

// 5. La clasificacion sigue viva: si manana cambian los alias del catalogo,
//    todo se iria a "Otros" en silencio y el reporte parecerian datos buenos.
const otros = r.areas.find(a => a.code === '1.6')
assert.ok(otros.avance < r.avance_total || r.avance_total === 0,
  'TODAS las ventas cayeron en Otros: la regla de atribucion dejo de enganchar')

console.log(`OK — ${r.avance_total} inscritos, ${r.leads_total} consultas, ` +
            `modalidades: ${r.modalidades.map(m => m.key).join('/')}`)
process.exit(0)
