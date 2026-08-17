// Migra el historico del Google Sheet "WE FOR BUSINESS" a companies /
// company_contacts / b2b_contracts / b2b_contract_beneficiaries.
//
//   node scripts/migrar-sheet-b2b.mjs <ruta-al-json> --dry   # reporta, no guarda
//   node scripts/migrar-sheet-b2b.mjs <ruta-al-json>         # aplica
//
// Pestanas del export (concatenadas, cada una arranca con una fila ':-:'):
//   1  ventas sin monto, con el tipo de trato en una columna sin encabezado
//   2  CONTROL DE VENTAS: la venta completa con plata y fechas
//   3  beneficiarios individuales de convenio (una fila = un alumno)
//   4  DONACION y AUSPICIO de eventos
//   5  campanas de mailing (YAMM): NO son ventas, se ignora
//   6,7,9  catalogos y tablas dinamicas derivadas: se ignoran
//   8  copia espejo de la 1 con los mismos RUC: se ignora para no duplicar
//   10 catalogo de programas, que el ERP ya tiene en `programs`
//
// Idempotente: cada contrato guarda su origen en legacy_sheet->>'clave' y la
// segunda corrida lo saltea en vez de duplicarlo.
import { readFileSync } from 'node:fs'
import {
  val, numero, fecha, normalizar, sinTildes,
  pestanas, tipoContrato, TIPO_CLIENTE, MONEDA, CONDICION
} from './sheet-b2b.parse.mjs'
import { pool } from './db.mjs'

const [rutaJson, ...flags] = process.argv.slice(2)
const ENSAYO = flags.includes('--dry')
if (!rutaJson) throw new Error('Falta la ruta al JSON exportado del Sheet')

const pestanasDelExport = pestanas(readFileSync(rutaJson, 'utf8').startsWith('{')
  ? JSON.parse(readFileSync(rutaJson, 'utf8')).fileContent
  : readFileSync(rutaJson, 'utf8'))
const pestana = (n) => pestanasDelExport[n - 1] ?? []

// ── Armado de las filas a migrar ─────────────────────────────

const contratos = []
const descartes = []

const agregar = (contrato, beneficiarios = []) => {
  if (!contrato.razon_social) { descartes.push({ ...contrato, motivo: 'sin empresa' }); return }
  contratos.push({ ...contrato, beneficiarios })
}

// Tabla 1: venta sin monto. El tipo de trato vive en la columna 12, sin encabezado.
pestana(1).forEach((f, i) => agregar({
  clave: `t1:${i}`,
  razon_social: val(f[0]),
  documento: val(f[1]) || val(f[2]),
  contacto: { nombre: val(f[4]), telefono: val(f[5]), correo: val(f[6]) },
  tipo_alias: tipoContrato(val(f[12]) || val(f[13])),
  programa: val(f[7]),
  payment_date: fecha(f[3]),
  crudo: { EMPRESA: f[0], RUC: f[1], 'FECHA DE PAGO': f[3], 'NOMBRE P.': f[7], TIPO: f[12] },
}))

// Tabla 2: la venta completa, con plata y todos los hitos.
pestana(2).forEach((f, i) => agregar({
  clave: `t2:${i}`,
  razon_social: val(f[2]),
  documento: val(f[3]),
  contacto: { nombre: val(f[4]), telefono: val(f[5]), correo: val(f[6]) },
  tipo_alias: tipoContrato(val(f[8])),
  cliente_alias: TIPO_CLIENTE[sinTildes(val(f[9]))],
  programa: val(f[7]),
  start_date: fecha(f[10]),
  number_of_licenses: numero(f[13]),
  moneda_alias: MONEDA[sinTildes(val(f[14]))],
  total_amount: numero(f[15]) ?? numero(f[16]),
  condicion_alias: CONDICION[sinTildes(val(f[17]))],
  consultation_date: fecha(f[18]),
  close_date: fecha(f[19]),
  payment_date: fecha(f[20]),
  notes: val(f[23]),
  paid_amount_pen: numero(f[26]),
  paid_amount: numero(f[27]),
  invoice_date: fecha(f[30]),
  country: val(f[31]),
  confirmation_sent_date: fecha(f[33]),
  crudo: Object.fromEntries(f.map((v, j) => [`c${j}`, v]).filter(([, v]) => val(v))),
}))

