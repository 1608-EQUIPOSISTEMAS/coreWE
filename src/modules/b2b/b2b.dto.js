// Forma de salida hacia el cliente. Mantiene paridad de shape con el service legacy:
// los endpoints *list/*caller devuelven el arreglo de filas, los *get la primera fila,
// y los *register/*update la fila de resultado del SP.

import { assertSpResult, firstRowOrEmpty, rowsOrEmpty } from './b2b.entity.js'

export const toListData = rowsOrEmpty
export const toGetData = firstRowOrEmpty
export const toMutationResult = assertSpResult
