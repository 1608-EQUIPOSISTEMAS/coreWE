import { classroomExportRepository } from './classroom-export.repository.js'
import { groupExportOptions, buildClassroomCsv } from './classroom-export.entity.js'
import { toExportOptionsDto, toClassroomCsvDto } from './classroom-export.dto.js'

// Orquestacion de la exportacion del aula virtual. Reporteria de solo lectura:
// el repository consulta, la entity agrupa/serializa, el dto fija el borde.

const repo = classroomExportRepository

// Devuelve las opciones de exportacion agrupadas por programa/edicion.
export async function getClassroomExportOptions () {
  const rows = await repo.listOptions()
  return toExportOptionsDto(groupExportOptions(rows))
}

// Genera el CSV del aula virtual para una edicion concreta.
export async function exportClassroomCsv ({ programVersionId, editionNumId }) {
  const rows = await repo.listStudentsForCsv({ programVersionId, editionNumId })
  return toClassroomCsvDto(buildClassroomCsv(rows))
}
