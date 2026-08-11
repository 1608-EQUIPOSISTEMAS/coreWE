import crypto from 'node:crypto'
import { DomainError, NotFoundError } from '../../../shared/errors.js'
import { slack } from '../../../shared/adapters/slack/slack.adapter.js'
import { tokenRepository } from './token.repository.js'
import { buildValidationRows } from '../validation/validation.entity.js'
import {
  CAT_INSTALLMENT_DRAFT,
  CAT_PAYMENT_PLAN_INSTALLMENTS,
  inscriptionFullName,
  resolveCreateState,
  isInstallmentInscription,
  assertGroupable
} from './token.entity.js'
import { toTokenDto, toTokenListDto, toStatsDto } from './token.dto.js'

// Orquestacion de los casos de uso de tokens. No contiene SQL (delega en el
// repository) ni reglas invariantes (delega en la entity). Las notificaciones
// Slack entran por el port inyectable y son best-effort: un fallo de Slack no
// rompe la operacion principal.

const repo = tokenRepository
const notifier = slack

export async function listTokens (filters) {
  return toTokenListDto(await repo.list(filters))
}

export async function getToken (tokenId) {
  const row = await repo.findById(tokenId)
  if (!row) throw new NotFoundError('Token no encontrado')
  return toTokenDto(row)
}

export async function getStats () {
  return toStatsDto(await repo.stats())
}

export async function createToken (input) {
  const { status, requestedBy, createdBy } = resolveCreateState(input)

  const created = await repo.insert({ ...input, status, requestedBy, createdBy })

  try {
    const info = await repo.findLeadInfoForCreateNotice(input.leadId, input.userId)
    if (info) {
      const editionDate = info.edition_start_date
        ? new Date(info.edition_start_date).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' })
        : ''
      await notifier.notifyTokenCreated({
        studentName: inscriptionFullName(input.inscriptionData) || info.student_name,
        programName: info.program_name,
        editionCode: info.edition_code ? `${info.edition_code} (${editionDate})` : '',
        paymentType: input.paymentType,
        amount: input.amount,
        currency: input.currency,
        isInstallment: input.inscriptionData?.inscription?.cat_type_payment === 'we_payment_way_installments',
        notes: input.advisorObservation || input.notes,
        requestedByName: info.advisor_alias
      })
    }
  } catch (slackErr) {
    console.error('[createToken] Slack:', slackErr.message)
  }

  return created
}

export async function updateToken ({ tokenId, paymentUrl, providerReference, notes, expirationDate, catProvider, amount, userId }) {
  const token = await repo.findRawById(tokenId)
  if (!token) throw new NotFoundError('Token no encontrado')

  const sets = []
  const params = []
  let idx = 1

  if (paymentUrl !== undefined) {
    sets.push(`payment_url = $${idx++}`)
    params.push(paymentUrl)
    if (!token.payment_url && paymentUrl) {
      sets.push(`status = $${idx++}`)
      params.push('link_sent')
      sets.push(`created_by = $${idx++}`)
      params.push(userId)
    }
  }
  if (providerReference !== undefined) { sets.push(`provider_reference = $${idx++}`); params.push(providerReference) }
  if (notes !== undefined) { sets.push(`notes = $${idx++}`); params.push(notes) }
  if (expirationDate !== undefined) { sets.push(`expiration_date = $${idx++}`); params.push(expirationDate) }
  if (catProvider !== undefined) { sets.push(`cat_provider = $${idx++}`); params.push(catProvider) }
  if (amount !== undefined) { sets.push(`amount = $${idx++}`); params.push(amount) }

  if (!sets.length) throw new DomainError('No hay campos para actualizar')

  sets.push('updated_at = NOW()')
  params.push(tokenId)

  const isAddingLink = !token.payment_url && paymentUrl
  const isLinkChanging = paymentUrl !== undefined && paymentUrl !== token.payment_url

  const updated = await repo.updateDynamic(tokenId, sets, params)

  if (isLinkChanging && updated?.group_id) {
    await repo.propagateLinkToGroup({
      paymentUrl, userId, catProvider, expirationDate,
      groupId: updated.group_id, excludeTokenId: tokenId
    })
  }

  if (isLinkChanging) {
    const action = isAddingLink ? 'token_link_added' : 'token_link_edited'
    const affectedIds = updated?.group_id
      ? await repo.findGroupTokenIds(updated.group_id)
      : [tokenId]
    await repo.logEvent({
      tokenIds: affectedIds,
      action,
      userId,
      details: `${isAddingLink ? 'Link colocado' : 'Link editado'}: ${paymentUrl}`
    })
  }

  if (isAddingLink && updated) {
    try {
      const info = await repo.findLinkNotice({ groupId: updated.group_id, tokenId, userId })
      if (info.length) {
        const students = info.map(r => ({
          name: r.student_name || '---',
          programName: r.program_name || '---',
          amount: Number(r.amount),
          currency: r.currency,
          isInstallment: r.cat_type_payment === 'we_payment_way_installments'
        }))
        await notifier.notifyTokenLinkAdded({
          students,
          groupTotal: students.reduce((s, x) => s + x.amount, 0),
          currency: students[0].currency,
          advisorName: info[0].advisor_alias,
          createdByName: info[0].fico_alias,
          paymentUrl
        })
      }
    } catch (slackErr) {
      console.error('[updateToken] Slack error:', slackErr.message)
    }
  }

  return updated
}

