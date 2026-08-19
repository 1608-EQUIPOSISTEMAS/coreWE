// Forma de salida hacia el cliente: los endpoints *list devuelven el envelope
// paginado que consumen las pantallas, *caller el arreglo pelado (es un
// autocomplete, no pagina), *get la primera fila, y *register/*update la fila
// de resultado del SP.

import { assertSpResult, firstRowOrEmpty, rowsOrEmpty, toPaginated } from './b2b.entity.js'

export const toCallerData = rowsOrEmpty
export const toListData = toPaginated
export const toGetData = firstRowOrEmpty
export const toMutationResult = assertSpResult
