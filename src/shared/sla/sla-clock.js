// Aritmetica del SLA de tickets: sin BD, sin red y sin `new Date()` implicito
// — el instante de referencia siempre entra por parametro. Es lo que hace que
// las fronteras de vencimiento se puedan testear sin base de datos.
//
// Vive en shared/ porque lo consultan dos modulos: tickets (la pantalla y el
// cron) y dashboard/results (el reporte de tiempos de respuesta del area).
// Duplicarlo desincronizaria el umbral el dia que alguien lo mueva.

// A partir de que fraccion del plazo TOTAL consumida un reloj pasa a POR_VENCER.
// Sobre el total y no sobre lo que falta: un plazo de 1 h y uno de 72 h no
// pueden avisar con la misma antelacion absoluta.
export const UMBRAL_POR_VENCER = 0.8

const RELOJ_VACIO = { venceEn: null, cumplidoEn: null, estado: null, msRestantes: null }

const asDate = v => (v == null ? null : (v instanceof Date ? v : new Date(v)))

/**
 * Evalua un reloj contra su plazo:
 *   EN_PLAZO    corriendo, con margen
 *   POR_VENCER  corriendo, consumio >= UMBRAL_POR_VENCER del plazo
 *   VENCIDO     corriendo, ya paso el plazo
 *   CUMPLIDO    se completo dentro del plazo
 *   INCUMPLIDO  se completo, pero tarde
 *
 * Una vez que el reloj se detuvo (cumplidoEn != null) el veredicto queda
 * congelado: el paso del tiempo ya no convierte un CUMPLIDO en VENCIDO.
 */
export function evaluarReloj (venceEn, cumplidoEn, inicio, ahora) {
  const vence = asDate(venceEn)
  const cumplido = asDate(cumplidoEn)

  // Tickets creados con una politica incompleta: no hay plazo que evaluar.
  if (!vence) return { ...RELOJ_VACIO, cumplidoEn: cumplido }

  if (cumplido) {
    return {
      venceEn: vence,
      cumplidoEn: cumplido,
      estado: cumplido.getTime() <= vence.getTime() ? 'CUMPLIDO' : 'INCUMPLIDO',
      msRestantes: vence.getTime() - cumplido.getTime()
    }
  }

  const msRestantes = vence.getTime() - asDate(ahora).getTime()
  if (msRestantes < 0) {
    return { venceEn: vence, cumplidoEn: null, estado: 'VENCIDO', msRestantes }
  }

  const plazoTotalMs = vence.getTime() - asDate(inicio).getTime()
  const consumido = plazoTotalMs > 0 ? 1 - msRestantes / plazoTotalMs : 1

  return {
    venceEn: vence,
    cumplidoEn: null,
    estado: consumido >= UMBRAL_POR_VENCER ? 'POR_VENCER' : 'EN_PLAZO',
    msRestantes
  }
}

/**
 * Los dos relojes de un ticket. Ambos arrancan al crearlo: el de resolucion
 * mide la espera total de quien reporto, no el trabajo del agente desde que lo
 * tomo. La fila llega en snake_case, tal como sale del repositorio.
 */
export function calcularSla (ticket, ahora = new Date()) {
  const inicio = ticket.registration_date
  return {
    respuesta: evaluarReloj(ticket.first_response_due_at, ticket.first_response_at, inicio, ahora),
    resolucion: evaluarReloj(ticket.resolution_due_at, ticket.resolved_at, inicio, ahora)
  }
}

/** Suma minutos corridos: el reloj no se detiene fuera del horario laboral. */
export function sumarMinutos (desde, minutos) {
  return new Date(asDate(desde).getTime() + minutos * 60 * 1000)
}

// Horario habil de soporte (criterios-prioridad.md): lunes a viernes, 09:00 a
// 18:00, hora de Lima. Peru no tiene horario de verano: UTC-5 fijo todo el ano.
export const HORARIO_HABIL = { offsetMinutos: -5 * 60, desde: 9 * 60, hasta: 18 * 60 }

const MIN_MS = 60 * 1000
const DIA_MIN = 24 * 60

/**
 * Suma minutos HABILES: el plazo solo corre dentro del horario de soporte. Un
 * ticket que entra fuera de horario empieza a contar en la proxima apertura
 * (viernes 17:50 + 30 min -> lunes 09:20).
 *
 * Se trabaja en "hora local como si fuera UTC" (desplazando el offset) para
 * poder usar getUTCDay/getUTCHours sin depender de la zona del servidor.
 */
export function sumarMinutosHabiles (desde, minutos, horario = HORARIO_HABIL) {
  const { offsetMinutos, desde: abre, hasta: cierra } = horario
  let local = asDate(desde).getTime() + offsetMinutos * MIN_MS
  let restantes = Math.max(0, Math.round(minutos))

  // Tope de seguridad: un plazo mal escrito no puede colgar el proceso.
  for (let vueltas = 0; vueltas < 3700; vueltas++) {
    const d = new Date(local)
    const inicioDia = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    const minutoDelDia = (local - inicioDia) / MIN_MS
    const diaSemana = d.getUTCDay() // 0 domingo, 6 sabado

    // Fin de semana o despues del cierre: saltar a la apertura del proximo dia.
    if (diaSemana === 0 || diaSemana === 6 || minutoDelDia >= cierra) {
      local = inicioDia + (DIA_MIN + abre) * MIN_MS
      continue
    }
    // Antes de la apertura: esperar a que abra.
    if (minutoDelDia < abre) {
      local = inicioDia + abre * MIN_MS
      continue
    }

    const disponibles = cierra - minutoDelDia
    if (restantes <= disponibles) {
      local += restantes * MIN_MS
      return new Date(local - offsetMinutos * MIN_MS)
    }
    restantes -= disponibles
    local = inicioDia + (DIA_MIN + abre) * MIN_MS
  }
  throw new Error(`Plazo habil fuera de rango: ${minutos} minutos`)
}

/** Un ticket esta en riesgo si cualquiera de sus dos relojes lo esta. */
export function estadosEnRiesgo (sla) {
  const estados = [sla.respuesta.estado, sla.resolucion.estado]
  return {
    vencido: estados.includes('VENCIDO'),
    porVencer: estados.includes('POR_VENCER')
  }
}
