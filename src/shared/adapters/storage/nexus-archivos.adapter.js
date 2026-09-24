import 'dotenv/config'
import { Storage } from '@google-cloud/storage'

// Los vouchers y evidencias de los tramites del portal los sube Nexus a SU
// bucket de GCS; el ERP solo guarda la clave (`solicitudes_portal.voucher_key`).
// Para que FICO los vea, el ERP firma una URL de lectura con las mismas
// credenciales. El objeto nunca se hace publico: la URL dura diez minutos.
//
// Configuracion opcional: sin NEXUS_GCS_BUCKET el resto del ERP arranca igual y
// solo este boton responde que falta configurarlo.
const { NEXUS_GCS_BUCKET, NEXUS_GCS_CREDENTIALS, NEXUS_GCP_PROJECT_ID } = process.env
const VIGENCIA_MS = 10 * 60 * 1000

let bucket = null
function bucketDeNexus () {
  if (!NEXUS_GCS_BUCKET) return null
  bucket ??= new Storage({ projectId: NEXUS_GCP_PROJECT_ID, keyFilename: NEXUS_GCS_CREDENTIALS }).bucket(NEXUS_GCS_BUCKET)
  return bucket
}

/** @returns {Promise<string|null>} null si el bucket no esta configurado. */
export async function urlDeLectura (clave) {
  const destino = bucketDeNexus()
  if (!destino) return null
  const [url] = await destino.file(clave).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + VIGENCIA_MS
  })
  return url
}
