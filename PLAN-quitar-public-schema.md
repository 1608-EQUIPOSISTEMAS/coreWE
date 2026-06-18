# Plan: Quitar el `public.` hardcodeado del código (preparar separación de esquemas)

## Contexto

El equipo planea separar tablas en varios esquemas de PostgreSQL (hoy todo vive en
`public`). El problema: el código hardcodea el prefijo `public.` en casi todas las
consultas (`FROM public.enrollments`, `public."catalog"`, `'public.sp_edition_list'`),
lo que **anula el `search_path`**: si una tabla se mueve a otro esquema, esas consultas
seguirían apuntando a `public.` y romperían. Para que la separación sea viable, el código
debe ser *schema-agnóstico*: referencias sin prefijo + un `search_path` configurable.

**Hallazgo crítico (no resuelto por este plan):** de los **76 stored procedures** que
invoca el código, solo **7 están versionados en `src/sql/`**; los otros **69 viven solo en
la BD** y casi seguro hardcodean `public.` dentro de su cuerpo. Son el verdadero bloqueo
para separar esquemas. Este plan los **vuelca al repo** (export read-only) para tener
visibilidad y versionarlos, pero **no** corrige ni redespliega su contenido (fase aparte).

## Estrategia

1. **Setear `search_path` configurable** en el pool (red de seguridad + habilitador).
2. **Quitar el prefijo `public.`** de todo el SQL en la capa JS, dependiendo del
   `search_path`. Hoy es **no-op** (todo sigue en `public` y el path incluye `public`),
   así que no cambia comportamiento; solo deja el código listo.
3. **Volcar los 69 SPs de la BD** al repo (solo exportar).

Decisión de alcance: **solo capa JS** (no se tocan los 9 `.sql` del repo en esta pasada)
y **volcar los SPs sin corregirlos**.

## Volumen a editar

| Cambio | Archivos | Refs/edits aprox. |
|---|---|---|
| `search_path` en pool | 1 (`src/config/db.js`) + `.env` | 1 bloque + 1 var |
| Strip `public.` en JS | **28** | **~421** |
| Export SPs de la BD | ~6–10 archivos nuevos en `src/sql/db_routines/` | 69 funciones |

Total a editar a mano de forma significativa: **2 archivos** (`db.js`, `.env`); el resto
(28 `.js`) es reemplazo textual mecánico verificado; los SPs se generan por script.

## Cambios detallados

### 1. `search_path` configurable — `src/config/db.js`

En el hook existente `pool.on('connect')` (líneas 17–24), añadir un `SET search_path`
leído de env, con `public` siempre como fallback al final:

```js
const SCHEMA_RE = /^[a-zA-Z0-9_, ]+$/            // evita inyección vía env
const dbSchema = process.env.DB_SCHEMA && SCHEMA_RE.test(process.env.DB_SCHEMA)
  ? process.env.DB_SCHEMA
  : 'public'
pool.on('connect', (client) => {
  client.query(`SET search_path TO ${dbSchema}, public`)   // nuevo
  client.query(`SET application_name = 'we-edu-app'`)
  client.query(`SET TIME ZONE 'America/Lima'`)
  ...
})
```

- `withTransaction` (mismo archivo) usa clientes del pool ⇒ heredan el `search_path`
  por el evento `connect`. No requiere cambios.
- Documentar `DB_SCHEMA` (default `public`) en `.env`. Acepta lista: `academica, fico`.

### 2. Quitar `public.` de la capa JS (28 archivos, ~421 refs)

Reemplazo textual `public.` → `` (cadena vacía) dentro del SQL de cada archivo. Es seguro
porque la exploración confirmó:
- **0** referencias a `information_schema.*` / `pg_catalog.*` (verificado por grep).
- **0** referencias cruzadas a otros esquemas.
- Todas las ocurrencias son SQL real (tablas/vistas/SP), no comentarios ni literales.

Patrones que cubre el reemplazo:
- Tablas/vistas (~280): `FROM public.enrollments` → `FROM enrollments`.
- Identificador citado (~85): `public."catalog"` → `"catalog"`.
- Nombres de SP/función (~50): `'public.sp_edition_list'` → `'sp_edition_list'`;
  `public.fn_...()` → `fn_...()`; `REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_...`
  → `... CONCURRENTLY mv_...`.

