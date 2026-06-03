// Schemas de validacion Fastify para el modulo edition.

export const editionRegisterSchema = {
  body: {
    type: 'object',
    required: ['edition', 'user_id'],
    additionalProperties: false,
    properties: {
      user_id: {
        type: 'integer',
        additionalProperties: true
      },
      edition: {
        type: 'object',
        additionalProperties: false,
        properties: {
          program_version_id: { type: ['integer', 'null'] },
          instructor_id: { type: ['integer', 'null'] },
          start_date: { type: ['string', 'null'] },
          end_date: { type: ['string', 'null'] },
          cat_type_approved: { type: ['integer', 'null'] },
          cat_segment_id: { type: ['integer', 'null'] },
          cat_status_edition: { type: ['integer', 'null'] },
          vacant: { type: ['integer', 'null'] },
          notes: { type: ['string', 'null'] },
          specific_code: { type: ['string', 'null'] },
          global_code: { type: ['string', 'null'] },
          upgrade: { type: ['string', 'null'] },
          expedient: { type: ['string', 'null'] },
          preconfirmation: { type: ['string', 'null'] },
          confirmation: { type: ['string', 'null'] },
          active: { type: ['string', 'null'] },
          cat_day_combination_id: { type: ['integer', 'null'] },
          cat_hour_combination_id: { type: ['integer', 'null'] },
          schedules: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                cat_day_id: { type: ['integer', 'null'] },
                start_time: { type: ['string', 'null'] },
                end_time: { type: ['string', 'null'] }
              }
            }
          }
        }
      }
    }
  }
}

export const editionTreeRegisterSchema = {
  body: {
    type: 'object',
    required: ['edition', 'user_id'],
    additionalProperties: false,
    properties: {
      user_id: {
        type: 'integer',
        additionalProperties: true
      },
      edition: {
        type: 'object',
        additionalProperties: false,
        properties: {
          program_version_id: { type: ['integer', 'null'] },
          instructor_id: { type: ['integer', 'null'] },
          start_date: { type: ['string', 'null'] },
          end_date: { type: ['string', 'null'] },
          cat_type_approved: { type: ['integer', 'null'] },
          cat_status_edition: { type: ['integer', 'null'] },
          year: { type: ['integer', 'null'] },
          cat_segment_id: { type: ['integer', 'null'] },
          vacant: { type: ['integer', 'null'] },
          notes: { type: ['string', 'null'] },
          specific_code: { type: ['string', 'null'] },
          global_code: { type: ['string', 'null'] },
          upgrade: { type: ['string', 'null'] },
          expedient: { type: ['string', 'null'] },
          preconfirmation: { type: ['string', 'null'] },
          confirmation: { type: ['string', 'null'] },
          active: { type: ['string', 'null'] },
          cat_day_combination_id: { type: ['integer', 'null'] },
          cat_hour_combination_id: { type: ['integer', 'null'] },
          children: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                new: { type: ['boolean', 'null'] },
                edition_id: { type: ['integer', 'null'] },
                child_program_version_id: { type: ['integer', 'null'] },
                instructor_id: { type: ['integer', 'null'] },
                start_date: { type: ['string', 'null'] },
                end_date: { type: ['string', 'null'] },
                cat_type_approved: { type: ['integer', 'null'] },
                cat_status_edition: { type: ['integer', 'null'] },
                vacant: { type: ['integer', 'null'] },
                specific_code: { type: ['string', 'null'] },
                global_code: { type: ['string', 'null'] },
                expedient: { type: ['string', 'null'] },
                preconfirmation: { type: ['string', 'null'] },
                confirmation: { type: ['string', 'null'] },
                active: { type: ['string', 'null'] },
                cat_day_combination_id: { type: ['integer', 'null'] },
                cat_hour_combination_id: { type: ['integer', 'null'] },
                user_id: { type: ['integer', 'null'] },
                sort_order: { type: ['integer', 'null'] }
              }
            }
          }
        }
      }
    }
  }
}

export const auditLogsGetSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      edition_id: { type: ['integer', 'null'] },
      limit: { type: 'integer', default: 50 },
      offset: { type: 'integer', default: 0 }
    }
  }
}

