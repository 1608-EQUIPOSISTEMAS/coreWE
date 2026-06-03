import { describe, it, expect } from 'vitest'
import {
  CLASSROOM_CSV_HEADERS,
  groupExportOptions,
  buildClassroomCsv
} from '../classroom-export.entity.js'

// Fila plana de opciones (una por edicion) tal como la devuelve el repository.
const optionRow = (over = {}) => ({
  program_version_id: 10,
  version_code: 'PROG-A',
  abbreviation: 'PA',
  edition_num_id: 100,
  start_date: '2026-01-01',
  students_count: 3,
  ...over
})

describe('groupExportOptions', () => {
  it('agrupa ediciones bajo su version de programa', () => {
    const out = groupExportOptions([
      optionRow({ edition_num_id: 100, students_count: 3 }),
      optionRow({ edition_num_id: 101, students_count: 5 })
    ])
    expect(out).toHaveLength(1)
    expect(out[0].program_version_id).toBe(10)
    expect(out[0].version_code).toBe('PROG-A')
    expect(out[0].editions).toEqual([
      { edition_num_id: 100, start_date: '2026-01-01', students_count: 3 },
      { edition_num_id: 101, start_date: '2026-01-01', students_count: 5 }
    ])
  })

  it('separa programas distintos preservando el orden de aparicion', () => {
    const out = groupExportOptions([
      optionRow({ program_version_id: 10, version_code: 'PROG-A' }),
      optionRow({ program_version_id: 20, version_code: 'PROG-B', edition_num_id: 200 })
    ])
    expect(out.map(p => p.program_version_id)).toEqual([10, 20])
    expect(out[1].editions).toHaveLength(1)
  })

  it('devuelve lista vacia sin filas', () => {
    expect(groupExportOptions([])).toEqual([])
  })
})

describe('buildClassroomCsv', () => {
  it('antepone BOM y emite la cabecera fija con CRLF', () => {
    const csv = buildClassroomCsv([])
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    const headerLine = csv.slice(1)
    expect(headerLine).toBe(CLASSROOM_CSV_HEADERS.join(','))
  })

  it('deja N° Grp, Usuario y Contrasena en blanco para llenado manual', () => {
    const csv = buildClassroomCsv([{
      nombres_apellidos: 'Ana Perez',
      cat_prog: 'DIP-1',
      modalidad: 'FLEX',
      celular: '999',
      correo: 'a@b.com',
      ocup: 'E',
      correo_odoo: 'a@odoo.com',
      estado: 'Al dia',
      asesor: 'B2B - JF39'
    }])
    const dataLine = csv.split('\r\n')[1].split(',')
    // [Nombres, N°Grp, CatProg, Usuario, Contrasena, Modalidad, Celular, Correo, Ocup, CorreoOdoo, Estado, Asesor]
    expect(dataLine[0]).toBe('Ana Perez')
    expect(dataLine[1]).toBe('')
    expect(dataLine[2]).toBe('DIP-1')
    expect(dataLine[3]).toBe('')
    expect(dataLine[4]).toBe('')
    expect(dataLine[5]).toBe('FLEX')
    expect(dataLine[10]).toBe('Al dia')
    expect(dataLine[11]).toBe('B2B - JF39')
  })

  it('escapa valores con comas, comillas o saltos de linea (RFC 4180)', () => {
    const csv = buildClassroomCsv([{
      nombres_apellidos: 'Perez, Ana "La" \nPro',
      estado: 'Deuda 2'
    }])
    const line = csv.split('\r\n')[1]
    expect(line.startsWith('"Perez, Ana ""La"" \nPro"')).toBe(true)
  })

  it('reemplaza valores nulos/indefinidos por cadena vacia', () => {
    const csv = buildClassroomCsv([{ nombres_apellidos: null }])
    const dataLine = csv.split('\r\n')[1]
    expect(dataLine).toBe(',,,,,,,,,,,')
  })
})
