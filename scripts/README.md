# Backend/scripts

Carpeta para **todo** script de prueba, sondeo, conexión a BD, backfill o one-off.
Regla del proyecto (ver `CLAUDE.md` raíz): nada de archivos de prueba/backfill
sueltos en la raíz — van aquí.

## Conexión a la BD

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

Para psql directo: `PATH` = `C:\Program Files\PostgreSQL\18\bin`; usar
`PGCLIENTENCODING=WIN1252` si el SQL lleva tildes desde Bash. El túnel se cae
seguido → reintentar y meter cada operación en una sola conexión.

## Artefactos de backfill / respaldo

Los `_backfill_*.json` / `_backup_*.json` / `_padres_*.json` son salidas puntuales
de correcciones históricas; se conservan como historial, no los consume el código.
