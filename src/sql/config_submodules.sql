-- ============================================================
-- Configuración fase 3: submódulos (segundo nivel de permisos).
-- Cada submódulo es un ítem dentro de un módulo del sidebar.
-- DDL 100% aditivo (idempotente).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.submodules (
  submodule_id SERIAL PRIMARY KEY,
  module_id    INTEGER     NOT NULL REFERENCES public.modules (module_id) ON DELETE CASCADE,
  code         VARCHAR(40) NOT NULL,
  name         VARCHAR(80) NOT NULL,
  route        VARCHAR(120),
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  active       CHAR(1)     NOT NULL DEFAULT 'Y',
  UNIQUE (module_id, code)
);

CREATE TABLE IF NOT EXISTS public.rol_submodule_permission (
  rol_id       INTEGER NOT NULL REFERENCES public.rol (rol_id) ON DELETE CASCADE,
  submodule_id INTEGER NOT NULL REFERENCES public.submodules (submodule_id) ON DELETE CASCADE,
  can_access   BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_at  TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rol_id, submodule_id)
);

-- ── Seed de submódulos (espejo de los hijos actuales de _nav.js) ──
INSERT INTO public.submodules (module_id, code, name, route, sort_order)
SELECT m.module_id, s.code, s.name, s.route, s.sort_order
FROM (VALUES
  ('FICO',          'INSCRIPCIONES',        'Inscripciones',          '/fico/inscripciones',          1),
  ('FICO',          'TOKENS',               'Tokens de Pago',         '/fico/tokens',                 2),
  ('FICO',          'COBRANZAS',            'Cobranzas',              '/fico/cobranzas',              3),
  ('PRODUCTO',      'PROGRAMAS',            'Programas',              '/producto/programas',          1),
  ('PRODUCTO',      'DOCENTES',             'Docentes',               '/producto/docentes',           2),
  ('PRODUCTO',      'CRONOGRAMA',           'Cronograma',             '/producto/cronograma',         3),
  ('PRODUCTO',      'PRECIOS',              'Lista de Precios',       '/producto/precios',            4),
  ('PRODUCTO',      'LINKS',                'Carga de Links',         '/producto/links',              5),
  ('COMERCIAL',     'LEADS',                'Comercial (Leads)',      '/comercial/leads',             1),
  ('COMERCIAL',     'CONTROL_GESTION',      'Control - Gestión',      '/comercial/RptControlComercial', 2),
  ('COMERCIAL',     'MARKETING_GESTION',    'Marketing - Gestión',    '/comercial/RptMktProduct',     3),
  ('COMERCIAL',     'LLAMADA_GESTION',      'Llamada - Gestión',      '/comercial/RptCalling',        4),
  ('COMERCIAL',     'ASESOR_OBJETIVOS',     'Asesor - Objetivos',     '/comercial/RptGoalAgent',      5),
  ('COMERCIAL',     'CRONOGRAMA_OBJETIVOS', 'Cronograma - Objetivos', '/comercial/RptGoalEdition',    6),
  ('COMERCIAL',     'DESCUENTOS',           'Descuentos',             '/comercial/discount',          7),
  ('FUNDACION',     'LEADS',                'Leads Fundación',        '/fundacion/leads',             1),
  ('FUNDACION',     'LEADS_EMPRESAS',       'Leads Empresas',         '/fundacion/company-leads',     2),
  ('B2B',           'LEADS',                'Leads B2B',              '/b2b/leads',                   1),
  ('B2B',           'LEADS_EMPRESAS',       'Leads Empresas',         '/business/company-leads',      2),
  ('B2B',           'EMPRESAS',             'Empresas',               '/business/companies',          3),
  ('B2B',           'CONTRATOS',            'Contratos',              '/business/contracts',          4),
  ('B2B',           'CONVENIOS',            'Convenios',              '/business/agreements',         5),
  ('ACADEMICA',     'AULAS',                'Aulas',                  '/academica/aulas',             1),
  ('ACADEMICA',     'SEMANAL',              'Vista Semanal',          '/academica/semanal',           2),
  ('ACADEMICA',     'REPORTE',              'Reporte Académico',      '/academica/reporte',           3),
  ('ACADEMICA',     'BOT',                  'Bot Académico',          '/academica/bot',               4),
  ('MARKETING',     'OVERVIEW',             'Overview',               '/marketing/overview',          1),
  ('CONFIGURACION', 'USUARIOS',             'Usuarios',               '/configuracion/usuarios',      1),
  ('CONFIGURACION', 'ROLES',                'Roles y Permisos',       '/configuracion/roles',         2)
) AS s (module_code, code, name, route, sort_order)
JOIN public.modules m ON m.code = s.module_code
ON CONFLICT (module_id, code) DO NOTHING;

