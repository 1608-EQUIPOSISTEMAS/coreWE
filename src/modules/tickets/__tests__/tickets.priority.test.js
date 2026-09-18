import { describe, it, expect } from 'vitest'
import { clasificarPrioridad, parsearCriterios } from '../tickets.priority.js'

// Portado de prioridad.test.ts. La mayoria corre contra el markdown real
// (criterios-prioridad.md), que es el que va a produccion; los casos de parseo
// usan markdown a mano para no depender de su contenido.

describe('clasificarPrioridad con los criterios reales', () => {
  it('una falla concreta del ERP es ALTA', () => {
    expect(clasificarPrioridad('Matrícula no se registró', 'La inscripción del alumno no quedó guardada en el sistema'))
      .toBe('ALTA')
  })

  it('ignora tildes y mayusculas', () => {
    const conTildes = clasificarPrioridad('Matrícula NO se registró', 'El ERP no guardó la inscripción')
    const sinTildes = clasificarPrioridad('matricula no se registro', 'el erp no guardo la inscripcion')
    expect(conTildes).toBe(sinTildes)
  })

  it('una instalacion o mejora es BAJA', () => {
    expect(clasificarPrioridad('Instalar Office', 'Necesito que me instalen Office en la laptop nueva por favor'))
      .toBe('BAJA')
  })

  it('sin texto cae a MEDIA', () => {
    expect(clasificarPrioridad('', '')).toBe('MEDIA')
    expect(clasificarPrioridad(null, undefined)).toBe('MEDIA')
  })

  it('sin ninguna coincidencia cae a MEDIA', () => {
    expect(clasificarPrioridad('xyzzy', 'plugh qwerty fnord zzzz')).toBe('MEDIA')
  })

  it('nunca lanza: crear un ticket no puede trabarse por la clasificacion', () => {
    expect(() => clasificarPrioridad('()[]{}*+?', '\\^$|.....')).not.toThrow()
  })
})

describe('clasificarPrioridad con criterios controlados', () => {
  const criterios = parsearCriterios(`
## ALTA
### Palabras clave
- erp
- no se registro
## MEDIA
### Palabras clave
- correo
## BAJA
### Palabras clave
- instalar
- solicito instalacion de programa
`)

  it('la regla dominante: una falla concreta de ALTA gana aunque BAJA sume mas', () => {
    // "solicito instalacion de programa" (4 puntos) contra "no se registro" (3).
    const texto = 'solicito instalacion de programa porque no se registro'
    expect(clasificarPrioridad(texto, '', criterios)).toBe('ALTA')
  })

  it('una sola palabra de ALTA no dispara la regla dominante', () => {
    // "erp" pesa 1: nombrar el sistema no es describir una falla.
    expect(clasificarPrioridad('erp', 'solicito instalacion de programa', criterios)).toBe('BAJA')
  })

  it('empate de puntaje cae a MEDIA', () => {
    // "correo" (1) contra "instalar" (1).
    expect(clasificarPrioridad('correo instalar', '', criterios)).toBe('MEDIA')
  })

  it('el sufijo libre encuentra plurales y conjugaciones', () => {
    // La frase es prefijo de la palabra: "instalar" encuentra "instalarlo".
    expect(clasificarPrioridad('instalarlo', '', criterios)).toBe('BAJA')
    expect(clasificarPrioridad('correos', '', criterios)).toBe('MEDIA')
  })

  it('exige limite de palabra al inicio: no matchea a mitad de otra palabra', () => {
    expect(clasificarPrioridad('reinstalar', '', criterios)).toBe('MEDIA')
    // "instalaciones" no empieza por "instalar", asi que tampoco cuenta.
    expect(clasificarPrioridad('instalaciones', '', criterios)).toBe('MEDIA')
  })
})

describe('parsearCriterios', () => {
  it('solo lee los items del bloque "Palabras clave"', () => {
    const c = parsearCriterios(`
## ALTA
Esto es prosa para las personas y no se interpreta.
- este item esta fuera del bloque
### Ejemplos
- tampoco este
### Palabras clave
- si este
`)
    expect(c.get('ALTA').map(p => p.frase)).toEqual(['si este'])
  })

  it('un "##" que no sea prioridad cierra la seccion', () => {
    const c = parsearCriterios(`
## ALTA
### Palabras clave
- uno
## Cuando hay duda
### Palabras clave
- no cuenta
`)
    expect(c.get('ALTA').map(p => p.frase)).toEqual(['uno'])
  })

  it('el peso es la cantidad de palabras de la frase', () => {
    const c = parsearCriterios('## ALTA\n### Palabras clave\n- no se registro\n- erp\n')
    expect(c.get('ALTA').map(p => p.peso)).toEqual([3, 1])
  })

  it('ignora lo que venga despues del nombre de la prioridad', () => {
    const c = parsearCriterios('## ALTA (urgente)\n### Palabras clave\n- uno\n')
    expect(c.get('ALTA')).toHaveLength(1)
  })

  it('markdown vacio devuelve las tres secciones vacias', () => {
    const c = parsearCriterios('')
    expect([...c.keys()]).toEqual(['ALTA', 'MEDIA', 'BAJA'])
    expect([...c.values()].every(v => v.length === 0)).toBe(true)
  })
})
