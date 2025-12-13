import { pool } from '../plugins/db.js'
import { google } from 'googleapis'
import path from 'path'


async function syncLeadsToSheet({ user_id }) {
  const spreadsheetId = '1B4NAcmk1QjwLV_NhfP4FPkQrdFWLdanvIg_gkPufCPg'; 
  const sheetName = '2. Base';

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
  console.log("datassss")
  const spreadsheetId = '1-kp3PVfpsNQcl4HKBFnPkjTDVpAeLKgCaV5fEqs30gs'; 
  const sheetName = 'SISTEMAS-PILOTO';

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



export default {
  syncLeadsToSheet,
  syncInscToSheet,
  syncScheduleToSheet
}
