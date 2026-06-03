import * as usecases from './comercial.usecases.js'

export async function leadRegisterHandler (req, reply) {
  req.log.info({ docNumber: req.body?.document_number, userId: req.user?.id }, 'leadRegister')
  const response = await usecases.leadRegister(req.body)
  return reply.code(200).send(response)
}

export async function leadUpdateHandler (req, reply) {
  const response = await usecases.leadUpdate(req.body)
  return reply.code(200).send(response)
}

// Preserva el code 201 historico en exito (inconsistencia conocida vs el resto
// de endpoints que responden 200). Ver ticket de correccion por separado.
export async function leadGetHandler (req, reply) {
  const { data } = await usecases.leadGet(req.body)
  return reply.code(201).send({ ok: true, data })
}

export async function leadListHandler (req, reply) {
  const data = await usecases.leadList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function sellerPhonesHandler (req, reply) {
  const data = await usecases.leadSellerPhones()
  return reply.code(200).send({ ok: true, data })
}

export async function leadStatsHandler (req, reply) {
  const data = await usecases.leadStats(req.body)
  return reply.code(200).send(data)
}

export async function enrollmentGetHandler (req, reply) {
  const { enrollment_id } = req.body
  const data = await usecases.enrollmentGet(enrollment_id)
  return reply.code(200).send({ ok: true, data })
}

export async function enrollmentRegisterHandler (req, reply) {
  const response = await usecases.enrollmentRegister(req.body)
  return reply.code(200).send(response)
}

export async function enrollmentUploadHandler (req, reply) {
  const parts = req.parts()
  let enrollment_id = null
  let paymentFileObj = null
  let studentFileObj = null

  for await (const part of parts) {
    if (part.type === 'field') {
      if (part.fieldname === 'enrollment_id') enrollment_id = part.value
    } else if (part.type === 'file') {
      const buffer = await part.toBuffer()
      const fileData = { filename: part.filename, mimetype: part.mimetype, buffer }
      if (part.fieldname === 'payment_file') paymentFileObj = fileData
      else if (part.fieldname === 'student_file') studentFileObj = fileData
    }
  }

  if (!enrollment_id) return reply.code(400).send({ error: 'enrollment_id is required' })

  const result = await usecases.uploadEnrollmentFiles({
    enrollment_id,
    paymentFile: paymentFileObj,
    studentFile: studentFileObj
  })
  return reply.send(result)
}

export async function restrictionsListHandler (req, reply) {
  const data = await usecases.userRestrictionsList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function restrictionsUpdateHandler (req, reply) {
  const data = await usecases.userRestrictionsUpdate(req.body.restrictions)
  return reply.code(200).send({ ok: true, data })
}

export async function searchPhoneGetHandler (req, reply) {
  const { phone } = req.body
  const data = await usecases.searchPhoneGet(phone)
  return reply.code(200).send({ ok: true, ...data })
}

export async function enrollmentSlackWebHandler (request, reply) {
  const { enrollment_id } = request.body
  if (!enrollment_id) return reply.status(400).send({ ok: false, message: 'enrollment_id requerido' })

  const result = await usecases.enrollmentSlackWeb({ enrollment_id })
  return result
}

export async function searchContactHandler (req, reply) {
  const { phone } = req.body
  const data = await usecases.searchContact({ phone })
  return reply.code(200).send({ ok: true, data })
}

export async function programVersionListHandler (req, reply) {
  const data = await usecases.programVersionList(req.body)
  return reply.code(200).send({ ok: true, data })
}

export async function editionListHandler (req, reply) {
  const data = await usecases.editionList(req.body)
  return reply.code(200).send({ ok: true, data })
}
