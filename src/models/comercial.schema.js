
export const leadRegisterSchema = {
  body: {
    type: 'object',
    required: ['lead', 'user_id'],
    additionalProperties: false,
    properties: {
      lead: {
        type: 'object',
        additionalProperties: false,
        properties: {
          first_contact_date:        { type: ['string', 'null'] },
          program_version_id:        { type: ['integer', 'null'] },
          program_edition_id:        { type: ['integer', 'null'] },
          cat_program_type:          { type: ['integer', 'null'] },
          cat_program_modality:      { type: ['integer', 'null'] },
          cat_query:                 { type: ['integer', 'null'] },
          full_name:                 { type: ['string', 'null'] },
          pay_date:                  { type: ['string', 'null'] },
          cat_client_type:           { type: ['integer', 'null'] },
          cat_status_lead:           { type: ['integer', 'null'] },
          cat_code_country:          { type: ['integer', 'null'] },
          cat_interest_level:        { type: ['integer', 'null'] },
          cat_channel:               { type: ['integer', 'null'] },
          cat_medium_contact:        { type: ['integer', 'null'] },
          cat_frecuency_word:        { type: ['integer', 'null'] },
          cat_type_strategy:         { type: ['integer', 'null'] },
          cat_prospect_situation:    { type: ['integer', 'null'] },
          membership_moment_id:      { type: ['integer', 'null'] },
          cat_client_moment:         { type: ['integer', 'null'] },
          message_init_conversation: { type: ['string', 'null'] },
          observations:              { type: ['string', 'null'] },
          origin_phone:              { type: ['string', 'null'] },
          origin_seller_phone:       { type: ['string', 'null'] },
          origin_email:              { type: ['string', 'null'] },
          planned_payment_date:      { type: ['string', 'null'] },
          bot:                       { type: ['string', 'null'] },
          web:                       { type: ['string', 'null'] },
          b2b:                       { type: ['string', 'null'] }
        }
      },
      user_id: {
        type: 'integer',
        additionalProperties: true
      },
      person: {
        type: 'object',
        additionalProperties: true
      },
      contact_attempts: {
        type: 'array',
        default: [],
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            attempt_number:   { type: ['integer', 'null'] },
            cat_status:       { type: ['integer', 'null'] },
            contact_datetime: { type: ['string', 'null'] },
            cat_type_attempt: { type: ['integer', 'null'] },
            cat_result:       { type: ['integer', 'null'] },
            response:         { type: ['string', 'null'] },
            contact_duration: { type: ['integer', 'null'] }
          }
        }
      }
    }
  }
}

export const leadUpdateSchema = {
  body: {
    type: 'object',
    required: ['id', 'lead', 'user_id'],
    additionalProperties: false,
    properties: {
      id:      { type: 'integer' },
      user_id: { type: 'integer' },
      lead: {
        type: 'object',
        additionalProperties: false,
        properties: {
          program_version_id:          { type: ['integer', 'null'] },
          program_edition_id:          { type: ['integer', 'null'] },
          cat_query:                   { type: ['integer', 'null'] },
          full_name:                   { type: ['string', 'null'] },
          cat_client_type:             { type: ['integer', 'null'] },
          first_contact_date: { type: ['string', 'null'] },
          pay_date:                    { type: ['string', 'null'] },
          membership_moment_id:        { type: ['integer', 'null'] },
          cat_client_moment:           { type: ['integer', 'null'] },
          cat_program_type:            { type: ['integer', 'null'] },
          cat_program_modality:        { type: ['integer', 'null'] },
          cat_status_lead:             { type: ['integer', 'null'] },
          cat_code_country:            { type: ['integer', 'null'] },
          cat_interest_level:          { type: ['integer', 'null'] },
          cat_channel:                 { type: ['integer', 'null'] },
          cat_medium_contact:          { type: ['integer', 'null'] },
          cat_frecuency_word:          { type: ['integer', 'null'] },
          cat_type_strategy:           { type: ['integer', 'null'] },
          cat_prospect_situation:      { type: ['integer', 'null'] },
          message_init_conversation:   { type: ['string', 'null'] },
          observations:                { type: ['string', 'null'] },
          origin_phone:                { type: ['string', 'null'] },
          origin_seller_phone:         { type: ['string', 'null'] },
          origin_email:                { type: ['string', 'null'] },
          source_campaign_id:          { type: ['integer', 'null'] },
          source_event_id:             { type: ['integer', 'null'] },
          agreed_amount:               { type: ['number', 'null'] },
          cat_proposed_method_payment: { type: ['integer', 'null'] },
          cat_proposed_way_payment:    { type: ['integer', 'null'] },
          active:                      { type: ['string', 'null'] },
          bot:                         { type: ['string', 'null'] },
          web:                         { type: ['string', 'null'] },
          b2b:                         { type: ['string', 'null'] }
        }
      },
      contact_attempts: {
        type: 'array',
        default: [],
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id:               { type: ['integer', 'null'] },
            cat_type_attempt: { type: ['integer', 'null'] },
            attempt_number:   { type: ['integer', 'null'] },
            cat_status:       { type: ['integer', 'null'] },
            contact_datetime: { type: ['string', 'null'] },
            cat_result:       { type: ['integer', 'null'] },
            response:         { type: ['string', 'null'] },
            contact_duration: { type: ['integer', 'null'] }
          }
        }
      }
    }
  }
}

