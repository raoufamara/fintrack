import { describe, expect, it } from 'vitest'
import realCsv from './__fixtures__/splitwise-real-export.csv?raw'
import sampleCsv from './__fixtures__/splitwise-sample.csv?raw'
import { detectDelimiter, parseAmount, parseSplitwiseCsv, tokenizeCsv, type SplitwiseFile } from './splitwiseCsv'

function parse(text: string): SplitwiseFile {
  const r = parseSplitwiseCsv(text)
  if (!r.ok) throw new Error(r.message)
  return r.file
}

const HEADER = 'Date,Description,Category,Cost,Currency,Ann,Bob\n'

describe('tokenizeCsv', () => {
  it('handles quotes, doubled quotes, embedded commas and line breaks', () => {
    const rows = tokenizeCsv('a,"b, c","say ""hi""","x\ny"\n1,2,3,4')
    expect(rows[0]!.cells).toEqual(['a', 'b, c', 'say "hi"', 'x\ny'])
    expect(rows[1]!.cells).toEqual(['1', '2', '3', '4'])
    expect(rows[1]!.line).toBe(3)
  })

  it('accepts CRLF, CR and a missing final newline', () => {
    expect(tokenizeCsv('a,b\r\nc,d\r\ne,f').map((r) => r.cells)).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f']])
    expect(tokenizeCsv('a,b\rc,d').length).toBe(2)
  })

  it('keeps a quote in the middle of an unquoted field', () => {
    expect(tokenizeCsv('5" pizza,x')[0]!.cells).toEqual(['5" pizza', 'x'])
  })

  it('detects semicolons', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a,b;c')).toBe(',')
  })
})

describe('parseAmount', () => {
  it('reads plain, padded, signed and localised numbers', () => {
    expect(parseAmount(' 12.50 ', 'EUR')).toEqual({ kind: 'ok', minor: 1250 })
    expect(parseAmount('-1 234,5', 'EUR')).toEqual({ kind: 'ok', minor: -123450 })
    expect(parseAmount('1.234,50', 'EUR')).toEqual({ kind: 'ok', minor: 123450 })
    expect(parseAmount('1,234.50', 'EUR')).toEqual({ kind: 'ok', minor: 123450 })
    expect(parseAmount('−3.00', 'EUR')).toEqual({ kind: 'ok', minor: -300 })
    expect(parseAmount('(3.00)', 'EUR')).toEqual({ kind: 'ok', minor: -300 })
    expect(parseAmount('1200', 'JPY')).toEqual({ kind: 'ok', minor: 1200 })
    expect(parseAmount('1.234', 'KWD')).toEqual({ kind: 'ok', minor: 1234 })
  })
  it('tells blank from garbage', () => {
    expect(parseAmount('  ', 'EUR').kind).toBe('blank')
    expect(parseAmount('abc', 'EUR').kind).toBe('bad')
  })
})

describe('parseSplitwiseCsv: synthetic fixture', () => {
  const file = parse(sampleCsv)

  it('reads people with accents and trims their names', () => {
    expect(file.people).toEqual(['Sara Lopez', 'Malik B', 'Inès', 'Raouf'])
  })

  it('reads every data row, with quoted commas in descriptions', () => {
    expect(file.rows).toHaveLength(7)
    expect(file.rows[2]!.description).toBe('Pastéis de Belém, take-away')
    expect(file.rows[0]).toMatchObject({ date: '2026-10-03', category: 'Hotel', currency: 'EUR', costMinor: 48000, isPayment: false })
    expect(file.rows[0]!.nets).toEqual([36000, -12000, -12000, -12000])
    expect(file.issues).toEqual([])
  })

  it('flags payment rows', () => {
    expect(file.rows.filter((r) => r.isPayment).map((r) => r.description)).toEqual(['Malik B paid Sara Lopez'])
  })

  it('keeps the Total balance row apart and never as an expense', () => {
    expect(file.totals).toEqual([{ line: 10, currency: 'EUR', balances: [24916, -11884, -6864, -6168] }])
    expect(file.rows.some((r) => /total/i.test(r.description))).toBe(false)
  })
})

