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

export const classroomStudentsHistorySchema = {
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

export const classroomGradesGetSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['edition_id'],
    properties: {
      edition_id: { type: 'integer' }
    }
  }
}

// Bulk de filas de notas. Los rangos finos (0-5 por test, maximos por
// criterio) se clampan en edition.entity.js para no rechazar el guardado
// completo por una celda fuera de rango.
export const classroomGradesSaveSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['edition_id', 'items'],
    properties: {
      edition_id: { type: 'integer' },
      user_id: { type: ['integer', 'null'] },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 200,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['enrollment_id'],
          properties: {
            enrollment_id: { type: 'integer' },
            tests: { type: 'object', additionalProperties: { type: ['number', 'null'] } },
            participation: { type: 'object', additionalProperties: { type: 'boolean' } },
            partial_criteria: { type: 'object', additionalProperties: { type: ['number', 'null'] } },
            final_criteria: { type: 'object', additionalProperties: { type: ['number', 'null'] } },
            group_number: { type: ['integer', 'null'] },
            tracking_code: { type: ['string', 'null'], maxLength: 50 },
            observation: { type: ['string', 'null'], maxLength: 2000 }
          }
        }
      }
    }
  }
}

export const classroomOdooCertifySchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['edition_id'],
    properties: {
      edition_id: { type: 'integer' }
    }
  }
}

export const classroomGradesObservationsSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['edition_id'],
    properties: {
      edition_id: { type: 'integer' },
      enrollment_ids: {
        type: ['array', 'null'],
        items: { type: 'integer' },
        maxItems: 200
      }
    }
  }
}

// Snapshot de indicadores del Reporte Academico para las recomendaciones IA.
// Todo viene ya calculado del frontend; el backend solo redacta con el modelo.
export const reportRecommendationsSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['snapshot'],
    properties: {
      snapshot: {
        type: 'object',
        additionalProperties: false,
        properties: {
          period_start: { type: 'string', maxLength: 10 },
          period_end: { type: 'string', maxLength: 10 },
          total: { type: 'integer', minimum: 0 },
          evaluated: { type: 'integer', minimum: 0 },
          at_risk: { type: 'integer', minimum: 0 },
          avg_consolidated: { type: ['number', 'null'] },
          avg_ia: { type: ['number', 'null'] },
          avg_manual: { type: ['number', 'null'] },
          goal: { type: 'number' },
          coverage_pct: { type: 'integer', minimum: 0, maximum: 100 },
          coverage_ia_pct: { type: 'integer', minimum: 0, maximum: 100 },
          coverage_manual_pct: { type: 'integer', minimum: 0, maximum: 100 },
          worst_teachers: {
            type: 'array',
            maxItems: 5,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', maxLength: 120 },
                avg: { type: ['number', 'null'] },
                at_risk: { type: 'integer', minimum: 0 },
                total: { type: 'integer', minimum: 0 }
              }
            }
          },
          critical_aulas: {
            type: 'array',
            maxItems: 8,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                code: { type: 'string', maxLength: 30 },
                name: { type: 'string', maxLength: 120 },
                score: { type: ['number', 'null'] },
                verdict: { type: 'string', maxLength: 20 }
              }
            }
          }
        }
      }
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

// Vista Semanal Academica: semana ISO del anio (1..53).
export const weeklySessionsSchema = {
  body: {
    type: 'object',
    required: ['year', 'week'],
    additionalProperties: false,
    properties: {
      year: { type: 'integer', minimum: 2020, maximum: 2100 },
      week: { type: 'integer', minimum: 1, maximum: 53 }
    }
  }
}

// Control de ediciones: aulas que inician en la semana ISO (1..53).
export const weeklyControlSchema = weeklySessionsSchema

// Seguimiento Docentes: rango libre de fechas calendario (YYYY-MM-DD).
export const teacherFollowupSchema = {
  body: {
    type: 'object',
    required: ['date_start', 'date_end'],
    additionalProperties: false,
    properties: {
      date_start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      date_end: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
    }
  }
}

// Estado de una sesion: A dictada, R reprogramada (new_date), T tardanza.
// status null limpia la gestion de esa sesion.
export const sessionControlSaveSchema = {
  body: {
    type: 'object',
    required: ['edition_num_id', 'session_number'],
    additionalProperties: false,
    properties: {
      edition_num_id: { type: 'integer' },
      session_number: { type: 'integer', minimum: 1, maximum: 100 },
      status: { type: ['string', 'null'], enum: ['A', 'R', 'T', null] },
      new_date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
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

export const eventEditionsListSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: ['string', 'null'] }
    }
  }
}

