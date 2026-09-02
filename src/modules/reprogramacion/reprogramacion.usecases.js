import { reprogramacionRepository } from './reprogramacion.repository.js'
import {
  ESTADO,
  KIND,
  ReprogramacionError,
  assertPuedeAceptar,
  assertPuedeProponer,
  buildJustificacion,
  cierraSinDestino,
  netoDeLaVenta,
  resolveDestKind
} from './reprogramacion.entity.js'
// El movimiento real lo hacen los casos de uso de FICO, que ya saben mover el
// ERP, tocar Odoo y mandar el correo. Aca solo se decide CUAL de los tres corre.
import { courseChange, reprogramEdition, retireEnrollment } from '../fico/enrollment/enrollment.usecases.js'

const repo = reprogramacionRepository

export async function listAffected () {
  return repo.listAffected()
}

export async function listDestinationEditions ({ programVersionId }) {
  if (!programVersionId) throw new ReprogramacionError('Falta el programa')
  return repo.listDestinationEditions(programVersionId)
}

// Academica elige el destino. No ejecuta nada: solo deja la propuesta.
export async function proposeDestination ({ enrollmentId, destProgramVersionId, destEditionId, salida, userId }) {
  const venta = await repo.getVenta(enrollmentId)
  if (!venta) throw new ReprogramacionError('La inscripcion no existe o no esta activa')

  assertPuedeProponer(await repo.getCase(enrollmentId))

  const destKind = resolveDestKind({
    originProgramVersionId: venta.program_version_id,
    destProgramVersionId,
    destEditionId,
    salida
  })
  // Reembolso y reserva no guardan destino aunque el front haya dejado uno a
  // medio elegir: la fila tiene que quedar sin a-donde para que nadie lo mueva.
  const sinDestino = cierraSinDestino(destKind)
  return repo.upsertProposal({
    enrollmentId,
    destProgramVersionId: sinDestino ? null : destProgramVersionId,
    destEditionId: sinDestino ? null : destEditionId,
    destKind,
    userId
  })
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

// Veredicto de FICO. Ejecuta lo que corresponda y guarda lo que quede a medias:
// mover al alumno importa mas que dejar el campus perfecto, y el paso de Odoo
// que falla (tipicamente el unlink del aula vieja, por permisos) queda anotado
// para hacerlo a mano en vez de bloquear al alumno.
export async function acceptCase ({ enrollmentId, notes, userId }) {
  const caso = await repo.getCase(enrollmentId)
  assertPuedeAceptar(caso)

  const venta = await repo.getVenta(enrollmentId)
  if (!venta) throw new ReprogramacionError('La inscripcion no existe o no esta activa')

  const resultado = await ejecutarVeredicto({ caso, venta, enrollmentId, userId })

  return repo.saveVerdict({
    enrollmentId,
    status: ESTADO.ACEPTADO,
    notes,
    userId,
    newEnrollmentId: resultado?.new_enrollment_id ?? null,
    // Las salidas sin destino no dejan nada a medio hacer: no crean enrollment
    // nuevo ni tocan el aula nueva, asi que tampoco tienen pasos pendientes.
    pendingSteps: resultado ? pasosPendientes(resultado) : []
  })
}

// Cada tipo de caso tiene su ejecucion. Devuelve el resultado del movimiento, o
// null cuando el veredicto no crea ningun enrollment nuevo.
async function ejecutarVeredicto ({ caso, venta, enrollmentId, userId }) {
  // El reembolso no toca nada: la inscripcion se queda como esta y el caso solo
  // deja constancia en el historial de que se le devolvio su dinero.
  if (caso.dest_kind === KIND.REEMBOLSO) return null

  if (caso.dest_kind === KIND.RESERVA_VACANTE) {
    // Retirarlo es exactamente lo que ya hace FICO: cancela las cuotas
    // pendientes, arrastra los modulos hijos y lo saca del aula de Odoo. Lo
    // unico propio de la reserva es que NO hay devolucion — la plata se queda a
    // favor del alumno hasta que se vuelva a inscribir.
    await retireEnrollment({
      enrollmentId,
      reason: 'Reserva de vacante: se cancelo su edicion y volvera mas adelante',
      hasRefund: false,
      justificacion: 'Reserva de vacante por cancelacion de la edicion. El pago queda a favor del alumno hasta que se reinscriba.',
      userId
    })
    return null
  }

  const justificacion = buildJustificacion({
    edicionesCaidas: [],
    destino: `edicion #${caso.dest_edition_id || 's/e'}`
  })

  if (caso.dest_kind === KIND.REPROGRAMACION) {
    return reprogramEdition({
      enrollmentId,
      newEditionId: caso.dest_edition_id,
      justificacion,
      userId
    })
  }

  return courseChange({
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
