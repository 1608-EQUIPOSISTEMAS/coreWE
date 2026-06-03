// Logica pura de la exportacion del aula virtual: agrupacion de opciones por
// programa/edicion y serializacion CSV. Sin acceso a BD, red ni tiempo: recibe
// las filas ya consultadas y devuelve estructuras listas para responder.

// Cabeceras fijas del CSV del aula virtual. Usuario, Contrasena y Cat Prog
// quedan en blanco para llenado manual posterior por el equipo academico.
export const CLASSROOM_CSV_HEADERS = [
  'Nombres y Apellidos', 'N° Grp', 'Cat Prog', 'Usuario', 'Contraseña',
  'Modalidad', 'Celular', 'Correo', 'Ocup', 'Correo Odoo', 'Estado'
]

// Agrupa las filas planas (una por edicion) en programas con su lista de
// ediciones. Preserva el orden de aparicion de las filas (ya vienen ordenadas
// por version_code y start_date desde el repository).
export function groupExportOptions (rows) {
  const programsMap = new Map()
  for (const r of rows) {
    if (!programsMap.has(r.program_version_id)) {
      programsMap.set(r.program_version_id, {
        program_version_id: r.program_version_id,
        version_code: r.version_code,
        abbreviation: r.abbreviation,
        editions: []
      })
    }
    programsMap.get(r.program_version_id).editions.push({
      edition_num_id: r.edition_num_id,
      start_date: r.start_date,
      students_count: r.students_count
    })
  }
  return Array.from(programsMap.values())
}

// Escapa un valor segun RFC 4180: entrecomilla y duplica comillas si el valor
// contiene comas, comillas o saltos de linea.
function escapeCsv (v) {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Serializa las filas de alumnos al CSV del aula. Antepone BOM UTF-8 para que
// Excel respete los acentos y usa CRLF como separador de linea. Las columnas
// N° Grp, Usuario y Contrasena se emiten vacias (llenado manual).
export function buildClassroomCsv (rows) {
  const lines = [CLASSROOM_CSV_HEADERS.map(escapeCsv).join(',')]
  for (const r of rows) {
    lines.push([
      r.nombres_apellidos || '',
      '',
      r.cat_prog || '',
      '',
      '',
      r.modalidad || '',
      r.celular || '',
      r.correo || '',
      r.ocup || '',
      r.correo_odoo || '',
      r.estado || ''
    ].map(escapeCsv).join(','))
  }
  return '﻿' + lines.join('\r\n')
}
