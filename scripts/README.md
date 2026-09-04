# Backend/scripts

Carpeta para **todo** script de prueba, sondeo, conexión a BD, backfill o one-off.
Regla del proyecto (ver `CLAUDE.md` raíz): nada de archivos de prueba/backfill
sueltos en la raíz — van aquí.

## Regla de vida de un script

Antes de guardar un script, decidí en qué grupo cae. Solo hay dos:

**A) One-off — sirvió para UN caso concreto → SE BORRA al terminar.**
Lo reconocés porque para nombrarlo necesitás un ID, un apellido o una fecha:
`fix-14709-cc-alumno-duplicado`, `_diag-8519`, `_verifica-1075`. Ese script ya
no vuelve a correr: su valor está en la BD (el dato corregido) y en el
`enrollment_audit_log`, no en el archivo. Al cerrar la corrección: **borralo.**
El aprendizaje va a la memoria / al agente, no a un `.mjs` muerto.

**B) Herramienta — sirve para el próximo caso igual → se queda con nombre genérico.**
Requisitos para quedarse, los tres:

1. **Sin identificadores en el nombre ni hardcodeados**: el caso entra por
   `process.argv` (`node scripts/ver-enrollment.mjs 14709`), nunca por una
   constante `const EID = 14709`.
2. **Corre hoy**: si no arranca contra la BD actual, no es herramienta, es basura.
3. **Cabecera de uso**: 1-3 líneas arriba con qué hace y cómo se invoca.

Si un one-off resultó útil dos veces, no lo copies: **parametrizalo y promovelo a
herramienta** con el nombre del prefijo que le toque.

## Nomenclatura (clean code)

`<verbo>-<sustantivo>.mjs`, en minúsculas con guiones, verbo primero, **sin IDs**.
Si el nombre no se puede escribir sin un número, es un one-off (grupo A).

| Prefijo    | Qué es                                                        | Ejemplo |
|------------|---------------------------------------------------------------|---------|
| `ver-`     | Inspector de solo lectura de una entidad, por argv             | `ver-enrollment.mjs 14709` |
| `check-`   | Verificación re-ejecutable con `assert`; sale ≠ 0 si falla     | `check-rp-seg-cuotas.mjs` |
| `probe-`   | Sondeo del estado real de un módulo (esquema, datos, SP)       | `probe-event-schema.mjs` |
| `reporte-` | Consulta de negocio parametrizada                              | `reporte-membresia-luego-cursos.mjs [desde] [hasta]` |
| `import-`  | Carga de datos desde la hoja FICO                              | `import-hoja-fico.mjs <csv> commit` |
| `fix-`     | **Escribe en BD.** Idempotente, `--apply` para escribir de verdad | (one-off: borrar al terminar) |
| `backfill-`| Corrección masiva de una vez. Idempotente + dry-run            | (one-off: borrar al terminar) |
| `refresh-` | Mantenimiento (matviews, caches)                               | `refresh-mv-enrollment-report.mjs <id>` |

Todo lo que **escribe** (`fix-`, `backfill-`) exige: dry-run por defecto,
`--apply` explícito, respaldo `_backup_*.json` previo, e idempotencia real
(correrlo dos veces no cambia nada la segunda vez).

## Conexión a la BD

IMPORTANTE SI EL TUNEL ESTA ABIERTO NO PEDIR CONTRASEÑA ENTRAR YA QUE SE EL PERMISO ES ACEPTADO DE ANTEMANO DE PODER ENTRA A LA BASE, SI ALGUNAS VEZ SE TIENE QUE BORRAR ALGO GRANDE INFORMAR ASI:
    -> ELIMINACIÓN DE DATA GRANDE: 500 FILAS DE TAL TAL

`db.mjs` expone un pool de `pg` ya configurado al túnel de producción
(`127.0.0.1:55432`). La contraseña viene de `PGPASSWORD` (no se guarda en el repo):

```bash
export PGPASSWORD='<pw del túnel — pedirla al usuario / DBeaver>'
node Backend/scripts/mi-prueba.mjs
```

```js
import { q, pool } from './db.mjs'
const { rows } = await q('SELECT now()')
console.log(rows); await pool.end()
```

Un script nuevo usa `db.mjs`. **No** vuelvas a copiar el bloque
`new pg.Client({ host: '127.0.0.1', port: 55432, ... })` a mano: eso es lo que
dejó 15 copias del mismo parser de `DATABASE_URL` en esta carpeta.

Para psql directo: `PATH` = `C:\Program Files\PostgreSQL\18\bin`; usar
`PGCLIENTENCODING=WIN1252` si el SQL lleva tildes desde Bash. El túnel se cae
seguido → reintentar y meter cada operación en una sola conexión.

## Herramientas vigentes

