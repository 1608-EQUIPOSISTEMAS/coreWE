import { describe, it, expect } from 'vitest'
import {
  toIsoDate,
  shiftDate,
  weekOfMonth,
  groupIntoWeeks,
  toPlanItem,
  moveItemDays,
  isPackage,
  withoutPackageModules,
  spillsInto,
  toCarryOverItem,
  assertPublishable,
  toRegisterPayload,
  toTreeRegisterPayload,
  SchedulePlanError
} from '../scheduleplan.entity.js'

const CURSO = {
  edition_num_id: 15005,
  program_version_id: 59,
  program_type_alias: 'we_program_type_course',
  instructor_id: 2017,
  start_date: '2026-06-03',
  end_date: '2026-07-08',
  cat_day_combination_id: 3014,
  cat_hour_combination_id: 3020,
  cat_segment_id: 3056,
  global_code: 'E29',
  specific_code: 'E4-26',
  expedient: true,
  upgrade: false,
  confirmation: true,
  preconfirmation: true,
  active: true,
  vacant: 30
}

const PAQUETE = {
  edition_num_id: 15405,
  program_version_id: 66,
  cat_type_program_alias: 'we_program_type_specialization',
  start_date: '2026-06-06',
  end_date: '2026-08-22',
  active: true,
  children: [
    { sort_order: 1, child_program_version_id: 70, edition_id: 15019, abbreviation: 'POWER APPS', start_date: '2026-06-06', end_date: '2026-07-11', active: true, expedient: true },
    { sort_order: 2, child_program_version_id: 71, edition_id: 15020, abbreviation: 'AUTOMATE', start_date: '2026-07-18', end_date: '2026-08-22', active: true, expedient: false }
  ]
}

describe('toIsoDate', () => {
  it('recorta el ISO con hora sin correr el dia', () => {
    // sp_edition_tree_get devuelve la medianoche de Lima como 05:00Z.
    expect(toIsoDate('2026-06-06T05:00:00.000Z')).toBe('2026-06-06')
  })

  it('deja pasar la fecha simple y descarta la basura', () => {
    expect(toIsoDate('2026-06-06')).toBe('2026-06-06')
    expect(toIsoDate(null)).toBeNull()
    expect(toIsoDate('mañana')).toBeNull()
  })
})

describe('shiftDate', () => {
  it('modo weekday conserva el dia de la semana', () => {
    // 3-jun-2026 es miercoles; +52 semanas cae el 2-jun-2027, tambien miercoles.
    const destino = shiftDate('2026-06-03', { mode: 'weekday', years: 1 })
    expect(destino).toBe('2027-06-02')
    expect(new Date(`${destino}T00:00:00Z`).getUTCDay()).toBe(3)
  })

  it('modo same_date conserva la fecha aunque cambie el dia', () => {
    expect(shiftDate('2026-06-03', { mode: 'same_date', years: 1 })).toBe('2027-06-03')
  })

  it('rechaza un modo desconocido en vez de adivinar', () => {
    expect(() => shiftDate('2026-06-03', { mode: 'random' })).toThrow(SchedulePlanError)
  })
})

describe('weekOfMonth', () => {
  // Numeracion verificada contra sp_edition_by_week_list para junio 2026:
  // semana 1 -> dia 3, semana 2 -> dia 11, semana 3 -> dia 17, semana 4 -> dia 25.
  it.each([
    ['2026-06-03', 1],
    ['2026-06-11', 2],
    ['2026-06-17', 3],
    ['2026-06-25', 4]
  ])('%s cae en la semana %i', (fecha, semana) => {
    expect(weekOfMonth(fecha)).toBe(semana)
  })

  it('cuenta desde el lunes aunque el mes empiece a mitad de semana', () => {
    // 1-ago-2026 es sabado: sigue siendo semana 1, y el lunes 3 arranca la 2.
    expect(weekOfMonth('2026-08-01')).toBe(1)
    expect(weekOfMonth('2026-08-03')).toBe(2)
  })
})

