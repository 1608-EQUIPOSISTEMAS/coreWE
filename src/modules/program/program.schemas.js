export const programRegisterSchema = {
  body: {
    type: 'object',
    required: ['program'],
    additionalProperties: false,
    properties: {
      user_id: {
        type: 'integer',
        additionalProperties: true
      },
      program: {
        type: 'object',
        additionalProperties: false,
        properties: {
          program_name: { type: ['string', 'null'] },
          cat_type_program: { type: ['integer', 'null'] },
          link: { type: ['string', 'null'] },
          cat_category: { type: ['integer', 'null'] },
          cat_business_line_id: { type: ['integer', 'null'] },
          cat_model_modality: { type: ['integer', 'null'] },
          active: { type: ['string', 'null'] },
          skem_clasification: { type: ['string', 'null'] },
          program_versions: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                program_version_id: { type: ['integer', 'null'] },
                cat_course_category: { type: ['integer', 'null'] },
                version_code: { type: ['string', 'null'] },
                brand_name: { type: ['string', 'null'] },
                expedient_link: { type: ['string', 'null'] },
                sessions: { type: ['integer', 'null'] },
                active: { type: ['string', 'null'] },
                observations: { type: ['string', 'null'] },
                description: { type: ['string', 'null'] },
                abbreviation: { type: ['string', 'null'] },
                children_ids: {
                  type: ['array', 'null'],
                  items: { type: 'integer' }
                }
              }
            }
          }
        }
      }
    }
  }
}

export const programListSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      active: { type: ['boolean', 'string', 'null'] },
      cat_type_program: { type: ['integer', 'null'] },
      cat_category: { type: ['integer', 'null'] },
      cat_model_modality: { type: ['integer', 'null'] },
      q: { type: ['string', 'null'] },
      page: { type: ['integer', 'null'], default: 1 },
      size: { type: ['integer', 'null'], default: 25 }
    }
  }
}

export const programGetSchema = {
  body: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
      id: { type: 'integer' }
    }
  }
}

export const programUpdateSchema = {
  body: {
    type: 'object',
    required: ['id', 'program'],
    additionalProperties: false,
    properties: {
      id: { type: 'integer' },
      user_id: { type: ['integer', 'null'] },
      program: {
        type: 'object',
        additionalProperties: false,
        properties: {
          program_name: { type: ['string', 'null'] },
          cat_type_program: { type: ['integer', 'null'] },
          link: { type: ['string', 'null'] },
          cat_category: { type: ['integer', 'null'] },
          cat_business_line_id: { type: ['integer', 'null'] },
          cat_model_modality: { type: ['integer', 'null'] },
          active: { type: ['string', 'null'] },
          skem_clasification: { type: ['string', 'null'] },
          program_versions: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['program_version_id'],
              properties: {
                program_version_id: { type: ['integer', 'null'] },
                cat_course_category: { type: ['integer', 'null'] },
                expedient_link: { type: ['string', 'null'] },
                version_code: { type: ['string', 'null'] },
                brand_name: { type: ['string', 'null'] },
                sessions: { type: ['integer', 'null'] },
                observations: { type: ['string', 'null'] },
                description: { type: ['string', 'null'] },
                active: { type: ['string', 'null'] },
                abbreviation: { type: ['string', 'null'] },
                children_ids: {
                  type: ['array', 'null'],
                  items: { type: 'integer' }
                }
              }
            }
          }
        }
      }
    }
  }
}

export const programVersionCallerSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      cat_model_modality: { type: ['integer', 'null'] },
      not_modality: { type: ['integer', 'null'] },
      cat_type_program: { type: ['integer', 'null'] },
      active: { type: ['string', 'null'] },
      q: { type: ['string', 'null'] }
    }
  }
}

export const priceListSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      character: { type: ['string', 'null'] }
    }
  }
}

export const programVersionListSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      program_version_id: { type: ['integer', 'null'] },
      program_id: { type: ['integer', 'null'] },
      active: { type: ['boolean', 'string', 'null'] },
      q: { type: ['string', 'null'] },
      cat_type_program: { type: ['integer', 'null'] },
      cat_category: { type: ['integer', 'null'] },
      cat_model_modality: { type: ['integer', 'null'] },
      page: { type: ['integer', 'null'], default: 1 },
      size: { type: ['integer', 'null'], default: 25 }
    }
  }
}

export const programVersionUpdateSchema = {
  body: {
    type: 'object',
    required: ['program_version_id'],
    additionalProperties: false,
    properties: {
      program_version_id: { type: 'integer' },
      price_student_soles: { type: ['number', 'null'] },
      price_student_dollars: { type: ['number', 'null'] },
      price_professional_soles: { type: ['number', 'null'] },
      price_professional_dollars: { type: ['number', 'null'] },
      active: { type: 'boolean' },
      price_list_id: { type: ['integer', 'null'], default: 1 },
      user_id: { type: ['integer', 'null'], default: 1 }
    }
  }
}

export const programCallerSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: ['string', 'null'] },
      cat_type_program: { type: ['integer', 'null'] },
      active: { type: ['string', 'boolean', 'null'] }
    }
  }
}

export const programVersionDetailGetSchema = {
  body: {
    type: 'object',
    required: ['program_version_id'],
    additionalProperties: false,
    properties: {
      program_version_id: { type: 'integer' }
    }
  }
}
