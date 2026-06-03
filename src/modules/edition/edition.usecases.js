import { editionRepository } from './edition.repository.js'
import { handleSpResponse } from '../../utils/dbResponse.js'
import {
  buildEditionFilters,
  buildEditionByWeekFilters,
  buildA5Payload,
  validateRubricParams,
  resolveAiAuditorUrl,
  formatStartDate
} from './edition.entity.js'
import {
  toSpRowOrFallback,
  toListDto,
  toByWeekDto,
  toUpdateDto,
  toA5MigrationDto
} from './edition.dto.js'

const repo = editionRepository

// REGISTER (simple). El SP devuelve result, response, message.
export async function editionRegister ({ edition = {}, user_id } = {}) {
  const rows = await repo.register(edition, user_id)
  return toSpRowOrFallback(rows)
}

// REGISTER TREE (padre + hijos). handleSpResponse lanza si result === 0.
export async function editionTreeRegister ({ edition = {}, user_id } = {}) {
  const rows = await repo.treeRegister(edition, user_id)
  return handleSpResponse(rows)
}

// LIST con filtros, multiselect y paginacion.
export async function editionList (payload = {}) {
  const { filters, page, size } = buildEditionFilters(payload)
  const rows = await repo.list(filters)
  return toListDto({ rows, page, size })
}

// LIST BY WEEK: resuelve mes/anio contra la fecha actual.
export async function editionByWeeklist (payload = {}) {
  const { filters, page, size } = buildEditionByWeekFilters(payload)
  const rows = await repo.listByWeek(filters)
  return toByWeekDto({ rows, page, size })
}

// UPDATE (simple). Inyecta edition_num_id desde id o el propio edition.
export async function editionUpdate ({ id, edition = {}, user_id = null } = {}) {
  const payloadEdition = {
    ...edition,
    edition_num_id: id || edition.edition_num_id
  }
  const rows = await repo.update(payloadEdition, user_id)
  return toUpdateDto(rows)
}

// UPDATE TREE (padre + hijos). Retorna la fila cruda del SP o el fallback.
export async function editionTreeUpdate ({ edition = {}, user_id } = {}) {
  const rows = await repo.treeUpdate(edition, user_id)
  return toSpRowOrFallback(rows)
}

// OBTENER EDICION (padre + hijos) POR ID. Retorna raw, el front mapea.
export async function editionGet ({ id } = {}) {
  const editionId = Number(id) || null
  if (!editionId) return null
  const rows = await repo.treeGet(editionId)
  return rows?.[0] || null
}

// Logs de auditoria agrupados por transaccion.
export async function auditLogsGet ({ edition_id = null, limit = 50, offset = 0 } = {}) {
  const pedition_id = edition_id ? Number(edition_id) : null
  const pLimit = Number(limit) || 50
  const pOffset = Number(offset) || 0
  const rows = await repo.auditLogsGet(pedition_id, pLimit, pOffset)
  return rows || []
}

// CALLER (combos / SearchSelect). Array directo.
export async function editionCaller (payload = {}) {
  const {
    program_version_id,
    active = null,
    cat_status_edition = null,
    q = null,
    year = null,
    month = null
  } = payload
  return repo.caller(program_version_id, active, cat_status_edition, q, month, year)
}

// CALLER de info extra por version de programa. Array directo.
export async function editionextrainfocaller (payload = {}) {
  const { program_version_id } = payload
  return repo.extraInfoCaller(program_version_id)
}

// Lista enrollments vigentes en una edicion que pasara a A5.
export async function a5PendingEnrollments ({ edition_num_id } = {}) {
  const editionId = Number(edition_num_id)
  if (!editionId) return []
  return repo.a5PendingEnrollments(editionId)
}

// Ejecuta migracion masiva + cancelacion A5 en transaccion atomica.
export async function a5MigrationExecute ({ payload = {}, user_id } = {}) {
  const rows = await repo.a5MigrationExecute(payload, user_id)
  return toA5MigrationDto(rows)
}

// Actualiza masivamente el link de WhatsApp por abreviatura + fecha de inicio.
export async function bulkUpdateWhatsapp (items) {
  let updated = 0
  const notFound = []

  for (const item of items) {
    if (!item.abbreviation || !item.start_date || !item.whatsapp_link) continue

    const isoDate = formatStartDate(item.start_date)

    const rowCount = await repo.updateWhatsappLink(
      item.whatsapp_link.trim(),
      item.abbreviation.trim(),
      isoDate
    )

    if (rowCount > 0) {
      updated += rowCount
    } else {
      notFound.push(`${item.abbreviation} - ${item.start_date}`)
    }
  }

  return { updated, not_found: notFound }
}

// Conteo de alumnos por edicion (aula).
export async function classroomMetricsList ({ edition_ids = [] } = {}) {
  const ids = (edition_ids || []).map(Number).filter(Number.isFinite)
  if (!ids.length) return []
  return repo.classroomMetricsList(ids)
}

