// JSON schemas de validacion (Fastify/AJV) del dominio customer.

export const customerRegisterSchema = {
  tags: ['Customers'],
  body: {
    type: 'object',
    required: ['customer'],
    additionalProperties: false,
    properties: {
      customer: {
        type: 'object',
        additionalProperties: false,
        properties: {
          document_number:    { type: ['string','null'] },
          active:             { type: ['boolean','string','null'] },

          person_id:          { type: ['integer','null'] },
          first_name:         { type: ['string','null'] },
          last_name:          { type: ['string','null'] },
          mother_last_name:   { type: ['string','null'] },
          cat_occupation:     { type: ['integer','null'] },
          cat_type_document:  { type: ['integer','null'] },
          cat_person_status:  { type: ['integer','null'] },
          cat_country:        { type: ['integer','null'] },

          company_id:         { type: ['integer','null'] },
          razon_social:       { type: ['string','null'] },
          razon_comercial:    { type: ['string','null'] },

          cat_customer_segment: { type: ['integer','null'] },
          cat_customer_status:  { type: ['integer','null'] }
        }
      }
    }
  }
}

export const customerListSchema = {
  tags: ['Customers'],
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      active:               { type: ['string','null'] },
      cat_customer_segment: { type: ['integer','null'] },
      cat_customer_status:  { type: ['integer','null'] },
      q:                    { type: ['string','null'] },
      page:                 { type: ['integer','null'], default: 1 },
      size:                 { type: ['integer','null'], default: 25 }
    }
  }
}

export const customerGetSchema = {
  tags: ['Customers'],
  body: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
      id: { type: 'integer' }
    }
  }
}

export const customerInfoGetSchema = {
  tags: ['Customers'],
  body: {
    type: 'object',
    required: ['document'],
    properties: {
      document: { type: 'string', minLength: 1 }
    }
  }
}

// El endpoint legacy /customerupdate no tenia schema (aceptaba cualquier body).
// Se mantiene permisivo (additionalProperties:true) para no rechazar payloads
// que antes pasaban; solo se valida que venga 'id'.
export const customerUpdateSchema = {
  tags: ['Customers'],
  body: {
    type: 'object',
    required: ['id'],
    additionalProperties: true,
    properties: {
      id: { type: 'integer' }
    }
  }
}

export const customerCallerSchema = {
  tags: ['Customers'],
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q:      { type: ['string', 'null'] },
      active: { type: ['string', 'null'], default: 'Y' }
    }
  }
}

// El endpoint legacy /sunatget no tenia schema. Se exige 'document' como guarda
// minima pero se permite cualquier campo extra para preservar la permisividad.
export const sunatGetSchema = {
  tags: ['Customers'],
  body: {
    type: 'object',
    required: ['document'],
    additionalProperties: true,
    properties: {
      document: { type: 'string', minLength: 1 }
    }
  }
}