| Script | Para qué |
|---|---|
| `db.mjs` | Pool compartido al túnel. Lo importa todo lo demás. |
| `ver-enrollment.mjs <id>` | Cabecera, familia, estados y auditoría de un enrollment. Paso 1 de toda corrección. |
| `ver-estados-enrollment.mjs` | Catálogo de `cat_type_status` + distribución real. De dónde sale el "ACT". |
| `refresh-mv-enrollment-report.mjs <id> [--solo-ver]` | Refresca la matview del panel FICO y muestra la fila. Paso final de toda corrección. |
| `import-hoja-fico.mjs` | Importa una pestaña de la hoja FICO por CLI (freeze / preview / validate / commit). |
| `marca-pagos-hoja-fico.mjs <csv> [--aplicar]` | Fase 2 del import: marca cobrado lo que la hoja da por cobrado. |
| `backfill-pagos-cuotas.mjs <caso.json> [--apply]` | Cobra una inscripción importada cuando cada cuota tiene medio, cuenta y N° de operación propios (la fila de detalle de la hoja). Ver formato abajo. |
| `fix-descuento-global.mjs <id> <porcentaje> [--apply]` | Reconstruye el descuento % que el importador no guardó (`list_price = total_amount`, `discount_amount = 0`, sin fila en `enrollment_discounts`). No toca el total. |
| `fix-hijos-seg-e0.mjs <id> <pv:edicion> ... [--apply]` | Crea los hijos SEG que el import con ED "E0" nunca creó (padre de paquete sin aulas). Plan literal módulo por módulo de la fila FICO; sin Odoo ni correo. El padre no se toca. |
| `check-rp-seg-cuotas.mjs [id]` | El filtro de cuotas pendientes del RP contra el payload real. |
| `check-tooltip-descuentos.mjs [id...]` | El tooltip de descuentos cuadra con la barra. |
| `check-hijos-online-sin-edicion.mjs` | Rama "módulo ONLINE sin edición" de `buildEditionPlan`. Puro, sin BD. |
| `check-sync-destino-cc.mjs` | El destino de un CC entra a las 3 hojas de venta y las hijas de paquete siguen fuera. (Lento.) |
| `reporte-membresia-luego-cursos.mjs [desde] [hasta]` | Alumnos que compraron membresía y después cursos aparte. |
| `probe-event-schema.mjs` / `probe-event-save.mjs` | Estado y guardado del módulo Fundación > Eventos. |

### `caso.json` de `backfill-pagos-cuotas.mjs`

`marca-pagos-hoja-fico.mjs` deduce los pagos del INGRESO y usa un solo medio para
toda la fila. Cuando la fila de detalle de la hoja cobra cada cuota a una empresa
distinta (pasa seguido: WE Educación, WE Latam y WE Foundation en la misma venta),
esa aproximación pierde la cuenta y el N° de operación. Ahí va este script:

```json
{
  "enrollment_id": 644,
  "fecha_caso": "2026-08-13",
  "total_hoja": 1310,
  "reserva": { "numero": 0, "monto": 350, "fecha": "2026-03-27", "medio": 3203, "cuenta": 6, "operacion": "4103827" },
  "cuotas": [
    { "numero": 1, "monto": 192, "fecha": "2026-04-15", "medio": 3203, "cuenta": 16, "operacion": "447555" }
  ],
  "justificacion": "Texto que queda en enrollment_audit_log."
}
```

`medio` = catálogo `we_payment_medium` (Transferencia 3203, Depósito 3204, YAPE
3205, Culqui 3208, Mercado Pago 3256). Mercado Pago va con `"cuenta": null` y
`"operacion": null`: no liquida contra una cuenta nuestra ni trae N° de operación.
`cuenta` = `bank_accounts.account_id`, que sale de
**banco + empresa + moneda** de la hoja (la ENTIDAD FINANCIERA manda; el medio no
define la cuenta): WE Educación BCP PEN = 6, WE Educación Interbank PEN = 9,
WE Latam BCP PEN = 12, WE Foundation BCP PEN = 16, WE Consulting BCP PEN = 1.
`fecha` es la de **cobro**. El vencimiento del cronograma no se toca, salvo el de
la cuota 0: varios imports la sellaron con la fecha de importación en vez de la
fecha en que se cobró la reserva, y el script la alinea a `reserva.fecha`. Aborta
si algún monto de la hoja no coincide con la cuota en BD, y al terminar refresca
la matview.

## Artefactos de backfill / respaldo

Los `_backfill_*.json` / `_backup_*.json` / `_hoja_*.csv` son salidas puntuales de
correcciones históricas: **respaldos previos a un `fix-`**, o sea el único rollback
que existe (el proyecto no está en git). No los consume el código. Se conservan
mientras la corrección pueda cuestionarse; después se borran junto con su script.
