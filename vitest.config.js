import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    // scripts/ no está en git: en otro clon ese glob simplemente no encuentra nada.
    include: ['tests/**/*.test.js', 'src/**/*.test.js', 'scripts/**/*.test.js'],
    // Los crons y la BD no deben arrancar en tests; el harness es en-memoria.
    pool: 'forks'
  }
})
