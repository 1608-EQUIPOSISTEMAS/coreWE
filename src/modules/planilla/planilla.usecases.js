import { planillaRepository } from './planilla.repository.js'
import {
  agruparPorDia,
  assertPuedeVerSueldos,
  calcularTrabajador,
  horarioDeArea,
  minutosDeTardanza,
  parsearMarcaciones,
  parsearPersonal,
  puedeVerSueldos,
  validarPeriodo
} from './planilla.entity.js'
import { cifrarMonto, cifrarTexto, descifrarMonto, descifrarTexto } from './planilla.crypto.js'
import { exportarPlanilla, leerArchivo, plantillaPersonal } from './planilla.xlsx.js'
import { DomainError, NotFoundError } from '../../shared/errors.js'

const DEPENDENCIAS = { repo: planillaRepository }

const mesesDeRango = (desde, hasta) => {
  const out = []
  let [a, m] = desde.split('-').map(Number)
  const [ah, mh] = hasta.split('-').map(Number)
  while (a < ah || (a === ah && m <= mh)) {
    out.push({ anio: a, mes: m })
    if (++m > 12) { m = 1; a++ }
  }
  return out
}

async function assertPeriodoAbierto (repo, anio, mes) {
  const p = await repo.getPeriodo(anio, mes)
  if (p) {
    throw new DomainError(`El periodo ${String(mes).padStart(2, '0')}/${anio} esta cerrado. Reabrelo para modificarlo.`, { statusCode: 409, code: 'PERIODO_CERRADO' })
  }
}

// ── Personal ─────────────────────────────────────────────────────────────

export async function listarPersonal ({ roles }, { repo } = DEPENDENCIAS) {
  const verSueldos = puedeVerSueldos(roles)
  const filas = await repo.listarPersonal()
  return {
    puede_ver_sueldos: verSueldos,
    personal: filas.map(({ sueldo_cifrado: cifrado, ...p }) => ({
      ...p,
      tiene_sueldo: !!cifrado,
      sueldo_neto: verSueldos ? descifrarMonto(cifrado) : null
    }))
  }
}

// Se importa a inicio de mes: los sueldos valen desde (anio, mes) hasta que otra
// importacion los reemplace. Sin `confirmar` es una vista previa: no guarda nada.
export async function importarPersonal ({ buffer, archivo, confirmar, anio, mes, roles, userId }, { repo } = DEPENDENCIAS) {
  assertPuedeVerSueldos(roles)
  const periodo = validarPeriodo(anio, mes)
  const { personal, errores } = parsearPersonal(await leerArchivo(buffer, archivo))
  const conHorario = personal.map(p => {
    const h = horarioDeArea(p.area)
    return { ...p, hora_ingreso: h.ingreso, hora_salida: h.salida }
  })
  if (!confirmar) {
    return { confirmado: false, anio: periodo.anio, mes: periodo.mes, total: conHorario.length, errores, personal: conHorario }
  }
  await assertPeriodoAbierto(repo, periodo.anio, periodo.mes)
  if (!conHorario.length) throw new DomainError('El archivo no tiene filas validas.', { statusCode: 422 })
  const filas = conHorario.map(({ sueldo_neto: s, ...p }) => ({ ...p, sueldo_cifrado: cifrarMonto(s) }))
  await repo.guardarPersonal(filas, { userId, archivo, anio: periodo.anio, mes: periodo.mes })
  await repo.auditar(userId, 'IMPORTAR_PERSONAL', { archivo, filas: filas.length, anio: periodo.anio, mes: periodo.mes })
  return { confirmado: true, anio: periodo.anio, mes: periodo.mes, total: filas.length, errores }
}

export async function actualizarPersonal ({ personalId, cambios, userId }, { repo } = DEPENDENCIAS) {
  const r = await repo.actualizarPersonal(personalId, cambios, userId)
  if (!r) throw new NotFoundError('Trabajador no encontrado.')
  await repo.auditar(userId, 'EDITAR_PERSONAL', { personal_id: personalId, ...cambios })
  return r
}

export async function plantilla () {
  return plantillaPersonal()
}

// ── Huellero ─────────────────────────────────────────────────────────────

