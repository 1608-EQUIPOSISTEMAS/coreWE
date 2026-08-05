// Objetivo de ventas del V CONGRESO DE DIRECCION (edicion 15933), tal cual la
// lamina "OBJETIVO DE VENTAS" que paso Fundacion el 05/08/2026.
// Re-ejecutable: pisa channel_goals de esa edicion, no toca nada mas.
import { eventGoalsSave, eventGoalsReport } from '../src/modules/edition/edition.usecases.js'

const ED = 15933
const GOALS = {
  '1.5': { vip: 10, general: 11, virtual: 3 },  // FUNDACION -> 24
  '1.1': { vip: 17, general: 15, virtual: 5 },  // COMERCIAL -> 37
  '1.2': { vip: 35, general: 20, virtual: 10 }, // MARKETING -> 65
  '1.4': { vip: 5, general: 5, virtual: 2 }     // B2B       -> 12
}

await eventGoalsSave({ edition_num_id: ED, goals: GOALS, user_id: 9 })
const r = await eventGoalsReport({ edition_num_id: ED })
const suma = Object.values(r.goals).reduce((a, g) => a + Object.values(g).reduce((x, y) => x + y, 0), 0)
console.log('guardado:', JSON.stringify(r.goals, null, 1))
console.log('objetivo total:', suma, '(la lamina dice 118)')
process.exit(0)
