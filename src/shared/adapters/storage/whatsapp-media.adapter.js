import fs from 'node:fs/promises'
import path from 'node:path'
import { PROGRAM_MEDIA_SLOTS } from '../../program-media.js'

// Biblioteca de archivos que el bot manda por programa (docente, brochure,
// certificado, testimonio). Vive en el mismo disco que los vouchers de Comercial
// (UPLOAD_DIR), una carpeta por programa:
//
//   uploads/whatsapp/programas/<program_id>/docente.jpg
//                                          /brochure.pdf
//                                          /certificado.png
//
// El nombre del archivo (sin extensión) es el "slot" que pide el guion.
// Producto los sube desde la ficha del programa (Programas → Archivos del programa).
// ponytail: convención de nombres en vez de tabla; pasar a BD si hace falta historial de versiones.
const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')

export const programMediaDir = programId =>
  path.join(UPLOAD_ROOT, 'whatsapp', 'programas', String(programId))

// { slot: { filename, buffer } } de lo que haya en la carpeta; {} si no existe.
export async function readProgramMedia (programId) {
  const dir = programMediaDir(programId)
  const entries = await Promise.all((await namesIn(dir)).map(async filename =>
    [path.parse(filename).name, { filename, buffer: await fs.readFile(path.join(dir, filename)) }]))
  return Object.fromEntries(entries)
}

async function namesIn (dir) {
  return fs.readdir(dir).catch(err => {
    if (err.code === 'ENOENT') return []
    throw err
  })
}

// Sin leer los archivos: para la ficha (qué hay, cuánto pesa, cuándo se subió).
export async function listProgramMediaFiles (programId) {
  const dir = programMediaDir(programId)
  const entries = await Promise.all((await namesIn(dir)).map(async filename => {
    const { size, mtime } = await fs.stat(path.join(dir, filename))
    return [path.parse(filename).name, { filename, size, updatedAt: mtime.toISOString() }]
  }))
  return Object.fromEntries(entries)
}

// `slot` ya viene validado (PROGRAM_MEDIA_SLOTS) y `ext` del nombre aceptado:
// nada del usuario llega crudo al path. Se borra el anterior del mismo slot
// aunque tenga otra extensión (docente.jpg → docente.png).
export async function saveProgramMediaFile ({ programId, slot, ext, buffer }) {
  const dir = programMediaDir(programId)
  await fs.mkdir(dir, { recursive: true })
  await deleteProgramMediaFile({ programId, slot })
  await fs.writeFile(path.join(dir, `${slot}${ext}`), buffer)
}

export async function deleteProgramMediaFile ({ programId, slot }) {
  const dir = programMediaDir(programId)
  for (const filename of await namesIn(dir)) {
    if (path.parse(filename).name === slot) await fs.unlink(path.join(dir, filename))
  }
}

// Qué le falta a cada programa para que el bot mande su información completa:
// { program_id: ['Brochure', …] }.
export async function missingProgramMedia (programIds) {
  const entries = await Promise.all(programIds.map(async programId => {
    const files = await listProgramMediaFiles(programId)
    return [programId, PROGRAM_MEDIA_SLOTS.filter(s => !files[s.slot]).map(s => s.label)]
  }))
  return Object.fromEntries(entries)
}
