import { buildSearchKeys, devanagariToLatin, phoneticKey, planSearch } from '../src/translit';

describe('devanagariToLatin', () => {
  it.each([
    ['चावल', 'chaaval'],
    ['नमक', 'namak'],
    ['कमला', 'kamlaa'],
    ['अगरबत्ती', 'agarbattii'],
    ['हल्दी', 'haldii'],
    ['दालचीनी', 'daalchiinii'],
    ['घी', 'ghii'],
    ['साबुन', 'saabun'],
    ['तेल १ लीटर', 'tel 1 liitar'],
  ])('%s → %s', (hi, latin) => expect(devanagariToLatin(hi)).toBe(latin));
});

describe('phoneticKey', () => {
  it('maps spelling variants and scripts to one key', () => {
    const groups = [
      ['chawal', 'chaawal', 'chaval', 'चावल'],
      ['ghee', 'ghi', 'घी'],
      ['atta', 'aata', 'आटा'],
      ['shakkar', 'sakar', 'शक्कर'],
      ['haldi', 'haldee', 'हल्दी'],
      ['sabun', 'saabun', 'साबुन'],
      ['moong', 'mung', 'मूंग'],
    ];
    for (const g of groups) {
      const keys = new Set(g.map(phoneticKey));
      expect([g, [...keys]]).toEqual([g, [phoneticKey(g[0]!)]]);
    }
  });
});

describe('buildSearchKeys', () => {
  it('indexes keys of both names plus synonyms with word-start markers', () => {
    const keys = buildSearchKeys('India Gate Basmati Rice 1kg', 'बासमती चावल');
    expect(keys).toContain('^basmati');
    expect(keys.split(' ')).toContain('^xaval');
    expect(keys.split(' ')).toContain('^rise');
  });
});

describe('planSearch', () => {
  it('routes long digit strings to barcode lookup', () => {
    expect(planSearch('8901030865278')).toEqual({ kind: 'barcode', code: '8901030865278' });
  });
  it('builds an AND of per-token alternatives', () => {
    const plan = planSearch('chawal 5kg');
    expect(plan.kind).toBe('fts');
    if (plan.kind === 'fts') {
      
      expect(plan.match).toContain('"xaval"');
      expect(plan.match).toContain('"rise"');
      expect(plan.match).toContain(' AND "5kg"');
    }
  });
  it('uses the word-start marker for two-letter tokens', () => {
    expect(planSearch('da')).toEqual({ kind: 'fts', match: '"^da"', clauses: [['^da']] });
  });
  it('falls back to a phonetic prefix scan when no trigram is possible', () => {
    expect(planSearch('gh')).toEqual({ kind: 'prefix', from: 'g', to: 'h' });
  });
  it('falls back to a prefix scan for one letter and ignores empty input', () => {
    expect(planSearch('t')).toEqual({ kind: 'prefix', from: 't', to: 'u' });
    expect(planSearch('   ')).toEqual({ kind: 'empty' });
  });
  it('never produces FTS syntax from user quotes', () => {
    const plan = planSearch('ab"c OR x');
    if (plan.kind === 'fts') expect(plan.match.split('"').length % 2).toBe(1);
  });
});
