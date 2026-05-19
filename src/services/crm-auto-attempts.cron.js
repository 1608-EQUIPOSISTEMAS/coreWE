// =============================================================================
// CRM | CRON JOBS - Automatización de Reglas de Leads
// Archivo: src/cron/crm-auto-attempts.cron.js
// =============================================================================

import cron from 'node-cron';
import { pool } from '../config/db.js';
import { sseClients } from '../routes/notifications.js'; // ← NUEVO

// Lock distribuido por nombre de funcion: si la ejecucion previa aun corre, la
// siguiente se salta el turno en vez de duplicarlo. Critico para rule5 y rule7
// que corren cada minuto y procesan filas con UPDATE.
function hashLockKey(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

async function runCrmRule(functionName) {
  let client;
  const lockKey = hashLockKey(functionName);
  try {
    client = await pool.connect();
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [lockKey]);
    if (!rows[0]?.acquired) {
      console.warn(`[CRM CRON] ⏭ ${functionName} ya esta en ejecucion, se omite este turno.`);
      return;
    }
    try {
      console.log(`[CRM CRON] Iniciando ${functionName} a las ${new Date().toLocaleTimeString()}...`);
      await client.query(`SELECT public.${functionName}()`);
      console.log(`[CRM CRON] ✅ ${functionName} completado con éxito.`);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
    }
  } catch (err) {
    console.error(`[CRM CRON] ❌ Error en ${functionName}:`, err.message);
  } finally {
    if (client) client.release();
  }
}

// =============================================================================
// REGLA 1: Edición en 3 días → 8:00 AM diario
// =============================================================================
cron.schedule('0 8 * * *', () => {
  runCrmRule('fn_rule1_edition_3days_before');
}, { timezone: 'America/Lima' });

// =============================================================================
// REGLA 2: Leads "Pagará" → 9:00 AM diario
// =============================================================================
cron.schedule('0 9 * * *', () => {
  runCrmRule('fn_rule2_will_pay_daily');
}, { timezone: 'America/Lima' });

// =============================================================================
// REGLA 3: Leads de mañana (3AM–1PM) → 1:00 PM diario
// =============================================================================
cron.schedule('0 13 * * *', () => {
  runCrmRule('fn_rule3_morning_leads');
}, { timezone: 'America/Lima' });

// =============================================================================
// REGLA 4: Leads de tarde (1PM–11:30PM) → 11:30 PM diario
// =============================================================================
cron.schedule('30 23 * * *', () => {
  runCrmRule('fn_rule4_afternoon_leads');
}, { timezone: 'America/Lima' });

// =============================================================================
// REGLA 5: Detectar llamadas pendientes vencidas → cada minuto ← NUEVO
// =============================================================================
cron.schedule('* * * * *', () => {
  runCrmRule('fn_rule5_detect_unattended_calls');
}, { timezone: 'America/Lima' });


// =============================================================================
// REGLA 6: Modal obligatorio 5PM para líderes comerciales ← NUEVO
// =============================================================================
cron.schedule('0 17 * * *', async () => {
  let client;
  try {
    client = await pool.connect();
    const { rows } = await client.query('SELECT * FROM public.fn_get_unattended_summary_today()');

    if (rows.length === 0) {
      console.log('[CRM CRON] Modal 5PM: sin llamadas sin atención hoy.');
      return;
    }

    // Obtener IDs de todos los líderes comerciales activos
    const { rows: lideres } = await client.query(`
      SELECT u.user_id
      FROM public.users u
      JOIN public.user_roles ur ON ur.user_id = u.user_id
      JOIN public.rol r       ON r.rol_id  = ur.rol_id
      WHERE r.alias = 'LIDER_COMERCIAL'
        AND u.active    = 'Y'
    `);

    if (lideres.length === 0) {
      console.log('[CRM CRON] Modal 5PM: no hay líderes activos.');
      return;
    }

    const payload = `data: ${JSON.stringify({
      tipo_evento: 'modal_5pm_unattended',
      registros:   rows,
      total:       rows.length,
      generado_a:  new Date().toISOString()
    })}\n\n`;

    let enviados = 0;
    for (const lider of lideres) {
      const clients = sseClients.get(Number(lider.user_id));
      if (clients && clients.size > 0) {
        for (const reply of clients) reply.raw.write(payload);
        enviados++;
      }
    }

    console.log(`[CRM CRON] ✅ Modal 5PM enviado a ${enviados}/${lideres.length} líderes conectados. Registros: ${rows.length}`);
  } catch (err) {
    console.error('[CRM CRON] ❌ Error en modal 5PM:', err.message);
  } finally {
    if (client) client.release();
  }
}, { timezone: 'America/Lima' });

// =============================================================================
// REGLA 7: Detectar llamadas a punto de vencer (30 min) → cada minuto
// =============================================================================
cron.schedule('* * * * *', () => {
  runCrmRule('fn_rule7_notify_upcoming_calls');
}, { timezone: 'America/Lima' });

console.log('[CRM CRON] 🕒 Todos los jobs han sido registrados e iniciados correctamente en zona America/Lima.');