// Ventas e INGRESO INICIAL por programa leidos de la hoja "0. VENTAS" del
// libro CONS. MASTER PRG. - 2026, exportada a CSV.
//
// El MASTER es la fuente y no el ERP porque la migracion no termino: el ERP no
// tiene el 43% de las ventas de enero ni el 46% de las de febrero de 2026
// (POWER BI PRESENCIAL E1-26 y E2-26 figuran con CERO inscritos en el ERP y con
// 20 y 19 ventas en el cronograma). En el MASTER estan todas.
//
// "INICIAL" es justo lo que Planeamiento pide como ingreso: lo que el alumno
// entrego al comprar. El resto (SALDO, INGRESO) incluye cuotas posteriores.
//
// Solo cuentan las filas con INICIAL > 0, y eso resuelve tres problemas de una
// vez sin reglas especiales:
//   - REPROGRAMACION: el alumno aparece DOS veces en el MISMO curso, el origen
//     con el dinero (estado RP) y el destino en cero. Contando solo las que
//     pagan, la venta se cuenta una sola vez.
//   - CAMBIO DE CURSO: aparece en dos cursos distintos; la venta queda en aquel
//     donde efectivamente pago.
//   - SEGUIMIENTO Y BECAS: 1218 inscripciones de alumnos que entran a un curso
//     dentro de un paquete y 157 becas figuran con INICIAL 0; son alumnos del
//     aula, no ventas.
// Asi "Total ventas" queda coherente con "Total de ingresos": cada venta
// contada es la que produjo ese dinero.
import fs from 'node:fs'

const RUTA_CSV = process.argv[2]
const ANIO = Number(process.argv[3] ?? 2026)
const MES_FINAL = Number(process.argv[4] ?? 8)

const COLUMNAS = { codigo: 0, fechaPago: 3, inicial: 13, programa: 21, categoria: 22 }

// La columna "Nomb. abrev" del master es una formula que falla con #N/A para
// cuatro codigos; se resuelven con la abreviatura que tiene el ERP para esa
// misma version. Son 57 ventas que si no, quedaban sin programa.
const ABREVIATURA_POR_CODIGO = {
  'EX-CZ-01': 'EXCEL BÁSICO',
  'LG-CZ-19': 'SUPPLY CHAIN ANALYTICS',
  'PG-CZ-01': 'PROG. WEB',
  'PG-CZ-02': 'PROG. JAVA'
}

// El master escribe d/m/yyyy y los montos con coma decimal (formato peruano).
const fechaDe = texto => {
  const [dia, mes, anio] = String(texto).trim().split('/')
  return anio ? { mes: Number(mes), anio: Number(anio) } : { mes: null, anio: null }
}

const montoDe = texto => {
  const limpio = String(texto).trim().replace(/\./g, '').replace(',', '.')
  return /^-?\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : 0
}

// Parser de CSV con comillas: los nombres traen comas.
function celdas (linea) {
  const salida = []
  let campo = ''
  let entreComillas = false
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (c === '"') {
      if (entreComillas && linea[i + 1] === '"') { campo += '"'; i++ } else entreComillas = !entreComillas
    } else if (c === ',' && !entreComillas) { salida.push(campo); campo = '' } else campo += c
  }
  salida.push(campo)
  return salida
}

const lineas = fs.readFileSync(RUTA_CSV, 'utf8').split('\n').slice(1)
const grupos = new Map()
let consideradas = 0

for (const linea of lineas) {
  if (!linea.trim()) continue
  const c = celdas(linea)
  const abreviatura = (c[COLUMNAS.programa] ?? '').trim()
  const programa = abreviatura === '#N/A'
    ? ABREVIATURA_POR_CODIGO[(c[COLUMNAS.codigo] ?? '').trim()]
    : abreviatura
  if (!programa) continue
  const { mes, anio } = fechaDe(c[COLUMNAS.fechaPago])
  if (anio !== ANIO || !mes || mes > MES_FINAL) continue
  const inicial = montoDe(c[COLUMNAS.inicial])
  if (inicial <= 0) continue
  consideradas++
  const acumulado = grupos.get(programa) ?? { ventas: 0, inicial: 0 }
  acumulado.ventas++
  acumulado.inicial += inicial
  grupos.set(programa, acumulado)
}

const csv = ['PROGRAMA;TOTAL VENTAS;TOTAL DE INGRESOS']
for (const [programa, v] of [...grupos].sort((a, b) => a[0].localeCompare(b[0], 'es'))) {
  csv.push(`${programa};${v.ventas};${v.inicial.toFixed(2)}`)
}
console.log(csv.join('\n'))

const totalVentas = [...grupos.values()].reduce((a, v) => a + v.ventas, 0)
const totalInicial = [...grupos.values()].reduce((a, v) => a + v.inicial, 0)
console.error(`\n-- ${lineas.length} filas en el master, ${consideradas} con pago entre enero y el mes ${MES_FINAL} de ${ANIO}`)
console.error(`-- ${grupos.size} programas | ${totalVentas} ventas | S/ ${totalInicial.toLocaleString('es-PE')}`)
