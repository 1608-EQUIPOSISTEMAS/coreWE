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

  // Retornamos tal cual entrega el SP (generalmente devuelve lead_id y person_id)
  return rows?.[0] || {};
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

  // Retornamos tal cual entrega el SP
  return rows?.[0] || {};
}

// --- LISTADO DE LEADS (Optimizado) ---
async function leadList(payload) {
  const {
    q = null, page = 1, size = 25,
    from_date = null, to_date = null, updated_from = null, updated_to = null,
    cat_status_lead = null, cat_channel = null, cat_interest_level = null,
    cat_query = null, cat_last_follow = null,
    program_text = null, cat_type_program = null, cat_model_modality = null,
    edition_start_from = null, edition_start_to = null,
    active = null, owner_user_ids = null
  } = payload

  // Mantenemos el orden estricto de parámetros para el SP
  const params = [
    q, page, size,
    from_date, to_date, updated_from, updated_to,
    active,
    cat_status_lead, cat_channel, cat_interest_level, cat_query, cat_last_follow,
    program_text, cat_type_program, cat_model_modality,
    edition_start_from, edition_start_to,
    (Array.isArray(owner_user_ids) && owner_user_ids.length > 0) ? owner_user_ids : null
  ];

  const rows = await callProcedureReturningRows(
    pool,
    'public.sp_comercial_lead_list',
    params,
    { statementTimeoutMs: 25000 }
  );

  // Extraemos el total del primer row (si existe) para la paginación
  const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;

  // SIMPLIFICACIÓN: Retornamos 'rows' directo. 
  // Las columnas se llamarán exactamente igual que en el SELECT del SP.
  return { 
    total, 
    page: Number(page), 
    size: Number(size), 
    items: rows 
  };
}

// --- ACTUALIZACIÓN DE LEAD ---
async function leadUpdate(payload) {
  const { id, lead = {}, user_id, contact_attempts} = payload

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

  return rows?.[0] || {}
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

export default {
  leadRegister,
  enrollmentRegister,
  leadUpdate,
  leadList,
  leadGet,
  uploadEnrollmentFiles,
  searchContact
}