export const editionListSchema = {
  body: {
    type: 'object',
    properties: {
      date_from: { type: ['string', 'null'] },
      date_to: { type: ['string', 'null'] },
      program_version_id: { type: ['integer', 'null'] },
      clasification: { type: ['string', 'null'] },
      q: { type: ['string', 'null'] },
      page: { type: ['integer', 'null'], default: 1 },
      size: { type: ['integer', 'null'], default: 25 },
      active: { type: ['boolean', 'string', 'null'] },
      instructores_seleccionados: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: { value: { type: 'integer' } }
        }
      },
      category_ids: {
        type: ['array', 'null'],
        items: { type: 'object', properties: { value: { type: 'integer' } } }
      },
      type_program_ids: {
        type: ['array', 'null'],
        items: { type: 'object', properties: { value: { type: 'integer' } } }
      },
      combination_days_ids: {
        type: ['array', 'null'],
        items: { type: 'object', properties: { value: { type: 'integer' } } }
      },
      hour_combination_ids: {
        type: ['array', 'null'],
        items: { type: 'object', properties: { value: { type: 'integer' } } }
      },
      segment_ids: {
        type: ['array', 'null'],
        items: { type: 'object', properties: { value: { type: 'integer' } } }
      },
      model_modality_ids: {
        type: ['array', 'null'],
        items: { type: 'object', properties: { value: { type: 'integer' } } }
      },
      course_category_ids: {
        type: ['array', 'null'],
        items: { type: 'object', properties: { value: { type: 'integer' } } }
      }
    }
  }
}

export const classroomStudentsListSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['edition_id'],
    properties: {
      edition_id: { type: 'integer' }
    }
  }
}

export const classroomAuditGetSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['edition_id'],
    properties: {
      edition_id: { type: 'integer' }
    }
  }
}

export const classroomAuditSaveSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['edition_id', 'session_number', 'criteria'],
    properties: {
      edition_id: { type: 'integer' },
      session_number: { type: 'integer', minimum: 1 },
      criteria: { type: 'object', additionalProperties: { type: 'boolean' } },
      user_id: { type: ['integer', 'null'] }
    }
  }
}

export const classroomMetricsListSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['edition_ids'],
    properties: {
      edition_ids: {
        type: 'array',
        items: { type: 'integer' },
        maxItems: 1000
      }
    }
  }
}

export const classroomAuditSummaryListSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['edition_ids'],
    properties: {
      edition_ids: {
        type: 'array',
        items: { type: 'integer' },
        maxItems: 1000
      }
    }
  }
}

export const editionByWeekListSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      selectedMonth: { type: ['integer', 'null'] },
      selectedYear: { type: ['integer', 'null'] },
      program_version_id: { type: ['integer', 'null'] },
      instructor_id: { type: ['integer', 'null'] },
      active: { type: ['boolean', 'string', 'null'] },
      cat_status_edition: { type: ['integer', 'null'] },
      q: { type: ['string', 'null'] },
      page: { type: ['integer', 'null'], default: 1 },
      size: { type: ['integer', 'null'], default: 25 }
    }
  }
}

export const editionGetSchema = {
  body: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
      id: { type: ['integer', 'null'] }
    }
  }
}

export const editionUpdateSchema = {
  body: {
    type: 'object',
    required: ['id', 'edition', 'user_id'],
    additionalProperties: false,
    properties: {
      id: { type: 'integer' },
      user_id: {
        type: 'integer',
        additionalProperties: true
      },
      edition: {
        type: 'object',
        additionalProperties: false,
        properties: {
          program_version_id: { type: ['integer', 'null'] },
          instructor_id: { type: ['integer', 'null'] },
          start_date: { type: ['string', 'null'] },
          end_date: { type: ['string', 'null'] },
          cat_segment_id: { type: ['integer', 'null'] },
          cat_type_approved: { type: ['integer', 'null'] },
          cat_status_edition: { type: ['integer', 'null'] },
          vacant: { type: ['integer', 'null'] },
          notes: { type: ['string', 'null'] },
          specific_code: { type: ['string', 'null'] },
          global_code: { type: ['string', 'null'] },
          upgrade: { type: ['string', 'null'] },
          expedient: { type: ['string', 'null'] },
          preconfirmation: { type: ['string', 'null'] },
          confirmation: { type: ['string', 'null'] },
          active: { type: ['string', 'null'] },
          cat_day_combination_id: { type: ['integer', 'null'] },
          cat_hour_combination_id: { type: ['integer', 'null'] },
          schedules: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                schedule_id: { type: ['integer', 'null'] },
                cat_day_id: { type: ['integer', 'null'] },
                start_time: { type: ['string', 'null'] },
                end_time: { type: ['string', 'null'] }
              }
            }
          }
        }
      }
    }
  }
}

