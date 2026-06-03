// Adaptacion de payloads de entrada del modulo integration.

// Mapea 'imagenesUrls' del body de la ruta a 'imagenes' que espera el usecase,
// preservando la traduccion que hacia la ruta legacy /send-slack-report.
export const mapSlackReportPayload = (body) => ({
  ...body,
  imagenes: body.imagenesUrls
})
