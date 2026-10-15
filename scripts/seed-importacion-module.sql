-- Registro del modulo IMPORTACION en las tablas de la matriz de permisos.
--
-- Solo CREA el modulo y sus submodulos: el ERP no tiene pantalla para crearlos
-- (Configuracion solo lista y asigna). Los PERMISOS no se dan aqui: se asignan
-- desde Configuracion > Roles y Permisos una vez que existan las filas.
--
--   - CARGA        "Importar hoja": era el submodulo IMPORTACION de Configuracion.
--                  ESCRIBE inscripciones y pagos.
--   - CONCILIACION "Conciliacion": compara hojas FICO contra el sistema. Solo lee.
-- El backend exige cada submodulo por separado (hasSubmoduleOrRole en
-- importer.routes.js). ADMIN entra a todo sin asignaciones. Los codigos deben
-- coincidir con importer.permissions.js, _nav.js y el router del frontend.
--
-- Idempotente: WHERE NOT EXISTS en vez de ON CONFLICT porque no hay garantia de
-- indice unico en modules.code / submodules.code (igual que seed-tickets-module).

BEGIN;

INSERT INTO public.modules (code, name, icon, route, sort_order, active)
SELECT 'IMPORTACION', 'Importacion', 'cil-spreadsheet', '/importacion',
       COALESCE((SELECT MAX(sort_order) FROM public.modules), 0) + 1, 'Y'
 WHERE NOT EXISTS (SELECT 1 FROM public.modules WHERE code = 'IMPORTACION');

INSERT INTO public.submodules (module_id, code, name, route, sort_order, active)
SELECT m.module_id, s.code, s.name, s.route, s.sort_order, 'Y'
  FROM public.modules m
 CROSS JOIN (VALUES
   ('CARGA',        'Importar hoja', '/importacion/carga',        1),
   ('CONCILIACION', 'Conciliacion',  '/importacion/conciliacion', 2)
 ) AS s(code, name, route, sort_order)
 WHERE m.code = 'IMPORTACION'
   AND NOT EXISTS (SELECT 1 FROM public.submodules x WHERE x.module_id = m.module_id AND x.code = s.code);

-- El submodulo viejo de Configuracion queda inactivo para que deje de salir en
-- la matriz (su pantalla ahora redirige a /importacion/carga). No se borra:
-- reversible con active = 'Y'. No tenia roles asignados.
UPDATE public.submodules s SET active = 'N'
  FROM public.modules m
 WHERE m.module_id = s.module_id AND m.code = 'CONFIGURACION' AND s.code = 'IMPORTACION' AND s.active = 'Y';

COMMIT;

-- Verificacion rapida tras correrlo:
--   SELECT m.code, s.code AS sub, s.name, s.active
--     FROM public.modules m JOIN public.submodules s ON s.module_id = m.module_id
--    WHERE m.code = 'IMPORTACION' OR (m.code = 'CONFIGURACION' AND s.code = 'IMPORTACION')
--    ORDER BY 1, 2;