export async function importarHuellero ({ buffer, archivo, confirmar, userId }, { repo } = DEPENDENCIAS) {
  const { marcaciones, errores } = parsearMarcaciones(await leerArchivo(buffer, archivo))
  const dias = agruparPorDia(marcaciones)
  if (!dias.length) throw new DomainError('No se encontraron marcaciones en el archivo.', { statusCode: 422 })

  const fechas = dias.map(d => d.fecha).sort()
  const desde = fechas[0]
  const hasta = fechas[fechas.length - 1]
  const personal = await repo.listarPersonal()
  const conocidos = new Set(personal.map(p => p.codigo))
  const sinFicha = [...new Map(dias.filter(d => !conocidos.has(d.codigo)).map(d => [d.codigo, { codigo: d.codigo, nombre: d.nombre }])).values()]

  const resumen = {
    archivo,
    desde,
    hasta,
    marcaciones: marcaciones.length,
    dias: dias.length,
    trabajadores: new Set(dias.map(d => d.codigo)).size,
    sin_salida: dias.filter(d => !d.salida).length,
    sin_ficha: sinFicha,
    errores: errores.slice(0, 50),
    total_errores: errores.length
  }
  if (!confirmar) return { confirmado: false, ...resumen, muestra: dias.slice(0, 30) }

  for (const p of mesesDeRango(desde, hasta)) await assertPeriodoAbierto(repo, p.anio, p.mes)
  const importacionId = await repo.guardarAsistencia(dias, { userId, archivo, desde, hasta })
  await repo.auditar(userId, 'IMPORTAR_HUELLERO', { archivo, desde, hasta, dias: dias.length })
  return { confirmado: true, importacion_id: importacionId, ...resumen }
}

export async function importaciones ({ repo } = DEPENDENCIAS) {
  return repo.importaciones()
}

// ── Asistencia (sin montos: la puede ver soporte) ────────────────────────

async function cruzarPeriodo (repo, anio, mes) {
  const periodo = validarPeriodo(anio, mes)
  const [personal, asistencia, cierre] = await Promise.all([
    repo.listarPersonal(),
    repo.asistenciaDelPeriodo(periodo.desde, periodo.hasta),
    repo.getPeriodo(periodo.anio, periodo.mes)
  ])
  const porCodigo = new Map(personal.map(p => [p.codigo, p]))
  return { periodo, personal, asistencia, porCodigo, cierre }
}

export async function asistencia ({ anio, mes }, { repo } = DEPENDENCIAS) {
  const { periodo, asistencia: filas, porCodigo: actual, cierre } = await cruzarPeriodo(repo, anio, mes)
  // Mes cerrado: nombre, area y horario como estaban al cerrar (sin montos).
  const foto = cierre ? await leerFoto(repo, periodo.anio, periodo.mes) : null
  const porCodigo = foto ? new Map(foto.trabajadores.map(t => [t.codigo, t])) : actual
  return {
    ...periodo,
    cerrado: !!cierre,
    cierre,
    filas: filas.map(a => {
      const p = porCodigo.get(a.codigo)
      const horaIngreso = p?.hora_ingreso || horarioDeArea(null).ingreso
      return {
        ...a,
        nombre: p?.nombre || a.nombre_huellero || '(sin ficha)',
        area: p?.area || null,
        en_ficha: !!p,
        hora_ingreso: horaIngreso,
        minutos_tardanza: a.justificado ? 0 : minutosDeTardanza(a.entrada, horaIngreso)
      }
    })
  }
}

export async function justificar ({ asistenciaId, justificado, motivo, userId }, { repo } = DEPENDENCIAS) {
  const a = await repo.getAsistencia(asistenciaId)
  if (!a) throw new NotFoundError('Marcacion no encontrada.')
  const [anio, mes] = a.fecha.split('-').map(Number)
  await assertPeriodoAbierto(repo, anio, mes)
  if (justificado && !String(motivo || '').trim()) {
    throw new DomainError('Indica el motivo de la justificacion.', { statusCode: 400 })
  }
  const r = await repo.justificar(asistenciaId, justificado, String(motivo || '').trim() || null)
  await repo.auditar(userId, justificado ? 'JUSTIFICAR' : 'QUITAR_JUSTIFICACION', { asistencia_id: asistenciaId, codigo: a.codigo, fecha: a.fecha, motivo })
  return r
}

// ── Planilla (con montos: solo Talento) ──────────────────────────────────

async function leerFoto (repo, anio, mes) {
  const cifrado = await repo.snapshotPeriodo(anio, mes)
  return cifrado ? JSON.parse(descifrarTexto(cifrado)) : null
}

