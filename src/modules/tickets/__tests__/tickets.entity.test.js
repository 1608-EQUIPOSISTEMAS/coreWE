import { describe, it, expect } from 'vitest'
import {
  AREA,
  ESTADO,
  TicketError,
  areaInicial,
  areasDelUsuario,
  assertPuedeFirmar,
  avanzar,
  rechazar,
  siguienteArea
} from '../tickets.entity.js'

const abierto = (tipo, extra = {}) => ({ tipo, status: ESTADO.ABIERTA, area_actual: areaInicial(tipo), ...extra })

describe('ruteo por tipo de tramite', () => {
  it('los cinco tramites con pago arrancan en Academica', () => {
    for (const tipo of ['REPROGRAMACION', 'CAMBIO_CURSO', 'COMPRA_GRABACIONES', 'CERTIFICADOS', 'REASIGNACION_CURSO']) {
      expect(areaInicial(tipo)).toBe(AREA.ACADEMICA)
      expect(siguienteArea(tipo, AREA.ACADEMICA)).toBe(AREA.FICO)
    }
  })

  it('el alquiler de usuario SAP es solo de Finanzas', () => {
    expect(areaInicial('ALQUILER_SAP')).toBe(AREA.FICO)
    expect(siguienteArea('ALQUILER_SAP', AREA.FICO)).toBeNull()
  })

  it('la flexibilidad horaria es solo de Academica', () => {
    expect(areaInicial('FLEXIBILIDAD_HORARIA')).toBe(AREA.ACADEMICA)
    expect(siguienteArea('FLEXIBILIDAD_HORARIA', AREA.ACADEMICA)).toBeNull()
  })

  // Un ticket sin dueno no aparece en ninguna bandeja y se pierde en silencio.
  it('un tipo desconocido cae en Academica en vez de quedarse sin dueno', () => {
    expect(areaInicial('TRAMITE_QUE_NO_EXISTE')).toBe(AREA.ACADEMICA)
  })

  it('CAMBIO_FLEX sigue ruteando: quedaron tickets abiertos que hay que cerrar', () => {
    expect(areaInicial('CAMBIO_FLEX')).toBe(AREA.ACADEMICA)
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
  it('Academica no puede firmar el paso de pago que le toca a FICO', () => {
    const enFico = { tipo: 'CERTIFICADOS', status: ESTADO.EN_PROCESO, area_actual: AREA.FICO }
    expect(() => assertPuedeFirmar(enFico, [AREA.ACADEMICA])).toThrow(/FICO/)
  })

  it('el error de turno es 403, no 400: es permiso, no dato malo', () => {
    const enFico = { tipo: 'CERTIFICADOS', status: ESTADO.EN_PROCESO, area_actual: AREA.FICO }
    try {
      assertPuedeFirmar(enFico, [AREA.ACADEMICA])
      throw new Error('deberia haber lanzado')
    } catch (err) {
      expect(err).toBeInstanceOf(TicketError)
      expect(err.statusCode).toBe(403)
    }
  })

  it('FICO si firma cuando es su turno', () => {
    const enFico = { tipo: 'CERTIFICADOS', status: ESTADO.EN_PROCESO, area_actual: AREA.FICO }
    expect(() => assertPuedeFirmar(enFico, [AREA.FICO])).not.toThrow()
  })

  it('no se firma dos veces un tramite ya resuelto', () => {
    const resuelto = { tipo: 'CERTIFICADOS', status: ESTADO.RESUELTA, area_actual: null }
    expect(() => assertPuedeFirmar(resuelto, [AREA.ACADEMICA, AREA.FICO])).toThrow(/cerrado/i)
  })

  it('un tramite rechazado tampoco se reabre firmandolo', () => {
    const rechazado = { tipo: 'CERTIFICADOS', status: ESTADO.RECHAZADA, area_actual: null }
    expect(() => assertPuedeFirmar(rechazado, [AREA.ACADEMICA])).toThrow(/cerrado/i)
  })

  it('un ticket inexistente falla explicito', () => {
    expect(() => assertPuedeFirmar(null, [AREA.ACADEMICA])).toThrow(TicketError)
  })

  // Los tickets que Nexus creo antes de este modulo no tienen area_actual.
  it('sin area_actual usa el primer paso del tipo', () => {
    const viejo = { tipo: 'ALQUILER_SAP', status: ESTADO.ABIERTA, area_actual: null }
    expect(() => assertPuedeFirmar(viejo, [AREA.ACADEMICA])).toThrow(/FICO/)
    expect(() => assertPuedeFirmar(viejo, [AREA.FICO])).not.toThrow()
  })
})

describe('avanzar', () => {
  it('la firma de Academica lo manda a FICO, no lo resuelve', () => {
    expect(avanzar(abierto('REPROGRAMACION'))).toEqual({
      status: ESTADO.EN_PROCESO,
      area_actual: AREA.FICO
    })
  })

  it('la firma de FICO cierra el tramite de dos pasos', () => {
    const enFico = { tipo: 'REPROGRAMACION', status: ESTADO.EN_PROCESO, area_actual: AREA.FICO }
    expect(avanzar(enFico)).toEqual({ status: ESTADO.RESUELTA, area_actual: null })
  })

  it('un tramite de un solo paso se resuelve con la primera firma', () => {
    expect(avanzar(abierto('ALQUILER_SAP'))).toEqual({ status: ESTADO.RESUELTA, area_actual: null })
    expect(avanzar(abierto('FLEXIBILIDAD_HORARIA'))).toEqual({ status: ESTADO.RESUELTA, area_actual: null })
  })
})

describe('rechazar', () => {
  // Si Academica dice que no, no tiene sentido que FICO revise el pago.
  it('cierra el tramite sin pasarlo al area siguiente', () => {
    expect(rechazar()).toEqual({ status: ESTADO.RECHAZADA, area_actual: null })
  })
})
