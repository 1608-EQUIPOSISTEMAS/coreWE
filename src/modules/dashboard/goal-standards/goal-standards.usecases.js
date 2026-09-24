import { goalStandardsRepository as repo } from './goal-standards.repository.js'

// Gerencia > Parámetros: el estándar de objetivo por programa. Es la fuente del
// objetivo de toda edición futura, así que guardar un parámetro y bajarlo a las
// ediciones son UN acto, no dos: separarlos dejaría la pantalla diciendo una cosa
// y el cronograma otra hasta que alguien se acordara de pulsar el segundo botón.

const SIDES = ['APERTURA', 'SEGUIMIENTO']

const toStandardDto = (r) => ({
  program_version_id: r.program_version_id,
  programa: r.programa || r.program_name,
  programa_largo: r.program_name,
  linea: r.linea,
  // null = el programa no tiene estándar cargado para esa temporada.
  lado: r.side,
  canales: r.channel_goals || {},
  ediciones_futuras: r.ediciones_futuras || 0,
  editado_en: r.modification_date,
  autor: r.autor
})

export async function goalStandardsList (payload = {}) {
  const { season = 'NORMAL' } = payload
  const rows = await repo.list({ season })
  return { season, items: rows.map(toStandardDto) }
}

export async function saveGoalStandards ({ standards = [], season = 'NORMAL', userId }) {
  if (!standards.length) return { saved: 0, applied: 0 }
  const normalizados = standards.map((s) => ({
    program_version_id: s.program_version_id,
    // Un lado desconocido no puede llegar a la BD: hay un CHECK, y fallar con
    // "violación de restricción" no le dice nada a quien está en la pantalla.
    side: SIDES.includes(s.lado) ? s.lado : 'SEGUIMIENTO',
    channel_goals: s.canales ?? {}
  }))
  const { saved } = await repo.save({ standards: normalizados, season, userId })
  const { applied } = await repo.apply({ versionIds: normalizados.map((s) => s.program_version_id), userId })
  return { saved, applied }
}

// Recalcular todo: alcanza a las ediciones creadas DESPUÉS del último cambio de
// parámetros, que nacieron sin objetivo porque nadie volvió a tocar la pantalla.
export async function applyGoalStandards ({ userId }) {
  return repo.apply({ versionIds: null, userId })
}
