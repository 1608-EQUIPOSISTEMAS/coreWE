import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Clasificador de prioridad. La prioridad NUNCA la elige quien reporta: se
// deduce del contenido del ticket para que nadie pueda inflar el suyo a ALTA
// con tal de que lo atiendan antes. Las reglas viven en criterios-prioridad.md,
// que es un markdown editable por negocio: agregar una palabra clave no es un
// redeploy de logica, es editar una lista.

const PRIORIDAD_POR_DEFECTO = 'MEDIA'

// El orden solo hace estable el recorrido; el ganador lo decide el puntaje.
const PRIORIDADES = ['ALTA', 'MEDIA', 'BAJA']

// A partir de cuantas palabras una frase de ALTA describe una falla concreta
// ("no se registro") y no el solo hecho de nombrar el sistema ("erp").
const PESO_FALLA_CONCRETA = 2

// Normaliza a minusculas sin tildes y con la puntuacion vuelta espacios, para
// que "Matricula NO se registro." y "matricula no se registro" sean el mismo
// texto a la hora de buscar palabras clave.
function normalizar (texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function escaparRegExp (texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// La frase tiene que empezar en un limite de palabra, pero se permite cualquier
// sufijo: asi "venta" tambien encuentra "ventas" y "se traba" encuentra "se trababa".
function construirPatron (frase) {
  const palabras = frase.split(' ').map(escaparRegExp)
  return new RegExp(`\\b${palabras.join('\\w*\\s+')}`)
}

/**
 * Lee del markdown las listas de palabras clave de cada prioridad.
 *
 * Reconoce la seccion por su encabezado `## ALTA|MEDIA|BAJA` (lo que venga
 * despues, como "(urgente)", se ignora) y toma los items `- ...` del bloque
 * `### Palabras clave` que haya dentro. El resto del archivo es prosa para las
 * personas y no se interpreta.
 *
 * Se exporta aparte de la lectura del disco para poder testearlo sin archivo.
 */
export function parsearCriterios (markdown) {
  const criterios = new Map(PRIORIDADES.map(p => [p, []]))

  let prioridadActual = null
  let dentroDePalabrasClave = false

  for (const linea of String(markdown ?? '').split(/\r?\n/)) {
    const encabezadoPrioridad = /^##\s+(ALTA|MEDIA|BAJA)\b/.exec(linea)
    if (encabezadoPrioridad) {
      prioridadActual = encabezadoPrioridad[1]
      dentroDePalabrasClave = false
      continue
    }

    // Cualquier otro `##` cierra la seccion (p. ej. "## Cuando hay duda").
    if (/^##\s/.test(linea)) {
      prioridadActual = null
      dentroDePalabrasClave = false
      continue
    }

    if (/^###\s/.test(linea)) {
      dentroDePalabrasClave = /^###\s+Palabras clave\s*$/i.test(linea)
      continue
    }

    if (!prioridadActual || !dentroDePalabrasClave) continue

    const item = /^\s*-\s+(.*\S)\s*$/.exec(linea)
    if (!item) continue

    const frase = normalizar(item[1])
    if (!frase) continue

    criterios.get(prioridadActual).push({
      frase,
      patron: construirPatron(frase),
      // Una frase de varias palabras es mas especifica, asi que vale mas.
      peso: frase.split(' ').length
    })
  }

  return criterios
}

// Los criterios se leen una sola vez al arrancar: no cambian en caliente y asi
// no se toca el disco en cada ticket creado.
const HERE = dirname(fileURLToPath(import.meta.url))
const CRITERIOS = parsearCriterios(readFileSync(join(HERE, 'criterios-prioridad.md'), 'utf-8'))

for (const [prioridad, palabras] of CRITERIOS) {
  if (palabras.length === 0) {
    console.warn(`[tickets] la seccion ${prioridad} de criterios-prioridad.md no tiene palabras clave: ningun ticket se clasificara con esa prioridad`)
  }
}

/**
 * Clasifica la prioridad a partir del titulo y la problematica, puntuando las
 * palabras clave del markdown. Gana la de mayor puntaje; ante empate o sin
 * coincidencias cae a MEDIA. No lanza nunca: la creacion de un ticket no puede
 * quedarse trabada por la clasificacion.
 */
export function clasificarPrioridad (titulo, problematica, criterios = CRITERIOS) {
  const texto = normalizar(`${titulo ?? ''} ${problematica ?? ''}`)
  if (!texto) return PRIORIDAD_POR_DEFECTO

  let ganadora = PRIORIDAD_POR_DEFECTO
  let mejorPuntaje = 0
  let hayEmpate = false

  for (const prioridad of PRIORIDADES) {
    const coincidencias = (criterios.get(prioridad) ?? []).filter(p => p.patron.test(texto))

    // Una falla operativa manda sobre todo lo demas: si el ticket describe una
    // falla concreta —una frase de ALTA de dos o mas palabras, no el simple
    // hecho de nombrar el ERP— se atiende como ALTA aunque de paso pida una
    // mejora, que sumaria mas puntos y se llevaria la clasificacion a BAJA.
    if (prioridad === 'ALTA' && coincidencias.some(p => p.peso >= PESO_FALLA_CONCRETA)) {
      return 'ALTA'
    }

    const puntaje = coincidencias.reduce((total, p) => total + p.peso, 0)
    if (puntaje === 0) continue

    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje
      ganadora = prioridad
      hayEmpate = false
    } else if (puntaje === mejorPuntaje) {
      hayEmpate = true
    }
  }

  return hayEmpate ? PRIORIDAD_POR_DEFECTO : ganadora
}
