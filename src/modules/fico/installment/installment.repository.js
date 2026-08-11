import { pool, withTransaction } from '../../../shared/db/pool.js'
import { odoo as odooDefault } from '../../../shared/adapters/odoo/odoo.adapter.js'
import { email } from '../../../shared/adapters/email/email.adapter.js'
import { STUDENT_EMAIL_SQL } from '../../../utils/student-contacts.sql.js'
import { isMembership } from '../../../utils/fico-formatters.js'
import { buildConfirmacionPagoHTML } from '../../../templates/confirmacion-pago.js'
import {
  CAT_STATUS_PAID,
  CAT_PAYMENT_TYPE_INSTALLMENT,
  CAT_SETTLEMENT_STATUS_PAID,
  PAID_STATUS_ALIASES
} from './installment.entity.js'
import { ALIAS } from '../../../utils/catalog-aliases.js'

// Etiqueta legible del tipo de programa para el correo de confirmacion de pago.
function resolveProgramTypeLabel (categoryDescription) {
  const raw = (categoryDescription || '').trim().toUpperCase()
  if (raw === 'ESP.' || raw === 'ESPECIALIZACION') return 'Especializacion'
  if (raw === 'DIPLOMADO') return 'Diplomado'
  if (raw === 'PEE') return 'PEE'
  return 'curso'
}

// Persistencia de cuotas y sus efectos directos (transaccion de confirmacion,
// auditoria, correo de confirmacion y sync a Odoo). Las queries y SPs se movieron
// verbatim del service legacy. No contiene reglas de negocio (viven en la entity).
export class InstallmentRepository {
  constructor (db = pool, odoo = odooDefault) {
    this.db = db
    this.odoo = odoo
  }

