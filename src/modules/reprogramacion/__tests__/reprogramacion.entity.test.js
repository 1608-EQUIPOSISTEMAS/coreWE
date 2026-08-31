import { describe, it, expect } from 'vitest'
import {
  ESTADO,
  KIND,
  ReprogramacionError,
  assertPuedeAceptar,
  assertPuedeProponer,
  netoDeLaVenta,
  resolveDestKind
} from '../reprogramacion.entity.js'

describe('resolveDestKind', () => {
  it('mismo programa con edicion => RP', () => {
    expect(resolveDestKind({ originProgramVersionId: 10, destProgramVersionId: 10, destEditionId: 99 })).toBe('RP')
  })

  it('otro programa => CC', () => {
    expect(resolveDestKind({ originProgramVersionId: 10, destProgramVersionId: 11 })).toBe('CC')
  })

  // El id llega como string desde el body HTTP; comparar sin normalizar mandaria
  // un RP legitimo por el camino del cambio de curso.
  it('compara por valor, no por tipo', () => {
    expect(resolveDestKind({ originProgramVersionId: 10, destProgramVersionId: '10', destEditionId: 99 })).toBe('RP')
  })

  // Sin esta guarda el caso se guardaba igual y reventaba recien al ejecutarlo,
  // cuando FICO ya habia contactado al alumno.
  it('un RP sin edicion destino no tiene sentido y falla', () => {
    expect(() => resolveDestKind({ originProgramVersionId: 10, destProgramVersionId: 10 }))
      .toThrow(/edicion destino/i)
  })

  // Membresias y programas online no tienen ediciones: el CC si puede ir sin.
  it('un CC si puede ir sin edicion', () => {
    expect(resolveDestKind({ originProgramVersionId: 10, destProgramVersionId: 11 })).toBe('CC')
  })

  it('sin destino falla', () => {
    expect(() => resolveDestKind({ originProgramVersionId: 10 })).toThrow(ReprogramacionError)
  })

  // El alumno que pide su plata de vuelta no va a ningun lado: exigirle un
  // programa destino obligaba a Academica a inventar uno para poder guardar.
  it('reembolso => RF, sin programa ni edicion', () => {
    expect(resolveDestKind({ originProgramVersionId: 10, refund: true })).toBe(KIND.REEMBOLSO)
  })

  it('el reembolso gana sobre cualquier destino a medio elegir', () => {
    expect(resolveDestKind({ originProgramVersionId: 10, destProgramVersionId: 11, refund: true }))
      .toBe(KIND.REEMBOLSO)
  })
})

describe('assertPuedeAceptar', () => {
  const listo = { status: ESTADO.CONTACTADO, dest_edition_id: 99, dest_program_version_id: 10 }

  it('pasa cuando hay destino y esta contactado', () => {
    expect(() => assertPuedeAceptar(listo)).not.toThrow()
  })

  it('no deja aceptar sin destino elegido', () => {
    expect(() => assertPuedeAceptar({ status: ESTADO.CONTACTADO })).toThrow(/destino/i)
  })

  it('no deja aceptar sin contactar al alumno', () => {
    expect(() => assertPuedeAceptar({ ...listo, status: ESTADO.PROPUESTO })).toThrow(/contactado/i)
  })

  it('no deja ejecutar dos veces', () => {
    expect(() => assertPuedeAceptar({ ...listo, status: ESTADO.ACEPTADO })).toThrow(/ya se ejecuto/i)
  })

  it('un caso sin fila (recien detectado) no se puede aceptar', () => {
    expect(() => assertPuedeAceptar(null)).toThrow(ReprogramacionError)
  })

  // El reembolso es el unico veredicto legitimo sin destino.
  it('acepta un reembolso contactado aunque no tenga destino', () => {
    expect(() => assertPuedeAceptar({ status: ESTADO.CONTACTADO, dest_kind: KIND.REEMBOLSO }))
      .not.toThrow()
  })

  it('un reembolso sin contactar tampoco pasa', () => {
    expect(() => assertPuedeAceptar({ status: ESTADO.PROPUESTO, dest_kind: KIND.REEMBOLSO }))
      .toThrow(/contactado/i)
  })
})

describe('assertPuedeProponer', () => {
  it('deja proponer sobre un caso nuevo', () => {
    expect(() => assertPuedeProponer(null)).not.toThrow()
  })

  it('no deja cambiar el destino de un caso ya ejecutado', () => {
    expect(() => assertPuedeProponer({ status: ESTADO.ACEPTADO })).toThrow(/ya se ejecuto/i)
  })
})

describe('netoDeLaVenta', () => {
  // El alumno no paga la diferencia por una edicion que cancelamos nosotros:
  // el destino se cobra al mismo neto que ya pago.
  it('descuenta el descuento del total', () => {
    expect(netoDeLaVenta({ total_amount: '1700.00', discount_amount: '200.00' })).toBe(1500)
  })

  it('tolera nulos', () => {
    expect(netoDeLaVenta({})).toBe(0)
  })
})
