import { pool, withTransaction } from '../../../shared/db/pool.js'
import { DomainError } from '../../../shared/errors.js'
import { NOT_CURRENT_STATUSES, INSTALLMENT_PAID_STATUSES, INSTALLMENT_VOID_STATUSES, missingPaymentData } from './reconciliation.entity.js'

// Persistencia de la conciliacion hoja FICO <-> BD.
//   - Lecturas: una query por concepto para toda la hoja, no por fila.
//   - Correcciones (Fase 3): cada una en UNA transaccion, con la inscripcion
//     bloqueada (FOR UPDATE), solo sobre inscripciones de importacion masiva
//     ('masiva FICO' en notes) y con su fila en enrollment_audit_log.

// Enlace de un destino de RP/CC con su origen: lo escriben reprogramEdition y
// courseChange en la nota del destino ("Reprogramacion desde inscripcion #123").
const MOVE_LINK_SQL = `
  substring(e.notes from '(?:Reprogramacion|Cambio de curso) desde inscripcion #([0-9]+)')::int AS move_origin_id,
  CASE WHEN e.notes ~ 'Reprogramacion desde inscripcion #' THEN 'RP'
       WHEN e.notes ~ 'Cambio de curso desde inscripcion #' THEN 'CC' END AS move_kind,
  COALESCE(e.notes, '') ~* 'viene de una? ?(rp|cc)' AS notes_viene_de,
  COALESCE(e.notes, '') LIKE '%masiva FICO%' AS imported`

// Cuotas de la inscripcion `e` con sus pagos activos: la conciliacion compara
// montos, estados y los datos de cada pago (cuenta, medio, N° de operacion), y
// las correcciones deciden con los pagos de cada cuota.
const INSTALLMENTS_JSON_SQL = `
  COALESCE((SELECT json_agg(json_build_object(
              'installment_id', pi.installment_id, 'n', pi.installment_number, 'amount', pi.amount::float8,
              'status', pi.cat_status, 'due_date', to_char(pi.due_date, 'YYYY-MM-DD'),
              'has_payment', EXISTS (SELECT 1 FROM payments x WHERE x.installment_id = pi.installment_id AND x.active = 'Y'),
              'payments', COALESCE((SELECT json_agg(json_build_object('payment_id', x.payment_id, 'amount', x.amount::float8,
                                      'account_id', x.settled_in_account_id, 'medium', x.cat_method_payment, 'operation', x.transaction_code)
                                      ORDER BY x.payment_id)
                                      FROM payments x WHERE x.installment_id = pi.installment_id AND x.active = 'Y'), '[]'::json))
              ORDER BY pi.installment_number, pi.installment_id)
              FROM payment_installments pi WHERE pi.enrollment_id = e.enrollment_id), '[]'::json)`

export class ReconciliationRepository {
  constructor (db = pool) {
    this.db = db
  }

  // Ediciones activas de las versiones (COD) de la hoja: definen el alcance (las
  // historicas no se importan) y la estructura de aulas hijas esperada.
  async activeEditions (versionCodes) {
    const { rows } = await this.db.query(`
      SELECT pe.edition_num_id AS program_edition_id, pv.version_code, pe.global_code
        FROM program_editions pe
        JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
       WHERE pe.active = 'Y' AND UPPER(pv.version_code) = ANY($1::text[])`,
    [versionCodes.map(c => c.toUpperCase())])
    return rows
  }

  // Aulas hijas activas por edicion-padre (mismo criterio que listEditionStructure
  // del importador, que es quien las crea): Map(edicion padre -> [{ edition_id, label }]).
  async structure (editionIds) {
    if (!editionIds.length) return new Map()
    const { rows } = await this.db.query(`
      SELECT es.parent_edition_id, es.child_edition_id AS edition_id, pe.program_version_id AS version_id,
             pv.version_code || ' ' || pe.global_code AS label
        FROM edition_structure es
        JOIN program_editions pe ON pe.edition_num_id = es.child_edition_id
        JOIN program_versions pv ON pv.program_version_id = pe.program_version_id
       WHERE pe.active = 'Y' AND es.parent_edition_id = ANY($1::int[])`, [editionIds])
    const map = new Map()
    for (const r of rows) {
      const k = Number(r.parent_edition_id)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push({ edition_id: Number(r.edition_id), version_id: Number(r.version_id), label: r.label })
    }
    return map
  }

