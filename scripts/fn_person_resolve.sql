-- ============================================================================
-- REGLA UNICA DE IDENTIDAD DEL ALUMNO
--
-- Problema que mata: el DNI es opcional (la web no siempre lo da) y el SP
-- resolvia la persona SOLO por documento => cada venta sin DNI creaba una
-- persona gemela. Todo lo que se resuelve "por persona" (membresia, aula,
-- Odoo, historial) se rompia en silencio. Caso 03/08/26: socio WE BLACK
-- saliendo BECA en el aula.
--
-- Cascada (rigida, un solo lugar, la usan TODOS los flujos):
--   1. documento NORMALIZADO (ceros a la izquierda del DNI son ruido de tipeo)
--   2. sin match: (correo + 1er apellido + 1er nombre), y solo si el candidato
--      es UNICO y no tiene ya OTRO documento distinto
--   3. sin match: persona nueva
--
-- Y lo que cierra el ciclo: si el paso 2 encuentra a la persona y AHORA si
-- viene el documento, se le ADOPTA el documento en vez de crear la gemela.
-- La identidad se completa con el tiempo en lugar de bifurcarse.
--
-- Seguridad medida sobre produccion (scripts/diag-identidad-persona.mjs):
--   61 correos compartidos por >1 persona; con la clave estricta la regla
--   habria evitado 39 gemelos. Los grupos que quedan fuera son la misma
--   persona con el DNI tipeado distinto (los arregla el paso 1) o familiares
--   reales con apellido/nombre distinto (la regla NO los toca).
-- ============================================================================

