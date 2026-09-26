import { describe, it, expect } from 'vitest'
import { limpiarTextoSlack, detectarNumeroTicket, recortar, escaparSlack } from '../slack.text.js'

describe('limpiarTextoSlack', () => {
  it('saca los enlaces y deja la etiqueta en su lugar', () => {
    const { texto, enlaces } = limpiarTextoSlack('revisa <https://erp.test/x|el reporte> por favor')
    expect(texto).toBe('revisa el reporte por favor')
    expect(enlaces).toEqual(['https://erp.test/x'])
  })

  it('una URL pelada se saca del texto igual', () => {
    const { texto, enlaces } = limpiarTextoSlack('no carga <https://erp.test/matriculas>')
    expect(texto).toBe('no carga')
    expect(enlaces).toEqual(['https://erp.test/matriculas'])
  })

  it('no repite el mismo enlace dos veces', () => {
    const { enlaces } = limpiarTextoSlack('<https://a.test> y otra vez <https://a.test|acá>')
    expect(enlaces).toEqual(['https://a.test'])
  })

  it('un link enriquecido cuya etiqueta es la URL (recortada) no deja la URL en el texto', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1sOVtZeAt2_NDilpdWA2qP5RPsBQlck7J036AQI5HYqI/edit?gid=471740064#gid=471740064'
    const { texto, enlaces } = limpiarTextoSlack(
      `Google sheets, ventas desincronizadas <${url}|docs.google.com/spreadsheets/d/1sOVtZeAt2_N.../edit?gid=471740064#gid=471740064>`
    )
    expect(texto).toBe('Google sheets, ventas desincronizadas')
    expect(enlaces).toEqual([url])
  })

  it('una etiqueta que es un nombre de archivo o una frase se conserva', () => {
    expect(limpiarTextoSlack('mira <https://a.test/f|reporte.pdf>').texto).toBe('mira reporte.pdf')
    expect(limpiarTextoSlack('mira <https://a.test/f|el sheet de ventas>').texto).toBe('mira el sheet de ventas')
  })

  it('las menciones quedan legibles, no como <@U123>', () => {
    expect(limpiarTextoSlack('avisale a <@U123|ana>').texto).toBe('avisale a @ana')
    expect(limpiarTextoSlack('avisale a <@U123>').texto).toBe('avisale a @alguien')
  })

  it('los canales quedan como #canal', () => {
    expect(limpiarTextoSlack('lo vimos en <#C1|soporte>').texto).toBe('lo vimos en #soporte')
  })

  it('desescapa las entidades que escapa Slack', () => {
    expect(limpiarTextoSlack('a &lt; b &amp;&amp; c &gt; d').texto).toBe('a < b && c > d')
  })

  it('un mailto deja el correo', () => {
    expect(limpiarTextoSlack('escribe a <mailto:a@b.com|a@b.com>').texto).toBe('escribe a a@b.com')
  })

  it('texto sin entidades pasa igual, solo recortado', () => {
    expect(limpiarTextoSlack('  el   ERP no carga  ').texto).toBe('el ERP no carga')
  })

  it('vacio o indefinido no revienta', () => {
    expect(limpiarTextoSlack('')).toEqual({ texto: '', enlaces: [] })
    expect(limpiarTextoSlack(undefined)).toEqual({ texto: '', enlaces: [] })
  })
})

describe('detectarNumeroTicket', () => {
  it('lo encuentra con almohadilla y con ceros a la izquierda', () => {
    expect(detectarNumeroTicket('como va el #00042')).toBe(42)
    expect(detectarNumeroTicket('el #7 sigue igual')).toBe(7)
  })

  it('lo encuentra escrito con palabras', () => {
    expect(detectarNumeroTicket('novedades del ticket 15?')).toBe(15)
    expect(detectarNumeroTicket('ticket #15')).toBe(15)
  })

  it('sin numero devuelve null', () => {
    expect(detectarNumeroTicket('no funciona nada')).toBeNull()
    expect(detectarNumeroTicket('')).toBeNull()
  })

  it('el ticket #0 no existe', () => {
    expect(detectarNumeroTicket('el #0')).toBeNull()
  })
})

describe('recortar', () => {
  it('deja intacto lo que ya entra', () => {
    expect(recortar('corto', 20)).toBe('corto')
  })

  it('corta en el espacio anterior para no partir una palabra', () => {
    expect(recortar('uno dos tres cuatro', 12)).toBe('uno dos…')
  })

  it('si no hay donde cortar, corta igual', () => {
    expect(recortar('aaaaaaaaaaaaaaaaaaaa', 5)).toBe('aaaa…')
  })
})

describe('escaparSlack', () => {
  it('evita que un <texto> se lea como entidad de Slack', () => {
    expect(escaparSlack('usa <b> y & también')).toBe('usa &lt;b&gt; y &amp; también')
  })
})