// Tabla 4: donaciones y auspicios de eventos.
pestana(4).forEach((f, i) => agregar({
  clave: `t4:${i}`,
  razon_social: val(f[4]),
  documento: val(f[5]),
  contacto: { nombre: val(f[1]), telefono: val(f[2]), correo: val(f[3]) },
  tipo_alias: tipoContrato(val(f[7])),
  cliente_alias: TIPO_CLIENTE[sinTildes(val(f[6]))],
  programa: val(f[11]) || val(f[35]),
  moneda_alias: MONEDA[sinTildes(val(f[9]))],
  total_amount: numero(f[10]),
  paid_amount: numero(f[31]) ?? numero(f[16]),
  consultation_date: fecha(f[24]),
  close_date: fecha(f[25]) || fecha(f[8]),
  payment_date: fecha(f[36]),
  invoice_date: fecha(f[33]),
  country: val(f[34]),
  crudo: Object.fromEntries(f.map((v, j) => [`c${j}`, v]).filter(([, v]) => val(v))),
}))

// Tabla 3: un alumno por fila. Se agrupan por empresa en UN contrato de convenio:
// eso es justamente lo que el Sheet no podia representar.
const porEmpresa = new Map()
pestana(3).forEach((f, i) => {
  const empresa = val(f[1])
  if (!empresa) return
  const clave = normalizar(empresa)
  if (!porEmpresa.has(clave)) {
    porEmpresa.set(clave, {
      clave: `t3:${clave}`,
      razon_social: empresa,
      documento: null,
      contacto: {},
      tipo_alias: 'we_b2b_contract_convenio',
      cliente_alias: TIPO_CLIENTE[sinTildes(val(f[2]))],
      moneda_alias: MONEDA[sinTildes(val(f[10]))],
      total_amount: 0,
      consultation_date: fecha(f[0]),
      payment_date: fecha(f[9]),
      beneficiarios: [],
      crudo: { origen: 'pestana 3 · beneficiarios de convenio' },
    })
  }
  const c = porEmpresa.get(clave)
  c.total_amount += numero(f[11]) || 0
  c.beneficiarios.push({
    full_name: val(f[4]),
    phone: val(f[5]),
    email: val(f[15]),
    programa: val(f[6]),
    notes: [val(f[17]), val(f[18])].filter(Boolean).join(' · ') || null,
  })
})
for (const c of porEmpresa.values()) {
  const { beneficiarios, ...contrato } = c
  agregar({ ...contrato, number_of_licenses: beneficiarios.length }, beneficiarios)
}

// ── Persistencia ─────────────────────────────────────────────

const conteo = { empresasNuevas: 0, contactosNuevos: 0, contratos: 0, beneficiarios: 0, saltados: 0, rucsBackfilleados: 0 }

