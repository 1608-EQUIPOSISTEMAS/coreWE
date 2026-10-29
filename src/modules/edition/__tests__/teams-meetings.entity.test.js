import {
  parseHourRange,
  needsTeams,
  futureSessions,
  instructorUpn,
  resolveOrganizer,
  desiredSlot,
  buildEventPayload,
  planEditionSync,
  matchOdooSession,
  meetingOptions,
  organizerIdFromJoinUrl,
  isManualClassroom,
  horizonEndOf
} from '../teams-meetings.entity.js'

const row = {
  edition_num_id: 42,
  abbreviation: 'POWER BI',
  total_sessions: 6,
  class_code: 'PB-02/11/26',
  start_date: '2026-11-02',
  instructor: 'Rosa Sanchez',
  instructor_first_name: 'ROSA MARIA',
  instructor_last_name: 'SÁNCHEZ PEREZ',
  teams_username: 'RSanchez@fundacionweperu.onmicrosoft.com',
  modality_alias: 'we_modality_live'
}
const hours = { start: '19:00', end: '22:00' }

describe('parseHourRange', () => {
  it('lee horas enteras y con minutos', () => {
    expect(parseHourRange('we_hour_combination_19_22')).toEqual({ start: '19:00', end: '22:00' })
    expect(parseHourRange('we_hour_combination_09_13')).toEqual({ start: '09:00', end: '13:00' })
    expect(parseHourRange('we_hour_combination_1930_2200')).toEqual({ start: '19:30', end: '22:00' })
  })
  it('null si el alias no trae horario valido', () => {
    expect(parseHourRange(null)).toBeNull()
    expect(parseHourRange('we_hour_combination_x')).toBeNull()
    expect(parseHourRange('we_hour_combination_22_19')).toBeNull()
  })
})

describe('needsTeams / instructorUpn / resolveOrganizer', () => {
  it('presencial no lleva Teams', () => {
    expect(needsTeams({ modality_alias: 'we_modality_in_person' })).toBe(false)
    expect(needsTeams(row)).toBe(true)
  })
  it('normaliza el usuario Teams del docente y descarta basura', () => {
    expect(instructorUpn(row)).toBe('rsanchez@fundacionweperu.onmicrosoft.com')
    expect(instructorUpn({ teams_username: 'rsanchez' })).toBeNull()
  })
  it('modo docente cae a la central si el docente no tiene cuenta', () => {
    expect(resolveOrganizer({ mode: 'instructor', central: 'aulas@x.com', instructor: 'd@x.com' })).toBe('d@x.com')
    expect(resolveOrganizer({ mode: 'instructor', central: 'Aulas@x.com', instructor: null })).toBe('aulas@x.com')
    expect(resolveOrganizer({ mode: 'central', central: 'aulas@x.com', instructor: 'd@x.com' })).toBe('aulas@x.com')
  })
})

describe('futureSessions', () => {
  it('solo sesiones desde hoy y no dictadas', () => {
    const control = {
      sessions: [
        { session_number: 1, date: '2026-10-26', status: 'A' },
        { session_number: 2, date: '2026-10-29', status: null },
        { session_number: 3, date: '2026-11-02', status: 'T' },
        { session_number: 4, date: '2026-11-05', status: 'R' }
      ]
    }
    expect(futureSessions(control, '2026-10-29').map((s) => s.session_number)).toEqual([2, 4])
  })
})

describe('buildEventPayload', () => {
  it('arma evento Teams en hora de Lima e invita al docente', () => {
    const slot = desiredSlot(row, { session_number: 3, date: '2026-11-09' }, hours)
    const ev = buildEventPayload(row, slot, { organizer: 'aulas@x.com', instructor: 'rsanchez@x.com' })
    // Mismo patron que las reuniones manuales: WE_<curso>_<Nombre Apellido>_<inicio DD.MM>
    expect(ev.subject).toBe('WE_POWER BI_Rosa Sánchez_02.11')
    expect(ev.body.content).toContain('Sesión 3')
    expect(ev.categories).toEqual(['ERP Aulas'])
    expect(ev.start).toEqual({ dateTime: '2026-11-09T19:00:00', timeZone: 'SA Pacific Standard Time' })
    expect(ev.end.dateTime).toBe('2026-11-09T22:00:00')
    expect(ev.isOnlineMeeting).toBe(true)
    expect(ev.onlineMeetingProvider).toBe('teamsForBusiness')
    expect(ev.attendees).toHaveLength(1)
    expect(ev.transactionId).toBe('erp-ed42-s3-202611091900')
  })
  it('sin docente el nombre queda WE_<curso>_<inicio>', () => {
    const slot = desiredSlot({ ...row, instructor_first_name: null, instructor_last_name: null }, { session_number: 1, date: '2026-11-02' }, hours)
    expect(slot.subject).toBe('WE_POWER BI_02.11')
  })
  it('no se invita a si mismo si el docente es el organizador', () => {
    const slot = desiredSlot(row, { session_number: 1, date: '2026-11-02' }, hours)
    expect(buildEventPayload(row, slot, { organizer: 'd@x.com', instructor: 'd@x.com' }).attendees).toEqual([])
  })
})

describe('isManualClassroom', () => {
  const manual = { classroom_teams_link: 'https://teams.microsoft.com/meet/123' }
  it('aula con link manual se respeta', () => {
    expect(isManualClassroom(manual)).toBe(true)
    expect(isManualClassroom({ classroom_teams_link: '  ' })).toBe(false)
    expect(isManualClassroom({})).toBe(false)
  })
  it('si el ERP ya la maneja o se desactiva la regla, se sincroniza', () => {
    expect(isManualClassroom(manual, { managedByErp: true })).toBe(false)
    expect(isManualClassroom(manual, { respectManual: false })).toBe(false)
  })
})