  // Inscripciones padre (sin parent) de las versiones de la hoja, con lo que la
  // conciliacion compara: total, pagos activos, cuotas, hijas vigentes (por aula),
  // membresia, asesor, fecha y el enlace RP/CC.
  async enrollmentsByVersions (versionCodes) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, p.document_number,
             TRIM(concat_ws(' ', p.last_name, p.mother_last_name, p.first_name)) AS student,
             pv.version_code, pe.global_code, e.program_edition_id,
             e.total_amount::float8 AS total_amount, e.cat_payment_plan,
             to_char(e.registration_date, 'YYYY-MM-DD') AS registration_date,
             e.cat_type_status, st.description AS status_label, e.active,
             e.membership_program_id, u.alias AS agent_alias, e.seller_agent_id,
             ${MOVE_LINK_SQL},
             COALESCE((SELECT json_agg(json_build_object(
                         'edition_id', ch.program_edition_id,
                         'label', cpv.version_code || ' ' || COALESCE(cpe.global_code, 'sin edicion'))
                         ORDER BY ch.program_edition_id)
                         FROM enrollments ch
                         JOIN program_versions cpv ON cpv.program_version_id = ch.program_version_id
                         LEFT JOIN program_editions cpe ON cpe.edition_num_id = ch.program_edition_id
                        WHERE ch.parent_enrollment_id = e.enrollment_id AND ch.active = 'Y'
                          AND COALESCE(ch.cat_type_status, 0) <> ALL($2::int[])), '[]'::json) AS children,
             COALESCE((SELECT SUM(py.amount) FROM payments py
                        WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'), 0)::float8 AS paid_amount,
             ${INSTALLMENTS_JSON_SQL} AS installments
        FROM enrollments e
        JOIN customers c ON c.customer_id = e.customer_id
        JOIN persons p ON p.person_id = c.person_id
        JOIN program_versions pv ON pv.program_version_id = e.program_version_id
        LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
        LEFT JOIN catalog st ON st.catalog_id = e.cat_type_status
        LEFT JOIN users u ON u.user_id = e.seller_agent_id
       WHERE UPPER(pv.version_code) = ANY($1::text[])
         AND e.parent_enrollment_id IS NULL`,
    [versionCodes.map(c => c.toUpperCase()), NOT_CURRENT_STATUSES])
    return rows
  }

  // Inscripciones padre de los alumnos de la hoja en CUALQUIER programa: ahi
  // viven los destinos de un CC (otro programa, otra hoja) y los destinos
  // importados sueltos que la conciliacion propone como "posible destino".
  async enrollmentsByDocuments (documentNumbers) {
    if (!documentNumbers.length) return []
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, p.document_number, pv.version_code, pe.global_code, e.program_edition_id,
             e.total_amount::float8 AS total_amount, e.cat_type_status, st.description AS status_label, e.active,
             to_char(e.registration_date, 'YYYY-MM-DD') AS registration_date,
             ${MOVE_LINK_SQL},
             COALESCE(pr.is_membership, false) AS is_membership,
             COALESCE((SELECT SUM(pi.amount) FROM payment_installments pi
                        WHERE pi.enrollment_id = e.enrollment_id
                          AND pi.cat_status <> ALL($2::int[])), 0)::float8 AS pending_amount
        FROM enrollments e
        JOIN customers c ON c.customer_id = e.customer_id
        JOIN persons p ON p.person_id = c.person_id
        JOIN program_versions pv ON pv.program_version_id = e.program_version_id
        JOIN programs pr ON pr.program_id = pv.program_id
        LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
        LEFT JOIN catalog st ON st.catalog_id = e.cat_type_status
       WHERE p.document_number = ANY($1::text[]) AND e.parent_enrollment_id IS NULL`,
    [documentNumbers, [...INSTALLMENT_PAID_STATUSES, ...INSTALLMENT_VOID_STATUSES]])
    return rows
  }

