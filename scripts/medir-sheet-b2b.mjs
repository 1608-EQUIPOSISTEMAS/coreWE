// Cuenta cuanto se llena cada columna de una pestana del Sheet B2B. Sirve para
// no crear columnas en la BD para datos que el area dejo de usar hace anos.
//   node scripts/medir-sheet-b2b.mjs <ruta-al-json> <n-tabla>
import { readFileSync } from 'node:fs'

const [rutaJson, nTabla] = process.argv.slice(2)
const lineas = JSON.parse(readFileSync(rutaJson, 'utf8')).fileContent.split('\n')
const celdas = (l) => l.split('|').slice(1, -1).map(c => c.trim())

const inicios = lineas.map((l, i) => (/:-:/.test(l) ? i : -1)).filter(i => i >= 0)
const n = Number(nTabla) - 1
const desde = inicios[n]
const hasta = (inicios[n + 1] ?? lineas.length) - 1

let filaEncabezado = desde + 1
for (let i = desde + 1; i < Math.min(desde + 8, hasta); i++) {
  const c = celdas(lineas[i])
  if (c.filter(Boolean).length > c.length / 2) { filaEncabezado = i; break }
}
const encabezados = celdas(lineas[filaEncabezado])
const datos = lineas.slice(filaEncabezado + 1, hasta + 1).map(celdas)

// '\-' y '\#REF\!' son basura de la exportacion, no valores.
const vacio = (v) => !v || v === '\\-' || /REF/.test(v)

console.log(`tabla ${nTabla}: ${datos.length} filas\n`)
encabezados.forEach((h, i) => {
  if (!h) return
  const llenas = datos.filter(f => !vacio(f[i])).length
  const distintos = new Set(datos.map(f => f[i]).filter(v => !vacio(v)))
  const muestra = [...distintos].slice(0, 6).join(' · ')
  console.log(
    `${String(i).padStart(2)}. ${h.padEnd(30)} ${String(Math.round(llenas / datos.length * 100)).padStart(3)}% ` +
    `(${String(distintos.size).padStart(3)} distintos)  ${muestra.slice(0, 90)}`)
})
