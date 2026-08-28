import { describe, it, expect } from 'vitest'
import {
  HELD_ENROLLMENT_IDS,
  EXCLUDE_HELD,
  EXCLUDE_UNCOLLECTED_SERVICE_ORDER,
  EXCLUDE_UNCOLLECTED
} from '../integration.repository.js'
import { ALIAS } from '../../../utils/catalog-aliases.js'

// Las ordenes de pago del flujo antiguo no deben llegar a las hojas hasta que
// el alumno pague. Si el predicado deja de nombrar un id o la lista se vacia
// generando SQL invalido, estas ventas sin cobrar aparecerian en el Sheet.
describe('EXCLUDE_HELD', () => {
  it('nombra a cada inscripcion retenida y tambien a sus hijas', () => {
    for (const id of HELD_ENROLLMENT_IDS) expect(EXCLUDE_HELD).toContain(String(id))
    expect(EXCLUDE_HELD).toContain('e.enrollment_id NOT IN')
    expect(EXCLUDE_HELD).toContain('COALESCE(e.parent_enrollment_id, 0) NOT IN')
  })

  it('nunca produce un NOT IN () vacio', () => {
    expect(EXCLUDE_HELD).not.toContain('IN ()')
  })
})

// Una OS/OP se aprueba sin cobrar porque la empresa deposita semanas despues.
// Mientras no exista el pago no hay ingreso, y sumarla en el Sheet infla las
// ventas del mes con plata que todavia no entro.
describe('EXCLUDE_UNCOLLECTED_SERVICE_ORDER', () => {
  it('reconoce la orden por los alias canonicos del catalogo', () => {
    // Escribir el alias a mano ya fallo una vez ('..._payment_order' no existe)
    // y el filtro dejaba pasar todas las ordenes de compra sin avisar.
    expect(EXCLUDE_UNCOLLECTED_SERVICE_ORDER).toContain(ALIAS.B2B_DOCTYPE_SERVICE_ORDER)
    expect(EXCLUDE_UNCOLLECTED_SERVICE_ORDER).toContain(ALIAS.B2B_DOCTYPE_PURCHASE_ORDER)
  })

  it('frena por la ausencia de pago, no por el estado de liquidacion ni el de la cuota', () => {
    // Los 6167 pagos activos de produccion dicen "pendiente de liquidacion" y la
    // cuota queda `we_inst_paid` tanto si se cobro como si no: colgarse de
    // cualquiera de los dos deja pasar la venta sin cobrar.
    expect(EXCLUDE_UNCOLLECTED_SERVICE_ORDER).toContain("py.active = 'Y'")
    expect(EXCLUDE_UNCOLLECTED_SERVICE_ORDER).not.toContain('cat_settlement_status')
    expect(EXCLUDE_UNCOLLECTED_SERVICE_ORDER).not.toContain('cat_status')
  })

  it('deja pasar las ventas documentales de total 0', () => {
    // Cartas de compromiso y OC de convenio no tienen nada que cobrar: sin este
    // guard desaparecerian de las hojas 20 alumnos sin ingreso pendiente detras.
    expect(EXCLUDE_UNCOLLECTED_SERVICE_ORDER).toContain('os.total_amount > 0')
  })

  it('cubre a las hijas de paquete mirando al padre', () => {
    expect(EXCLUDE_UNCOLLECTED_SERVICE_ORDER)
      .toContain('COALESCE(e.parent_enrollment_id, e.enrollment_id)')
  })
})

// Las 7 CTEs `approved` interpolan EXCLUDE_UNCOLLECTED: si dejara de sumar una
// de las dos partes, media condicion se perderia en silencio.
describe('EXCLUDE_UNCOLLECTED', () => {
  it('combina la lista manual con la regla automatica', () => {
    expect(EXCLUDE_UNCOLLECTED).toContain('e.enrollment_id NOT IN')
    expect(EXCLUDE_UNCOLLECTED).toContain(ALIAS.B2B_DOCTYPE_SERVICE_ORDER)
  })
})
