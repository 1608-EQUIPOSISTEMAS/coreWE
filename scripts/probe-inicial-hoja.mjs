// Ground truth: corre el SQL REAL de "0. Ventas Sistemas" y cuenta cuantas filas
// que hoy llegan al Sheet declaran una INICIAL mayor que su INGRESO. Cada una es
// plata que la hoja da por cobrada sin que exista la cuota pagada detras.
import 'dotenv/config'
import { integrationRepository } from '../src/modules/integration/integration.repository.js'

const num = (s) => Number(String(s ?? '0').replace(',', '.')) || 0

const rows = await integrationRepository.getFicoSales()
const infla = rows.filter(r => num(r.inicial) > num(r.ingreso))
const soles = infla.reduce((a, r) => a + num(r.inicial) - num(r.ingreso), 0)

console.log('filas en la hoja       :', rows.length)
console.log('con INICIAL > INGRESO  :', infla.length)
console.log('soles fantasma         : S/', soles.toFixed(2))
console.table(infla.slice(0, 8).map(r => ({
  cod: r.cod, f_pago: r.f_pago, estado: r.estado,
  inicial: r.inicial, saldo: r.saldo, ingreso: r.ingreso, al_dia: r.al_dia
})))
process.exit(0)