export const editionCallerSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      program_version_id: { type: ['integer', 'null'] },
      active: { type: ['boolean', 'string', 'null'] },
      cat_status_edition: { type: ['integer', 'null'] },
      year: { type: ['integer', 'null'] },
      month: { type: ['integer', 'null'] },
      q: { type: ['string', 'null'] }
    }
  }
}

export const editionExtraInfoCallerSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      program_version_id: { type: ['integer', 'null'] }
    }
  }
}

export const editionTreeUpdateSchema = {
  body: {
    type: 'object',
    required: ['edition', 'user_id'],
    additionalProperties: false,
    properties: {
      user_id: {
        type: 'integer',
        additionalProperties: true
      },
      edition: {
        type: 'object',
        required: ['edition_id'],
        additionalProperties: false,
        properties: {
          edition_id: { type: 'integer' },
          program_version_id: { type: ['integer', 'null'] },
          instructor_id: { type: ['integer', 'null'] },
          start_date: { type: ['string', 'null'] },
          end_date: { type: ['string', 'null'] },
          cat_type_approved: { type: ['integer', 'null'] },
          cat_segment_id: { type: ['integer', 'null'] },
          cat_status_edition: { type: ['integer', 'null'] },
          vacant: { type: ['integer', 'null'] },
          specific_code: { type: ['string', 'null'] },
          global_code: { type: ['string', 'null'] },
          upgrade: { type: ['string', 'null'] },
          expedient: { type: ['string', 'null'] },
          preconfirmation: { type: ['string', 'null'] },
          confirmation: { type: ['string', 'null'] },
          active: { type: ['string', 'null'] },
          cat_day_combination_id: { type: ['integer', 'null'] },
          cat_hour_combination_id: { type: ['integer', 'null'] },
          notes: { type: ['string', 'null'] },
          children: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                new: { type: ['boolean', 'null'] },
                edition_id: { type: ['integer', 'null'] },
                child_program_version_id: { type: ['integer', 'null'] },
                instructor_id: { type: ['integer', 'null'] },
                start_date: { type: ['string', 'null'] },
                end_date: { type: ['string', 'null'] },
                cat_type_approved: { type: ['integer', 'null'] },
                cat_status_edition: { type: ['integer', 'null'] },
                vacant: { type: ['integer', 'null'] },
                specific_code: { type: ['string', 'null'] },
                global_code: { type: ['string', 'null'] },
                expedient: { type: ['string', 'null'] },
                preconfirmation: { type: ['string', 'null'] },
                confirmation: { type: ['string', 'null'] },
                active: { type: ['string', 'null'] },
                cat_day_combination_id: { type: ['integer', 'null'] },
                cat_hour_combination_id: { type: ['integer', 'null'] },
                user_id: { type: ['integer', 'null'] },
                sort_order: { type: ['integer', 'null'] }
              }
            }
          }
        }
      }
    }
  }
}

// Schemas que vivian inline en la ruta legacy.

export const bulkUpdateWhatsappSchema = {
  body: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            abbreviation: { type: 'string' },
            start_date: { type: 'string' },
            whatsapp_link: { type: 'string' }
          }
        }
      }
    }
  }
}

export const a5PendingEnrollmentsSchema = {
  body: {
    type: 'object',
    required: ['edition_num_id'],
    additionalProperties: false,
    properties: {
      edition_num_id: { type: 'integer' }
    }
  }
}

export const a5MigrationExecuteSchema = {
  body: {
    type: 'object',
    required: ['edition_num_id', 'migrations', 'justificacion'],
    additionalProperties: false,
    properties: {
      edition_num_id: { type: 'integer' },
      a5_segment_id: { type: ['integer', 'null'] },
      justificacion: { type: 'string', minLength: 1 },
      user_id: { type: ['integer', 'null'] },
      migrations: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['enrollment_id', 'target_edition_id'],
          additionalProperties: false,
          properties: {
            enrollment_id: { type: 'integer' },
            target_edition_id: { type: 'integer' }
          }
        }
      }
    }
  }
}

export const schedulePdfSchema = {
  body: {
    type: 'object',
    required: ['parent_edition_id', 'child_edition_id'],
    properties: {
      parent_edition_id: { type: 'number' },
      child_edition_id: { type: 'number' }
    }
  }
}
