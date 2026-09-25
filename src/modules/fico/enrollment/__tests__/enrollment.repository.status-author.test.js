import { describe, it, expect } from 'vitest'
import { EnrollmentRepository } from '../enrollment.repository.js'

// audit_logs atribuye el cambio a user_modification_id o, si falta, a quien
// registro la venta: un RP de ELFI sobre la 18176 quedo a nombre de RAFI.
// Todo cambio de estado terminal debe firmar con el usuario que lo hace.
const RP_O_CC = 99

function repoQueCapturaLosUpdates () {
  const updates = []
  const db = {
    query: async (text, params) => {
      if (/UPDATE enrollments/.test(text)) updates.push({ text, params })
      return { rows: [{ catalog_id: RP_O_CC }] }
    }
  }
  return { repo: new EnrollmentRepository(db), updates }
}

function expectFirmadoPor (update, userId) {
  expect(update.text).toContain('user_modification_id')
  expect(update.params).toContain(userId)
}

describe('autor del cambio de estado de una inscripcion', () => {
  it('retireChild firma el retiro del hijo', async () => {
    const { repo, updates } = repoQueCapturaLosUpdates()
    await repo.retireChild(18177, 3241, 22)
    expectFirmadoPor(updates[0], 22)
  })

  it('retireParent firma el retiro del padre', async () => {
    const { repo, updates } = repoQueCapturaLosUpdates()
    await repo.retireParent(18176, 3241, 22)
    expectFirmadoPor(updates[0], 22)
  })

  it('setTypeStatus firma el RP y el CC', async () => {
    const { repo, updates } = repoQueCapturaLosUpdates()
    await repo.setTypeStatus(18176, RP_O_CC, 22)
    expectFirmadoPor(updates[0], 22)
  })
})
