/**
 * Hindi/Marathi (Devanagari) ↔ Latin matching for catalogue search.
 *
 * Shopkeepers type the same item many ways: "chawal", "chaawal", "chaval", "चावल". We map both scripts
 * to one lossy *phonetic key* (vowel length folded, aspirates dropped, w→v, sh→s …) and index the keys,
 * so every spelling of a word lands on the same trigrams.
 */

const VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ii', 'उ': 'u', 'ऊ': 'uu', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
  'ऍ': 'e', 'ऑ': 'o',
};
const MATRAS: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ii', 'ु': 'u', 'ू': 'uu', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'e', 'ॉ': 'o',
};
const CONSONANTS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'd', 'ढ़': 'dh', 'फ़': 'f', 'य़': 'y',
};
const NUKTA = '़';
const VIRAMA = '्';
const ANUSVARA = 'ं';
const CHANDRABINDU = 'ँ';
const VISARGA = 'ः';
const DIGITS = '०१२३४५६७८९';

export function hasDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

type Unit =
  | { kind: 'consonant'; sound: string; vowel: string | null; inherent: boolean }
  | { kind: 'other'; text: string };

/**
 * Devanagari → rough Latin (ITRANS-like). Applies the Hindi schwa-deletion rule right to left: an inherent
 * 'a' is dropped when it follows a vowel and the next consonant is itself followed by a vowel
 * (कमला → kamlaa, अगरबत्ती → agarbattii), and always at word end (चावल → chaaval).
 */
export function devanagariToLatin(text: string): string {
  return text.normalize('NFC').split(/(\s+)/).map(wordToLatin).join('');
}

function wordToLatin(word: string): string {
  const chars = Array.from(word);
  const units: Unit[] = [];
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i]!;
    if (chars[i + 1] === NUKTA) {
      ch = ch + NUKTA;
      i += 1;
    }
    const consonant = CONSONANTS[ch];
    if (consonant !== undefined) {
      const next = chars[i + 1];
      if (next === VIRAMA) {
        units.push({ kind: 'consonant', sound: consonant, vowel: null, inherent: false });
        i += 1;
      } else if (next !== undefined && next in MATRAS) {
        units.push({ kind: 'consonant', sound: consonant, vowel: MATRAS[next]!, inherent: false });
        i += 1;
      } else {
        units.push({ kind: 'consonant', sound: consonant, vowel: 'a', inherent: true });
      }
      continue;
    }
    const digit = DIGITS.indexOf(ch);
    if (digit >= 0) units.push({ kind: 'other', text: String(digit) });
    else if (ch in VOWELS) units.push({ kind: 'other', text: VOWELS[ch]! });
    else if (ch === ANUSVARA || ch === CHANDRABINDU) units.push({ kind: 'other', text: 'n' });
    else if (ch === VISARGA) units.push({ kind: 'other', text: 'h' });
    else units.push({ kind: 'other', text: ch });
  }
  const hasVowel = (u: Unit | undefined) => u !== undefined && (u.kind === 'other' ? /[aeiou]/.test(u.text) : u.vowel !== null);
  const lastConsonant = units.findLastIndex((u) => u.kind === 'consonant');
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i]!;
    if (u.kind !== 'consonant' || !u.inherent) continue;
    if (i === lastConsonant && i === units.length - 1 && i > 0) {
      u.vowel = null;
      continue;
    }
    const prev = units[i - 1];
    const next = units[i + 1];
    if (i > 0 && hasVowel(prev) && next?.kind === 'consonant' && hasVowel(next)) u.vowel = null;
  }
  return units.map((u) => (u.kind === 'other' ? u.text : u.sound + (u.vowel ?? ''))).join('');
}

/** Lossy phonetic key: same key for "chawal", "chaawal", "chaval", "चावल". */
export function phoneticKey(word: string): string {
  let s = (hasDevanagari(word) ? devanagariToLatin(word) : word).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^a-z0-9]/g, '');
  s = s
    .replace(/ksh/g, 'ks')
    .replace(/chh/g, 'c')
    .replace(/ch/g, 'c')
    .replace(/sh/g, 's')
    .replace(/ph/g, 'f')
    .replace(/([kgjtdbp])h/g, '$1')
    .replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/q/g, 'k')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/x/g, 'ks')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/ou/g, 'au')
    .replace(/(?<=[a-z])y$/g, 'i')
    .replace(/([a-z])\1+/g, '$1');
  return s;
}

