import { pool } from '../plugins/db.js'
import { google } from 'googleapis'
import path from 'path'

import fs from 'fs';
import { WebClient } from '@slack/web-api'
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

// USAR PROCESS.ENV EN LUGAR DEL TEXTO DIRECTO

const SLACK_TOKEN   = process.env.SLACK_TOKEN
const SLACK_CHANNEL = process.env.SLACK_CHANNEL
// Inicializamos el cliente
const client = new WebClient(SLACK_TOKEN);
async function syncEnrollmentToSheet() {
  const spreadsheetId = '1ehfYdzIW115KmfUtzFyLrFFnk2PJHy9Vmp4nYLsbvxo';

  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), 'credentials/service.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const authClient = await auth.getClient();
  const googleSheets = google.sheets({ version: 'v4', auth: authClient });

  // ── SISTEMA-ORIGINAL: sobreescritura total ─────────────────────────────────
  const resultAll = await pool.query(`SELECT * FROM public.vw_enrollment_report`);
  const rowsAll = resultAll.rows || [];

  if (rowsAll.length > 0) {
    const headers = Object.keys(rowsAll[0]);

    await googleSheets.spreadsheets.values.update({
      spreadsheetId,
      range: `SISTEMA-ORIGINAL!A4`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [headers] },
    });

    const valuesAll = rowsAll.map(row =>
      headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        if (val instanceof Date) return val.toISOString().replace('T', ' ').substring(0, 19);
        return String(val);
      })
    );

    try {
      await googleSheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `SISTEMA-ORIGINAL!A5:ZZ`,
      });
    } catch (e) {
      console.warn('Advertencia al limpiar SISTEMA-ORIGINAL:', e.message);
    }

    await googleSheets.spreadsheets.values.update({
      spreadsheetId,
      range: `SISTEMA-ORIGINAL!A5`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: valuesAll },
    });
  }

  // ── SISTEMA-PILOTO: solo filas nuevas (FLAG_SEND = 'N') ───────────────────
  const resultNew = await pool.query(
    `SELECT * FROM public.vw_enrollment_report WHERE "FLAG_SEND" = 'N'`
  );
  const rowsNew = resultNew.rows || [];

  let pilotoResult = { rows_inserted: 0, sheet_updated_cells: 0 };

  if (rowsNew.length > 0) {
    const headers = Object.keys(rowsNew[0]);

    const valuesNew = rowsNew.map(row =>
      headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        if (val instanceof Date) return val.toISOString().replace('T', ' ').substring(0, 19);
        return String(val);
      })
    );

    // Calcular fila de inicio
    const getResponse = await googleSheets.spreadsheets.values.get({
      spreadsheetId,
      range: `SISTEMA-PILOTO!A:A`,
    });
    const existingRows = getResponse.data.values || [];
    const startRow = existingRows.length + 1;

    // Insertar datos
    const res = await googleSheets.spreadsheets.values.update({
      spreadsheetId,
      range: `SISTEMA-PILOTO!A${startRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: valuesNew },
    });

    // Marcar como enviados en BD
    const sentIds = rowsNew.map(r => r['ID']);
    await pool.query(
      `UPDATE public.enrollments SET flag_send = 'Y' WHERE enrollment_id = ANY($1::int[])`,
      [sentIds]
    );

    pilotoResult.sheet_updated_cells = res.data.updatedCells;
    pilotoResult.rows_inserted = rowsNew.length;
  }

  return {
    ok: true,
    original_rows_synced: rowsAll.length,
    piloto_rows_inserted: pilotoResult.rows_inserted,
    piloto_cells_updated: pilotoResult.sheet_updated_cells,
  };
}

async function sendEnrollmentWebToSlack({ enrollment_id }) {
  try {
    const slackClient = new WebClient(SLACK_TOKEN)

    const result = await pool.query(` SELECT
        e.enrollment_id,
        to_char(e.registration_date, 'DD/MM/YYYY HH24:MI') AS fecha_registro,
        prog.program_name,
        c_type.description AS tipo_programa,
        c_mod.description  AS modalidad,
        to_char(pe.start_date::timestamptz, 'DD/MM/YYYY') AS fecha_inicio,
        per.document_number AS dni,
        per.first_name || ' ' || COALESCE(per.last_name, '') AS alumno,
        concat('(', c_sitx.variable_2, ') ', l.origin_phone)  AS celular,
        l.origin_email  AS correo,
        c_sit.variable_1 AS ocupacion,
        concat(u.name,' - ', u.alias )          AS asesor,
        c_curr.description AS moneda,
        e.list_price,
        e.discount_amount,
        e.total_amount,
        e.notes,
        c_fico.description AS estado_financiero,
        -- Adjuntos del lead (constancias pago web)
        (
          SELECT json_agg(json_build_object(
            'url',  la.file_url,
            'name', COALESCE(la.file_name, 'Adjunto')
          ) ORDER BY la.lead_attachment_id)
          FROM public.lead_attachments la
          WHERE la.lead_id = l.lead_id AND la.active = 'Y'
        ) AS lead_attachments
      FROM public.enrollments e
      JOIN public.customers cust ON cust.customer_id = e.customer_id
      JOIN public.persons per    ON per.person_id = cust.person_id
      LEFT JOIN public.leads l         ON l.enrollment_id = e.enrollment_id
      LEFT JOIN public.users u         ON u.user_id = e.seller_agent_id
      LEFT JOIN public.program_versions ver ON ver.program_version_id = e.program_version_id
      LEFT JOIN public.programs prog        ON prog.program_id = ver.program_id
      LEFT JOIN public.program_editions pe  ON pe.edition_num_id = e.program_edition_id
      LEFT JOIN public.catalog c_type  ON c_type.catalog_id = prog.cat_type_program
      LEFT JOIN public.catalog c_mod   ON c_mod.catalog_id  = prog.cat_model_modality
      LEFT JOIN public.catalog c_fico  ON c_fico.catalog_id = e.cat_fico_status
      LEFT JOIN public.catalog c_sit   ON c_sit.catalog_id  = l.cat_prospect_situation
      LEFT JOIN public.catalog c_sitx   ON c_sitx.catalog_id  = l.cat_code_country
      LEFT JOIN public.catalog c_curr  ON c_curr.catalog_id = e.cat_currency
      WHERE e.enrollment_id = $1
      LIMIT 1`, [enrollment_id])

    if (result.rows.length === 0) {
      return { ok: false, error: `Enrollment ${enrollment_id} no encontrado` }
    }

    const d = result.rows[0]
    const attachments = d.lead_attachments || []

    // 2. Construir bloques
    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: '🌐 Nuevo Pago Web Registrado', emoji: true } },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*📚 Programa:*\n${d.program_name || '—'}` },
          { type: 'mrkdwn', text: `*🏷️ Tipo:*\n${d.tipo_programa || '—'} · ${d.modalidad || '—'}` },
          { type: 'mrkdwn', text: `*👤 Alumno:*\n${d.alumno}` },
          { type: 'mrkdwn', text: `*🪪 DNI:*\n${d.dni || '—'}` },
          { type: 'mrkdwn', text: `*📞 Celular:*\n${d.celular || '—'}` },
          { type: 'mrkdwn', text: `*📧 Correo:*\n${d.correo || '—'}` },
          { type: 'mrkdwn', text: `*🎯 Asesor:*\n${d.asesor || '—'}` },
          { type: 'mrkdwn', text: `*📅 Fecha Inicio:*\n${d.fecha_inicio || '—'}` },
        ]
      },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*💰 Precio Lista:*\n${d.moneda} ${Number(d.list_price).toFixed(2)}` },
          { type: 'mrkdwn', text: `*🏷️ Descuento:*\n${d.moneda} ${Number(d.discount_amount).toFixed(2)}` },
          { type: 'mrkdwn', text: `*✅ Total a Pagar:*\n${d.moneda} ${Number(d.total_amount).toFixed(2)}` },
          { type: 'mrkdwn', text: `*📋 Obs:*\n${d.notes || '—'}` },
        ]
      },
    ]

    // 3. Adjuntos como links dentro del mismo mensaje
    if (attachments.length > 0) {
      const linksText = attachments
        .map((a, i) => `• <${a.url}|${a.name || `Adjunto ${i + 1}`}>`)
        .join('\n')

      blocks.push({ type: 'divider' })
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📎 Constancias adjuntas (${attachments.length}):*\n${linksText}`
        }
      })
    } else {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '⚠️ Sin constancias adjuntas' }]
      })
    }

    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `Matrícula #${enrollment_id} · Registrada el ${d.fecha_registro}`
      }]
    })

    // 4. Un solo mensaje con todo
    await slackClient.chat.postMessage({
      channel: SLACK_CHANNEL,
      text:    `🌐 Nuevo Pago Web — ${d.program_name} — ${d.alumno}`,
      blocks,
    })

    return { ok: true, enrollment_id }

  } catch (error) {
    console.error('❌ Error en sendEnrollmentWebToSlack:', error)
    return { ok: false, error: error.message }
  }
}


