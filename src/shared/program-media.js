// Archivos del programa que el bot de WhatsApp le manda al lead (arte del
// docente, brochure, modelo de certificado). Reglas puras, compartidas: las usa
// Producto al validar la subida (modules/program) y el bot al enviarlos
// (modules/whatsapp). Un módulo no importa de otro: por eso viven en shared.
//
// Los mantiene Producto en la ficha del programa: así hay un solo brochure y no
// una copia del bot que se queda vieja cuando cambia el temario.
export const PROGRAM_MEDIA_SLOTS = [
  // "docente" es el arte de difusión (docente + trayectoria + fecha), no la foto
  // suelta de su ficha. El slot conserva el nombre: es el archivo ya subido.
  { slot: 'docente', label: 'Arte del docente', kinds: ['image'] },
  { slot: 'brochure', label: 'Brochure', kinds: ['document'] },
  { slot: 'certificado', label: 'Modelo de certificado', kinds: ['image', 'document'] }
]

// Fase 1 manda imágenes y documentos; videos no (decisión de negocio).
const MEDIA_KINDS = {
  '.jpg': { kind: 'image', mimeType: 'image/jpeg' },
  '.jpeg': { kind: 'image', mimeType: 'image/jpeg' },
  '.png': { kind: 'image', mimeType: 'image/png' },
  '.pdf': { kind: 'document', mimeType: 'application/pdf' }
}
// Tope de la Cloud API de WhatsApp para imágenes: 5 MB. El PDF lo limita la
// subida del ERP (30 MB, @fastify/multipart), muy por debajo de los 100 MB de Meta.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// null si el archivo no se puede mandar (extensión no soportada o imagen pesada).
export function mediaKindFor (filename, sizeBytes) {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  const media = MEDIA_KINDS[ext]
  if (!media) return null
  if (media.kind === 'image' && sizeBytes > MAX_IMAGE_BYTES) return null
  return media
}

// Mensaje del porqué se rechaza, o null si el archivo sirve para ese slot.
export function programMediaProblem ({ slot, filename, sizeBytes }) {
  const definition = PROGRAM_MEDIA_SLOTS.find(s => s.slot === slot)
  if (!definition) return `"${slot}" no es un archivo del programa.`
  const media = mediaKindFor(filename, sizeBytes)
  const allowed = definition.kinds.map(k => k === 'image' ? 'JPG o PNG de hasta 5 MB' : 'PDF').join(' o ')
  if (!media || !definition.kinds.includes(media.kind)) return `${definition.label}: sube un ${allowed}.`
  return null
}
