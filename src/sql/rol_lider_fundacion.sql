-- ============================================================
-- Rol LIDER_FUNDACION (pedido 17/07/2026):
--   1. Crea el rol si no existe.
--   2. Se lo asigna al usuario 47.
--   3. Matriz: hereda el módulo FUNDACION completo (espejo del rol FUNDACION).
-- Idempotente: se puede ejecutar varias veces.
-- El acceso al tab Alumnos del modal del cronograma es por código
-- (todo alias LIDER_* + GERENCIA), no necesita filas aquí.
-- ============================================================

INSERT INTO public.rol (description, alias)
SELECT 'Líder de Fundación', 'LIDER_FUNDACION'
WHERE NOT EXISTS (SELECT 1 FROM public.rol WHERE alias = 'LIDER_FUNDACION');

INSERT INTO public.user_roles (user_id, rol_id)
SELECT 47, r.rol_id
FROM public.rol r
WHERE r.alias = 'LIDER_FUNDACION'
  AND EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = 47)
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = 47 AND ur.rol_id = r.rol_id
  );

INSERT INTO public.rol_module_permission (rol_id, module_id)
SELECT r.rol_id, m.module_id
FROM public.rol r
JOIN public.modules m ON m.code = 'FUNDACION'
WHERE r.alias = 'LIDER_FUNDACION'
ON CONFLICT (rol_id, module_id) DO NOTHING;

INSERT INTO public.rol_submodule_permission (rol_id, submodule_id)
SELECT r.rol_id, s.submodule_id
FROM public.rol r
JOIN public.modules m ON m.code = 'FUNDACION'
JOIN public.submodules s ON s.module_id = m.module_id
WHERE r.alias = 'LIDER_FUNDACION'
ON CONFLICT (rol_id, submodule_id) DO NOTHING;
