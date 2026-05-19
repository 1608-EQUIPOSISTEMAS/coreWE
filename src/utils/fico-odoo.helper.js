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