const cliente = await pool.connect()
try {
  await cliente.query('BEGIN')

  const catalogos = new Map((await cliente.query(
    "SELECT alias, catalog_id FROM catalog WHERE alias LIKE 'we_b2b_%' OR alias LIKE 'we_currency_%' OR alias LIKE 'we_payment_way_%'"
  )).rows.map(r => [r.alias, r.catalog_id]))

  // Indice de empresas ya existentes. Ojo con la calidad del maestro actual:
  // 216 de 219 filas tienen un contador ('1','2','3'...) en document_number en
  // vez del RUC, y varias razones sociales traen el alias pegado con salto de
  // linea ('SALUTARE SOLUCION INTEGRAL EN SALUD SAC\nSALOG'). Por eso se indexa
  // tambien cada fragmento del nombre: sin eso la migracion crearia una segunda
  // "SALOG" al lado de la que ya existe.
  const RUC = /^\d{11}$/
  const existentes = (await cliente.query('SELECT company_id, document_number, razon_social FROM companies')).rows
  const porDocumento = new Map()
  const porNombre = new Map()
  const docActual = new Map()
  for (const e of existentes) {
    docActual.set(e.company_id, e.document_number)
    if (e.document_number && RUC.test(e.document_number.trim())) {
      porDocumento.set(normalizar(e.document_number), e.company_id)
    }
    for (const fragmento of String(e.razon_social || '').split(/[\n/]/)) {
      const clave = normalizar(fragmento)
      if (clave.length >= 4 && !porNombre.has(clave)) porNombre.set(clave, e.company_id)
    }
  }

  const yaMigrados = new Set((await cliente.query(
    "SELECT legacy_sheet->>'clave' AS k FROM b2b_contracts WHERE legacy_sheet ? 'clave'"
  )).rows.map(r => r.k))

  const programas = (await cliente.query("SELECT program_id, program_name FROM programs WHERE active = 'Y'")).rows
  const buscarPrograma = (nombre) => {
    if (!nombre) return null
    const n = normalizar(nombre)
    const exacto = programas.find(p => normalizar(p.program_name) === n)
    if (exacto) return exacto.program_id
    // El Sheet abrevia ("ESP. POWER BI"): se acepta si el nombre corto esta contenido.
    const parcial = programas.find(p => n.length >= 6 && normalizar(p.program_name).includes(n))
    return parcial?.program_id ?? null
  }

  async function resolverEmpresa (c) {
    const doc = c.documento ? normalizar(c.documento) : null
    const id = (doc && porDocumento.get(doc)) || porNombre.get(normalizar(c.razon_social))
    if (id) {
      // El Sheet es la unica fuente con RUCs de verdad: si la empresa ya existe
      // con el contador basura, se le pone el documento real de paso.
      if (doc && RUC.test(c.documento.trim()) && !RUC.test(String(docActual.get(id) || '').trim())) {
        await cliente.query('UPDATE companies SET document_number = $1, modification_date = now() WHERE company_id = $2',
          [c.documento.trim(), id])
        docActual.set(id, c.documento.trim())
        porDocumento.set(doc, id)
        conteo.rucsBackfilleados++
      }
      return id
    }

    const { rows: [nueva] } = await cliente.query(
      `INSERT INTO companies (razon_social, document_number, is_intermediary, active, registration_date)
       VALUES ($1, $2, false, 'Y', now()) RETURNING company_id`,
      [c.razon_social.slice(0, 200), c.documento?.slice(0, 20) ?? null])
    conteo.empresasNuevas++
    if (doc) porDocumento.set(doc, nueva.company_id)
    porNombre.set(normalizar(c.razon_social), nueva.company_id)
    docActual.set(nueva.company_id, c.documento ?? null)

    if (c.contacto?.nombre) {
      await cliente.query(
        `INSERT INTO company_contacts (company_id, contact_name, contact_phone, contact_email, is_primary, active)
         VALUES ($1, $2, $3, $4, true, 'Y')`,
        [nueva.company_id, c.contacto.nombre.slice(0, 150),
          c.contacto.telefono?.slice(0, 20) ?? null, c.contacto.correo?.slice(0, 120) ?? null])
      conteo.contactosNuevos++
    }
    return nueva.company_id
  }

  for (const c of contratos) {
    if (yaMigrados.has(c.clave)) { conteo.saltados++; continue }
    const companyId = await resolverEmpresa(c)

    const { rows: [contrato] } = await cliente.query(
      `INSERT INTO b2b_contracts (
         company_id, cat_contract_type, contract_name, contract_date, start_date,
         cat_client_type, cat_currency, cat_payment_terms, program_version_id,
         number_of_licenses, total_amount, paid_amount, paid_amount_pen,
         consultation_date, close_date, payment_date, confirmation_sent_date, invoice_date,
         country, notes, legacy_sheet, active, registration_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'Y',now())
       RETURNING b2b_contract_id`,
      [
        companyId,
        catalogos.get(c.tipo_alias),
        [c.razon_social, c.programa].filter(Boolean).join(' · ').slice(0, 200).toUpperCase(),
        c.close_date || c.payment_date || c.consultation_date || c.start_date,
        c.start_date ?? null,
        catalogos.get(c.cliente_alias) ?? null,
        catalogos.get(c.moneda_alias) ?? null,
        catalogos.get(c.condicion_alias) ?? null,
        buscarPrograma(c.programa),
        c.number_of_licenses ?? null,
        c.total_amount ?? null,
        c.paid_amount ?? null,
        c.paid_amount_pen ?? null,
        c.consultation_date ?? null,
        c.close_date ?? null,
        c.payment_date ?? null,
        c.confirmation_sent_date ?? null,
        c.invoice_date ?? null,
        c.country?.slice(0, 60) ?? null,
        c.notes ?? null,
        JSON.stringify({ clave: c.clave, ...c.crudo }),
      ])
    conteo.contratos++

    for (const b of c.beneficiarios) {
      if (!b.full_name) continue
      await cliente.query(
        `INSERT INTO b2b_contract_beneficiaries
           (b2b_contract_id, full_name, email, phone, program_version_id, notes, active)
         VALUES ($1,$2,$3,$4,$5,$6,'Y')`,
        [contrato.b2b_contract_id, b.full_name.slice(0, 150).toUpperCase(),
          b.email?.slice(0, 120) ?? null, b.phone?.slice(0, 20) ?? null,
          buscarPrograma(b.programa), b.notes])
      conteo.beneficiarios++
    }
  }

  if (ENSAYO) {
    await cliente.query('ROLLBACK')
    console.log('\n[--dry] revertido, no se guardo nada.')
  } else {
    await cliente.query('COMMIT')
    console.log('\nAplicado.')
  }
} catch (e) {
  await cliente.query('ROLLBACK')
  throw e
} finally {
  cliente.release()
  await pool.end()
}

