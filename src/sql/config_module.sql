-- ============================================================
-- Módulo de Configuración: catálogo de módulos del sistema y
-- permisos por rol. DDL 100% aditivo (idempotente): se puede
-- ejecutar varias veces sin efectos secundarios.
-- ============================================================

-- Catálogo de módulos navegables del ERP. `code` es el identificador
-- estable que usan backend y frontend; `route` es el path raíz en el SPA.
CREATE TABLE IF NOT EXISTS public.modules (
  module_id   SERIAL PRIMARY KEY,
  code        VARCHAR(40)  NOT NULL UNIQUE,
  name        VARCHAR(80)  NOT NULL,
  icon        VARCHAR(40),
  route       VARCHAR(120),
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  active      CHAR(1)      NOT NULL DEFAULT 'Y'
);

-- Permisos rol ↔ módulo. La fila presente con can_access = true otorga
-- acceso; ausencia de fila = sin acceso. ADMIN se trata como superusuario
-- en código (no necesita filas).
CREATE TABLE IF NOT EXISTS public.rol_module_permission (
  rol_id      INTEGER NOT NULL REFERENCES public.rol (rol_id) ON DELETE CASCADE,
  module_id   INTEGER NOT NULL REFERENCES public.modules (module_id) ON DELETE CASCADE,
  can_access  BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rol_id, module_id)
);

-- ── Seed de módulos (espejo de los grupos actuales de _nav.js) ──
INSERT INTO public.modules (code, name, icon, route, sort_order) VALUES
  ('DASHBOARD',      'Dashboard',       'cil-grid',       '/dashboard',             1),
  ('FICO',           'Finanzas',        'cil-calculator', '/fico',                  2),
  ('PRODUCTO',       'Producto',        'cil-layers',     '/producto',              3),
  ('COMERCIAL',      'Comercial',       'cil-dollar',     '/comercial',             4),
  ('FUNDACION',      'Fundación',       'cil-people',     '/fundacion',             5),
  ('B2B',            'B2B',             'cil-people',     '/business',              6),
  ('ACADEMICA',      'Académica',       'cil-notes',      '/academica',             7),
  ('MARKETING',      'Reporte',         'cil-chart-pie',  '/marketing',             8),
  ('CLIENTE',        'Cliente',         'cil-user',       '/general/cliente',       9),
  ('NOTIFICACIONES', 'Notificaciones',  'cil-bell',       '/general/notificaciones', 10),
  ('CONFIGURACION',  'Configuración',   'cil-settings',   '/configuracion',         11)
ON CONFLICT (code) DO NOTHING;

-- ── Seed de permisos: réplica de la matriz hardcodeada hoy en _nav.js ──
-- ADMIN no se siembra: el código lo trata como acceso total.
INSERT INTO public.rol_module_permission (rol_id, module_id)
SELECT r.rol_id, m.module_id
FROM public.rol r
JOIN public.modules m ON (
  (m.code = 'DASHBOARD') OR
  (m.code = 'FICO'       AND r.alias IN ('FICO', 'LIDER_FICO', 'LIDER_COMERCIAL', 'COMERCIAL', 'GERENCIA')) OR
  (m.code = 'PRODUCTO'   AND r.alias IN ('PRODUCTO', 'LIDER_PRODUCTO', 'GERENCIA')) OR
  (m.code = 'COMERCIAL'  AND r.alias IN ('COMERCIAL', 'LIDER_COMERCIAL', 'GERENCIA')) OR
  (m.code = 'FUNDACION'  AND r.alias IN ('FUNDACION', 'GERENCIA')) OR
  (m.code = 'B2B'        AND r.alias IN ('B2B', 'GERENCIA')) OR
  (m.code = 'ACADEMICA'  AND r.alias IN ('ACADEMICA', 'LIDER_ACADEMICA', 'GERENCIA')) OR
  (m.code = 'MARKETING'  AND r.alias IN ('MARKETING', 'GERENCIA')) OR
  (m.code = 'CLIENTE'    AND r.alias IN ('COMERCIAL', 'LIDER_COMERCIAL', 'GERENCIA'))
)
WHERE r.alias <> 'ADMIN'
ON CONFLICT (rol_id, module_id) DO NOTHING;
