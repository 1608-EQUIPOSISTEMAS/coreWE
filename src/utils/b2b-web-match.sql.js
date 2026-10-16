// Match WEB de un asesor de convenios: FICO -> Editar Asesor, canal WEB con
// NY12, deja la venta como 'WEB - NY12'. El canal es WEB, pero el convenio es
// suyo y cuenta como B2B en la hoja "7. Convenios" y en el cronograma (22754).
// Se reconoce por ROL, igual que stampB2bOriginFromAdvisor del token, para que
// un asesor de convenios nuevo quede cubierto sin tocar codigo.
//
// Recibe EXPRESIONES SQL: el canal y el user_id del vendedor de la venta.
export const isWebMatchByB2bAdvisorSql = ({ origin, sellerId }) => `
           ((${origin}) = 'WEB'
            AND EXISTS (SELECT 1
                          FROM public.user_roles ur
                          JOIN public.rol r ON r.rol_id = ur.rol_id
                         WHERE ur.user_id = (${sellerId})
                           AND r.alias IN ('B2B', 'LIDER_B2B')))`