  // --- Correcciones -----------------------------------------------------------

  // Plan de cuotas/pagos segun la hoja. `planFn(state)` (entity) calcula las
  // operaciones con el estado YA bloqueado, asi lo que se aplica es lo que hay
  // ahora, no lo que se vio en pantalla. `paymentDetail(n)` da medio, cuenta,
  // fecha y N° de operacion de la hoja para cada pago nuevo.
  async applyFinancialFix ({ enrollmentId, planFn, paymentDetail, userId }) {
    return withTransaction(async client => {
      await lockImported(client, enrollmentId)
      const { rows: [state] } = await client.query(`
        SELECT e.total_amount::float8 AS total_amount, e.cat_payment_plan, ${INSTALLMENTS_JSON_SQL} AS installments
          FROM enrollments e WHERE e.enrollment_id = $1`, [enrollmentId])
      const plan = planFn(state)
      if (plan.blocked) throw new DomainError(plan.blocked)
      if (!plan.ops.length) return { ...plan, applied: false }

      const cat = await catalogIds(client, ['we_inst_paid', 'we_inst_pending', 'we_inst_cancelled'])
      const insertedByN = new Map()
      for (const op of plan.ops) {
        switch (op.type) {
          case 'insert_installment': {
            const { rows: [ins] } = await client.query(`
              INSERT INTO payment_installments (enrollment_id, installment_number, amount, due_date, cat_status, notes)
              VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6) RETURNING installment_id`,
            [enrollmentId, op.n, op.amount, op.due_date || null, op.paid ? cat.we_inst_paid : cat.we_inst_pending,
              `${op.n === 0 ? 'Reserva / Pago inicial' : `Cuota ${op.n}`} - ${op.paid ? 'Pagada' : 'Pendiente'} (conciliacion hoja FICO)`])
            insertedByN.set(op.n, ins.installment_id)
            break
          }
          case 'insert_payment': {
            const installmentId = op.installment_id || insertedByN.get(op.n)
            const d = paymentDetail(op.n) || {}
            await client.query(`
              INSERT INTO payments (enrollment_id, installment_id, amount, payment_date, transaction_code,
                cat_method_payment, cat_payment_type, cat_settlement_status,
                settled_in_account_id, active, user_registration_id, registration_date)
              VALUES ($1, $2, $3, COALESCE($4::date, NOW()), $5, $6,
                (SELECT catalog_id FROM catalog WHERE alias = $7),
                (SELECT catalog_id FROM catalog WHERE alias = 'we_settlement_status_pending'),
                $8, 'Y', $9, NOW())`,
            [enrollmentId, installmentId, op.amount, d.payment_date || null, d.transaction_code || null,
              d.cat_payment_medium || null, op.n === 0 ? 'we_payment_type_initial' : 'we_payment_type_single',
              d.bank_account_id || null, userId])
            break
          }
          case 'update_amount':
            await expectOne(client.query(
              'UPDATE payment_installments SET amount = $3 WHERE installment_id = $1 AND enrollment_id = $2',
              [op.installment_id, enrollmentId, op.to]), `cuota ${op.n}`)
            break
          case 'update_payment':
            await expectOne(client.query(
              `UPDATE payments SET amount = $3 WHERE payment_id = $1 AND enrollment_id = $2 AND active = 'Y'`,
              [op.payment_id, enrollmentId, op.to]), `pago de la cuota ${op.n}`)
            break
          case 'set_paid':
          case 'set_pending':
            await expectOne(client.query(
              'UPDATE payment_installments SET cat_status = $3 WHERE installment_id = $1 AND enrollment_id = $2',
              [op.installment_id, enrollmentId, op.type === 'set_paid' ? cat.we_inst_paid : cat.we_inst_pending]), `cuota ${op.n}`)
            break
          case 'void_installment':
            await expectOne(client.query(`
              UPDATE payment_installments SET cat_status = $3, notes = 'Anulada: no esta en la hoja FICO (conciliacion) | ' || COALESCE(notes, '')
               WHERE installment_id = $1 AND enrollment_id = $2`,
            [op.installment_id, enrollmentId, cat.we_inst_cancelled]), `cuota ${op.n}`)
            break
          case 'set_total':
            await client.query(`
              UPDATE enrollments SET total_amount = $2, list_price = $2 + COALESCE(discount_amount, 0),
                     user_modification_id = $3, modification_date = NOW()
               WHERE enrollment_id = $1`, [enrollmentId, op.to, userId])
            break
          case 'set_payment_plan':
            await client.query(
              'UPDATE enrollments SET cat_payment_plan = $2, user_modification_id = $3, modification_date = NOW() WHERE enrollment_id = $1',
              [enrollmentId, op.to, userId])
            break
          default:
            throw new Error(`Operacion desconocida: ${op.type}`)
        }
      }

      // Invariante del plan: las cuotas vigentes suman el total.
      const { rows: [chk] } = await client.query(`
        SELECT e.total_amount::float8 AS total,
               COALESCE((SELECT SUM(amount) FROM payment_installments
                          WHERE enrollment_id = e.enrollment_id AND cat_status <> ALL($2::int[])), 0)::float8 AS cuotas
          FROM enrollments e WHERE e.enrollment_id = $1`, [enrollmentId, INSTALLMENT_VOID_STATUSES])
      if (Math.abs(chk.total - chk.cuotas) > 0.01) {
        throw new DomainError(`Las cuotas quedarían sumando ${chk.cuotas} con un total de ${chk.total}: no se aplicó nada.`)
      }

      await audit(client, enrollmentId, plan.kind === 'payments' ? 'payment_registered' : 'data_correction', userId,
        `Conciliacion hoja FICO: ${plan.kind === 'payments' ? 'pagos de cuotas cobradas segun la hoja' : 'plan de cuotas y pagos segun la hoja'}.`,
        { ops: plan.ops }, plan.changes.join(' '))
      return { ...plan, applied: true }
    })
  }

