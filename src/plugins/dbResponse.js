// src/plugins/dbResponse.js

// 1. Usamos "export class" en lugar de module.exports
export class BusinessError extends Error {
  constructor(message) {
    super(message);
    this.name = "BusinessError";
  }
}

/**
 * Procesa la respuesta estándar de los SPs
 */
// 2. Usamos "export function"
export function handleSpResponse(rows) {
  // 1. Validar que la BD haya respondido algo
  if (!rows || rows.length === 0) {
    throw new Error('Database Error: No response received from Procedure');
  }

  const response = rows[0]; 

  // 2. Verificar si es un error de negocio (controlado por el SP)
  if (response.result === 0) {
    throw new BusinessError(response.message || 'Operación fallida en base de datos');
  }

  // 3. Retornar la respuesta exitosa limpia
  return response;
}