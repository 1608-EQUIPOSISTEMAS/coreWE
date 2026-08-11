import fs from 'fs'
import path from 'path'

import { DomainError } from '../../shared/errors.js'
import { comercialRepository } from './comercial.repository.js'
import slackClient from '../../config/slack.js'
import { refreshEnrollmentMv } from '../../services/fico-mv-refresh.cron.js'
import { buildValidationRows } from '../fico/validation/validation.entity.js'
import {
  buildFilterPayload,
  buildStatsFilterPayload,
  buildUniqueFilename,
  detectChannelAlias,
  normalizeActiveProgramVersion,
  buildEditionFilterPayload
} from './comercial.entity.js'
import { toPaginatedDto } from './comercial.dto.js'

const repo = comercialRepository

const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')

// Efectos secundarios de integracion (Slack/Sheets) disparados tras una inscripcion.
// Se inyectan desde el composition root (buildApp) para no acoplar comercial con
// los internals del modulo integration. Por defecto no-op (best-effort).
const integrationPorts = {
  sendEnrollmentWebToSlack: async () => {},
  syncEnrollmentToSheet: async () => {}
}

export function setIntegrationPorts (ports = {}) {
  Object.assign(integrationPorts, ports)
}

export async function leadRegister ({ lead = {}, person = {}, contact_attempts = [], user_id } = {}) {
  return repo.leadRegister(person, lead, contact_attempts, user_id)
}

export async function leadUpdate (payload) {
  const { id, lead = {}, user_id, contact_attempts } = payload
  return repo.leadUpdate(id, lead, user_id, contact_attempts)
}

export async function leadGet (payload) {
  const { id } = payload
  return { data: await repo.leadGet(id) }
}

export async function leadList (payload = {}) {
  const { page = 1, size = 25 } = payload
  const filters = buildFilterPayload(payload)
  const rows = await repo.leadList(filters)
  return {
    total: rows?.[0]?.total_count ? Number(rows[0].total_count) : 0,
    page: Number(page),
    size: Number(size),
    items: rows
  }
}

export async function leadStats (payload = {}) {
  const filters = buildStatsFilterPayload(payload)
  return repo.leadStats(filters)
}

// Distinto de celulares de origen con su owner para alimentar el filtro de
// columna. Cache proceso-local de 5 min: no sobrevive reinicios ni escala a
// multiples instancias (limitacion conocida, heredada del service legacy).
let _sellerPhonesCache = null
let _sellerPhonesCachedAt = 0
const SELLER_PHONES_TTL_MS = 5 * 60 * 1000

export async function leadSellerPhones () {
  const now = Date.now()
  if (_sellerPhonesCache && (now - _sellerPhonesCachedAt) < SELLER_PHONES_TTL_MS) {
    return _sellerPhonesCache
  }
  const rows = await repo.sellerPhones()
  _sellerPhonesCache = rows.map(r => ({
    id: r.phone,
    description: r.owner ? `${r.phone} — ${r.owner}` : r.phone
  }))
  _sellerPhonesCachedAt = now
  return _sellerPhonesCache
}

export async function enrollmentGet (enrollment_id) {
  return repo.enrollmentGet(enrollment_id)
}

