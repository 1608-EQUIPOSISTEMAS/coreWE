// Punto de acceso canonico a Postgres para la arquitectura modular.
// Reexporta el pool unico definido en config/db.js. Los modulos nuevos importan
// desde shared/db; el codigo legacy sigue importando desde config/db.js mientras
// dura la migracion (patron strangler-fig).
export { pool, query, withTransaction } from '../../config/db.js'
