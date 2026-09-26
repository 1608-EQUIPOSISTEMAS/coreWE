// Normalizacion del texto que llega por DM, antes de que lo vea la IA.
//
// Slack no manda texto plano: manda su propio mrkdwn con las entidades ya
// marcadas (`<https://x|etiqueta>`, `<@U123>`, `<#C1|canal>`). Eso se aprovecha
// dos veces: los enlaces salen de ahi con un regex, sin gastar un solo token en
// que un modelo los "encuentre", y el texto que se manda a la IA va mas corto.

// <url|etiqueta> o <url>. El separador es la primera barra vertical.
const ENTIDAD = /<([^<>|]+)(?:\|([^<>]*))?>/g

const HTML_ENTIDADES = { '&amp;': '&', '&lt;': '<', '&gt;': '>' }

// Una sola "palabra" con forma de dominio (con o sin protocolo y ruta).
const PARECE_URL = /^(https?:\/\/)?(www\.)?[\w-]+((?:\.[\w-]+)+)([/?#:]\S*)?$/i

// Para no confundir un nombre de archivo ("reporte.pdf") con un dominio, hace
// falta alguna pista mas: protocolo, www, una ruta o un host con dos puntos.
function pareceUrl (texto) {
  const m = PARECE_URL.exec(String(texto ?? '').trim())
  if (!m) return false
  const [, protocolo, www, dominio, ruta] = m
  return Boolean(protocolo || www || ruta || dominio.split('.').length > 2)
}

/** Slack escapa estos tres, y solo estos tres. */
function desescapar (texto) {
  return texto.replace(/&(amp|lt|gt);/g, m => HTML_ENTIDADES[m])
}

/**
 * Separa el mensaje en texto legible + enlaces.
 *
 * Cada entidad se reemplaza por algo que conserve el sentido de la frase: un
 * enlace deja su etiqueta (o nada si era la URL pelada), una mencion deja
 * `@alguien`, un canal deja `#canal`. Asi "revisa <https://x|el reporte>" le
 * llega a la IA como "revisa el reporte" y no como una URL de 300 caracteres.
 *
 * @returns {{ texto: string, enlaces: string[] }}
 */
export function limpiarTextoSlack (crudo = '') {
  const enlaces = []

  const texto = String(crudo ?? '').replace(ENTIDAD, (_, destino, etiqueta) => {
    if (destino.startsWith('@')) return etiqueta ? `@${etiqueta}` : '@alguien'
    if (destino.startsWith('#')) return etiqueta ? `#${etiqueta}` : '#canal'
    if (destino.startsWith('!')) return etiqueta ? `@${etiqueta}` : `@${destino.slice(1)}`
    if (destino.startsWith('mailto:')) return etiqueta || destino.slice(7)

    if (/^https?:\/\//i.test(destino)) {
      const url = desescapar(destino)
      if (!enlaces.includes(url)) enlaces.push(url)
      // Una etiqueta que es la propia URL (o una version recortada, como la
      // que deja pegar un link enriquecido: "docs.google.com/…/edit?gid=…") no
      // aporta nada al texto: el enlace ya viaja aparte.
      const visible = etiqueta ? desescapar(etiqueta) : ''
      return pareceUrl(visible) ? '' : visible
    }

    // Cualquier otra cosa entre <> no es una entidad de Slack: se deja tal cual.
    return desescapar(`${destino}${etiqueta ? `|${etiqueta}` : ''}`)
  })

  return { texto: desescapar(texto).replace(/[ \t]+/g, ' ').trim(), enlaces }
}

/**
 * El inverso de desescapar: deja un texto listo para viajar dentro de un bloque
 * de Slack sin que `<algo>` se interprete como entidad ni rompa el bloque.
 */
export function escaparSlack (texto) {
  return String(texto ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Publico para que los bloques puedan recuperar el texto original. */
export const desescaparSlack = desescapar

/**
 * El numero de ticket mencionado en el mensaje, si lo hay.
 *
 * Respaldo del campo que extrae la IA, y de paso el camino barato: "como va el
 * #00042" se resuelve sin preguntarle nada a nadie. Acepta `#42`, `#00042`,
 * `ticket 42` y `ticket #42`.
 */
export function detectarNumeroTicket (texto = '') {
  const m = /(?:#|\bticket\s*#?\s*)0*(\d{1,6})\b/i.exec(String(texto ?? ''))
  if (!m) return null
  const n = Number(m[1])
  return n > 0 ? n : null
}

/**
 * Recorta respetando palabras, para que un titulo de respaldo no termine
 * cortado a la mitad. Se usa cuando la IA no esta disponible.
 */
export function recortar (texto, max) {
  const t = String(texto ?? '').trim()
  if (t.length <= max) return t
  const corte = t.slice(0, max - 1)
  const espacio = corte.lastIndexOf(' ')
  return `${(espacio > max * 0.5 ? corte.slice(0, espacio) : corte).trimEnd()}…`
}