export const enrollmentGetSchema = {
  body: {
    type: 'object',
    required: ['enrollment_id'],
    additionalProperties: false,
    properties: {
      enrollment_id: { type: 'integer' }
    }
  }
}

export const enrollmentRegisterSchema = {
  body: {
    type: 'object',
    required: ['inscription', 'user_id'],
    properties: {
      user_id: { type: 'integer' },
      inscription: {
        type: 'object',
        required: [
          'lead_id',
          'document',
          'cat_type_document',
          'full_name',
          'total_amount',
          'cat_currency',
          'cat_payment_channel'
        ],
        properties: {
          lead_id:                { type: 'integer' },
          program_version_id:     { type: ['integer', 'null'] },
          program_edition_id:     { type: ['integer', 'null'] },

          // Datos del alumno
          document:               { type: 'string' },
          cat_type_document:      { type: 'integer' },
          cat_insc_modality:      { type: ['integer', 'null'] },
          cat_certificate_status: { type: ['integer', 'null'] }, // <-- AÑADIDO
          full_name:              { type: 'string' },
          last_name:              { type: ['string', 'null'] },
          mother_last_name:       { type: ['string', 'null'] },
          email:                  { type: ['string', 'null'] },
          cat_country:            { type: ['integer', 'null'] },

          // Canal y pago
          cat_payment_channel:    { type: 'integer' },
          cat_type_payment:       { type: ['integer', 'null'] },
          cat_currency:           { type: 'integer' },
          cat_method_payment:     { type: ['integer', 'null'] },
          cat_token_provider:     { type: ['integer', 'null'] },
          saved_money:            { type: 'number' },

          // Precios y descuentos
          list_price:             { type: ['number', 'null'] },
          total_amount:           { type: 'number' },
          discount_amount:        { type: ['number', 'null'] },
          dsct_porcent_id:        { type: ['integer', 'null'] },
          dsct_stick_id:          { type: ['integer', 'null'] },
          dsct_benefit_id:        { type: ['integer', 'null'] },

          // <-- AÑADIDO: Plan de cuotas (vital para cuando pagan a plazos)
          installment_plan: {
            type: ['array', 'null'],
            items: {
              type: 'object',
              properties: {
                installment_number: { type: 'integer' },
                amount:             { type: 'number' },
                due_date:           { type: 'string' }
              }
            }
          },

          // Adjuntos y extras
          observations:           { type: ['string', 'null'] },
          student_attachment_url: { type: ['string', 'null'] },
          b2b_contract_id:        { type: ['integer', 'null'] },

          // Comprobantes de pago -> enrollment_attachments (canal GENERAL)
          ticket_payment_urls: {
            type: 'array',
            default: [],
            items: {
              type: 'object',
              required: ['url'],
              properties: {
                url:  { type: 'string' },
                name: { type: ['string', 'null'] },
                type: { type: ['string', 'null'] }
              }
            }
          },

          // Adjuntos generales del lead -> lead_attachments (canal WEB u otros)
          attachments: {
            type: 'array',
            default: [],
            items: {
              type: 'object',
              required: ['url'],
              properties: {
                url:  { type: 'string' },
                name: { type: ['string', 'null'] },
                type: { type: ['string', 'null'] }
              }
            }
          }
        }
      }
    }
  }
}; // <-- Corregida la llave sobrante
export const leadGetSchema = {
  body: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
      id: { type: 'integer' }
    }
  }
}