async function syncLeadsToSheet({ user_id }) {
  // ---------------------------------------------------------
  // PASO 1: Obtener la configuración del Sheet del usuario
  // ---------------------------------------------------------
  const userQuery = await pool.query(
    `SELECT sheet_id, sheet_spring FROM users WHERE user_id = $1`, 
    [user_id]
  );

  if (userQuery.rows.length === 0) {
    return { ok: false, message: 'Usuario no encontrado en la base de datos.' };
  }

  const user = userQuery.rows[0];

  // Validar que tenga las credenciales de la hoja configuradas
  if (!user.sheet_id || !user.sheet_spring) {
    return { 
      ok: false, 
      message: 'El usuario no tiene un Google Sheet o nombre de hoja configurado.' 
    };
  }

  const spreadsheetId = user.sheet_id; 
  const sheetName = user.sheet_spring;

  // ---------------------------------------------------------
  // PASO 2: Obtener los leads
  // ---------------------------------------------------------
  const result = await pool.query(`SELECT * FROM public.sp_leads_report($1)`, [user_id]);
  const rows = result.rows || [];

  if (rows.length === 0) {
    return { 
      ok: true,
      message: 'El ODS se generó vacío. No se actualizó el Sheet.', 
      rows_generated: 0 
    };
  }

  const headers = Object.keys(rows[0]);
  
  const values = rows.map(row => {
    return headers.map(header => {
      const val = row[header];
      
      if (val === null || val === undefined) return '';
      
      if (val instanceof Date) {
         return val.toISOString().replace('T', ' ').substring(0, 19);
      }
      
      return String(val);
    });
  });

  // ---------------------------------------------------------
  // PASO 3: Escribir en Google Sheets
  // ---------------------------------------------------------
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), 'credentials/service.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const client = await auth.getClient();
  const googleSheets = google.sheets({ version: 'v4', auth: client });

  // A. Limpiar la hoja desde A2 hacia abajo
  try {
    await googleSheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A2:ZZ`, 
    });
  } catch (error) {
     console.warn("Advertencia al limpiar hoja:", error.message);
  }

  // B. Escribir los nuevos datos desde A2
  const res = await googleSheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A2`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: values,
    },
  });

  return { 
    ok: true, 
    rows_generated: rows.length, 
    sheet_updated_cells: res.data.updatedCells 
  };
}
async function syncInscToSheet({ enrollment_id }) {

  const spreadsheetId = '1B4NAcmk1QjwLV_NhfP4FPkQrdFWLdanvIg_gkPufCPg'; 
  const sheetName = '2. Base';

  const result = await pool.query(`SELECT * FROM public.sp_enrollment_lead_get($1)`, [enrollment_id])

  //insert en una fila nueva mas abajo el nuevo registro
  const rows = result.rows || []

  if (rows.length === 0) {
    return { 
      ok: true,
      message: 'El ODS se generó vacío. No se actualizó el Sheet.', 
      rows_generated: 0 
    }
  }

  const headers = Object.keys(rows[0])
  
  const values = rows.map(row => {
    return headers.map(header => {
      const val = row[header]
      
      if (val === null || val === undefined) return ''
      
      if (val instanceof Date) {
         return val.toISOString().replace('T', ' ').substring(0, 19) 
      }
      
      return String(val)
    })
  })

  // ---------------------------------------------------------
  // PASO 4: Escribir en Google Sheets
  // ---------------------------------------------------------
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), 'credentials/service.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  const client = await auth.getClient()
  const googleSheets = google.sheets({ version: 'v4', auth: client })

  // Obtener la última fila con datos para añadir el nuevo registro
  const getRange = `${sheetName}!A:A`; // Rango de la primera columna para encontrar la última fila
  const response = await googleSheets.spreadsheets.values.get({
    spreadsheetId,
    range: getRange,
  });
  const existingRows = response.data.values || [];
  const startRow = existingRows.length + 1; // Empezar a escribir en la siguiente fila disponible

  // B. Escribir los nuevos datos desde la fila encontrada
  const res = await googleSheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${startRow}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: values,
    },
  })
  

  return { 
    ok: true, 
    rows_generated: rows.length, 
    sheet_updated_cells: res.data.updatedCells 
  }
}

