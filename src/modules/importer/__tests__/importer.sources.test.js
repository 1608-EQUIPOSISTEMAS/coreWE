import { describe, it, expect } from 'vitest'
import { parseSheetTabs } from '../importer.sources.js'

describe('parseSheetTabs — pestañas de la vista /htmlview de Google', () => {
  it('extrae nombre y gid de cada pestaña', () => {
    const html = 'items.push({name: "1. INS - N", pageUrl: "https:\\/\\/docs.google.com\\/x?headers\\x3dtrue&gid=578000626", gid: "578000626",});' +
      'items.push({name: "2. Cuota INS - N", pageUrl: "https:\\/\\/x&gid=1812527170", gid: "1812527170",});'
    expect(parseSheetTabs(html)).toEqual([
      { name: '1. INS - N', gid: '578000626' },
      { name: '2. Cuota INS - N', gid: '1812527170' }
    ])
  })
})