/** Common kirana vocabulary: English ↔ Hindi (romanised) synonyms so "rice" finds "chawal" and vice versa. */
export const SYNONYMS: readonly (readonly string[])[] = [
  ['rice', 'chawal'], ['wheat', 'gehun'], ['flour', 'atta'], ['refined flour', 'maida'], ['semolina', 'suji', 'rava', 'rawa'],
  ['lentil', 'dal', 'daal'], ['pigeon pea', 'toor', 'arhar', 'tuvar'], ['chickpea', 'chana'], ['gram flour', 'besan'],
  ['kidney bean', 'rajma'], ['sugar', 'chini', 'shakkar'], ['jaggery', 'gud', 'gur'], ['salt', 'namak'], ['oil', 'tel'],
  ['clarified butter', 'ghee', 'ghi'], ['butter', 'makhan'], ['milk', 'doodh', 'dudh'], ['curd', 'dahi'], ['cheese', 'paneer'],
  ['tea', 'chai', 'chaay'], ['tea leaves', 'chai patti', 'chaipatti'], ['coffee', 'kaafi'], ['turmeric', 'haldi'],
  ['chilli', 'mirch', 'mirchi'], ['coriander', 'dhaniya', 'dhania'], ['cumin', 'jeera', 'jira'], ['mustard', 'sarson', 'rai'],
  ['fenugreek', 'methi'], ['cardamom', 'elaichi', 'ilaychi'], ['clove', 'laung', 'lavang'], ['cinnamon', 'dalchini'],
  ['black pepper', 'kali mirch'], ['asafoetida', 'hing', 'heeng'], ['garam masala', 'masala'], ['soap', 'sabun'],
  ['detergent', 'surf', 'washing powder'], ['toothpaste', 'manjan'], ['matchbox', 'machis', 'maachis'], ['candle', 'mombatti'],
  ['biscuit', 'biskut'], ['noodles', 'maggi'], ['potato', 'aloo', 'alu'], ['onion', 'pyaz', 'pyaaz', 'kanda'], ['garlic', 'lehsun', 'lasun'],
  ['ginger', 'adrak'], ['tomato', 'tamatar'], ['egg', 'anda'], ['bread', 'double roti', 'pav'], ['peanut', 'moongfali', 'shengdana'],
  ['poha', 'flattened rice', 'chivda'], ['vermicelli', 'sevai', 'seviyan'], ['papad', 'papadum'], ['pickle', 'achar', 'achaar'],
  ['incense', 'agarbatti'], ['broom', 'jhadu'], ['bucket', 'balti'], ['tamarind', 'imli'], ['raisin', 'kishmish'], ['cashew', 'kaju'],
  ['almond', 'badam'], ['dry coconut', 'khopra', 'copra'], ['coconut', 'nariyal'], ['sago', 'sabudana'],
  ['medicine', 'dawai', 'dawa'], ['tablet', 'goli'], ['paracetamol', 'crocin', 'dolo'], ['bandage', 'patti'],
];

const synonymIndex: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const group of SYNONYMS) {
    const keys = group.map((w) => w.split(/\s+/).map(phoneticKey).join(' '));
    for (const k of keys) map.set(k, Array.from(new Set([...(map.get(k) ?? []), ...keys.filter((x) => x !== k)])));
  }
  return map;
})();

export function synonymsOf(key: string): string[] {
  return synonymIndex.get(key) ?? [];
}

/**
 * Text stored in item.translit: phonetic keys of every word in the English and Hindi names plus their
 * synonyms, each prefixed with '^' so 2-letter word-start queries still produce a 3-char trigram.
 */
export function buildSearchKeys(name: string, nameHi = ''): string {
  const words = `${name} ${nameHi}`.split(/[\s/,()+\-_.]+/).filter(Boolean);
  const keys = new Set<string>();
  const add = (k: string) => {
    if (k) keys.add(k);
  };
  const plain = words.map(phoneticKey).filter(Boolean);
  plain.forEach(add);
  for (let i = 0; i < plain.length; i++) {
    for (const syn of synonymsOf(plain[i]!)) syn.split(' ').forEach(add);
    if (i + 1 < plain.length) for (const syn of synonymsOf(`${plain[i]} ${plain[i + 1]}`)) syn.split(' ').forEach(add);
  }
  return Array.from(keys, (k) => `^${k}`).join(' ');
}

export function nameSortKey(name: string): string {
  return phoneticKey(name.split(/\s+/)[0] ?? '') + ' ' + name.toLowerCase();
}

export type SearchPlan =
  | { kind: 'barcode'; code: string }
  | { kind: 'fts'; match: string }
  | { kind: 'prefix'; from: string; to: string }
  | { kind: 'empty' };

const FTS_SAFE = /["]/g;

/**
 * Turns what the cashier typed into a query plan:
 * - 6+ digit numbers → exact barcode lookup
 * - otherwise an FTS5 trigram expression: every token must match (AND), and a token matches if its raw
 *   text OR its phonetic key appears (2-letter tokens match word starts via the '^' marker)
 * - a query too short for a trigram ("t", "gh") → prefix scan on name_key (phonetic key of the first word)
 */
export function planSearch(input: string): SearchPlan {
  const q = input.trim();
  if (!q) return { kind: 'empty' };
  if (/^\d{6,14}$/.test(q)) return { kind: 'barcode', code: q };
  const tokens = q.split(/\s+/).filter(Boolean);
  const clauses: string[] = [];
  for (const token of tokens) {
    const alternatives = new Set<string>();
    const raw = token.toLowerCase().replace(FTS_SAFE, '');
    const key = phoneticKey(token);
    if (Array.from(raw).length >= 3) alternatives.add(raw);
    if (key.length >= 3) alternatives.add(key);
    if (key.length >= 1 && key.length <= 2) alternatives.add(`^${key}`);
    for (const syn of synonymsOf(key)) if (!syn.includes(' ') && syn.length >= 2) alternatives.add(syn.length >= 3 ? syn : `^${syn}`);
    const usable = [...alternatives].filter((a) => Array.from(a).length >= 3);
    if (usable.length === 0) continue;
    clauses.push(usable.length === 1 ? `"${usable[0]}"` : `(${usable.map((a) => `"${a}"`).join(' OR ')})`);
  }
  if (clauses.length === 0) {
    const k = phoneticKey(tokens[0] ?? '') || (tokens[0] ?? '').toLowerCase();
    if (!k) return { kind: 'empty' };
    return { kind: 'prefix', from: k, to: k.slice(0, -1) + String.fromCharCode(k.charCodeAt(k.length - 1) + 1) };
  }
  return { kind: 'fts', match: clauses.join(' AND ') };
}
