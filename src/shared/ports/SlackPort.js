// Contrato del puerto de notificaciones Slack. Define la forma que los usecases
// esperan, independiente del proveedor concreto. La implementacion vive en
// shared/adapters/slack. En tests se inyecta un doble que cumple este contrato.
//
// @typedef {Object} SlackPort
// @property {(p: {studentName, programName, editionCode, paymentType, amount, currency, isInstallment, notes, requestedByName}) => Promise<void>} notifyTokenCreated
// @property {(p: {students, groupTotal, currency, advisorName, createdByName, paymentUrl}) => Promise<void>} notifyTokenLinkAdded

export {}
