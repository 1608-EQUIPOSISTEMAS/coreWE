// Lector del Sheet "Cronograma Vacantes 2026", volcado a markdown por el
// conector de Drive. Vive aparte porque lo comparten el calculo de promedios y
// el cotejo contra el ERP.
import fs from 'node:fs'

const BARRA_INVERSA = String.fromCharCode(92)

// El volcado escapa los literales de markdown ("\-", "\#"): se quitan.
const celdas = linea =>
  linea.split('|').slice(1, -1).map(c => c.trim().split(BARRA_INVERSA).join(''))

const numero = texto => {
  const limpio = String(texto).replace(/\s/g, '').replace(/,/g, '.')
  return /^-?\d+(\.\d+)?$/.test(limpio) ? Number(limpio) : null
}

// El cronograma escribe d/m/yyyy (formato peruano); el ERP entrega yyyy-mm-dd.
const aISO = texto => {
  const [dia, mes, anio] = String(texto).split('/')
  return anio ? `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}` : null
}

// Columnas de las pestanas mensuales, por posicion:
// 0 N | 1 SEG | 2 LINEA | 3 TIPO | 4 ED. | 5 CA | 6 CURSO | ... | 14 INI |
// ... | 19 VENTAS | 20 SEGUI | 21 B2B | 22 BECA | 23 MEM. | 24 AULA | ...
const COLUMNAS = { curso: 6, inicio: 14, ventas: 19, segui: 20, aula: 24, edicion: 4 }
const COLUMNAS_MINIMAS = 28

// La PRIMERA cabecera con VENTAS/SEGUI es la hoja maestra de Planeamiento, que
// tiene otro juego de columnas: se descarta y solo se leen las 12 mensuales.
const cabecerasMensuales = lineas =>
  lineas
    .map((linea, i) => ({ linea, i }))
    .filter(({ linea }) => linea.startsWith('| N') && linea.includes('VENTAS') && linea.includes('SEGUI'))
    .map(({ i }) => i)
    .slice(1)

export function leerCronograma (rutaVolcado) {
  const lineas = JSON.parse(fs.readFileSync(rutaVolcado, 'utf8')).fileContent.split('\n')
  const cabeceras = cabecerasMensuales(lineas)

  const filas = []
  cabeceras.forEach((cabecera, k) => {
    const fin = k + 1 < cabeceras.length ? cabeceras[k + 1] - 3 : lineas.length
    for (let j = cabecera + 1; j < fin; j++) {
      const c = celdas(lineas[j])
      if (c.length < COLUMNAS_MINIMAS) continue
      const curso = c[COLUMNAS.curso]
      if (!curso || curso === 'CURSO') continue
      const inicio = aISO(c[COLUMNAS.inicio])
      if (!inicio) continue
      filas.push({
        curso,
        edicion: c[COLUMNAS.edicion],
        inicio,
        ventas: numero(c[COLUMNAS.ventas]),
        segui: numero(c[COLUMNAS.segui]),
        aula: numero(c[COLUMNAS.aula])
      })
    }
  })
  return filas
}
