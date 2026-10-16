// Manual de venta por programa: "los NUEVOS que preguntan por X, ¿que hacen?".
// Es lo que sirve con un numero sin historia (la mayoria de los que escriben).
//
// Medido 15/10/26 con Power BI: de 380 nuevos que consultaron, 11.1% compro en
// 4 meses y la MITAD de esos compro en 2 dias (p90: 48). El 71% compro lo mismo;
// el 12%, la Membresia Plus. El dato que mas sirve al asesor es la velocidad.
import { MIN_SAMPLE, MIN_PROBABILITY, offerContext } from './prediccion.entity.js'

const MAX_ALTERNATIVES = 3
// Despues de esto el asesor ya no persigue: casi todo el que compra lo hizo antes.
const FOLLOW_UP_DAYS = 14

const pct = (part, total) => (total ? Math.round((1000 * part) / total) / 10 : 0)

// stats: { consultaron, compraron, mediana_dias, dia_0, dias_1_3, dias_4_14, en_cuotas, estudiantes }
// destinations: [{ program_id, program_name, is_membership, compradores }]
export function buildPlaybook ({ program, stats, destinations, detail }) {
  const backed = stats.consultaron >= MIN_SAMPLE
  const bought = backed ? stats.compraron : 0
  const boughtInFollowUp = stats.dia_0 + stats.dias_1_3 + stats.dias_4_14
  const same = destinations.find((d) => d.program_id === program.program_id)
  return {
    program_id: program.program_id,
    programa: program.program_name,
    tier: program.tier ?? 'BAJO',
    muestra: stats.consultaron,
    compraron: bought,
    // Con pocos casos se dice cuantos, pero no se inventa un %.
    conversion: backed ? pct(stats.compraron, stats.consultaron) : null,
    // Contra la conversion base de una consulta: dice si este programa cierra facil o no.
    vecesElPromedio: backed ? Math.round((10 * pct(stats.compraron, stats.consultaron)) / MIN_PROBABILITY) / 10 : null,
    medianaDias: bought ? Math.round(Number(stats.mediana_dias)) : null,
    cuando: bought
      ? [
          { tramo: 'El mismo día', pct: pct(stats.dia_0, bought) },
          { tramo: '1 a 3 días', pct: pct(stats.dias_1_3, bought) },
          { tramo: '4 a 14 días', pct: pct(stats.dias_4_14, bought) },
          { tramo: `Después de ${FOLLOW_UP_DAYS} días`, pct: pct(bought - boughtInFollowUp, bought) }
        ]
      : [],
    // De los que siguen sin comprar al dia 14, cuantos compran despues: cuando soltarlo.
    compranDespues: bought ? pct(bought - boughtInFollowUp, stats.consultaron - boughtInFollowUp) : null,
    pago: bought ? { cuotas: pct(stats.en_cuotas, bought), estudiantes: pct(stats.estudiantes, bought) } : null,
    mismo: bought ? pct(same?.compradores ?? 0, bought) : null,
    alternativas: bought
      ? destinations.filter((d) => d !== same).slice(0, MAX_ALTERNATIVES).map((d) => ({
          program_id: d.program_id,
          programa: d.program_name,
          membresia: d.is_membership,
          // La base va con el %: "4 de 21" dice cuanto pesa el plan B.
          compradores: d.compradores,
          pct: pct(d.compradores, bought)
        }))
      : [],
    ...offerContext(detail)
  }
}
