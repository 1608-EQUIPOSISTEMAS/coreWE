import { DomainError, NotFoundError } from '../../shared/errors.js'
import { email } from '../../shared/adapters/email/email.adapter.js'
import {
  assertCourseChoice, summarizeScholarships, normalizeScholarship, duplicateMessage, scholarshipAlerts
} from './fundacion-becas.entity.js'
import * as repo from './fundacion-becas.repository.js'
import { ALERTS_SUBJECT, renderAlertsDigest } from './fundacion-becas.render.js'

// Base del ERP (mismo env que los links de tickets); sin ella el correo va sin boton.
const ERP_URL = process.env.FRONTEND_PUBLIC_URL

// El panel y el correo diario usan la misma regla de avisos.
export async function listScholarships () {
  const [today, rows] = await Promise.all([repo.today(), repo.listScholarships()])
  const summary = summarizeScholarships({ today, rows })
  return { ...summary, alerts: scholarshipAlerts(summary.items, today) }
}

// Un solo correo al dia a Fundacion, y solo si hay algo que hacer. Sin estado
// de "ya avisado": mientras la beca siga pendiente o por vencer, vuelve a salir
// (es una bandeja, no una notificacion).
export async function sendAlertsDigest () {
  const { today, alerts } = await listScholarships()
  const total = alerts.stalePending.length + alerts.expiringSoon.length
  if (!total) return { sent: false, reason: 'sin avisos' }
  const to = await repo.fundacionEmails()
  if (!to.length) return { sent: false, reason: 'Fundacion no tiene usuarios con correo' }
  const r = await email.sendEmail({
    to,
    subject: ALERTS_SUBJECT(total),
    htmlBody: renderAlertsDigest({ today, ...alerts, url: ERP_URL && `${ERP_URL}/fundacion/becas` })
  })
  return { sent: r.success, reason: r.error, total }
}

export const listCourses = () => repo.listCourses()

// Mismas reglas al registrar y al editar; exceptId es la beca que se edita.
async function validScholarship (data, exceptId = null) {
  const s = normalizeScholarship(data)
  assertCourseChoice(await repo.findCourse(s.program_id, s.program_edition_id), s.program_edition_id)
  const existing = await repo.findDuplicate(s, exceptId)
  if (existing) throw new DomainError(duplicateMessage(existing), { statusCode: 409 })
  return s
}

export async function registerScholarship (data, userId) {
  return repo.insertScholarship(await validScholarship(data), userId)
}

export async function updateScholarship (scholarshipId, data) {
  const s = await validScholarship(data, scholarshipId)
  if (!(await repo.updateScholarship(scholarshipId, s))) throw new NotFoundError('La beca no existe')
}

export async function deleteScholarship (scholarshipId) {
  if (!(await repo.deleteScholarship(scholarshipId))) throw new NotFoundError('La beca no existe')
}

export async function activateScholarship (scholarshipId) {
  if (!(await repo.activateScholarship(scholarshipId))) {
    throw new DomainError('La beca no existe o ya estaba activada', { statusCode: 409 })
  }
}
