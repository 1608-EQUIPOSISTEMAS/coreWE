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
      to_char(pay_eff.f_pago_date, 'DD/MM/YYYY')           AS f_pago,
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
      CASE
        WHEN e.agent_origin IS NOT NULL AND COALESCE(ag_token.alias, u.alias) IS NOT NULL
          THEN e.agent_origin || ' - ' || COALESCE(ag_token.alias, u.alias)
        ELSE COALESCE(ag_token.alias, u.alias, e.agent_origin, 'S/A')
      END                                                  AS asesor,
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
        WHEN COALESCE(pay_agg.total_paid, 0) >= (e.total_amount) THEN 'Saldado'
        WHEN inst_overdue.cnt > 0 THEN 'Deuda ' || inst_overdue.cnt::text
        ELSE 'Al dia'
      END                                                  AS al_dia,
      replace(to_char(COALESCE(pi_res.amount, 0), 'FM999990.00'), '.', ',') AS inicial,
      replace(to_char(GREATEST(0, (e.total_amount) - COALESCE(pay_agg.total_paid, 0)), 'FM999990.00'), '.', ',') AS saldo,
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
      -- Sumar monto de cuotas marcadas como pagadas, no de la tabla payments.
      -- Razon: payments puede tener filas duplicadas (re-confirmaciones que no
      -- desactivaron la fila previa). El estado canonico de "cuota saldada"
      -- vive en payment_installments.cat_status.
      -- Aceptamos ambos aliases que el sistema usa como sinonimos de "paid":
      -- 'we_inst_paid' (legacy) y 'we_payment_status_paid' (nuevo).
      SELECT COALESCE(SUM(pi.amount), 0) AS total_paid
        FROM public.payment_installments pi
        JOIN public."catalog" cs_pi ON cs_pi.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND cs_pi.alias IN ('we_inst_paid', 'we_payment_status_paid')
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
         AND cs.alias NOT IN ('we_inst_paid', 'we_payment_status_paid')
    ) inst_overdue ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        l.pay_date,
        (SELECT py.payment_date::date FROM public.payments py
          WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'
          ORDER BY py.payment_date ASC LIMIT 1),
        e.registration_date::date
      ) AS f_pago_date
    ) pay_eff ON TRUE
    ORDER BY pay_eff.f_pago_date NULLS LAST, e.enrollment_id
  `)

  const values = (rows || []).map(r => [
    r.cod || '', r.ed || '', r.f_inicio || '', r.f_pago || '',
    r.dni || '', r.nombres || '', r.celular || '', r.correo || '',
    r.ocup || '', r.asesor || '', r.estado || '', r.dsct || '',
    r.al_dia || '', r.inicial || '', r.saldo || '', r.ingreso || '',
    r.tipo_cliente || '', r.estado_alumno || '',
    r.membresia || '', r.flex || ''
  ])

  // Limpiar desde A2 hasta T (preserva fila 1 con headers que el usuario maneja en sheet).
  // El clear es obligatorio: si falla, el update siguiente solo sobrescribe las primeras N
  // filas y deja las filas viejas debajo, mezclando datos de corridas distintas.
  await googleSheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A2:T`
  })

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
      CASE
        WHEN e.agent_origin IS NOT NULL AND COALESCE(ag_token.alias, u.alias) IS NOT NULL
          THEN e.agent_origin || ' - ' || COALESCE(ag_token.alias, u.alias)
        ELSE COALESCE(ag_token.alias, u.alias, e.agent_origin, 'S/A')
      END AS asesor,
      'ACT'                                                AS estado_alumno,
      CASE
        WHEN COALESCE(pay_agg.total_paid, 0) >= (e.total_amount) THEN 'Saldado'
        WHEN inst_overdue.cnt > 0 THEN 'Deuda ' || inst_overdue.cnt::text
        ELSE 'Al dia'
      END                                                  AS al_dia,
      replace(to_char(GREATEST(0, (e.total_amount) - COALESCE(pay_agg.total_paid, 0)), 'FM999990.00'), '.', ',') AS saldo,
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
      -- Ver nota en syncFicoSalesToSheet: sumamos monto de cuotas saldadas
      -- (cat_status = paid) en lugar de SUM de payments, porque payments
      -- puede contener filas duplicadas que distorsionan el total.
      SELECT COALESCE(SUM(pi.amount), 0) AS total_paid
        FROM public.payment_installments pi
        JOIN public."catalog" cs_pi ON cs_pi.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND cs_pi.alias IN ('we_inst_paid', 'we_payment_status_paid')
    ) pay_agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
        FROM public.payment_installments pi
        JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND pi.installment_number > 0
         AND pi.due_date < CURRENT_DATE
         AND cs.alias NOT IN ('we_inst_paid', 'we_payment_status_paid')
    ) inst_overdue ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        l.pay_date,
        (SELECT py.payment_date::date FROM public.payments py
          WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'
          ORDER BY py.payment_date ASC LIMIT 1),
        e.registration_date::date
      ) AS f_pago_date
    ) pay_eff ON TRUE
    ORDER BY pay_eff.f_pago_date NULLS LAST, pe.start_date NULLS LAST, per.last_name
  `)

  const values = (rows || []).map(r => [
    r.curso || '', r.catg || '', r.f_inicio || '', r.dni || '',
    r.nombres || '', r.celular || '', r.correo || '', r.ocup || '',
    r.asesor || '', r.estado_alumno || '', r.al_dia || '', r.saldo || '',
    r.estado_pago || '', r.descuento || '', r.tipo_cliente || '', r.es_member || ''
  ])

  // Ver nota en syncFicoSalesToSheet sobre por que el clear no puede fallar en silencio.
  await googleSheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A2:P`
  })

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
// FICO Consolidado a Google Sheets
// =====================================================================
// Hoja "2. Consolidado" (31 columnas A..AE). Vista financiera detallada con
// cuotas pagadas explicitas (FC1..FC5 / C1..C5) y datos de la primer transaccion
// (medio, entidad empresa, banco, n.operacion).
//
// Reglas confirmadas con FICO:
//  - BECA (net_amount = 0): Estado='BECA', Dsct='100,00%', Status='Saldado',
//    Inicial/Saldo/Ingreso = '0', resto vacio.
//  - FC1..C5 SOLO incluyen cuotas en estado pagado (alias 'we_inst_paid' o
//    'we_payment_status_paid'). Pendientes/borrador no se exportan en estas columnas.
//  - PT (contado): Inicial = monto unico, FC/C todos vacios.
//  - PP (cuotas): Inicial = installment_number=0, FC/C 1..5 = cuotas pagadas.
//  - TIPO MONEDA, MEDIO, ENTIDAD EMPRESA, BANCO, N.OPERACION = del primer pago
//    activo (ORDER BY payment_id ASC). Vacios si beca/sin pagos.
async function syncFicoConsolidadoToSheet () {
  const SPREADSHEET_ID = '19ALxQ0OhKDyjLY9WOowgN275ji81YXZ91uLQWDOeF_c'
  const SHEET_NAME = '2. Consolidado'

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
      pv.version_code AS cod,
      CASE WHEN e.program_edition_id IS NULL THEN 'E0'
           ELSE COALESCE(pe.global_code, '')
      END AS ed,
      to_char(pe.start_date, 'DD/MM/YYYY') AS f_inicio,
      to_char(
        COALESCE(
          l.pay_date,
          first_pay.payment_date::date,
          e.registration_date::date
        ),
        'DD/MM/YYYY'
      ) AS f_pago,
      per.document_number AS dni,
      TRIM(BOTH FROM concat(per.first_name, ' ', per.last_name)) AS nombres,
      COALESCE(
        l.origin_phone,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      ) AS celular,
      COALESCE(
        l.origin_email,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      ) AS correo,
      CASE c_prof.alias
        WHEN 'we_profile_student' THEN 'E'
        ELSE 'P'
      END AS ocup,
      CASE
        WHEN e.agent_origin IS NOT NULL AND COALESCE(ag_token.alias, u.alias) IS NOT NULL
          THEN e.agent_origin || ' - ' || COALESCE(ag_token.alias, u.alias)
        ELSE COALESCE(ag_token.alias, u.alias, e.agent_origin, 'S/A')
      END AS asesor,
      CASE
        WHEN (e.total_amount) = 0 THEN 'BECA'
        WHEN c_plan.alias = 'we_payment_way_single'       THEN 'PT'
        WHEN c_plan.alias = 'we_payment_way_installments' THEN 'PP'
        ELSE ''
      END AS estado,
      CASE
        WHEN COALESCE(e.list_price, 0) = 0 THEN ''
        ELSE replace(to_char(ROUND(e.discount_amount / e.list_price * 100, 2), 'FM999990.00'), '.', ',') || '%'
      END AS dsct,
      CASE
        WHEN (e.total_amount) = 0 THEN 'Saldado'
        WHEN COALESCE(pay_agg.total_paid, 0) >= (e.total_amount) THEN 'Saldado'
        WHEN inst_overdue.cnt > 0 THEN 'Deuda ' || inst_overdue.cnt::text
        ELSE 'Al dia'
      END AS status_pago,
      CASE
        WHEN (e.total_amount) = 0 THEN '0'
        WHEN c_plan.alias = 'we_payment_way_single'
          THEN replace(to_char(COALESCE(pi_pt.amount, e.total_amount), 'FM999990.00'), '.', ',')
        WHEN c_plan.alias = 'we_payment_way_installments'
          THEN replace(to_char(COALESCE(pi_res.amount, 0), 'FM999990.00'), '.', ',')
        ELSE '0'
      END AS inicial,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c1_due IS NOT NULL
           THEN to_char(COALESCE(CASE WHEN cuotas.c1_paid THEN cuotas.c1_pay_date END, cuotas.c1_due), 'DD/MM/YYYY')
           ELSE '' END AS fc1,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c1_paid
           THEN replace(to_char(cuotas.c1_amount, 'FM999990.00'), '.', ',') ELSE '' END AS c1,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c2_due IS NOT NULL
           THEN to_char(COALESCE(CASE WHEN cuotas.c2_paid THEN cuotas.c2_pay_date END, cuotas.c2_due), 'DD/MM/YYYY')
           ELSE '' END AS fc2,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c2_paid
           THEN replace(to_char(cuotas.c2_amount, 'FM999990.00'), '.', ',') ELSE '' END AS c2,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c3_due IS NOT NULL
           THEN to_char(COALESCE(CASE WHEN cuotas.c3_paid THEN cuotas.c3_pay_date END, cuotas.c3_due), 'DD/MM/YYYY')
           ELSE '' END AS fc3,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c3_paid
           THEN replace(to_char(cuotas.c3_amount, 'FM999990.00'), '.', ',') ELSE '' END AS c3,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c4_due IS NOT NULL
           THEN to_char(COALESCE(CASE WHEN cuotas.c4_paid THEN cuotas.c4_pay_date END, cuotas.c4_due), 'DD/MM/YYYY')
           ELSE '' END AS fc4,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c4_paid
           THEN replace(to_char(cuotas.c4_amount, 'FM999990.00'), '.', ',') ELSE '' END AS c4,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c5_due IS NOT NULL
           THEN to_char(COALESCE(CASE WHEN cuotas.c5_paid THEN cuotas.c5_pay_date END, cuotas.c5_due), 'DD/MM/YYYY')
           ELSE '' END AS fc5,
      CASE WHEN c_plan.alias = 'we_payment_way_installments' AND cuotas.c5_paid
           THEN replace(to_char(cuotas.c5_amount, 'FM999990.00'), '.', ',') ELSE '' END AS c5,
      CASE
        WHEN (e.total_amount) = 0 THEN '0'
        ELSE replace(to_char(GREATEST(0, (e.total_amount) - COALESCE(pay_agg.total_paid, 0)), 'FM999990.00'), '.', ',')
      END AS saldo,
      CASE
        WHEN (e.total_amount) = 0 THEN '0'
        ELSE replace(to_char(COALESCE(pay_agg.total_paid, 0), 'FM999990.00'), '.', ',')
      END AS ingreso,
      CASE WHEN (e.total_amount) = 0 THEN ''
           ELSE CASE
                  WHEN curr.alias = 'we_currency_soles' THEN 'PEN'
                  WHEN curr.alias = 'we_currency_usd'   THEN 'USD'
                  -- Fallback por simbolo: cubre enrollments viejos con aliases
                  -- typo en BD (we_currency_dolares/dollars) que el codigo dejo
                  -- de generar el 2026-05-18 pero que pueden seguir en catalog.
                  WHEN curr.variable_2 = '$'            THEN 'USD'
                  WHEN curr.variable_2 IN ('S/', 'S/.') THEN 'PEN'
                  ELSE COALESCE(curr.variable_2, '')
                END
           END AS tipo_moneda,
      CASE WHEN (e.total_amount) = 0 THEN ''
           ELSE COALESCE(c_meth.description, '') END AS medio_pago,
      CASE WHEN (e.total_amount) = 0 THEN ''
           ELSE COALESCE(c_be.description, '') END AS entidad_empresa,
      CASE WHEN (e.total_amount) = 0 THEN ''
           ELSE COALESCE(ba.bank_name, '') END AS entidad_financiera,
      CASE WHEN (e.total_amount) = 0 THEN ''
           ELSE COALESCE(first_pay.transaction_code, '') END AS n_operacion
    FROM public.enrollments e
    JOIN approved a ON a.enrollment_id = e.enrollment_id
    JOIN public.customers cust ON cust.customer_id = e.customer_id
    JOIN public.persons per   ON per.person_id   = cust.person_id
    LEFT JOIN public.leads l            ON l.enrollment_id = e.enrollment_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.users u             ON u.user_id = e.seller_agent_id
    LEFT JOIN public."catalog" c_prof    ON c_prof.catalog_id = e.cat_profile_id
    LEFT JOIN public."catalog" c_plan    ON c_plan.catalog_id = e.cat_payment_plan
    LEFT JOIN public."catalog" curr      ON curr.catalog_id   = e.cat_currency
    LEFT JOIN LATERAL (
      SELECT u_pt.alias
        FROM public.payment_tokens pt
        LEFT JOIN public.users u_pt ON u_pt.user_id = COALESCE(pt.requested_by, pt.created_by)
       WHERE pt.enrollment_id = e.enrollment_id
       ORDER BY pt.token_id ASC
       LIMIT 1
    ) ag_token ON TRUE
    LEFT JOIN LATERAL (
      -- Ver nota en syncFicoSalesToSheet: sumamos monto de cuotas saldadas
      -- (cat_status = paid) en lugar de SUM de payments, porque payments
      -- puede contener filas duplicadas que distorsionan el total.
      SELECT COALESCE(SUM(pi.amount), 0) AS total_paid
        FROM public.payment_installments pi
        JOIN public."catalog" cs_pi ON cs_pi.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND cs_pi.alias IN ('we_inst_paid', 'we_payment_status_paid')
    ) pay_agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT amount FROM public.payment_installments
       WHERE enrollment_id = e.enrollment_id AND installment_number = 0
       LIMIT 1
    ) pi_res ON TRUE
    LEFT JOIN LATERAL (
      SELECT amount FROM public.payment_installments
       WHERE enrollment_id = e.enrollment_id AND installment_number = 1
       LIMIT 1
    ) pi_pt ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
        FROM public.payment_installments pi
        JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND pi.installment_number > 0
         AND pi.due_date < CURRENT_DATE
         AND cs.alias NOT IN ('we_inst_paid', 'we_payment_status_paid')
    ) inst_overdue ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        p.payment_date, p.transaction_code,
        p.cat_method_payment, p.settled_in_account_id
      FROM public.payments p
      WHERE p.enrollment_id = e.enrollment_id AND p.active = 'Y'
      ORDER BY p.payment_id ASC
      LIMIT 1
    ) first_pay ON TRUE
    LEFT JOIN public.bank_accounts ba ON ba.account_id = first_pay.settled_in_account_id
    LEFT JOIN public."catalog" c_meth ON c_meth.catalog_id = first_pay.cat_method_payment
    LEFT JOIN public."catalog" c_be   ON c_be.catalog_id = ba.business_entity_catalog_id
    LEFT JOIN LATERAL (
      -- Para cada cuota 1..5 devolvemos due_date (siempre que la cuota exista),
      -- pay_date (solo si fue pagada) y un flag c{N}_paid. La fecha de pago real
      -- gana sobre la fecha de vencimiento cuando la cuota ya esta pagada.
      -- Excluimos anuladas para que no aparezcan como cuota fantasma.
      SELECT
        MAX(CASE WHEN pi.installment_number = 1 THEN pi.due_date END) AS c1_due,
        MAX(CASE WHEN pi.installment_number = 1 AND cs.alias IN ('we_inst_paid','we_payment_status_paid') THEN p.payment_date::date END) AS c1_pay_date,
        MAX(CASE WHEN pi.installment_number = 1 THEN pi.amount END)   AS c1_amount,
        BOOL_OR(pi.installment_number = 1 AND cs.alias IN ('we_inst_paid','we_payment_status_paid')) AS c1_paid,
        MAX(CASE WHEN pi.installment_number = 2 THEN pi.due_date END) AS c2_due,
        MAX(CASE WHEN pi.installment_number = 2 AND cs.alias IN ('we_inst_paid','we_payment_status_paid') THEN p.payment_date::date END) AS c2_pay_date,
        MAX(CASE WHEN pi.installment_number = 2 THEN pi.amount END)   AS c2_amount,
        BOOL_OR(pi.installment_number = 2 AND cs.alias IN ('we_inst_paid','we_payment_status_paid')) AS c2_paid,
        MAX(CASE WHEN pi.installment_number = 3 THEN pi.due_date END) AS c3_due,
        MAX(CASE WHEN pi.installment_number = 3 AND cs.alias IN ('we_inst_paid','we_payment_status_paid') THEN p.payment_date::date END) AS c3_pay_date,
        MAX(CASE WHEN pi.installment_number = 3 THEN pi.amount END)   AS c3_amount,
        BOOL_OR(pi.installment_number = 3 AND cs.alias IN ('we_inst_paid','we_payment_status_paid')) AS c3_paid,
        MAX(CASE WHEN pi.installment_number = 4 THEN pi.due_date END) AS c4_due,
        MAX(CASE WHEN pi.installment_number = 4 AND cs.alias IN ('we_inst_paid','we_payment_status_paid') THEN p.payment_date::date END) AS c4_pay_date,
        MAX(CASE WHEN pi.installment_number = 4 THEN pi.amount END)   AS c4_amount,
        BOOL_OR(pi.installment_number = 4 AND cs.alias IN ('we_inst_paid','we_payment_status_paid')) AS c4_paid,
        MAX(CASE WHEN pi.installment_number = 5 THEN pi.due_date END) AS c5_due,
        MAX(CASE WHEN pi.installment_number = 5 AND cs.alias IN ('we_inst_paid','we_payment_status_paid') THEN p.payment_date::date END) AS c5_pay_date,
        MAX(CASE WHEN pi.installment_number = 5 THEN pi.amount END)   AS c5_amount,
        BOOL_OR(pi.installment_number = 5 AND cs.alias IN ('we_inst_paid','we_payment_status_paid')) AS c5_paid
      FROM public.payment_installments pi
      JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
      LEFT JOIN public.payments p ON p.installment_id = pi.installment_id AND p.active = 'Y'
      WHERE pi.enrollment_id = e.enrollment_id
        AND pi.installment_number BETWEEN 1 AND 5
        AND cs.alias <> 'we_inst_cancelled'
    ) cuotas ON TRUE
    ORDER BY COALESCE(l.pay_date, first_pay.payment_date::date, e.registration_date::date) NULLS LAST, e.enrollment_id
  `)

  const values = (rows || []).map(r => [
    r.cod || '', r.ed || '', r.f_inicio || '', r.f_pago || '',
    r.dni || '', r.nombres || '', r.celular || '', r.correo || '',
    r.ocup || '', r.asesor || '', r.estado || '', r.dsct || '',
    r.status_pago || '', r.inicial || '',
    r.fc1 || '', r.c1 || '', r.fc2 || '', r.c2 || '',
    r.fc3 || '', r.c3 || '', r.fc4 || '', r.c4 || '',
    r.fc5 || '', r.c5 || '',
    r.saldo || '', r.ingreso || '',
    r.tipo_moneda || '', r.medio_pago || '',
    r.entidad_empresa || '', r.entidad_financiera || '',
    r.n_operacion || ''
  ])

  // 31 columnas A..AE. Limpiamos desde A2 (preserva la fila de headers).
  // Ver nota en syncFicoSalesToSheet sobre por que el clear no puede fallar en silencio.
  await googleSheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A2:AE`
  })

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

