import { describe, it, expect } from 'vitest'
import { ESTADO, estadoEncuesta, motivoParaNoEnviar, buildRetirados } from '../retirados.entity.js'

const retirado = (over = {}) => ({ email: 'ana@gmail.com', estado: ESTADO.SIN_ENVIAR, envios: 0, ...over })

describe('estadoEncuesta', () => {
  it('responder gana sobre enviar: es lo que lo mete al sorteo', () => {
    expect(estadoEncuesta({ enviada_at: '2026-10-01', respondida_at: '2026-10-02' })).toBe(ESTADO.RESPONDIDA)
    expect(estadoEncuesta({ enviada_at: '2026-10-01', respondida_at: null })).toBe(ESTADO.ENVIADA)
    expect(estadoEncuesta({ enviada_at: null, respondida_at: null })).toBe(ESTADO.SIN_ENVIAR)
  })
})

describe('motivoParaNoEnviar', () => {
  it('sin correo no se puede enviar', () => {
    expect(motivoParaNoEnviar(retirado({ email: null }))).toBeTruthy()
    expect(motivoParaNoEnviar(retirado({ email: '   ' }))).toBeTruthy()
  })

  it('al que ya respondio no se le vuelve a escribir', () => {
    expect(motivoParaNoEnviar(retirado({ estado: ESTADO.RESPONDIDA, envios: 1 }))).toBeTruthy()
  })

  it('se envia una sola vez: si no respondio, no se le reenvia', () => {
    expect(motivoParaNoEnviar(retirado({ estado: ESTADO.ENVIADA, envios: 1 }))).toBeTruthy()
  })

  it('un retirado con correo y sin encuesta si se puede enviar', () => {
    expect(motivoParaNoEnviar(retirado())).toBeNull()
  })
})

describe('buildRetirados', () => {
  it('cuenta cada retirado en su estado', () => {
    const { kpis } = buildRetirados([
      { email: 'a@x.com', enviada_at: null, respondida_at: null },
      { email: 'b@x.com', enviada_at: '2026-10-01', respondida_at: null, envios: 1 },
      { email: 'c@x.com', enviada_at: '2026-10-01', respondida_at: '2026-10-03', envios: 1 }
    ])
    expect(kpis).toEqual({ total: 3, sin_enviar: 1, enviada: 1, respondida: 1 })
  })
})
