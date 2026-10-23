-- Ingresos Operativos solo para ADMIN hasta que se habilite (pedido 23/10/26).
-- El seed del 22/10 dio la casilla FICO > INGRESOS_OPERATIVOS a GERENCIA,
-- LIDER_FICO y FICO; esto la quita igual que desmarcarla en Configuracion >
-- Roles y Permisos (config.repository borra la fila). Idempotente.

DELETE FROM public.rol_submodule_permission p
 USING public.rol r, public.submodules s, public.modules m
 WHERE p.rol_id = r.rol_id
   AND p.submodule_id = s.submodule_id
   AND s.module_id = m.module_id
   AND m.code = 'FICO'
   AND s.code = 'INGRESOS_OPERATIVOS'
   AND r.alias <> 'ADMIN';

-- Verificacion (debe quedar solo ADMIN):
--   SELECT r.alias FROM public.rol_submodule_permission p
--     JOIN public.rol r USING (rol_id) JOIN public.submodules s USING (submodule_id)
--    WHERE s.code = 'INGRESOS_OPERATIVOS';
