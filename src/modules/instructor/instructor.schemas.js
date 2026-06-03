// JSON schemas de validacion (Fastify/AJV) del dominio instructor.
// Movidos verbatim desde models/instructor.schema.js durante la migracion.

export const instructorRegisterSchema = {
  tags: ['Instructors'],
  description: 'Crea un nuevo instructor en el sistema (y opcionalmente la persona)',
  body: {
    type: 'object',
    required: ['instructor'],
    additionalProperties: false,
    properties: {
      instructor: {
        type: 'object',
        additionalProperties: false,
        properties: {
          person_id:            { type: ['integer', 'null'] },
          first_name:           { type: ['string',  'null'] },
          last_name:            { type: ['string',  'null'] },
          mother_last_name:     { type: ['string',  'null'] },
          document_number:      { type: ['string',  'null'] },
          cat_type_document:    { type: ['integer', 'null'] },
          cat_occupation:       { type: ['integer', 'null'] },
          cat_person_status:    { type: ['integer', 'null'] },
          cat_country:          { type: ['integer', 'null'] },
          birthday:             { type: ['string',  'null'] },
          email:                { type: ['string',  'null'] },
          phone:                { type: ['string',  'null'] },
          person_active:        { type: ['string',  'null'] },
          instructor_active:    { type: ['string',  'null'] },
          linkedin:             { type: ['string',  'null'] },
          relevant_company:     { type: ['string',  'null'] },
          relevant_work:        { type: ['string',  'null'] },
          profile_resume:       { type: ['string',  'null'] },
          cv_url:               { type: ['string',  'null'] },
          cv_documents_url:     { type: ['string',  'null'] },
          odoo_parent_id:       { type: ['integer', 'null'] },
          user_registration_id: { type: ['integer', 'null'] }
        }
      }
    }
  }
}

export const instructorListSchema = {
  tags: ['Instructors'],
  summary: 'Lista todos los instructores con filtros',
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      active: { type: ['boolean', 'string', 'null'] },
      cat_occupation: { type: ['integer', 'null'] },
      cat_person_status: { type: ['integer', 'null'] },
      q: { type: ['string', 'null'] },
      page: { type: ['integer', 'null'], default: 1 },
      size: { type: ['integer', 'null'], default: 25 }
    }
  }
}

export const instructorGetSchema = {
  tags: ['Instructors'],
  body: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
      id: { type: 'integer' }
    }
  }
}

export const instructorUpdateSchema = {
  tags: ['Instructors'],
  body: {
    type: 'object',
    required: ['instructor'],
    additionalProperties: false,
    properties: {
      id: { type: 'integer' },
      instructor: {
        type: 'object',
        additionalProperties: false,
        properties: {
          first_name: { type: ['string', 'null'] },
          last_name: { type: ['string', 'null'] },
          mother_last_name: { type: ['string', 'null'] },
          document_number: { type: ['string', 'null'] },
          cat_type_document: { type: ['integer', 'null'] },
          cat_occupation: { type: ['integer', 'null'] },
          cat_person_status: { type: ['integer', 'null'] },
          cat_country: { type: ['integer', 'null'] },
          profile_resume: { type: ['string', 'null'] },
          birthday: { type: ['string', 'null'] },
          phone: { type: ['string', 'null'] },
          email: { type: ['string', 'null'] },
          linkedin: { type: ['string', 'null'] },
          relevant_company: { type: ['string', 'null'] },
          relevant_work: { type: ['string', 'null'] },
          cv_url: { type: ['string', 'null'] },
          cv_documents_url: { type: ['string', 'null'] },
          programs: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              required: ['program_id'],
              additionalProperties: false,
              properties: {
                instructor_program_id: { type: ['integer', 'null'] },
                program_id: { type: 'integer' },
                profile_summary: { type: ['string', 'null'] },
                active: { type: ['string', 'null'] }
              }
            }
          },
          financials: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                instructor_financial_id: { type: ['integer', 'null'] },
                bank_name: { type: ['string', 'null'] },
                cat_payment_type: { type: ['integer', 'null'] },
                cat_currency: { type: ['integer', 'null'] },
                cat_rate_pay_id: { type: ['integer', 'null'] },
                observations: { type: ['string', 'null'] },
                attachments: {
                  type: ['array', 'null'],
                  items: { type: 'string' }
                }
              }
            }
          },
          person_active: { type: ['string', 'null'] },
          instructor_active: { type: ['string', 'null'] },
          user_modification_id: { type: ['integer', 'null'] }
        }
      }
    }
  }
}

export const instructorCallerSchema = {
  tags: ['Instructors'],
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      active: { type: ['boolean', 'string', 'null'] },
      cat_occupation: { type: ['integer', 'null'] },
      cat_person_status: { type: ['integer', 'null'] },
      q: { type: ['string', 'null'] }
    }
  }
}
