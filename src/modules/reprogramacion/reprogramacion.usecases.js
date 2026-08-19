import { reprogramacionRepository } from './reprogramacion.repository.js'
import {
  ESTADO,
  ReprogramacionError,
  assertPuedeAceptar,
  assertPuedeProponer,
  buildJustificacion,
  netoDeLaVenta,
  resolveDestKind
} from './reprogramacion.entity.js'
// El movimiento real lo hacen los casos de uso de FICO, que ya saben mover el
// ERP, tocar Odoo y mandar el correo. Aca solo se decide CUAL de los dos corre.
import { courseChange, reprogramEdition } from '../fico/enrollment/enrollment.usecases.js'

const repo = reprogramacionRepository

export async function listAffected () {
  return repo.listAffected()
}

export async function listDestinationEditions ({ programVersionId }) {
  if (!programVersionId) throw new ReprogramacionError('Falta el programa')
  return repo.listDestinationEditions(programVersionId)
}

// Academica elige el destino. No ejecuta nada: solo deja la propuesta.
export async function proposeDestination ({ enrollmentId, destProgramVersionId, destEditionId, userId }) {
  const venta = await repo.getVenta(enrollmentId)
  if (!venta) throw new ReprogramacionError('La inscripcion no existe o no esta activa')

  assertPuedeProponer(await repo.getCase(enrollmentId))

  const destKind = resolveDestKind({
    originProgramVersionId: venta.program_version_id,
    destProgramVersionId,
    destEditionId
  })
  return repo.upsertProposal({ enrollmentId, destProgramVersionId, destEditionId, destKind, userId })
}

export async function markContacted ({ enrollmentId, notes, userId }) {
  const caso = await repo.markContacted({ enrollmentId, notes, userId })
  if (!caso) throw new ReprogramacionError('El caso no existe: primero hay que elegir el destino')
  return caso
}

export async function rejectCase ({ enrollmentId, notes, userId }) {
  const caso = await repo.saveVerdict({ enrollmentId, status: ESTADO.RECHAZADO, notes, userId })
  if (!caso) throw new ReprogramacionError('El caso no existe')
  return caso
}

// Veredicto de FICO. Ejecuta el movimiento completo y guarda lo que quede a
// medias: mover al alumno importa mas que dejar el campus perfecto, y el paso
// de Odoo que falla (tipicamente el unlink del aula vieja, por permisos) queda
// anotado para hacerlo a mano en vez de bloquear al alumno.
export async function acceptCase ({ enrollmentId, notes, userId }) {
  const caso = await repo.getCase(enrollmentId)
  assertPuedeAceptar(caso)

  const venta = await repo.getVenta(enrollmentId)
  if (!venta) throw new ReprogramacionError('La inscripcion no existe o no esta activa')

  const justificacion = buildJustificacion({
    edicionesCaidas: [],
    destino: `edicion #${caso.dest_edition_id || 's/e'}`
  })

  const resultado = caso.dest_kind === 'RP'
    ? await reprogramEdition({
        enrollmentId,
        newEditionId: caso.dest_edition_id,
        justificacion,
        userId
      })
    : await courseChange({
        enrollmentId,
        newProgramVersionId: caso.dest_program_version_id,
        newEditionId: caso.dest_edition_id,
        // Mismo neto que ya pago: la edicion la cancelamos nosotros, el alumno
        // no debe pagar la diferencia dentro de este flujo.
        totalAmount: netoDeLaVenta(venta),
        justificacion,
        userId,
        cat_currency: venta.cat_currency
      })

  return repo.saveVerdict({
    enrollmentId,
    status: ESTADO.ACEPTADO,
    notes,
    userId,
    newEnrollmentId: resultado.new_enrollment_id,
    pendingSteps: pasosPendientes(resultado)
  })
}

// El RP delega Odoo y correo a un job con reintentos; el CC los corre inline y
// se traga los fallos con safeAsync. En los dos casos el unico dato duro que
// vuelve es si quedo correo por mandar, asi que lo demas se marca como "revisar
// en el campus" en lugar de afirmar que salio bien.
function pasosPendientes (resultado) {
  const pendientes = []
  if (resultado?.email_pending) pendientes.push('correo en cola (job de FICO)')
  pendientes.push('verificar en Odoo: inscrito en el aula nueva y retirado de la vieja')
  return pendientes
}
