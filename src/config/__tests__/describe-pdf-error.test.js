import { describe, it, expect } from 'vitest'
import { describePdfError } from '../odooClient.js'

// Mensaje real de Odoo (05/10/26, aula Bizagi): cabeceras HTTP + JSON de Google.
const DRIVE_LLENO = `{'cache-control': 'private, max-age=0', 'status': '403'} { "error": { "code": 403, "message": "The user's Drive storage quota has been exceeded.", "errors": [ { "domain": "usageLimits", "reason": "storageQuotaExceeded" } ] } }`

describe('describePdfError', () => {
  it('Drive lleno: causa legible y no se reintenta con los demas PDFs', () => {
    const r = describePdfError(DRIVE_LLENO)
    expect(r.retryable).toBe(false)
    expect(r.cause).toMatch(/Drive .* LLENO/)
    expect(r.cause).not.toMatch(/cache-control/)
  })
  it('otro error de Google: deja solo su "message"', () => {
    const r = describePdfError(`{'status': '500'} { "error": { "message": "Backend Error" } }`)
    expect(r).toEqual({ cause: 'Backend Error', retryable: true })
  })
  it('error plano: se recorta y se reintenta con el siguiente', () => {
    expect(describePdfError('x'.repeat(500)).cause).toHaveLength(200)
    expect(describePdfError(undefined).cause).toBe('Error desconocido de Odoo')
  })
})
