// Puente hacia operaciones de la cola fico_jobs que el JobQueuePort de shared
// aun no expone. El adapter compartido (postgres-queue.adapter.js) ya cubre
// enqueue/rescheduleJob, pero NO getLatestJobByEnrollment, que este subdominio
// necesita para decidir entre reagendar el job existente o encolar uno nuevo.
//
// Se aisla aqui para que, cuando el orquestador amplie el adapter compartido,
// el cambio sea reemplazar este import por el del adapter sin tocar el usecase.
export { getLatestJobByEnrollment } from '../../../services/job-queue.service.js'
