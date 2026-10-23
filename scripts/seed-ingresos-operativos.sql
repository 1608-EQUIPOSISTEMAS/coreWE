-- Alta del submodulo INGRESOS_OPERATIVOS dentro de Finanzas (modulo FICO), con
-- casilla propia en Configuracion > Roles y Permisos.
--
-- Acceso inicial: solo ADMIN, hasta que el modulo se habilite (pedido del
-- usuario 23/10/26; la decision 7 del plan acordo ADMIN, GERENCIA, LIDER_FICO y
-- FICO para cuando salga). El resto se activa en Configuracion > Roles y
-- Permisos. Para quitar el permiso que el seed del 22/10 dio a los otros tres
-- roles: scripts/revoke-ingresos-operativos-no-admin.sql.
--
-- Idempotente: WHERE NOT EXISTS, igual que seed-tickets-module.sql.

INSERT INTO public.submodules (module_id, code, name, route, sort_order, active)
SELECT m.module_id, 'INGRESOS_OPERATIVOS', 'Ingresos Operativos', '/fico/ingresos-operativos',
       COALESCE((SELECT MAX(s.sort_order) FROM public.submodules s WHERE s.module_id = m.module_id), 0) + 1, 'Y'
  FROM public.modules m
 WHERE m.code = 'FICO'
   AND NOT EXISTS (
     SELECT 1 FROM public.submodules s
      WHERE s.module_id = m.module_id AND s.code = 'INGRESOS_OPERATIVOS');

INSERT INTO public.rol_submodule_permission (rol_id, submodule_id, can_access, assigned_at)
SELECT r.rol_id, s.submodule_id, TRUE, now()
  FROM public.rol r
  JOIN public.submodules s ON s.code = 'INGRESOS_OPERATIVOS'
  JOIN public.modules m    ON m.module_id = s.module_id AND m.code = 'FICO'
 WHERE r.alias = 'ADMIN'
   AND NOT EXISTS (
     SELECT 1 FROM public.rol_submodule_permission p
      WHERE p.rol_id = r.rol_id AND p.submodule_id = s.submodule_id);

-- Verificacion:
--   SELECT r.alias, p.can_access
--     FROM public.rol_submodule_permission p
--     JOIN public.rol r USING (rol_id)
--     JOIN public.submodules s USING (submodule_id)
--    WHERE s.code = 'INGRESOS_OPERATIVOS';
