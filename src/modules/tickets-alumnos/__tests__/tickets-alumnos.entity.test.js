import { describe, it, expect } from 'vitest'
import {
  ACCION,
  AREA,
  ESTADO,
  TicketError,
  areaInicial,
  areasDelUsuario,
  assertPuedeFirmar,
  avanzar,
  planDeEjecucion,
  rechazar,
  turnoDe
} from '../tickets-alumnos.entity.js'

const ticket = (tipo, extra = {}) => ({ tipo, status: ESTADO.ABIERTA, area_actual: null, monto: 50, datos: {}, ...extra })

describe('turnoDe', () => {
  it('todo lo que se abre sin pagar arranca en Academica', () => {
    for (const tipo of ['REPROGRAMACION', 'CAMBIO_CURSO', 'FLEXIBILIDAD_HORARIA', 'REASIGNACION_CURSO', 'CERTIFICADOS']) {
      expect(turnoDe(ticket(tipo))).toBe(AREA.ACADEMICA)
    }
  })

  it('el SAP gratis va directo a FICO: no hay nada que aprobar', () => {
    expect(turnoDe(ticket('ALQUILER_SAP', { monto: 0 }))).toBe(AREA.FICO)
  })

  it('un pago registrado siempre es de FICO', () => {
    expect(turnoDe(ticket('COMPRA_GRABACIONES', { status: ESTADO.PAGO_REGISTRADO }))).toBe(AREA.FICO)
  })

  it('mientras espera el voucher no le toca a ninguna area', () => {
    expect(turnoDe(ticket('REPROGRAMACION', { status: ESTADO.PENDIENTE_PAGO }))).toBeNull()
  })

  it('respeta el area de un ticket EN_PROCESO del flujo anterior', () => {
    expect(turnoDe(ticket('CERTIFICADOS', { status: ESTADO.EN_PROCESO, area_actual: AREA.FICO }))).toBe(AREA.FICO)
  })

  // Un ticket sin dueno no aparece en ninguna bandeja y se pierde en silencio.
  it('un tipo desconocido cae en Academica en vez de quedarse sin dueno', () => {
    expect(areaInicial('TRAMITE_QUE_NO_EXISTE')).toBe(AREA.ACADEMICA)
  })
})

describe('areasDelUsuario', () => {
  it('reconoce al titular y al lider de cada area', () => {
    expect(areasDelUsuario(['ACADEMICA'])).toEqual([AREA.ACADEMICA])
    expect(areasDelUsuario(['LIDER_FICO'])).toEqual([AREA.FICO])
  })

  it('ADMIN puede firmar cualquier paso', () => {
    expect(areasDelUsuario(['ADMIN'])).toEqual([AREA.ACADEMICA, AREA.FICO])
  })

  it('un rol ajeno no firma nada', () => {
    expect(areasDelUsuario(['COMERCIAL'])).toEqual([])
    expect(areasDelUsuario()).toEqual([])
  })
})

describe('assertPuedeFirmar', () => {
  // La guarda que justifica el modulo: las dos areas VEN la misma bandeja, asi
  // que ver no puede implicar firmar.
  it('Academica no puede validar el voucher que le toca a FICO, y es 403', () => {
    const pagado = ticket('CERTIFICADOS', { status: ESTADO.PAGO_REGISTRADO })
    try {
      assertPuedeFirmar(pagado, [AREA.ACADEMICA])
      throw new Error('deberia haber lanzado')
    } catch (err) {
      expect(err).toBeInstanceOf(TicketError)
      expect(err.statusCode).toBe(403)
    }
  })

  it('nadie firma mientras el alumno no adjunte el voucher', () => {
    const esperando = ticket('REPROGRAMACION', { status: ESTADO.PENDIENTE_PAGO })
    expect(() => assertPuedeFirmar(esperando, [AREA.ACADEMICA, AREA.FICO])).toThrow(/voucher/)
  })

  it('un tramite cerrado no se vuelve a firmar, tampoco un pago rechazado', () => {
    expect(() => assertPuedeFirmar(ticket('REPROGRAMACION', { status: ESTADO.RESUELTA }), [AREA.FICO])).toThrow(/cerrado/)
    expect(() => assertPuedeFirmar(ticket('REPROGRAMACION', { status: ESTADO.PAGO_RECHAZADO }), [AREA.FICO])).toThrow(/cerrado/)
  })

  it('no acepta un ticket inexistente', () => {
    expect(() => assertPuedeFirmar(null, [AREA.ACADEMICA])).toThrow(/no existe/)
  })
})

