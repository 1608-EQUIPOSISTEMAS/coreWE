# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

No test suite is configured. No linter is configured.

## Architecture

**CoreWE** is a Fastify-based REST API backend for an EdTech platform. The stack is:
- **Fastify 5** (ES Modules, `"type": "module"` in package.json)
- **PostgreSQL** via the `pg` library — all DB operations go through stored procedures (`sp_*` naming convention)
- **JWT** authentication with role-based access control
- **Node.js 20**, Docker on port **8082**

### Request Flow

```
HTTP Request → Route handler (src/routes/) → Service layer (src/services/) → PostgreSQL stored procedure
```

Stored procedure helpers live in `src/utils/spHelper.js` (handles REFCURSOR unpacking). Response formatting is in `src/utils/dbResponse.js`.

### Authentication & RBAC

Middleware is in `src/middlewares/auth.hooks.js`. JWT tokens expire in 12h. Routes use role guards:
- `ADMIN_ONLY` — admins only
- `ALL_COMERCIAL` — ADMIN + COMERCIAL + LIDER_COMERCIAL
- `ALL_PRODUCTO` — ADMIN + PRODUCTO + LIDER_PRODUCTO
- `ADMIN_COMERCIAL`, `ADMIN_PRODUCTO`, `ALL_ADMIN`

For SSE endpoints, the token can be passed as `?token=` query param instead of the Authorization header.

### External Integrations

| Module | File | Purpose |
|--------|------|---------|
| PostgreSQL | `src/config/db.js` | Connection pool, timezone America/Lima, max 10 connections |
| Odoo ERP | `src/config/odooClient.js` | Syncs instructors; session TTL ~28 min |
| Slack | `src/config/slack.js` | Notifies channels when instructors are created |
| Google Sheets | `src/utils/sheet.js` | Syncs leads, enrollments, schedules |
| Google Cloud Storage | `@google-cloud/storage` | File storage backend |

Google credentials are in `credentials/credentials.json` and `credentials/service.json`.

### Real-time Notifications

`src/routes/notifications.js` + `src/services/notification.service.js` use **PostgreSQL LISTEN/NOTIFY** with **Server-Sent Events (SSE)** to push real-time updates to clients.

### Scheduled Tasks

`src/services/crm-auto-attempts.cron.js` uses `node-cron`. Currently disabled/commented out in `src/app.js`.

### File Uploads

Handled via `src/routes/upload.js`. Files are stored in `/uploads/` and served as static files. Allowed MIME types: JPEG, PNG, PDF, DOCX. Max 30MB, 5 files per request.

### API Documentation

Swagger UI is auto-generated and available at `/docs` when the server is running.

## Key Environment Variables

```
PORT=8082
HOST=0.0.0.0
JWT_SECRET=
DATABASE_URL=
SLACK_TOKEN=
SLACK_CHANNEL=
SLACK_CHANNEL_MATCH_WEB=
ODOO_URL=
ODOO_DB=
ODOO_LOGIN=
ODOO_PASSWORD=
```
