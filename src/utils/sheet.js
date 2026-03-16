const { google } = require("googleapis");

// Puedes factorizar la obtención del cliente para reutilizarlo
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: "credentials/service.json",
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// ===== LECTURA =====
async function leerDatos(spreadsheetId, rango) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rango,
  });
  return res.data.values;
}

async function escribirDatos(spreadsheetId, rango, valores, valueInputOption = "USER_ENTERED") {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: rango,
    valueInputOption, // "USER_ENTERED" aplica formato como si lo escribieras a mano
    requestBody: {
      range: rango,
      majorDimension: "ROWS",
      values: valores,
    },
  });
  return res.data;
}

async function appendFilas(
  spreadsheetId,
  rango,
  valores,
  valueInputOption = "USER_ENTERED",
  insertDataOption = "INSERT_ROWS"
) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: rango,
    valueInputOption,
    insertDataOption,
    requestBody: {
      majorDimension: "ROWS",
      values: valores,
    },
  });
  return res.data;
}

async function editarPorNombre(spreadsheetId, hoja, nombreBuscado, nuevosDatos) {
  const datos = await leerDatos(spreadsheetId, `${hoja}!A:Z`);
  
  // Buscar fila donde esté el nombre
  const filaIndex = datos.findIndex(fila => fila[0] === nombreBuscado); // columna A
  
  if (filaIndex === -1) {
    console.log("No se encontró el registro");
    return;
  }

  // Calcula la fila real (porque findIndex es base 0 y la hoja empieza en 1)
  const filaReal = filaIndex + 1;

  // Editar esa fila
  await escribirDatos(spreadsheetId, `${hoja}!A${filaReal}:Z${filaReal}`, [nuevosDatos]);
  console.log(`Fila ${filaReal} actualizada correctamente`);
}


module.exports = {
  leerDatos,
  escribirDatos,
  appendFilas,
};