  // Completa en los pagos los datos que estan vacios y la hoja si trae (cuenta,
  // medio, N° de operacion). Se recalcula con la inscripcion bloqueada y solo
  // escribe sobre NULL: lo que alguien ya cargo a mano no se pisa.
  //   detailOf: (n) -> detalle de pago de la hoja ya resuelto (ver missingPaymentData).
  async fillPaymentData ({ enrollmentId, userId, detailOf }) {
    return withTransaction(async client => {
      await lockImported(client, enrollmentId)
      const { rows: [state] } = await client.query(
        `SELECT ${INSTALLMENTS_JSON_SQL} AS installments FROM enrollments e WHERE e.enrollment_id = $1`, [enrollmentId])
      const insts = (state.installments || []).filter(i => !INSTALLMENT_VOID_STATUSES.includes(Number(i.status)))
      const missing = missingPaymentData(insts, detailOf)
      if (!missing.length) return { applied: false, changes: [] }

      for (const m of missing) {
        await expectOne(client.query(`
          UPDATE payments
             SET settled_in_account_id = COALESCE(settled_in_account_id, $3),
                 cat_method_payment = COALESCE(cat_method_payment, $4),
                 transaction_code = COALESCE(NULLIF(TRIM(transaction_code), ''), $5)
           WHERE payment_id = $1 AND enrollment_id = $2 AND active = 'Y'`,
        [m.payment_id, enrollmentId, m.set.account_id ?? null, m.set.medium ?? null, m.set.operation ?? null]),
        `el pago de la cuota ${m.n}`)
      }
      const changes = missing.map(m => `Pago de la cuota ${m.n}: ${m.labels.join(', ')}.`)
      await audit(client, enrollmentId, 'data_correction', userId,
        'Conciliacion hoja FICO: datos de pago vacios completados segun la hoja.',
        { payments: missing.map(m => ({ payment_id: m.payment_id, n: m.n, ...m.set })) }, changes.join(' '))
      return { applied: true, changes }
    })
  }

