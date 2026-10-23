-- Alta del submodulo PAGOS_ADICIONALES dentro de Finanzas (modulo FICO), con
-- casilla propia en Configuracion > Roles y Permisos.
--
-- Acceso inicial: solo ADMIN, hasta que el modulo se habilite (pedido del
-- usuario 23/10/26). El resto se activa con un clic en Configuracion > Roles y
-- Permisos. Aun con la casilla, registrar y editar piden un rol de FICO y
-- anular LIDER_FICO (ver pagos-adicionales.routes.js).
--
-- Idempotente: WHERE NOT EXISTS, igual que seed-ingresos-operativos.sql.

INSERT INTO public.submodules (module_id, code, name, route, sort_order, active)
SELECT m.module_id, 'PAGOS_ADICIONALES', 'Pagos Adicionales', '/fico/pagos-adicionales',
       COALESCE((SELECT MAX(s.sort_order) FROM public.submodules s WHERE s.module_id = m.module_id), 0) + 1, 'Y'
  FROM public.modules m
 WHERE m.code = 'FICO'
   AND NOT EXISTS (
     SELECT 1 FROM public.submodules s
      WHERE s.module_id = m.module_id AND s.code = 'PAGOS_ADICIONALES');

INSERT INTO public.rol_submodule_permission (rol_id, submodule_id, can_access, assigned_at)
SELECT r.rol_id, s.submodule_id, TRUE, now()
  FROM public.rol r
  JOIN public.submodules s ON s.code = 'PAGOS_ADICIONALES'
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
--    WHERE s.code = 'PAGOS_ADICIONALES';
