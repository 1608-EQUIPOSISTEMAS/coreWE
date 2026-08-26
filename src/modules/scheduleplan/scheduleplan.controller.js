import * as usecases from './scheduleplan.usecases.js'

// Unico lugar que sabe de HTTP. Traduce body -> caso de uso y resultado -> reply.

export async function listHandler (req, reply) {
  const data = await usecases.listPlans({ year: req.body?.year })
  return reply.code(200).send({ ok: true, items: data })
}

export async function getHandler (req, reply) {
  const data = await usecases.getPlan({ plan_id: req.body.plan_id })
  return reply.code(200).send({ ok: true, plan: data })
}

export async function createHandler (req, reply) {
  const data = await usecases.createPlan({
    name: req.body.name,
    year: req.body.year,
    user_id: req.user?.id
  })
  return reply.code(200).send({ ok: true, plan: data })
}

export async function saveHandler (req, reply) {
  const data = await usecases.savePlan({
    plan_id: req.body.plan_id,
    name: req.body.name,
    items: req.body.items,
    user_id: req.user?.id
  })
  return reply.code(200).send({ ok: true, plan: data })
}

export async function deleteHandler (req, reply) {
  const data = await usecases.deletePlan({ plan_id: req.body.plan_id, user_id: req.user?.id })
  return reply.code(200).send({ ok: true, ...data })
}

export async function seedHandler (req, reply) {
  const data = await usecases.seedMonthFromYear({
    plan_id: req.body.plan_id,
    month: req.body.month,
    source_year: req.body.source_year,
    mode: req.body.mode,
    user_id: req.user?.id
  })
  return reply.code(200).send({ ok: true, ...data })
}

export async function seedYearHandler (req, reply) {
  const data = await usecases.seedYearFromYear({
    plan_id: req.body.plan_id,
    source_year: req.body.source_year,
    mode: req.body.mode,
    user_id: req.user?.id
  })
  return reply.code(200).send({ ok: true, ...data })
}

export async function previewHandler (req, reply) {
  const data = await usecases.previewMonth({
    plan_id: req.body.plan_id,
    month: req.body.month,
    year: req.body.year
  })
  return reply.code(200).send({ ok: true, ...data })
}

export async function publishHandler (req, reply) {
  const data = await usecases.publishPlan({
    plan_id: req.body.plan_id,
    uids: req.body.uids,
    user_id: req.user?.id
  })
  return reply.code(200).send({ ok: true, ...data })
}
