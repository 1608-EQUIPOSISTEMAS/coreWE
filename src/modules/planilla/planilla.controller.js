import * as usecases from './planilla.usecases.js'
import { DomainError } from '../../shared/errors.js'

// Unico lugar que sabe de HTTP. Los roles salen del token, nunca del body:
// de ellos depende quien ve sueldos.
const ctx = req => ({ roles: req.user?.roles || [], userId: req.user?.id ?? null })
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// El archivo se procesa en memoria y se descarta: el Excel de sueldos no se guarda en disco.
async function leerSubida (req) {
  if (!req.isMultipart()) throw new DomainError('Se esperaba un archivo (multipart/form-data).')
  for await (const part of req.parts()) {
    if (part.type === 'file') return { buffer: await part.toBuffer(), archivo: part.filename || 'archivo' }
  }
  throw new DomainError('No se recibio ningun archivo.')
}

const confirmar = req => req.query?.confirmar === '1' || req.query?.confirmar === 'true'

export async function personalHandler (req, reply) {
  return reply.send({ ok: true, data: await usecases.listarPersonal(ctx(req)) })
}

export async function importarPersonalHandler (req, reply) {
  const data = await usecases.importarPersonal({
    ...(await leerSubida(req)),
    confirmar: confirmar(req),
    anio: Number(req.query?.anio),
    mes: Number(req.query?.mes),
    ...ctx(req)
  })
  return reply.send({ ok: true, data })
}

export async function actualizarPersonalHandler (req, reply) {
  const data = await usecases.actualizarPersonal({ personalId: Number(req.params.id), cambios: req.body, ...ctx(req) })
  return reply.send({ ok: true, data })
}

export async function plantillaHandler (req, reply) {
  const buffer = await usecases.plantilla()
  return reply.header('Content-Type', XLSX).header('Content-Disposition', 'attachment; filename="plantilla-personal.xlsx"').send(Buffer.from(buffer))
}

export async function importarHuelleroHandler (req, reply) {
  const data = await usecases.importarHuellero({ ...(await leerSubida(req)), confirmar: confirmar(req), ...ctx(req) })
  return reply.send({ ok: true, data })
}

export async function importacionesHandler (req, reply) {
  return reply.send({ ok: true, data: await usecases.importaciones() })
}

export async function asistenciaHandler (req, reply) {
  return reply.send({ ok: true, data: await usecases.asistencia(req.body) })
}

export async function justificarHandler (req, reply) {
  const { asistencia_id: asistenciaId, justificado, motivo } = req.body
  return reply.send({ ok: true, data: await usecases.justificar({ asistenciaId, justificado, motivo, ...ctx(req) }) })
}

export async function planillaHandler (req, reply) {
  return reply.send({ ok: true, data: await usecases.planilla({ ...req.body, ...ctx(req) }) })
}

export async function exportarHandler (req, reply) {
  const { buffer, nombre } = await usecases.exportar({ ...req.body, ...ctx(req) })
  return reply.header('Content-Type', XLSX).header('Content-Disposition', `attachment; filename="${nombre}"`).send(Buffer.from(buffer))
}

export async function cerrarHandler (req, reply) {
  return reply.send({ ok: true, data: await usecases.cerrarPeriodo({ ...req.body, ...ctx(req) }) })
}

export async function reabrirHandler (req, reply) {
  return reply.send({ ok: true, data: await usecases.reabrirPeriodo({ ...req.body, ...ctx(req) }) })
}
