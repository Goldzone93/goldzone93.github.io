// /src/plugins/playtest-board-modules.jsx
import React from 'react';
import { CardZoom } from './card-zoom.jsx';

/**
 * InflictDamageModal
 * Extracted from playtest-board.jsx to keep that file smaller.
 * Props:
 *  - slotKey
 *  - onClose()
 *  - getCardId(key) -> id string
 *  - getSlotSide(key) -> 'a' | 'b'
 *  - counters: object map of slotKey -> { counterId: number }
 *  - setCounters(fn)
 *  - dataMaps: { cardsById, partnersById, tokensById } (Map or plain object)
 */
export function InflictDamageModal({
  slotKey,
  onClose,
  getCardId,
  getSlotSide,
  counters = {},
  setCounters,
  dataMaps
}) {
  // Dropdown options + element matchup map
  const [elems, setElems] = React.useState([]);                  // from reference.json -> Element
  const [strongMap, setStrongMap] = React.useState(new Map());   // DisplayName -> Set(strongAgainst)

  // Damage Source (amount + up to 3 elements)
  const [srcAmt, setSrcAmt] = React.useState(1);
  const [srcEl, setSrcEl] = React.useState(['', '', '']);

  // Target (shields + DEF + up to 3 elements)
  const targetId = getCardId?.(slotKey) || '';
  const [tShields, setTShields] = React.useState(0);
  const [tDef, setTDef] = React.useState(0);
  const [tEl, setTEl] = React.useState(['', '', '']);

  // Advantage / Modifier
  const [adv, setAdv] = React.useState(0);
  const [mod, setMod] = React.useState(0);

  // Load dropdown list + strong-against data
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [ref, elements] = await Promise.all([
          fetch('/reference.json', { cache: 'no-store' }).then(r => r.json()),
          fetch('/elements.json', { cache: 'no-store' }).then(r => r.json()),
        ]);
        if (!alive) return;

        const elList = Array.isArray(ref?.Element) ? ref.Element : [];
        setElems(elList);

        const map = new Map();
        for (const e of (elements || [])) {
          const name = e?.DisplayName;
          const wins = String(e?.StrongAgainst || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
          if (name) map.set(name, new Set(wins));
        }
        setStrongMap(map);
      } catch {/* ignore */}
    })();
    return () => { alive = false; };
  }, []);

  const findTargetRecord = React.useCallback(() => {
    const maps = dataMaps || {};
    const getFrom = (m, k) => (m?.get?.(k) ?? m?.[k] ?? null);

    const base = String(getCardId?.(slotKey) || '').replace(/_(a|b)$/i, '');
    const side = typeof getSlotSide === 'function' ? (getSlotSide(slotKey) || 'a') : 'a';

    const candidates = [
      base + '_' + side,            // prefer the live face
      String(getCardId?.(slotKey) || ''),
      base + '_a',
      base + '_b',
    ];

    for (const k of candidates) {
      const hit = getFrom(maps.cardsById, k)
        || getFrom(maps.tokensById, k)
        || getFrom(maps.partnersById, k);
      if (hit) return hit;
    }
    return null;
  }, [dataMaps, slotKey, getCardId, getSlotSide]);

  // Defaults for shields / DEF pulled from current target + counters
  React.useEffect(() => {
    const c = (counters && counters[slotKey]) || {};
    const defNum = (val) => {
      const n = Number(val);
      return Number.isFinite(n) ? n : 0;
    };

    setTShields(defNum(c['shieldcount_k'] || 0));

    const rec = findTargetRecord();

    setTDef(defNum(rec?.DEF));

    const normEl = (v) => (typeof v === 'string' && v.trim()) ? v.trim() : '';
    setTEl([
      normEl(rec?.ElementType1),
      normEl(rec?.ElementType2),
      normEl(rec?.ElementType3),
    ]);
  }, [slotKey, targetId, counters, dataMaps, findTargetRecord]);

  // Auto-advantage: set once when elements are chosen; user edits override
  const [advWasAuto, setAdvWasAuto] = React.useState(true);
  React.useEffect(() => {
    if (!advWasAuto) return;
    const src = new Set(srcEl.filter(Boolean));
    const tgt = new Set(tEl.filter(Boolean));
    if (!src.size || !tgt.size) { setAdv(0); return; }
    let win = false;
    for (const s of src) {
      const strong = strongMap.get(s) || new Set();
      for (const t of tgt) { if (strong.has(t)) { win = true; break; } }
      if (win) break;
    }
    setAdv(win ? 1 : 0);
  }, [srcEl, tEl, strongMap, advWasAuto]);

  const parseNonNegInt = (v, fallback = 0) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const onConfirm = () => {
    const dmgSrc = parseNonNegInt(srcAmt, 1);
    const defVal = parseNonNegInt(tDef, 0);
    const advVal = parseNonNegInt(adv, 0);
    const modVal = parseNonNegInt(mod, 0);

    let dmg = (dmgSrc - defVal) + advVal + modVal;
    if (dmg < 0) dmg = 0;

    const shields = parseNonNegInt(tShields, 0);
    const prevented = Math.min(shields, dmg);
    const applied = dmg - prevented;

    setCounters(prev => {
      const cur = { ...(prev || {}) };
      const row = { ...(cur[slotKey] || {}) };

      const dmgOld = parseNonNegInt(row['damage_k'] || 0);
      const shOld = parseNonNegInt(row['shieldcount_k'] || 0);

      row['damage_k'] = dmgOld + applied;
      row['shieldcount_k'] = Math.max(0, shOld - prevented);

      cur[slotKey] = row;
      return cur;
    });

    onClose?.();
  };

  const onReset = () => {
    const toNum = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
    const c = (counters && counters[slotKey]) || {};

    // reset basic fields
    setSrcAmt(1);
    setSrcEl(['', '', '']);
    setTEl(['', '', '']);
    setAdv(0);
    setMod(0);
    setAdvWasAuto(true);

    // reset from current target/counters
    setTShields(toNum(c['shieldcount_k'] || 0));

    const rec = findTargetRecord();

    setTDef(toNum(rec?.DEF));

    const normEl = (v) => (typeof v === 'string' && v.trim()) ? v.trim() : '';
    setTEl([
      normEl(rec?.ElementType1),
      normEl(rec?.ElementType2),
      normEl(rec?.ElementType3),
    ]);
  };

  return (
    <div className="pb-modal pb-damage" role="dialog" aria-modal="true" aria-label="Inflict Damage">
      <div className="pb-modal-content pb-damage-modal">
        <div className="pb-modal-header">
          <div className="pb-modal-title">Inflict Damage</div>
          <div className="pb-modal-actions">
            <button className="tips-btn" onClick={onConfirm}>Confirm</button>
            <button className="tips-btn" onClick={onClose}>Cancel</button>
          </div>
        </div>

        {/* Four groups laid out to match the mockup */}
        <div className="dm-grid">
          {/* Damage Source */}
          <section className="dm-card">
            <div className="dm-title">Damage Source</div>
            <div className="dm-subhead two"><span>Amount</span><span>Text Input</span></div>
            <div className="dm-row one">
              <input
                className="pb-search-input"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="Amount"
                value={srcAmt}
                onChange={(e) => setSrcAmt(e.target.value)}
              />
            </div>
            <div className="dm-el-list">
              {[0, 1, 2].map(i => (
                <select
                  key={i}
                  className="format-select"
                  value={srcEl[i] || ''}
                  onChange={(e) => {
                    const next = [...srcEl];
                    next[i] = e.target.value;
                    setSrcEl(next);
                  }}
                  title={`Source Element #${i + 1}`}
                >
                  <option value="">Any Element</option>
                  {elems.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              ))}
            </div>
          </section>

          {/* Target */}
          <section className="dm-card">
            <div className="dm-title">Target</div>
            <div className="dm-subhead two"><span>Shields</span><span>DEF Value</span></div>
            <div className="dm-row two">
              <input
                className="pb-search-input"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="Shields"
                value={tShields}
                onChange={(e) => setTShields(e.target.value)}
                title="Target shields (defaults from counters)"
              />
              <input
                className="pb-search-input"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="DEF Value"
                value={tDef}
                onChange={(e) => setTDef(e.target.value)}
                title="Target DEF (defaults from card data)"
              />
            </div>
            <div className="dm-el-list">
              {[0, 1, 2].map(i => (
                <select
                  key={i}
                  className="format-select"
                  value={tEl[i] || ''}
                  onChange={(e) => {
                    const next = [...tEl];
                    next[i] = e.target.value;
                    setTEl(next);
                  }}
                  title={`Target Element #${i + 1}`}
                >
                  <option value="">Any Element</option>
                  {elems.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              ))}
            </div>
          </section>

          {/* Advantage */}
          <section className="dm-card">
            <div className="dm-title">Advantage</div>
            <div className="dm-subhead one"><span>Text Value/Input</span></div>
            <div className="dm-row one">
              <input
                className="pb-search-input"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="Value"
                value={adv}
                onChange={(e) => { setAdv(e.target.value); setAdvWasAuto(false); }}
                title="Default 1 if source elements are strong against any target elements; else 0"
              />
            </div>
          </section>

          {/* Modifiers */}
          <section className="dm-card">
            <div className="dm-title">Modifiers</div>
            <div className="dm-subhead one"><span>Text Value/Input</span></div>
            <div className="dm-row one">
              <input
                className="pb-search-input"
                type="number"
                inputMode="numeric"
                step="1"
                placeholder="Value"
                value={mod}
                onChange={(e) => setMod(e.target.value)}
              />
            </div>
          </section>
        </div>

        <div className="dm-footer">
          <button className="tips-btn ghost" onClick={onReset}>Reset</button>
        </div>
      </div>
    </div>
  );
}

// ADD below InflictDamageModal in /src/plugins/playtest-board-modules.jsx
export function FetchCardsModal({ onClose, deckRef, setDeckPile, setHand, setPeekCard, peekFrom }) {
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(null);

    // number of criteria (1–5)
    const [count, setCount] = React.useState(0);

    // dropdown datasets
    const [superTypes, setSuperTypes] = React.useState([]);
    const [cardTypes, setCardTypes] = React.useState([]);
    const [subTypes, setSubTypes] = React.useState([]);
    const [elements, setElements] = React.useState([]);

    // cards/tokens/partners by InternalName
    const byIdRef = React.useRef({});

    // criteria array of length `count`
    const [criteria, setCriteria] = React.useState([]);

    // initialize criteria rows when count changes
    React.useEffect(() => {
        setCriteria(Array.from({ length: count }, () => ({
            text: '',
            cc: '',
            superType: '',
            cardType: '',
            subType: '',
            elem1: '',
            elem2: '',
            elem3: '',
        })));
    }, [count]);

    // load all data we need directly from /public
    React.useEffect(() => {
        let aborted = false;
        (async () => {
            try {
                setLoading(true);
                const [cards, tokens, partners, reference] = await Promise.all([
                    fetch('/cards.json', { cache: 'no-store' }).then(r => r.json()),
                    fetch('/tokens.json', { cache: 'no-store' }).then(r => r.json()),
                    fetch('/partners.json', { cache: 'no-store' }).then(r => r.json()),
                    fetch('/reference.json', { cache: 'no-store' }).then(r => r.json()),
                ]);

                if (aborted) return;

                // Build lookup: InternalName -> data
                const all = [...(cards || []), ...(tokens || []), ...(partners || [])];
                const byId = Object.create(null);
                all.forEach(c => {
                    if (c && c.InternalName) byId[String(c.InternalName)] = c;
                });
                byIdRef.current = byId;

                // Pull dropdown lists from reference.json (supports current top-level arrays and legacy "ReferenceData")
                const listOf = (name) => {
                    // Preferred: top-level arrays (current reference.json)
                    if (Array.isArray(reference?.[name])) return [...reference[name]];

                    // Fallback: nested "ReferenceData" sections (legacy shape)
                    const refSection = Array.isArray(reference?.ReferenceData) ? reference.ReferenceData : [];
                    const found = refSection.find(s => String(s?.name ?? s?.section) === name);
                    const items = found?.items || [];
                    return items
                        .map(x => (typeof x === 'string' ? x : (x?.name ?? '')))
                        .filter(Boolean);
                };

                setSuperTypes(listOf('SuperType'));
                setCardTypes(listOf('CardType'));
                setSubTypes(listOf('SubType'));
                setElements(listOf('Element'));

                setError(null);
            } catch (e) {
                setError(e?.message || String(e));
            } finally {
                if (!aborted) setLoading(false);
            }
        })();

        return () => { aborted = true; };
    }, []);

    // update a single criteria row
    const updateCrit = (i, patch) => {
        setCriteria(prev => {
            const next = [...prev];
            next[i] = { ...next[i], ...patch };
            return next;
        });
    };

    // ADD: each Fetch Criteria must have at least one field set (non-default)
    // Defaults are empty string for all fields.
    const critHasAnyValue = React.useCallback((c) => {
        if (!c) return false;
        if (String(c.text || '').trim()) return true;
        if (c.cc !== '' && c.cc != null) return true; // numeric validity checked on confirm
        return !!(c.superType || c.cardType || c.subType || c.elem1 || c.elem2 || c.elem3);
    }, []);

    // ADD: memoized "can confirm" state for the button
    const canConfirm = React.useMemo(() => {
        if (loading) return false;
        if (!count || criteria.length !== count) return false;
        return criteria.every(critHasAnyValue);
    }, [loading, count, criteria, critHasAnyValue]);

    // card matcher
    const matches = (card, crit) => {
        if (!card) return false;

        // 1) Text Input Search Parameter (match InternalName or CardName, case-insensitive)
        const text = String(crit.text || '').trim();
        if (text) {
            const needles = text.split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
            const hayA = String(card.InternalName || '').toLowerCase();
            const hayB = String(card.CardName || '').toLowerCase();
            const ok = needles.some(n => hayA.includes(n) || hayB.includes(n));
            if (!ok) return false;
        }

        // 2) ConvertedCost (exact match if provided)
        if (String(crit.cc ?? '') !== '') {
            const need = Number(crit.cc);
            const have = Number(card.ConvertedCost);
            if (!(Number.isFinite(need) && Number.isFinite(have) && need === have)) return false;
        }

        // 3) Types (must match if provided)
        const sType = String(crit.superType || '').trim();
        const cType = String(crit.cardType || '').trim();
        const subT = String(crit.subType || '').trim();

        if (sType && String(card.SuperType || '').trim() !== sType) return false;
        if (cType && String(card.CardType || '').trim() !== cType) return false;
        if (subT && String(card.SubType || '').trim() !== subT) return false;

        // 4) Elements: card must include all non-empty selected elements
        const el1 = String(crit.elem1 || '').trim();
        const el2 = String(crit.elem2 || '').trim();
        const el3 = String(crit.elem3 || '').trim();
        const want = [el1, el2, el3].filter(Boolean);
        if (want.length) {
            const have = new Set(
                [card.ElementType1, card.ElementType2, card.ElementType3].map(v => String(v || '').trim()).filter(Boolean)
            );
            for (const w of want) { if (!have.has(w)) return false; }
        }

        return true;
    };

    const onConfirm = () => {
        try {
            if (!Array.isArray(criteria) || criteria.length === 0) {
                window.alert('Set the number of criteria first.');
                return;
            }

            // validate CC inputs
            for (const c of criteria) {
                if (c.cc !== '' && (!Number.isFinite(Number(c.cc)) || Number(c.cc) < 0)) {
                    window.alert('ConvertedCost must be a number ≥ 0 (or left blank).');
                    return;
                }
            }

            const deck = (deckRef?.current || []).slice(0); // top is index 0
            const found = [];

            // For each criteria block, find the FIRST matching card, top-down.
            for (const crit of criteria) {
                let pickedIndex = -1;
                for (let i = 0; i < deck.length; i++) {
                    // normalize id to _a (data files use _a entries)
                    const id = String(deck[i] || '').replace(/_(a|b)$/i, '_a');
                    const card = byIdRef.current[id] || null;
                    if (matches(card, crit)) { pickedIndex = i; break; }
                }
                if (pickedIndex !== -1) {
                    const [m] = deck.splice(pickedIndex, 1);
                    found.push(m);
                }
            }

            // Apply moves: add found to hand, shuffle remaining deck
            if (found.length) {
                setHand(prev => [...prev, ...found]);
            }

            // Fisher–Yates shuffle of remaining deck
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }
            setDeckPile(deck);

            // If a matching Deck peek/stack-view is open for this SAME deck, close it.
            setPeekCard(prev => {
                const closeFrom = (typeof peekFrom === 'string') ? peekFrom : 'deck';
                return (prev && prev.from === closeFrom) ? null : prev;
            });

            onClose?.();
        } catch (e) {
            window.alert(`Fetch failed: ${e?.message || e}`);
        }
    };

    return (
        <div className="pb-modal pb-fetch" role="dialog" aria-modal="true" aria-label="Fetch">
            <div className="pb-modal-content fm-content">
                <header className="fm-header">
                    <div className="fm-titlebar">
                        <h3 className="fm-title">Fetch</h3>
                        <select
                            className="fm-select fm-number"
                            value={count || ''}
                            onChange={(e) => setCount(Number(e.target.value) || 0)}
                            title="Number of criteria"
                        >
                            <option value="">Number Dropdown</option>
                            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </div>

                    <div className="fm-actions pb-modal-actions">
                        <button
                            className="tips-btn"
                            onClick={onConfirm}
                            disabled={!canConfirm}
                            title={canConfirm ? 'Confirm' : 'Each criteria needs at least one field set'}
                        >
                            Confirm
                        </button>
                        <button className="tips-btn" onClick={onClose} title="Cancel">
                            Cancel
                        </button>
                    </div>
                </header>

                <div className="fm-body">
                    {loading ? (
                        <div className="pb-empty">Loading…</div>
                    ) : error ? (
                        <div className="pb-empty">Failed to load data: {String(error)}</div>
                    ) : (
                        <>
                            {count > 0 && criteria.map((c, i) => (
                                <section className="fm-card" key={i}>
                                    <div className="fm-card-title">Fetch Criteria {i + 1}</div>

                                    {/* Row 1: text + converted cost */}
                                    <div className="fm-row fm-row-2">
                                        <input
                                            className="fm-input"
                                            placeholder="Text Input Search Parameter"
                                            value={c.text}
                                            onChange={(e) => updateCrit(i, { text: e.target.value })}
                                        />
                                        <input
                                            className="fm-input"
                                            type="number"
                                            inputMode="numeric"
                                            min={0}
                                            step={1}
                                            placeholder="ConvertedCost Input"
                                            value={c.cc}
                                            onChange={(e) => updateCrit(i, { cc: e.target.value })}
                                        />
                                    </div>

                                    {/* Row 2: three type selects + three element selects */}
                                    <div className="fm-row fm-row-6">
                                        <select
                                            className="fm-select"
                                            value={c.superType}
                                            onChange={(e) => updateCrit(i, { superType: e.target.value })}
                                        >
                                            <option value="">Any SuperType</option>
                                            {superTypes.map(x => <option key={x} value={x}>{x}</option>)}
                                        </select>

                                        <select
                                            className="fm-select"
                                            value={c.cardType}
                                            onChange={(e) => updateCrit(i, { cardType: e.target.value })}
                                        >
                                            <option value="">Any CardType</option>
                                            {cardTypes.map(x => <option key={x} value={x}>{x}</option>)}
                                        </select>

                                        <select
                                            className="fm-select"
                                            value={c.subType}
                                            onChange={(e) => updateCrit(i, { subType: e.target.value })}
                                        >
                                            <option value="">Any SubType</option>
                                            {subTypes.map(x => <option key={x} value={x}>{x}</option>)}
                                        </select>

                                        <select
                                            className="fm-select"
                                            value={c.elem1}
                                            onChange={(e) => updateCrit(i, { elem1: e.target.value })}
                                        >
                                            <option value="">Any Element</option>
                                            {elements.map(x => <option key={x} value={x}>{x}</option>)}
                                        </select>

                                        <select
                                            className="fm-select"
                                            value={c.elem2}
                                            onChange={(e) => updateCrit(i, { elem2: e.target.value })}
                                        >
                                            <option value="">Any Element</option>
                                            {elements.map(x => <option key={x} value={x}>{x}</option>)}
                                        </select>

                                        <select
                                            className="fm-select"
                                            value={c.elem3}
                                            onChange={(e) => updateCrit(i, { elem3: e.target.value })}
                                        >
                                            <option value="">Any Element</option>
                                            {elements.map(x => <option key={x} value={x}>{x}</option>)}
                                        </select>
                                    </div>
                                </section>
                            ))}
                            {!count && <div className="pb-empty">Select the number of criteria above.</div>}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ADD below the existing exports in /src/plugins/playtest-board-modules.jsx
export function HealModal({ slotKey, x, damage, statuses, onConfirm, onClose }) {
    const [removeDamage, setRemoveDamage] = React.useState(Math.min(x || 0, damage || 0));
    const [statusId, setStatusId] = React.useState(statuses?.[0]?.id || '');

    const maxDamage = Math.min(Number(x || 0), Number(damage || 0));

    const submit = () => {
        onConfirm?.({ slotKey, removeDamage: Math.max(0, Math.min(removeDamage, maxDamage)), statusId: statusId || null });
    };

    return (
        <div className="pb-modal" role="dialog" aria-modal="true" aria-label="Heal X">
            <div className="pb-modal-content pb-heal-modal">
                <div className="pb-modal-header">
                    <div className="pb-modal-title">Heal</div>
                    <div className="pb-modal-actions">
                        <button className="tips-btn" onClick={submit}>Confirm</button>
                        <button className="tips-btn" onClick={onClose}>Cancel</button>
                    </div>
                </div>

                <div className="pb-heal-form">
                    <label className="pb-row-label">Damage</label>
                    <input
                        className="pb-search-input heal-qty"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max={maxDamage}
                        step="1"
                        value={removeDamage}
                        onChange={(e) => setRemoveDamage(Math.max(0, Math.min(Number(e.target.value || 0), maxDamage)))}
                        title={`Remove up to ${maxDamage} damage counters`}
                    />

                    <label className="pb-heal-pair">
                        <span className="pb-row-label">Status</span>
                        <select
                            className="format-select"
                            value={statusId}
                            onChange={(e) => setStatusId(e.target.value)}
                            title="Remove up to one status counter"
                        >
                            {statuses?.map(s => (
                                <option key={s.id} value={s.id}>{s.name} ×{s.n}</option>
                            ))}
                            {statuses?.length ? <option value="">— none —</option> : null}
                        </select>
                    </label>

                    <div className="pb-heal-note">
                        <em>You may remove up to {x} damage counters and up to one status counter.</em>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ADD below the existing exports in /src/plugins/playtest-board-modules.jsx
export function StatModifyModal({ slotKey, initial = { stat: 'ATK', op: '+', amount: 1 }, onConfirm, onClose }) {
    const [stat, setStat] = React.useState(initial.stat || 'ATK');
    const [op, setOp] = React.useState(initial.op || '+');
    const [amount, setAmount] = React.useState(
        Number.isFinite(initial.amount) ? initial.amount : 1
    );

    const submit = () => {
        const n = Math.max(0, Math.floor(Number(amount) || 0));
        onConfirm?.({ slotKey, stat, op, amount: n });
    };

    return (
        <div className="pb-modal" role="dialog" aria-modal="true" aria-label="Modify Stat">
            <div className="pb-modal-content pb-stat-modal">
                <div className="pb-modal-header">
                    <div className="pb-modal-title">Modify Stat</div>
                    <div className="pb-modal-actions">
                        <button className="tips-btn" onClick={submit}>Confirm</button>
                        <button className="tips-btn" onClick={onClose}>Cancel</button>
                    </div>
                </div>

                <div className="pb-stat-form">
                    <select
                        className="format-select"
                        value={stat}
                        onChange={(e) => setStat(e.target.value)}
                    >
                        <option>ATK</option>
                        <option>DEF</option>
                        <option>HP</option>
                    </select>

                    <select
                        className="format-select"
                        value={op}
                        onChange={(e) => setOp(e.target.value)}
                    >
                        <option value="+">+</option>
                        <option value="−">−</option>
                    </select>

                    <input
                        className="pb-search-input"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        placeholder="Number Input"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                    />
                </div>
            </div>
        </div>
    );
}

// local helpers (avoids cross-file deps)
const FALLBACK_IMG = {
    a: '/images/card0000_a.png',
    b: '/images/card0000_b.png',
};
const ensureFrontId = (id) => `${String(id || '').replace(/_(a|b)$/i, '')}_a`;
function imgAlt(type, internalName, side = 'a') {
    return `${type}:${internalName}:${side}`;
}
function onImgError(type, internalName, side = 'a') {
    return (e) => {
        e.currentTarget.onerror = null;
        const fallback = side === 'b' ? FALLBACK_IMG.b : FALLBACK_IMG.a;
        // optional noise-free fallback
        try {
            const badSrc = e.currentTarget.src;
            // eslint-disable-next-line no-console
            console.warn('[MulliganModal] missing image → fallback', { type, internalName, side, badSrc, fallback });
        } catch { }
        e.currentTarget.src = fallback;
    };
}

export function MulliganModal({ deckPile, setDeckPile, counts, cardsById, imgSrc, onClose, onKeep }) {
    const [startSize, setStartSize] = React.useState(7);
    const [cap, setCap] = React.useState(2);
    const [capLocked, setCapLocked] = React.useState(false);
    const [mulls, setMulls] = React.useState(0);
    const [selectedId, setSelectedId] = React.useState('');
    const [selectedQty, setSelectedQty] = React.useState(1);
    const [hand, setHand] = React.useState([]);
    const [keepSet, setKeepSet] = React.useState(new Set());
    const [hasDrawn, setHasDrawn] = React.useState(false);
    const [keepAny, setKeepAny] = React.useState(false); // false = Shields Only (default)

    const inc = (setter, v = 1) => setter(x => x + v);
    const dec = (setter, v = 1) => setter(x => Math.max(0, x - v));
    const qtyMax = selectedId ? (counts.get(selectedId) || 0) : 1;

    const isShield = (id) => {
        const c = cardsById.get?.(id) || cardsById[id];
        return String(c?.CardType || '').toLowerCase() === 'shield';
    };

    const canKeep = (id) => keepAny || isShield(id);

    const toggleKeep = (i) => {
        const id = hand[i];
        if (!canKeep(id)) return;
        setKeepSet(prev => {
            const n = new Set(prev);
            if (n.has(i)) n.delete(i); else n.add(i);
            return n;
        });
    };

    // Draw: selected cards first, then from top of deck to reach startSize
    const onDraw = () => {
        if (hasDrawn) return; // already drew once — do nothing
        let deck = [...deckPile];
        const want = selectedId ? Math.min(selectedQty, deck.filter(id => id === selectedId).length) : 0;

        let pulled = [];
        if (want > 0) {
            let need = want;
            const next = [];
            for (const id of deck) {
                if (id === selectedId && need > 0) { pulled.push(id); need--; }
                else { next.push(id); }
            }
            deck = next;
        }
        const needMore = Math.max(0, startSize - pulled.length);
        pulled = pulled.concat(deck.slice(0, needMore));
        deck = deck.slice(needMore);

        setDeckPile(deck);
        setHand(pulled);
        setKeepSet(new Set());
        setCapLocked(true);     // lock Mulligan Cap after first Draw
        setHasDrawn(true);
    };

    // Mulligan: keep selected Shield cards, shuffle the rest back, then draw to startSize
    const onMull = () => {
        if (mulls >= cap) return;
        const kept = hand.filter((_, i) => keepSet.has(i) && canKeep(hand[i]));
        const toShuffle = hand.filter((_, i) => !(keepSet.has(i) && canKeep(hand[i])));

        let deck = [...deckPile, ...toShuffle];
        // Fisher–Yates shuffle
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        const need = Math.max(0, startSize - kept.length);
        const drawn = deck.slice(0, need);
        deck = deck.slice(need);

        setDeckPile(deck);
        setHand([...kept, ...drawn]);
        setKeepSet(new Set());
        setMulls(m => m + 1);
    };

    const onKeepClick = () => {
        onKeep(hand);  // commit to board Hand area
        onClose();
    };

    const options = Array.from(counts?.entries?.() || [], ([id, n]) => ({ id, n }))
        .sort((a, b) => (a.id > b.id ? 1 : -1));

    const confirmClose = () => {
        const ok = window.confirm(
            'Close the mulligan window?\n\nYour current hand and mulligan choices will be discarded.'
        );
        if (ok) onClose();
    };

    return (
        <div className="pb-modal" role="dialog" aria-modal="true" aria-label="Mulligan">
            <div className="pb-modal-content">
                <div className="pb-modal-header">
                    <div className="pb-modal-title">Starting Hand & Mulligans</div>
                    <button className="tips-btn" onClick={confirmClose} title="Close">Close</button>
                </div>

                <div className="pb-mull-controls">
                    <div className="pb-form-row">
                        <div className="pb-row-label">Starting Hand Size</div>
                        <div className="pb-mini-counter" role="group" aria-label="Starting Hand Size">
                            <button className="pb-btn" onClick={() => dec(setStartSize)} disabled={hasDrawn && startSize <= hand.length}>−</button>
                            <output className="hp-display">{startSize}</output>
                            <button className="pb-btn" onClick={() => inc(setStartSize)} disabled={hasDrawn}>+</button>
                        </div>
                    </div>

                    <div className="pb-form-row">
                        <div className="pb-row-label">Mulligan Cap</div>
                        <div className="pb-mini-counter" role="group" aria-label="Mulligan Cap">
                            <button className="pb-btn" onClick={() => dec(setCap)} disabled={capLocked || cap <= 0}>−</button>
                            <output className="hp-display">{cap}</output>
                            <button className="pb-btn" onClick={() => inc(setCap)} disabled={capLocked}>+</button>
                        </div>
                        <div className="pb-mull-tracker">Mulligans: {mulls} / {cap} · Kept: {Array.from(keepSet).length}</div>
                    </div>

                    <div className="pb-form-row pb-cardselect-row">
                        <div className="pb-row-label">Card Selector</div>

                        {/* Keep the selector and its quantity controller together */}
                        <div className="pb-cardselect">
                            <select
                                className="format-select"
                                value={selectedId}
                                onChange={(e) => { setSelectedId(e.target.value); setSelectedQty(1); }}
                                disabled={hasDrawn}
                            >
                                <option value="">— no selection —</option>
                                {options.map(({ id, n }) => {
                                    const c = (cardsById.get?.(id) || cardsById[id]) || null;
                                    const name = c?.CardName || id; // fallback only if CardName missing
                                    return (
                                        <option key={id} value={id}>
                                            {name} ×{n}
                                        </option>
                                    );
                                })}
                            </select>

                            <div className="pb-mini-counter" aria-label="Selected quantity">
                                <button className="pb-btn" onClick={() => setSelectedQty(q => Math.max(1, q - 1))} disabled={hasDrawn || !selectedId}>−</button>
                                <output className="hp-display">{selectedQty}</output>
                                <button className="pb-btn" onClick={() => setSelectedQty(q => Math.min(q + 1, qtyMax))} disabled={hasDrawn || !selectedId}>+</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="pb-mull-actions" role="group" aria-label="Mulligan Actions">
                    {/* Left-aligned keep policy (locked after Starting Hand) */}
                    <div className="pb-keep-toggles" aria-label="Keep policy">
                        <label className="pb-check" title="Only Shield cards can be kept between mulligans">
                            <input
                                type="checkbox"
                                checked={!keepAny}
                                onChange={() => setKeepAny(false)}
                                disabled={hasDrawn}
                            />
                            <span>Shields Only</span>
                        </label>
                        <label className="pb-check" title="Any card can be kept between mulligans">
                            <input
                                type="checkbox"
                                checked={keepAny}
                                onChange={() => setKeepAny(true)}
                                disabled={hasDrawn}
                            />
                            <span>Any Card</span>
                        </label>
                    </div>
                    <div className="pb-mull-actions-left">
                        <button className="tips-btn" onClick={onDraw} disabled={hasDrawn}>Starting Hand</button>
                        <button className="tips-btn" onClick={onMull} disabled={!hasDrawn || mulls >= cap}>Mulligan</button>
                        <button className="tips-btn" onClick={onKeepClick} disabled={!hasDrawn}>Keep Hand</button>
                    </div>
                </div>

                <div className="pb-mull-hand">
                    {hand.length === 0 ? (
                        <div className="pb-empty">No cards drawn yet.</div>
                    ) : (
                        <div className="pb-hand-cards">
                            {hand.map((id, i) => {
                                const shield = isShield(id);
                                const keepable = canKeep(id); // respects Shields Only vs Any Card

                                return (
                                    <div
                                        key={`${id}-${i}`}
                                        className={`pb-mull-card${keepSet.has(i) && keepable ? ' kept' : ''}${!keepable ? ' noshield' : ''}${keepable ? ' clickable' : ''}`}
                                        onClick={() => { if (keepable) toggleKeep(i); }}
                                        role={keepable ? 'button' : undefined}
                                        aria-pressed={keepable ? keepSet.has(i) : undefined}
                                    >
                                        <CardZoom id={ensureFrontId(id)} name={id} />
                                        <img
                                            className="pb-card-img"
                                            src={imgSrc(id, /_b$/i.test(String(id)) ? 'b' : 'a')}
                                            alt={imgAlt('card', id, /_b$/i.test(String(id)) ? 'b' : 'a')}
                                            onError={onImgError('card', id, /_b$/i.test(String(id)) ? 'b' : 'a')}
                                            draggable="false"
                                        />
                                        <label className="pb-mull-keep" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                checked={keepSet.has(i)}
                                                onChange={() => toggleKeep(i)}
                                                disabled={!keepable}
                                            />
                                            <span>{keepable ? 'Keep' : '—'}</span>
                                        </label>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ↓ Add at the end of the file with the other modal exports
export function AddLabelModal({ slotKey, onConfirm, onClose }) {
    const [text, setText] = React.useState('');

    const submit = () => {
        const trimmed = String(text || '').trim();
        if (!trimmed) return;
        onConfirm?.({ slotKey, text: trimmed });
    };

    return (
        <div className="pb-modal" role="dialog" aria-modal="true" aria-label="Add Label">
            <div className="pb-modal-content pb-stat-modal">
                <div className="pb-modal-header">
                    <div className="pb-modal-title">Add Label</div>
                    <div className="pb-modal-actions">
                        <button className="tips-btn" onClick={submit} disabled={!text.trim()}>Confirm</button>
                        <button className="tips-btn" onClick={onClose}>Cancel</button>
                    </div>
                </div>
                <div className="pb-stat-form">
                    <input
                        className="pb-search-input"
                        type="text"
                        placeholder="Enter label text"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        maxLength={40}
                        title="Label text (shown on the card)"
                    />
                </div>
            </div>
        </div>
    );
}

// ADD below the existing exports in /src/plugins/playtest-board-modules.jsx
export function RemoveLabelModal({ slotKey, labels = [], onConfirm, onClose }) {
    const [selected, setSelected] = React.useState(() => new Set());

    const toggle = (t) => {
        const next = new Set(selected);
        if (next.has(t)) next.delete(t); else next.add(t);
        setSelected(next);
    };

    const submit = () => {
        if (!selected.size) return onClose?.();
        onConfirm?.({ slotKey, remove: Array.from(selected) });
    };

    return (
        <div className="pb-modal" role="dialog" aria-modal="true" aria-label="Remove Label">
            <div className="pb-modal-content pb-stat-modal">
                <div className="pb-modal-header">
                    <div className="pb-modal-title">Remove Label</div>
                    <div className="pb-modal-actions">
                        <button className="tips-btn" onClick={submit} disabled={!selected.size}>Confirm</button>
                        <button className="tips-btn" onClick={onClose}>Cancel</button>
                    </div>
                </div>
                <div className="pb-counters">
                    <div className="pb-modal-body" style={{ display: 'grid', gap: 8 }}>
                        {!labels.length && <div className="pb-empty-state">No labels.</div>}
                        {labels.map((t, i) => (
                            <label key={`${t}_${i}`} className="pb-counter-row">
                                <div className="pb-counter-name">{t}</div>
                                <input
                                    type="checkbox"
                                    checked={selected.has(t)}
                                    onChange={() => toggle(t)}
                                    style={{ marginLeft: 8 }}
                                />
                            </label>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ADD below other exports in /src/plugins/playtest-board-modules.jsx
export function EncounterModal({ onClose, tokens }) {
    const [elements, setElements] = React.useState([]); // [{ id, label, color }]
    const [activeEls, setActiveEls] = React.useState([]);
    const [costActive, setCostActive] = React.useState(() => new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8+']));
    const [generated, setGenerated] = React.useState([]);
    const [cardTypes, setCardTypes] = React.useState([]);
    const [activeTypes, setActiveTypes] = React.useState(['Unit']);

    // local helpers (mirrors the original behavior)
    const hexToRGBA = (hex, alpha = 0.25) => {
        if (!hex) return `rgba(0,0,0,${alpha})`;
        let h = String(hex).trim().replace(/^#/, '');
        if (h.length === 3) {
            const r = parseInt(h[0] + h[0], 16);
            const g = parseInt(h[1] + h[1], 16);
            const b = parseInt(h[2] + h[2], 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };
    const frontOf = (internal) => `/images/${String(internal || '').replace(/_(a|b)$/i, '')}_a.png`;

    // Load CardTypes + Elements (IDs) and colors
    React.useEffect(() => {
        let alive = true;
        Promise.all([
            fetch('/reference.json').then(r => r.json()).catch(() => null),
            fetch('/elements.json').then(r => r.json()).catch(() => null),
        ]).then(([ref, elems]) => {
            if (!alive) return;
            const ct = Array.isArray(ref?.CardType) ? ref.CardType : [];
            setCardTypes(ct.filter((t) => t !== 'Partner'));

            const ids = Array.isArray(ref?.Element) ? ref.Element : [];
            const colorByName = new Map(
                (Array.isArray(elems) ? elems : []).map(e => [e.DisplayName, e.HexColor || '#ffffff'])
            );
            const list = ids.map(name => ({ id: name, label: name, color: colorByName.get(name) || '#ffffff' }));
            setElements(list);
        });
        return () => { alive = false; };
    }, []);

    const toggleEl = (id) => {
        setActiveEls(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleCost = (k) => {
        setCostActive(prev => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k); else next.add(k);
            return next.size ? next : new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8+']);
        });
    };

    const toggleType = (id) => {
        setActiveTypes(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
    };

    const passElement = (t) => {
        if (!activeEls.length) return true;
        const els = [t.ElementType1, t.ElementType2, t.ElementType3].filter(Boolean);
        return els.some(e => activeEls.includes(e));
    };

    const passType = (t) => (!activeTypes.length ? true : activeTypes.includes(t.CardType));

    const passCost = (t) => {
        const cc = Number(t.ConvertedCost ?? NaN);
        if (!Number.isFinite(cc)) return false;
        return (cc >= 0 && cc <= 7 && costActive.has(String(cc))) || (cc >= 8 && costActive.has('8+'));
    };

    const filtered = React.useMemo(() => {
        const pool = (Array.isArray(tokens) ? tokens : []).filter(
            (t) => String(t?.Encounter ?? '').toLowerCase() === 'yes'
        );
        return pool.filter((t) => passType(t) && passElement(t) && passCost(t));
    }, [tokens, activeTypes, activeEls, costActive]);

    const generate = () => {
        const pool = [...filtered];
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        setGenerated(pool.slice(0, 3));
    };

    return (
        <div className="pb-modal" role="dialog" aria-modal="true" aria-label="Encounter Generator">
            <div className="pb-modal-content">
                <div className="pb-modal-header">
                    <div className="pb-modal-title">Encounter Generator</div>
                    <button className="tips-btn" onClick={onClose} title="Close">Close</button>
                </div>

                {/* Controls */}
                <div className="pb-gallery-controls">
                    {/* Card Type toggles (OR) */}
                    <div className="pb-eg-sectionlabel">Card Types</div>
                    <div className="pb-filter-group">
                        {cardTypes.map(ct => (
                            <button
                                key={ct}
                                type="button"
                                className={`pb-filter-chip${activeTypes.includes(ct) ? ' active' : ''}`}
                                onClick={() => toggleType(ct)}
                                title={activeTypes.includes(ct) ? 'Click to remove filter' : 'Click to filter by this type'}
                            >
                                {ct}
                            </button>
                        ))}
                    </div>

                    {/* Element toggles (OR) */}
                    <div className="pb-eg-sectionlabel">Elements</div>
                    <div className="pb-filter-group">
                        {elements.map(el => {
                            const isActive = activeEls.includes(el.id);
                            const bg = hexToRGBA(el.color, isActive ? 0.35 : 0.18);
                            const border = isActive ? el.color : hexToRGBA(el.color, 0.25);
                            return (
                                <button
                                    key={el.id}
                                    type="button"
                                    className={`pb-filter-chip${isActive ? ' active' : ''}`}
                                    onClick={() => toggleEl(el.id)}
                                    title={isActive ? 'Click to remove filter' : 'Click to filter by this element'}
                                    style={{ borderColor: border, backgroundColor: bg }}
                                >
                                    {el.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Cost toggles (0..7, 8+) */}
                    <div className="pb-eg-sectionlabel">Cost (CC)</div>
                    <div className="pb-filter-group">
                        {['0', '1', '2', '3', '4', '5', '6', '7', '8+'].map(k => (
                            <button
                                key={k}
                                type="button"
                                className={`pb-filter-chip${costActive.has(k) ? ' active' : ''}`}
                                onClick={() => toggleCost(k)}
                                title={costActive.has(k) ? 'Click to turn off' : 'Click to turn on'}
                            >
                                {k}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Generate action */}
                <div className="pb-encounter-actions">
                    <button className="tips-btn pb-encounter-generate" onClick={generate}>Generate</button>
                    <div className="pb-encounter-count">
                        {filtered.length} eligible token{filtered.length === 1 ? '' : 's'}
                    </div>
                </div>

                {/* Results */}
                <div className="pb-gallery-grid pb-center-grid">
                    {generated.map((it) => {
                        const internal = it.InternalName || it.internalName || it.id || '';
                        const name = it.CardName ?? it.TokenName ?? it.Name ?? internal;
                        const src = frontOf(internal);
                        const alt = imgAlt('token', internal, 'a');
                        return (
                            <figure
                                key={internal}
                                className="pb-gallery-card"
                                data-menu-area="viewer-card"
                                data-card-id={internal}
                            >
                                <CardZoom id={ensureFrontId(internal)} name={name} />
                                <img
                                    src={src}
                                    alt={alt}
                                    onError={onImgError('token', internal, 'a')}
                                    draggable="false"
                                    loading="lazy"
                                />
                                <figcaption className="pb-gallery-name" title={name}>{name}</figcaption>
                            </figure>
                        );
                    })}
                    {generated.length === 0 && (
                        <div className="pb-empty-state">Click Generate to roll up to 3 tokens.</div>
                    )}
                </div>
            </div>
        </div>
    );
}

export function GalleryModal({ title, items, onClose }) {
    const [query, setQuery] = React.useState('');
    const [elements, setElements] = React.useState([]); // [{name, color}]
    const [activeEls, setActiveEls] = React.useState([]);

    // local copy of image helpers to avoid coupling to playtest-board.jsx
    const IMG = {
        frontOf: (internal) => `/images/${String(internal || '').replace(/_(a|b)$/i, '')}_a.png`,
        backOf: (internal) => `/images/${String(internal || '').replace(/_(a|b)$/i, '')}_b.png`,
        fallbackFront: '/images/card0000_a.png',
        fallbackBack: '/images/card0000_b.png',
    };
    const ensureFrontId = (id) => `${String(id || '').replace(/_(a|b)$/i, '')}_a`;
    function onImgError(type, internalName, side = 'a') {
        return (e) => {
            e.currentTarget.onerror = null;
            const fallback = side === 'b' ? IMG.fallbackBack : IMG.fallbackFront;
            console.warn(
                `[playtest-board] Missing ${type} ${side === 'b' ? 'back' : 'front'} image → using fallback`,
                { type, internalName, side, missing: e.currentTarget.src, fallback }
            );
            e.currentTarget.src = fallback;
        };
    }
    function imgAlt(type, internalName, side = 'a') {
        return `${type}:${internalName}:${side}`;
    }

    // convert "#RRGGBB" (or "#RGB") to rgba(r,g,b,alpha)
    function hexToRGBA(hex, alpha = 0.14) {
        if (!hex) return `rgba(0,0,0,${alpha})`;
        let h = hex.trim();
        if (h[0] === '#') h = h.slice(1);
        if (h.length === 3) {
            const r = parseInt(h[0] + h[0], 16);
            const g = parseInt(h[1] + h[1], 16);
            const b = parseInt(h[2] + h[2], 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
        if (h.length >= 6) {
            const r = parseInt(h.slice(0, 2), 16);
            const g = parseInt(h.slice(2, 4), 16);
            const b = parseInt(h.slice(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
        return `rgba(0,0,0,${alpha})`;
    }

    // load ordered element list (names from reference.json, colors from elements.json)
    React.useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const [refRes, elemRes] = await Promise.all([
                    fetch('/reference.json').then(r => r.json()),
                    fetch('/elements.json').then(r => r.json()),
                ]);
                const order = Array.isArray(refRes?.Element) ? refRes.Element : [];
                const byName = new Map(
                    (Array.isArray(elemRes) ? elemRes : []).map(e => [e.DisplayName, e.HexColor || '#ffffff'])
                );
                const list = order.map(name => ({ name, color: byName.get(name) || '#ffffff' }));
                if (!alive) return;
                setElements(list);
            } catch (e) {
                console.warn('[GalleryModal] failed to load elements', e);
            }
        })();
        return () => { alive = false; };
    }, []);

    const toggleEl = (el) => {
        setActiveEls(prev => prev.includes(el) ? prev.filter(x => x !== el) : [...prev, el]);
    };

    const matchesQuery = (it) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        const hay = [
            it.InternalName, it.internalName, it.id,
            it.CardName, it.TokenName, it.Name,
            it.CardType, it.SuperType, it.SubType,
            it.Rarity, it.Set, it.CardText,
            it.ElementType1, it.ElementType2, it.ElementType3,
            String(it.ConvertedCost ?? '')
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
    };

    // Element filters are OR across the active chips
    const matchesElements = (it) => {
        if (!activeEls.length) return true;
        const els = [it.ElementType1, it.ElementType2, it.ElementType3].filter(Boolean);
        return els.some(e => activeEls.includes(e));
    };

    const filtered = (items || []).filter(it => matchesQuery(it) && matchesElements(it));

    return (
        <div className="pb-modal" role="dialog" aria-modal="true" aria-label={title}>
            <div className="pb-modal-content">
                <div className="pb-modal-header">
                    <div className="pb-modal-title">{title}</div>
                    <button className="tips-btn" onClick={onClose} title="Close">Close</button>
                </div>

                {/* Search + Element filter controls */}
                <div className="pb-gallery-controls">
                    <input
                        className="pb-search-input"
                        type="text"
                        value={query}
                        placeholder="Search name, type, element, InternalName…"
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    <div className="pb-filter-group">
                        {elements.map(({ name, color }) => {
                            const isActive = activeEls.includes(name);
                            const bg = hexToRGBA(color, isActive ? 0.35 : 0.18);
                            const border = isActive ? color : hexToRGBA(color, 0.25); // dimmer border when not selected
                            return (
                                <button
                                    key={name}
                                    type="button"
                                    className={`pb-filter-chip${isActive ? ' active' : ''}`}
                                    onClick={() => toggleEl(name)}
                                    title={isActive ? 'Click to remove filter' : 'Click to filter by this element'}
                                    style={{ borderColor: border, backgroundColor: bg }}
                                >
                                    {name}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="pb-gallery-grid">
                    {filtered?.map((it) => {
                        const internal = it.InternalName || it.internalName || it.id || '';
                        const name =
                            it.CardName      /* cards */
                            ?? it.TokenName  /* tokens (if present) */
                            ?? it.Name
                            ?? internal;

                        const src = IMG.frontOf(internal);
                        const alt = imgAlt(title?.toLowerCase().includes('token') ? 'token' : 'card', internal, 'a');
                        const errType = title?.toLowerCase().includes('token') ? 'token' : 'card';

                        return (
                            <figure
                                key={internal}
                                className="pb-gallery-card"
                                data-menu-area="viewer-card"   // NEW
                                data-card-id={internal}        // NEW
                            >
                                <CardZoom id={ensureFrontId(internal)} name={name} />
                                <img
                                    src={src}
                                    alt={alt}
                                    onError={onImgError(errType, internal, 'a')}
                                />
                            </figure>
                        );
                    })}
                    {filtered.length === 0 && (
                        <div className="pb-empty">No items match your search.</div>
                    )}
                </div>
            </div>
        </div>
    );
}
/**
 * ResourceCountersModal
 * Adds per-card "resource hoard" counters keyed by element InternalName (from /elements.json)
 * Props:
 *  - prompt: { slotKey, counts: { [internalName]: number } }
 *  - setPrompt(fn)
 *  - onClose()
 *  - resources: object map of slotKey -> { [internalName]: number }
 *  - setResources(fn)
 */
export function ResourceCountersModal({
    prompt,
    setPrompt,
    onClose,
    resources = {},
    setResources,
}) {
    const slotKey = prompt?.slotKey || '';
    const counts = prompt?.counts || {};

    const [elements, setElements] = React.useState([]);

    React.useEffect(() => {
        let alive = true;
        fetch('/elements.json', { cache: 'no-store' })
            .then(r => r.json())
            .then(json => { if (alive) setElements(Array.isArray(json) ? json : []); })
            .catch(() => { if (alive) setElements([]); });
        return () => { alive = false; };
    }, []);

    const clamp = (v) => {
        const n = Math.floor(Number(v));
        return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    const setCount = (internal, nextVal) => {
        const n = clamp(nextVal);
        setPrompt?.((prev) => {
            if (!prev) return prev;
            const cur = prev.counts || {};
            return { ...prev, counts: { ...cur, [internal]: n } };
        });
    };

    const total = Object.values(counts || {}).reduce((a, b) => a + (Number(b) || 0), 0);

    const onConfirm = () => {
        const cleaned = Object.fromEntries(
            Object.entries(counts || {}).filter(([, n]) => (Number(n) || 0) > 0)
        );

        setResources?.((prev) => {
            const base = prev || {};
            const up = { ...base };
            if (Object.keys(cleaned).length) up[slotKey] = cleaned;
            else delete up[slotKey];
            return up;
        });

        onClose?.();
    };

    const onReset = () => {
        const existing = (resources && resources[slotKey]) || {};
        setPrompt?.((prev) => prev ? ({ ...prev, counts: { ...existing } }) : prev);
    };

    const onClearAll = () => {
        setPrompt?.((prev) => prev ? ({ ...prev, counts: {} }) : prev);
        setResources?.((prev) => {
            if (!prev?.[slotKey]) return prev;
            const up = { ...(prev || {}) };
            delete up[slotKey];
            return up;
        });
    };

    const titleSuffix = /^o/.test(String(slotKey)) ? ' (Opponent)' : '';

    return (
        <div className="pb-modal pb-counters pb-resource-counters" role="dialog" aria-modal="true" aria-label="Add Resource Counters">
            <div className="pb-modal-content">
                <div className="pb-modal-header">
                    <div className="pb-modal-title">Add Resource Counters{titleSuffix}</div>
                    <button className="tips-btn" onClick={onClose}>Cancel</button>
                </div>

                <div className="pb-modal-body">
                    <div className="pb-counters-list">
                        {(elements || []).map((el) => {
                            const internal = String(el?.InternalName || '').trim();
                            if (!internal) return null;

                            const displayName = String(el?.DisplayName || internal);

                            const n = clamp(counts?.[internal] || 0);
                            const img = `/images/${internal}.png`;

                            return (
                                <div key={internal} className="pb-counter-row pb-resource-row">
                                    <div className="pb-resource-left">
                                        <img className="pb-resource-row-icon" src={img} alt={displayName} draggable="false" />
                                        <div className="pb-counter-name" title={internal}>{displayName}</div>
                                    </div>

                                    <div className="pb-mini-counter" role="group" aria-label={`${displayName} counter`}>
                                        <button
                                            className="pb-btn"
                                            onClick={() => setCount(internal, Math.max(0, n - 1))}
                                            title="Decrease"
                                        >−</button>
                                        <output className="hp-display" aria-live="polite">{n}</output>
                                        <button
                                            className="pb-btn"
                                            onClick={() => setCount(internal, n + 1)}
                                            title="Increase"
                                        >+</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="pb-encounter-actions">
                    <button className="tips-btn pb-encounter-generate" onClick={onConfirm}>Confirm</button>

                    <span className="pb-encounter-count">{total} total</span>

                    <button
                        className="tips-btn"
                        title="Reset to the card's current hoards"
                        onClick={() => {
                            if (!window.confirm('Reset all resource values to the card’s current hoards?')) return;
                            onReset();
                        }}
                    >
                        Reset
                    </button>

                    <button
                        className="tips-btn"
                        title="Clear all resource hoards from this card"
                        onClick={() => {
                            if (!window.confirm('Clear all resource hoards from this card?')) return;
                            onClearAll();
                            onClose?.();
                        }}
                    >
                        Clear All Counters
                    </button>
                </div>
            </div>
        </div>
    );
}

// ===== Roil modal (Grave -> Deck) =====
// Mirrors the Foresee layout, but with a single "To Deck" area.
export function RoilModal({ roil, setRoil, onClose, onConfirm }) {
    if (!roil) return null;

    // local copy of image helpers to avoid coupling to playtest-board.jsx
    const IMG = {
        frontOf: (internal) => `/images/${String(internal || '').replace(/_(a|b)$/i, '')}_a.png`,
        fallbackFront: '/images/card0000_a.png',
    };
    const ensureFrontId = (id) => `${String(id || '').replace(/_(a|b)$/i, '')}_a`;
    function onImgError(type, internalName) {
        return (e) => {
            e.currentTarget.onerror = null;
            console.warn('[playtest-board] Missing image → using fallback', { type, internalName, missing: e.currentTarget.src });
            e.currentTarget.src = IMG.fallbackFront;
        };
    }

    const move = (fromZone, fromIdx, toZone, toIdx = null) => {
        setRoil?.((prev) => {
            if (!prev) return prev;

            const zones = {
                grave: [...(prev.grave || [])],
                deck: [...(prev.toDeck || [])],
            };
            const srcArr = zones[fromZone];
            const dstArr = zones[toZone];
            if (!srcArr || !dstArr) return prev;
            if (!Number.isFinite(fromIdx) || fromIdx < 0 || fromIdx >= srcArr.length) return prev;

            // Prevent adding beyond the target roil number
            if (toZone === 'deck' && fromZone !== 'deck' && dstArr.length >= (Number(prev.n) || 0)) return prev;

            const [moved] = srcArr.splice(fromIdx, 1);
            const insertAt = Number.isFinite(toIdx) ? Math.max(0, Math.min(toIdx, dstArr.length)) : dstArr.length;
            dstArr.splice(insertAt, 0, moved);

            return {
                ...prev,
                grave: zones.grave,
                toDeck: zones.deck,
            };
        });
    };

    const parseRZ = (e) => {
        const t = (e?.dataTransfer?.getData('text/pb') || '').split(':');
        if (t.length === 3 && t[0] === 'rz') {
            const [_tag, zone, idxStr] = t;
            const index = Number.parseInt(idxStr, 10);
            if (['grave', 'deck'].includes(zone) && Number.isFinite(index)) {
                return { zone, index };
            }
        }
        return null;
    };

    const onDragStart = (zone, idx) => (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `rz:${zone}:${idx}`);
    };

    const onDragOver = (e) => { e.preventDefault(); };

    const onDropOnTile = (zone, overIdx) => (e) => {
        e.preventDefault();
        e.stopPropagation();
        const src = parseRZ(e);
        if (!src) return;
        let insertAt = overIdx;
        if (src.zone === zone && src.index < insertAt) insertAt -= 1;
        move(src.zone, src.index, zone, insertAt);
    };

    const onDropOnZone = (zone) => (e) => {
        e.preventDefault();
        const src = parseRZ(e);
        if (!src) return;
        move(src.zone, src.index, zone, null);
    };

    const canConfirm = (roil?.toDeck?.length || 0) === (Number(roil?.n) || 0);

    return (
        <div
            className="pb-modal pb-foresee pb-roil"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => {
                if (e.target.classList?.contains('pb-modal')) onClose?.();
            }}
        >
            <div className="pb-modal-content">
                <div className="pb-modal-header">
                    <div className="pb-modal-title">Roil</div>
                    <button className="tips-btn" onClick={onClose} title="Close">Close</button>
                </div>

                <div className="pb-foresee-body">
                    {/* Grave (unassigned) */}
                    <div
                        className="pb-foresee-zone pb-foresee-reveal"
                        onDragOver={onDragOver}
                        onDrop={onDropOnZone('grave')}
                    >
                        {(roil.grave?.length || 0) === 0 && (
                            <div className="pb-foresee-placeholder">Grave Area</div>
                        )}
                        <div className="pb-foresee-cards">
                            {(roil.grave || []).map((id, i) => (
                                <figure
                                    key={`g-${id}-${i}`}
                                    className="pb-gallery-card pb-foresee-card"
                                    draggable
                                    onDragStart={onDragStart('grave', i)}
                                    onDragOver={onDragOver}
                                    onDrop={onDropOnTile('grave', i)}
                                >
                                    <CardZoom id={ensureFrontId(id)} name={id} />
                                    <img
                                        className="pb-card-img"
                                        src={IMG.frontOf(id)}
                                        alt={`roil:grave:${id}:a`}
                                        onError={onImgError('card', id)}
                                        draggable="false"
                                    />
                                </figure>
                            ))}
                        </div>
                    </div>

                    {/* Action row */}
                    <div className="pb-foresee-bar">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <button
                                className="tips-btn"
                                disabled={!canConfirm}
                                onClick={onConfirm}
                                title={canConfirm ? 'Confirm' : 'Move the required number of cards first'}
                            >
                                Confirm
                            </button>
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                                {(roil.toDeck?.length || 0)}/{Number(roil.n) || 0}
                            </div>
                        </div>
                        <div className="pb-foresee-instructions">Click and Drag Cards to Area</div>
                        <button
                            className="tips-btn"
                            onClick={() => setRoil?.((prev) => prev ? ({ ...prev, grave: prev.ids?.slice?.() || [], toDeck: [] }) : prev)}
                            title="Reset"
                        >
                            Reset
                        </button>
                    </div>

                    {/* To Deck */}
                    <div
                        className="pb-foresee-zone"
                        onDragOver={onDragOver}
                        onDrop={onDropOnZone('deck')}
                    >
                        {(roil.toDeck?.length || 0) === 0 && (
                            <div className="pb-foresee-placeholder">Deck Area</div>
                        )}
                        <div className="pb-foresee-cards">
                            {(roil.toDeck || []).map((id, i) => (
                                <figure
                                    key={`d-${id}-${i}`}
                                    className="pb-gallery-card pb-foresee-card"
                                    draggable
                                    onDragStart={onDragStart('deck', i)}
                                    onDragOver={onDragOver}
                                    onDrop={onDropOnTile('deck', i)}
                                >
                                    <CardZoom id={ensureFrontId(id)} name={id} />
                                    <img
                                        className="pb-card-img"
                                        src={IMG.frontOf(id)}
                                        alt={`roil:deck:${id}:a`}
                                        onError={onImgError('card', id)}
                                        draggable="false"
                                    />
                                </figure>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * RansackModal
 * - Shows all 6 options with per-game pick counts
 * - Randomize -> shows 2 choices (duplicates allowed)
 * - Select 1 -> Confirm appears
 * - Confirm increments the selected option tracker (done in parent via onConfirm)
 */
export function RansackModal({
    prompt,
    setPrompt,
    options = [],
    counts = [],
    onConfirm,
    onClose,
}) {
    if (!prompt) return null;

    const rolls = prompt?.rolls || null; // [idxA, idxB] or null
    const pick = (prompt?.pick === 0 || prompt?.pick === 1) ? prompt.pick : null;

    const safeOptions = Array.isArray(options) ? options : [];
    const optText = (i) => String(safeOptions?.[i]?.text || '');

    const doRandomize = () => {
        if (safeOptions.length < 1) return;
        const max = safeOptions.length;
        const a = Math.floor(Math.random() * max);
        const b = Math.floor(Math.random() * max);
        setPrompt?.((prev) => prev ? ({ ...prev, rolls: [a, b], pick: null }) : prev);
    };

    const doReset = () => {
        setPrompt?.((prev) => prev ? ({ ...prev, rolls: null, pick: null }) : prev);
    };

    const choose = (which) => {
        if (!rolls) return;
        setPrompt?.((prev) => prev ? ({ ...prev, pick: which }) : prev);
    };

    const confirm = () => {
        if (!rolls) return;
        if (pick === null) return;
        const chosenIndex = rolls[pick];
        onConfirm?.(chosenIndex);
        // window resets (but stays open)
        doReset();
    };

    return (
        <div className="pb-modal pb-ransack" role="dialog" aria-modal="true" aria-label="Ransack">
            <div className="pb-modal-content">
                <div className="pb-modal-header">
                    <div className="pb-modal-title">Ransack</div>
                    <button className="tips-btn" onClick={onClose}>Close</button>
                </div>

                <div className="pb-ransack-body">
                    {/* Top: all options + counts */}
                    <div className="pb-ransack-options">
                        {safeOptions.slice(0, 6).map((opt, i) => (
                            <div key={opt?.id ?? i} className="pb-ransack-option">
                                <div className="pb-ransack-option-title">Option {i + 1}</div>
                                <div className="pb-ransack-option-text">{String(opt?.text || '')}</div>
                                <div className="pb-ransack-option-count">
                                    Times Picked: {Number(counts?.[i] || 0)}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Controls row */}
                    <div className="pb-ransack-bar">
                        <button className="tips-btn" onClick={doRandomize}>Randomize</button>

                        <div className="pb-ransack-center">
                            {rolls && pick !== null && (
                                <button className="tips-btn" onClick={confirm}>Confirm</button>
                            )}
                        </div>

                        <button className="tips-btn" onClick={doReset}>Reset</button>
                    </div>

                    {/* Bottom: two rolled options */}
                    <div className="pb-ransack-picks">
                        <div
                            className={`pb-ransack-pick${pick === 0 ? ' is-selected' : ''}`}
                            onClick={() => choose(0)}
                            role="button"
                            tabIndex={0}
                        >
                            <div className="pb-ransack-pick-title">{rolls ? 'Option 1' : 'Option 1'}</div>
                            <div className="pb-ransack-pick-text">
                                {rolls ? optText(rolls[0]) : ''}
                            </div>
                        </div>

                        <div
                            className={`pb-ransack-pick${pick === 1 ? ' is-selected' : ''}`}
                            onClick={() => choose(1)}
                            role="button"
                            tabIndex={0}
                        >
                            <div className="pb-ransack-pick-title">{rolls ? 'Option 2' : 'Option 2'}</div>
                            <div className="pb-ransack-pick-text">
                                {rolls ? optText(rolls[1]) : ''}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Depth Levels (Deck)
 * - Uses DepthLevels config from /public/reference.json so you can tune ranges later.
 * - Returns { level, tone, count, range } where tone ∈ 'safe'|'warn'|'danger'|'critical'
 */
export function getDepthLevelInfo(deckCount, depthConfig) {
    const n = Math.max(0, Math.floor(Number(deckCount) || 0));
    const cfg = depthConfig || {};
    const ranges = Array.isArray(cfg?.Ranges) ? cfg.Ranges : (Array.isArray(cfg?.ranges) ? cfg.ranges : []);
    if (!ranges.length) return { level: null, tone: 'safe', count: n, range: null };

    // Find the matching range (inclusive). If out of bounds, clamp to nearest edge range.
    const normMin = (r) => Number(r?.Min ?? r?.min ?? 0);
    const normMax = (r) => Number(r?.Max ?? r?.max ?? 0);
    const normLvl = (r) => Number(r?.Level ?? r?.level ?? 0) || null;

    const sorted = [...ranges].sort((a, b) => normMin(a) - normMin(b));
    let hit = sorted.find(r => n >= normMin(r) && n <= normMax(r));
    if (!hit) hit = (n < normMin(sorted[0])) ? sorted[0] : sorted[sorted.length - 1];

    const min = normMin(hit);
    const max = normMax(hit);
    const level = normLvl(hit);

    // Color should reflect how close we are to the NEXT depth threshold (the upper bound).
    // At the start of a depth range we should be "safe" (green), and become more urgent as we approach `max`.
    const clampedN = Math.min(Math.max(n, min), max);
    const distToMax = max - clampedN;

    const prox = cfg?.Proximity || cfg?.proximity || {};
    const warn = Number(prox?.Warn ?? prox?.warn ?? 5);
    const danger = Number(prox?.Danger ?? prox?.danger ?? 2);
    const critical = Number(prox?.Critical ?? prox?.critical ?? 1);

    let tone = 'safe';
    if (distToMax <= critical) tone = 'critical';
    else if (distToMax <= danger) tone = 'danger';
    else if (distToMax <= warn) tone = 'warn';

    return { level, tone, count: n, range: { min, max } };
}