// Mes cerrado = la foto guardada al cerrar. Solo los abiertos se calculan.
async function calcular (repo, anio, mes) {
  const p = validarPeriodo(anio, mes)
  const cierre = await repo.getPeriodo(p.anio, p.mes)
  if (cierre) {
    const foto = await leerFoto(repo, p.anio, p.mes)
    if (foto) return { ...foto, cerrado: true, cierre }
  }
  return calcularEnVivo(repo, anio, mes)
}

async function calcularEnVivo (repo, anio, mes) {
  const { periodo, personal, asistencia: filas, cierre } = await cruzarPeriodo(repo, anio, mes)
  const vigentes = new Map((await repo.sueldosVigentes(periodo.anio, periodo.mes)).map(s => [s.codigo, s]))
  const diasPorCodigo = new Map()
  for (const a of filas) {
    if (!diasPorCodigo.has(a.codigo)) diasPorCodigo.set(a.codigo, [])
    diasPorCodigo.get(a.codigo).push(a)
  }
  const trabajadores = personal
    .filter(p => (p.activo && vigentes.has(p.codigo)) || diasPorCodigo.has(p.codigo))
    .map(p => {
      const vigente = vigentes.get(p.codigo)
      const sueldo = vigente ? descifrarMonto(vigente.sueldo_cifrado) : 0
      const calc = calcularTrabajador({ sueldoNeto: sueldo, horaIngreso: p.hora_ingreso }, diasPorCodigo.get(p.codigo) || [])
      return {
        personal_id: p.personal_id, codigo: p.codigo, dni: p.dni, nombre: p.nombre, area: p.area, hora_ingreso: p.hora_ingreso,
        sin_sueldo: !vigente,
        sueldo_vigente_desde: vigente ? `${vigente.anio}-${String(vigente.mes).padStart(2, '0')}` : null,
        ...calc
      }
    })
  const suma = k => Math.round(trabajadores.reduce((a, t) => a + t[k], 0) * 100) / 100
  return {
    ...periodo,
    cerrado: !!cierre,
    cierre,
    totales: {
      trabajadores: trabajadores.length,
      sueldo_neto: suma('sueldo_neto'),
      pago_quincena: suma('pago_quincena'),
      pago_fin_mes_bruto: suma('pago_fin_mes_bruto'),
      descuento_tardanza: suma('descuento_tardanza'),
      pago_fin_mes: suma('pago_fin_mes'),
      minutos_tardanza: suma('minutos_tardanza')
    },
    trabajadores
  }
}

export async function planilla ({ anio, mes, roles, userId }, { repo } = DEPENDENCIAS) {
  assertPuedeVerSueldos(roles)
  const r = await calcular(repo, anio, mes)
  await repo.auditar(userId, 'VER_PLANILLA', { anio: r.anio, mes: r.mes })
  return r
}

export async function exportar ({ anio, mes, roles, userId }, { repo } = DEPENDENCIAS) {
  assertPuedeVerSueldos(roles)
  const r = await calcular(repo, anio, mes)
  await repo.auditar(userId, 'EXPORTAR_PLANILLA', { anio: r.anio, mes: r.mes })
  return { buffer: await exportarPlanilla({ anio: r.anio, mes: r.mes, filas: r.trabajadores }), nombre: `planilla-${r.anio}-${String(r.mes).padStart(2, '0')}.xlsx` }
}

export async function cerrarPeriodo ({ anio, mes, roles, userId }, { repo } = DEPENDENCIAS) {
  assertPuedeVerSueldos(roles)
  const p = validarPeriodo(anio, mes)
  await assertPeriodoAbierto(repo, p.anio, p.mes)
  const foto = await calcularEnVivo(repo, p.anio, p.mes)
  const { cerrado, cierre, ...datos } = foto
  await repo.cerrarPeriodo(p.anio, p.mes, userId, cifrarTexto(JSON.stringify(datos)))
  await repo.auditar(userId, 'CERRAR_PERIODO', { anio: p.anio, mes: p.mes })
  return repo.getPeriodo(p.anio, p.mes)
}

export async function reabrirPeriodo ({ anio, mes, roles, userId }, { repo } = DEPENDENCIAS) {
  assertPuedeVerSueldos(roles)
  const p = validarPeriodo(anio, mes)
  await repo.reabrirPeriodo(p.anio, p.mes)
  await repo.auditar(userId, 'REABRIR_PERIODO', { anio: p.anio, mes: p.mes })
  return null
}
