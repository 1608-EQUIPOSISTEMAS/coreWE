import { describe, it, expect } from 'vitest'
import { buildPartnerDocumentVals } from '../odooClient.js'

describe('buildPartnerDocumentVals', () => {
  it('un DNI de 8 digitos se marca como DNI, no con el RUC por defecto de Odoo', () => {
    expect(buildPartnerDocumentVals(' 75192933 ')).toEqual({ vat: '75192933', l10n_latam_identification_type_id: 4 })
  })
  it('otro formato solo escribe el vat', () => {
    expect(buildPartnerDocumentVals('20123456789')).toEqual({ vat: '20123456789' })
  })
  it('sin documento no toca el partner', () => {
    expect(buildPartnerDocumentVals(null)).toEqual({})
    expect(buildPartnerDocumentVals('  ')).toEqual({})
  })
})
