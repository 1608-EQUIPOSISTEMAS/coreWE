// Cuándo corre solo el sync FICO → Google Sheets. Reglas puras: sin BD ni reloj
// oculto (el cron pasa `now`). El contador de cambios lo sube un trigger en cada
// tabla que alimenta las hojas (scripts/fico-sheets-autosync.sql).

const MIN = 60_000

export const AUTOSYNC = {
  // FICO suele hacer varios cambios seguidos: se espera a que pare un minuto
  // para subirlos todos en una sola corrida...
  quietMs: 1 * MIN,
  // ...pero si no para nunca, igual se sincroniza a los 5 minutos.
  maxWaitMs: 5 * MIN,
  // Tope de carga: como mucho una corrida cada 3 minutos (20 por hora).
  minGapMs: 3 * MIN,
  // Red de seguridad para lo que el contador no ve (CONT SISTEMAS también lee
  // el Sheet "0. Planeamiento 26"): una corrida por hora en horario de oficina.
  safetyEveryMs: 60 * MIN,
  safetyFromHour: 7,
  safetyToHour: 22,
  // Una corrida normal dura segundos; pasado esto se da por colgada.
  runTimeoutMs: 5 * MIN
}

// Perú no tiene horario de verano: UTC-5 fijo.
const limaHour = (now) => new Date(now - 5 * 60 * MIN).getUTCHours()

// Lo que el cron recuerda entre vueltas. Se recalcula en cada tick con el
// contador leído de la BD; si el proceso se reinicia, arranca de cero y lo peor
// que pasa es esperar un minuto más.
export function observeChanges (state, { version, syncedVersion, now }) {
  const moved = version !== state.version
  const pending = version > syncedVersion
  return {
    version,
    changedAt: moved ? now : state.changedAt,
    pendingSince: pending ? (state.pendingSince ?? now) : null
  }
}

// { run: false } o { run: true, trigger: 'changes' | 'safety' }.
export function decideAutoSync ({ state, now, lastRunAt = null, lastOkAt = null, cfg = AUTOSYNC }) {
  if (lastRunAt != null && now - lastRunAt < cfg.minGapMs) return { run: false }

  if (state.pendingSince != null) {
    const quiet = now - state.changedAt >= cfg.quietMs
    const overdue = now - state.pendingSince >= cfg.maxWaitMs
    if (quiet || overdue) return { run: true, trigger: 'changes' }
    return { run: false }
  }

  const hour = limaHour(now)
  const officeHours = hour >= cfg.safetyFromHour && hour < cfg.safetyToHour
  const stale = lastOkAt == null || now - lastOkAt >= cfg.safetyEveryMs
  if (officeHours && stale) return { run: true, trigger: 'safety' }
  return { run: false }
}

// Se avisa a Slack al llegar exactamente a N fallas seguidas: una vez por racha,
// no en cada vuelta (cada 3 minutos sería ruido).
export const ALERT_AFTER_FAILURES = 3
export const shouldAlertFailures = (consecutiveFailures) => consecutiveFailures === ALERT_AFTER_FAILURES

// ── Reemplazo atómico de una hoja ──────────────────────────────────────────
// Antes: clear + update (dos llamadas). Si la segunda fallaba, la hoja quedaba
// VACÍA hasta la siguiente corrida, y los SUMIFS de otros libros sumaban 0.
// Ahora: UNA sola llamada que escribe las filas nuevas y pisa con '' las viejas
// que sobran. Google la aplica entera o nada: la hoja nunca queda vacía ni mezclada.

export function columnWidth (lastCol) {
  return [...lastCol.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
}

// En la API de Sheets un null o una celda faltante significan "no tocar": sin
// clear previo dejarían el valor viejo. Toda celda se escribe, aunque sea ''.
export function buildReplacement (values, width, existingRows) {
  const cell = (v) => (v === null || v === undefined ? '' : v)
  const rows = values.map((r) => Array.from({ length: width }, (_, i) => cell(r[i])))
  const blank = Array(width).fill('')
  for (let i = rows.length; i < existingRows; i++) rows.push(blank)
  return rows
}
