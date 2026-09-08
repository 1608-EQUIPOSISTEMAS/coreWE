import { describe, it, expect } from 'vitest'
import { selectFeeForInstallment } from '../odoo-sync.entity.js'

// Reclamo de FICO (sept/26): al confirmar una cuota en el ERP, Odoo marcaba
// pagada la cuota SIGUIENTE y el alumno creia estar al dia. Pasaba porque el
// sync tomaba la primera fee pendiente ignorando el numero de cuota: si Mercado
// Pago ya habia saldado la cuota del alumno, la primera pendiente era la de
// despues.

const CUOTAS_ODOO = [
  { id: 11, seq: 1, state: 'pagado' },
  { id: 12, seq: 2, state: 'pagado' },
  { id: 13, seq: 3, state: 'pendiente' },
  { id: 14, seq: 4, state: 'pendiente' }
]

describe('selectFeeForInstallment', () => {
  it('empareja por numero de cuota, no por orden de pendientes', () => {
    expect(selectFeeForInstallment(CUOTAS_ODOO, 3)).toEqual({ fee: CUOTAS_ODOO[2], alreadyPaid: false })
  })

  // El caso que originó el reclamo: Mercado Pago salda la cuota 2 y FICO confirma
  // ese mismo pago en el ERP. Antes se marcaba la 3.
  it('avisa que la pasarela ya la salda en vez de marcar la siguiente', () => {
    const { fee, alreadyPaid } = selectFeeForInstallment(CUOTAS_ODOO, 2)

    expect(alreadyPaid).toBe(true)
    expect(fee.id).toBe(12)
  })

  it('no inventa una cuota que no existe en la orden', () => {
    expect(selectFeeForInstallment(CUOTAS_ODOO, 9).fee).toBeNull()
  })

  // Odoo devuelve seq como numero; el ERP a veces lo arrastra como texto.
  it('tolera el numero de cuota como texto', () => {
    expect(selectFeeForInstallment(CUOTAS_ODOO, '4').fee.id).toBe(14)
  })

  it('sin cuotas en Odoo no elige nada', () => {
    expect(selectFeeForInstallment([], 1).fee).toBeNull()
    expect(selectFeeForInstallment(undefined, 1).fee).toBeNull()
  })
})
