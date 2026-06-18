// JSON schemas de validación (Fastify/AJV) del dominio config.
// api.js del frontend inyecta user_id en todos los POST, por eso cada body
// lo acepta como propiedad opcional.

const userBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    alias: { type: 'string' },
    first_name: { type: 'string' },
    last_name: { type: ['string', 'null'] },
    email: { type: ['string', 'null'] },
    password: { type: ['string', 'null'] },
    active: { type: ['string', 'null'], enum: ['Y', 'N', null] },
    telefonos: { type: ['array', 'null'], items: { type: 'string' } },
    roles: { type: ['array', 'null'], items: { type: 'integer' } }
  }
}

export const configUserListSchema = {
  tags: ['Config'],
  summary: 'Lista todos los usuarios con sus roles y teléfonos',
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { user_id: { type: ['integer', 'null'] } }
  }
}

export const configUserRegisterSchema = {
  tags: ['Config'],
  summary: 'Crea persona + usuario + roles',
  body: {
    type: 'object',
    required: ['user'],
    additionalProperties: false,
    properties: {
      user_id: { type: ['integer', 'null'] },
      user: userBody
    }
  }
}

export const configUserUpdateSchema = {
  tags: ['Config'],
  summary: 'Actualiza usuario, roles y teléfonos',
  body: {
    type: 'object',
    required: ['id', 'user'],
    additionalProperties: false,
    properties: {
      user_id: { type: ['integer', 'null'] },
      id: { type: 'integer' },
      user: userBody
    }
  }
}

export const configRoleListSchema = {
  tags: ['Config'],
  summary: 'Lista roles con conteo de usuarios y módulos asignados',
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { user_id: { type: ['integer', 'null'] } }
  }
}

export const configRoleRegisterSchema = {
  tags: ['Config'],
  summary: 'Crea un nuevo rol',
  body: {
    type: 'object',
    required: ['role'],
    additionalProperties: false,
    properties: {
      user_id: { type: ['integer', 'null'] },
      role: {
        type: 'object',
        required: ['description', 'alias'],
        additionalProperties: false,
        properties: {
          description: { type: 'string' },
          alias: { type: 'string' }
        }
      }
    }
  }
}

export const configRoleUpdateSchema = {
  tags: ['Config'],
  summary: 'Actualiza la descripción de un rol (el alias es inmutable)',
  body: {
    type: 'object',
    required: ['role'],
    additionalProperties: false,
    properties: {
      user_id: { type: ['integer', 'null'] },
      role: {
        type: 'object',
        required: ['rol_id', 'description'],
        additionalProperties: false,
        properties: {
          rol_id: { type: 'integer' },
          description: { type: 'string' }
        }
      }
    }
  }
}

export const configModuleListSchema = {
  tags: ['Config'],
  summary: 'Lista los módulos del sistema',
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { user_id: { type: ['integer', 'null'] } }
  }
}

export const configMyModulesSchema = {
  tags: ['Config'],
  summary: 'Módulos accesibles del usuario autenticado (cualquier rol)',
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { user_id: { type: ['integer', 'null'] } }
  }
}

export const configPermissionUpdateSchema = {
  tags: ['Config'],
  summary: 'Reemplaza los módulos permitidos de un rol',
  body: {
    type: 'object',
    required: ['rol_id', 'module_ids'],
    additionalProperties: false,
    properties: {
      user_id: { type: ['integer', 'null'] },
      rol_id: { type: 'integer' },
      module_ids: { type: 'array', items: { type: 'integer' } },
      submodule_ids: { type: ['array', 'null'], items: { type: 'integer' } }
    }
  }
}
