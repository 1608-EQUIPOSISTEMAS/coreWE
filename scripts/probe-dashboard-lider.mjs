// Sondeo del panel de equipo: corre el usecase real contra la BD de pruebas
// con los tres alcances (ADMIN, lider, colaborador).
import { teamSummary } from '../src/modules/dashboard/dashboard.usecases.js'

const casos = [
  ['ADMIN', { roles: ['ADMIN'], userId: 1 }],
  ['LIDER_COMERCIAL', { roles: ['LIDER_COMERCIAL'], userId: 1 }],
  ['colaborador', { roles: ['COMERCIAL'], userId: 2 }]
]

for (const [nombre, args] of casos) {
  const d = await teamSummary(args)
  console.log(`\n===== ${nombre} → ${d.scope.area} (lider: ${d.scope.isLeader}) =====`)
  console.log('equipo:', d.equipo.length, '| meses:', d.actividadMensual.length,
              '| horas:', d.actividadPorHora.length, '| tablas:', d.porTabla.length,
              '| movs:', d.movimientos.length, '| metas:', d.metas.length)
  console.table(d.equipo.slice(0, 5).map(({ name, alias, acciones, accesos, dias_activos, hora_tipica, inicio_hoy, tabla_top }) =>
    ({ name, alias, acciones, accesos, dias_activos, hora_tipica, inicio_hoy, tabla_top })))
  console.table(d.porTabla)
  if (d.metas.length) console.table(d.metas)
}
process.exit(0)