async function syncScheduleToSheet() {
  const spreadsheetId = '1vZHEs2URSJOxiBVlnwwgwKV-W-g_pWqdv-Y1wtXmfUc'; 
  const sheetName = 'PLANEAMIENTO';

  const result = await pool.query(`SELECT * FROM public.fn_reporte_ediciones_programas()`)
  const rows = result.rows || []

  const headers = Object.keys(rows[0])   
  
  const values = rows.map(row => {
    return headers.map(header => {
      const val = row[header]
      
      if (val === null || val === undefined) return ''
      
      if (val instanceof Date) {
         return val.toISOString().replace('T', ' ').substring(0, 19) 
      }
      
      return String(val)
    })
  })

  // ---------------------------------------------------------
  // PASO 4: Escribir en Google Sheets
  // ---------------------------------------------------------
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), 'credentials/service.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  const client = await auth.getClient()
  const googleSheets = google.sheets({ version: 'v4', auth: client })

  // A. Limpiar la hoja desde A2 hacia abajo
  try {
    await googleSheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A2:ZZ`, // Rango amplio
    })
  } catch (error) {
     console.warn("Advertencia al limpiar hoja:", error.message)
  }

  // B. Escribir los nuevos datos desde A2
  const res = await googleSheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A2`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: values,
    },
  })
  
  
  return { 
    ok: true, 
    rows_generated: rows.length, 
    sheet_updated_cells: res.data.updatedCells 
  }
}