  // Baja de inscripciones duplicadas (mismo criterio que las bajas manuales:
  // active='N' + motivo Duplicado, pagos inactivos, cuotas Anuladas). No borra.
  async annulDuplicates ({ keepId, enrollmentIds, userId }) {
    return withTransaction(async client => {
      const cat = await catalogIds(client, ['we_anulment_reason_dup', 'we_inst_cancelled'])
      const today = new Date().toISOString().slice(0, 10)
      const done = []
      for (const id of enrollmentIds) {
        await lockImported(client, id)
        const { rows: kids } = await client.query(
          `SELECT enrollment_id FROM enrollments WHERE parent_enrollment_id = $1 AND active = 'Y'`, [id])
        const all = [id, ...kids.map(k => k.enrollment_id)]
        const { rows: pays } = await client.query(
          `UPDATE payments SET active = 'N' WHERE enrollment_id = ANY($1::int[]) AND active = 'Y' RETURNING payment_id, amount::float8 AS amount`, [all])
        await client.query(`
          UPDATE payment_installments SET cat_status = $2,
                 notes = 'Anulada: inscripcion duplicada de #' || $3::text || ' (conciliacion ' || $4::text || ') | ' || COALESCE(notes, '')
           WHERE enrollment_id = ANY($1::int[]) AND cat_status <> $2`, [all, cat.we_inst_cancelled, keepId, today])
        await client.query(`
          UPDATE enrollments SET active = 'N',
                 cat_anulment_reason = CASE WHEN enrollment_id = $2 THEN $3 ELSE cat_anulment_reason END,
                 user_modification_id = $4, modification_date = NOW(),
                 notes = COALESCE(notes, '') || ' | DUPLICADO de la inscripcion #' || $5::text || ' (conciliacion hoja FICO, ' || $6::text || ').'
           WHERE enrollment_id = ANY($1::int[])`, [all, id, cat.we_anulment_reason_dup, userId, keepId, today])
        await audit(client, id, 'edited', userId,
          `Conciliacion hoja FICO: duplicado de la inscripcion #${keepId}. Baja (active=N) con sus hijas, pagos y cuotas; no se borro nada.`,
          { active: { old: 'Y', new: 'N' }, duplicado_de: keepId, hijas: all.slice(1), pagos_desactivados: pays, cat_anulment_reason: cat.we_anulment_reason_dup })
        for (const k of all.slice(1)) {
          await audit(client, k, 'edited', userId, `Baja (active=N): hija del duplicado #${id} (duplicado de #${keepId}).`, null)
        }
        done.push({ enrollment_id: id, children: all.length - 1, payments: pays.length })
      }
      return done
    })
  }

  // Asesor de la columna AS en el padre y sus hijas.
  async setAgent ({ enrollmentId, sellerAgentId, agentOrigin, userId }) {
    return withTransaction(async client => {
      const old = await lockImported(client, enrollmentId)
      await client.query(`
        UPDATE enrollments SET seller_agent_id = $2, agent_origin = COALESCE($3, agent_origin),
               user_modification_id = $4, modification_date = NOW()
         WHERE enrollment_id = $1 OR parent_enrollment_id = $1`, [enrollmentId, sellerAgentId, agentOrigin, userId])
      await audit(client, enrollmentId, 'seller_agent_changed', userId, 'Conciliacion hoja FICO: asesor segun la columna AS.',
        { seller_agent_id: { old: old.seller_agent_id, new: sellerAgentId }, agent_origin: { old: old.agent_origin, new: agentOrigin ?? old.agent_origin } })
    })
  }

  // Tier de membresia (col J) en la inscripcion del curso.
  async setMembership ({ enrollmentId, membershipProgramId, userId }) {
    return withTransaction(async client => {
      const old = await lockImported(client, enrollmentId)
      await client.query(
        'UPDATE enrollments SET membership_program_id = $2, user_modification_id = $3, modification_date = NOW() WHERE enrollment_id = $1',
        [enrollmentId, membershipProgramId, userId])
      await audit(client, enrollmentId, 'data_correction', userId, 'Conciliacion hoja FICO: membresia segun la columna J.',
        { membership_program_id: { old: old.membership_program_id, new: membershipProgramId } })
    })
  }

