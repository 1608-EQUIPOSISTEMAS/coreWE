import { ingresosB2C, totalB2C } from './marketing.repository.js'

const GRUPOS_ORDEN = ['En Vivo', 'Online', 'Membresías']

// POST /marketing/ingresos-b2c { month: 'YYYY-MM' }
export async function ingresosB2CHandler (req, reply) {
  const month = /^\d{4}-\d{2}$/.test(req.body?.month || '') ? req.body.month : null
  if (!month) return reply.code(400).send({ ok: false, error: 'month requerido (YYYY-MM)' })

  const monthStart = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const prevStart = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-01`

  const [rows, prev] = await Promise.all([ingresosB2C(monthStart), totalB2C(prevStart)])

  const grupos = GRUPOS_ORDEN
    .map(name => {
      const items = {}
      rows.filter(r => r.grupo === name).forEach(r => {
        const it = items[r.rubro] || (items[r.rubro] = { name: r.rubro, ingresos: 0, ventas: 0 })
        it.ingresos += Number(r.ingresos)
        it.ventas += r.ventas
      })
      return { name, items: Object.values(items).sort((a, b) => b.ingresos - a.ingresos) }
    })
    .filter(g => g.items.length > 0)

  const weekly = [1, 2, 3, 4, 5].map(s => ({
    week: 'S' + s,
    ingresos: rows.filter(r => r.semana === s).reduce((a, r) => a + Number(r.ingresos), 0)
  }))
  while (weekly.length > 4 && weekly[weekly.length - 1].ingresos === 0) weekly.pop()

  const ingresos = rows.reduce((a, r) => a + Number(r.ingresos), 0)
  const ventas = rows.reduce((a, r) => a + r.ventas, 0)

  return reply.send({
    ok: true,
    data: {
      month,
      totals: { ingresos, ventas },
      prev: { ingresos: Number(prev.ingresos), ventas: prev.ventas },
      weekly,
      grupos
    }
  })
}
