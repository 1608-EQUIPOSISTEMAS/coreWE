import { describe, it, expect } from 'vitest'
import {
  buildTempPassword,
  buildFullName,
  normalizeActive,
  normalizeActiveForCaller,
  normalizePhotoUrl
} from '../instructor.entity.js'

describe('buildTempPassword', () => {
  it('usa el documento del instructor', () => {
    expect(buildTempPassword('12345678')).toBe('12345678@We2026!')
  })
  it('cae a "doc" si no hay documento', () => {
    expect(buildTempPassword(null)).toBe('doc@We2026!')
    expect(buildTempPassword(undefined)).toBe('doc@We2026!')
  })
})

describe('buildFullName', () => {
  it('une los componentes presentes', () => {
    expect(buildFullName({ first_name: 'Ana', last_name: 'Diaz', mother_last_name: 'Ruiz' })).toBe('Ana Diaz Ruiz')
  })
  it('omite vacios y nulos', () => {
    expect(buildFullName({ first_name: 'Ana', last_name: null, mother_last_name: '' })).toBe('Ana')
    expect(buildFullName({})).toBe('')
  })
})

describe('normalizeActive (listado)', () => {
  it('mapea booleanos a Y/N', () => {
    expect(normalizeActive(true)).toBe('Y')
    expect(normalizeActive(false)).toBe('N')
  })
  it('deja pasar strings tal cual y null en el resto', () => {
    expect(normalizeActive('Y')).toBe('Y')
    expect(normalizeActive('')).toBe('')
    expect(normalizeActive(null)).toBeNull()
    expect(normalizeActive(undefined)).toBeNull()
  })
})

describe('normalizeActiveForCaller', () => {
  it('por defecto filtra activos', () => {
    expect(normalizeActiveForCaller()).toBe('Y')
  })
  it('trata el string vacio como sin filtro', () => {
    expect(normalizeActiveForCaller('')).toBeNull()
  })
  it('mapea booleanos y respeta strings', () => {
    expect(normalizeActiveForCaller(true)).toBe('Y')
    expect(normalizeActiveForCaller(false)).toBe('N')
    expect(normalizeActiveForCaller('N')).toBe('N')
  })
})

describe('normalizePhotoUrl', () => {
  const thumb = 'https://drive.google.com/thumbnail?id=1BB9ejpeZLVoHyq29xF7KPnk-RaDTwC62&sz=w400'

  it('convierte el link de "Copiar vinculo" de Drive en un thumbnail usable', () => {
    expect(normalizePhotoUrl('https://drive.google.com/file/d/1BB9ejpeZLVoHyq29xF7KPnk-RaDTwC62/view?usp=sharing')).toBe(thumb)
    expect(normalizePhotoUrl('https://drive.google.com/open?id=1BB9ejpeZLVoHyq29xF7KPnk-RaDTwC62')).toBe(thumb)
    expect(normalizePhotoUrl('https://drive.google.com/uc?export=view&id=1BB9ejpeZLVoHyq29xF7KPnk-RaDTwC62')).toBe(thumb)
  })

  it('es idempotente sobre un thumbnail ya normalizado', () => {
    expect(normalizePhotoUrl(thumb)).toBe(thumb)
  })

  it('deja intacta cualquier URL que no sea de Drive', () => {
    const propia = 'https://we-educacion-ejecutiva.site/uploads/1783353380218_foto.png'
    expect(normalizePhotoUrl(propia)).toBe(propia)
    expect(normalizePhotoUrl('  ' + propia + '  ')).toBe(propia)
  })

  it('trata el vacio como "sin foto" para que el SP la borre', () => {
    expect(normalizePhotoUrl('')).toBeNull()
    expect(normalizePhotoUrl('   ')).toBeNull()
    expect(normalizePhotoUrl(null)).toBeNull()
    expect(normalizePhotoUrl(undefined)).toBeNull()
  })
})