-- Normaliza texto para comparar: sin tildes, sin dobles espacios, mayusculas.
CREATE OR REPLACE FUNCTION public.fn_txt_key (p_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT UPPER(TRIM(REGEXP_REPLACE(
           TRANSLATE(COALESCE(p_text, ''), 'áéíóúüÁÉÍÓÚÜñÑ', 'aeiouuAEIOUUnN'),
           '\s+', ' ', 'g')));
$$;

-- Normaliza documento: los DNI llegan como '03893811' y '3893811' (misma
-- persona). Si es puro digito y cabe en 8, se completa a 8 con ceros. RUC (11)
-- y pasaportes alfanumericos quedan como estan, solo trim/upper.
CREATE OR REPLACE FUNCTION public.fn_doc_key (p_doc text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN NULLIF(TRIM(COALESCE(p_doc, '')), '') IS NULL THEN NULL
    WHEN TRIM(p_doc) ~ '^[0-9]+$' AND LENGTH(LTRIM(TRIM(p_doc), '0')) <= 8
      THEN LPAD(NULLIF(LTRIM(TRIM(p_doc), '0'), ''), 8, '0')
    ELSE UPPER(TRIM(p_doc))
  END;
$$;

-- El formulario de FICO tiene UN solo campo "Apellidos" y al autocompletar por
-- DNI lo llena con paterno + materno (EnrollmentForm.vue). Guardar ese texto
-- entero en last_name deja el materno repetido, porque mother_last_name sigue
-- ahi y TODA vista renderiza concat_ws(first_name, last_name, mother_last_name)
-- => "MIGUEL ANDRE RUFASTO SAMANIEGO SAMANIEGO" (146 personas al 20/08/26).
-- Aqui se le quita la cola: last_name se queda solo con el paterno.
-- La guarda de particula evita destrozar un paterno compuesto cuyo ultimo
-- termino coincide con el materno ("DE LA CRUZ" + materno "CRUZ" => "DE LA").
CREATE OR REPLACE FUNCTION public.fn_last_name_sin_materno (p_last_name text, p_mother_last_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH t AS (
    SELECT TRIM(COALESCE(p_last_name, '')) AS apellidos,
           TRIM(COALESCE(p_mother_last_name, '')) AS materno
  ), corte AS (
    SELECT apellidos, materno,
           TRIM(LEFT(apellidos, length(apellidos) - length(materno))) AS paterno
      FROM t
     WHERE materno <> ''
       AND RIGHT(public.fn_txt_key(apellidos), length(materno) + 1) = ' ' || public.fn_txt_key(materno)
  )
  SELECT COALESCE(
    (SELECT paterno FROM corte
      WHERE paterno <> ''
        AND public.fn_txt_key(paterno) !~ '(^| )(DE|DEL|LA|LAS|LOS|Y|DA|DI|SAN|SANTA|VAN|VON)$'),
    p_last_name);
$$;

CREATE OR REPLACE FUNCTION public.fn_person_resolve (
  p_document          text,
  p_cat_type_document int,
  p_first_name        text,
  p_last_name         text,
  p_email             text,
  p_user_id           int
) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  v_person_id  int;
  v_doc_key    text := public.fn_doc_key(p_document);
  v_email      text := lower(TRIM(COALESCE(p_email, '')));
  v_ape1       text := split_part(public.fn_txt_key(p_last_name), ' ', 1);
  v_nom1       text := split_part(public.fn_txt_key(p_first_name), ' ', 1);
  v_cat_email  int;
  v_candidatos int;
BEGIN
  -- 1. Por documento normalizado.
  IF v_doc_key IS NOT NULL THEN
    SELECT person_id INTO v_person_id
      FROM public.persons
     WHERE active = 'Y' AND public.fn_doc_key(document_number) = v_doc_key
     ORDER BY person_id LIMIT 1;
  END IF;

  -- 2. Sin documento (o documento nuevo): por correo + apellido + nombre.
  --    Exige candidato UNICO y que no tenga ya otro documento distinto: si
  --    hay ambiguedad se prefiere crear persona nueva antes que fusionar mal.
  IF v_person_id IS NULL AND v_email <> '' AND v_ape1 <> '' THEN
    SELECT catalog_id INTO v_cat_email
      FROM public."catalog" WHERE alias = 'we_way_contact_email' LIMIT 1;

    WITH cand AS (
      SELECT DISTINCT per.person_id, per.document_number
        FROM public.persons per
        JOIN public.person_contacts pc ON pc.person_id = per.person_id
                                      AND pc.cat_way_contact = v_cat_email
                                      AND pc.active = 'Y'
       WHERE per.active = 'Y'
         AND lower(TRIM(pc.value)) = v_email
         AND split_part(public.fn_txt_key(per.last_name), ' ', 1) = v_ape1
         AND split_part(public.fn_txt_key(per.first_name), ' ', 1) = v_nom1
         AND (per.document_number IS NULL
              OR v_doc_key IS NULL
              OR public.fn_doc_key(per.document_number) = v_doc_key)
    )
    SELECT COUNT(*), MIN(person_id) INTO v_candidatos, v_person_id FROM cand;

    IF v_candidatos <> 1 THEN
      v_person_id := NULL;   -- 0 = no existe; >1 = ambiguo, no adivinar
    END IF;
  END IF;

  -- 3. Nueva, o completar la existente (aqui se ADOPTA el documento que antes
  --    creaba la gemela).
  IF v_person_id IS NULL THEN
    INSERT INTO public.persons (first_name, last_name, document_number,
                                cat_type_document, active, registration_date,
                                user_registration_id)
    VALUES (p_first_name, p_last_name, p_document, p_cat_type_document,
            'Y', NOW(), p_user_id)
    RETURNING person_id INTO v_person_id;
  ELSE
    UPDATE public.persons
       SET first_name           = COALESCE(p_first_name, first_name),
           last_name            = COALESCE(public.fn_last_name_sin_materno(p_last_name, mother_last_name), last_name),
           document_number      = COALESCE(document_number, p_document),
           cat_type_document    = COALESCE(cat_type_document, p_cat_type_document),
           modification_date    = NOW(),
           user_modification_id = p_user_id
     WHERE person_id = v_person_id;
  END IF;

  RETURN v_person_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Cableado en sp_fico_enrollment_register_direct: el bloque "1. Persona y
-- customer" (lookup por documento + INSERT/UPDATE de persons, ~28 lineas)
-- se reemplaza por:
--
--     v_person_id := public.fn_person_resolve(
--       v_document, v_cat_type_document, v_first_name, v_last_name,
--       v_email, p_user_id);
--
-- El resto del SP (customers, contactos, enrollment) no cambia.
-- ---------------------------------------------------------------------------
