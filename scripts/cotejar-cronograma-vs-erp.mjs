// Cruza fila a fila el Sheet "Cronograma Vacantes 2026" contra los contadores
// del ERP, emparejando por (curso, fecha de inicio). Sirve para decidir cual de
// las dos fuentes alimenta el promedio de ventas por apertura/seguimiento: si
// coinciden donde el Sheet esta sano (enero a junio), el ERP puede reemplazarlo
// entero y no hay que mezclar fuentes.
import fs from 'node:fs'

const [RUTA_VOLCADO, RUTA_ERP] = process.argv.slice(2)

const BARRA_INVERSA = String.fromCharCode(92)
const celdas = linea =>
  linea.split('|').slice(1, -1).map(c => c.trim().split(BARRA_INVERSA).join(''))

const numero = texto => {
  const limpio = String(texto).replace(/\s/g, '').replace(/,/g, '.')
  return /^-?\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : null
}

// El cronograma escribe d/m/yyyy; el ERP entrega yyyy-mm-dd.
const aISO = texto => {
  const [d, m, a] = String(texto).split('/')
  return a ? `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null
}

function filasDeCronograma (lineas) {
  const cabeceras = lineas
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.startsWith('| N') && l.includes('VENTAS') && l.includes('SEGUI'))
    .map(({ i }) => i)
    .slice(1)

  const filas = []
  cabeceras.forEach((inicio, k) => {
    const fin = k + 1 < cabeceras.length ? cabeceras[k + 1] - 3 : lineas.length
    for (let j = inicio + 1; j < fin; j++) {
      const c = celdas(lineas[j])
      if (c.length < 28 || !c[6] || c[6] === 'CURSO') continue
      const inicioISO = aISO(c[14])
      if (!inicioISO) continue
      filas.push({ curso: c[6], inicio: inicioISO, ventas: numero(c[19]), segui: numero(c[20]) })
    }
  })
  return filas
}

const clave = f => `${f.curso.toUpperCase()}||${f.inicio}`

const cronograma = filasDeCronograma(
  JSON.parse(fs.readFileSync(RUTA_VOLCADO, 'utf8')).fileContent.split('\n'))
const erp = JSON.parse(fs.readFileSync(RUTA_ERP, 'utf8'))
const erpPorClave = new Map(erp.map(f => [clave(f), f]))

const comparacion = { iguales: 0, distintas: 0, sinPar: 0 }
const discrepancias = []
for (const fila of cronograma) {
  if (fila.ventas === null) continue
  const par = erpPorClave.get(clave(fila))
  if (!par) { comparacion.sinPar++; continue }
  if (par.ventas === fila.ventas) comparacion.iguales++
  else {
    comparacion.distintas++
    discrepancias.push({ curso: fila.curso, inicio: fila.inicio, sheet: fila.ventas, erp: par.ventas })
  }
}

console.log(`cronograma: ${cronograma.length} filas | ERP: ${erp.length} ediciones`)
console.table(comparacion)
console.log('\nmayores discrepancias de VENTAS:')
console.table(discrepancias
  .sort((a, b) => Math.abs(b.sheet - b.erp) - Math.abs(a.sheet - a.erp))
  .slice(0, 15))
