// src/filters.js
// Utilities + constants for filtering cards (no Tailwind, framework-agnostic).

export const TYPE_OPTIONS = ['Any Type', 'Unit', 'Event', 'Ability', 'Support', 'Shield'];
export const RARITY_OPTIONS = ['Any Rarity', 'Basic', 'Common', 'Uncommon', 'Rare', 'Ultra Rare'];
export const ELEMENT_OPTIONS = [
    'Any Element',
    'Neutral', 'Earth', 'Fire', 'Nature', 'Storm', 'Water', 'Toxic', 'Void', 'Ice', 'Synthetic'
];

export const DEFAULT_FILTERS = {
  q: '',
  type: 'Any Type',
  rarity: 'Any Rarity',
  element: 'Any Element',
  costContains: '',
  ccMin: '',
  ccMax: '',
  atkMin: '',
  defMin: '',
  hpMin: '',
};

const toNumber = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const n = parseFloat(String(v).trim());
  return isNaN(n) ? null : n;
};

const notInElements = (card, element) => {
  const e1 = (card.ElementType1 || '').trim();
  const e2 = (card.ElementType2 || '').trim();
  const e3 = (card.ElementType3 || '').trim();
  return e1 !== element && e2 !== element && e3 !== element;
};

export function matchesFilters(card, f) {
  // text query against CardName + CardText + Cost
  const q = (f.q || '').toLowerCase().trim();
  if (q) {
    const hay = `${card.CardName || ''} ${card.CardText || ''} ${card.Cost || ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }

  // exact match filters
  if (f.type && f.type !== 'Any Type') {
    if ((card.CardType || '') !== f.type) return false;
  }
  if (f.rarity && f.rarity !== 'Any Rarity') {
    if ((card.Rarity || '') !== f.rarity) return false;
  }
  if (f.element && f.element !== 'Any Element') {
    if (notInElements(card, f.element)) return false;
  }

  // cost string contains
  const costSub = (f.costContains || '').trim();
  if (costSub) {
    if (!(card.Cost || '').toString().includes(costSub)) return false;
  }

  // ConvertedCost range
  const cc = toNumber(card.ConvertedCost);
  const ccMin = toNumber(f.ccMin);
  const ccMax = toNumber(f.ccMax);
  if (ccMin !== null && (cc === null || cc < ccMin)) return false;
  if (ccMax !== null && (cc === null || cc > ccMax)) return false;

  // stat minimums (treat blanks or "X" as 0)
  const coerceStat = (v) => {
    const n = toNumber(v);
    if (n === null) return 0;
    return n;
  };
  const atk = coerceStat(card.ATK);
  const deff = coerceStat(card.DEF);
  const hp = coerceStat(card.HP);

  const atkMin = toNumber(f.atkMin);
  const defMin = toNumber(f.defMin);
  const hpMin = toNumber(f.hpMin);

  if (atkMin !== null && atk < atkMin) return false;
  if (defMin !== null && deff < defMin) return false;
  if (hpMin !== null && hp < hpMin) return false;

  return true;
}