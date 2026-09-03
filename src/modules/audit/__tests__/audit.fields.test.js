import { describe, it, expect } from 'vitest'
import { labelForField, referenceForField, formatFieldValue, REFERENCE } from '../audit.fields.js'

describe('labelForField', () => {
  it('traduce la columna al nombre que usa el negocio', () => {
    expect(labelForField('cat_inscription_modality')).toBe('Modalidad de inscripción')
    expect(labelForField('discount_amount')).toBe('Descuento')
  })

  it('una columna sin etiqueta se lee como frase, no como código', () => {
    expect(labelForField('cat_alguna_cosa_id')).toBe('Alguna cosa')
  })
})

describe('referenceForField', () => {
  it('todo cat_* se resuelve contra el catálogo', () => {
    expect(referenceForField('cat_type_status')).toBe(REFERENCE.CATALOGO)
  })

  it('las FK conocidas apuntan a su tabla', () => {
    expect(referenceForField('program_edition_id')).toBe(REFERENCE.EDICION)
    expect(referenceForField('seller_agent_id')).toBe(REFERENCE.USUARIO)
  })

  it('un campo de dato plano no se resuelve contra nada', () => {
    expect(referenceForField('notes')).toBeNull()
  })
})

describe('formatFieldValue', () => {
  it('el id se reemplaza por su nombre', () => {
    expect(formatFieldValue('cat_type_status', 3245, 'ACTIVO')).toBe('ACTIVO')
  })

  it('un id que ya no existe se marca, no se inventa', () => {
    expect(formatFieldValue('cat_type_status', 3245, null)).toBe('#3245')
  })

  it('los montos salen en soles, la baja lógica y las banderas en español', () => {
    expect(formatFieldValue('discount_amount', 1930)).toBe('S/ 1,930.00')
    expect(formatFieldValue('active', 'N')).toBe('Anulado')
    expect(formatFieldValue('requires_email_cc', 'Y')).toBe('Sí')
  })

  // Regresión: construir un Date desde 'YYYY-MM-DD' lo lee en UTC y en Lima
  // muestra el día anterior.
  it('la fecha no se corre un día', () => {
    expect(formatFieldValue('payment_date', '2026-09-03')).toBe('03/09/2026')
    expect(formatFieldValue('updated_at', '2026-09-03T08:15:00.000Z')).toBe('03/09/2026 08:15')
  })

  it('un campo vacío es null y lo rotula la vista', () => {
    expect(formatFieldValue('notes', null)).toBeNull()
    expect(formatFieldValue('event_seat', '')).toBeNull()
  })
})