export async function enrollmentRegister (payload) {
  const user_id = payload.user_id
  const lead_id = payload.inscription?.lead_id || payload.lead_id

  if (!lead_id) throw new DomainError('El lead_id es obligatorio para la inscripción')

  // Detectamos un estado OBSERVADO previo: si lo hay, este registro es una
  // subsanacion (re-registro en sitio) y se audita como 'resubmitted' despues.
  let wasObserved = false
  try {
    const alias = await repo.leadFicoStatusAlias(lead_id)
    wasObserved = alias === 'we_enrollment_status_observed'
  } catch (chkErr) {
    console.error('[enrollmentRegister] No se pudo verificar estado observado:', chkErr.message)
  }

  const response = await repo.enrollmentRegister(lead_id, user_id, payload)

  if (response.result === 1 && response.enrollment_id) {
    // Refresco inmediato de la MV del listado FICO para que la matricula
    // (alta nueva o subsanacion) aparezca/actualice al instante.
    refreshEnrollmentMv('on-comercial-register')

    if (wasObserved) {
      try {
        await repo.insertResubmitAudit(response.enrollment_id, user_id)
      } catch (audErr) {
        console.error('[enrollmentRegister] No se pudo auditar resubmit:', audErr.message)
      }

      try {
        const ed = await repo.resubmitSlackData(response.enrollment_id)
        if (ed) {
          const edDate = ed.edition_start_date ? new Date(ed.edition_start_date).toLocaleDateString('es-PE') : ''
          await slackClient.notifyEnrollmentResubmitted({
            studentName: ed.student_name,
            programName: ed.program_name,
            editionCode: ed.edition_code,
            editionDate: edDate,
            advisorName: ed.advisor_alias
          })
        }
      } catch (slackErr) {
        console.error('[enrollmentRegister] Slack resubmit:', slackErr.message)
      }
    }

    const vals = payload.validations
    if (vals?.enabled) {
      try {
        const rows = buildValidationRows({
          validatedChildren: vals.validated_children || [],
          customEditions: vals.custom_editions || {}
        })
        for (const row of rows) {
          await repo.insertEnrollmentValidation(
            response.enrollment_id,
            row.childVersionId,
            row.validationType,
            row.customEditionId,
            vals.notes || null,
            user_id
          )
        }
        const overrides = rows.length - (vals.validated_children?.length || 0)
        await repo.insertValidationRequestedAudit(
          response.enrollment_id,
          user_id,
          `Convalidacion solicitada: ${vals.validated_children?.length || 0} modulo(s) convalidado(s), ${overrides} con edicion personalizada. ${vals.notes || ''}`
        )
      } catch (err) {
        console.error('[enrollmentRegister] Error guardando convalidaciones:', err.message)
      }
    }

    const channelId = payload.inscription?.cat_payment_channel
    const channelAlias = await repo.catalogAliasById(channelId)
    const channel = detectChannelAlias(channelAlias)

    if (channel === 'web') {
      integrationPorts.sendEnrollmentWebToSlack({ enrollment_id: response.enrollment_id })
        .catch(err => console.error('Slack WEB notify failed:', err))
    }

    if (channel === 'general') {
      integrationPorts.syncEnrollmentToSheet()
        .catch(err => console.error('Sheet GENERAL sync failed:', err))
    }
  }

  return response
}

export async function enrollmentSlackWeb ({ enrollment_id }) {
  return integrationPorts.sendEnrollmentWebToSlack({ enrollment_id })
}

export async function uploadEnrollmentFiles ({ enrollment_id, paymentFile, studentFile }) {
  let paymentUrl = null
  let studentUrl = null

  const saveLocalFile = async (fileData, subfolder) => {
    if (!fileData) return null
    const { filename, buffer } = fileData
    const uniqueName = buildUniqueFilename(filename)
    const targetDir = path.join(UPLOAD_ROOT, subfolder)

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    const finalPath = path.join(targetDir, uniqueName)
    await fs.promises.writeFile(finalPath, buffer)
    return `/uploads/${subfolder}/${uniqueName}`
  }

  if (paymentFile) paymentUrl = await saveLocalFile(paymentFile, 'payment')
  if (studentFile) studentUrl = await saveLocalFile(studentFile, 'student')

  await repo.updateAttachments(enrollment_id, { paymentUrl, studentUrl })

  return { ok: true, paymentUrl, studentUrl }
}

export async function searchPhoneGet (phone) {
  return repo.searchPhoneGet(phone)
}

export async function searchContact ({ phone }) {
  return repo.searchContact(phone)
}

export async function userRestrictionsList (payload = {}) {
  return repo.userRestrictionsList(payload)
}

export async function userRestrictionsUpdate (payloadArray = []) {
  await repo.userRestrictionsUpdate(payloadArray)
  return { message: 'Restricciones actualizadas correctamente' }
}

export async function programVersionList (payload = {}) {
  const {
    program_id = null,
    program_version_id = null,
    active = null,
    q = null,
    cat_type_program = null,
    cat_category = null,
    cat_model_modality = null,
    page = 1,
    size = 25
  } = payload

  const rows = await repo.programVersionList({
    program_id,
    activeParam: normalizeActiveProgramVersion(active),
    q,
    cat_type_program,
    cat_category,
    cat_model_modality,
    program_version_id,
    page,
    size
  })

  return toPaginatedDto({ rows, page, size })
}

export async function editionList (payload = {}) {
  const { page = 1, size = 25 } = payload
  const filters = buildEditionFilterPayload(payload)
  const rows = await repo.editionList(filters)
  return toPaginatedDto({ rows, page, size })
}
