import 'dotenv/config'
import pg from 'pg'

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 40000
})

try {
  await c.connect()
  const { rows } = await c.query(
    `SELECT id, alias, email, password, active
       FROM public.users
      ORDER BY id`
  )
  console.table(rows)
} catch (e) {
  console.error('ERROR:', e.message)
} finally {
  await c.end().catch(() => {})
}