describe('meetingOptions', () => {
  it('docente coorganizador y grabacion automatica', () => {
    const { patch, signature } = meetingOptions({ instructor: 'd@x.com' })
    expect(patch.recordAutomatically).toBe(true)
    expect(patch.allowTranscription).toBe(true)
    expect(patch.participants.attendees).toEqual([{ upn: 'd@x.com', role: 'coorganizer' }])
    expect(signature).toBe('rec=1;co=d@x.com;lobby=everyone')
    expect(patch.lobbyBypassSettings).toEqual({ scope: 'everyone', isDialInBypassEnabled: true })
  })
  it('sin docente o con coorganizador apagado no agrega participantes', () => {
    expect(meetingOptions({ instructor: null }).patch.participants.attendees).toEqual([])
    expect(meetingOptions({ instructor: 'd@x.com', coorganizer: false }).signature).toBe('rec=1;co=-;lobby=everyone')
  })
  it('la firma cambia si cambia el docente', () => {
    expect(meetingOptions({ instructor: 'a@x.com' }).signature)
      .not.toBe(meetingOptions({ instructor: 'b@x.com' }).signature)
  })
})

describe('organizerIdFromJoinUrl', () => {
  it('lee el Oid del contexto del link', () => {
    const url = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_X%40thread.v2/0?context=%7b%22Tid%22%3a%22af985d79-c492-4132-be6d-84e7f7ce6d15%22%2c%22Oid%22%3a%22114d1d0e-9633-46cf-8cd1-6a57d20ea411%22%7d'
    expect(organizerIdFromJoinUrl(url)).toBe('114d1d0e-9633-46cf-8cd1-6a57d20ea411')
  })
  it('null si el link no lo trae', () => {
    expect(organizerIdFromJoinUrl('https://teams.microsoft.com/meet/123?p=abc')).toBeNull()
    expect(organizerIdFromJoinUrl('basura')).toBeNull()
  })
})

describe('matchOdooSession', () => {
  const odoo = [
    { id: 11, sequence: 1, name: 'Sesión 1:' },
    { id: 12, sequence: 2, name: 'Sesión 2:' },
    { id: 15, sequence: 0, name: 'Sesion 5' }
  ]
  it('cruza por sequence', () => {
    expect(matchOdooSession(odoo, 2).id).toBe(12)
  })
  it('sin sequence util cae al numero del nombre', () => {
    expect(matchOdooSession(odoo, 5).id).toBe(15)
  })
  it('null si no existe o es ambigua', () => {
    expect(matchOdooSession(odoo, 7)).toBeNull()
    expect(matchOdooSession([{ id: 1, sequence: 3 }, { id: 2, sequence: 3 }], 3)).toBeNull()
  })
})

describe('planEditionSync', () => {
  const today = '2026-10-29'
  const horizonEnd = horizonEndOf(today, 14) // 2026-11-12
  const slot = (n, date) => desiredSlot(row, { session_number: n, date }, hours)
  const existing = (n, date, extra = {}) => ({
    session_number: n, event_id: `ev${n}`, organizer: 'aulas@x.com',
    start_local: `${date}T19:00`, end_local: `${date}T22:00`,
    subject: 'WE_POWER BI_Rosa Sánchez_02.11', ...extra
  })

  it('horizonEndOf suma dias calendario', () => {
    expect(horizonEnd).toBe('2026-11-12')
  })

  it('crea solo lo que falta dentro del horizonte', () => {
    const plan = planEditionSync({
      slots: [slot(1, '2026-11-02'), slot(2, '2026-11-09'), slot(3, '2026-11-16')],
      existing: [existing(1, '2026-11-02')],
      horizonEnd, today, organizer: 'aulas@x.com'
    })
    expect(plan.create.map((s) => s.session_number)).toEqual([2])
    expect(plan.update).toEqual([])
    expect(plan.cancel).toEqual([])
  })

  it('mueve (sin recrear) la sesion reprogramada aunque salga del horizonte', () => {
    const plan = planEditionSync({
      slots: [slot(2, '2026-11-30')],
      existing: [existing(2, '2026-11-09')],
      horizonEnd, today, organizer: 'aulas@x.com'
    })
    expect(plan.create).toEqual([])
    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]).toMatchObject({ session_number: 2, event_id: 'ev2', start_local: '2026-11-30T19:00' })
  })

  it('cancela futuras que ya no tienen sesion y respeta las pasadas', () => {
    const plan = planEditionSync({
      slots: [slot(2, '2026-11-09')],
      existing: [existing(1, '2026-10-26'), existing(2, '2026-11-09'), existing(7, '2026-12-14')],
      horizonEnd, today, organizer: 'aulas@x.com'
    })
    expect(plan.cancel.map((e) => e.session_number)).toEqual([7])
  })

  it('cambio de organizador recrea el evento', () => {
    const plan = planEditionSync({
      slots: [slot(2, '2026-11-09')],
      existing: [existing(2, '2026-11-09')],
      horizonEnd, today, organizer: 'docente@x.com'
    })
    expect(plan.cancel.map((e) => e.session_number)).toEqual([2])
    expect(plan.create.map((s) => s.session_number)).toEqual([2])
  })
})
