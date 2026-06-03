import { enqueue, rescheduleJob } from '../../../services/job-queue.service.js'

// Adapter del JobQueuePort sobre la cola fico_jobs existente.
export const jobQueue = { enqueue, rescheduleJob }
