// Tope de 200 por lote: cada correo sale en serie por ZeptoMail y la peticion
// tiene que terminar antes del timeout del proxy.
export const enviarEncuestasSchema = {
  body: {
    type: 'object',
    required: ['enrollment_ids'],
    additionalProperties: false,
    properties: {
      enrollment_ids: { type: 'array', minItems: 1, maxItems: 200, uniqueItems: true, items: { type: 'integer', minimum: 1 } }
    }
  }
}
