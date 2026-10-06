import { authenticate, hasRole, hasModuleOrRole } from '../../shared/http/auth.middleware.js'
import {
  editionRegisterSchema,
  editionTreeRegisterSchema,
  auditLogsGetSchema,
  editionListSchema,
  classroomMetricsListSchema,
  classroomStudentsListSchema,
  classroomStudentsHistorySchema,
  academicStudentSearchSchema,
  classroomAuditGetSchema,
  classroomAuditSaveSchema,
  classroomAuditSummaryListSchema,
  classroomGradesGetSchema,
  classroomGradesSaveSchema,
  classroomGradesObservationsSchema,
  b2bTrackingListSchema,
  b2bAttendanceSaveSchema,
  classroomOdooCertifySchema,
  reportRecommendationsSchema,
  editionByWeekListSchema,
  weeklySessionsSchema,
  weeklyControlSchema,
  weeklyClosuresSchema,
  closureSaveSchema,
  teacherFollowupSchema,
  sessionControlSaveSchema,
  editionGetSchema,
  editionUpdateSchema,
  classroomLinksSaveSchema,
  eventEditionsListSchema,
  eventGoalsSaveSchema,
  eventResourcesGetSchema,
  eventResourcesSaveSchema,
  eventCategoriesSaveSchema,
  editionCallerSchema,
  editionExtraInfoCallerSchema,
  editionTreeUpdateSchema,
  bulkUpdateWhatsappSchema,
  a5PendingEnrollmentsSchema,
  classroomGradesObservationsStartSchema,
  reportRecommendationsStartSchema,
  aiJobStatusSchema,
  a5CancelAndHandOffSchema,
  schedulePdfSchema
} from './edition.schemas.js'
import * as ctrl from './edition.controller.js'

// Escribir el cronograma (crear/editar ediciones, cancelar A5, cargar links en
// masa) es de Producto: por ROL y no por modulo, porque la matriz tambien le da
// el modulo PRODUCTO a Academica (06/10/26). Academica mantiene los links del
// aula por /classroomlinkssave.
const CRONOGRAMA_WRITERS = hasRole(['ADMIN', 'PRODUCTO', 'LIDER_PRODUCTO'])
// Alumnos con correo/celular: AulaDetail (Academica) y el modal del aula de
// Cronograma Vista (gerencia y lideres).
const CLASSROOM_STUDENTS_READERS = hasModuleOrRole('ACADEMICA', [
  'ADMIN', 'GERENCIA', 'ACADEMICA', 'LIDER_ACADEMICA', 'LIDER_PRODUCTO',
  'LIDER_COMERCIAL', 'LIDER_FICO', 'LIDER_FUNDACION', 'LIDER_B2B'
])