export async function confirmToken ({ tokenId, userId }) {
  const token = await repo.findRawById(tokenId)
  if (!token) throw new NotFoundError('Token no encontrado')
  if (token.status === 'confirmed') throw new DomainError('Token ya confirmado')

  let enrollmentId = token.enrollment_id

  if (!enrollmentId && token.lead_id) {
    enrollmentId = await repo.findEnrollmentIdByLead(token.lead_id)

    if (!enrollmentId) {
      const statusCatId = await repo.findCatalogIdByAlias('we_lead_status_bought')

      const inscPayload = token.inscription_data || {}
      if (inscPayload.inscription && token.cat_provider) {
        inscPayload.inscription.cat_token_provider = token.cat_provider
      }
      const userPayDate = inscPayload?.inscription?.payment_date || null

      await repo.prepareLeadForEnrollment({ leadId: token.lead_id, userId, statusCatId, payDate: userPayDate })

      const enrollResp = await repo.registerEnrollment({ leadId: token.lead_id, userId, payload: inscPayload })
      if (enrollResp?.result !== 1 || !enrollResp?.enrollment_id) {
        throw new DomainError(enrollResp?.message || 'Error al crear inscripcion desde token')
      }
      enrollmentId = enrollResp.enrollment_id

      const insc = inscPayload.inscription || {}
      if (isInstallmentInscription(insc)) {
        await repo.replaceInstallments({
          enrollmentId,
          adelanto: Number(insc.saved_money) || 0,
          plan: insc.installment_plan,
          catDraft: CAT_INSTALLMENT_DRAFT
        })
        await repo.setPaymentPlan(enrollmentId, CAT_PAYMENT_PLAN_INSTALLMENTS)
      }

      const vals = inscPayload.validations
      if (vals?.enabled) {
        try {
          const rows = buildValidationRows({
            validatedChildren: vals.validated_children || [],
            customEditions: vals.custom_editions || {}
          })
          if (rows.length > 0) await repo.insertValidations({ enrollmentId, rows, notes: vals.notes, userId })
        } catch (e) {
          console.error('[confirmToken] Error guardando convalidaciones:', e.message)
        }
      }
    }
  }

  await repo.linkTokenToEnrollment(tokenId, enrollmentId)

  if (enrollmentId) {
    const provName = await repo.findProviderDescription(token.cat_provider)
    const reqName = await repo.findUserName(token.requested_by || token.created_by)
    try {
      await repo.reassignAuditLogToEnrollment(token.token_id, enrollmentId)
      await repo.insertCreatedFromTokenAudit({
        enrollmentId,
        tokenId: token.token_id,
        userId,
        details: `Inscripcion creada desde token de pago | Proveedor: ${provName} | Monto: ${token.currency || 'PEN'} ${token.amount} | Link: ${token.payment_url || '---'} | Solicitado por: ${reqName}`
      })
    } catch (e) {
      console.error('[confirmToken] Audit error:', e.message)
    }
  }

  return { result: 1, message: 'Inscripcion creada', enrollment_id: enrollmentId }
}

export async function markTokenPaid ({ tokenId, providerReference }) {
  const row = await repo.markPaid({ tokenId, providerReference })
  if (!row) throw new NotFoundError('Token no encontrado')
  return row
}

export async function deleteToken ({ tokenId }) {
  const current = await repo.findStatusById(tokenId)
  if (!current) throw new NotFoundError('Token no encontrado')
  if (current.status !== 'pending') throw new DomainError('Solo se pueden eliminar tokens en estado pending')

  await repo.delete(tokenId)
  return { deleted: true }
}

