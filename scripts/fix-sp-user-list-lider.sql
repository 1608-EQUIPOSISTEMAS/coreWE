-- sp_user_list es el universo de asesores comerciales: alimenta el dropdown
-- "Editar Asesor" de FICO, el selector de asesor al registrar la venta y los
-- filtros de los reportes comerciales. Filtraba rol.alias = 'COMERCIAL' a secas,
-- asi que un lider que NO carga ademas el rol raso desaparecia del sistema: AE30
-- (user 2) tiene 3169 ventas y no era elegible como asesor hasta que se le
-- agrego COMERCIAL a mano. Un LIDER_COMERCIAL vende, asi que entra al universo.
--
-- DISTINCT ON (user_id) porque quien tiene los dos roles produce dos filas en el
-- JOIN; gana el rol de menor id (COMERCIAL) para que la columna rol_* no cambie
-- para nadie. Esas dos columnas no las consume ningun consumidor: el frontend
-- solo lee user_id / alias / full_name / active.

CREATE OR REPLACE PROCEDURE public.sp_user_list(INOUT p_cursor refcursor DEFAULT 'rs_users'::refcursor)
    LANGUAGE plpgsql
    AS $$
BEGIN
    OPEN p_cursor FOR
    SELECT DISTINCT ON (u.user_id)
        u.user_id::int,
        u.person_id::int,
        u.alias::varchar,
        u.email::varchar,
        rol.rol_id::int as rol_id,
        rol.description::varchar as rol_description,
        p.first_name::varchar,
        p.last_name::varchar,
        CONCAT(p.first_name, ' ', p.last_name)::varchar AS full_name,
        u.active::boolean
    FROM public.users u
    INNER JOIN public.persons p ON u.person_id = p.person_id
    INNER JOIN public.user_roles usr ON usr.user_id = u.user_id
    INNER JOIN public.rol rol ON rol.rol_id = usr.rol_id
    WHERE rol.alias IN ('COMERCIAL', 'LIDER_COMERCIAL')
    ORDER BY u.user_id DESC, rol.rol_id;
END;
$$;

-- La misma regla en la version FUNCTION. Ojo: convive con el PROCEDURE, cuyo
-- unico argumento tiene DEFAULT, asi que `SELECT ... FROM sp_user_list()` le
-- resulta ambiguo a Postgres y nadie puede invocarla; se mantiene al dia igual
-- para no dejar dos definiciones distintas del universo de asesores.
CREATE OR REPLACE FUNCTION public.sp_user_list()
    RETURNS TABLE(user_id integer, person_id integer, alias character varying, email character varying, rol_id integer, rol_description character varying, first_name character varying, last_name character varying, full_name character varying, active boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT ON (u.user_id)
        u.user_id::int,
        u.person_id::int,
        u.alias::varchar,
        u.email::varchar,
        null::int,
        null::varchar,
        p.first_name::varchar,
        p.last_name::varchar,
        CONCAT(p.first_name, ' ', p.last_name)::varchar,
        u.active::boolean
    FROM public.users u
    INNER JOIN public.persons p ON u.person_id = p.person_id
    INNER JOIN public.user_roles usr ON usr.user_id = u.user_id
    INNER JOIN public.rol rol ON rol.rol_id = usr.rol_id
    WHERE rol.alias IN ('COMERCIAL', 'LIDER_COMERCIAL')
    ORDER BY u.user_id DESC;
END;
$$;
