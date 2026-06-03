// Entorno de tests: valores seguros para construir la app sin tocar produccion.
// Se ejecuta antes de importar los archivos de test (setupFiles de Vitest).
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test')
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret-0123456789'

// Apaga los crons por si algun test importa modulos que los registran.
process.env.FICO_JOB_WORKER_DISABLED = 'true'
process.env.FICO_MV_REFRESH_DISABLED = 'true'
