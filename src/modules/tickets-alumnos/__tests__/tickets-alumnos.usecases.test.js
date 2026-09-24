import { describe, it, expect, vi } from 'vitest'

// Las dependencias reales se inyectan como fakes; estos imports solo cargan
// modulos con I/O al evaluarse, asi que se neutralizan.
vi.mock('../../fico/enrollment/enrollment.usecases.js', () => ({ reprogramEdition: vi.fn(), courseChange: vi.fn() }))
vi.mock('../../../shared/adapters/storage/nexus-archivos.adapter.js', () => ({ urlDeLectura: vi.fn() }))
vi.mock('../tickets-alumnos.repository.js', () => ({ ticketsRepository: {} }))

const { firmarTramite, rechazarTramite, listarBandeja, urlDeAdjunto } = await import('../tickets-alumnos.usecases.js')

const FICO = ['FICO']
const ACADEMICA = ['ACADEMICA']

function montar (ticket, { ejecutorFalla = false } = {}) {
  const guardados = []
  const llamadas = []
  const repo = {
    async obtener () { return ticket },
    async listar () { return Array.isArray(ticket) ? ticket : [ticket] },
    async monedaDeVenta () { return 2001 },
    async guardarFirma (firma) { guardados.push(firma); return firma }
  }
  const ejecutor = {
    async reprogramEdition (args) {
      llamadas.push(['RP', args])
      if (ejecutorFalla) throw new Error('FICO no pudo')
      return { new_enrollment_id: 777 }
    },
    async courseChange (args) { llamadas.push(['CC', args]); return { new_enrollment_id: 888 } }
  }
  const archivos = { async urlDeLectura (clave) { return `https://firmada/${clave}` } }
  return { deps: { repo, ejecutor, archivos }, guardados, llamadas }
}

const pagado = (extra = {}) => ({
  solicitud_id: 1,
  ticket_number: 'SOL-2026-00001',
  tipo: 'REPROGRAMACION',
  status: 'PAGO_REGISTRADO',
  enrollment_id: 500,
  parent_enrollment_id: null,
  monto: 50,
  datos: { alcance: 'MODULO', destEditionId: 900 },
  ...extra
})

describe('firmarTramite', () => {
  it('al validar el pago reprograma la matricula y guarda la nueva', async () => {
    const { deps, guardados, llamadas } = montar(pagado())

    await firmarTramite({ solicitudId: 1, respuesta: 'ok', roles: FICO, userId: 9 }, deps)

    expect(llamadas).toEqual([['RP', expect.objectContaining({ enrollmentId: 500, newEditionId: 900, userId: 9 })]])
    expect(guardados[0]).toMatchObject({ status: 'RESUELTA', cierra: true, datosExtra: { nuevoEnrollmentId: 777 } })
  })

  it('si FICO falla el ticket no se marca resuelto', async () => {
    const { deps, guardados } = montar(pagado(), { ejecutorFalla: true })

    await expect(firmarTramite({ solicitudId: 1, roles: FICO, userId: 9 }, deps)).rejects.toThrow(/FICO no pudo/)
    expect(guardados).toEqual([])
  })

  it('el cambio de curso hereda las cuotas sin cobrar un monto nuevo', async () => {
    const cambio = pagado({ tipo: 'CAMBIO_CURSO', datos: { destEditionId: 77, destProgramVersionId: 12 } })
    const { deps, llamadas } = montar(cambio)

    await firmarTramite({ solicitudId: 1, roles: FICO, userId: 9 }, deps)

    expect(llamadas[0]).toEqual(['CC', expect.objectContaining({
      enrollmentId: 500, newProgramVersionId: 12, newEditionId: 77, totalAmount: 0, cat_currency: 2001
    })])
  })

  it('la aprobacion de Academica no mueve nada: deja el pago pendiente', async () => {
    const { deps, guardados, llamadas } = montar(pagado({ status: 'ABIERTA' }))

    await firmarTramite({ solicitudId: 1, roles: ACADEMICA, userId: 9 }, deps)

    expect(llamadas).toEqual([])
    expect(guardados[0]).toMatchObject({ status: 'PENDIENTE_PAGO', cierra: false })
  })

  it('no ejecuta el modulo suelto de un diplomado: lo deja a Academica', async () => {
    const { deps, guardados, llamadas } = montar(pagado({ parent_enrollment_id: 400 }))

    await firmarTramite({ solicitudId: 1, roles: FICO, userId: 9 }, deps)

    expect(llamadas).toEqual([])
    expect(guardados[0]).toMatchObject({ status: 'RESUELTA', datosExtra: null })
  })

  it('Academica no puede validar el voucher', async () => {
    const { deps } = montar(pagado())

    await expect(firmarTramite({ solicitudId: 1, roles: ACADEMICA }, deps)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('rechazarTramite', () => {
  it('rechazar el voucher no mueve la matricula', async () => {
    const { deps, guardados, llamadas } = montar(pagado())

    await rechazarTramite({ solicitudId: 1, respuesta: 'voucher ilegible', roles: FICO, userId: 9 }, deps)

    expect(llamadas).toEqual([])
    expect(guardados[0]).toMatchObject({ status: 'PAGO_RECHAZADO', cierra: true })
  })
})

describe('listarBandeja', () => {
  it('muestra a Academica lo suyo y lo que espera voucher, pero no lo de FICO', async () => {
    const tickets = [
      pagado({ solicitud_id: 1, status: 'ABIERTA' }),
      pagado({ solicitud_id: 2, status: 'PENDIENTE_PAGO' }),
      pagado({ solicitud_id: 3 })
    ]
    const { deps } = montar(tickets)

    const bandeja = await listarBandeja({ roles: ACADEMICA }, deps)

    expect(bandeja.map(t => [t.solicitud_id, t.puede_firmar])).toEqual([[1, true], [2, false]])
  })

  it('avisa cuando el tramite resuelto no se ejecuta solo', async () => {
    const { deps } = montar([pagado({ parent_enrollment_id: 400 })])

    const [t] = await listarBandeja({ roles: FICO }, deps)

    expect(t.requiere_accion_manual).toMatch(/a mano en FICO/)
  })
})

describe('urlDeAdjunto', () => {
  it('firma la URL del voucher', async () => {
    const { deps } = montar(pagado({ voucher_key: 'solicitudes/1/voucher-a.jpg' }))

    expect(await urlDeAdjunto({ solicitudId: 1, cual: 'voucher', roles: FICO }, deps))
      .toEqual({ url: 'https://firmada/solicitudes/1/voucher-a.jpg' })
  })

  it('responde 404 si el alumno no adjunto ese archivo', async () => {
    const { deps } = montar(pagado())

    await expect(urlDeAdjunto({ solicitudId: 1, cual: 'evidencia', roles: FICO }, deps)).rejects.toMatchObject({ statusCode: 404 })
  })
})
