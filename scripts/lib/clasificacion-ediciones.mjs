// Regla de negocio de Planeamiento para partir las ediciones en apertura vs
// seguimiento y en temporalidad alta vs normal. Vive aparte porque la comparten
// el calculo desde las fuentes crudas y el recalculo desde el detalle: cuando
// estaba duplicada, cambiar el criterio en un lado dejaba el otro mintiendo.
import assert from 'node:assert/strict'

export const MESES_ALTOS = new Set([1, 2, 3, 7])
export const MES_FINAL = 8
export const MESES_DEL_ERP = new Set([6, 7, 8])

// Un arrastre de uno o dos alumnos no convierte una apertura en seguimiento:
// SAP HANA IN E7-26 vendio 26 con UN alumno de seguimiento, y esa fila entera
// se iba al promedio equivocado. Debajo de este minimo, la edicion es apertura.
const SEGUIMIENTO_MINIMO = 3

export const mesDe = fila => Number(fila.inicio.slice(5, 7))
export const temporalidad = fila => (MESES_ALTOS.has(mesDe(fila)) ? 'ALTA' : 'NORMAL')

export const normalizar = nombre => nombre.replace(/\s+/g, ' ').trim().toUpperCase()

/**
 * Un PAQUETE (diploma, especializacion, PEE) SIEMPRE cuenta como apertura: es
 * donde NACE la venta, y el seguimiento lo reciben sus modulos, no el.
 *
 * No es una excepcion de conveniencia, esta auditado: de los 23 alumnos que la
 * cascada de canales le puso en SEGUI a un paquete en 2026, los 23 son destino
 * de una REPROGRAMACION o de un CAMBIO DE CURSO (ver el script
 * auditar-seguimiento-en-paquetes.mjs). Ya habian comprado —por eso su total es
 * S/0, el dinero quedo en el origen— y solo se movieron de fecha o de programa.
 * ESPEC. EXCEL E3-26 arrastra los cuatro que la volvian "seguimiento": #11133,
 * #11137, #11141 y #11145, reprogramados en bloque el mismo dia. Sin esto, sus
 * 19 ventas de apertura se iban enteras al promedio equivocado.
 *
 * Que es un paquete lo dice la BD (programas-paquete-produccion.mjs), no el
 * prefijo del nombre: startsWith('DIP') dejaba fuera a los PEE, que tambien lo
 * son, y colaria cualquier curso suelto bautizado "ESP. algo".
 */
export function crearClasificador (nombresDePaquete) {
  const paquetes = new Set(nombresDePaquete.map(normalizar))
  const esPaquete = fila => paquetes.has(normalizar(fila.curso))
  return fila => (!esPaquete(fila) && fila.segui >= SEGUIMIENTO_MINIMO ? 'SEGUIMIENTO' : 'APERTURA')
}

// Autocomprobacion: barata y corre al importar, porque una clasificacion mal
// puesta no rompe nada — solo devuelve un promedio creible y equivocado.
{
  const clasificar = crearClasificador(['ESPEC. EXCEL'])
  assert.equal(clasificar({ curso: 'ESPEC.  EXCEL', segui: 4 }), 'APERTURA', 'un paquete nunca es seguimiento')
  assert.equal(clasificar({ curso: 'SAP HANA IN', segui: 2 }), 'APERTURA', 'con 1 o 2 arrastrados sigue siendo apertura')
  assert.equal(clasificar({ curso: 'SAP HANA IN', segui: 3 }), 'SEGUIMIENTO', 'desde 3 si es seguimiento')
  assert.equal(temporalidad({ inicio: '2026-07-15' }), 'ALTA', 'julio es mes alto')
  assert.equal(temporalidad({ inicio: '2026-06-15' }), 'NORMAL', 'junio no lo es')
}