// Control de calidad: si la migracion entra con la mitad de los montos en null
// o sin cruzar ningun programa, el problema es el parseo, no el Sheet.
const porOrigen = (prefijo) => contratos.filter(c => c.clave.startsWith(prefijo))
const suma = (fs, campo) => fs.reduce((a, c) => a + (c[campo] || 0), 0)
console.log('\n  ── por pestana ──')
for (const [prefijo, nombre] of [['t1:', 'ventas sin monto'], ['t2:', 'control de ventas'],
  ['t3:', 'convenios'], ['t4:', 'donacion/auspicio']]) {
  const fs = porOrigen(prefijo)
  if (!fs.length) continue
  console.log(`  ${nombre.padEnd(20)} ${String(fs.length).padStart(4)} contratos · ` +
    `${fs.filter(c => c.total_amount).length} con monto · ` +
    `${fs.filter(c => c.moneda_alias).length} con moneda · ` +
    `${fs.filter(c => c.documento).length} con RUC · ` +
    `total ${suma(fs, 'total_amount').toLocaleString('es-PE')}`)
}

console.log(`
  empresas nuevas   ${conteo.empresasNuevas}
  RUC backfilleados ${conteo.rucsBackfilleados}
  contactos nuevos  ${conteo.contactosNuevos}
  contratos         ${conteo.contratos}
  beneficiarios     ${conteo.beneficiarios}
  ya migrados       ${conteo.saltados}
  descartados       ${descartes.length}${descartes.length ? ' (' + [...new Set(descartes.map(d => d.motivo))].join(', ') + ')' : ''}`)
