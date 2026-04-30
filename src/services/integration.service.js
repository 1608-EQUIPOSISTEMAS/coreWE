import { pool } from '../config/db.js'
import { google } from 'googleapis'
import path from 'path'

import fs from 'fs';
import { WebClient } from '@slack/web-api'
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

// USAR PROCESS.ENV EN LUGAR DEL TEXTO DIRECTO

const SLACK_TOKEN   = process.env.SLACK_TOKEN
const SLACK_CHANNEL = process.env.SLACK_CHANNEL_MATCH_WEB
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
          { type: 'mrkdwn', text: `*📅 Fecha Inicio:*\n${d.fecha_inicio || '—'}` },
          { type: 'mrkdwn', text: `*📞 Celular:*\n${d.celular || '—'}` }, 
          { type: 'mrkdwn', text: `*🎯 Asesor:*\n${d.asesor || '—'}` },
          { type: 'mrkdwn', text: `*📋 Obs:*\n${d.notes || '—'}` }
        ]
      }
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
  const spreadsheetId = '1plkAWdZvcIRt2fRi-nK9NQKuHy86yj2pMD9mtjAxZHc'; 
  const sheetName = '3. SYSTEM';
 
  const result = await pool.query(`SELECT * FROM public.vw_r_prospectos`)
  const rows = result.rows || []

  if (rows.length === 0) {
    return { 
      ok: true,
      message: 'La vista vw_r_prospectos no devolvió datos. No se actualizó el Sheet.', 
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

// =====================================================================
// FICO Ventas a Google Sheets
// =====================================================================
// Sincroniza el listado de inscripciones APROBADAS a la hoja "0. Ventas Sistemas"
// del spreadsheet 19ALxQ0OhKDyjLY9WOowgN275ji81YXZ91uLQWDOeF_c.
//
// Reglas:
//  - Solo inscripciones con cat_fico_status = 'we_enrollment_status_checked' (aprobadas).
//  - Solo "ventas" reales: una fila por venta verdadera. Esto significa:
//      * PADRES de programas estructurados (ESP/PEE/DIPLOMADO) — el padre representa
//        la venta del programa completo. Los hijos (modulos internos / seguimientos)
//        NO se exportan aqui — se exportan en "1. Aula Sistemas" para vista academica.
//      * CURSOS STANDALONE — no tienen estructura padre/hijo, son ventas independientes.
//      * BECAS — son inscripciones top-level normales (parent_enrollment_id NULL).
//    Filtro: parent_enrollment_id IS NULL (todo lo que NO es hijo de otro enrollment).
//  - 20 columnas A..T, sobreescritura total desde fila 2 (asumiendo fila 1 = headers).
async function syncFicoSalesToSheet () {
  const SPREADSHEET_ID = '19ALxQ0OhKDyjLY9WOowgN275ji81YXZ91uLQWDOeF_c'
  const SHEET_NAME = '0. Ventas Sistemas'

  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), 'credentials/service.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  const authClient = await auth.getClient()
  const googleSheets = google.sheets({ version: 'v4', auth: authClient })

  const { rows } = await pool.query(`
    WITH approved AS (
      SELECT e.enrollment_id
        FROM public.enrollments e
        JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
       WHERE cf.alias = 'we_enrollment_status_checked'
         AND e.active = 'Y'
         AND e.parent_enrollment_id IS NULL
    )
    SELECT
      pv.version_code                                     AS cod,
      CASE WHEN e.program_edition_id IS NULL THEN 'E0'
           ELSE COALESCE(pe.global_code, '')
      END                                                  AS ed,
      to_char(pe.start_date, 'DD/MM/YYYY')                 AS f_inicio,
      to_char(
        COALESCE(
          l.pay_date,
          (SELECT py.payment_date
             FROM public.payments py
            WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'
            ORDER BY py.payment_date ASC
            LIMIT 1),
          e.registration_date::date
        ),
        'DD/MM/YYYY'
      )                                                    AS f_pago,
      per.document_number                                  AS dni,
      TRIM(BOTH FROM concat(per.first_name, ' ', per.last_name)) AS nombres,
      COALESCE(
        l.origin_phone,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      )                                                    AS celular,
      COALESCE(
        l.origin_email,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      )                                                    AS correo,
      CASE c_prof.alias
        WHEN 'we_profile_student' THEN 'E'
        ELSE 'P'
      END                                                  AS ocup,
      COALESCE(
        ag_token.alias,
        u.alias,
        e.agent_origin,
        'S/A'
      )                                                    AS asesor,
      CASE c_plan.alias
        WHEN 'we_payment_way_single'        THEN 'PT'
        WHEN 'we_payment_way_installments'  THEN 'PP'
        ELSE ''
      END                                                  AS estado,
      CASE
        WHEN COALESCE(e.list_price, 0) = 0 THEN ''
        ELSE replace(to_char(ROUND(e.discount_amount / e.list_price * 100, 2), 'FM999990.00'), '.', ',') || '%'
      END                                                  AS dsct,
      CASE
        WHEN COALESCE(pay_agg.total_paid, 0) >= (e.total_amount - e.discount_amount) THEN 'Saldado'
        WHEN inst_overdue.cnt > 0 THEN 'Deuda ' || inst_overdue.cnt::text
        ELSE 'Al dia'
      END                                                  AS al_dia,
      replace(to_char(COALESCE(pi_res.amount, 0), 'FM999990.00'), '.', ',') AS inicial,
      replace(to_char(GREATEST(0, (e.total_amount - e.discount_amount) - COALESCE(pay_agg.total_paid, 0)), 'FM999990.00'), '.', ',') AS saldo,
      replace(to_char(COALESCE(pay_agg.total_paid, 0), 'FM999990.00'), '.', ',') AS ingreso,
      COALESCE(c_moment.variable_2, '')                    AS tipo_cliente,
      'ACT'                                                AS estado_alumno,
      CASE WHEN COALESCE(prog.is_membership, false) THEN COALESCE(pv.abbreviation, '') ELSE '' END AS membresia,
      CASE WHEN c_mod.alias = 'we_insc_modality_flexible' THEN 'FLEX' ELSE '' END AS flex
    FROM public.enrollments e
    JOIN approved a ON a.enrollment_id = e.enrollment_id
    JOIN public.customers cust ON cust.customer_id = e.customer_id
    JOIN public.persons per   ON per.person_id   = cust.person_id
    LEFT JOIN public.leads l            ON l.enrollment_id = e.enrollment_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.programs prog       ON prog.program_id = pv.program_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.users u             ON u.user_id = e.seller_agent_id
    LEFT JOIN public."catalog" c_prof    ON c_prof.catalog_id = e.cat_profile_id
    LEFT JOIN public."catalog" c_plan    ON c_plan.catalog_id = e.cat_payment_plan
    LEFT JOIN public."catalog" c_mod     ON c_mod.catalog_id  = e.cat_inscription_modality
    LEFT JOIN public."catalog" c_moment  ON c_moment.catalog_id = l.cat_client_moment
    LEFT JOIN LATERAL (
      SELECT u_pt.alias
        FROM public.payment_tokens pt
        LEFT JOIN public.users u_pt ON u_pt.user_id = COALESCE(pt.requested_by, pt.created_by)
       WHERE pt.enrollment_id = e.enrollment_id
       ORDER BY pt.token_id ASC
       LIMIT 1
    ) ag_token ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(p.amount) AS total_paid
        FROM public.payments p
       WHERE p.enrollment_id = e.enrollment_id
         AND p.active = 'Y'
    ) pay_agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT amount FROM public.payment_installments
       WHERE enrollment_id = e.enrollment_id AND installment_number = 0
       LIMIT 1
    ) pi_res ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
        FROM public.payment_installments pi
        JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND pi.installment_number > 0
         AND pi.due_date < CURRENT_DATE
         AND cs.alias <> 'we_payment_status_paid'
    ) inst_overdue ON TRUE
    ORDER BY l.pay_date NULLS LAST, e.enrollment_id
  `)

  const values = (rows || []).map(r => [
    r.cod || '', r.ed || '', r.f_inicio || '', r.f_pago || '',
    r.dni || '', r.nombres || '', r.celular || '', r.correo || '',
    r.ocup || '', r.asesor || '', r.estado || '', r.dsct || '',
    r.al_dia || '', r.inicial || '', r.saldo || '', r.ingreso || '',
    r.tipo_cliente || '', r.estado_alumno || '',
    r.membresia || '', r.flex || ''
  ])

  // Limpiar desde A2 hasta T (preserva fila 1 con headers que el usuario maneja en sheet)
  await googleSheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A2:T`
  }).catch((e) => { console.warn('Advertencia al limpiar Ventas Sistemas:', e.message) })

  if (values.length > 0) {
    await googleSheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A2`,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    })
  }

  return { rows_synced: values.length, sheet: SHEET_NAME }
}

