import boundaries from 'eslint-plugin-boundaries'
import globals from 'globals'

// Fase 4 — enforcement de las reglas de capa del Modular Monolith Hexagonal.
// Ver docs/architecture/ADR-001 y MODULE_TEMPLATE. Nivel pragmatico: se fuerzan
// las fronteras que el codigo ya respeta para blindarlas contra regresiones.
//   - Un modulo no importa internals de otro (se hablan via shared/ o BD).
//   - Una entity es logica pura: sin pool, odoo, axios, email ni slack.
//   - Una ruta no toca infra directamente; delega en controller/usecases.
// La infra heredada en utils/config/services se clasifica como zona legacy
// importable durante la migracion (mover a shared/ es trabajo del nivel purista).
export default [
  {
    ignores: [
      'node_modules/',
      'tests/',
      'coverage/',
      'eslint.config.mjs',
      'vitest.config.js',
    ],
  },
  {
    files: ['src/**/*.js'],
    plugins: { boundaries },
    languageOptions: {
      globals: { ...globals.node },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    settings: {
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'module', pattern: 'src/modules/*', mode: 'folder' },
        { type: 'shared', pattern: 'src/shared/**', mode: 'full' },
        {
          type: 'legacy',
          mode: 'full',
          pattern: [
            'src/utils/**',
            'src/config/**',
            'src/services/**',
            'src/routes/**',
            'src/models/**',
            'src/middlewares/**',
            'src/templates/**',
            'src/sql/**',
            'src/assets/**',
          ],
        },
      ],
    },
    rules: {
      // Aislamiento de dominio. Imports dentro del mismo modulo (incluidos los
      // subdominios de fico) siempre se permiten; cruzar a OTRO modulo no.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: { type: 'module' }, allow: { to: { type: ['shared', 'legacy'] } } },
            { from: { type: 'shared' }, allow: { to: { type: ['shared', 'legacy'] } } },
            { from: { type: 'legacy' }, allow: { to: { type: ['module', 'shared', 'legacy'] } } },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/**/*.entity.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/config/**',
                'pg',
                'axios',
                '**/odooClient*',
                '**/zeptomail*',
                '**/slack*',
                '**/job-queue*',
                '**/pool*',
              ],
              message:
                'Una entity es logica de dominio pura: no debe importar infraestructura (pool, odoo, axios, email, slack, colas).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/**/*.routes.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/config/db*', '**/odooClient*', 'pg', '**/pool*'],
              message:
                'Una ruta no toca la BD ni clientes externos directamente: delega en controller o usecases.',
            },
          ],
        },
      ],
    },
  },
  {
    // Integraciones externas (Odoo, Email) van por su puerto en shared/adapters,
    // nunca por el cliente legacy directo. Blinda el rerouting de los flujos FICO.
    files: ['src/modules/**/*.usecases.js', 'src/modules/**/*.repository.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/config/odooClient*', '**/config/zeptomail*'],
              message:
                'No importes el cliente Odoo/Email legacy: usa shared/adapters/odoo o shared/adapters/email (OdooPort/EmailPort).',
            },
          ],
        },
      ],
    },
  },
]