  // RP que se importo partida: enlaza el destino suelto con su origen, como lo
  // deja reprogramEdition pero SIN crear otro destino (el suelto conserva sus
  // aulas, asistencia y notas). Origen -> RP con lo pagado; hijas del origen ->
  // retiradas; cuotas pendientes del origen -> al destino; nota del enlace.
  async linkReprogram ({ originId, destinationId, userId }) {
    return withTransaction(async client => {
      const o = await lockImported(client, originId)
      const d = await lockImported(client, destinationId)
      if (o.customer_id !== d.customer_id) throw new DomainError('El origen y el destino son de alumnos distintos.')
      if (Number(o.program_version_id) !== Number(d.program_version_id)) throw new DomainError('El destino es de otro programa: es un CC.')
      if (/desde inscripcion #/.test(d.notes || '')) throw new DomainError(`#${destinationId} ya viene de otra RP/CC.`)
      const cat = await catalogIds(client, ['we_enrollment_status_reprogrammed', 'we_enrollment_status_retired'])
      if (Number(o.cat_type_status) === cat.we_enrollment_status_reprogrammed) throw new DomainError(`#${originId} ya está en RP.`)

      const { rows: pending } = await client.query(`
        SELECT pi.installment_id, pi.installment_number, pi.amount::float8 AS amount
          FROM payment_installments pi
         WHERE pi.enrollment_id = $1 AND pi.installment_number > 0
           AND pi.cat_status <> ALL($2::int[])
           AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.installment_id = pi.installment_id AND p.active = 'Y')
         ORDER BY pi.installment_number`, [originId, [...INSTALLMENT_PAID_STATUSES, ...INSTALLMENT_VOID_STATUSES]])
      if (pending.length) {
        // Como reprogramEdition: la cuota "pago cero" del destino se va y las
        // pendientes del origen pasan con nuevo numero.
        await client.query(`
          DELETE FROM payment_installments pi WHERE pi.enrollment_id = $1 AND pi.amount = 0
             AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.installment_id = pi.installment_id)`, [destinationId])
        const { rows: [{ max }] } = await client.query(
          'SELECT COALESCE(MAX(installment_number), 0) AS max FROM payment_installments WHERE enrollment_id = $1', [destinationId])
        let n = Number(max)
        for (const p of pending) {
          n++
          await expectOne(client.query(`
            UPDATE payment_installments SET enrollment_id = $1, installment_number = $2, notes = $3
             WHERE installment_id = $4 AND enrollment_id = $5`,
          [destinationId, n, `Cuota ${n} - Pendiente (trasladada por reprogramacion de #${originId})`, p.installment_id, originId]),
          `cuota ${p.installment_number}`)
        }
        await client.query('UPDATE enrollments SET cat_payment_plan = $2 WHERE enrollment_id = $1', [destinationId, o.cat_payment_plan])
      } else {
        // Sin deuda que trasladar: la cuota en 0 del destino deja de decir "Beca".
        await client.query('UPDATE payment_installments SET notes = $2 WHERE enrollment_id = $1 AND amount = 0',
          [destinationId, `Reprogramacion - pagos registrados en inscripcion #${originId}`])
      }

      const rpNote = `Reprogramacion desde inscripcion #${originId} (${o.version_code || ''} ${o.global_code || ''})`
      await client.query(`
        UPDATE enrollments SET notes = $2 || '. ' || COALESCE(notes, ''), user_modification_id = $3, modification_date = NOW()
         WHERE enrollment_id = $1`, [destinationId, rpNote, userId])
      await client.query(
        'UPDATE enrollments SET cat_type_status = $2, user_modification_id = $3, modification_date = NOW() WHERE enrollment_id = $1',
        [originId, cat.we_enrollment_status_reprogrammed, userId])

      const { rows: kids } = await client.query(`
        SELECT enrollment_id FROM enrollments
         WHERE parent_enrollment_id = $1 AND active = 'Y' AND COALESCE(cat_type_status, 0) <> $2`, [originId, cat.we_enrollment_status_retired])
      for (const k of kids) {
        await client.query(
          'UPDATE enrollments SET cat_type_status = $2, user_modification_id = $3, modification_date = NOW() WHERE enrollment_id = $1',
          [k.enrollment_id, cat.we_enrollment_status_retired, userId])
        await client.query('DELETE FROM payment_installments WHERE enrollment_id = $1 AND cat_status <> ALL($2::int[])',
          [k.enrollment_id, INSTALLMENT_PAID_STATUSES])
        await audit(client, k.enrollment_id, 'retired', userId, 'Conciliacion hoja FICO: RP del padre.',
          null, `Retirado por reprogramacion del programa padre #${originId} (destino #${destinationId})`)
      }

      const moved = pending.reduce((s, p) => s + p.amount, 0)
      const changes = {
        Edicion: { old: o.global_code || '---', new: d.global_code || '---' },
        'Nuevo enrollment': { old: '---', new: `#${destinationId}` },
        old_edition_id: o.program_edition_id,
        new_edition_id: d.program_edition_id,
        new_enrollment_id: destinationId
      }
      if (pending.length) changes['Cuotas trasladadas'] = { old: '---', new: `${pending.length} cuota(s) pendiente(s) (S/. ${moved.toFixed(2)}) al enrollment #${destinationId}` }
      if (kids.length) changes['Modulos retirados'] = { old: '---', new: `${kids.length} aula(s) hija(s)` }
      await audit(client, originId, 'edition_reprogrammed', userId, 'Conciliacion hoja FICO: RP importada partida (destino suelto enlazado).', changes,
        `Reprogramacion de edicion: ${o.global_code || '---'} → ${d.global_code || '---'}. Destino existente #${destinationId}`)
      await audit(client, destinationId, 'created_from_rp', userId, 'Conciliacion hoja FICO: RP importada partida (destino suelto enlazado).',
        { 'Enrollment origen': { old: '---', new: `#${originId}` }, 'Edicion origen': { old: '---', new: o.global_code || '---' } },
        `Enlazado como destino de la RP de #${originId}${pending.length ? `. ${pending.length} cuota(s) pendiente(s) heredada(s)` : ''}`)
      return { moved: pending.length, moved_amount: moved, retired_children: kids.length }
    })
  }
}

// Bloquea la inscripcion padre y exige que venga de la importacion masiva.
async function lockImported (client, enrollmentId) {
  const { rows: [e] } = await client.query(`
    SELECT e.enrollment_id, e.customer_id, e.program_version_id, e.program_edition_id, e.cat_type_status,
           e.cat_payment_plan, e.seller_agent_id, e.agent_origin, e.membership_program_id, e.notes, e.active,
           pv.version_code, pe.global_code
      FROM enrollments e
      JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
     WHERE e.enrollment_id = $1 AND e.parent_enrollment_id IS NULL
       FOR UPDATE OF e`, [enrollmentId])
  if (!e) throw new DomainError(`La inscripción #${enrollmentId} no existe o es una hija.`)
  if (!String(e.notes || '').includes('masiva FICO')) {
    throw new DomainError(`La inscripción #${enrollmentId} no viene de la importación masiva: corregirla desde su detalle.`)
  }
  if (e.active !== 'Y') throw new DomainError(`La inscripción #${enrollmentId} está dada de baja.`)
  return e
}

async function catalogIds (client, aliases) {
  const { rows } = await client.query('SELECT alias, catalog_id FROM catalog WHERE alias = ANY($1::text[])', [aliases])
  const out = Object.fromEntries(rows.map(r => [r.alias, Number(r.catalog_id)]))
  const missing = aliases.filter(a => !out[a])
  if (missing.length) throw new Error(`Catalogo no encontrado: ${missing.join(', ')}`)
  return out
}

async function expectOne (queryPromise, what) {
  const { rowCount } = await queryPromise
  if (rowCount !== 1) throw new DomainError(`No se pudo actualizar ${what} (cambió mientras tanto): vuelve a conciliar.`)
}

function audit (client, enrollmentId, action, userId, justificacion, changes, details = null) {
  return client.query(`
    INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
    VALUES ($1, $2, $3, $4, $5, $6)`,
  [enrollmentId, action, userId, justificacion, changes ? JSON.stringify(changes) : null, details])
}

export const reconciliationRepository = new ReconciliationRepository()