describe('avanzar', () => {
  it('Academica aprueba y el alumno queda debiendo el pago', () => {
    expect(avanzar(ticket('REPROGRAMACION'))).toEqual({ status: ESTADO.PENDIENTE_PAGO, area_actual: null, monto: 50 })
  })

  it('Academica puede fijar el monto que la lista de precios no tenia', () => {
    expect(avanzar(ticket('REPROGRAMACION', { monto: null }), { monto: 80 })).toMatchObject({ status: ESTADO.PENDIENTE_PAGO, monto: 80 })
  })

  it('la reasignacion espera el pago acordado aunque no tenga monto', () => {
    expect(avanzar(ticket('REASIGNACION_CURSO', { monto: null }))).toMatchObject({ status: ESTADO.PENDIENTE_PAGO, monto: null })
  })

  it('lo gratis se resuelve con la firma de Academica', () => {
    expect(avanzar(ticket('FLEXIBILIDAD_HORARIA', { monto: 0 })).status).toBe(ESTADO.RESUELTA)
    expect(avanzar(ticket('CAMBIO_CURSO', { monto: 0 })).status).toBe(ESTADO.RESUELTA)
  })

  it('el certificado fisico se resuelve en Academica: se coordina, no se cobra por el portal', () => {
    expect(avanzar(ticket('CERTIFICADOS', { monto: null, datos: { variante: 'FISICO' } })).status).toBe(ESTADO.RESUELTA)
  })

  it('FICO valida el voucher y el tramite queda resuelto', () => {
    expect(avanzar(ticket('COMPRA_GRABACIONES', { status: ESTADO.PAGO_REGISTRADO })).status).toBe(ESTADO.RESUELTA)
  })
})

describe('rechazar', () => {
  it('rechazar en Academica rechaza la solicitud', () => {
    expect(rechazar(ticket('REPROGRAMACION'))).toEqual({ status: ESTADO.RECHAZADA, area_actual: null })
  })

  it('rechazar el voucher deja el pago rechazado, no la solicitud', () => {
    expect(rechazar(ticket('REPROGRAMACION', { status: ESTADO.PAGO_REGISTRADO })).status).toBe(ESTADO.PAGO_RECHAZADO)
  })
})

describe('planDeEjecucion', () => {
  it('reprograma el curso suelto a la edicion elegida', () => {
    const t = ticket('REPROGRAMACION', { enrollment_id: 500, datos: { alcance: 'MODULO', destEditionId: 900 } })
    expect(planDeEjecucion(t)).toEqual({ accion: ACCION.REPROGRAMAR, enrollmentId: 500, destEditionId: 900 })
  })

  it('reprograma la venta del diplomado cuando se pide el programa entero', () => {
    const t = ticket('REPROGRAMACION', {
      enrollment_id: 501, parent_enrollment_id: 400, datos: { alcance: 'PROGRAMA', parentEnrollmentId: 400, destEditionId: 950 }
    })
    expect(planDeEjecucion(t)).toEqual({ accion: ACCION.REPROGRAMAR, enrollmentId: 400, destEditionId: 950 })
  })

  // reprogramEdition sobre un hijo SEG lo desprenderia del paquete.
  it('deja a mano el modulo suelto de un diplomado', () => {
    const t = ticket('REPROGRAMACION', { enrollment_id: 501, parent_enrollment_id: 400, datos: { alcance: 'MODULO', destEditionId: 900 } })
    expect(planDeEjecucion(t).accion).toBe(ACCION.MANUAL)
  })

  it('cambia de curso hacia la version y edicion elegidas', () => {
    const t = ticket('CAMBIO_CURSO', { enrollment_id: 500, datos: { destEditionId: 77, destProgramVersionId: 12 } })
    expect(planDeEjecucion(t)).toEqual({ accion: ACCION.CAMBIAR_CURSO, enrollmentId: 500, destEditionId: 77, destProgramVersionId: 12 })
  })

  it('no mueve nada en los tramites que no cambian la matricula', () => {
    expect(planDeEjecucion(ticket('CERTIFICADOS'))).toBeNull()
  })
})
