import { describe, it, expect } from 'vitest'
import { bloquesDeBorrador, leerBorrador, ACCION_CREAR, ACCION_DESCARTAR } from '../slack.blocks.js'

const BORRADOR = {
  titulo: 'No carga el reporte de matrículas',
  problema: 'Desde ayer entro al reporte y se queda cargando para siempre.',
  enlaces: ['https://erp.test/reportes']
}

describe('bloquesDeBorrador', () => {
  it('ofrece los dos botones', () => {
    const acciones = bloquesDeBorrador(BORRADOR).blocks.find(b => b.type === 'actions')
    expect(acciones.elements.map(e => e.action_id)).toEqual([ACCION_CREAR, ACCION_DESCARTAR])
  })

  it('sin enlaces no arma el bloque de enlace', () => {
    const bloques = bloquesDeBorrador({ ...BORRADOR, enlaces: [] }).blocks
    expect(bloques.some(b => b.block_id === 'tk_enlace')).toBe(false)
  })

  it('el texto de respaldo nombra el título, que es lo que se ve en la notificación', () => {
    expect(bloquesDeBorrador(BORRADOR).text).toContain('No carga el reporte de matrículas')
  })
})

describe('leerBorrador', () => {
  // La ida y vuelta es lo unico que sostiene el diseno sin estado: si esto se
  // rompe, el boton "Crear ticket" deja de encontrar lo que iba a crear.
  it('recupera lo mismo que se escribió en los bloques', () => {
    expect(leerBorrador(bloquesDeBorrador(BORRADOR).blocks)).toEqual({
      titulo: BORRADOR.titulo,
      problema: BORRADOR.problema,
      link: 'https://erp.test/reportes'
    })
  })

  it('sobrevive a un problema con saltos de línea', () => {
    const problema = 'Pasa esto:\n- primero falla A\n- después falla B'
    const leido = leerBorrador(bloquesDeBorrador({ ...BORRADOR, problema }).blocks)
    expect(leido.problema).toBe(problema)
  })

  it('sobrevive a los caracteres que Slack escapa', () => {
    const problema = 'Sale el error <NullPointer> al guardar A & B'
    const leido = leerBorrador(bloquesDeBorrador({ ...BORRADOR, problema }).blocks)
    expect(leido.problema).toBe(problema)
  })

  it('sin enlace devuelve link null', () => {
    expect(leerBorrador(bloquesDeBorrador({ ...BORRADOR, enlaces: [] }).blocks).link).toBeNull()
  })

  it('un mensaje con otra forma (de una versión anterior) devuelve null', () => {
    expect(leerBorrador([{ type: 'section', text: { type: 'mrkdwn', text: 'hola' } }])).toBeNull()
    expect(leerBorrador(undefined)).toBeNull()
  })
})
