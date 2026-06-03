// Contrato del puerto de cola de trabajos asincronos (Postgres-backed).
// Los efectos lentos (Odoo, email) se difieren via enqueue para no bloquear la
// respuesta HTTP. La implementacion concreta vive en shared/adapters/jobs.
//
// @typedef {Object} JobQueuePort
// @property {(job: {jobType: string, enrollmentId?: number|null, payload?: object, maxAttempts?: number, runAt?: Date|string|null}) => Promise<object>} enqueue
// @property {(args: {jobId: number, runAt: Date|string}) => Promise<number>} rescheduleJob

export {}
