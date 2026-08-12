// Lectores del número de seguidores por red social.
//
// Cada lector recibe el external_id de la cuenta (page id, ig user id, channel id)
// y devuelve un entero, o lanza. buildFollowerProviders() arma el mapa solo con
// las redes que tienen credenciales configuradas: una red sin token no es un
// error, es una red que se sigue cargando a mano — mismo criterio que
// social-sync.cron.js.
//
// Deliberadamente fuera del mapa, todas de carga manual:
//   LINKEDIN        sin acceso concedido al producto Community Management
//   FACEBOOK_GROUP  Meta eliminó la Groups API el 22/04/2024 y los admins ya no
//                   pueden instalar apps en un grupo, que era la vía al token
//   WHATSAPP        son contactos por línea de asesor, no seguidores
//   TIKTOK          la Display API exige persistir y rotar un refresh token;
//                   se agrega llenándole el external_id a la cuenta

const GRAPH_API = 'https://graph.facebook.com/v21.0'

async function readJson (url, options, label) {
  const res = await fetch(url, options)
  const body = await res.text()
  if (!res.ok) throw new Error(`${label} ${res.status}: ${body.slice(0, 200)}`)
  return JSON.parse(body)
}

// Un conteo ausente o no numérico se trata como fallo y no como cero: guardar un
// 0 dejaría una caída de miles de seguidores en la serie.
function requireCount (value, label) {
  const count = Number(value)
  if (value === null || value === undefined || !Number.isInteger(count) || count < 0) {
    throw new Error(`${label} devolvió un conteo inesperado: ${JSON.stringify(value)}`)
  }
  return count
}

// Meta acepta el token por header, así no queda escrito en los logs de red y de
// proxy como sí pasa cuando viaja en el query string.
function metaReader (token, label) {
  return async (externalId) => {
    const data = await readJson(
      `${GRAPH_API}/${encodeURIComponent(externalId)}?fields=followers_count`,
      { headers: { Authorization: `Bearer ${token}` } },
      label)
    return requireCount(data.followers_count, label)
  }
}

// La API key de YouTube solo viaja por query string: no admite Authorization.
//
// Ojo con el dato: YouTube redondea subscriberCount a 3 cifras significativas
// (un canal de 14 334 reporta 14 300), así que el crecimiento semanal de esta
// red sale a saltos y no continuo. No es un defecto del módulo.
function youtubeReader (apiKey) {
  return async (channelId) => {
    const data = await readJson(
      'https://www.googleapis.com/youtube/v3/channels' +
      `?part=statistics&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`,
      {}, 'YouTube')
    const statistics = data.items?.[0]?.statistics
    if (!statistics) throw new Error(`YouTube: el canal ${channelId} no devolvió resultados`)
    return requireCount(statistics.subscriberCount, 'YouTube')
  }
}

export function buildFollowerProviders (env = process.env) {
  const providers = {}
  if (env.IG_ACCESS_TOKEN) providers.INSTAGRAM = metaReader(env.IG_ACCESS_TOKEN, 'Instagram')
  if (env.FB_PAGE_TOKEN) providers.FACEBOOK = metaReader(env.FB_PAGE_TOKEN, 'Facebook')
  if (env.YOUTUBE_API_KEY) providers.YOUTUBE = youtubeReader(env.YOUTUBE_API_KEY)
  return providers
}
