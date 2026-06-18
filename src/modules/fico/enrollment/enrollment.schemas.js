// JSON schemas de validacion (Fastify/AJV) para las rutas del agregado
// enrollment. Identicos a los que vivian inline en routes/fico.js para preservar
// el contrato de entrada exacto.

export const enrollmentRegisterSchema = {
  body: {
    type: 'object',
    required: ['inscription'],
    additionalProperties: true,
    properties: {
      inscription: { type: 'object', additionalProperties: true }
    }
  }
}

export const enrollmentListSchema = {
  body: {
    type: 'object',
    additionalProperties: true,
    properties: {
      q: { type: ['string', 'null'] },
      date_from: { type: ['string', 'null'] },
      date_to: { type: ['string', 'null'] },
      edition_start_from: { type: ['string', 'null'] },
      edition_start_to: { type: ['string', 'null'] },
      payment_from: { type: ['string', 'null'] },
      payment_to: { type: ['string', 'null'] },
      page: { type: ['integer', 'null'], default: 1 },
      size: { type: ['integer', 'null'], default: 25 },
      order_by: { type: ['number', 'null'] },
      student_statuses: { type: ['array', 'null'], items: { type: 'string' } },
      confirmations: { type: ['array', 'null'], items: { type: 'string' } },
      advisors: { type: ['array', 'null'], items: { type: 'string' } },
      program_types: { type: ['array', 'null'], items: { type: 'string' } },
      modalities: { type: ['array', 'null'], items: { type: 'string' } },
      program_version_ids: { type: ['array', 'null'], items: { type: 'integer' } },
      edition_num_ids: { type: ['array', 'null'], items: { type: 'integer' } },
      payment_channels: { type: ['array', 'null'], items: { type: 'string' } }
    }
  }
}

export const jobStatusSchema = {
  params: {
    type: 'object',
    required: ['enrollmentId'],
    properties: { enrollmentId: { type: 'string', pattern: '^\\d+$' } }
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { jobType: { type: 'string' } }
  }
}

export const kpisDailySchema = {
  querystring: {
    type: 'object',
    required: ['today', 'yesterday'],
    properties: {
      today: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      yesterday: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
    }
  }
}

export const paymentDetailGetSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    additionalProperties: false,
    properties: { enrollment_id: { type: 'integer' } }
  }
}

export const enrollmentUpdateSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id', 'justificacion'],
    additionalProperties: true,
    properties: {
      enrollment_id: { type: 'integer' },
      justificacion: { type: 'string', minLength: 1 },
      fields: { type: 'object', additionalProperties: true }
    }
  }
}

export const availableEditionsSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    additionalProperties: false,
    properties: { enrollment_id: { type: 'integer' } }
  }
}

export const programPriceSchema = {
  body: {
    type: 'object',
    required: ['program_version_id'],
    properties: { program_version_id: { type: 'integer' } }
  }
}

export const retireEnrollmentSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id', 'reason'],
    additionalProperties: true,
    properties: {
      enrollment_id: { type: 'integer' },
      reason: { type: 'string', minLength: 1 },
      has_refund: { type: 'boolean' },
      refund_amount: { type: 'number' },
      justificacion: { type: 'string' }
    }
  }
}

export const deleteEnrollmentSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    additionalProperties: false,
    properties: { enrollment_id: { type: 'integer' } }
  }
}

export const enrollmentFlagsSchema = {
  body: { type: 'object', required: ['enrollment_id'], properties: { enrollment_id: { type: 'integer' } } }
}

export const editStudentSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id', 'justificacion'],
    additionalProperties: true,
    properties: {
      enrollment_id: { type: 'integer' },
      first_name: { type: 'string' },
      last_name: { type: 'string' },
      document_number: { type: 'string' },
      origin_email: { type: 'string' },
      origin_phone: { type: 'string' },
      odoo_email: { type: 'string' },
      cat_profile_id: { type: 'integer' },
      justificacion: { type: 'string', minLength: 1 }
    }
  }
}

export const changeModalitySchema = {
  body: {
    type: 'object',
    required: ['enrollment_id', 'new_modality_id', 'justificacion'],
    additionalProperties: true,
    properties: {
      enrollment_id: { type: 'integer' },
      new_modality_id: { type: 'integer' },
      justificacion: { type: 'string', minLength: 1 }
    }
  }
}

export const editSellerAgentSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id', 'justificacion'],
    additionalProperties: true,
    properties: {
      enrollment_id: { type: 'integer' },
      new_seller_agent_id: { type: ['integer', 'null'] },
      new_agent_origin: { type: ['string', 'null'], enum: ['B2B', 'WEB', 'WE', 'SA', null] },
      justificacion: { type: 'string', minLength: 1 }
    }
  }
}

export const courseChangeSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id', 'new_program_version_id', 'total_amount', 'justificacion'],
    additionalProperties: true,
    properties: {
      enrollment_id: { type: 'integer' },
      new_program_version_id: { type: 'integer' },
      // Las membresias (WE PLUS/GOLD/PLAT/BLACK) no tienen edicion: program_edition_id
      // queda null. Para cursos regulares el usecase exige edicion explicitamente.
      new_edition_id: { type: ['integer', 'null'] },
      total_amount: { type: 'number' },
      justificacion: { type: 'string', minLength: 1 }
    }
  }
}

export const reprogramEditionSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id', 'new_edition_id', 'justificacion'],
    additionalProperties: false,
    properties: {
      enrollment_id: { type: 'integer' },
      new_edition_id: { type: 'integer' },
      justificacion: { type: 'string', minLength: 1 }
    }
  }
}

export const approvePendingReviewSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    additionalProperties: false,
    properties: {
      enrollment_id: { type: 'integer' },
      user_id: { type: ['integer', 'null'] },
      activation_date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
    }
  }
}

export const rejectEnrollmentSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id', 'reason'],
    additionalProperties: true,
    properties: {
      enrollment_id: { type: 'integer' },
      reason: { type: 'string', minLength: 1 }
    }
  }
}

export const resubmitEnrollmentSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    additionalProperties: true,
    properties: {
      enrollment_id: { type: 'integer' }
    }
  }
}
