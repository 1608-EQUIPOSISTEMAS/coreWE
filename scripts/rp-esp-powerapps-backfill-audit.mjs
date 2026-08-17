// Backfill de la bitacora del RP de la ESP. POWER APPS E23 -> E24
// (ver rp-esp-powerapps-15435-a-15441.mjs).
//
// POR QUE existe: repo.logAudit es un PUERTO que solo cablea fico.bootstrap.js
// (enrollment.repository.js:26) y por defecto es no-op. El script del RP importo
// los usecases sin el bootstrap, asi que las mutaciones se aplicaron pero las
// entradas de auditoria se perdieron en silencio. Esto las repone con el mismo
// formato que habria escrito reprogramEdition (usecases 275-316 y 264-270).
//
// Idempotente: no reescribe si la entrada ya existe.
import 'dotenv/config'
import '../src/modules/fico/fico.bootstrap.js'
import { logAudit } from '../src/modules/fico/audit/audit.usecases.js'
import { pool } from '../src/config/db.js'

const USER_ID = 9 // ADMIN
const JUSTIFICACION =
  'Edicion ESP. POWER APPS Y AUT. E23 (12/09) cancelada (A5). Producto reubica ' +
  'las ventas en la E24 (20/09). Reprogramacion aplicada desde script tras ' +
  'verificar que ningun alumno fue movido y que no hay venta duplicada en la E24.'

const EDICION = {
  origen: { code: 'E23', fecha: '12/09/2026', id: 15435 },
  destino: { code: 'E24', fecha: '20/09/2026', id: 15441 }
}
const label = e => `${e.code} (${e.fecha})`

// origen -> destino, con los hijos retirados de cada uno (nombre tal como los
// arma reprogramEdition: `${child_program_name} ${edition_code}`).
const CASOS = [
  {
    origen: 13604,
    destino: 16590,
    hijosRetirados: [
      { id: 13605, label: 'POWER APPS Y POWER AUTOMATE E28' },
      { id: 13606, label: 'POWER APPS Y POWER AUTOMATE AVANZADO E22' }
    ]
  },
  {
    origen: 13647,
    destino: 16593,
    hijosRetirados: [
      { id: 13648, label: 'POWER APPS Y POWER AUTOMATE E28' },
      { id: 13649, label: 'POWER APPS Y POWER AUTOMATE AVANZADO E22' }
    ]
  }
]

const yaAuditado = async (enrollmentId, action) => {
  const { rows } = await pool.query(
    'SELECT 1 FROM enrollment_audit_log WHERE enrollment_id = $1 AND action = $2 LIMIT 1',
    [enrollmentId, action]
  )
  return rows.length > 0
}

const auditarSiFalta = async ({ enrollmentId, action, changes, details }) => {
  if (await yaAuditado(enrollmentId, action)) {
    console.log(`  #${enrollmentId} ${action}: ya existe, se saltea`)
    return
  }
  await logAudit({ enrollmentId, action, userId: USER_ID, justificacion: JUSTIFICACION, changes, details })
  console.log(`  #${enrollmentId} ${action}: escrito`)
}

for (const { origen, destino, hijosRetirados } of CASOS) {
  console.log(`\n#${origen} -> #${destino}`)

  await auditarSiFalta({
    enrollmentId: origen,
    action: 'edition_reprogrammed',
    changes: {
      Edicion: { old: label(EDICION.origen), new: label(EDICION.destino) },
      'Nuevo enrollment': { old: '---', new: `#${destino}` },
      // Anclas estables para el historial del aula (classroomStudentsHistory).
      old_edition_id: EDICION.origen.id,
      new_edition_id: EDICION.destino.id,
      new_enrollment_id: destino,
      'Modulos retirados': { old: '---', new: hijosRetirados.map(h => h.label).join(', ') }
    },
    details: `Reprogramacion de edicion: ${label(EDICION.origen)} → ${label(EDICION.destino)}. Nueva inscripcion #${destino}`
  })

  await auditarSiFalta({
    enrollmentId: destino,
    action: 'created_from_rp',
    changes: {
      'Edicion origen': { old: '---', new: label(EDICION.origen) },
      'Edicion nueva': { old: '---', new: label(EDICION.destino) },
      'Enrollment origen': { old: '---', new: `#${origen}` }
    },
    details: `Creado por reprogramacion de #${origen}: ${label(EDICION.origen)} → ${label(EDICION.destino)}`
  })

  for (const hijo of hijosRetirados) {
    await auditarSiFalta({
      enrollmentId: hijo.id,
      action: 'retired',
      changes: null,
      details: `Retirado por reprogramacion del programa padre #${origen} hacia ${EDICION.destino.code} (nueva inscripcion #${destino})`
    })
  }
}

await pool.end()
process.exit(0)
