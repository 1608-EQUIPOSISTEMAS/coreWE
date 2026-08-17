// Convierte b2b_contracts en el registro de plata que hoy vive en el Google
// Sheet "WE FOR BUSINESS", y absorbe el modulo Convenios adentro de Contratos.
//
// Decisiones (2026-08-17, acordadas con el usuario):
//   · Un convenio NO es una entidad aparte: es un contrato con tipo CONVENIO.
//     Por eso agreement_discounts pasa a colgar del contrato, y las tablas
//     fantasma corporate_agreements / agreements no se crean.
//   · Un contrato = una compra. Los cupos (number_of_licenses) se reparten en
//     b2b_contract_beneficiaries, y cada beneficiario lleva SU curso: por eso no
//     hacen falta "lineas de contrato" para vender 10 cupos en cursos distintos.
//   · Solo se crean columnas para lo que el area realmente llena en el Sheet
//     (medido con medir-sheet-b2b.mjs). El resto de la fila migrada se conserva
//     crudo en legacy_sheet jsonb, para no perder nada ni inventar columnas.
//
// Idempotente. Correr con el tunel arriba:
//   cd Backend && node scripts/b2b-contrato-plata.mjs
import { pool } from './db.mjs'

const COLUMNAS = {
  cat_client_type: 'integer',          // B2B NACIONAL / INTERNACIONAL / ESTADO
  cat_modality: 'integer',             // we_modality (ZOOM / ONLINE)
  cat_currency: 'integer',             // we_currency (PEN / USD)
  cat_payment_terms: 'integer',        // we_payment_way (contado / credito)
  program_version_id: 'integer',       // el programa vendido, cuando el trato es de uno solo
  paid_amount: 'numeric(12,2)',        // cobrado, en la moneda del contrato
  paid_amount_pen: 'numeric(12,2)',    // el mismo cobro llevado a soles (columna IMPORTE PAGADO)
  consultation_date: 'date',
  close_date: 'date',
  payment_date: 'date',
  confirmation_sent_date: 'date',
  invoice_date: 'date',
  country: 'varchar(60)',
  legacy_sheet: 'jsonb',
}

const CLIENTES_B2B = [
  ['B2B NACIONAL', 'we_b2b_client_type_national'],
  ['B2B INTERNACIONAL', 'we_b2b_client_type_international'],
  ['ESTADO', 'we_b2b_client_type_government'],
]

const cliente = await pool.connect()
const paso = async (etiqueta, sql, params) => {
  await cliente.query(sql, params)
  console.log(`✓ ${etiqueta}`)
}

try {
  await cliente.query('BEGIN')

  // ── 1. columnas de plata en el contrato ────────────────────
  for (const [columna, tipo] of Object.entries(COLUMNAS)) {
    await cliente.query(`ALTER TABLE public.b2b_contracts ADD COLUMN IF NOT EXISTS ${columna} ${tipo}`)
  }
  console.log(`✓ b2b_contracts +${Object.keys(COLUMNAS).length} columnas`)

  // ── 2. catalogo de tipo de cliente ─────────────────────────
  const { rows: [padre] } = await cliente.query(`
    INSERT INTO public.catalog (description, alias, active)
    SELECT 'TIPO DE CLIENTE B2B', 'we_b2b_client_type', 'Y'
     WHERE NOT EXISTS (SELECT 1 FROM public.catalog WHERE alias = 'we_b2b_client_type')
    RETURNING catalog_id`)
  const padreId = padre?.catalog_id ?? (await cliente.query(
    "SELECT catalog_id FROM public.catalog WHERE alias = 'we_b2b_client_type'")).rows[0].catalog_id
  for (const [descripcion, alias] of CLIENTES_B2B) {
    await cliente.query(`
      INSERT INTO public.catalog (catalog_parent_id, description, alias, active)
      SELECT $1::int, $2::varchar, $3::varchar, 'Y'
       WHERE NOT EXISTS (SELECT 1 FROM public.catalog WHERE alias = $3::varchar)`,
      [padreId, descripcion, alias])
  }
  console.log(`✓ catalogo we_b2b_client_type (padre ${padreId})`)

  // ── 3. los descuentos de convenio cuelgan del contrato ─────
  // agreement_discounts tiene 0 filas, asi que el rename es seguro.
  const { rows: [yaMigrada] } = await cliente.query(`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='agreement_discounts'
                      AND column_name='b2b_contract_id') AS ok`)
  if (!yaMigrada.ok) {
    await paso('agreement_discounts.agreement_id → b2b_contract_id',
      'ALTER TABLE public.agreement_discounts RENAME COLUMN agreement_id TO b2b_contract_id')
    await paso('agreement_discounts FK → b2b_contracts', `
      ALTER TABLE public.agreement_discounts
        ADD CONSTRAINT fk_agreement_discounts_contract
        FOREIGN KEY (b2b_contract_id) REFERENCES public.b2b_contracts(b2b_contract_id) ON DELETE CASCADE`)
  } else {
    console.log('— agreement_discounts ya apunta al contrato')
  }

  // ── 4. los cupos repartidos ────────────────────────────────
  await paso('b2b_contract_beneficiaries', `
    CREATE TABLE IF NOT EXISTS public.b2b_contract_beneficiaries (
      beneficiary_id     serial PRIMARY KEY,
      b2b_contract_id    integer NOT NULL REFERENCES public.b2b_contracts(b2b_contract_id) ON DELETE CASCADE,
      full_name          varchar(150) NOT NULL,
      document_number    varchar(20),
      email              varchar(120),
      phone              varchar(20),
      program_version_id integer,
      edition_id         integer,
      person_id          integer,
      -- Se llena cuando FICO convierte el cupo en inscripcion real. NULL = cupo
      -- entregado pero todavia no matriculado: eso es lo que hay que perseguir.
      enrollment_id      integer,
      notes              text,
      active             character(1) NOT NULL DEFAULT 'Y',
      user_registration_id integer,
      registration_date  timestamp NOT NULL DEFAULT now(),
      modification_date  timestamp
    );
    CREATE INDEX IF NOT EXISTS ix_b2b_beneficiaries_contract
      ON public.b2b_contract_beneficiaries (b2b_contract_id) WHERE active = 'Y';
    CREATE INDEX IF NOT EXISTS ix_b2b_beneficiaries_enrollment
      ON public.b2b_contract_beneficiaries (enrollment_id) WHERE enrollment_id IS NOT NULL;
  `)

  await cliente.query('COMMIT')
} catch (e) {
  await cliente.query('ROLLBACK')
  throw e
} finally {
  cliente.release()
  await pool.end()
}
