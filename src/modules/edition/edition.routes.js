import { authenticate, hasRole, ALL_ADMIN, ALL_COMERCIAL } from '../../shared/http/auth.middleware.js'
import {
  editionRegisterSchema,
  editionTreeRegisterSchema,
  auditLogsGetSchema,
  editionListSchema,
  classroomMetricsListSchema,
  classroomStudentsListSchema,
  classroomStudentsHistorySchema,
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
  a5MigrationExecuteSchema,
  schedulePdfSchema
} from './edition.schemas.js'
import * as ctrl from './edition.controller.js'

export default async function editionRoutes (fastify) {
  fastify.addHook('preHandler', authenticate)

  fastify.post('/editionregister', {
    schema: editionRegisterSchema
    // preHandler: [authenticate, ALL_ADMIN]
  }, ctrl.registerHandler)

  fastify.post('/editiontreeregister', {
    schema: editionTreeRegisterSchema
    // preHandler: [authenticate, ALL_ADMIN]
  }, ctrl.treeRegisterHandler)

  fastify.post('/auditlogsget', {
    schema: auditLogsGetSchema
    // preHandler: [authenticate, ALL_ADMIN]
  }, ctrl.auditLogsGetHandler)

  fastify.post('/editionlist', {
    schema: editionListSchema
    // preHandler: [authenticate, ALL_ADMIN,ALL_COMERCIAL]
  }, ctrl.listHandler)

  fastify.post('/editionbyweeklist', {
    schema: editionByWeekListSchema
    // preHandler: [authenticate, ALL_ADMIN,ALL_COMERCIAL]
  }, ctrl.byWeekListHandler)

  // Vista Semanal Academica: aulas en curso por dia con nº de sesion.
  fastify.post('/weeklysessions', {
    schema: weeklySessionsSchema
  }, ctrl.weeklySessionsHandler)

  // Control de ediciones: aulas que inician en la semana + estados por sesion.
  fastify.post('/weeklycontrol', {
    schema: weeklyControlSchema
  }, ctrl.weeklyControlHandler)

  fastify.post('/sessioncontrolsave', {
    schema: sessionControlSaveSchema
  }, ctrl.sessionControlSaveHandler)

  fastify.post('/classroommetricslist', {
    schema: classroomMetricsListSchema
    // preHandler: [authenticate, ALL_ADMIN, ALL_COMERCIAL]
  }, ctrl.classroomMetricsListHandler)

  fastify.post('/classroomstudentslist', {
    schema: classroomStudentsListSchema
    // preHandler: [authenticate, ALL_ADMIN, ALL_COMERCIAL]
  }, ctrl.classroomStudentsListHandler)

  fastify.post('/classroomstudentshistory', {
    schema: classroomStudentsHistorySchema
    // preHandler: [authenticate, ALL_ADMIN, ALL_COMERCIAL]
  }, ctrl.classroomStudentsHistoryHandler)

  fastify.post('/classroomauditget', {
    schema: classroomAuditGetSchema
    // preHandler: [authenticate, ALL_ADMIN, ALL_COMERCIAL]
  }, ctrl.classroomAuditGetHandler)

  fastify.post('/classroomauditsummarylist', {
    schema: classroomAuditSummaryListSchema
    // preHandler: [authenticate, ALL_ADMIN, ALL_COMERCIAL]
  }, ctrl.classroomAuditSummaryListHandler)

  fastify.post('/classroomauditsave', {
    schema: classroomAuditSaveSchema
    // preHandler: [authenticate, ALL_ADMIN, ALL_COMERCIAL]
  }, ctrl.classroomAuditSaveHandler)

  fastify.post('/classroomgradesget', {
    schema: classroomGradesGetSchema
    // preHandler: [authenticate, ALL_ADMIN, ALL_COMERCIAL]
  }, ctrl.classroomGradesGetHandler)

  fastify.post('/classroomgradessave', {
    schema: classroomGradesSaveSchema
    // preHandler: [authenticate, ALL_ADMIN, ALL_COMERCIAL]
  }, ctrl.classroomGradesSaveHandler)

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

  // Recomendaciones IA del Reporte Academico (mismo Ollama local que las
  // observaciones de notas). Dos intentos de ~60s cada uno como maximo.
  fastify.post('/reportrecommendations', {
    schema: reportRecommendationsSchema,
    config: { timeout: 150000 }
  }, ctrl.reportRecommendationsHandler)

  // Multipart: transcript_text + syllabus_image + edition_id + session_number.
  // Sin schema porque @fastify/multipart parsea manualmente; validamos en el
  // handler. La IA puede demorar 30-60s; configuramos timeout amplio.
  fastify.post('/classroomauditrunai', {
    bodyLimit: 25 * 1024 * 1024 // 25 MB para imagen del syllabus
  }, ctrl.classroomAuditRunAiHandler)

  fastify.post('/editionget', {
    schema: editionGetSchema
    // preHandler: [authenticate, ALL_ADMIN,ALL_COMERCIAL]
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
    schema: editionUpdateSchema
    // preHandler: [authenticate, ALL_ADMIN]
  }, ctrl.updateHandler)

  fastify.post('/editioncaller', {
    schema: editionCallerSchema
    // preHandler: [authenticate, ALL_ADMIN,ALL_COMERCIAL]
  }, ctrl.callerHandler)

  fastify.post('/editionextrainfocaller', {
    schema: editionExtraInfoCallerSchema
    // preHandler: [authenticate, ALL_ADMIN,ALL_COMERCIAL]
  }, ctrl.extraInfoCallerHandler)

  fastify.post('/bulkupdatewhatsapp', {
    schema: bulkUpdateWhatsappSchema
  }, ctrl.bulkUpdateWhatsappHandler)

  fastify.post('/editiontreeupdate', {
    schema: editionTreeUpdateSchema
    // preHandler: [authenticate, ALL_ADMIN]
  }, ctrl.treeUpdateHandler)

  // A5 MIGRATION: listar alumnos vigentes en una edicion.
  fastify.post('/a5pendingenrollments', {
    schema: a5PendingEnrollmentsSchema
  }, ctrl.a5PendingEnrollmentsHandler)

  // A5 MIGRATION: ejecutar migracion masiva + cancelacion.
  fastify.post('/a5migrationexecute', {
    schema: a5MigrationExecuteSchema
  }, ctrl.a5MigrationExecuteHandler)

  // PDF: programacion del curso.
  fastify.post('/schedule-pdf', {
    schema: schedulePdfSchema
  }, ctrl.schedulePdfHandler)
}