// Verifica que la hoja exista en el spreadsheet; si no, la crea y escribe la
// fila de headers. Necesario para hojas generadas por codigo (no pre-armadas
// manualmente en Drive). Idempotente: si ya existe, no hace nada.
async function ensureSheetExists (googleSheets, spreadsheetId, sheetName, headersRow) {
  const meta = await googleSheets.spreadsheets.get({ spreadsheetId })
  const exists = (meta.data?.sheets || []).some(s => s.properties?.title === sheetName)
  if (exists) return false

  await googleSheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
  })

  if (headersRow && headersRow.length > 0) {
    await googleSheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [headersRow] }
    })
  }
  return true
}

// Hoja "3. Cuotas": una fila por inscripcion con PLAN DE CUOTAS (PP) aprobada
// por FICO. Las cuotas se pivotan a lo ancho en dos bloques:
//   - Pago real (A..BF): 10 cols base + 8 grupos de 6 cols
//     (FCn, Cn, MEDIO, ENTIDAD EMPRESA, ENTIDAD FINANCIERA, N. OPERACION).
//   - Proyeccion  (BG..BV): 8 grupos de 2 cols (F.PAGO Cn, Cn).
//
// Reglas:
//  - Solo PP (cat_payment_plan='we_payment_way_installments') aprobados FICO.
//  - Bloque PAGO REAL — refleja caja efectivamente cobrada:
//      paid    -> FCn = payment_date real, Cn = monto cobrado, metadata del payments.
//      pending -> FCn = due_date,          Cn vacio, metadata vacia. El monto
//                 solo se publica al confirmar el pago para evitar inflar el
//                 saldo aparente cuando aun no ingresa caja.
//  - Bloque PROYECCION — refleja el plan original tal como se acordo:
//      F.PAGO Cn = due_date siempre, Cn = pi.amount siempre. Sirve para
//      comparar plan vs ejecucion lado a lado sin perder el cronograma.
//  - Anuladas (we_inst_cancelled) se excluyen de ambos bloques.
//  - Cuota 0 (inicial/reserva) NO se incluye: solo las cuotas reales del plan.
//  - Si una inscripcion tiene > 8 cuotas, se trunca y se loguea cuantas se omiten.
async function syncFicoCuotasToSheet () {
  const SPREADSHEET_ID = '19ALxQ0OhKDyjLY9WOowgN275ji81YXZ91uLQWDOeF_c'
  const SHEET_NAME = '3. Cuotas'
  const MAX_CUOTAS = 8

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
      e.enrollment_id,
      pv.version_code AS cod,
      CASE WHEN e.program_edition_id IS NULL THEN 'E0'
           ELSE COALESCE(pe.global_code, '')
      END AS ed,
      to_char(pe.start_date, 'DD/MM/YYYY') AS f_inicio,
      TRIM(BOTH FROM concat(per.first_name, ' ', per.last_name)) AS nombres,
      COALESCE(
        l.origin_phone,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_phone'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      ) AS celular,
      COALESCE(
        l.origin_email,
        (SELECT pc.value FROM public.person_contacts pc
          JOIN public."catalog" c ON c.catalog_id = pc.cat_way_contact AND c.alias = 'we_way_contact_email'
         WHERE pc.person_id = per.person_id AND pc.active = 'Y'
         ORDER BY pc.registration_date DESC LIMIT 1)
      ) AS correo,
      CASE c_prof.alias
        WHEN 'we_profile_student' THEN 'E'
        ELSE 'P'
      END AS ocup,
      CASE
        WHEN e.agent_origin IS NOT NULL AND COALESCE(ag_token.alias, u.alias) IS NOT NULL
          THEN e.agent_origin || ' - ' || COALESCE(ag_token.alias, u.alias)
        ELSE COALESCE(ag_token.alias, u.alias, e.agent_origin, 'S/A')
      END AS asesor,
      CASE
        WHEN COALESCE(pay_agg.total_paid, 0) >= e.total_amount THEN 'Saldado'
        WHEN inst_overdue.cnt > 0 THEN 'Deuda ' || inst_overdue.cnt::text
        ELSE 'Al dia'
      END AS estado,
      CASE
        WHEN curr.alias = 'we_currency_soles' THEN 'PEN'
        WHEN curr.alias = 'we_currency_usd'   THEN 'USD'
        -- Ver nota en syncFicoConsolidadoToSheet: aliases typo (dolares/dollars)
        -- escapan los WHEN explicitos y caen al simbolo. Mapeamos por simbolo
        -- como segunda capa hasta que el catalog en BD quede canonizado.
        WHEN curr.variable_2 = '$'            THEN 'USD'
        WHEN curr.variable_2 IN ('S/', 'S/.') THEN 'PEN'
        ELSE COALESCE(curr.variable_2, '')
      END AS moneda,
      (
        SELECT jsonb_agg(cuota_row ORDER BY cuota_row.num ASC)
        FROM (
          SELECT
            pi.installment_number AS num,
            CASE WHEN cs.alias IN ('we_inst_paid', 'we_payment_status_paid') AND p.payment_date IS NOT NULL
                 THEN to_char(p.payment_date, 'DD/MM/YYYY')
                 ELSE to_char(pi.due_date, 'DD/MM/YYYY')
            END AS fc,
            CASE WHEN cs.alias IN ('we_inst_paid', 'we_payment_status_paid')
                 THEN replace(to_char(pi.amount, 'FM999990.00'), '.', ',')
                 ELSE ''
            END AS monto,
            CASE WHEN cs.alias IN ('we_inst_paid', 'we_payment_status_paid')
                 THEN COALESCE(c_meth.description, '')
                 ELSE ''
            END AS medio_pago,
            CASE WHEN cs.alias IN ('we_inst_paid', 'we_payment_status_paid')
                 THEN COALESCE(c_be.description, '')
                 ELSE ''
            END AS entidad_empresa,
            CASE WHEN cs.alias IN ('we_inst_paid', 'we_payment_status_paid')
                 THEN COALESCE(ba.bank_name, '')
                 ELSE ''
            END AS entidad_financiera,
            CASE WHEN cs.alias IN ('we_inst_paid', 'we_payment_status_paid')
                 THEN COALESCE(p.transaction_code, '')
                 ELSE ''
            END AS n_operacion,
            to_char(pi.due_date, 'DD/MM/YYYY') AS fc_proyeccion,
            replace(to_char(pi.amount, 'FM999990.00'), '.', ',') AS monto_proyeccion
          FROM public.payment_installments pi
          JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
          LEFT JOIN public.payments p     ON p.installment_id = pi.installment_id AND p.active = 'Y'
          LEFT JOIN public.bank_accounts ba ON ba.account_id = p.settled_in_account_id
          LEFT JOIN public."catalog" c_meth ON c_meth.catalog_id = p.cat_method_payment
          LEFT JOIN public."catalog" c_be   ON c_be.catalog_id = ba.business_entity_catalog_id
          WHERE pi.enrollment_id = e.enrollment_id
            AND pi.installment_number > 0
            AND cs.alias <> 'we_inst_cancelled'
        ) cuota_row
      ) AS cuotas_json
    FROM public.enrollments e
    JOIN approved a ON a.enrollment_id = e.enrollment_id
    JOIN public.customers cust ON cust.customer_id = e.customer_id
    JOIN public.persons per   ON per.person_id   = cust.person_id
    LEFT JOIN public.leads l            ON l.enrollment_id = e.enrollment_id
    LEFT JOIN public.program_versions pv ON pv.program_version_id = e.program_version_id
    LEFT JOIN public.program_editions pe ON pe.edition_num_id = e.program_edition_id
    LEFT JOIN public.users u             ON u.user_id = e.seller_agent_id
    LEFT JOIN public."catalog" c_prof    ON c_prof.catalog_id = e.cat_profile_id
    LEFT JOIN public."catalog" c_plan    ON c_plan.catalog_id = e.cat_payment_plan
    LEFT JOIN public."catalog" curr      ON curr.catalog_id   = e.cat_currency
    LEFT JOIN LATERAL (
      SELECT u_pt.alias FROM public.payment_tokens pt
        LEFT JOIN public.users u_pt ON u_pt.user_id = COALESCE(pt.requested_by, pt.created_by)
       WHERE pt.enrollment_id = e.enrollment_id
       ORDER BY pt.token_id ASC LIMIT 1
    ) ag_token ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(pi.amount), 0) AS total_paid
        FROM public.payment_installments pi
        JOIN public."catalog" cs_pi ON cs_pi.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND cs_pi.alias IN ('we_inst_paid', 'we_payment_status_paid')
    ) pay_agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS cnt
        FROM public.payment_installments pi
        JOIN public."catalog" cs ON cs.catalog_id = pi.cat_status
       WHERE pi.enrollment_id = e.enrollment_id
         AND pi.installment_number > 0
         AND pi.due_date < CURRENT_DATE
         AND cs.alias NOT IN ('we_inst_paid', 'we_payment_status_paid')
    ) inst_overdue ON TRUE
    WHERE c_plan.alias = 'we_payment_way_installments'
    ORDER BY e.enrollment_id
  `)

  let truncatedCuotas = 0
  let truncatedEnrollments = 0
  const values = (rows || []).map(r => {
    const baseCols = [
      r.cod || '', r.ed || '', r.f_inicio || '',
      r.nombres || '', r.celular || '', r.correo || '',
      r.ocup || '', r.asesor || '', r.estado || '', r.moneda || ''
    ]
    const cuotas = Array.isArray(r.cuotas_json) ? r.cuotas_json : []
    if (cuotas.length > MAX_CUOTAS) {
      truncatedCuotas += cuotas.length - MAX_CUOTAS
      truncatedEnrollments++
      console.warn(`[syncFicoCuotasToSheet] enrollment_id=${r.enrollment_id} truncado: ${cuotas.length} cuotas -> mostrando primeras ${MAX_CUOTAS}`)
    }
    const cuotaCols = []
    const proyeccionCols = []
    for (let i = 0; i < MAX_CUOTAS; i++) {
      const cuota = cuotas[i]
      if (cuota) {
        cuotaCols.push(
          cuota.fc || '',
          cuota.monto || '',
          cuota.medio_pago || '',
          cuota.entidad_empresa || '',
          cuota.entidad_financiera || '',
          cuota.n_operacion || ''
        )
        proyeccionCols.push(
          cuota.fc_proyeccion || '',
          cuota.monto_proyeccion || ''
        )
      } else {
        cuotaCols.push('', '', '', '', '', '')
        proyeccionCols.push('', '')
      }
    }
    return [...baseCols, ...cuotaCols, ...proyeccionCols]
  })

  if (truncatedEnrollments > 0) {
    console.warn(`[syncFicoCuotasToSheet] Total: ${truncatedEnrollments} enrollments con mas de ${MAX_CUOTAS} cuotas, ${truncatedCuotas} cuotas omitidas`)
  }

  // 10 base + 8 * 6 = 58 cols pago real (A..BF) + 8 * 2 = 16 cols proyeccion
  // (BG..BV). Total = 74 cols. Las proyecciones repiten fecha+monto siempre,
  // sin importar si la cuota esta pagada — sirven a Finanzas para comparar
  // plan vs ejecucion sin perder el cronograma original.
  const HEADER_ROW = ['COD', 'ED', 'F. INICIO', 'NOMBRES Y APELLIDOS', 'CELULAR', 'CORREO', 'OCUP', 'AS', 'ESTADO', 'MONEDA']
  for (let i = 1; i <= MAX_CUOTAS; i++) {
    HEADER_ROW.push(`FC${i}`, `C${i}`, 'MEDIO DE PAGO', 'ENTIDAD EMPRESA', 'ENTIDAD FINANCIERA', 'N° OPERACION')
  }
  for (let i = 1; i <= MAX_CUOTAS; i++) {
    HEADER_ROW.push(`F.PAGO C${i}`, `C${i}`)
  }
  const created = await ensureSheetExists(googleSheets, SPREADSHEET_ID, SHEET_NAME, HEADER_ROW)

  // Ver nota en syncFicoSalesToSheet sobre por que el clear no puede fallar en silencio.
  await googleSheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A2:BV`
  })

  if (values.length > 0) {
    await googleSheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A2`,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    })
  }

  return {
    rows_synced: values.length,
    sheet: SHEET_NAME,
    sheet_created: created,
    truncated_cuotas: truncatedCuotas,
    truncated_enrollments: truncatedEnrollments
  }
}

// Sincroniza las hojas FICO (Ventas + Aula + Consolidado + Cuotas) en una
// sola llamada. Es lo que el boton "Sincronizar ventas" del frontend dispara
// para minimizar clicks del operador FICO.
async function syncFicoToSheets () {
  const ventas = await syncFicoSalesToSheet()
  const aula = await syncFicoAulaToSheet()
  const consolidado = await syncFicoConsolidadoToSheet()
  const cuotas = await syncFicoCuotasToSheet()
  return { ventas, aula, consolidado, cuotas }
}

export default {
  syncLeadsToSheet,
  syncInscToSheet,
  syncScheduleToSheet,
  syncRprospectos,
  syncEnrollmentToSheet,
  syncFicoSalesToSheet,
  syncFicoAulaToSheet,
  syncFicoConsolidadoToSheet,
  syncFicoCuotasToSheet,
  syncFicoToSheets,
  sendReportToSlack,
  sendEnrollmentWebToSlack,
}
