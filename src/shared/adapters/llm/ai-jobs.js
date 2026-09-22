// Trabajos de IA en segundo plano, en memoria del proceso.
//
// Para lo que el usuario PIDE en pantalla y cuyo resultado no se guarda en una
// tabla propia (borradores de observaciones, recomendaciones del reporte): la
// pantalla arranca el trabajo, recibe un id y consulta el avance hasta que este
// listo. Asi ninguna request HTTP queda colgada minutos esperando al modelo, y
// un modelo mas lento (14B) no revienta ningun timeout.
//
// En memoria a proposito: el resultado es un borrador que el usuario aplica y
// guarda por el flujo normal. Si el backend se reinicia a mitad, el trabajo se
// pierde y la pantalla lo dice ('no_encontrado') para que se reintente.

import { randomUUID } from 'node:crypto'
import { queueLength } from './ollama.adapter.js'

// Cuanto se conserva un trabajo terminado: lo suficiente para que el usuario
// vuelva a la pantalla y lo recoja, poco para no acumular memoria.
const TTL_MS = 30 * 60 * 1000
const MAX_JOBS = 200

const jobs = new Map() // id -> job
const porClave = new Map() // clave -> id (dedupe: el mismo pedido no se encola dos veces)

function limpiar (ahora = Date.now()) {
  for (const [id, j] of jobs) {
    if (j.terminado_en && ahora - j.terminado_en > TTL_MS) {
      jobs.delete(id)
      if (porClave.get(j.clave) === id) porClave.delete(j.clave)
    }
  }
  // Tope duro: si igual se llena, se van los terminados mas viejos.
  if (jobs.size > MAX_JOBS) {
    const terminados = [...jobs.values()].filter(j => j.terminado_en).sort((a, b) => a.terminado_en - b.terminado_en)
    for (const j of terminados.slice(0, jobs.size - MAX_JOBS)) {
      jobs.delete(j.id)
      if (porClave.get(j.clave) === j.id) porClave.delete(j.clave)
    }
  }
}

// Vista publica del trabajo (sin la clave interna ni timestamps crudos).
function vista (j) {
  return {
    job_id: j.id,
    tipo: j.tipo,
    estado: j.estado, // 'generando' | 'listo' | 'error'
    progreso: j.progreso,
    en_fila: j.estado === 'generando' ? queueLength() : 0,
    data: j.estado === 'listo' ? j.data : null,
    message: j.estado === 'error' ? j.message : null
  }
}

// Arranca `fn({ progreso })` en segundo plano, o devuelve el que ya existe con
// la misma clave (corriendo, o terminado bien hace menos de TTL). force=true
// descarta el terminado y arranca otro (boton "Regenerar").
//
// fn devuelve { ok, data, message } (el contrato de los usecases de edition).
export function startJob ({ tipo, clave, force = false }, fn) {
  limpiar()
  const previoId = porClave.get(clave)
  const previo = previoId && jobs.get(previoId)
  if (previo && (previo.estado === 'generando' || (!force && previo.estado === 'listo'))) return vista(previo)

  const job = {
    id: randomUUID(),
    tipo,
    clave,
    estado: 'generando',
    progreso: null,
    data: null,
    message: null,
    creado_en: Date.now(),
    terminado_en: null
  }
  jobs.set(job.id, job)
  porClave.set(clave, job.id)

  const progreso = (hechos, total) => { job.progreso = { hechos, total } }
  Promise.resolve()
    .then(() => fn({ progreso }))
    .then((res) => {
      if (res?.ok) {
        job.estado = 'listo'
        job.data = res.data ?? null
      } else {
        job.estado = 'error'
        job.message = res?.message || 'La IA no pudo completar el pedido'
      }
    })
    .catch((err) => {
      job.estado = 'error'
      job.message = err?.message || 'La IA no pudo completar el pedido'
      console.warn(`[ai-jobs] ${tipo} fallo: ${job.message}`)
    })
    .finally(() => { job.terminado_en = Date.now() })

  return vista(job)
}

export function getJob (id) {
  limpiar()
  const j = jobs.get(id)
  return j ? vista(j) : { job_id: id, estado: 'no_encontrado' }
}

// Solo para tests.
export function _resetJobs () {
  jobs.clear()
  porClave.clear()
}