export const restrictionsListSchema = {
  body: {
    type: 'object',
    additionalProperties: true
  }
}

export const restrictionsUpdateSchema = {
  body: {
    type: 'object',
    additionalProperties: true,
    required: ['restrictions'],
    properties: {
      user_id: { type: ['integer', 'null'] },
      restrictions: {
        type: 'array',
        items: { type: 'object' }
      }
    }
  }
}

export const leadListSchema = {
  body: {
    type: 'object',
    additionalProperties: true,
    properties: {
      user_id:             { type: ['integer', 'null'] },
      q:                   { type: ['string', 'null'] },
      page:                { type: ['integer', 'null'], default: 1 },
      size:                { type: ['integer', 'null'], default: 25 },
      from_date:           { type: ['string', 'null'] },
      to_date:             { type: ['string', 'null'] },
      first_contact_from: { type: ['string', 'null'] },
first_contact_to:   { type: ['string', 'null'] },
      updated_from:        { type: ['string', 'null'] },
      updated_to:          { type: ['string', 'null'] },
      order_by: { type: 'number', nullable: true },
      edition_start_from:  { type: ['string', 'null'] },
      edition_start_to:    { type: ['string', 'null'] },
      active:              { type: ['boolean', 'string', 'null'] },
      // Junto a los demás arrays financieros
payment_channel_ids: { type: ['array', 'null'], items: { type: 'integer' } },
      program_text:        { type: ['string', 'null'] },
      web:                 { type: ['string', 'null'] },
      b2b:                 { type: ['string', 'null'] },
      pay_date_from:       { type: ['string', 'null'] },
      pay_date_to:         { type: ['string', 'null'] },
      payment_type_ids: { type: ['array', 'null'], items: { type: 'integer' } },
      strategy_ids:        { type: ['array', 'null'], items: { type: 'integer' } },
      prospect_situation_ids: { type: ['array', 'null'], items: { type: 'integer' } },
      program_version_ids: { type: ['array', 'null'], items: { type: 'integer' } },
      word_ids:            { type: ['array', 'null'], items: { type: 'integer' } },
      medium_contact_ids:  { type: ['array', 'null'], items: { type: 'integer' } },
      code_country_ids:    { type: ['array', 'null'], items: { type: 'integer' } },
      owner_user_ids:      { type: ['array', 'null'], items: { type: 'integer' } },
      status_lead_ids:     { type: ['array', 'null'], items: { type: 'integer' } },
      moment_ids:          { type: ['array', 'null'], items: { type: 'integer' } },
      attempt_origin_ids:  { type: ['array', 'null'], items: { type: 'integer' } },
      membership_moment_ids: { type: ['array', 'null'], items: { type: 'integer' } },
      last_follow_ids:     { type: ['array', 'null'], items: { type: 'integer' } },
      interest_level_ids:  { type: ['array', 'null'], items: { type: 'integer' } },
      channel_ids:         { type: ['array', 'null'], items: { type: 'integer' } },
      query_ids:           { type: ['array', 'null'], items: { type: 'integer' } },
      type_program_ids:    { type: ['array', 'null'], items: { type: 'integer' } },
      model_modality_ids:  { type: ['array', 'null'], items: { type: 'integer' } }
    }
  }
}

export const leadStatsSchema = {
  body: {
    type: 'object',
    additionalProperties: true
  }
}

export const searchPhoneGetSchema = {
  body: {
    type: 'object',
    required: ['phone'],
    additionalProperties: false,
    properties: {
      phone: { type: 'string', minLength: 5 }
    }
  }
}

export const searchContactSchema = {
  body: {
    type: 'object',
    required: ['phone'],
    additionalProperties: false,
    properties: {
      phone: { type: 'string' }
    }
  }
}