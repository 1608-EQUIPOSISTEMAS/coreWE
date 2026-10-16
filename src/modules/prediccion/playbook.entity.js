// Manual de venta por programa: "los NUEVOS que preguntan por X, ¿que hacen?".
// Es lo que sirve con un numero sin historia (la mayoria de los que escriben).
//
// Medido 15/10/26 con Power BI: de 380 nuevos que consultaron, 11.1% compro en
// 4 meses y la MITAD de esos compro en 2 dias (p90: 48). El 71% compro lo mismo;
// el 12%, la Membresia Plus. El dato que mas sirve al asesor es la velocidad.
import { MIN_SAMPLE, CONVERSION_WINDOW_DAYS, offerContext } from './prediccion.entity.js'

const MAX_DESTINATIONS = 4

const pct = (part, total) => Math.round((1000 * part) / total) / 10

function speedAdvice (medianDays) {
  if (medianDays === null) return null
  if (medianDays <= 3) return `La mitad de los que compran lo hace en ${medianDays} ${medianDays === 1 ? 'día' : 'días'}: respóndele ya y cierra esta semana.`
  if (medianDays <= 14) return `La mitad compra dentro de ${medianDays} días: haz seguimiento antes de que pasen dos semanas.`
  return `Suelen tardar (${medianDays} días la mitad): seguimiento con calma, sin soltarlo.`
}

// stats: { consultaron, compraron, mediana_dias, p90_dias }
// destinations: [{ program_id, program_name, is_membership, compradores }]
export function buildPlaybook ({ program, stats, destinations, detail }) {
  const backed = stats.consultaron >= MIN_SAMPLE
  const median = stats.compraron ? Math.round(Number(stats.mediana_dias)) : null
  return {
    program_id: program.program_id,
    programa: program.program_name,
    tier: program.tier ?? 'BAJO',
    muestra: stats.consultaron,
    // Con pocos casos se dice cuantos, pero no se inventa un %.
    conversion: backed ? pct(stats.compraron, stats.consultaron) : null,
    resumen: backed
      ? `De ${stats.consultaron} personas nuevas que preguntaron por este programa, ${pct(stats.compraron, stats.consultaron)}% compró en los ${CONVERSION_WINDOW_DAYS} días siguientes.`
      : `Solo ${stats.consultaron} personas nuevas preguntaron por este programa: todavía no hay suficientes casos para un %.`,
    velocidad: backed ? speedAdvice(median) : null,
    destinos: backed && stats.compraron
      ? destinations.slice(0, MAX_DESTINATIONS).map((d) => ({
        program_id: d.program_id,
        programa: d.program_name,
        membresia: d.is_membership,
        mismo: d.program_id === program.program_id,
        pct: pct(d.compradores, stats.compraron)
      }))
      : [],
    ...offerContext(detail)
  }
}