  // Cuota + alias de estado, validada contra la inscripcion.
  async findInstallmentWithStatus (installmentId, enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT pi.*, c.alias AS status_alias
        FROM payment_installments pi
        LEFT JOIN catalog c ON c.catalog_id = pi.cat_status
       WHERE pi.installment_id = $1 AND pi.enrollment_id = $2
    `, [installmentId, enrollmentId])
    return rows?.[0] || null
  }

  // Cuota + alias de estado para edicion de monto (JOIN estricto al catalogo).
  async findInstallmentForAmountEdit (installmentId, enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT pi.installment_id, pi.installment_number, pi.amount, pi.enrollment_id, cs.alias AS status_alias
        FROM payment_installments pi
        JOIN catalog cs ON cs.catalog_id = pi.cat_status
       WHERE pi.installment_id = $1 AND pi.enrollment_id = $2
    `, [installmentId, enrollmentId])
    return rows?.[0] || null
  }

  // Las cuatro escrituras de la confirmacion (estado de cuota, registro de pago,
  // moneda y token) se aplican de forma atomica.
  //
  // detraction (opcional): segundo deposito de la misma cuota, con su propio
  // voucher, numero de operacion y cuenta (la de detracciones del Banco de la
  // Nacion). Va como una fila mas de payments contra el MISMO installment_id, no
  // como un pago suelto: los dos depositos saldan una unica cuota.
  async confirmInstallmentTx ({ installmentId, enrollmentId, amount, paidAt, transactionCode, catPaymentMedium, bankAccountId, voucherUrl, catCurrency, userId, detraction = null }) {
    await withTransaction(async client => {
      await client.query(
        'UPDATE payment_installments SET cat_status = $1 WHERE installment_id = $2',
        [CAT_STATUS_PAID, installmentId]
      )

      await client.query(`
        INSERT INTO payments (enrollment_id, installment_id, amount, payment_date, transaction_code,
          cat_method_payment, cat_payment_type, cat_settlement_status,
          settled_in_account_id, evidence_url, active, user_registration_id, registration_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Y', $11, NOW())
      `, [enrollmentId, installmentId, amount, paidAt, transactionCode || '', catPaymentMedium || null, CAT_PAYMENT_TYPE_INSTALLMENT, CAT_SETTLEMENT_STATUS_PAID, bankAccountId || null, voucherUrl || null, userId])

      if (detraction) {
        // Sin el catalogo sembrado la fila entraria con cat_payment_type NULL y
        // la detraccion quedaria indistinguible de un pago: preferimos abortar.
        const { rows } = await client.query(
          'SELECT catalog_id FROM catalog WHERE alias = $1', [ALIAS.PAYMENT_TYPE_DETRACTION]
        )
        const catDetraction = rows?.[0]?.catalog_id
        if (!catDetraction) {
          throw new Error(`Falta el catalogo ${ALIAS.PAYMENT_TYPE_DETRACTION}: corre scripts/seed-payment-type-detraction.mjs`)
        }

        await client.query(`
          INSERT INTO payments (enrollment_id, installment_id, amount, payment_date, transaction_code,
            cat_method_payment, cat_payment_type, cat_settlement_status,
            settled_in_account_id, evidence_url, active, user_registration_id, registration_date)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Y', $11, NOW())
        `, [enrollmentId, installmentId, detraction.amount, paidAt, detraction.transactionCode || '', catPaymentMedium || null, catDetraction, CAT_SETTLEMENT_STATUS_PAID, detraction.bankAccountId || null, detraction.voucherUrl || null, userId])
      }

      if (catCurrency) {
        await client.query('UPDATE enrollments SET cat_currency = $1 WHERE enrollment_id = $2', [catCurrency, enrollmentId])
      }

      await client.query(
        "UPDATE payment_tokens SET status = 'confirmed', confirmed_by = $1, updated_at = NOW() WHERE enrollment_id = $2 AND status != 'confirmed'",
        [userId, enrollmentId]
      )
    })
  }

  // Pago adicional (certificado de becado): fila en payments SIN cuota asociada
  // (installment_id NULL, tipo we_payment_type_certificate) para no tocar el
  // PAID_AMOUNT del listado (que suma solo payment_installments pagadas), y
  // promocion del estado del certificado a "Pagado e incluido" en la misma tx.
  async registerAdditionalPaymentTx ({ enrollmentId, amount, paidAt, transactionCode, catPaymentMedium, bankAccountId, voucherUrl, catCurrency, catPaymentType, certPaidCatalogId, userId }) {
    await withTransaction(async client => {
      await client.query(`
        INSERT INTO payments (enrollment_id, installment_id, amount, payment_date, transaction_code,
          cat_method_payment, cat_payment_type, cat_settlement_status,
          settled_in_account_id, evidence_url, active, user_registration_id, registration_date)
        VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, 'Y', $10, NOW())
      `, [enrollmentId, amount, paidAt, transactionCode || '', catPaymentMedium || null, catPaymentType, CAT_SETTLEMENT_STATUS_PAID, bankAccountId || null, voucherUrl || null, userId])

      if (catCurrency) {
        await client.query('UPDATE enrollments SET cat_currency = $1 WHERE enrollment_id = $2', [catCurrency, enrollmentId])
      }

      await client.query(
        'UPDATE enrollments SET cat_certificate_status = $1 WHERE enrollment_id = $2',
        [certPaidCatalogId, enrollmentId]
      )
    })
  }

  // Pago de certificado existente (para editarlo): valida pertenencia a la
  // inscripcion y trae labels actuales para el diff de auditoria.
  async findCertificatePayment (paymentId, enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT p.*, cm.description AS payment_method_label,
             ba.bank_name, ba.account_number
        FROM payments p
        LEFT JOIN catalog cm ON cm.catalog_id = p.cat_method_payment
        LEFT JOIN bank_accounts ba ON ba.account_id = p.settled_in_account_id
       WHERE p.payment_id = $1 AND p.enrollment_id = $2 AND p.active = 'Y'
         AND p.installment_id IS NULL
         AND p.cat_payment_type IN (SELECT catalog_id FROM catalog WHERE alias IN ('we_payment_type_certificate', 'we_payment_type_reassignment', 'we_payment_type_course_change_diff'))
    `, [paymentId, enrollmentId])
    return rows?.[0] || null
  }

  async findCatalogDescription (catalogId) {
    if (!catalogId) return null
    const { rows } = await this.db.query('SELECT description FROM catalog WHERE catalog_id = $1', [catalogId])
    return rows?.[0]?.description || null
  }

  async findBankAccountLabel (accountId) {
    if (!accountId) return null
    const { rows } = await this.db.query('SELECT bank_name, account_number FROM bank_accounts WHERE account_id = $1', [accountId])
    const r = rows?.[0]
    return r ? [r.bank_name, r.account_number].filter(Boolean).join(' - ') : null
  }

  async updateAdditionalPaymentTx ({ paymentId, enrollmentId, amount, paidAt, transactionCode, catPaymentMedium, bankAccountId, voucherUrl, catCurrency }) {
    await withTransaction(async client => {
      await client.query(`
        UPDATE payments SET amount = $1, payment_date = $2, transaction_code = $3,
               cat_method_payment = $4, settled_in_account_id = $5, evidence_url = $6
         WHERE payment_id = $7 AND enrollment_id = $8
      `, [amount, paidAt, transactionCode || '', catPaymentMedium || null, bankAccountId || null, voucherUrl || null, paymentId, enrollmentId])
      if (catCurrency) {
        await client.query('UPDATE enrollments SET cat_currency = $1 WHERE enrollment_id = $2', [catCurrency, enrollmentId])
      }
    })
  }

  // Verifica que la inscripcion exista y este activa.
  async findActiveEnrollment (enrollmentId) {
    const { rows } = await this.db.query(
      'SELECT enrollment_id FROM enrollments WHERE enrollment_id = $1 AND active = $2',
      [enrollmentId, 'Y']
    )
    return rows[0] || null
  }

  // Id de catalogo para el alias dado.
  async findCatalogIdByAlias (alias) {
    const { rows } = await this.db.query('SELECT catalog_id FROM catalog WHERE alias = $1 LIMIT 1', [alias])
    return rows?.[0]?.catalog_id || null
  }

  // Maximo installment_number existente, excluyendo el 0 (inicial/reserva).
  async findMaxInstallmentNumber (enrollmentId) {
    const { rows } = await this.db.query(
      `SELECT COALESCE(MAX(installment_number), 0) AS max_num
         FROM payment_installments
        WHERE enrollment_id = $1 AND installment_number > 0`,
      [enrollmentId]
    )
    return Number(rows[0].max_num)
  }

  // Inserta una cuota nueva y devuelve su id.
  async insertInstallment ({ enrollmentId, installmentNumber, amount, dueDate, catStatus }) {
    const { rows } = await this.db.query(
      `INSERT INTO payment_installments (enrollment_id, installment_number, amount, due_date, cat_status)
       VALUES ($1, $2, $3, $4::date, $5)
       RETURNING installment_id`,
      [enrollmentId, installmentNumber, amount, dueDate, catStatus]
    )
    return rows[0].installment_id
  }

  // Actualiza el monto de una cuota existente.
  async updateInstallmentAmount (installmentId, amount) {
    await this.db.query(
      'UPDATE payment_installments SET amount = $1 WHERE installment_id = $2',
      [amount, installmentId]
    )
  }

  // Inscripcion + datos de edicion para validar la ventana de reprogramacion.
  async findEnrollmentForReschedule (enrollmentId) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id, e.odoo_order_id, pe.end_date AS edition_end_date, pe.global_code
      FROM enrollments e
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      WHERE e.enrollment_id = $1
    `, [enrollmentId])
    return rows?.[0] || null
  }

  // Cuotas actuales por ids, dentro de la inscripcion.
  async findInstallmentsByIds (enrollmentId, installmentIds) {
    const { rows } = await this.db.query(`
      SELECT installment_id, installment_number, due_date, amount, cat_status
      FROM payment_installments
      WHERE enrollment_id = $1 AND installment_id = ANY($2::int[])
    `, [enrollmentId, installmentIds])
    return rows
  }

  // Reescribe las fechas de vencimiento de forma atomica.
  async applyRescheduleTx (enrollmentId, normalizedChanges) {
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      for (const ch of normalizedChanges) {
        await client.query(
          'UPDATE payment_installments SET due_date = $1 WHERE installment_id = $2 AND enrollment_id = $3',
          [ch.new_due_date, ch.installment_id, enrollmentId]
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  // Campaña de cobranza: anula cuotas (estado Anulada, fila intacta con su
  // monto y vencimiento originales + marcador en notes), ajusta montos de las
  // cuotas vivas, paga cuotas en un solo pago consolidado (misma data de pago
  // — voucher, operacion, medio — para todas) y recalcula los totales del
  // enrollment de forma atomica. Invariante: list_price = total_amount +
  // discount_amount, asi que la plata anulada no absorbida por los ajustes se
  // registra como mas descuento.
  async applyCampaignTx ({ enrollmentId, annuls, adjusts, pays, payment, discountDelta, annulledStatusId, annulNote, userId }) {
    await withTransaction(async client => {
      for (const a of annuls) {
        await client.query(`
          UPDATE payment_installments
             SET cat_status = $1,
                 notes = CASE WHEN COALESCE(notes, '') = '' THEN $2 ELSE notes || ' | ' || $2 END
           WHERE installment_id = $3 AND enrollment_id = $4
        `, [annulledStatusId, annulNote, a.installment_id, enrollmentId])
      }
      for (const adj of adjusts) {
        await client.query(
          'UPDATE payment_installments SET amount = $1 WHERE installment_id = $2 AND enrollment_id = $3',
          [adj.new_amount, adj.installment_id, enrollmentId]
        )
      }
      for (const p of (pays || [])) {
        // Con descuento de campaña la cuota queda con su monto efectivo pagado
        // (paid_amount); la diferencia entra al discount_amount del enrollment.
        await client.query(
          'UPDATE payment_installments SET cat_status = $1, amount = $2 WHERE installment_id = $3 AND enrollment_id = $4',
          [CAT_STATUS_PAID, p.paid_amount, p.installment_id, enrollmentId]
        )
        await client.query(`
          INSERT INTO payments (enrollment_id, installment_id, amount, payment_date, transaction_code,
            cat_method_payment, cat_payment_type, cat_settlement_status,
            settled_in_account_id, evidence_url, active, user_registration_id, registration_date)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Y', $11, NOW())
        `, [enrollmentId, p.installment_id, p.paid_amount, payment.paidAt, payment.transactionCode || '',
          payment.catPaymentMedium || null, CAT_PAYMENT_TYPE_INSTALLMENT, CAT_SETTLEMENT_STATUS_PAID,
          payment.bankAccountId || null, payment.voucherUrl || null, userId])
      }
      if ((pays || []).length && payment.catCurrency) {
        await client.query('UPDATE enrollments SET cat_currency = $1 WHERE enrollment_id = $2', [payment.catCurrency, enrollmentId])
      }
      const { rows } = await client.query(
        'SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM payment_installments WHERE enrollment_id = $1 AND cat_status <> $2',
        [enrollmentId, annulledStatusId]
      )
      await client.query(
        'UPDATE enrollments SET total_amount = $1, discount_amount = GREATEST(0, COALESCE(discount_amount, 0) + $2) WHERE enrollment_id = $3',
        [Number(rows[0].total) || 0, discountDelta, enrollmentId]
      )
    })
  }

  // Escritura generica de fees en Odoo (anular / ajustar monto) por seq.
  async updateOdooFees (orderId, changes) {
    return this.odoo.updateFees({ orderId, changes })
  }

  // Propaga las nuevas fechas de cuotas a las fees de la orden Odoo.
  async updateOdooFeeDueDates (orderId, normalizedChanges) {
    return this.odoo.updateFeeDueDates({
      orderId,
      changes: normalizedChanges.map(c => ({ seq: c.installment_number, new_due_date: c.new_due_date }))
    })
  }

  // Marca en Odoo la primera fee pendiente de la orden como pagada.
  async syncInstallmentPaymentToOdoo ({ enrollmentId }) {
    try {
      const { rows } = await this.db.query(`
        SELECT e.odoo_user_id, e.odoo_order_id,
               pv.abbreviation, prog.odoo_activation, prog.is_membership, pe.start_date
        FROM enrollments e
        LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
        LEFT JOIN programs prog ON prog.program_id = pv.program_id
        LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
        WHERE e.enrollment_id = $1
      `, [enrollmentId])

      const data = rows?.[0]
      if (isMembership(data?.abbreviation, data?.is_membership)) return { success: false, error: 'Membresias no sincronizan cuotas con Odoo' }
      if (!data?.odoo_order_id) return { success: false, error: 'Sin orden Odoo asociada' }

      const fees = await this.odoo.callKw('sale.order.fee', 'search_read', [
        [['order_id', '=', data.odoo_order_id], ['state', '=', 'pendiente']]
      ], { fields: ['id', 'seq', 'amount'], limit: 20, order: 'seq asc' })

      if (!fees || fees.length === 0) return { success: false, error: 'No hay cuotas pendientes en Odoo' }

      const fee = fees[0]
      await this.odoo.markFeeAsPaid(fee.id)

      return { success: true, fee_id: fee.id, message: `Cuota ${fee.seq} marcada como pagada en Odoo` }
    } catch (err) {
      console.error('[syncInstallmentPaymentToOdoo]', err.message)
      return { success: false, error: err.message }
    }
  }

  // Envia el correo de confirmacion de pago al alumno y registra el log de envio.
  async sendPaymentConfirmationEmail ({ enrollmentId }) {
    const { rows } = await this.db.query(`
      SELECT e.enrollment_id,
             per.first_name, per.last_name,
             ${STUDENT_EMAIL_SQL} AS origin_email,
             pv.abbreviation AS program_name,
             curr.variable_2 AS currency_symbol,
             c_cat.description AS category_description
      FROM enrollments e
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN leads l ON l.enrollment_id = e.enrollment_id
      LEFT JOIN program_versions pv ON pv.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = pv.program_id
      LEFT JOIN catalog curr ON e.cat_currency = curr.catalog_id
      LEFT JOIN catalog c_cat ON c_cat.catalog_id = prog.cat_category
      WHERE e.enrollment_id = $1
    `, [enrollmentId])

    const data = rows?.[0]
    if (!data) return { success: false, error: 'Inscripcion no encontrada' }

    const toEmail = data.origin_email
    if (!toEmail) return { success: false, error: 'El estudiante no tiene correo registrado' }

    const { rows: instRows } = await this.db.query(`
      SELECT pi.installment_number, pi.amount, pi.due_date, c.alias AS status_alias
      FROM payment_installments pi
      LEFT JOIN catalog c ON c.catalog_id = pi.cat_status
      WHERE pi.enrollment_id = $1 AND pi.installment_number > 0
      ORDER BY pi.installment_number
    `, [enrollmentId])

    const installments = instRows || []
    const paidCount = installments.filter(i => PAID_STATUS_ALIASES.has(i.status_alias)).length
    const isLastPayment = installments.length > 0 && paidCount >= installments.length
    const nextInstallment = installments.find(i => !PAID_STATUS_ALIASES.has(i.status_alias))
    const lastPaid = [...installments].reverse().find(i => PAID_STATUS_ALIASES.has(i.status_alias))

    const htmlBody = buildConfirmacionPagoHTML({
      studentName: [data.first_name, data.last_name, data.mother_last_name].filter(Boolean).join(' '),
      programType: resolveProgramTypeLabel(data.category_description),
      isLastPayment,
      lastPaymentDate: lastPaid?.due_date || new Date().toISOString(),
      nextPaymentDate: nextInstallment?.due_date || null,
      nextPaymentAmount: nextInstallment?.amount || 0,
      currencySymbol: data.currency_symbol || 'S/.'
    })

    const subject = isLastPayment
      ? `Pago Completado - ${data.program_name || 'WE Educacion'}`
      : `Confirmacion de Cuota - ${data.program_name || 'WE Educacion'}`

    const result = await email.sendFicoEmail({ to: toEmail, subject, htmlBody })

    try {
      await this.db.query(`
        INSERT INTO public.email_logs (enrollment_id, to_email, subject, message_id, template_type, status)
        VALUES ($1, $2, $3, $4, 'confirmacion_pago', $5)
      `, [enrollmentId, toEmail, subject, result.messageId || null, result.success ? 'sent' : 'failed'])
    } catch (logErr) {
      console.error('[EmailLog] Error registrando log:', logErr.message)
    }

    return result
  }

  // Cuotas pendientes con vencimiento en el mes para el modulo Cobranzas.
  // Trae TODAS las del mes (vencidas / hoy / por vencer): el usecase calcula
  // los KPIs de los tres grupos y recien despues filtra por estado. 'Hoy' se
  // resuelve en fecha de Lima para no correr el corte 5h con el UTC del server.
  async listCollections ({ year, month, day = null, q = null, advisorIds = [] }) {
    const params = [year, month]
    const extra = []
    if (day) {
      params.push(day)
      extra.push(`AND EXTRACT(DAY FROM pi.due_date)::int = $${params.length}`)
    }
    if (q) {
      params.push(`%${q}%`)
      const p = `$${params.length}`
      extra.push(`AND (
        TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) ILIKE ${p}
        OR per.document_number ILIKE ${p}
        OR ${STUDENT_EMAIL_SQL} ILIKE ${p}
      )`)
    }
    if (advisorIds.length) {
      params.push(advisorIds)
      extra.push(`AND e.seller_agent_id = ANY($${params.length}::int[])`)
    }

    const { rows } = await this.db.query(`
      SELECT
        pi.installment_id,
        pi.enrollment_id,
        pi.installment_number,
        pi.amount,
        to_char(pi.due_date, 'YYYY-MM-DD') AS due_date,
        (pi.due_date - (now() AT TIME ZONE 'America/Lima')::date)::int AS days_to_due,
        CASE
          WHEN pi.due_date < (now() AT TIME ZONE 'America/Lima')::date THEN 'overdue'
          WHEN pi.due_date = (now() AT TIME ZONE 'America/Lima')::date THEN 'today'
          ELSE 'upcoming'
        END AS state_label,
        TRIM(concat_ws(' ', per.first_name, per.last_name, per.mother_last_name)) AS student_full_name,
        per.document_number,
        ${STUDENT_EMAIL_SQL} AS email,
        prog.program_name,
        COALESCE(pe.global_code, '') AS edition_code,
        u.alias AS seller_agent_name
      FROM payment_installments pi
      JOIN catalog cs ON cs.catalog_id = pi.cat_status
      JOIN enrollments e ON e.enrollment_id = pi.enrollment_id
      JOIN catalog cf ON cf.catalog_id = e.cat_fico_status
      JOIN customers cust ON cust.customer_id = e.customer_id
      JOIN persons per ON per.person_id = cust.person_id
      LEFT JOIN LATERAL (
        SELECT lx.origin_email FROM leads lx
         WHERE lx.enrollment_id = e.enrollment_id LIMIT 1
      ) l ON TRUE
      LEFT JOIN users u ON u.user_id = e.seller_agent_id
      LEFT JOIN program_versions ver ON ver.program_version_id = e.program_version_id
      LEFT JOIN programs prog ON prog.program_id = ver.program_id
      LEFT JOIN program_editions pe ON pe.edition_num_id = e.program_edition_id
      LEFT JOIN catalog cst ON cst.catalog_id = e.cat_type_status
      WHERE e.active = 'Y'
        AND cf.alias = 'we_enrollment_status_checked'
        AND COALESCE(cst.alias, '') NOT IN
            ('we_enrollment_status_retired', 'we_enrollment_status_reprogrammed', 'we_enrollment_status_course_changed')
        AND pi.installment_number > 0
        AND cs.alias NOT IN ('we_inst_paid', 'we_payment_status_paid')
        AND pi.cat_status <> 4456 -- anuladas (retiro / campaña de cobranza) no son deuda
        AND EXTRACT(YEAR FROM pi.due_date)::int = $1
        AND EXTRACT(MONTH FROM pi.due_date)::int = $2
        ${extra.join('\n        ')}
      ORDER BY pi.due_date ASC, pi.enrollment_id
    `, params)
    return rows || []
  }

  // Inserta una fila en la bitacora de auditoria de la inscripcion. Best-effort:
  // un fallo de auditoria no revierte la operacion principal.
  async logAudit ({ enrollmentId, action, userId, justificacion = null, changes = null, details = null }) {
    try {
      await this.db.query(`
        INSERT INTO enrollment_audit_log (enrollment_id, action, performed_by, justificacion, changes, details)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      `, [enrollmentId, action, userId, justificacion, changes ? JSON.stringify(changes) : null, details])
    } catch (err) {
      console.error('[AuditLog] Error:', err.message)
    }
  }
}

export const installmentRepository = new InstallmentRepository()
