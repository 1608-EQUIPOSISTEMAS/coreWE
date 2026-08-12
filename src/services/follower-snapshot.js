// Captura de seguidores: compone las dependencias (lectores de API + reloj) y
// protege contra corridas solapadas.
//
// Vive aparte de follower-snapshot.cron.js a propósito: importar el .cron.js
// programa el cron por side-effect, así que el controller del botón
// "Sincronizar" —y cualquier test— tirarían de un scheduler sin quererlo.
// Aquí no se agenda nada; el .cron.js es solo el disparador periódico.

import { captureFollowers } from '../modules/marketing/growth.usecases.js'
import { buildFollowerProviders } from '../config/socialFollowersClient.js'

let _running = false

export async function snapshotFollowersNow (source = 'cron') {
  if (_running) return { running: true }
  _running = true
  try {
    const result = await captureFollowers({
      providers: buildFollowerProviders(),
      now: new Date(),
      capturedBy: source
    })
    console.log(`[follower-snapshot] (${source})`, JSON.stringify(result))
    return result
  } finally {
    _running = false
  }
}
