// src/services/comercial.service.js
import { pool } from '../plugins/db.js'
import { callProcedureReturningRows } from '../plugins/spHelper.js'
import { promisify } from 'util';
import { pipeline } from 'stream';
import fs from 'fs';
import path from 'path';

const pump = promisify(pipeline);

const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const PUBLIC_URL_BASE = process.env.PUBLIC_URL || 'http://localhost:3000/uploads';

// --- (La función uploadEnrollmentFiles se mantiene igual) ---
async function uploadEnrollmentFiles({ enrollment_id, paymentFile, studentFile }) {
  let paymentUrl = null;
  let studentUrl = null;

  const saveLocalFile = async (fileData, subfolder) => {
    if (!fileData) return null;
    const { filename, buffer } = fileData;
    const safeName = filename.replace(/[^a-zA-Z0-9.]/g, '_');
    const uniqueName = `${Date.now()}_${safeName}`;
    const targetDir = path.join(UPLOAD_ROOT, subfolder);
    
    if (!fs.existsSync(targetDir)){
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const finalPath = path.join(targetDir, uniqueName);
    await fs.promises.writeFile(finalPath, buffer);
    return `/uploads/${subfolder}/${uniqueName}`;
  };

  if (paymentFile) paymentUrl = await saveLocalFile(paymentFile, 'payment');
  if (studentFile) studentUrl = await saveLocalFile(studentFile, 'student');

  if (paymentUrl || studentUrl) {
    let query = 'UPDATE public.enrollments SET ';
    const params = [];
    let idx = 1;

    if (paymentUrl) { query += `payment_attachment = $${idx++}, `; params.push(paymentUrl); }
    if (studentUrl) { query += `student_attachment = $${idx++}, `; params.push(studentUrl); }

    query = query.slice(0, -2) + ` WHERE enrollment_id = $${idx}`;
    params.push(enrollment_id);

    await pool.query(query, params);
  }

  return { ok: true, paymentUrl, studentUrl };
}

// --- REGISTRO DE LEAD ---
async function leadRegister({ lead = {}, person = {}, contact_attempts = [], user_id}) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_comercial_lead_register',
    [
      JSON.stringify(person || {}),
      JSON.stringify(lead || {}),
      JSON.stringify(contact_attempts || []),
      user_id
    ],
    { statementTimeoutMs: 25000 }
  );

  return rows?.[0] || { result: 0, message: 'No response from DB', response: null }
}

// --- REGISTRO DE INSCRIPCIÓN ---
async function enrollmentRegister(payload) {
  const user_id = payload.user_id;
  const lead_id = payload.inscription?.lead_id || payload.lead_id;

  if (!lead_id) throw new Error("El lead_id es obligatorio para la inscripción");

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_comercial_enrollment_register',
    [
      lead_id,                 
      user_id,                 
      JSON.stringify(payload)  
    ],
    { statementTimeoutMs: 25000 }
  );

  return rows?.[0] || { result: 0, message: 'No response from DB', response: null }
}

// src/services/comercial.service.js

async function leadList(payload = {}) {
  const {
    q = null,
    user_id,
    page = 1,
    size = 25,order_by = 0, 
    from_date = null,
    to_date = null,
    strategy_ids, // Viene del frontend
    word_ids,     // Viene del frontend
    medium_contact_ids,
    code_country_ids,
    updated_from = null,
    updated_to = null,
    edition_start_from = null,
    edition_start_to = null,
    pay_date_from = null,
  pay_date_to = null,
    active = null,
    program_text = null,
    web = null,
    b2b = null,

    // Recibimos los arrays directos (Fastify ya validó que son enteros o null)
    owner_user_ids,
    status_lead_ids,
    last_follow_ids,
    interest_level_ids,
    channel_ids,
    query_ids,
    type_program_ids,
    model_modality_ids,
    moment_ids,
    membership_moment_ids
  } = payload

  // Lógica de Activo/Inactivo
  let activeParam = active
  if (active === true) activeParam = 'Y'
  else if (active === false) activeParam = 'N'

  const filters = {
    current_user_id: user_id,
    q,
    page,
    size,order_by,
    from_date,
    to_date,
    updated_from,
    updated_to,
    edition_start_from,
    edition_start_to,
    active: activeParam,
    program_text,
    web,
    b2b,
    strategy_ids: strategy_ids || [], 
    word_ids: word_ids || [],
    // CORRECCIÓN: ASIGNACIÓN DIRECTA (Sin .map)
    // Usamos (X || []) solo para asegurar que no sea null al convertir a JSON string,
    // aunque el SP maneja nulls, enviar [] vacío es más seguro en JSON.
    
    owner_user_ids: owner_user_ids || [],
    status_lead_ids: status_lead_ids || [],
    last_follow_ids: last_follow_ids || [],
    interest_level_ids: interest_level_ids || [],
    channel_ids: channel_ids || [],
    query_ids: query_ids || [],
    type_program_ids: type_program_ids || [],
    model_modality_ids: model_modality_ids || [],
    moment_ids: moment_ids || [],
    membership_moment_ids: membership_moment_ids || [],
    pay_date_from,
  pay_date_to,
  medium_contact_ids: medium_contact_ids || [],
    code_country_ids: code_country_ids || []
  }

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_comercial_lead_list',
    [JSON.stringify(filters)],
    { statementTimeoutMs: 25000 }
  )

  const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0

  return {
    total,
    page: Number(page),
    size: Number(size),
    items: rows
  }
}
// --- BÚSQUEDA DE CLIENTE POR TELÉFONO ---
async function searchPhoneGet(phone) {
  // Llamamos al SP pasando solo el teléfono.
  // El cursor se maneja internamente por el driver/helper.
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_search_phone_get',
    [
      phone
    ],
    { statementTimeoutMs: 5000 } // Un timeout corto es suficiente para lectura
  )

  // El SP devuelve siempre 1 fila con el JSON y los IDs, o un objeto vacío si falla algo
  return rows?.[0] || {}
}