export default async function editionRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)

  fastify.post('/editionregister', {
    schema: editionRegisterSchema,
    preHandler: CRONOGRAMA_WRITERS
  }, ctrl.registerHandler)

  fastify.post('/editiontreeregister', {
    schema: editionTreeRegisterSchema,
    preHandler: CRONOGRAMA_WRITERS
  }, ctrl.treeRegisterHandler)

  fastify.post('/auditlogsget', {
    schema: auditLogsGetSchema
  }, ctrl.auditLogsGetHandler)

  fastify.post('/editionlist', {
    schema: editionListSchema
  }, ctrl.listHandler)

  fastify.post('/editionbyweeklist', {
    schema: editionByWeekListSchema
  }, ctrl.byWeekListHandler)

  // Vista Semanal Academica: aulas en curso por dia con nº de sesion.
  fastify.post('/weeklysessions', {
    schema: weeklySessionsSchema
  }, ctrl.weeklySessionsHandler)

  // Control de ediciones: aulas que inician en la semana + estados por sesion.
  fastify.post('/weeklycontrol', {
    schema: weeklyControlSchema
  }, ctrl.weeklyControlHandler)

  // Cierre de cursos: aulas que terminan en la semana + checklist de cierre.
  fastify.post('/weeklyclosures', {
    schema: weeklyClosuresSchema
  }, ctrl.weeklyClosuresHandler)

  fastify.post('/closuresave', {
    schema: closureSaveSchema
  }, ctrl.closureSaveHandler)

  // Seguimiento Docentes: cronograma S1..Sn + auditoria por sesion en un rango.
  fastify.post('/teacherfollowup', {
    schema: teacherFollowupSchema
  }, ctrl.teacherFollowupHandler)

  fastify.post('/sessioncontrolsave', {
    schema: sessionControlSaveSchema
  }, ctrl.sessionControlSaveHandler)

  fastify.post('/classroommetricslist', {
    schema: classroomMetricsListSchema
  }, ctrl.classroomMetricsListHandler)

  fastify.post('/classroomstudentslist', {
    schema: classroomStudentsListSchema,
    preHandler: CLASSROOM_STUDENTS_READERS
  }, ctrl.classroomStudentsListHandler)

  // Gasto del mes en auditorias IA (informativo en el modal de IA). Sin body.
  fastify.post('/aiauditspend', {}, ctrl.aiAuditSpendHandler)

  // Buscador de alumno de la pantalla Aulas (DNI, celular, correo o nombre).
  fastify.post('/studentsearch', {
    schema: academicStudentSearchSchema
  }, ctrl.academicStudentSearchHandler)

  fastify.post('/classroomstudentshistory', {
    schema: classroomStudentsHistorySchema
  }, ctrl.classroomStudentsHistoryHandler)

  fastify.post('/classroomauditget', {
    schema: classroomAuditGetSchema
  }, ctrl.classroomAuditGetHandler)

  fastify.post('/classroomauditsummarylist', {
    schema: classroomAuditSummaryListSchema
  }, ctrl.classroomAuditSummaryListHandler)

  fastify.post('/classroomauditsave', {
    schema: classroomAuditSaveSchema
  }, ctrl.classroomAuditSaveHandler)

  fastify.post('/classroomgradesget', {
    schema: classroomGradesGetSchema
  }, ctrl.classroomGradesGetHandler)

  fastify.post('/classroomgradessave', {
    schema: classroomGradesSaveSchema
  }, ctrl.classroomGradesSaveHandler)

  // Aulas terminadas: aprobados del ERP vs certificados en Odoo. Sin body.
  fastify.post('/classroomscertificationstatus', {}, ctrl.classroomsCertificationStatusHandler)

  // Vista previa de la certificacion: solo lee Odoo (mismo body que certificar).
  fastify.post('/classroomodoocertifypreview', {
    schema: classroomOdooCertifySchema
  }, ctrl.classroomOdooCertifyPreviewHandler)

  // Certifica el aula en Odoo: notas → evaluaciones + proceso de certificación
  // masiva + PDFs. Son decenas de llamadas JSON-RPC; timeout amplio.
  fastify.post('/classroomodoocertify', {
    schema: classroomOdooCertifySchema,
    config: { timeout: 300000 }
  }, ctrl.classroomOdooCertifyHandler)

  // Genera borradores de observacion con el modelo IA local (Ollama via tunel).
  // Puede tardar ~30-60s con un aula completa; timeout de socket amplio.
  fastify.post('/classroomgradesobservations', {
    schema: classroomGradesObservationsSchema,
    config: { timeout: 180000 }
  }, ctrl.classroomGradesObservationsHandler)

  // Version en segundo plano (la que usa la pantalla): responde al instante
  // con un job_id; el avance se consulta en /aijobstatus. La sincrona de arriba
  // queda por compatibilidad mientras se despliega el frontend nuevo.
  fastify.post('/classroomgradesobservations/start', {
    schema: classroomGradesObservationsStartSchema
  }, ctrl.classroomGradesObservationsStartHandler)

  // Seguimiento B2B: alumnos B2B en aulas EN VIVO + asistencia manual propia
  // (tabla b2b_attendance, independiente de la Lista de Notas). La nota final
  // viaja de solo lectura desde classroom_student_grades.
  fastify.post('/b2btrackinglist', {
    schema: b2bTrackingListSchema
  }, ctrl.b2bTrackingListHandler)

  fastify.post('/b2battendancesave', {
    schema: b2bAttendanceSaveSchema
  }, ctrl.b2bAttendanceSaveHandler)

  // Datos del Reporte Academico: consulta ligera dedicada (cursos + resumen
  // de auditoria en una sola pasada). Sin body.
  fastify.post('/academicreport', {}, ctrl.academicReportHandler)

  // Aprobados, jalados y certificados por mes (Reporte Academico). Sin body.
  fastify.post('/academicoutcomes', {}, ctrl.academicOutcomesHandler)

  // Criterios de la rubrica que mas restan al promedio de auditoria (objetivo 18).
  fastify.post('/auditobjective', {}, ctrl.auditObjectiveHandler)

  // Recomendaciones IA del Reporte Academico (mismo Ollama local que las
  // observaciones de notas). Dos intentos de ~60s cada uno como maximo.
  fastify.post('/reportrecommendations', {
    schema: reportRecommendationsSchema,
    config: { timeout: 150000 }
  }, ctrl.reportRecommendationsHandler)

  fastify.post('/reportrecommendations/start', {
    schema: reportRecommendationsStartSchema
  }, ctrl.reportRecommendationsStartHandler)

  // Estado de un trabajo IA: generando (con progreso), listo (con data) o error.
  fastify.post('/aijobstatus', { schema: aiJobStatusSchema }, ctrl.aiJobStatusHandler)

  // Multipart: transcript_text + syllabus_image + edition_id + session_number.
  // Sin schema porque @fastify/multipart parsea manualmente; validamos en el
  // handler. La IA puede demorar 30-60s; configuramos timeout amplio.
  fastify.post('/classroomauditrunai', {
    bodyLimit: 25 * 1024 * 1024 // 25 MB para imagen del syllabus
  }, ctrl.classroomAuditRunAiHandler)

  fastify.post('/editionget', {
    schema: editionGetSchema
  }, ctrl.getHandler)

  // Recursos del correo de evento. Endpoint propio con SQL directo porque
  // sp_edition_update no conoce estas columnas (ver edition.repository.js).
  fastify.post('/eventeditionslist', { schema: eventEditionsListSchema }, ctrl.eventEditionsListHandler)
  fastify.post('/eventresourcesget', { schema: eventResourcesGetSchema }, ctrl.eventResourcesGetHandler)
  fastify.post('/eventbannerget', { schema: eventResourcesGetSchema }, ctrl.eventBannerGetHandler)
  fastify.post('/eventresourcessave', { schema: eventResourcesSaveSchema }, ctrl.eventResourcesSaveHandler)
  // Reporte de objetivos (Fundacion > Objetivos): avance real por area vs la
  // meta manual guardada en program_edition_goals.channel_goals.
  fastify.post('/eventgoalsreport', { schema: eventResourcesGetSchema }, ctrl.eventGoalsReportHandler)
  fastify.post('/eventgoalssave', { schema: eventGoalsSaveSchema }, ctrl.eventGoalsSaveHandler)
  fastify.post('/eventcategoriesget', { schema: eventResourcesGetSchema }, ctrl.eventCategoriesGetHandler)
  fastify.post('/eventcategoriessave', { schema: eventCategoriesSaveSchema }, ctrl.eventCategoriesSaveHandler)
  // Links del aula (WhatsApp / Teams / Ficha / Lista de notas). Endpoint propio
  // en vez de /editionupdate: ese SP reescribe la edicion entera y solo admite
  // ADMIN/PRODUCTO, y estos links los mantiene Academica. El gate de rol va
  // explicito porque aca el SP ya no valida nada.
  fastify.post('/classroomlinkssave', {
    schema: classroomLinksSaveSchema,
    preHandler: hasRole(['ADMIN', 'PRODUCTO', 'LIDER_PRODUCTO', 'ACADEMICA', 'LIDER_ACADEMICA'])
  }, ctrl.classroomLinksSaveHandler)

  fastify.post('/editionupdate', {
    schema: editionUpdateSchema,
    preHandler: CRONOGRAMA_WRITERS
  }, ctrl.updateHandler)

  fastify.post('/editioncaller', {
    schema: editionCallerSchema
  }, ctrl.callerHandler)

  fastify.post('/editionextrainfocaller', {
    schema: editionExtraInfoCallerSchema
  }, ctrl.extraInfoCallerHandler)

  fastify.post('/bulkupdatewhatsapp', {
    schema: bulkUpdateWhatsappSchema,
    preHandler: CRONOGRAMA_WRITERS
  }, ctrl.bulkUpdateWhatsappHandler)

  fastify.post('/editiontreeupdate', {
    schema: editionTreeUpdateSchema,
    preHandler: CRONOGRAMA_WRITERS
  }, ctrl.treeUpdateHandler)

  // A5 MIGRATION: listar alumnos vigentes en una edicion.
  fastify.post('/a5pendingenrollments', {
    schema: a5PendingEnrollmentsSchema,
    preHandler: CRONOGRAMA_WRITERS
  }, ctrl.a5PendingEnrollmentsHandler)

  // A5: cancelar la edicion y derivar a sus alumnos a Reprogramaciones con el
  // destino que propone Producto. No mueve a nadie: eso lo firma FICO despues.
  fastify.post('/a5cancelandhandoff', {
    schema: a5CancelAndHandOffSchema,
    preHandler: CRONOGRAMA_WRITERS
  }, ctrl.a5CancelAndHandOffHandler)

  // PDF: programacion del curso.
  fastify.post('/schedule-pdf', {
    schema: schedulePdfSchema
  }, ctrl.schedulePdfHandler)
}
