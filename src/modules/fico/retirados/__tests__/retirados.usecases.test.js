import { describe, it, expect, vi, beforeEach } from 'vitest'

// El envio de la encuesta va en lote: si un correo rebota, los demas salen igual
// y la fila rebotada NO queda como "enviada" (si no, FICO nunca la reintentaria).

const repo = { listRetirados: vi.fn(), ensureEncuesta: vi.fn(), marcarEnviada: vi.fn() }
const email = { sendEmail: vi.fn() }

vi.mock('../retirados.repository.js', () => ({ retiradosRepository: repo }))
vi.mock('../../../../shared/adapters/email/email.adapter.js', () => ({ email }))

const { enviarEncuestas } = await import('../retirados.usecases.js')

const fila = (id, over = {}) => ({
  enrollment_id: id, full_name: `ALUMNO ${id}`, first_name: 'Ana', program_name: 'PEE SAP',
  email: `a${id}@gmail.com`, enviada_at: null, respondida_at: null, envios: 0, ...over
})

beforeEach(() => {
  vi.clearAllMocks()
  repo.ensureEncuesta.mockResolvedValue('3f1c0000-0000-4000-8000-000000000000')
  email.sendEmail.mockResolvedValue({ success: true })
})

describe('enviarEncuestas', () => {
  it('manda el link personal de Nexus y marca la fila como enviada', async () => {
    repo.listRetirados.mockResolvedValue([fila(1)])

    const r = await enviarEncuestas({ enrollmentIds: [1], userId: 7 })

    expect(r).toEqual({ enviados: 1, omitidos: [], fallidos: [] })
    expect(email.sendEmail.mock.calls[0][0].htmlBody).toContain('/encuesta-retiro/3f1c0000-0000-4000-8000-000000000000')
    expect(repo.marcarEnviada).toHaveBeenCalledWith({ enrollmentId: 1, userId: 7 })
  })

  it('un correo que falla no frena el lote ni queda marcado como enviado', async () => {
    repo.listRetirados.mockResolvedValue([fila(1), fila(2)])
    email.sendEmail
      .mockResolvedValueOnce({ success: false, error: 'buzon inexistente' })
      .mockResolvedValueOnce({ success: true })

    const r = await enviarEncuestas({ enrollmentIds: [1, 2], userId: 7 })

    expect(r.enviados).toBe(1)
    expect(r.fallidos).toEqual([{ enrollment_id: 1, full_name: 'ALUMNO 1', motivo: 'buzon inexistente' }])
    expect(repo.marcarEnviada).toHaveBeenCalledTimes(1)
    expect(repo.marcarEnviada).toHaveBeenCalledWith({ enrollmentId: 2, userId: 7 })
  })

  it('al retirado sin correo lo omite sin intentar enviar', async () => {
    repo.listRetirados.mockResolvedValue([fila(1, { email: null })])

    const r = await enviarEncuestas({ enrollmentIds: [1], userId: 7 })

    expect(r.omitidos).toHaveLength(1)
    expect(email.sendEmail).not.toHaveBeenCalled()
  })
})
