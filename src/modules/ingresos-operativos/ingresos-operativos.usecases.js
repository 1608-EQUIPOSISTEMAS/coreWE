import { listPagos } from './ingresos-operativos.repository.js'
import { parsePeriodo, toDetalle, buildResumen, TIPO_CAMBIO_DEFAULT } from './ingresos-operativos.entity.js'

// Detalle de pagos del rango + resumen sin filtrar. Los filtros por encabezado
// se aplican en el navegador y ahi se recalcula el resumen con lo filtrado.
export async function ingresosOperativos ({ desde, hasta, tipo_cambio: tipoCambio = TIPO_CAMBIO_DEFAULT }) {
  const periodo = parsePeriodo({ desde, hasta })
  const detalle = (await listPagos(periodo.inicio, periodo.fin)).map(toDetalle)
  return {
    periodo: { desde: periodo.desde, hasta: periodo.hasta },
    resumen: buildResumen(detalle, tipoCambio),
    detalle
  }
}
