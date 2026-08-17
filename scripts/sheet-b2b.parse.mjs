// Reglas puras de lectura del export markdown del Sheet "WE FOR BUSINESS".
// Sin BD ni filesystem: por eso se pueden testear solas (__tests__/migrar-sheet-b2b.test.js).

// El export escapa los pipes que van DENTRO de una celda como '\|'
// ("...ESTADO CIVIL \| RENIEC"). Partir por '|' a secas corre todas las columnas
// de esa fila y termina metiendo el correo en el RUC.
export const celdas = (linea) =>
  linea.split(/(?<!\\)\|/).slice(1, -1).map(c => c.replace(/\\\|/g, '|').trim())

// '\-' y '\#REF\!' son basura de la exportacion, no valores.
export function val (v) {
  const t = (v ?? '').replace(/\\/g, '').trim()
  return !t || t === '-' || /^#REF!?$/.test(t) ? null : t
}

// El Sheet mezcla las dos convenciones en la MISMA columna: "1.123" (punto =
// miles, es-PE) y "1,162.5" (coma = miles, en-US). Confundirlas cambia un monto
// por mil, asi que el separador decimal se decide asi:
//   · con ambos separadores, manda el ultimo que aparece ("1,162.5" = 1162.5)
//   · con una coma sola, siempre es decimal: la hoja esta en es-PE y trae
//     resultados de formula de 3 decimales ("924,105" = 924.105, no 924105)
//   · con un punto solo, es de miles si lo siguen exactamente 3 digitos
export function numero (v) {
  const t = val(v)
  if (!t) return null
  const limpio = t.replace(/[^\d.,-]/g, '')
  if (!/\d/.test(limpio)) return null

  const ultimaComa = limpio.lastIndexOf(',')
  const ultimoPunto = limpio.lastIndexOf('.')
  let decimal = null
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    decimal = ultimaComa > ultimoPunto ? ',' : '.'
  } else if (ultimaComa >= 0) {
    decimal = ','
  } else if (ultimoPunto >= 0) {
    const decimales = limpio.length - ultimoPunto - 1
    if (decimales !== 3) decimal = '.'
  }

  const soloDigitos = decimal
    ? limpio.split(decimal).map(p => p.replace(/[.,]/g, '')).join('.')
    : limpio.replace(/[.,]/g, '')
  const n = Number(soloDigitos)
  if (!Number.isFinite(n)) return null
  // La plata se guarda con 2 decimales: el Sheet trae resultados de formula con 3.
  return Math.round(n * 100) / 100
}

export function fecha (v) {
  const t = val(v)
  if (!t) return null
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (!m) return null
  const [, d, mes, a] = m
  return `${a}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export const normalizar = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const sinTildes = (s) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()

// Cada pestana del export arranca con una fila separadora ':-:'. El encabezado
// real no es la primera fila: las pestanas traen titulos y filas vacias arriba,
// asi que se toma la primera fila con mas de la mitad de las celdas llenas.
export function pestanas (contenido) {
  const lineas = contenido.split('\n')
  const inicios = lineas.map((l, i) => (/:-:/.test(l) ? i : -1)).filter(i => i >= 0)
  return inicios.map((desde, n) => {
    const hasta = (inicios[n + 1] ?? lineas.length) - 1
    let filaEnc = desde + 1
    for (let i = desde + 1; i < Math.min(desde + 8, hasta); i++) {
      const c = celdas(lineas[i])
      if (c.filter(Boolean).length > c.length / 2) { filaEnc = i; break }
    }
    return lineas.slice(filaEnc + 1, hasta + 1).map(celdas).filter(f => f.some(Boolean))
  })
}

// ── Diccionarios del negocio ────────────────────────────────

const TIPO_CONTRATO = {
  'CORPORATIVO B2B': 'we_b2b_contract_corporate',
  CORPORATIVO: 'we_b2b_contract_corporate',
  'TRATO CORPORATIVO': 'we_b2b_contract_corporate',
  'PROGRAMAS INHOUSE': 'we_b2b_contract_inhouse',
  INHOUSE: 'we_b2b_contract_inhouse',
  'IN HOUSE': 'we_b2b_contract_inhouse',
  'CONVENIOS CORPORATIVOS': 'we_b2b_contract_convenio',
  CONVENIO: 'we_b2b_contract_convenio',
  DONACION: 'we_b2b_contract_donation',
  AUSPICIO: 'we_b2b_contract_sponsorship',
  CONSULTORIA: 'we_b2b_contract_consulting',
  MEMBRESIA: 'we_b2b_contract_other',
  OTROS: 'we_b2b_contract_other',
}
export const tipoContrato = (etiqueta) => TIPO_CONTRATO[sinTildes(etiqueta)] || 'we_b2b_contract_other'

export const TIPO_CLIENTE = {
  'B2B NACIONAL': 'we_b2b_client_type_national',
  'B2B INTERNACIONAL': 'we_b2b_client_type_international',
  ESTADO: 'we_b2b_client_type_government',
}
export const MONEDA = { PEN: 'we_currency_soles', USD: 'we_currency_dollars' }
export const CONDICION = {
  TOTAL: 'we_payment_way_single',
  CREDITO: 'we_payment_way_installments',
  CUOTA: 'we_payment_way_installments',
  CUOTAS: 'we_payment_way_installments',
}