-- ── Seed de permisos por submódulo: espejo de los roles que HOY ven
--    cada ítem en _nav.js / router (ADMIN no se siembra: superusuario). ──
INSERT INTO public.rol_submodule_permission (rol_id, submodule_id)
SELECT r.rol_id, s.submodule_id
FROM public.rol r
JOIN public.submodules s ON TRUE
JOIN public.modules m ON m.module_id = s.module_id
WHERE r.alias <> 'ADMIN' AND (
  (m.code = 'FICO' AND s.code = 'INSCRIPCIONES' AND r.alias IN ('FICO', 'LIDER_FICO', 'GERENCIA')) OR
  (m.code = 'FICO' AND s.code = 'TOKENS'        AND r.alias IN ('FICO', 'LIDER_FICO', 'LIDER_COMERCIAL', 'COMERCIAL', 'GERENCIA')) OR
  (m.code = 'FICO' AND s.code = 'COBRANZAS'     AND r.alias IN ('FICO', 'LIDER_FICO', 'GERENCIA')) OR

  (m.code = 'PRODUCTO' AND s.code = 'PROGRAMAS'  AND r.alias IN ('PRODUCTO', 'LIDER_PRODUCTO', 'GERENCIA')) OR
  (m.code = 'PRODUCTO' AND s.code = 'DOCENTES'   AND r.alias IN ('PRODUCTO', 'LIDER_PRODUCTO', 'GERENCIA')) OR
  (m.code = 'PRODUCTO' AND s.code = 'CRONOGRAMA' AND r.alias IN ('PRODUCTO', 'LIDER_PRODUCTO', 'COMERCIAL', 'LIDER_COMERCIAL', 'ACADEMICA', 'GERENCIA')) OR
  (m.code = 'PRODUCTO' AND s.code = 'PRECIOS'    AND r.alias IN ('GERENCIA')) OR
  (m.code = 'PRODUCTO' AND s.code = 'LINKS'      AND r.alias IN ('PRODUCTO', 'LIDER_PRODUCTO', 'GERENCIA')) OR

  (m.code = 'COMERCIAL' AND s.code = 'LEADS'                AND r.alias IN ('COMERCIAL', 'LIDER_COMERCIAL', 'GERENCIA')) OR
  (m.code = 'COMERCIAL' AND s.code = 'CONTROL_GESTION'      AND r.alias IN ('COMERCIAL', 'GERENCIA')) OR
  (m.code = 'COMERCIAL' AND s.code = 'MARKETING_GESTION'    AND r.alias IN ('LIDER_COMERCIAL', 'GERENCIA')) OR
  (m.code = 'COMERCIAL' AND s.code = 'LLAMADA_GESTION'      AND r.alias IN ('COMERCIAL', 'GERENCIA')) OR
  (m.code = 'COMERCIAL' AND s.code = 'ASESOR_OBJETIVOS'     AND r.alias IN ('COMERCIAL', 'GERENCIA')) OR
  (m.code = 'COMERCIAL' AND s.code = 'CRONOGRAMA_OBJETIVOS' AND r.alias IN ('LIDER_COMERCIAL', 'GERENCIA')) OR
  (m.code = 'COMERCIAL' AND s.code = 'DESCUENTOS'           AND r.alias IN ('COMERCIAL', 'LIDER_COMERCIAL', 'GERENCIA')) OR

  (m.code = 'FUNDACION' AND r.alias IN ('FUNDACION', 'GERENCIA')) OR
  (m.code = 'B2B'       AND r.alias IN ('B2B', 'GERENCIA')) OR
  (m.code = 'ACADEMICA' AND r.alias IN ('ACADEMICA', 'LIDER_ACADEMICA', 'GERENCIA')) OR
  (m.code = 'MARKETING' AND r.alias IN ('GERENCIA'))
)
ON CONFLICT (rol_id, submodule_id) DO NOTHING;
