import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Un puerto declarado en un subdominio FICO pero nunca invocado en el composition
// root queda en null y explota en runtime, no en los tests unitarios. Le paso a
// setMembershipPort: enrollInOdoo tiraba 'enrollMembershipInOdoo no esta cableado'
// y mataba el job register_followup antes del correo de bienvenida de membresia.
const FICO_DIR = join(import.meta.dirname, '../../src/modules/fico')
// Los comentarios del bootstrap nombran los puertos: sin quitarlos, un
// `// setMembershipPort(...)` comentado seguiria pasando el test.
const bootstrap = readFileSync(join(FICO_DIR, 'fico.bootstrap.js'), 'utf8')
  .replace(/\/\/.*$/gm, '')

// El bootstrap puede renombrar al importar (`setPorts as setValidationPorts`):
// la invocacion usa el nombre local, asi que hay que resolver el alias.
function localNameOf (exportedName) {
  const alias = bootstrap.match(new RegExp(String.raw`\b${exportedName}\s+as\s+(\w+)`))
  return alias ? alias[1] : exportedName
}

function injectorsOf (file) {
  return [...readFileSync(file, 'utf8').matchAll(/export function ((?:set|configure)\w+)/g)]
    .map(m => m[1])
}

const injectors = readdirSync(FICO_DIR, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .flatMap(dir => readdirSync(join(FICO_DIR, dir.name))
    .filter(file => /\.(usecases|repository)\.js$/.test(file))
    .flatMap(file => injectorsOf(join(FICO_DIR, dir.name, file))
      .map(name => [`${dir.name}/${file}`, name])))

describe('fico.bootstrap cablea todos los puertos declarados', () => {
  it('encuentra los inyectores de los subdominios', () => {
    expect(injectors.length).toBeGreaterThan(3)
  })

  it.each(injectors)('%s: %s se invoca en el composition root', (_file, name) => {
    expect(bootstrap).toMatch(new RegExp(String.raw`\b${localNameOf(name)}\s*\(`))
  })
})
