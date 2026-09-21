// Cliente minimo de la API REST de Gemini. Sin SDK: una sola llamada con fetch
// nativo, que es todo lo que el ERP necesita del lado de Node (el analisis
// pesado de aulas vive en el sidecar FastAPI de ai_auditor/).
//
// Solo expone salida estructurada: se pasa un responseSchema y se devuelve el
// JSON ya parseado. Un modelo que conteste prosa libre no le sirve a nadie aca.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

// Corto a proposito: esto corre mientras alguien mira un DM esperando respuesta.
// Si Gemini no contesta en 15 s, quien llama usa su plan B.
const TIMEOUT_MS = 15_000

export const geminiConfigurado = () => Boolean(process.env.GEMINI_API_KEY)

/**
 * Una generacion con salida JSON validada contra `schema`.
 *
 * Devuelve el objeto parseado, o null ante cualquier problema (sin clave, red
 * caida, timeout, cuota, JSON invalido). Nunca lanza: los llamadores tienen que
 * poder seguir sin IA, asi que un fallo se trata como "no hay respuesta", no
 * como un error que voltea la operacion.
 *
 * @param {object}  opts
 * @param {string}  opts.instruccion  systemInstruction: el rol y las reglas.
 * @param {string}  opts.texto        Contenido del usuario (no confiable).
 * @param {object}  opts.schema       responseSchema en el subset de OpenAPI.
 * @param {string} [opts.modelo]      Por defecto GEMINI_CLASSIFIER_MODEL.
 * @param {number} [opts.maxTokens]   Tope de salida. Bajo = barato.
 */
export async function generarJson ({ instruccion, texto, schema, modelo, maxTokens = 256 }) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const modelName = modelo || process.env.GEMINI_CLASSIFIER_MODEL || 'gemini-2.5-flash'

  const cuerpo = {
    systemInstruction: { parts: [{ text: instruccion }] },
    contents: [{ role: 'user', parts: [{ text: texto }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      // Clasificar y titular no es creativo: la misma entrada tiene que dar
      // siempre la misma salida.
      temperature: 0,
      maxOutputTokens: maxTokens,
      // Los 2.5 razonan antes de responder y ese razonamiento se factura. Para
      // extraer tres campos de un mensaje corto no aporta nada.
      thinkingConfig: { thinkingBudget: 0 }
    }
  }

  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(modelName)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })

    if (!res.ok) {
      console.error(`[gemini] HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
      return null
    }

    const datos = await res.json()
    const salida = datos?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!salida) {
      // Pasa cuando el modelo se queda sin maxOutputTokens o corta por safety.
      console.error(`[gemini] respuesta sin texto (finishReason: ${datos?.candidates?.[0]?.finishReason ?? '?'})`)
      return null
    }

    return JSON.parse(salida)
  } catch (err) {
    const motivo = err?.name === 'TimeoutError' ? `no respondio en ${TIMEOUT_MS / 1000}s` : err.message
    console.error(`[gemini] ${motivo}`)
    return null
  }
}
