// Verifica que el destino de un Cambio de Curso entra a las TRES hojas de venta
// ('0. Ventas Sistemas', '2. Consolidado', '3. Cuotas') gracias a
// PARENT_OR_CC_DESTINATION, y que las hijas de paquete siguen fuera.
// Ejecuta las queries reales del repositorio contra la BD (tarda unos minutos:
// getFicoSales arrastra la CTE `hist` sobre `consolidated`).
//
//   node scripts/check-sync-destino-cc.mjs
import fs from 'node:fs'
import assert from 'node:assert/strict'

const envTxt = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const u = new URL(envTxt.match(/^DATABASE_URL=(.+)$/m)[1].trim())
u.hostname = '127.0.0.1'; u.port = '55432'; u.search = ''
process.env.DATABASE_URL = u.toString()
process.env.DATABASE_SSL = 'false'

const { pool } = await import('../src/config/db.js')
const { integrationRepository: repo } = await import('../src/modules/integration/integration.repository.js')

const DESTINO_COD = 'BI-EO-04' // 14709, destino del CC de CARLOTA AZUCENA
const ORIGEN_COD = 'BI-CO-01' // 14596, origen marcado CC
const ALUMNA = 'CARLOTA AZUCENA'
let fallos = 0

const revisa = async (hoja, getter) => {
  const t0 = Date.now()
  const rows = await getter()
  const suyas = rows.filter(r => (r.nombres || '').includes(ALUMNA))
  const destino = suyas.find(r => r.cod === DESTINO_COD)
  const origen = suyas.find(r => r.cod === ORIGEN_COD)
  console.log(`\n=== ${hoja} === (${rows.length} filas, ${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  console.table(suyas.map(r => ({ cod: r.cod, ed: r.ed, nombres: r.nombres, correo: r.correo })))
  try {
    assert.ok(destino, `el destino del CC (${DESTINO_COD}) NO aparece en ${hoja}`)
    assert.equal(destino.ed, 'E0', `el destino sin edicion debe salir como E0 en ${hoja}`)
    assert.ok(origen, `el origen del CC (${ORIGEN_COD}) desaparecio de ${hoja}`)
    console.log(`OK: destino presente (ED=E0) y origen presente en ${hoja}`)
  } catch (e) { console.error('FALLA: ' + e.message); fallos++ }
  return rows
}

try {
  await revisa("'2. Consolidado'", () => repo.getFicoConsolidado())

  // '3. Cuotas' filtra `c_plan.alias = 'we_payment_way_installments'`: solo
  // ventas en cuotas. 14709 es Al contado, asi que NO debe salir ahi (no es el
  // filtro de padre). La sonda valida es 13122, destino de CC con plan Cuotas.
  const cuotas = await repo.getFicoCuotas()
  const enCuotas = cuotas.some(r => r.enrollment_id === 13122)
  const contadoFuera = !cuotas.some(r => r.enrollment_id === 14709)
  console.log(`\n=== '3. Cuotas' === (${cuotas.length} filas)`)
  console.log('destino CC con plan Cuotas (13122) presente:', enCuotas)
  console.log('destino CC Al contado (14709) correctamente ausente:', contadoFuera)
  try {
    assert.ok(enCuotas, 'el destino de CC en cuotas (13122) NO aparece en 3. Cuotas')
    assert.ok(contadoFuera, '14709 es Al contado y no deberia estar en 3. Cuotas')
    console.log("OK: '3. Cuotas' admite destinos de CC en cuotas y sigue excluyendo los de contado")
  } catch (e) { console.error('FALLA: ' + e.message); fallos++ }

  await revisa("'0. Ventas Sistemas'", () => repo.getFicoSales())

  // Control comun: el predicado sigue dejando fuera a las hijas de paquete.
  const { rows: ctrl } = await pool.query(`
    select count(*) filter (where not exists (select 1 from course_changes cc
             where cc.enrollment_destination_id=e.enrollment_id and cc.active='Y')) hijas_de_paquete_fuera,
           count(*) filter (where exists (select 1 from course_changes cc
             where cc.enrollment_destination_id=e.enrollment_id and cc.active='Y')) destinos_cc_admitidos
      from enrollments e join catalog cf on cf.catalog_id=e.cat_fico_status
     where cf.alias='we_enrollment_status_checked' and e.active='Y' and e.parent_enrollment_id is not null`)
  console.log('\ncontrol del predicado:', ctrl[0])
  assert.ok(Number(ctrl[0].hijas_de_paquete_fuera) > 0, 'el control de hijas de paquete no midio nada')

  console.log(fallos === 0 ? '\nTODO OK' : `\nFALLARON ${fallos} verificaciones`)
  if (fallos) process.exitCode = 1
} catch (e) {
  console.error('\n!!! ERROR:', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