describe('groupIntoWeeks', () => {
  it('devuelve las 6 semanas del sobre del cronograma', () => {
    const semanas = groupIntoWeeks([{ start_date: '2027-06-02' }], { month: 6, year: 2027 })
    expect(semanas.map(s => s.schedule)).toEqual([1, 2, 3, 4, 5, 6])
    expect(semanas[0].items).toHaveLength(1)
  })

  it('deja fuera lo que no es del mes pedido', () => {
    const semanas = groupIntoWeeks(
      [{ start_date: '2027-06-02' }, { start_date: '2027-07-07' }],
      { month: 6, year: 2027 })
    expect(semanas.flatMap(s => s.items)).toHaveLength(1)
  })
})

describe('toPlanItem', () => {
  it('corta el vinculo con la edicion de origen', () => {
    const item = toPlanItem(CURSO, { uid: 's15005' })
    expect(item.edition_num_id).toBeNull()
    expect(item.published_edition_id).toBeNull()
    expect(item.source_edition_id).toBe(15005)
  })

  it('no hereda los codigos: son unicos por version de programa', () => {
    // Copiar "E29" del 2026 hace que el SP rechace la edicion 2027 entera.
    const item = toPlanItem(CURSO, { uid: 's15005' })
    expect(item.global_code).toBeNull()
    expect(item.specific_code).toBeNull()
  })

  it('corre las fechas del padre y de cada modulo', () => {
    const item = toPlanItem(PAQUETE, { uid: 's15405', mode: 'weekday', years: 1 })
    expect(item.start_date).toBe('2027-06-05')
    expect(item.children[0].start_date).toBe('2027-06-05')
    expect(item.children[1].start_date).toBe('2027-07-17')
    // Los modulos tampoco pueden apuntar a las ediciones viejas.
    expect(item.children.every(h => h.edition_id === null && h.new === true)).toBe(true)
  })

  it('exige uid: sin el, el planner no puede referenciar la fila', () => {
    expect(() => toPlanItem(CURSO, {})).toThrow(SchedulePlanError)
  })

  // El escenario entero viaja en cada guardado: sin podar, 500 ediciones pesaban
  // 1.85 MB y Fastify cortaba el POST en 1 MB.
  it('poda el ruido de la edicion de origen', () => {
    const gordo = {
      ...CURSO,
      tree_detail: [{ children: [{ edition_num_id: 1 }] }],
      registration_date: '2026-01-26T21:26:21',
      user_registration_id: 3,
      whatsapp_link: 'https://bit.ly/x',
      calc_da: 63,
      cnt_ventas: 20
    }
    const item = toPlanItem(gordo, { uid: 'x' })
    for (const campo of ['tree_detail', 'registration_date', 'user_registration_id',
      'whatsapp_link', 'calc_da', 'cnt_ventas']) {
      expect(item).not.toHaveProperty(campo)
    }
    // Lo que la pantalla sí usa sigue ahí.
    expect(item.program_version_id).toBe(59)
    expect(item.cat_day_combination_id).toBe(3014)
  })

  it('del horario guarda solo el primero', () => {
    const item = toPlanItem({ ...CURSO, schedules: [{ a: 1 }, { a: 2 }] }, { uid: 'x' })
    expect(item.schedules).toEqual([{ a: 1 }])
  })

  it('el modulo guarda solo lo que necesita el alta y el modal', () => {
    const conRuido = {
      ...PAQUETE,
      children: [{ ...PAQUETE.children[0], clasification: 'X', program_public_label: 'largo', schedules: [{}] }]
    }
    const hijo = toPlanItem(conRuido, { uid: 'x' }).children[0]
    expect(hijo).not.toHaveProperty('clasification')
    expect(hijo).not.toHaveProperty('program_public_label')
    expect(hijo.child_program_version_id).toBe(70)
    expect(hijo.abbreviation).toBe('POWER APPS')
  })
})