Archivos (orden por volumen — los 5 grandes concentran ~286 refs):
- `src/modules/integration/integration.repository.js` (140)
- `src/modules/edition/edition.repository.js` (62)
- `src/modules/fico/classroom-export/classroom-export.repository.js` (31)
- `src/modules/comercial/comercial.repository.js` (27) — **revisar a mano** el `UPDATE`
  dinámico por concatenación en ~línea 176 (`'UPDATE public.enrollments SET '`).
- `src/modules/config/config.repository.js` (26)
- Resto (≤20 c/u): `fico/enrollment` (20), `b2b` (16), `shared/security/module-access.js`
  (13), `services/job-queue.service.js` (11), `program` (10), `bot` (8),
  `dashboard` (8), `customer` (6), `instructor` (6), `notification` (5),
  `discount` (5), `services/crm-auto-attempts.cron.js` (5), `corporate_agreement` (4),
  `fico/email-confirmation` (4), `auth` (3), `fico/membership` (3), `catalog` (2),
  y 1 ref c/u en `pdf.service.js`, `fico-mv-refresh.cron.js`, `fico/payment-confirmation`,
  `fico/validation`, `fico/installment`, `fico/tokens`.

Método de ejecución por archivo: aplicar el reemplazo y luego **re-grep `public\.`** en el
archivo para confirmar que quedó en 0 (salvo casos intencionales, que no hay).

### 3. Volcar los 69 SPs de la BD al repo (export read-only)

Script temporal Node + `pg` (leyendo `DATABASE_URL_DIRECT` del `.env`) que:
- Lista las rutinas de `public` (`pg_proc` + `pg_get_functiondef(oid)`), filtrando por los
  76 nombres `sp_*`/`fn_*` referenciados desde el código (o todas las `sp_*`/`fn_*` de
  `public`).
- Escribe cada definición en `src/sql/db_routines/<nombre>.sql` (o agrupadas por módulo:
  `auth.sql`, `b2b.sql`, `edition.sql`, `comercial.sql`, …).
- Es **solo lectura** sobre la BD (`pg_get_functiondef` no modifica nada).
- Se borra el script temporal al terminar.

Esto deja inventariado y versionado el contenido que hoy solo existe en la BD, para que la
corrección de su `public.` interno sea una fase posterior bien acotada.

## Riesgos y mitigaciones

- **Falsos positivos del reemplazo `public.`**: mitigado — grep confirmó que no hay
  `public.` en comentarios/literales/JS property-access en estos 28 archivos; aun así se
  re-verifica por archivo tras editar.
- **Ambigüedad de `search_path` con esquema `"$user"`**: el `SET search_path TO <schema>,
  public` explícito elimina la dependencia del default `"$user", public`.
- **Inyección vía `DB_SCHEMA`**: se valida con regex antes de interpolar (no es input de
  usuario, pero se blinda).
- **Comportamiento hoy**: nulo. Con todo en `public` y `search_path` incluyendo `public`,
  las consultas sin prefijo resuelven idéntico a antes.
- **Los 69 SP bodies siguen con `public.` interno**: explícitamente fuera de alcance; el
  export los deja listos para la fase de corrección.

## Verificación

1. **Estática**: `grep -r "public\." Backend/src --include=*.js` ⇒ 0 resultados (la capa
   JS quedó limpia). Los `.sql` del repo conservan `public.` a propósito (fuera de alcance).
2. **Sintaxis JS**: `node --check` sobre cada archivo modificado (o `npm run lint` si existe).
3. **Tests**: correr la suite (`vitest`) del Backend; no hay tests que dependan de `public.`
   (verificado), así que deben pasar igual.
4. **Smoke funcional**: con `DB_SCHEMA` sin setear (default `public`), levantar el backend y
   ejecutar 2–3 endpoints que peguen a SPs y a SQL inline (ej. listado de ediciones, listado
   FICO) — deben responder igual que antes.
5. **Export SPs**: verificar que `src/sql/db_routines/` contiene las 69 definiciones y que
   cada archivo abre con `CREATE OR REPLACE FUNCTION/PROCEDURE`.

## Fuera de alcance (follow-ups sugeridos)

- Corregir el `public.` **interno** de los 69 SPs volcados + redeploy (fase con DDL en prod).
- Limpiar los **9 `.sql`** del repo (~115 refs) cuando se diseñe el layout real de esquemas
  (ahí se decide en qué esquema vive cada objeto, no es un simple strip).
- Bug latente aparte: `src/sql/a5_migration.sql` referencia `cat_table` (tabla inexistente;
  el real es `public."catalog"`).
- Opcional: regla de lint/CI que rechace nuevos `public.` en `.js`.