describe('parseSplitwiseCsv: tolerance', () => {
  const row = '2026-10-03,Lunch,Dining out,10.00,EUR,5.00,-5.00\n'

  it('accepts a BOM and CRLF line endings', () => {
    const file = parse(`\uFEFF${(HEADER + row).replace(/\n/g, '\r\n')}`)
    expect(file.people).toEqual(['Ann', 'Bob'])
    expect(file.rows).toHaveLength(1)
  })

  it('ignores trailing blank lines and spaces around numbers', () => {
    const file = parse(`${HEADER}2026-10-03,Lunch,Dining out, 10.00 ,EUR, 5.00 , -5.00 \n\n\n`)
    expect(file.rows[0]!.nets).toEqual([500, -500])
  })

  it('finds columns by name, whatever the case or order', () => {
    const file = parse('COST,category,Description,DATE,currency,Ann,Bob\n10.00,Food,Lunch,2026-10-03,EUR,5.00,-5.00\n')
    expect(file.people).toEqual(['Ann', 'Bob'])
    expect(file.rows[0]).toMatchObject({ date: '2026-10-03', description: 'Lunch', category: 'Food', costMinor: 1000 })
  })

  it('handles extra unknown columns before Currency', () => {
    const file = parse('Date,Description,Category,Cost,Notes,Currency,Ann,Bob\n2026-10-03,Lunch,Food,10.00,hello,EUR,5.00,-5.00\n')
    expect(file.people).toEqual(['Ann', 'Bob'])
    expect(file.rows[0]).toMatchObject({ currency: 'EUR', costMinor: 1000, nets: [500, -500] })
  })

  it('ignores a blank line right after the header', () => {
    expect(parse(`${HEADER}\n${row}`).rows).toHaveLength(1)
  })

  it('reads a mix of currencies and one Total balance row per currency', () => {
    const file = parse(
      `${HEADER}2026-10-03,Lunch,Food,10.00,EUR,5.00,-5.00\n2026-10-04,Taxi,Taxi,1200,JPY,600,-600\n\n2026-10-05,Total balance, , ,EUR,5.00,-5.00\n2026-10-05,Total balance, , ,JPY,600,-600\n`,
    )
    expect(file.rows.map((r) => r.currency)).toEqual(['EUR', 'JPY'])
    expect(file.rows[1]!.costMinor).toBe(1200)
    expect(file.totals.map((t) => t.currency)).toEqual(['EUR', 'JPY'])
  })

  it('keeps rows with cost 0 for the mapper to skip', () => {
    expect(parse(`${HEADER}2026-10-03,Free,Food,0.00,EUR,0.00,0.00\n`).rows[0]!.costMinor).toBe(0)
  })

  it('warns about two people with the same name', () => {
    const file = parse('Date,Description,Category,Cost,Currency,Ann,Ann\n2026-10-03,x,Food,2.00,EUR,1.00,-1.00\n')
    expect(file.warnings.join(' ')).toMatch(/both called "Ann"/)
  })
})

describe('parseSplitwiseCsv: dates', () => {
  const one = (d: string) => parse(`${HEADER}${d},x,Food,2.00,EUR,1.00,-1.00\n`)

  it('prefers YYYY-MM-DD', () => {
    expect(one('2026-10-03').rows[0]!.date).toBe('2026-10-03')
    expect(one('2026-10-03').warnings).toEqual([])
  })

  it('reads a date with a time', () => {
    expect(one('2026-10-03 14:22:00').rows[0]!.date).toBe('2026-10-03')
  })

  it('reads DD/MM/YYYY when the day is above 12, and MM/DD/YYYY when the month position is', () => {
    expect(one('25/10/2026').rows[0]!.date).toBe('2026-10-25')
    expect(one('10/25/2026').rows[0]!.date).toBe('2026-10-25')
  })

  it('flags an ambiguous date and reads it as day/month', () => {
    const file = one('03/04/2026')
    expect(file.rows[0]!.date).toBe('2026-04-03')
    expect(file.warnings.join(' ')).toMatch(/ambiguous/)
  })

  it('uses the other rows of the file to settle ambiguous dates, without a warning', () => {
    const file = parse(`${HEADER}10/25/2026,a,Food,2.00,EUR,1.00,-1.00\n03/04/2026,b,Food,2.00,EUR,1.00,-1.00\n`)
    expect(file.rows.map((r) => r.date)).toEqual(['2026-10-25', '2026-03-04'])
    expect(file.warnings).toEqual([])
  })

  it('rejects impossible dates as row issues', () => {
    const file = one('2026-02-31')
    expect(file.rows).toHaveLength(0)
    expect(file.issues[0]!.message).toMatch(/date/)
  })
})

describe('parseSplitwiseCsv: malformed files', () => {
  it('rejects an empty file', () => {
    const r = parseSplitwiseCsv('   \n')
    expect(r.ok).toBe(false)
  })

  it('rejects text that is not a Splitwise export and says what was expected', () => {
    const r = parseSplitwiseCsv('name,age\nann,3\n')
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) {
      expect(r.message).toMatch(/Splitwise/)
      expect(r.expected).toMatch(/Date, Description, Category, Cost and Currency/)
    }
  })

  it('rejects a header without person columns', () => {
    const r = parseSplitwiseCsv('Date,Description,Category,Cost,Currency\n2026-10-03,x,Food,1.00,EUR\n')
    expect(r.ok).toBe(false)
  })

  it('drops rows it cannot read and reports them with the line number', () => {
    const file = parse(`${HEADER}2026-10-03,ok,Food,2.00,EUR,1.00,-1.00\n2026-10-03,bad cost,Food,two,EUR,1.00,-1.00\n2026-10-03,bad ccy,Food,2.00,EU,1.00,-1.00\n2026-10-03,bad net,Food,2.00,EUR,x,-1.00\nnot a date,x,Food,2.00,EUR,1.00,-1.00\n`)
    expect(file.rows).toHaveLength(1)
    expect(file.issues.map((i) => i.line)).toEqual([3, 4, 5, 6])
  })

  it('does not throw on binary garbage', () => {
    expect(() => parseSplitwiseCsv('\u0000\u0001\u0002"unterminated')).not.toThrow()
  })
})

describe('parseSplitwiseCsv: real export', () => {
  const file = parse(realCsv)

  it('reads the two people and the blank line after the header', () => {
    expect(file.people).toEqual(['Sam', 'Alex Martin'])
  })

  it('reads 57 data rows and a Total balance row with single-space cells', () => {
    expect(file.rows).toHaveLength(57)
    expect(file.issues).toEqual([])
    expect(file.totals).toEqual([{ line: expect.any(Number), currency: 'CAD', balances: [0, 0] }])
  })

  it('has 3 Payment rows, with the payer positive', () => {
    const payments = file.rows.filter((r) => r.isPayment)
    expect(payments).toHaveLength(3)
    expect(payments[0]).toMatchObject({ description: 'Alex M. paid Sam', nets: [-6541, 6541] })
  })
})
