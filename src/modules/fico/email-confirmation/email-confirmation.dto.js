// Borde de salida hacia el cliente. Los correos transaccionales del service
// legacy devolvian sus result objects tal cual (passthrough), asi que se mantiene
// la paridad: el preview y los envios exponen su shape original. Endurecer a
// allowlist cuando el contrato con el front este fijado.

export const toPreviewDto = result => result

export const toSendResultDto = result => result

export const toEmailLogsDto = rows => rows