export async function groupTokens ({ tokenIds, userId }) {
  const rows = await repo.findGroupCandidates(tokenIds)
  if (rows.length !== tokenIds.length) throw new DomainError('Uno o mas tokens no existen')

  const { total, currency, count } = assertGroupable(rows, userId)

  const groupId = crypto.randomUUID()
  await repo.assignGroup({ groupId, tokenIds })

  await repo.logEvent({
    tokenIds,
    action: 'token_grouped',
    userId,
    details: `Agrupado en grupo ${groupId.slice(0, 4).toUpperCase()} con ${count} tokens, total ${currency} ${total.toFixed(2)}`
  })

  return { group_id: groupId, token_count: count }
}

export async function editTokenInscription ({ tokenId, inscription, amount, currency, paymentType, catPaymentChannel, advisorObservation, userId }) {
  const t = await repo.findRawById(tokenId)
  if (!t) throw new NotFoundError('Token no encontrado')
  if (Number(t.requested_by) !== Number(userId)) {
    throw new DomainError('Solo el asesor que solicito el token puede editar la inscripcion')
  }
  if (t.status === 'confirmed') {
    throw new DomainError('No se puede editar: la inscripcion ya fue creada. Usar el flujo de edicion en el detalle del enrollment.')
  }
  if (t.status === 'paid') {
    throw new DomainError('No se puede editar: el cliente ya pago. El ajuste debe hacerlo FICO desde la inscripcion.')
  }

  const currentInsc = t.inscription_data?.inscription || {}
  const changes = {}

  for (const f of Object.keys(inscription || {})) {
    const oldVal = currentInsc[f]
    const newVal = inscription[f]
    if (String(oldVal ?? '') !== String(newVal ?? '')) {
      changes[f] = { old: oldVal ?? null, new: newVal ?? null }
    }
  }

  const topLevelDiff = (colName, newVal) => {
    if (newVal === undefined) return
    if (String(t[colName] ?? '') !== String(newVal ?? '')) {
      changes[colName] = { old: t[colName] ?? null, new: newVal ?? null }
    }
  }
  topLevelDiff('amount', amount)
  topLevelDiff('currency', currency)
  topLevelDiff('payment_type', paymentType)
  topLevelDiff('cat_payment_channel', catPaymentChannel)
  topLevelDiff('advisor_observation', advisorObservation)

  if (!Object.keys(changes).length) return { ok: true, updated_fields: [], message: 'Sin cambios' }

  const merged = { ...currentInsc, ...inscription }
  const newData = { ...(t.inscription_data || {}), inscription: merged }

  const sets = ['inscription_data = $1::jsonb']
  const params = [JSON.stringify(newData)]
  let idx = 2
  const addSet = (col, val) => {
    if (val === undefined) return
    sets.push(`${col} = $${idx++}`)
    params.push(val)
  }
  addSet('amount', amount)
  addSet('currency', currency)
  addSet('payment_type', paymentType)
  addSet('cat_payment_channel', catPaymentChannel)
  addSet('advisor_observation', advisorObservation)
  sets.push('updated_at = NOW()')
  params.push(tokenId)

  await repo.updateInscription({ tokenId, sets, params })

  await repo.logEvent({
    tokenId,
    action: 'token_inscription_edited',
    userId,
    details: `Asesor edito campos: ${Object.keys(changes).join(', ')}`,
    changes
  })

  return { ok: true, updated_fields: Object.keys(changes) }
}

export async function ungroupTokens ({ groupId, userId }) {
  const rows = await repo.findGroupForUngroup(groupId)
  if (!rows.length) throw new NotFoundError('Grupo no encontrado')
  if (rows.some(t => t.requested_by !== userId)) {
    throw new DomainError('Solo el asesor dueno del grupo puede desagruparlo')
  }

  const locked = rows.find(t => t.status === 'paid' || t.status === 'confirmed')
  if (locked) {
    throw new DomainError(`No se puede desagrupar: hay tokens en estado "${locked.status}". Los pagos o inscripciones ya registrados no pueden revertirse.`)
  }

  const tokenIds = rows.map(r => r.token_id)
  await repo.logEvent({
    tokenIds,
    action: 'token_ungrouped',
    userId,
    details: `Desagrupado del grupo ${groupId.slice(0, 4).toUpperCase()}. Link compartido borrado y token vuelve a pendiente.`
  })

  await repo.clearGroup(groupId)

  return { ungrouped: rows.length }
}
