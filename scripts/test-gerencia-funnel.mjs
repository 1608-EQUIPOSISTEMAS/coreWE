// Check del reporte de Gerencia. Dos partes:
//   1. asserts puros sobre el mapper/DTO (sin BD)
//   2. sanity contra la BD real, si el tunel esta arriba
// Correr: node scripts/test-gerencia-funnel.mjs
import assert from 'node:assert/strict'
import { toGerenciaFunnelDto } from '../src/modules/dashboard/dashboard.dto.js'

// ── 1. Logica pura ────────────────────────────────────────────────────────────
const fila = (over = {}) => ({
  edition_num_id: 1, categoria: 'A', linea: 'BI', programa: 'POWER BI', tipo: 'CURSO',
  fecha_inicio: '2026-05-02', codigo_edicion: 'E8-26',
  meta_consultas: 63, meta_ventas: 13, meta_monto: 0,
  consultas: 79, ventas: 12, venta_monto: 1000, ventas_trazadas: 10,
  canales: { MARKETING_NUEVO: { consultas: 63, ventas: 7 }, WEB_NUEVO: { consultas: 16, ventas: 5 } },
  metas_canal: { MARKETING_NUEVO: { consultas: 42, ventas: 7 } },
  ...over
})

{
  const { items, canales, totales } = toGerenciaFunnelDto([fila()])
  const it = items[0]

  assert.equal(it.conversion_pct, 15.2, 'conversion = ventas/consultas en %')
  assert.equal(it.ventas - it.ventas_trazadas, 2, 'ventas sin canal conocido')

  // Cruce real x meta por celda: WEB_NUEVO tiene real sin meta, y se conserva.
  const web = it.canales.find(c => c.key === 'WEB_NUEVO')
  assert.equal(web.consultas, 16)
  assert.equal(web.meta_consultas, 0, 'canal sin meta cargada llega en cero')
  const mkt = it.canales.find(c => c.key === 'MARKETING_NUEVO')
  assert.equal(mkt.meta_consultas, 42)

  // Celdas vacias de punta a punta no viajan al front.
  assert.equal(it.canales.length, 2, 'solo canales con dato o meta')
  assert.equal(it.canales.some(c => c.key === 'COMERCIAL_LEAD'), false)

  // El orden es el del reporte (MARKETING antes que WEB), no alfabetico.
  assert.deepEqual(it.canales.map(c => c.key), ['MARKETING_NUEVO', 'WEB_NUEVO'])

  assert.equal(canales.length, 2)
  assert.equal(totales.consultas, 79)
  assert.equal(totales.conversion_pct, 15.2)
}

{
  // Agregacion cross-edicion: mismo canal en dos ediciones se suma una sola vez.
  const { canales, totales } = toGerenciaFunnelDto([fila(), fila({ edition_num_id: 2 })])
  const mkt = canales.find(c => c.key === 'MARKETING_NUEVO')
  assert.equal(mkt.consultas, 126)
  assert.equal(mkt.meta_consultas, 84)
  assert.equal(mkt.conversion_pct, 11.1)
  assert.equal(totales.ediciones, 2)
  assert.equal(totales.ventas, 24)
}

{
  // Division por cero: sin consultas la conversion es null, no 0 ni NaN.
  const { items, totales } = toGerenciaFunnelDto([fila({ consultas: 0, ventas: 0, canales: {}, metas_canal: {} })])
  assert.equal(items[0].conversion_pct, null)
  assert.equal(totales.conversion_pct, null)
}

{
  // jsonb que llega como string (segun driver) se parsea igual.
  const { items } = toGerenciaFunnelDto([fila({ canales: '{"WEB_LEAD":{"consultas":4,"ventas":1}}', metas_canal: '{}' })])
  assert.equal(items[0].canales[0].key, 'WEB_LEAD')
}

console.log('OK: 5 bloques de asserts del DTO')

// ── 2. Sanity contra la BD ────────────────────────────────────────────────────
try {
  const { q, pool } = await import('./db.mjs')
  const { rows } = await q('SELECT * FROM v_gerencia_funnel WHERE anio = 2026 AND mes_num = 5')
  const dto = toGerenciaFunnelDto(rows)
  console.log('mayo-2026:', {
    ediciones: dto.totales.ediciones,
    consultas: dto.totales.consultas,
    ventas: dto.totales.ventas,
    conversion: dto.totales.conversion_pct + '%',
    sin_canal: dto.totales.ventas - dto.totales.ventas_trazadas
  })
  console.log('matriz de canales:')
  for (const c of dto.canales.sort((a, b) => b.consultas - a.consultas)) {
    console.log(`  ${c.key.padEnd(22)} cons ${String(c.consultas).padStart(5)}  vtas ${String(c.ventas).padStart(4)}  conv ${c.conversion_pct}%`)
  }
  await pool.end()
} catch (e) {
  console.log('(sin BD: ' + e.message + ')')
}
