// Helpers de Odoo: generacion de credenciales sinteticas para el alumno y
// resolucion de unicidad de email cruzando BD y Odoo. Se separan del service
// principal porque son utilidades autocontenidas reutilizables por cualquier
// flujo que matricule en Odoo (enroll inicial, membresia, course change).

import { pool } from '../config/db.js'
import odooClient from '../config/odooClient.js'

const ODOO_EMAIL_DOMAIN = '@weeducacion.edu.pe'
const DIACRITIC_RE = /[̀-ͯ]/g

function normalizeNamePart (s) {
  return (s || '').toLowerCase().trim()
    .normalize('NFD').replace(DIACRITIC_RE, '')
    .replace(/[^a-z\s]/g, '').trim()
}

// Odoo guarda el nombre partido en dos campos propios de res.partner: `names`
// (nombres) y `surnames` (apellidos, paterno + materno juntos). El modulo de
// Certificacion lee de ahi, NO del `name` completo: si van vacios el alumno se
// ve bien en Usuarios pero su ficha de Estudiante sale sin nombre y no se puede
// certificar. Devuelve strings vacios si no hay dato (el caller los descarta).
export function buildOdooNameParts ({ firstName, lastName, motherLastName } = {}) {
  const clean = v => String(v || '').trim().replace(/\s+/g, ' ')
  return {
    names: clean(firstName).toUpperCase(),
    surnames: [clean(lastName), clean(motherLastName)].filter(Boolean).join(' ').toUpperCase()
  }
}

// Password sintetico para el usuario Odoo. Sin caracteres confundibles
// (0/O, 1/l/I) y mezcla mayusculas/minusculas/numeros.
export function generatePassword (length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let pwd = ''
  for (let i = 0; i < length; i++) pwd += chars[Math.floor(Math.random() * chars.length)]
  return pwd
}

// Email Odoo base segun convencion: {apellido}.{nombre}@weeducacion.edu.pe
// Toma la primera palabra de cada lado por si el alumno tiene nombres o
// apellidos compuestos.
export function buildOdooEmailBase (firstName, lastName) {
  const first = normalizeNamePart(firstName).split(/\s+/)[0] || ''
  const last = normalizeNamePart(lastName).split(/\s+/)[0] || ''
  return { base: `${last}.${first}`, domain: ODOO_EMAIL_DOMAIN }
}

// Devuelve un email Odoo unico para el alumno. Si el alumno ya tiene una
// inscripcion previa con el email base, lo reusa (idempotencia). Si no, prueba
// sufijos numericos {base}2..{base}20 hasta encontrar uno libre tanto en BD
// como en Odoo. Si todo esta tomado, cae a un sufijo basado en documento o
// timestamp como ultimo recurso.
export async function buildUniqueOdooEmail (firstName, lastName, documentNumber) {
  const { base, domain } = buildOdooEmailBase(firstName, lastName)
  const candidateEmail = `${base}${domain}`

  const { rows: ownEnroll } = await pool.query(`
    SELECT odoo_email FROM enrollments
    WHERE odoo_email = $1
    AND enrollment_id IN (
      SELECT e.enrollment_id FROM enrollments e
      JOIN customers c ON c.customer_id = e.customer_id
      JOIN persons p ON p.person_id = c.person_id
      WHERE p.document_number = $2
    )
    LIMIT 1
  `, [candidateEmail, documentNumber])

  if (ownEnroll?.length > 0) return candidateEmail

  const isEmailAvailable = async (email) => {
    const { rows: inDb } = await pool.query(
      'SELECT enrollment_id FROM enrollments WHERE odoo_email = $1 LIMIT 1',
      [email]
    )
    if (inDb?.length) return false
    try {
      const odooUser = await odooClient.searchUserByEmail(email)
      if (odooUser) return false
    } catch (err) {
      console.warn('[buildUniqueOdooEmail] Odoo lookup failed, assuming available:', err.message)
    }
    return true
  }

  if (await isEmailAvailable(candidateEmail)) return candidateEmail

  for (let i = 2; i <= 20; i++) {
    const altEmail = `${base}${i}${domain}`
    if (await isEmailAvailable(altEmail)) return altEmail
  }

  const suffix = documentNumber ? documentNumber.slice(-3) : String(Date.now()).slice(-4)
  return `${base}.${suffix}${domain}`
}

// Login (searchEmail) con el que hay que buscar al alumno en Odoo, en orden de
// confianza:
//   1) login del odoo_user_id previo del mismo DNI (lo mapeamos nosotros).
//   2) su correo real, si ya tiene cuenta Odoo de un flujo antiguo (GAS, alta
//      manual, otro sistema) que nuestra BD nunca registro. Sin este paso se
//      crea un usuario sintetico duplicado para alguien que ya existia.
//   3) el email sintetico recien generado (alumno realmente nuevo).
// El search es por `res.users.login`, no por `partner.email`: el email de
// partner se repite entre personas y no es llave.
export async function resolveOdooLogin ({ prevOdooUserId, originEmail, createEmail }, client = odooClient) {
  if (prevOdooUserId) {
    const users = await client.callKw('res.users', 'read', [[prevOdooUserId], ['login']]).catch(() => null)
    if (users?.[0]?.login) return users[0].login
  }

  const realEmail = originEmail ? String(originEmail).trim().toLowerCase() : ''
  if (realEmail) {
    const existing = await client.searchUserByEmail(realEmail).catch(() => null)
    if (existing?.login) return existing.login
  }

  return createEmail
}
