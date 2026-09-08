// Ventas e INGRESO INICIAL por programa, para la hoja "2. Clas. prog." del
// libro "Planificacion Programacion - Consultas - Ventas".
//
// Ingreso inicial = lo que el alumno entrego AL COMPRAR: el total si pago al
// contado, o solo la reserva si pago en cuotas. Las cuotas siguientes no entran.
//
// Se toma el PRIMER pago de cada inscripcion, y NO se filtra por tipo de pago:
// el catalogo no distingue lo que su nombre promete. "Cuota Ordinaria" (3114)
// tiene 138 registros en todo el sistema, mientras que las cuotas mensuales se
// registran como "Pago Unico (Contado)" (3115) — la inscripcion 1489 tiene un
// adelanto de 150 y SEIS "pagos unicos" mensuales detras. Filtrar por tipo
// devolvia casi el total cobrado en vez del inicial.
//
// El programa se atribuye por la edicion del enrollment que TIENE el pago. En
// un paquete la venta vive en el padre, y los hijos de seguimiento no tienen
// pagos propios, asi que no hay doble conteo.
//
// Se excluye la modalidad Online: el mismo curso existe duplicado en vivo y
// online (EX-CZ-02 "EXCEL INTERM" en vivo frente a EX-CO-02 "EXCEL INTERMEDIO"
// online, la Z y la O del codigo de version), y la hoja de Planeamiento solo
// lista los en vivo y presenciales. Sin este filtro, las ventas online se
// quedaban fuera del cuadro pareciendo un fallo de emparejamiento de nombres.
import fs from 'node:fs'
import pg from 'pg'

const ANIO = Number(process.argv[2] ?? 2026)
const MES_FINAL = Number(process.argv[3] ?? 8)
const MODALIDAD_ONLINE = 2623
const INTENTOS = 3

const urlDeProduccion = () =>
  fs.readFileSync('.env.bak-produccion', 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim()

async function conectarConReintento () {
  for (let intento = 1; intento <= INTENTOS; intento++) {
    const cliente = new pg.Client({ connectionString: urlDeProduccion(), connectionTimeoutMillis: 10000 })
    try {
      await cliente.connect()
      return cliente
    } catch (error) {
      await cliente.end().catch(() => {})
      if (intento === INTENTOS) throw new Error(`tunel SSH caido tras ${INTENTOS} intentos: ${error.message}`)
    }
  }
}

const cliente = await conectarConReintento()

const { rows } = await cliente.query(`
  WITH primer_pago AS (
    SELECT DISTINCT ON (pa.enrollment_id)
           pa.enrollment_id, pa.amount, pa.payment_date
      FROM public.payments pa
     WHERE pa.active = 'Y'
     ORDER BY pa.enrollment_id, pa.payment_date, pa.payment_id
  )
  SELECT COALESCE(pv.abbreviation, p.program_name) AS programa,
         COUNT(*)::int        AS ventas,
         SUM(pp.amount)::numeric AS ingreso_inicial
    FROM primer_pago pp
    JOIN public.enrollments e       ON e.enrollment_id = pp.enrollment_id
    JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    JOIN public.programs p          ON p.program_id = pv.program_id
   WHERE e.active = 'Y'
     AND p.cat_model_modality <> $3
     AND pp.payment_date >= make_date($1, 1, 1)
     AND pp.payment_date <  make_date($1, $2, 1) + INTERVAL '1 month'
   GROUP BY 1
   ORDER BY 1`, [ANIO, MES_FINAL, MODALIDAD_ONLINE])

const csv = ['PROGRAMA;TOTAL VENTAS;TOTAL DE INGRESOS']
for (const f of rows) csv.push(`${f.programa};${f.ventas};${Number(f.ingreso_inicial).toFixed(2)}`)
console.log(csv.join('\n'))

const totales = rows.reduce((a, f) => ({
  ventas: a.ventas + f.ventas,
  ingreso: a.ingreso + Number(f.ingreso_inicial)
}), { ventas: 0, ingreso: 0 })
console.error(`\n-- ${rows.length} programas | ${totales.ventas} ventas | S/ ${totales.ingreso.toLocaleString('es-PE')}`)
console.error(`-- pagos de compra entre enero y el mes ${MES_FINAL} de ${ANIO}`)
await cliente.end()