async function leadUpdate(payload) {
  const { id, lead = {}, user_id, contact_attempts} = payload
  console.log(contact_attempts)
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_comercial_lead_update',
    [
      id,
      JSON.stringify(lead || {}),
      user_id,
      JSON.stringify(contact_attempts || [])
    ],
    { statementTimeoutMs: 25000 }
  )

  return rows?.[0] || { result: 0, message: 'No response from DB', response: null }
}

// --- OBTENER UN LEAD (Optimizado) ---
async function leadGet(payload) {
  const { id } = payload

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_comercial_lead_get',
    [ id ],
    { statementTimeoutMs: 25000 }
  );

  // SIMPLIFICACIÓN: Retornamos el primer objeto row directo.
  // Ya no hacemos { lead_id: row.lead_id, ... }. 
  // El objeto 'data' contendrá todas las columnas que el SP retorne.
  return {
    data: rows?.[0] || {}
  };
}

// --- BUSCAR CONTACTO ---
async function searchContact({ phone }) {
  const query = 'SELECT public.fn_search_contact_by_phone($1) as result';
  try {
    const { rows } = await pool.query(query, [phone]);
    return rows[0]?.result || { status: 'error', message: 'No data returned' };
  } catch (error) {
    console.error('Error buscando contacto:', error);
    throw error;
  }
}
async function enrollmentGet(enrollment_id) {
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_comercial_enrollment_get',
    [ enrollment_id ],
    { statementTimeoutMs: 5000 }
  );
  
  // El SP devuelve 1 sola fila con toda la info
  return rows?.[0] || {};
}

// En el servicio
async function userRestrictionsList(payload = {}) {
  // Pasamos el JSON directo al SP
  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_comercial_user_restrictions_list',
    [JSON.stringify(payload)]
  )
  return rows || []
}


async function userRestrictionsUpdate(payloadArray = []) {
  // Usamos pool.query directo porque este SP no retorna filas (no tiene cursor)
  await pool.query(
    'CALL public.sp_comercial_user_restrictions_update($1::jsonb)',
    [JSON.stringify(payloadArray)]
  )
  return { message: 'Restricciones actualizadas correctamente' }
}
async function leadStats(payload = {}) {
  const {
    q, from_date, to_date, updated_from, updated_to,pay_date_from = null,
  pay_date_to = null,
    edition_start_from, edition_start_to, active, program_text,
    web, b2b,
    owner_user_ids, status_lead_ids, last_follow_ids, interest_level_ids,
    channel_ids, query_ids, type_program_ids, model_modality_ids,
    moment_ids, membership_moment_ids, strategy_ids, word_ids
  } = payload

  let activeParam = active
  if (active === true) activeParam = 'Y'
  else if (active === false) activeParam = 'N'

  const filters = {
    q, from_date, to_date, updated_from, updated_to,
    edition_start_from, edition_start_to, active: activeParam, program_text,
    web, b2b,
    owner_user_ids: owner_user_ids || [],
    status_lead_ids: status_lead_ids || [],
    last_follow_ids: last_follow_ids || [],
    interest_level_ids: interest_level_ids || [],
    channel_ids: channel_ids || [],
    query_ids: query_ids || [],
    type_program_ids: type_program_ids || [],
    model_modality_ids: model_modality_ids || [],
    moment_ids: moment_ids || [],
    membership_moment_ids: membership_moment_ids || [],
    strategy_ids: strategy_ids || [],
    word_ids: word_ids || [],
    pay_date_from,
  pay_date_to
  }

  // Llamada al SP. Como es INOUT, retorna el JSON en la primera fila.
  const query = `CALL public.sp_comercial_lead_stats($1, $2)`;
  // Pasamos null como segundo parametro porque es INOUT
  const res = await pool.query(query, [JSON.stringify(filters), null]);
  
  // Dependiendo de tu driver postgres, la respuesta suele estar en rows[0].p_stats
  return res.rows[0].p_stats;
}
export default {
  leadRegister,
  enrollmentRegister,
  enrollmentGet,
  leadUpdate,
  leadList,
  userRestrictionsList,
  userRestrictionsUpdate,
  leadGet,
  uploadEnrollmentFiles,
  searchContact,
  searchPhoneGet,
  leadStats
}