describe('moveItemDays', () => {
  it('arrastra el paquete completo, no solo la cabecera', () => {
    const movido = moveItemDays(toPlanItem(PAQUETE, { uid: 'x' }), 7)
    expect(movido.start_date).toBe('2027-06-12')
    expect(movido.children[0].start_date).toBe('2027-06-12')
    expect(movido.children[1].start_date).toBe('2027-07-24')
  })
})

describe('isPackage', () => {
  it('distingue curso simple de paquete por el alias del tipo', () => {
    expect(isPackage(CURSO)).toBe(false)
    expect(isPackage(PAQUETE)).toBe(true)
  })

  // Un congreso/evento no es "curso" pero tiene fechas propias y NINGUN modulo:
  // tratarlo como paquete lo manda al SP del arbol, que lo rechaza. Mismo
  // criterio que `isCourse` en el modal de Producto > Cronograma.
  it('un congreso/evento NO es paquete', () => {
    expect(isPackage({ program_type_alias: 'we_program_type_event' })).toBe(false)
  })
})

describe('spillsInto', () => {
  it('reconoce el paquete que arranca en noviembre y termina el año siguiente', () => {
    expect(spillsInto({ start_date: '2026-11-07', end_date: '2027-03-13' }, 2027)).toBe(true)
  })

  it('descarta lo que empieza y termina dentro del año anterior', () => {
    expect(spillsInto({ start_date: '2026-06-03', end_date: '2026-07-08' }, 2027)).toBe(false)
  })

  it('descarta lo que ya arranca dentro del año del plan', () => {
    // Eso no es un arrastre: es programación del año, y ya lo trae el duplicado.
    expect(spillsInto({ start_date: '2027-01-05', end_date: '2027-03-01' }, 2027)).toBe(false)
  })

  it('el que termina justo el 1 de enero cuenta', () => {
    expect(spillsInto({ start_date: '2026-12-01', end_date: '2027-01-01' }, 2027)).toBe(true)
    expect(spillsInto({ start_date: '2026-12-01', end_date: '2026-12-31' }, 2027)).toBe(false)
  })

  it('sin fechas no arrastra nada', () => {
    expect(spillsInto({ start_date: null, end_date: '2027-03-01' }, 2027)).toBe(false)
  })
})

describe('toCarryOverItem', () => {
  const ARRASTRE = { ...PAQUETE, start_date: '2026-11-07', end_date: '2027-03-13', global_code: 'E21', specific_code: 'E8-26' }

  it('entra marcado como ya publicado: la edición existe de verdad', () => {
    const item = toCarryOverItem(ARRASTRE, { uid: 'a15405' })
    expect(item.carry_over).toBe(true)
    expect(item.published_edition_id).toBe(15405)
    // Y por eso assertPublishable lo rechaza: publicarlo sería duplicarlo.
    expect(() => assertPublishable(item)).toThrow(/ya fue publicado/)
  })

  it('NO corre las fechas ni borra los códigos: no es una copia', () => {
    const item = toCarryOverItem(ARRASTRE, { uid: 'a15405' })
    expect(item.start_date).toBe('2026-11-07')
    expect(item.end_date).toBe('2027-03-13')
    expect(item.global_code).toBe('E21')
  })

  it('withoutPackageModules no le toca los módulos', () => {
    // Un arrastre nunca se publica, así que no hay riesgo de crear el módulo
    // dos veces: se muestran los dos, igual que en el cronograma real.
    const arrastre = toCarryOverItem(ARRASTRE, { uid: 'a15405' })
    const moduloSuelto = {
      uid: 'a15019', program_type_alias: 'we_program_type_course',
      source_edition_id: 15019, published_edition_id: 15019, carry_over: true
    }
    expect(withoutPackageModules([arrastre, moduloSuelto])).toHaveLength(2)
  })
})

