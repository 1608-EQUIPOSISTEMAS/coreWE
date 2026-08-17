// Verifica el cuadro "Avance total por area" (Fundacion > Objetivos) contra la
// misma consulta que sirve la vista: se importa el repositorio, no una copia
// del SQL, para que este sondeo no mienta si la regla de area cambia.
import { pool as scriptPool } from './db.mjs'
import { EditionRepository } from '../src/modules/edition/edition.repository.js'

const EDICION = Number(process.argv[2] || 15933)
const repo = new EditionRepository(scriptPool)
console.table(await repo.eventReportAreas(EDICION))
await scriptPool.end()
