import { pool } from '../plugins/db.js'
import { google } from 'googleapis'
import path from 'path'

import { WebClient } from '@slack/web-api'

// ⚠️ IMPORTANTE: Pon esto en un archivo .env si puedes
const SLACK_TOKEN = 'xoxb-TU-NUEVO-TOKEN-AQUI'; 
const SLACK_CHANNEL = 'C0A0R9H3PGE'; // El ID del canal (puedes usar el de soporte o el de sistemas)

// Inicializamos el cliente
const client = new WebClient(SLACK_TOKEN);

async function syncEnrollmentToSheet() {
  const spreadsheetId = '1AUkktHwOmGr6DxYOy8TBULcXkYbURhmQwIgWqjXrIVA'; 
  const sheetName = 'SISTEMA-PILOTO';

const result = await pool.query(`SELECT * FROM public.vw_enrollment_report`)
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

  // A. Limpiar la hoja desde A2 hacia abajo
  try {
    await googleSheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A5:ZZ`, // Rango amplio
    })
  } catch (error) {
     console.warn("Advertencia al limpiar hoja:", error.message)
  }

  // B. Escribir los nuevos datos desde A2
  const res = await googleSheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A5`,
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


async function syncLeadsToSheet({ user_id }) {
  const spreadsheetId = '1CPbLaxvwnLDKSzk35--2YoIbu98nFQGLEXEg40OQGDw'; 
  const sheetName = 'SYSTEM';

  const result = await pool.query(`SELECT * FROM public.sp_leads_report($1)`, [user_id])
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


async function sendReportToSlack({ titulo, texto, imagenesUrls = [] }) {
  try {
    // 1. Bloque de cabecera
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: titulo,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: texto
        }
      },
      {
        type: 'divider'
      }
    ];

    // 2. Agregar dinámicamente las imágenes (si existen)
    // Slack permite bloques de tipo "image" que leen una URL pública
    imagenesUrls.forEach((url, index) => {
        if(url) {
            blocks.push({
                type: 'image',
                image_url: url,
                alt_text: `Imagen adjunta ${index + 1}`,
                title: {
                    type: 'plain_text',
                    text: `Evidencia ${index + 1}`,
                    emoji: true
                }
            });
        }
    });

    // 3. Enviar mensaje
    const result = await client.chat.postMessage({
      channel: SLACK_CHANNEL,
      text: titulo, // Texto fallback para notificaciones móviles
      blocks: blocks
    });

    console.log('✅ Reporte enviado a Slack:', result.ts);
    return { ok: true };

  } catch (error) {
    console.error('❌ Error enviando a Slack:', error);
    return { ok: false, error };
  }
}

export default {
  syncLeadsToSheet,
  syncInscToSheet,
  syncScheduleToSheet,
  syncRprospectos,
  syncEnrollmentToSheet
}