// Listado de alumnos matriculados (FICO-aprobados) en una edicion/aula.
export async function classroomStudentsList ({ edition_id } = {}) {
  const id = Number(edition_id)
  if (!Number.isFinite(id)) return []
  return repo.classroomStudentsList(id)
}

// Resumen agregado de auditoria por aula.
export async function classroomAuditSummaryList ({ edition_ids = [] } = {}) {
  const ids = (edition_ids || []).map(Number).filter(Number.isFinite)
  if (!ids.length) return []
  return repo.classroomAuditSummaryList(ids)
}

// Carga toda la rubrica de evaluacion al docente para una edicion (aula).
export async function classroomAuditGet ({ edition_id } = {}) {
  const id = Number(edition_id)
  if (!Number.isFinite(id)) return []
  return repo.classroomAuditGet(id)
}

// Upsert atomico de la rubrica manual de una sesion. Reemplaza criteria completo.
export async function classroomAuditSave ({ edition_id, session_number, criteria, user_id = null } = {}) {
  const { valid, eid, sn } = validateRubricParams(edition_id, session_number)
  if (!valid) {
    return { ok: false, message: 'Parametros invalidos' }
  }
  const payload = criteria && typeof criteria === 'object' ? criteria : {}
  const uid = Number.isFinite(Number(user_id)) ? Number(user_id) : null
  const rows = await repo.classroomAuditSave(eid, sn, payload, uid)
  return { ok: true, row: rows[0] }
}

// Proxy del analisis IA: reenvia transcript + imagen al sidecar FastAPI y
// persiste el reporte en la fila (edicion, sesion). La URL del sidecar se
// resuelve en la primera llamada (no en import-time) para no tumbar el arranque
// del proceso si el host configurado no esta permitido.
export async function classroomAuditRunAi ({
  edition_id, session_number, transcript_text, syllabus_image, syllabus_filename
} = {}) {
  const { valid, eid, sn } = validateRubricParams(edition_id, session_number)
  if (!valid) {
    return { ok: false, message: 'Parametros invalidos' }
  }
  if (!transcript_text || !String(transcript_text).trim()) {
    return { ok: false, message: 'transcript_text vacio' }
  }
  if (!syllabus_image) {
    return { ok: false, message: 'Falta imagen del syllabus' }
  }

  const aiAuditorUrl = resolveAiAuditorUrl()

  // FormData nativa en Node 18+: el proxy reenvia el multipart al FastAPI sin
  // descomprimir/recomprimir; lo unico que paga es el TCP loopback.
  const form = new FormData()
  form.append('sesion_numero', String(sn))
  form.append('transcript_text', String(transcript_text))
  const blob = new Blob([syllabus_image], { type: 'application/octet-stream' })
  form.append('syllabus_image', blob, syllabus_filename || 'syllabus.png')

  // 10 min de timeout: Gemini con AFC puede iterar hasta 10 veces para
  // auto-corregir. Sin AbortController el fetch nativo de Node no tiene timeout
  // y la conexion queda colgada si Gemini muere a media respuesta.
  const aiController = new AbortController()
  const aiTimeoutId = setTimeout(() => aiController.abort(), 10 * 60 * 1000)

  let aiJson
  try {
    const resp = await fetch(`${aiAuditorUrl}/api/audit`, {
      method: 'POST',
      body: form,
      signal: aiController.signal
    })
    const text = await resp.text()
    if (!resp.ok) {
      let detail = text.slice(0, 400)
      try {
        const parsed = JSON.parse(text)
        const tb = Array.isArray(parsed.traceback) ? parsed.traceback.join(' | ') : ''
        detail = `${parsed.error || ''}: ${parsed.message || parsed.detail || text}${tb ? ' || ' + tb : ''}`.slice(0, 800)
      } catch { /* no es JSON, usar text crudo */ }
      return { ok: false, message: `IA respondio ${resp.status}: ${detail}` }
    }
    aiJson = JSON.parse(text)
  } catch (err) {
    const isAbort = err?.name === 'AbortError'
    return {
      ok: false,
      message: isAbort
        ? 'La IA tardo mas de 10 min en responder. Reintenta con un transcript mas corto o revisa que Gemini este disponible.'
        : `No se pudo contactar al servicio IA (${aiAuditorUrl}). Verifica que el FastAPI este corriendo (npm run ai:start). Detalle: ${err.message}`
    }
  } finally {
    clearTimeout(aiTimeoutId)
  }

  const report = aiJson?.report || null
  const metadata = aiJson?.metadata || null
  if (!report) return { ok: false, message: 'La IA no devolvio reporte' }

  const rows = await repo.classroomAuditUpsertAi(eid, sn, report, metadata)
  return { ok: true, row: rows[0] }
}
