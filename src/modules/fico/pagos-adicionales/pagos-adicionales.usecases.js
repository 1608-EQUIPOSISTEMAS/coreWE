import { NotFoundError } from '../../../shared/errors.js'
import { listPagos, getPago, getCuenta, insertPago, updatePago, anularPago } from './pagos-adicionales.repository.js'
import { parsePeriodo, buildPago, toFila } from './pagos-adicionales.entity.js'

// Pagos del rango; los filtros por encabezado se aplican en el navegador.
export async function consultar ({ desde, hasta }) {
  const periodo = parsePeriodo({ desde, hasta })
  const filas = (await listPagos(periodo.inicio, periodo.fin)).map(toFila)
  return { periodo: { desde: periodo.desde, hasta: periodo.hasta }, filas }
}

export async function detalle (id) {
  const pago = await getPago(id)
  if (!pago) throw new NotFoundError('El pago adicional no existe o fue anulado')
  return toFila(pago)
}

async function validar (input) {
  const cuenta = input.bank_account_id ? await getCuenta(input.bank_account_id) : null
  return buildPago(input, { cuenta })
}

export async function registrar (input, userId) {
  const id = await insertPago(await validar(input), userId)
  return toFila(await getPago(id))
}

export async function editar (id, input, userId) {
  const pago = await validar(input)
  if (!await updatePago(id, pago, userId)) throw new NotFoundError('El pago adicional no existe o fue anulado')
  return toFila(await getPago(id))
}

export async function anular (id, userId) {
  if (!await anularPago(id, userId)) throw new NotFoundError('El pago adicional no existe o ya fue anulado')
  return { id }
}
