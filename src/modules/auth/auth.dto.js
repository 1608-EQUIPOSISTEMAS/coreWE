// Forma de salida hacia el cliente. Mantiene paridad con el service legacy:
// el JSON del usuario viene ya armado desde SQL y se envia tal cual junto al token.

export const toLoginDto = ({ token, user }) => ({ token, user })

export const toUserListDto = (rows) => rows
