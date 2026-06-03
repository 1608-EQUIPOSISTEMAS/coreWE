import { DomainError } from '../../shared/errors.js'
import { customerRepository } from './customer.repository.js'
import {
  normalizeActive,
  buildListResult,
  detectDocumentType,
  mapSunatResponse
} from './customer.entity.js'
import {
  toRegisterDto,
  toUpdateDto,
  toCallerDto,
  toInfoGetDto
} from './customer.dto.js'

const repo = customerRepository

// El payload puede contener datos de Persona o Empresa, mas contactos y direcciones.
export async function registerCustomer ({ customer = {}, contacts = [], addresses = [] } = {}) {
  const row = await repo.register({ ...customer, contacts, addresses })
  return toRegisterDto(row)
}

export async function listCustomers (payload = {}) {
  const {
    active = null,
    cat_customer_segment = null,
    cat_customer_status = null,
    q = null,
    page = 1,
    size = 25
  } = payload

  const rows = await repo.list({
    active: normalizeActive(active),
    cat_customer_segment,
    cat_customer_status,
    q,
    page,
    size
  })

  return buildListResult({ rows, page, size })
}

export async function getCustomer ({ id }) {
  return repo.get(id)
}

// contacts y addresses reemplazan completamente los existentes (el SP hace el upsert/delete).
export async function updateCustomer ({ id, customer = {}, contacts = [], addresses = [] }) {
  const row = await repo.update(id, { ...customer, contacts, addresses })
  return toUpdateDto({ row, id })
}

export async function callerCustomers (payload = {}) {
  const { q = null, active = 'Y' } = payload
  const rows = await repo.caller({ active, q })
  return toCallerDto(rows)
}

// Busca persona/cliente por numero de documento.
export async function customerInfoGet ({ document }) {
  const row = await repo.infoGet(document)
  return toInfoGetDto(row)
}

// Consulta el documento contra SUNAT (ruc.com.pe), valida la respuesta y la mapea
// a la forma unificada del dominio. Los fallos de servicio se traducen a HTTP 500.
export async function sunatLookup ({ document }) {
  if (!repo.hasSunatToken()) {
    throw new DomainError('Servicio de consulta no disponible', { statusCode: 500 })
  }

  const isRuc = detectDocumentType(document) === 'RUC'

  let apiResponse
  try {
    apiResponse = await repo.lookupSunat({ document, isRuc })
  } catch (error) {
    throw new DomainError(error.message || 'Error al consultar SUNAT', { statusCode: 500 })
  }

  if (!apiResponse.success) {
    throw new DomainError(apiResponse.message || 'La consulta a la API de RUC.com.pe no fue exitosa.', { statusCode: 500 })
  }

  try {
    return mapSunatResponse(apiResponse)
  } catch (error) {
    throw new DomainError(error.message, { statusCode: 500 })
  }
}
