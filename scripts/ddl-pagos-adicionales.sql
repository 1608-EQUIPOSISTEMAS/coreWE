-- Modulo Pagos Adicionales (FICO): reemplaza el Google Sheet de pagos
-- adicionales (1kprgBkQyrDBjzJ85LwH_7X5WY1YX4TmJbgzfTlLcHBw, pestaña
-- "1. Pago Adicional"). Una fila por pago, con las columnas del sheet.
--
-- Tabla nueva con DDL versionado aca: el modulo usa SQL plano y no stored
-- procedures (mismo criterio que tickets y reprogram_cases).
--
-- Decisiones:
--   1. additional_payment_id es el "N°" visible del sheet.
--   2. Medio de pago, entidad empresa y cuenta usan los MISMOS catalogos que el
--      formulario de inscripcion (we_payment_medium, we_business_entity,
--      bank_accounts): asi Ingresos Operativos puede sumarlos sin traducir.
--      La "entidad financiera" del sheet es el banco de la cuenta.
--   3. Programa y asunto son texto: el sheet los elige de "5. Lista" pero ya
--      trae valores fuera de ella; la lista es una sugerencia del formulario.
--   4. "Tipo programa" siempre es ADICIONALES: no se guarda.
--   5. sheet_row: fila de origen en el sheet, solo para la migracion; el
--      indice unico la vuelve idempotente.
--
-- Idempotente: se puede correr varias veces.

CREATE TABLE IF NOT EXISTS public.fico_additional_payments (
  additional_payment_id  serial PRIMARY KEY,
  business_line          varchar(20)   NOT NULL,
  program                varchar(150)  NOT NULL,
  subject                varchar(150)  NOT NULL,
  payment_date           date          NOT NULL,
  full_name              varchar(200)  NOT NULL,
  phone                  varchar(30),
  email                  varchar(200),
  status                 varchar(20)   NOT NULL DEFAULT 'EFECTUADO',
  -- Columna "REALIZADO?" del sheet (casilla).
  done                   boolean       NOT NULL DEFAULT false,
  amount                 numeric(12,2) NOT NULL,
  currency               char(3)       NOT NULL DEFAULT 'PEN',
  cat_payment_medium     integer REFERENCES public.catalog(catalog_id),
  cat_business_entity    integer REFERENCES public.catalog(catalog_id),
  bank_account_id        integer REFERENCES public.bank_accounts(account_id),
  transaction_code       varchar(60),
  product_line           varchar(40),
  payment_type           varchar(20),
  sheet_row              integer,
  active                 char(1)       NOT NULL DEFAULT 'Y',
  registration_date      timestamp with time zone NOT NULL DEFAULT now(),
  user_registration_id   integer REFERENCES public.users(user_id),
  modification_date      timestamp with time zone,
  user_modification_id   integer REFERENCES public.users(user_id),
  CONSTRAINT fico_additional_payments_line_chk     CHECK (business_line IN ('EN VIVO', 'ONLINE', 'FUNDACIÓN WE')),
  CONSTRAINT fico_additional_payments_status_chk   CHECK (status IN ('EFECTUADO', 'PENDIENTE')),
  CONSTRAINT fico_additional_payments_currency_chk CHECK (currency IN ('PEN', 'USD')),
  CONSTRAINT fico_additional_payments_amount_chk   CHECK (amount >= 0),
  CONSTRAINT fico_additional_payments_active_chk   CHECK (active IN ('Y', 'N'))
);

CREATE INDEX IF NOT EXISTS fico_additional_payments_date_idx
  ON public.fico_additional_payments (payment_date)
  WHERE active = 'Y';

CREATE UNIQUE INDEX IF NOT EXISTS fico_additional_payments_sheet_row_uq
  ON public.fico_additional_payments (sheet_row)
  WHERE sheet_row IS NOT NULL;
