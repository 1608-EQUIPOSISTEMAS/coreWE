// Arranque del año de beneficio de una membresia: su vencimiento es esta fecha
// + 1 año. Lo comparten la hoja "5. Membresias" y la vista de Vencimientos de
// FICO, que tienen que dar la misma fecha. membership_activation_date solo se
// llena cuando la activacion se difiere; si no, manda la F. PAGO efectiva.
// Requiere los alias `e` (enrollments) y `l` (leads).
export const MEMBERSHIP_START_SQL = `
  COALESCE(
    e.membership_activation_date,
    l.pay_date,
    (SELECT py.payment_date::date FROM public.payments py
      WHERE py.enrollment_id = e.enrollment_id AND py.active = 'Y'
      ORDER BY py.payment_date ASC LIMIT 1),
    e.registration_date::date
  )`

// Arranque para Academica (pedido del area, 23/10/26): el año corre desde la
// fecha de registro de la inscripcion, sin mirar el pago ni la activacion
// diferida. Puede no coincidir con el vencimiento que ve FICO, a proposito.
export const MEMBERSHIP_REGISTRATION_START_SQL = 'e.registration_date::date'
