// Backfill de las ediciones A5 que quedaron con alumnos vivos adentro.
//
// Aplica el MISMO RP que usa FICO (origen -> RP, hijos -> R, destino ACT con sus
// hijos SEG) pero SIN tocar Odoo y SIN enviar correos: son correcciones internas
// de datos viejos, no altas nuevas. El flujo normal del modal A5 sigue mandando
// correo; esto es solo para el arrastre historico.
//
// Como se suprime el correo: reprogramEdition encola un job register_followup
// (hijos -> Odoo -> correo) y el worker DESPLEGADO lo procesaria mandando el mail.
// Por eso se anula el encolado y se corre a mano el unico paso interno (hijos SEG).
// No se toca codigo de produccion: la supresion vive aca, en el one-off.
//
// Uso:
//   node scripts/rp-a5-backfill-sin-correo.mjs           # DRY-RUN, no escribe
//   node scripts/rp-a5-backfill-sin-correo.mjs --aplicar # aplica
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import '../src/modules/fico/fico.bootstrap.js' // cablea logAudit (sin el, RP sin bitacora)
import { pool } from '../src/config/db.js'
import { enrollmentRepository } from '../src/modules/fico/enrollment/enrollment.repository.js'
import { reprogramEdition } from '../src/modules/fico/enrollment/enrollment.usecases.js'
import { createChildEnrollments } from '../src/modules/fico/validation/validation.usecases.js'

import { editionRepository } from '../src/modules/edition/edition.repository.js'

// edicion A5 de origen -> edicion destino. SIN LLENAR: cada destino es una
// decision de Producto, no un default. Ver probe-a5-destinos-posibles.mjs; ojo
// que buena parte de las 31 no tiene ninguna edicion futura del mismo programa y
// por lo tanto NO se puede reprogramar (el RP exige mismo program_version_id).
const DESTINOS = {
  // 15011: 15xxx,
}

const USER_ID = 9 // ADMIN
const JUSTIFICACION =
  'Correccion interna: la edicion quedo cancelada (A5) sin migrar a sus alumnos. ' +
  'Reprogramacion aplicada por backfill, sin correo al alumno.'

const aplicar = process.argv.includes('--aplicar')

// El worker desplegado manda el correo si el job llega a la cola: no dejamos que
// llegue. El paso interno que si queremos (hijos SEG) se corre abajo a mano.
let encoladosSuprimidos = 0
enrollmentRepository.enqueueRegisterFollowup = async () => {
  encoladosSuprimidos++
  return { job_id: null }
}

const origenes = Object.keys(DESTINOS).map(Number)
if (origenes.length === 0) {
  console.log('DESTINOS esta vacio: no hay nada que migrar.')
  console.log('Llenalo con { edicionA5: edicionDestino } antes de correr con --aplicar.')
  await pool.end()
  process.exit(0)
}

const respaldo = []
for (const edicionA5 of origenes) {
  const vivos = await editionRepository.a5PendingEnrollments(edicionA5)
  console.log(`\n[${edicionA5}] -> ${DESTINOS[edicionA5]}  ·  ${vivos.length} vivo(s)`)

  for (const alumno of vivos) {
    console.log(`   #${alumno.enrollment_id} ${alumno.is_child ? 'HIJO' : 'TOP '} ${alumno.full_name}`)
    if (!aplicar) continue

    const { rows } = await pool.query('SELECT * FROM enrollments WHERE enrollment_id = $1', [alumno.enrollment_id])
    respaldo.push(rows[0])

    const res = await reprogramEdition({
      enrollmentId: alumno.enrollment_id,
      newEditionId: DESTINOS[edicionA5],
      justificacion: JUSTIFICACION,
      userId: USER_ID
    })
    const nuevo = res.new_enrollment_id
    // Solo el paso interno del job. Odoo y correo se omiten adrede: el usuario
    // pidio (19/08/2026) que este arrastre se corrija SOLO en el ERP, sin tocar
    // el campus ni escribirle al alumno; el aula vieja se coordina a mano.
    await createChildEnrollments({ enrollmentId: nuevo, userId: USER_ID })
    console.log(`      -> destino #${nuevo} (hijos aplicados; sin Odoo, sin correo)`)
  }
}

if (aplicar) {
  writeFileSync(new URL('./_backup_rp_a5_backfill.json', import.meta.url), JSON.stringify(respaldo, null, 2))
  console.log(`\nRespaldo de ${respaldo.length} enrollment(s) -> _backup_rp_a5_backfill.json`)
  console.log(`Correos suprimidos: ${encoladosSuprimidos} job(s) no encolado(s).`)
} else {
  console.log('\nDRY-RUN: no se escribio nada. Corre con --aplicar para ejecutar.')
}

await pool.end()
process.exit(0)
