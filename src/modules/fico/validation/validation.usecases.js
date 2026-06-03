import { validationRepository } from './validation.repository.js'
import {
  buildValidationContext,
  buildEditionMap,
  buildTreeEditionMap,
  annotateChildrenWithTree,
  findUnassignableChildren,
  buildEditionPlan
} from './validation.entity.js'
import { ALIAS } from '../../../utils/catalog-aliases.js'
import { getCatalogIdByAlias } from '../../../utils/catalog-helper.js'
import { safeAsync } from '../../../shared/utils/safe-async.js'

// Orquestacion del subdominio de convalidaciones y estructura padre-hijo. No
// contiene SQL (delega en el repository) ni reglas puras (delega en la entity).
// Los efectos externos del escenario E0 (Odoo + correo) y la auditoria entran
// por puertos inyectables: el flujo comercial / job-worker los provee, igual que
// el service legacy. Por defecto quedan en no-op para que la entity y el resto
// del flujo se puedan ejercitar sin red.

const repo = validationRepository

// Puerto de auditoria. Reemplazado por logAudit del flujo principal via setPorts.
let logAudit = async () => {}
// Puertos de sincronizacion individual de hijos en escenario E0.
let enrollInOdoo = async () => null
let sendConfirmationEmail = async () => null

// Inyecta los efectos externos que viven fuera de este subdominio (auditoria,
// Odoo, correo). El orquestador los cablea con las funciones reales del modulo
// de enrollment para preservar exactamente el comportamiento legacy.
export function setPorts (ports = {}) {
  if (ports.logAudit) logAudit = ports.logAudit
  if (ports.enrollInOdoo) enrollInOdoo = ports.enrollInOdoo
  if (ports.sendConfirmationEmail) sendConfirmationEmail = ports.sendConfirmationEmail
}

// Carga el contexto de hijos del padre: estructura, mapa de ediciones del arbol,
// validaciones registradas y los indices derivados (validatedSet, customEditions).
async function loadChildrenContext (enrollmentId) {
  const parent = await repo.findParent(enrollmentId)
  if (!parent) return null

  const childrenStruct = await repo.findChildrenStructure(parent.program_version_id)
  if (childrenStruct.length === 0) {
    return { parent, childrenStruct: [], editionMap: {}, validations: [], validatedSet: new Set(), customEditions: {} }
  }

  const treeChildren = await repo.getEditionTreeChildren(parent.program_edition_id)
  const editionMap = buildEditionMap(treeChildren)

  const validations = await repo.getValidations(enrollmentId)
  const { validatedSet, customEditions } = buildValidationContext(validations)

  return { parent, childrenStruct, editionMap, validations, validatedSet, customEditions }
}

export async function getValidations ({ enrollmentId }) {
  return repo.getValidations(enrollmentId)
}

export async function saveValidations ({ enrollmentId, validations, userId }) {
  await repo.deleteValidations(enrollmentId)
  for (const v of validations) {
    await repo.insertValidation({
      enrollmentId,
      childVersionId: v.child_version_id,
      validationType: v.validation_type,
      customEditionId: v.custom_edition_id,
      notes: v.notes,
      userId
    })
  }

  await logAudit({
    enrollmentId,
    action: 'validation_requested',
    userId,
    details: `Convalidacion solicitada: ${validations.length} modulo(s) convalidado(s)`
  })

  return { result: 1, message: 'Convalidaciones guardadas' }
}

export async function getProgramChildren ({ programVersionId, parentEditionId = null }) {
  const rows = await repo.getProgramChildren(programVersionId)
  if (!parentEditionId || !rows?.length) return rows

  const treeChildren = await repo.getEditionTreeChildren(parentEditionId)
  const treeMap = buildTreeEditionMap(treeChildren)
  return annotateChildrenWithTree(rows, treeMap)
}

// Valida que cada hijo no convalidado tenga una edicion asignable (en arbol o
// custom). Devuelve { ok, errors } para bloquear la confirmacion si falta alguna.
export async function validateChildEnrollmentSetup ({ enrollmentId }) {
  const ctx = await loadChildrenContext(enrollmentId)
  if (!ctx || ctx.childrenStruct.length === 0) return { ok: true, errors: [] }

  const errors = findUnassignableChildren({
    childrenStruct: ctx.childrenStruct,
    validatedSet: ctx.validatedSet,
    editionMap: ctx.editionMap,
    customEditions: ctx.customEditions
  })
  return { ok: errors.length === 0, errors }
}

