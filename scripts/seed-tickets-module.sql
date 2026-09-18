-- Registro del modulo TICKETS en la matriz de permisos (Configuracion > Roles).
--
-- El item del sidebar NO declara module, asi que Tickets es visible para todo
-- usuario logueado igual que Dashboard y Cronograma: cualquiera reporta una
-- incidencia. Esta fila existe para dos cosas: que el modulo aparezca en la
-- pantalla de Roles y Permisos y se le pueda revocar a un rol puntual, y que
-- modulesForRoles lo devuelva en el login.
--
-- Quien ve QUE tickets no se decide aca sino en tickets.entity (ticketScopeFor):
-- ADMIN y GERENCIA ven todos, un lider los de su area, el resto los suyos.
--
-- Idempotente: WHERE NOT EXISTS en vez de ON CONFLICT porque no hay garantia de
-- que modules.code tenga indice unico.

INSERT INTO public.modules (code, name, icon, route, sort_order, active)
SELECT 'TICKETS', 'Tickets', 'cil-envelope-open', '/tickets',
       COALESCE((SELECT MAX(sort_order) FROM public.modules), 0) + 1, 'Y'
 WHERE NOT EXISTS (SELECT 1 FROM public.modules WHERE code = 'TICKETS');

-- Se otorga a todos los roles activos. Revocarlo es un clic en Configuracion.
INSERT INTO public.rol_module_permission (rol_id, module_id, can_access)
SELECT r.rol_id, m.module_id, TRUE
  FROM public.rol r
 CROSS JOIN public.modules m
 WHERE m.code = 'TICKETS'
   AND NOT EXISTS (
     SELECT 1 FROM public.rol_module_permission p
      WHERE p.rol_id = r.rol_id AND p.module_id = m.module_id);

-- Verificacion rapida tras correrlo:
--   SELECT m.code, count(*) AS roles_con_acceso
--     FROM public.modules m
--     JOIN public.rol_module_permission p ON p.module_id = m.module_id AND p.can_access
--    WHERE m.code = 'TICKETS'
--    GROUP BY m.code;