// Objetivo de ventas del evento: matriz area (codigo del organigrama) x
// modalidad de entrada. Las llaves se filtran de nuevo en el usecase contra el
// catalogo de areas; aqui solo se acota la forma y el tamano.
export const eventGoalsSaveSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['edition_num_id', 'goals'],
    properties: {
      edition_num_id: { type: 'integer' },
      user_id: { type: ['integer', 'null'] },
      goals: {
        type: 'object',
        maxProperties: 30,
        additionalProperties: {
          type: 'object',
          additionalProperties: false,
          properties: {
            vip: { type: ['integer', 'null'], minimum: 0 },
            premium: { type: ['integer', 'null'], minimum: 0 },
            general: { type: ['integer', 'null'], minimum: 0 },
            virtual: { type: ['integer', 'null'], minimum: 0 }
          }
        }
      }
    }
  }
}

// Categorias de entrada del evento. Los ids se cotejan igual contra el catalogo
// en el usecase: este schema solo valida la forma, no la pertenencia.
export const eventCategoriesSaveSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['edition_num_id', 'categories'],
    properties: {
      edition_num_id: { type: 'integer' },
      categories: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['cat_event_category'],
          properties: {
            cat_event_category: { type: 'integer' },
            enabled: { type: 'boolean' },
            price_student_soles: { type: ['number', 'string', 'null'] },
            price_student_dollars: { type: ['number', 'string', 'null'] },
            price_profesional_soles: { type: ['number', 'string', 'null'] },
            price_profesional_dollars: { type: ['number', 'string', 'null'] },
            whatsapp_link: { type: ['string', 'null'] }
          }
        }
      }
    }
  }
}

export const eventResourcesGetSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['edition_num_id'],
    properties: {
      edition_num_id: { type: 'integer' }
    }
  }
}

// Links del aula que Academica edita en linea desde Producto > Cronograma.
// Solo estas claves: el usecase filtra igual, pero declararlas es lo que evita
// que AJV (removeAdditional) las borre en silencio.
export const classroomLinksSaveSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['edition_num_id'],
    properties: {
      edition_num_id: { type: 'integer' },
      whatsapp_link: { type: ['string', 'null'] },
      teams_link: { type: ['string', 'null'] },
      ficha_link: { type: ['string', 'null'] },
      grades_link: { type: ['string', 'null'] }
    }
  }
}

export const eventResourcesSaveSchema = {
  // El banner viaja en base64: 2 MB de imagen son ~2.7 MB de body. El default
  // de Fastify (1 MB) lo rechazaria con 413. Se deja holgura sobre el tope real
  // (2 MB, edition.usecases.js) para que quien pase pase lo rechace el usecase
  // con un mensaje claro y no un 413 seco de Fastify.
  bodyLimit: 5 * 1024 * 1024,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['edition_num_id'],
    properties: {
      edition_num_id: { type: 'integer' },
      // Banner en base64 dentro del JSON. Se valida tamano y mime en el usecase.
      banner_image_base64: { type: ['string', 'null'] },
      banner_mime: { type: ['string', 'null'] },
      banner_link: { type: ['string', 'null'] },
      whatsapp_link: { type: ['string', 'null'] },
      certificate_form_link: { type: ['string', 'null'] },
      business_card_link: { type: ['string', 'null'] },
      session_detail_virtual: { type: ['string', 'null'] },
      session_detail_onsite: { type: ['string', 'null'] }
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
      user_id: { type: 'integer' },
      edition: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // Links del aula. Van declarados aunque parezcan opcionales: AJV corre
          // con removeAdditional (ver tests/smoke/http-wiring.test.js), asi que
          // un campo no declarado se BORRA en silencio y el guardado miente sin
          // fallar. sp_edition_update solo escribe la clave que viaja en el JSON.
          whatsapp_link: { type: ['string', 'null'] },
          teams_link: { type: ['string', 'null'] },
          ficha_link: { type: ['string', 'null'] },
          grades_link: { type: ['string', 'null'] },
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
          new_methodology: { type: ['string', 'null'] },
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

// Seguimiento B2B. scope: 'curso' (aulas dictandose hoy) | 'todas'.
export const b2bTrackingListSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      scope: { type: 'string', enum: ['curso', 'todas'] }
    }
  }
}

export const b2bAttendanceSaveSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['enrollment_id', 'program_edition_id', 'session_number'],
    properties: {
      enrollment_id: { type: 'integer' },
      program_edition_id: { type: 'integer' },
      session_number: { type: 'integer', minimum: 1 },
      status: { type: ['string', 'null'], enum: ['P', 'T', 'F', 'J', null] },
      // Motivo de la justificacion. Obligatorio con 'J', ignorado en el resto.
      note: { type: ['string', 'null'], maxLength: 500 },
      user_id: { type: ['integer', 'null'] }
    }
  }
}
