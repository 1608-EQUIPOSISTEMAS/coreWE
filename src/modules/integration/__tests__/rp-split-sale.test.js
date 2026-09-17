import { describe, it, expect } from 'vitest'
import {
  RP_LINK_SQL,
  EXCLUDE_RP_ORIGIN,
  RP_ORIGIN_JOIN,
  integrationRepository
} from '../integration.repository.js'

// Mismo truco que held-enrollments.test.js: el SQL no se puede correr sin BD,
// pero si leer, pasandole un `db` falso que solo guarda la query.
const captureSql = (metodo) => {
  let sql = ''
  const repo = Object.create(Object.getPrototypeOf(integrationRepository))
  Object.assign(repo, integrationRepository)
  repo.db = { query: (text) => { sql = text; return { rows: [] } } }
  repo[metodo]()
  return sql
}

// Una Reprogramacion parte la venta en dos inscripciones: el origen se queda con
// lo cobrado y el destino nace pago-cero con las cuotas pendientes. Sin estas
// reglas la hoja publica media venta dos veces -- la venta de 250 de #18939
// salia como una fila de 100 y otra de 150, y el destino (total_amount = 0)
// caia en la rama de BECA del Consolidado.
describe('venta partida por reprogramacion (RP)', () => {
  // Las tres fuentes del vinculo origen->destino. Ninguna cubre sola las 112 RP
  // de produccion (82 / 79 / 66 origenes); quitar una deja RP sin colapsar y
  // ningun otro test se entera.
  describe('RP_LINK_SQL', () => {
    it('une las tres fuentes del vinculo', () => {
      expect(RP_LINK_SQL).toContain("a.action = 'edition_reprogrammed'")
      expect(RP_LINK_SQL).toContain("a.action = 'created_from_rp'")
      expect(RP_LINK_SQL).toContain("d.notes LIKE 'Reprogramacion desde inscripcion #%'")
    })

    it('lee el ancla numerica del origen y la textual del destino', () => {
      expect(RP_LINK_SQL).toContain("changes->>'new_enrollment_id'")
      expect(RP_LINK_SQL).toContain("changes->'Enrollment origen'->>'new'")
    })

    // Sin el guarda de digitos, un `changes` con texto revienta el ::int.
    it('no castea a int lo que no sea un numero', () => {
      expect(RP_LINK_SQL).toContain("~ '^[0-9]+$'")
    })
  })

  describe('EXCLUDE_RP_ORIGIN', () => {
    it('excluye al origen que tiene destino, no a cualquier RP', () => {
      expect(EXCLUDE_RP_ORIGIN).toContain('NOT EXISTS')
      expect(EXCLUDE_RP_ORIGIN).toContain('rp_link.origen_id = e.enrollment_id')
    })
  })

  describe('RP_ORIGIN_JOIN', () => {
    it('resuelve el origen desde el destino y trae su precio', () => {
      expect(RP_ORIGIN_JOIN).toContain('rp_link.destino_id = e.enrollment_id')
      expect(RP_ORIGIN_JOIN).toContain('o.total_amount')
      expect(RP_ORIGIN_JOIN).toContain('o.list_price')
    })

    // Un origen con dos destinos (doble submit: 3585 y 14884 en produccion)
    // devolveria dos filas y multiplicaria la fila de la hoja.
    it('nunca devuelve mas de un origen', () => {
      expect(RP_ORIGIN_JOIN).toContain('LIMIT 1')
    })
  })

  // SOLO "7. Convenios". El flujo RP es correcto como esta y las demas hojas
  // deben seguir viendo las dos inscripciones por separado: es B2B quien mira la
  // venta del convenio como un todo, y por eso solo esa hoja la colapsa.
  const HOJAS_MIGRADAS = ['getFicoConvenios']

  describe.each(HOJAS_MIGRADAS)('%s', (hoja) => {
    it('no publica el origen de la RP como fila aparte', () => {
      expect(captureSql(hoja)).toContain('rp_link.origen_id = e.enrollment_id')
    })

    // Lo que hace que MONTO diga 250 y no 100: las cuotas de la venta estan
    // repartidas entre origen y destino, asi que hay que sumar la familia.
    it('suma cuotas y cobros sobre la familia RP, no sobre una fila', () => {
      const sql = captureSql(hoja)
      const familia = 'pi.enrollment_id IN (e.enrollment_id, COALESCE(rp_origen.enrollment_id, e.enrollment_id))'
      expect(sql).toContain(familia)
      expect(sql).not.toContain('WHERE pi.enrollment_id = e.enrollment_id')
    })

    // El lead se queda en el origen: sin heredarlo la fila del destino salia
    // sin FECHA y sin EMPRESA (#18956 perdia "DINET").
    it('hereda el lead del origen para FECHA y EMPRESA', () => {
      expect(captureSql(hoja)).toContain(
        'l.enrollment_id = COALESCE(rp_origen.enrollment_id, e.enrollment_id)'
      )
    })
  })
})
