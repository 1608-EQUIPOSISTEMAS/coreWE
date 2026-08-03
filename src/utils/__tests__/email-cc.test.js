import { describe, it, expect } from 'vitest'
import { resolveCc } from '../email-cc.js'

describe('resolveCc', () => {
  it('usa el email_cc del enrollment cuando el caller no manda nada', () => {
    expect(resolveCc(undefined, 'jefe@we-educacion.com')).toEqual(['jefe@we-educacion.com'])
    // El bug: cc:'' no debe borrar el CC guardado.
    expect(resolveCc('', 'jefe@we-educacion.com')).toEqual(['jefe@we-educacion.com'])
    expect(resolveCc([], 'a@b.com; c@d.com')).toEqual(['a@b.com', 'c@d.com'])
  })

  it('el explicito gana cuando trae emails validos', () => {
    expect(resolveCc('otro@x.com', 'jefe@we-educacion.com')).toEqual(['otro@x.com'])
  })

  it('sin nada devuelve lista vacia', () => {
    expect(resolveCc(null, null)).toEqual([])
  })
})