describe('withoutPackageModules', () => {
  // Un modulo de paquete es tambien una edicion suelta en el cronograma: sin
  // este filtro se publicaria dos veces (dentro del arbol y por su cuenta).
  const paquete = { ...PAQUETE, uid: 'p', source_edition_id: 15405 }
  const moduloSuelto = { uid: 'm1', program_type_alias: 'we_program_type_course', source_edition_id: 15019 }
  const cursoAparte = { uid: 'c1', program_type_alias: 'we_program_type_course', source_edition_id: 99999 }

  it('descarta el modulo suelto y conserva el paquete', () => {
    const quedan = withoutPackageModules([paquete, moduloSuelto, cursoAparte])
    expect(quedan.map(i => i.uid)).toEqual(['p', 'c1'])
  })

  it('no descarta un curso que solo se parece', () => {
    expect(withoutPackageModules([paquete, cursoAparte])).toHaveLength(2)
  })

  it('nunca descarta lo ya publicado: esa edicion existe de verdad', () => {
    const publicado = { ...moduloSuelto, published_edition_id: 40001 }
    expect(withoutPackageModules([paquete, publicado]).map(i => i.uid)).toEqual(['p', 'm1'])
  })

  it('sin paquetes devuelve la lista intacta', () => {
    expect(withoutPackageModules([cursoAparte])).toHaveLength(1)
  })
})

describe('assertPublishable', () => {
  it('no republica lo ya publicado', () => {
    expect(() => assertPublishable({ ...CURSO, published_edition_id: 99 }))
      .toThrow(/ya fue publicado/)
  })

  it('un curso sin combinacion de dias no se publica', () => {
    expect(() => assertPublishable({ ...CURSO, cat_day_combination_id: null }))
      .toThrow(/combinacion de dias/)
  })

  it('un paquete sin modulos no se publica', () => {
    expect(() => assertPublishable({ ...PAQUETE, children: [] })).toThrow(/sin modulos/)
  })

  it('un modulo sin programa nombra al culpable', () => {
    const roto = { ...PAQUETE, children: [{ sort_order: 1, abbreviation: 'AUTOMATE' }] }
    expect(() => assertPublishable(roto)).toThrow(/AUTOMATE/)
  })
})

describe('toRegisterPayload', () => {
  it('traduce los booleanos a las banderas Y/N que espera el SP', () => {
    const payload = toRegisterPayload(toPlanItem(CURSO, { uid: 'x' }), 2027)
    expect(payload.expedient).toBe('Y')
    expect(payload.upgrade).toBe('N')
    expect(payload.year).toBe(2027)
    expect(payload.start_date).toBe('2027-06-02')
    // Ningun rastro de la edicion vieja puede viajar al SP de alta.
    expect(payload).not.toHaveProperty('edition_num_id')
    expect(payload).not.toHaveProperty('source_edition_id')
  })
})

describe('toTreeRegisterPayload', () => {
  it('manda los modulos como nuevos, sin edicion previa', () => {
    const payload = toTreeRegisterPayload(toPlanItem(PAQUETE, { uid: 'x' }), 2027)
    expect(payload.edition_id).toBeNull()
    expect(payload.children).toHaveLength(2)
    expect(payload.children[0]).toMatchObject({
      sort_order: 1, child_program_version_id: 70, edition_id: null, new: true
    })
  })

  // 13 modulos de junio 2026 los comparten dos o tres paquetes (ESPEC. EXCEL y
  // ESP. EXCEL EXP comparten los tres). Si el segundo paquete no reusa el modulo
  // ya creado, el cronograma lo rechaza por choque de docente.
  it('reusa un modulo que otro paquete ya publico', () => {
    const item = toPlanItem(PAQUETE, { uid: 'x' })
    const yaPublicados = new Map([[15019, 40007]]) // modulo origen -> modulo nuevo
    const payload = toTreeRegisterPayload(item, 2027, yaPublicados)

    expect(payload.children[0]).toMatchObject({ new: false, edition_id: 40007 })
    // El que nadie creo todavia sigue siendo nuevo.
    expect(payload.children[1]).toMatchObject({ new: true, edition_id: null })
  })
})