async function syncRprospectos() {
  // ID extraído de la URL que proporcionaste
  const spreadsheetId = '1G05eeO8uCZkKL6RjxYEkQ6riCm3X1g-HbkgxHV6M0G4'; 
  const sheetName = '1. Consulta 26';

  // 1. Consultar la VISTA (sin parámetros, trae todo)
  const result = await pool.query(`SELECT * FROM public.vw_r_prospectos`)
  const rows = result.rows || []

  if (rows.length === 0) {
    return { 
      ok: true,
      message: 'La vista vw_r_prospectos no devolvió datos. No se actualizó el Sheet.', 
      rows_generated: 0 
    }
  }

  // 2. Preparar los datos (Headers y filas)
  // Nota: Como en la vista SQL ya hicimos los TO_CHAR, las fechas vendrán como strings
  const headers = Object.keys(rows[0])
   
  const values = rows.map(row => {
    return headers.map(header => {
      const val = row[header]
      
      if (val === null || val === undefined) return ''
      
      // Mantenemos esto por seguridad, aunque la vista ya devuelve strings
      if (val instanceof Date) {
         return val.toISOString().replace('T', ' ').substring(0, 19) 
      }
      
      return String(val)
    })
  })

  // 3. Autenticación con Google
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), 'credentials/service.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  const client = await auth.getClient()
  const googleSheets = google.sheets({ version: 'v4', auth: client })

  // 4. A: Limpiar la hoja SYSTEM desde A2 hacia abajo para evitar datos viejos
  try {
    await googleSheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A2:ZZ`, 
    })
  } catch (error) {
     console.warn("Advertencia al limpiar hoja en syncRprospectos:", error.message)
  }

  // 4. B: Escribir los nuevos datos
  const res = await googleSheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A2`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: values,
    },
  })

  return { 
    ok: true, 
    rows_generated: rows.length, 
    sheet_updated_cells: res.data.updatedCells 
  }
}

async function sendReportToSlack({ titulo, texto, imagenes = [], imagenesUrls = [] }) {
  try {
    // Unificar ambas formas de pasar archivos
    const todasImagenes = [...imagenes, ...imagenesUrls]

    const fileUploads = todasImagenes.map((img) => {
      // Caso 1: objeto con buffer (upload directo)
      if (img && img.buffer) {
        return { file: img.buffer, filename: img.filename || 'imagen.jpg' }
      }

      // Caso 2: string (ruta local o URL localhost)
      const rawPath = typeof img === 'string' ? img : null
      if (!rawPath) return null

      const localPath = rawPath.startsWith('http')
        ? path.join(process.cwd(), rawPath.replace(/^https?:\/\/[^/]+/, ''))
        : path.join(process.cwd(), rawPath)

      if (fs.existsSync(localPath)) {
        return { file: fs.readFileSync(localPath), filename: path.basename(localPath) }
      }

      console.warn('⚠️ Imagen no encontrada en disco:', localPath)
      return null
    }).filter(f => f !== null)

    if (fileUploads.length > 0) {
      await client.files.uploadV2({
        channel_id:      SLACK_CHANNEL,
        initial_comment: `*${titulo}*\n${texto}`,
        file_uploads:    fileUploads,
      })
      return { ok: true }
    }

    // Sin archivos → solo texto
    await client.chat.postMessage({
      channel: SLACK_CHANNEL,
      text:    titulo,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: titulo, emoji: true } },
        { type: 'section', text: { type: 'mrkdwn', text: texto } }
      ]
    })
    return { ok: true }

  } catch (error) {
    console.error('❌ Error enviando a Slack:', error)
    return { ok: false, error: error.message }
  }
}
export default {
  syncLeadsToSheet,
  syncInscToSheet,
  syncScheduleToSheet,
  syncRprospectos,
  syncEnrollmentToSheet,
  sendReportToSlack,
  sendEnrollmentWebToSlack,
}