// Crea los enrollments hijos SEG del padre segun el plan de ediciones y detecta
// el escenario E0. En E0 desinscribe el padre (program_edition_id=NULL) y
// sincroniza cada hijo individualmente con Odoo y correo; en el flujo normal el
// padre cubre a los hijos en su slide_group y aqui solo se crean los registros.
export async function createChildEnrollments ({ enrollmentId, userId }) {
  const ctx = await loadChildrenContext(enrollmentId)
  if (!ctx || ctx.childrenStruct.length === 0) {
    console.log('[childEnrollments] Sin hijos para procesar, saliendo')
    return { isE0: false, createdChildren: [] }
  }

  const parent = await repo.findParentDataForChildEnroll(enrollmentId)
  if (!parent) return { isE0: false, createdChildren: [] }

  const { editionPlan, skipped, isE0 } = buildEditionPlan({
    childrenStruct: ctx.childrenStruct,
    validatedSet: ctx.validatedSet,
    editionMap: ctx.editionMap,
    customEditions: ctx.customEditions
  })

  for (const s of skipped) {
    await logAudit({
      enrollmentId,
      action: 'children_skipped_no_edition',
      userId,
      details: `Modulo ${s.childName} (pv=${s.childPvId}) saltado: sin edicion en arbol del padre y sin custom edition`
    })
  }

  if (editionPlan.length === 0) {
    console.log('[childEnrollments] No hay hijos a inscribir (todos convalidados o sin edicion)')
    return { isE0: false, createdChildren: [] }
  }

  if (isE0) {
    await repo.clearParentEdition(enrollmentId)
    await logAudit({
      enrollmentId,
      action: 'parent_marked_e0',
      userId,
      details: `Diplomado marcado como E0: ${editionPlan.length} modulo(s) inscritos individualmente, fuera del arbol del padre`
    })
  }

  const certCatId    = await getCatalogIdByAlias(ALIAS.CERTIFICATE_STATUS_PAID)
  const contadoCatId = await getCatalogIdByAlias(ALIAS.PAYMENT_WAY_SINGLE)
  const segCatId     = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_TRACKING)
  const checkedCatId = await getCatalogIdByAlias(ALIAS.ENROLLMENT_STATUS_CHECKED)

  await repo.findParentAttachments(enrollmentId)

  const createdChildren = []
  const totalChildren = editionPlan.length

  for (const item of editionPlan) {
    const childPvId = item.childPvId
    const editionId = item.editionId

    try {
      const childEid = await repo.insertChildEnrollment({
        customerId: parent.customer_id,
        childPvId,
        editionId,
        parentEnrollmentId: enrollmentId,
        catCurrency: parent.cat_currency,
        catInscriptionModality: parent.cat_inscription_modality,
        catPaymentChannel: parent.cat_payment_channel,
        catPaymentPlan: contadoCatId || parent.cat_payment_plan,
        checkedCatId,
        segCatId,
        certCatId,
        catProfileId: parent.cat_profile_id,
        userId,
        notes: `Seguimiento (${item.sortOrder}/${totalChildren}) de ${parent.parent_program_name || ''} ${parent.parent_edition_code || ''}`.trim()
      })

      if (childEid) {
        await logAudit({
          enrollmentId: childEid,
          action: 'created',
          userId,
          details: `Seguimiento ${item.globalCode} (${item.sortOrder}/${totalChildren}) - Modulo de ${parent.parent_program_name || ''}${item.isOutsideTree ? ' (E0: edicion individual)' : ''}`
        })
        createdChildren.push({ id: childEid, code: item.globalCode, order: item.sortOrder, isOutsideTree: item.isOutsideTree })

        if (isE0) {
          const odooRes = await safeAsync(`[childEnrollments][Odoo] enroll child #${childEid}`, () => enrollInOdoo({ enrollmentId: childEid }))
          if (odooRes?.success) {
            await logAudit({ enrollmentId: childEid, action: 'odoo_enrolled', userId, details: `Inscripcion individual E0 en Odoo: user ${odooRes.odoo_user_id}` })
          }
          const emailRes = await safeAsync(`[childEnrollments][Email] send child #${childEid}`, () => sendConfirmationEmail({ enrollmentId: childEid }))
          if (emailRes?.success) {
            await logAudit({ enrollmentId: childEid, action: 'email_sent', userId, details: 'Correo confirmacion enviado (E0)' })
          }
        }
      }
    } catch (childErr) {
      console.error(`[createChildEnrollments] ERROR pvId=${childPvId}:`, childErr.message)
    }
  }

  if (createdChildren.length > 0) {
    const childList = createdChildren
      .sort((a, b) => a.order - b.order)
      .map(c => `${c.code} (${c.order}/${totalChildren})`)
      .join(', ')
    await logAudit({
      enrollmentId,
      action: 'children_created',
      userId,
      details: `Seguimiento${isE0 ? ' E0' : ''}: ${childList}`
    })
  }

  if (ctx.validatedSet.size > 0) {
    await logAudit({
      enrollmentId,
      action: 'validation_applied',
      userId,
      details: `Convalidacion aplicada: ${ctx.validatedSet.size} modulo(s) convalidados, ${createdChildren.length} modulo(s) inscritos`
    })
  }

  return { isE0, createdChildren }
}
