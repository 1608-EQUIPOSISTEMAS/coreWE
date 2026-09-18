import * as usecases from './tickets-alumnos.usecases.js'

// Unico lugar que sabe de HTTP. Traduce body -> caso de uso y resultado -> reply.
const num = v => (v === null || v === undefined || v === '' ? null : Number(v))

// El area NO viaja en el body: se deriva de los roles del token. Si el front la
// mandara, cualquiera podria firmar por el area que quisiera.
const areasDe = req => req.user?.roles || []

export async function listHandler (req, reply) {
  const data = await usecases.listarBandeja({
    roles: areasDe(req),
    incluirCerrados: req.body?.incluir_cerrados === true,
    tipo: req.body?.tipo || null,
    q: req.body?.q || null
  })
  return reply.code(200).send({ ok: true, data })
}

export async function firmarHandler (req, reply) {
  const data = await usecases.firmarTramite({
    solicitudId: num(req.body.solicitud_id),
    respuesta: req.body.respuesta,
    roles: areasDe(req),
    userId: req.user?.id
  })
  return reply.code(200).send({ ok: true, message: 'Tramite validado', data })
}

export async function rechazarHandler (req, reply) {
  const data = await usecases.rechazarTramite({
    solicitudId: num(req.body.solicitud_id),
    respuesta: req.body.respuesta,
    roles: areasDe(req),
    userId: req.user?.id
  })
  return reply.code(200).send({ ok: true, message: 'Tramite rechazado', data })
}
