// Acceso a stored procedures que devuelven cursor o solo escalares.
// Los repositorios de cada modulo invocan SPs a traves de aqui.
export { callProcedureReturningRows, callProcedureNoCursor, callProcedureReturningResult } from '../../utils/spHelper.js'
