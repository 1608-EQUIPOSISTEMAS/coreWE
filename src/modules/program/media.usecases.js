import path from 'node:path'
import { PROGRAM_MEDIA_SLOTS, programMediaProblem } from '../../shared/program-media.js'
import {
  listProgramMediaFiles, readProgramMedia, saveProgramMediaFile, deleteProgramMediaFile
} from '../../shared/adapters/storage/whatsapp-media.adapter.js'
import { DomainError, NotFoundError } from '../../shared/errors.js'

// Archivos del programa (foto del docente, brochure, modelo de certificado):
// los sube Producto en la ficha del programa y los manda el bot de WhatsApp.

export async function getProgramMedia ({ programId }) {
  const files = await listProgramMediaFiles(programId)
  return PROGRAM_MEDIA_SLOTS.map(({ slot, label, kinds }) => ({ slot, label, kinds, file: files[slot] ?? null }))
}

export async function uploadProgramMedia ({ programId, slot, filename, buffer }) {
  const problem = programMediaProblem({ slot, filename, sizeBytes: buffer.length })
  if (problem) throw new DomainError(problem)
  await saveProgramMediaFile({ programId, slot, ext: path.extname(filename).toLowerCase(), buffer })
  return getProgramMedia({ programId })
}

export async function deleteProgramMedia ({ programId, slot }) {
  if (!PROGRAM_MEDIA_SLOTS.some(s => s.slot === slot)) throw new DomainError(`"${slot}" no es un archivo del programa.`)
  await deleteProgramMediaFile({ programId, slot })
  return getProgramMedia({ programId })
}

// Para la vista previa en la ficha: en producción /uploads no se sirve público.
export async function readProgramMediaFile ({ programId, slot }) {
  const file = (await readProgramMedia(programId))[slot]
  if (!file || !PROGRAM_MEDIA_SLOTS.some(s => s.slot === slot)) throw new NotFoundError('Ese archivo no está subido.')
  return file
}
