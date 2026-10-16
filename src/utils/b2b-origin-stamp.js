// sp_comercial_enrollment_register saca agent_origin SOLO de la situacion del
// lead. Un asesor de convenios que vende con el lead marcado "profesional" deja
// la venta sin ninguna marca B2B: no entra a la hoja "7. Convenios", el
// cronograma la cuenta como VENTAS y el AS sale "NY12" en vez de "B2B - NY12".
// Paso por el token (18534) y por el registro directo del asesor (23080).
// Se reconoce por ROL, no por lista de alias, para cubrir asesores nuevos.
// Solo rellena el hueco: un origen ya escrito (WEB/FWE/SA) no se pisa.
export async function stampB2bOriginFromAdvisor (db, { enrollmentId, userId }) {
  if (!enrollmentId || !userId) return
  await db.query(
    `UPDATE public.enrollments
        SET agent_origin = 'B2B'
      WHERE enrollment_id = $1
        AND agent_origin IS NULL
        AND EXISTS (SELECT 1
                      FROM public.user_roles ur
                      JOIN public.rol r ON r.rol_id = ur.rol_id
                     WHERE ur.user_id = $2
                       AND r.alias IN ('B2B', 'LIDER_B2B'))`,
    [enrollmentId, userId]
  )
}
