// Errores de dominio con codigo HTTP asociado. El error handler global de
// buildApp.js lee err.statusCode, asi que estos errores se traducen a la
// respuesta correcta sin try/catch repetidos en cada controller.

export class DomainError extends Error {
  constructor (message, { statusCode = 400, code = 'DOMAIN_ERROR' } = {}) {
    super(message)
    this.name = 'DomainError'
    this.statusCode = statusCode
    this.code = code
    // Mensaje seguro escrito por nosotros: el error handler global puede mostrarlo
    // al cliente aun en 5xx, a diferencia de errores inesperados que se enmascaran.
    this.expose = true
  }
}

export class NotFoundError extends DomainError {
  constructor (message = 'Recurso no encontrado') {
    super(message, { statusCode: 404, code: 'NOT_FOUND' })
    this.name = 'NotFoundError'
  }
}

export class ForbiddenError extends DomainError {
  constructor (message = 'Accion no permitida') {
    super(message, { statusCode: 403, code: 'FORBIDDEN' })
    this.name = 'ForbiddenError'
  }
}
