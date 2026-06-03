# shared/ — Infraestructura transversal

Frontera unica que usan los modulos de `modules/`. Durante la migracion estos
archivos reexportan la implementacion legacy (config/, utils/, middlewares/,
services/) para no romper imports existentes. A medida que cada dominio migra,
la implementacion real se va moviendo aqui y el legacy queda como shim.

```
shared/
  db/       pool.js (Postgres), sp.js (stored procedures)
  http/     auth.middleware.js (authenticate, hasRole, gates de rol)
  ports/    contratos de integraciones externas (Slack, JobQueue, Odoo, Email)
  adapters/ implementaciones de los ports (slack/, jobs/)
  utils/    helpers puros reutilizables
  errors.js DomainError / NotFoundError / ForbiddenError -> mapean a HTTP
```

## Reglas de capa (se forzaran con eslint-plugin-boundaries en Fase 4)

- Un modulo importa de `shared/`, nunca al reves.
- Un modulo no importa internals de otro modulo; se comunican via `shared/` o BD.
- Una `entity` no importa nada de `shared/db` ni `shared/adapters` (debe ser pura).

Ver `docs/architecture/ADR-001` y `docs/architecture/MODULE_TEMPLATE.md`.
