// Mapeo de la salida de reprogramacion hacia el shape que consume el cliente.
// El legacy respondia { ok: true, data: { ok: true, job, activationDate } }; el
// controller nuevo envuelve en { ok: true, data } y este DTO produce el objeto
// data preservando esas claves para no romper al frontend durante la migracion.
export const toRescheduleDto = ({ job, activationDate }) => ({
  ok: true,
  job,
  activationDate
})
