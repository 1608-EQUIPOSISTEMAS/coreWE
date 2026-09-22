import { describe, it, expect, beforeEach } from 'vitest'
import { startJob, getJob, _resetJobs } from '../ai-jobs.js'

const tick = () => new Promise(r => setTimeout(r, 0))

// Una tarea controlable desde el test: termina cuando se llama a `fin`.
function tareaManual () {
  let fin
  const promesa = new Promise(r => { fin = r })
  return { fn: ({ progreso }) => { progreso(1, 3); return promesa }, fin: (v) => fin(v) }
}

describe('ai-jobs', () => {
  beforeEach(() => _resetJobs())

  it('arranca en "generando" con progreso y termina en "listo" con la data', async () => {
    const t = tareaManual()
    const job = startJob({ tipo: 'obs', clave: 'a' }, t.fn)
    expect(job.estado).toBe('generando')
    await tick()
    expect(getJob(job.job_id).progreso).toEqual({ hechos: 1, total: 3 })
    t.fin({ ok: true, data: { items: [1] } })
    await tick()
    expect(getJob(job.job_id)).toMatchObject({ estado: 'listo', data: { items: [1] }, message: null })
  })

  it('el mismo pedido mientras corre no se encola dos veces', async () => {
    const t = tareaManual()
    let llamadas = 0
    const fn = (ctx) => { llamadas++; return t.fn(ctx) }
    const a = startJob({ tipo: 'obs', clave: 'x' }, fn)
    const b = startJob({ tipo: 'obs', clave: 'x', force: true }, fn)
    expect(b.job_id).toBe(a.job_id)
    await tick()
    expect(llamadas).toBe(1)
  })

  it('terminado: se reutiliza salvo force (Regenerar)', async () => {
    const a = startJob({ tipo: 'rec', clave: 'k' }, async () => ({ ok: true, data: 1 }))
    await tick(); await tick()
    expect(startJob({ tipo: 'rec', clave: 'k' }, async () => ({ ok: true, data: 2 })).job_id).toBe(a.job_id)
    const c = startJob({ tipo: 'rec', clave: 'k', force: true }, async () => ({ ok: true, data: 3 }))
    expect(c.job_id).not.toBe(a.job_id)
    await tick(); await tick()
    expect(getJob(c.job_id).data).toBe(3)
  })

  it('ok:false o excepción terminan en "error" con mensaje; un error se reintenta sin force', async () => {
    const a = startJob({ tipo: 'rec', clave: 'e' }, async () => ({ ok: false, message: 'IA local no disponible' }))
    const b = startJob({ tipo: 'rec', clave: 'f' }, async () => { throw new Error('boom') })
    await tick(); await tick()
    expect(getJob(a.job_id)).toMatchObject({ estado: 'error', message: 'IA local no disponible', data: null })
    expect(getJob(b.job_id)).toMatchObject({ estado: 'error', message: 'boom' })
    expect(startJob({ tipo: 'rec', clave: 'e' }, async () => ({ ok: true })).job_id).not.toBe(a.job_id)
  })

  it('id desconocido (p. ej. tras reiniciar el backend) = no_encontrado', () => {
    expect(getJob('nada')).toEqual({ job_id: 'nada', estado: 'no_encontrado' })
  })
})
