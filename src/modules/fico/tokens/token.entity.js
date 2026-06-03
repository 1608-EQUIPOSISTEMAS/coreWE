import { DomainError } from '../../../shared/errors.js'

// Reglas e invariantes puras del dominio de tokens de pago. Sin acceso a BD,
// red ni reloj oculto: todo entra por parametros y se valida sobre datos en
// memoria. Esto las hace testeables sin levantar nada.

export const MAX_TOKENS_PER_GROUP = 5
export const MAX_GROUP_AMOUNT = 3000

// Constantes del flujo de inscripcion en cuotas creada al confirmar un token.
export const CAT_INSTALLMENT_DRAFT = 3174
export const CAT_PAYMENT_PLAN_INSTALLMENTS = 2467

// Nombre completo del alumno a partir del payload de inscripcion del token.
export function inscriptionFullName (inscriptionData) {
  const insc = inscriptionData?.inscription
  if (!insc) return null
  const parts = [insc.full_name, insc.last_name, insc.mother_last_name]
    .map(s => (s || '').trim()).filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

// Deriva el estado inicial y la autoria del token segun si nace ya con link.
// Sin link: lo pidio el asesor (requested_by) y queda 'pending'.
// Con link: lo creo FICO (created_by) y queda 'link_sent'.
export function resolveCreateState ({ paymentUrl, userId }) {
  return {
    status: paymentUrl ? 'link_sent' : 'pending',
    requestedBy: paymentUrl ? null : userId,
    createdBy: paymentUrl ? userId : null
  }
}

// Decide si una inscripcion debe materializarse como plan de cuotas al confirmar.
export function isInstallmentInscription (inscription) {
  const plan = inscription?.installment_plan
  const adelanto = Number(inscription?.saved_money) || 0
  return Array.isArray(plan) && plan.length > 0 && adelanto > 0
}

// ---------------------------------------------------------------------------
// CONTRIBUCION: invariantes de agrupacion de tokens.
//
// Un asesor puede juntar 2+ tokens en un solo link de pago. Antes de agruparlos
// hay que validar que el conjunto es coherente. Esta funcion recibe las FILAS ya
// leidas de BD (cada una con: token_id, status, payment_url, requested_by,
// currency, cat_provider, payment_type, amount, group_id) y el id del asesor que
// hace la accion. Debe lanzar DomainError con un mensaje claro si algo no cumple,
// o devolver un resumen { total, currency, count } si todo es valido.
//
// Reglas a forzar (de la logica de negocio confirmada con FICO):
//   1. Cantidad entre 2 y MAX_TOKENS_PER_GROUP.
//   2. Propiedad: todos los tokens deben ser del asesor (requested_by === userId).
//   3. Estado: todos 'pending', sin payment_url y sin group_id previo.
//   4. Homogeneidad: misma currency, mismo cat_provider, mismo payment_type.
//   5. El total (suma de amount) no puede superar MAX_GROUP_AMOUNT.
//
// Decisiones que son tuyas y moldean el feature:
//   - El ORDEN en que validas define que mensaje de error ve el asesor primero.
//     Recomendado: cantidad -> propiedad -> estado -> homogeneidad -> monto, de lo
//     mas estructural a lo mas fino. Pero si crees que el limite de monto o la
//     moneda es lo que mas confunde al usuario, subelo.
//   - Como comparas homogeneidad: new Set(...).size === 1 es conciso; un bucle
//     explicito da mensajes por-campo. Elige segun la UX que quieras.
//   - Tipos: requested_by y userId pueden venir como number o string segun el
//     origen. Decide si normalizas con Number() (mas permisivo) o exiges ===.
//
// @param {Array<object>} tokens  filas de payment_tokens ya cargadas
// @param {number} userId         asesor que solicita agrupar
// @returns {{ total: number, currency: string, count: number }}
// @throws {DomainError}
export function assertGroupable (tokens, userId) {
  if (!Array.isArray(tokens) || tokens.length < 2) {
    throw new DomainError('Selecciona al menos 2 tokens para agrupar')
  }
  if (tokens.length > MAX_TOKENS_PER_GROUP) {
    throw new DomainError(`Maximo ${MAX_TOKENS_PER_GROUP} tokens por grupo`)
  }
  if (tokens.some(t => t.requested_by !== userId)) {
    throw new DomainError('Solo puedes agrupar tus propios tokens')
  }
  if (tokens.some(t => t.status !== 'pending' || t.payment_url || t.group_id)) {
    throw new DomainError('Solo tokens pendientes sin link y sin grupo previo pueden agruparse')
  }

  const allSame = field => new Set(tokens.map(t => t[field])).size === 1
  if (!allSame('currency')) throw new DomainError('Los tokens deben tener la misma moneda')
  if (!allSame('cat_provider')) throw new DomainError('Los tokens deben tener el mismo proveedor')
  if (!allSame('payment_type')) throw new DomainError('Los tokens deben tener el mismo tipo de pago (credito / debito)')

  const currency = tokens[0].currency
  const total = tokens.reduce((sum, t) => sum + Number(t.amount || 0), 0)
  if (total > MAX_GROUP_AMOUNT) {
    throw new DomainError(`El total del grupo (${currency} ${total.toFixed(2)}) supera el limite permitido de ${MAX_GROUP_AMOUNT}`)
  }

  return { total, currency, count: tokens.length }
}
