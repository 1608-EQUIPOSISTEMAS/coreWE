import { listPagos, listAdicionales } from './ingresos-operativos.repository.js'
import { parsePeriodo, toDetalles, toDetalleAdicional, buildResumen, TIPO_CAMBIO_DEFAULT } from './ingresos-operativos.entity.js'

// Detalle de pagos del rango + resumen sin filtrar. Los filtros por encabezado
// se aplican en el navegador y ahi se recalcula el resumen con lo filtrado.
// Junta los pagos de inscripciones con los de FICO > Pagos Adicionales.
export async function ingresosOperativos ({ desde, hasta, tipo_cambio: tipoCambio = TIPO_CAMBIO_DEFAULT }) {
  const periodo = parsePeriodo({ desde, hasta })
  const [pagos, adicionales] = await Promise.all([
    listPagos(periodo.inicio, periodo.fin),
    listAdicionales(periodo.inicio, periodo.fin)
  ])
  const detalle = [...pagos.flatMap(toDetalles), ...adicionales.map(toDetalleAdicional)]
    .sort((a, b) => a.fechaPago.localeCompare(b.fechaPago))
  return {
    periodo: { desde: periodo.desde, hasta: periodo.hasta },
    resumen: buildResumen(detalle, tipoCambio),
    detalle
  }
}