// =====================================================================
// FICO Aula a Google Sheets
// =====================================================================
// Sincroniza el listado de seguimientos (hijos de diplomados) y cursos solos
// a la hoja "1. Aula Sistemas" del mismo spreadsheet de FICO.
//
// Diferencia con "0. Ventas Sistemas":
//  - Esta es la vista ACADEMICA (matriculas activas a cada curso/modulo).
//  - Trae 16 columnas (sin desglose financiero detallado).
//  - Incluye CURSO (pv.version_code) y CATG (padre si es hijo de un diplomado).
async function syncFicoAulaToSheet () {
  const SPREADSHEET_ID = '19ALxQ0OhKDyjLY9WOowgN275ji81YXZ91uLQWDOeF_c'
  const SHEET_NAME = '1. Aula Sistemas'

  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(process.cwd(), 'credentials/service.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  const authClient = await auth.getClient()
  const googleSheets = google.sheets({ version: 'v4', auth: authClient })

  const { rows } = await pool.query(`
    WITH approved AS (
      SELECT e.enrollment_id
        FROM public.enrollments e
        JOIN public."catalog" cf ON cf.catalog_id = e.cat_fico_status
       WHERE cf.alias = 'we_enrollment_status_checked'
         AND e.active = 'Y'
         AND (
              e.parent_enrollment_id IS NOT NULL
           OR NOT EXISTS (SELECT 1 FROM public.enrollments c WHERE c.parent_enrollment_id = e.enrollment_id)
         )
    )
    SELECT
      pv.version_code                                      AS curso,
      COALESCE(pv_parent.version_code, '')                 AS catg,
      to_char(pe.start_date, 'DD/MM/YYYY')                 AS f_inicio,
      COALESCE(per.document_number, '')                    AS dni,
      TRIM(BOTH FROM concat(per.first_name, ' ', per.last_name)) AS nombres,
      COALESCE(
        l.origin_phone,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      )                                                    AS celular,
      COALESCE(
        l.origin_email,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      )                                                    AS correo,
      CASE c_prof.alias
        WHEN 'we_profile_student' THEN 'E'
        ELSE 'P'
      END                                                  AS ocup,
      COALESCE(ag_token.alias, u.alias, e.agent_origin, 'S/A') AS asesor,
      'ACT'                                                AS estado_alumno,
      CASE
        WHEN COALESCE(pay_agg.total_paid, 0) >= (e.total_amount - e.discount_amount) THEN 'Saldado'
        WHEN inst_overdue.cnt > 0 THEN 'Deuda ' || inst_overdue.cnt::text
        ELSE 'Al dia'
      END                                                  AS al_dia,
      replace(to_char(GREATEST(0, (e.total_amount - e.discount_amount) - COALESCE(pay_agg.total_paid, 0)), 'FM999990.00'), '.', ',') AS saldo,
      CASE c_plan.alias
        WHEN 'we_payment_way_single'        THEN 'PT'
        WHEN 'we_payment_way_installments'  THEN 'PP'
        ELSE ''
      END                                                  AS estado_pago,
      CASE
        WHEN COALESCE(e.list_price, 0) = 0 THEN ''
        ELSE replace(to_char(ROUND(e.discount_amount / e.list_price * 100, 1), 'FM999990.0'), '.', ',') || '%'
      END                                                  AS descuento,
      COALESCE(c_moment.variable_2, '')                    AS tipo_cliente,
      CASE WHEN COALESCE(prog.is_membership, false) THEN COALESCE(pv.abbreviation, '') ELSE '' END AS es_member
    FROM public.enrollments e
    JOIN approved a ON a.enrollment_id = e.enrollment_id
    JOIN public.customers cust ON cust.customer_id = e.customer_id
    JOIN public.persons per   ON per.person_id   = cust.person_id
    LEFT JOIN public.leads l            ON l.enrollment_id = e.enrollment_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.programs prog       ON prog.program_id = pv.program_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.users u             ON u.user_id = e.seller_agent_id
    LEFT JOIN public."catalog" c_prof    ON c_prof.catalog_id = e.cat_profile_id
    LEFT JOIN public."catalog" c_plan    ON c_plan.catalog_id = e.cat_payment_plan
    LEFT JOIN public."catalog" c_moment  ON c_moment.catalog_id = l.cat_client_moment
    LEFT JOIN public.enrollments e_parent ON e_parent.enrollment_id = e.parent_enrollment_id
    LEFT JOIN public.program_versions pv_parent ON pv_parent.program_version_id = e_parent.program_version_id
    LEFT JOIN LATERAL (
      SELECT u_pt.alias
        FROM public.payment_tokens pt
        LEFT JOIN public.users u_pt ON u_pt.user_id = COALESCE(pt.requested_by, pt.created_by)
       WHERE pt.enrollment_id = e.enrollment_id
       ORDER BY pt.token_id ASC
       LIMIT 1
    ) ag_token ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(p.amount) AS total_paid
        FROM public.payments p
       WHERE p.enrollment_id = e.enrollment_id AND p.active = 'Y'
    ) pay_agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
        FROM public.payment_installments pi
        JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND pi.installment_number > 0
         AND pi.due_date < CURRENT_DATE
         AND cs.alias <> 'we_payment_status_paid'
    ) inst_overdue ON TRUE
    ORDER BY pe.start_date NULLS LAST, per.last_name
  `)

  const values = (rows || []).map(r => [
    r.curso || '', r.catg || '', r.f_inicio || '', r.dni || '',
    r.nombres || '', r.celular || '', r.correo || '', r.ocup || '',
    r.asesor || '', r.estado_alumno || '', r.al_dia || '', r.saldo || '',
    r.estado_pago || '', r.descuento || '', r.tipo_cliente || '', r.es_member || ''
  ])

  await googleSheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A2:P`
  }).catch((e) => { console.warn('Advertencia al limpiar Aula Sistemas:', e.message) })

  if (values.length > 0) {
    await googleSheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A2`,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    })
  }

  return { rows_synced: values.length, sheet: SHEET_NAME }
}

// Sincroniza ambas hojas (Ventas + Aula) en una sola llamada.
// Es lo que el boton "Sincronizar ventas" del frontend dispara para minimizar
// clicks del operador FICO.
async function syncFicoToSheets () {
  const ventas = await syncFicoSalesToSheet()
  const aula = await syncFicoAulaToSheet()
  return { ventas, aula }
}

export default {
  syncLeadsToSheet,
  syncInscToSheet,
  syncScheduleToSheet,
  syncRprospectos,
  syncEnrollmentToSheet,
  syncFicoSalesToSheet,
  syncFicoAulaToSheet,
  syncFicoToSheets,
  sendReportToSlack,
  sendEnrollmentWebToSlack,
}
