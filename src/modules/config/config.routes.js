import { authenticate, ADMIN_ONLY, hasModuleOrRole } from '../../shared/http/auth.middleware.js'
import {
  configUserListSchema,
  configUserRegisterSchema,
  configUserUpdateSchema,
  configRoleListSchema,
  configRoleRegisterSchema,
  configRoleUpdateSchema,
  configModuleListSchema,
  configMyModulesSchema,
  configPermissionUpdateSchema,
  configMembershipCourseListSchema,
  configMembershipCourseSaveSchema
} from './config.schemas.js'
import * as ctrl from './config.controller.js'

// Administración del sistema: solo ADMIN puede gestionar usuarios, roles y
// permisos por módulo.
const CONFIG_FICO = hasModuleOrRole('CONFIGURACION', ['ADMIN', 'FICO', 'LIDER_FICO'])

export default async function configRoutes (fastify) {
  fastify.post('/userlist', { schema: configUserListSchema, preHandler: [authenticate, ADMIN_ONLY] }, ctrl.userListHandler)
  fastify.post('/userregister', { schema: configUserRegisterSchema, preHandler: [authenticate, ADMIN_ONLY] }, ctrl.userRegisterHandler)
  fastify.post('/userupdate', { schema: configUserUpdateSchema, preHandler: [authenticate, ADMIN_ONLY] }, ctrl.userUpdateHandler)

  fastify.post('/rolelist', { schema: configRoleListSchema, preHandler: [authenticate, ADMIN_ONLY] }, ctrl.roleListHandler)
  fastify.post('/roleregister', { schema: configRoleRegisterSchema, preHandler: [authenticate, ADMIN_ONLY] }, ctrl.roleRegisterHandler)
  fastify.post('/roleupdate', { schema: configRoleUpdateSchema, preHandler: [authenticate, ADMIN_ONLY] }, ctrl.roleUpdateHandler)

  fastify.post('/modulelist', { schema: configModuleListSchema, preHandler: [authenticate, ADMIN_ONLY] }, ctrl.moduleListHandler)
  // Sin gate de rol: cada usuario consulta sus propios módulos (sidebar dinámico).
  fastify.post('/mymodules', { schema: configMyModulesSchema, preHandler: [authenticate] }, ctrl.myModulesHandler)
  fastify.post('/permissionupdate', { schema: configPermissionUpdateSchema, preHandler: [authenticate, ADMIN_ONLY] }, ctrl.permissionUpdateHandler)

  // Catalogo de cursos online que entran a la membresia. A diferencia del resto
  // de Configuracion, esta vista la opera FICO (es quien activa membresias), no
  // solo ADMIN. Union con la matriz: cualquier rol con el modulo CONFIGURACION
  // otorgado tambien entra.
  fastify.post('/membershipcourselist', { schema: configMembershipCourseListSchema, preHandler: [authenticate, CONFIG_FICO] }, ctrl.membershipCourseListHandler)
  fastify.post('/membershipcoursesave', { schema: configMembershipCourseSaveSchema, preHandler: [authenticate, CONFIG_FICO] }, ctrl.membershipCourseSaveHandler)
}
