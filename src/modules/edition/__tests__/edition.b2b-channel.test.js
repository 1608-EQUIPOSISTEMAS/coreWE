import { describe, it, expect } from 'vitest'
import { EditionRepository, isB2bSaleSql } from '../edition.repository.js'

// Quien es B2B lo decide el CANAL, no el asesor: "B2B - AE30" es convenio
// aunque AE30 sea comercial (regla del usuario 07/09/26, que revierte la guarda
// del 13/07/26). El DOCUMENTO (OS/OP) es el unico marcador que ademas exige
// asesor de convenios: una Orden de Servicio es forma de pago, no convenio, y
// por si sola volvia B2B las 4 ventas comerciales de AE30 (16699, 16700, 18507,
// 18508 — sin canal, lead b2b='N', sin contrato).
//
// El predicado no se puede ejecutar sin BD, asi que el test fija las dos mitades
// de la regla y que las tres queries usen el MISMO texto (nadie lo reescribe a
// mano, que es como divergieron la Lista de Notas y el cronograma en julio).
const ALIAS = { doctype: 'e.cat_b2b_doctype', origin: 'e.agent_origin', advisor: 'ua.alias', sellerId: 'ua.user_id' }

describe('isB2bSaleSql', () => {
  const sql = isB2bSaleSql(ALIAS)

  // La rama del canal es todo lo anterior al primer 'OR ('; la del documento,
  // el resto (que trae otro 'OR' adentro, el de la lista de asesores).
  const corte = sql.indexOf('OR (')
  const [canal, documento] = [sql.slice(0, corte), sql.slice(corte)]

  it('el canal B2B basta por si solo, sea quien sea el asesor', () => {
    expect(canal).toContain("ILIKE '%b2b%'")
    expect(canal).not.toContain('NY12')
  })

  // 22754: match WEB de NY12. El canal dice WEB, pero el convenio es suyo.
  it('el match WEB de un asesor con rol de convenios es B2B', () => {
    expect(canal).toContain("(e.agent_origin) = 'WEB'")
    expect(canal).toContain("ur.user_id = (ua.user_id)")
    expect(canal).toContain("r.alias IN ('B2B', 'LIDER_B2B')")
  })

  it('el documento solo es B2B con asesor de convenios o sin asesor', () => {
    expect(documento).toContain('cat_b2b_doctype) IS NOT NULL')
    expect(documento).toContain("IN ('NY12','JF39')")
  })
})

describe.each([
  ['classroomChannelMetricsList', [[15441]], { doctype: 'e.cat_b2b_doctype', origin: 'e.agent_origin', advisor: 'ua.alias', sellerId: 'ua.user_id' }],
  ['classroomStudentsList', [15441], {
    doctype: 'COALESCE(e.cat_b2b_doctype, e_sold.cat_b2b_doctype)',
    origin: 'COALESCE(e_sold.agent_origin, e.agent_origin)',
    advisor: 'usold.alias',
    sellerId: 'usold.user_id'
  }],
  ['b2bTrackingList', [], {
    doctype: 'COALESCE(e.cat_b2b_doctype, es.cat_b2b_doctype)',
    origin: 'COALESCE(es.agent_origin, e.agent_origin)',
    advisor: 'usold.alias',
    sellerId: 'usold.user_id'
  }]
])('%s', (metodo, args, alias) => {
  it('usa el predicado compartido, no una copia a mano', async () => {
    let sql = null
    const repo = new EditionRepository({ query: (text) => { sql = text; return { rows: [] } } })
    await repo[metodo](...args)

    expect(sql).toContain(isB2bSaleSql(alias))
  })
})
