// Aula E4-26 de PLANEAMIENTO FINANCIERO (15100): los modulos cuyo padre esta en
// una edicion A5 (diploma cancelado) no deben contar. Se comprueba el invariante,
// no un numero fijo: AULA == suma comercial == filas de la Lista de Notas.
import 'dotenv/config'
import { editionRepository } from '../src/modules/edition/edition.repository.js'
import { pool } from '../src/shared/db/pool.js'

const AULA = 15100
const [m] = await editionRepository.classroomChannelMetricsList([AULA])
const comercial = m.cnt_ventas + m.cnt_segui + m.cnt_memb + m.cnt_b2b + m.cnt_becas
const alumnos = await editionRepository.classroomStudentsList(AULA)

console.log('metricas :', m)
console.log('comercial:', comercial, '| aula:', m.cnt_aula, '| lista:', alumnos.length)
console.assert(m.cnt_aula === comercial, `aula ${m.cnt_aula} != comercial ${comercial}`)
console.assert(alumnos.length === m.cnt_total, `lista ${alumnos.length} != total ${m.cnt_total}`)
await pool.end()
