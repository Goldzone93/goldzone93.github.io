// /src/plugins/playtest-board.jsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import '../styles/playtest-board.css';
import '../styles/hover-preview.css';
import { useHoverPreview } from '../plugins/hover-preview.jsx';
// Side-effect import so the plugin is available later (no UI changes now)
import './card-zoom.jsx';
import { installPBActionHandlers } from './playtest-board-context-menu.jsx'; // moved action handlers into the context menu plugin
import { usePlaytestBoardDragNDown } from './playtest-board-dragndown.jsx'; // NEW: drag/drop handlers plugin
import { CardZoom } from './card-zoom.jsx';
import registerHelpSection from '../plugins/help-section.jsx';
import { InflictDamageModal } from './playtest-board-modules.jsx';
import { FetchCardsModal } from './playtest-board-modules.jsx';
import { HealModal } from './playtest-board-modules.jsx';
import { StatModifyModal } from './playtest-board-modules.jsx';
import { MulliganModal } from './playtest-board-modules.jsx';
import { RemoveLabelModal } from './playtest-board-modules.jsx';
import { AddLabelModal } from './playtest-board-modules.jsx';
import { EncounterModal } from './playtest-board-modules.jsx';
import { GalleryModal } from './playtest-board-modules.jsx';
import { RoilModal } from './playtest-board-modules.jsx';
import { ResourceCountersModal } from './playtest-board-modules.jsx';
import { RansackModal } from './playtest-board-modules.jsx';
import { getDepthLevelInfo } from './playtest-board-modules.jsx';
import { OpponentBoard } from './playtest-board-opponent-board.jsx';

// Runtime data (loaded via fetch from /public)
const DATA_ENDPOINTS = {
    cards: '/cards.json',
    partners: '/partners.json',
    reference: '/reference.json',
    tokens: '/tokens.json',
    elements: '/elements.json',
    keywords: '/keywords.json',
};

// ----- Image helpers (cards, tokens, partners share same rules) -----
const IMG = {
    // Some InternalName values already include _a or _b in the JSON.
    // Always strip any side suffix, then add the desired one.
    frontOf: (internal) =>
        `/images/${String(internal || '').replace(/_(a|b)$/i, '')}_a.png`,
    backOf: (internal) =>
        `/images/${String(internal || '').replace(/_(a|b)$/i, '')}_b.png`,
    fallbackFront: '/images/card0000_a.png',
    fallbackBack: '/images/card0000_b.png',
};

function getImagePath(internalName, side = 'a') {
  return side === 'a' ? IMG.frontOf(internalName) : IMG.backOf(internalName);
}

function getFallbackPath(side = 'a') {
  return side === 'a' ? IMG.fallbackFront : IMG.fallbackBack;
}

// Ensure we pass an "_a" id to CardZoom so it finds /images/<id>_a.png
const ensureFrontId = (id) => `${String(id || '').replace(/_(a|b)$/i, '')}_a`;

// Use on <img onError={onImgError('card', internalName, 'a')} />
function onImgError(type, internalName, side = 'a') {
    return (e) => {
        e.currentTarget.onerror = null;
        const badSrc = e.currentTarget.src;

        const fallback = side === 'b' ? IMG.fallbackBack : IMG.fallbackFront;
        console.warn(
            `[playtest-board] Missing ${type} ${side === 'b' ? 'back' : 'front'} image → using fallback`,
            { type, internalName, side, missing: badSrc, fallback }
        );
        e.currentTarget.src = fallback;
    };
}

// Standardized alt text across cards/tokens/partners
function imgAlt(type, internalName, side = 'a') {
  return `${type}:${internalName}:${side}`;
}

// ----- Data loading (runtime from /public) -----
async function fetchJson(path, signal) {
  const res = await fetch(path, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

export async function loadPlaytestData(signal) {
  const [
    cards,
    partners,
    reference,
    tokens,
    elements,
    keywords,
  ] = await Promise.all([
    fetchJson(DATA_ENDPOINTS.cards, signal),
    fetchJson(DATA_ENDPOINTS.partners, signal),
    fetchJson(DATA_ENDPOINTS.reference, signal),
    fetchJson(DATA_ENDPOINTS.tokens, signal),
    fetchJson(DATA_ENDPOINTS.elements, signal),
    fetchJson(DATA_ENDPOINTS.keywords, signal),
  ]);

  // Build quick-lookup maps by InternalName
  const byInternal = (arr) => {
    const m = new Map();
    if (Array.isArray(arr)) {
      for (const item of arr) {
        const key = item?.InternalName;
        if (key) m.set(key, item);
      }
    }
    return m;
  };

  return {
    cards,
    partners,
    reference,
    tokens,
    elements,
    keywords,
    maps: {
      cardsById: byInternal(cards),
      partnersById: byInternal(partners),
      tokensById: byInternal(tokens),
    },
  };
}

// React hook to preload assets when PlaytestBoard mounts.
// Note: intentionally not rendering anything from this yet.
function usePlaytestAssets() {
  const [assets, setAssets] = React.useState(null);

  React.useEffect(() => {
    const ctrl = new AbortController();
    loadPlaytestData(ctrl.signal)
      .then((data) => setAssets(data))
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.warn('[playtest-board] Data load error:', err);
        }
      });
    return () => ctrl.abort();
  }, []);

  return assets; // currently unused (back-end only)
}


// ---------- Layout helpers (grid) ----------
const UNIT_SLOTS = Array.from({ length: 7 }, (_, i) => i + 1);     // unit[1..7]
const SUPPORT_SLOTS = Array.from({ length: 7 }, (_, i) => i + 1);  // support[1..7]
const BATTLE_SLOTS = Array.from({ length: 7 }, (_, i) => i + 1);   // b1..b7

/**
 * Slot: a single card-sized cell.
 * kind: 'partner' | 'pile' | 'unit' | 'support'
 * row, col: 1-based grid coordinates; span: grid-column span
 */
function Slot({ kind, row, col, span = 1, name, children, style: styleIn, ...rest }) {
    const isRot = kind === 'unit' || kind === 'support' || kind === 'battle';
    const className = `pb-slot ${isRot ? 'pb-rot' : 'pb-std'} ${kind}`;
    const style = { gridRow: row, gridColumn: `${col} / span ${span}`, ...(styleIn || {}) };
    return (
        <div
            className={className}
            style={style}
            data-name={name || kind}
            aria-label={name || kind}
            {...rest}
        >
            {children}
        </div>
    );
}

/** Battle zone: wide cell, same height as a card, spans multiple columns */
function BattleZone({ row, col, span, name = 'Battle Zone' }) {
    const style = { gridRow: row, gridColumn: `${col} / span ${span}` };
    return <div className="pb-battle-zone" style={style} aria-label={name} data-name={name} />;
}

// ---------- Right Panel: Player HP tracker ----------
function HPTracker({ engineMode = true }) {
    const [hp, setHp] = React.useState(10);
    const [overrideCap, setOverrideCap] = React.useState(false);
    const CAP = 10;

    const clamp = (n) => Math.max(0, Math.min(n, CAP));
    const inc = () => setHp((v) => (overrideCap ? v + 1 : clamp(v + 1)));
    const dec = () => setHp((v) => Math.max(0, v - 1));
    const onToggle = (e) => {
        const checked = e.target.checked;
        setOverrideCap(checked);
        if (!checked) setHp((v) => clamp(v)); // snap back to cap if above it
    };

    React.useEffect(() => {
        const onReset = () => { setHp(10); setOverrideCap(false); };
        window.addEventListener('pb:new-game', onReset);
        return () => window.removeEventListener('pb:new-game', onReset);
    }, []);

    return (
        <section className="pb-section">
            <div className="pb-section-title">Player HP</div>
            <div className="hp-row">
                <button className="pb-btn" onClick={dec} aria-label="Decrease HP">−</button>
                <output className="hp-display" aria-live="polite">{hp}</output>
                <button className="pb-btn" onClick={inc} aria-label="Increase HP">+</button>

                <label className="hp-override" title="Allow HP to exceed the cap (10)">
                    <input type="checkbox" checked={overrideCap} onChange={onToggle} />
                    <span>Override</span>
                </label>
            </div>
            <div className="hp-cap-note">{overrideCap ? 'Cap: off' : `Cap: ${CAP}`}</div>
        </section>
    );
}

// ---------- Right Panel: Temporary HP tracker ----------
function TempHPTracker({ engineMode = true }) {
    const [hp, setHp] = React.useState(0);
    const [overrideCap, setOverrideCap] = React.useState(false);
    const CAP = 5;

    const clamp = (n) => Math.max(0, Math.min(n, CAP));
    const inc = () => setHp((v) => (overrideCap ? v + 1 : clamp(v + 1)));
    const dec = () => setHp((v) => Math.max(0, v - 1));
    const onToggle = (e) => {
        const checked = e.target.checked;
        setOverrideCap(checked);
        if (!checked) setHp((v) => clamp(v)); // snap back to cap if above it
    };

    React.useEffect(() => {
        const onReset = () => { setHp(0); setOverrideCap(false); };
        window.addEventListener('pb:new-game', onReset);
        return () => window.removeEventListener('pb:new-game', onReset);
    }, []);

    return (
        <section className="pb-section">
            <div className="pb-section-title">Temporary HP</div>
            <div className="hp-row">
                <button className="pb-btn" onClick={dec} aria-label="Decrease Temporary HP">−</button>
                <output className="hp-display" aria-live="polite">{hp}</output>
                <button className="pb-btn" onClick={inc} aria-label="Increase Temporary HP">+</button>

                <label className="hp-override" title="Allow Temp HP to exceed the cap (5)">
                    <input type="checkbox" checked={overrideCap} onChange={onToggle} />
                    <span>Override</span>
                </label>
            </div>
            <div className="hp-cap-note">{overrideCap ? 'Cap: off' : `Cap: ${CAP}`}</div>
        </section>
    );
}

// ADD: convert "#RRGGBB" (or "#RGB") to rgba(r,g,b,alpha)
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

function ElementResourceTrackers({ visibleNames = null, engineMode = true, owner = 'player' }) {
    const [elements, setElements] = React.useState([]); // [{name, color}]
    const [values, setValues] = React.useState({});     // { name: number }
    const [overrides, setOverrides] = React.useState({}); // { name: boolean }

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
                setValues(v => Object.fromEntries(list.map(({ name }) => [name, Number.isFinite(v[name]) ? v[name] : 0])));
                setOverrides(o => Object.fromEntries(list.map(({ name }) => [name, !!o[name]])));
            } catch (e) {
                console.warn('[ElementResourceTrackers] failed to load data', e);
            }
        })();
        return () => { alive = false; };
    }, []);

    // Publish which element trackers are visible so Cost Modal can read them
    React.useEffect(() => {
        if (owner === 'player') {
            window.__PB_VISIBLE_ELEMENTS_SET = visibleNames ? new Set(visibleNames) : null;
        } else if (owner === 'opponent') {
            window.__PB_O_VISIBLE_ELEMENTS_SET = visibleNames ? new Set(visibleNames) : null;
        }
    }, [owner, visibleNames]);

    // Opponent: publish a separate global state so Cost Modal can read/spend
    React.useEffect(() => {
        if (owner !== 'opponent') return;
        window.__PB_O_ELEMENTS_STATE = {
            values,
            overrides,
            cap: 10,
            setValues: (updater) =>
                setValues(prev => (typeof updater === 'function' ? updater(prev) : (updater || prev))),
            spend: (spendMap) =>
                setValues(prev => {
                    const next = { ...(prev || {}) };
                    for (const [rawK, rawV] of Object.entries(spendMap || {})) {
                        const k = String(rawK).trim();
                        const amt = Math.max(0, Math.floor(Number(rawV) || 0));
                        if (!amt) continue;
                        const cur = Number(next[k] || 0);
                        next[k] = Math.max(0, cur - amt);
                    }
                    return next;
                }),
        };
        return () => {
            if (window.__PB_O_ELEMENTS_STATE?.values === values) {
                delete window.__PB_O_ELEMENTS_STATE;
            }
        };
    }, [owner, values, overrides]);

    // Opponent: listen for spend events
    React.useEffect(() => {
        if (owner !== 'opponent') return;
        const onSpend = (e) => {
            const spendMap = (e && e.detail && e.detail.spend) || {};
            setValues(prev => {
                const next = { ...(prev || {}) };
                for (const [k, v] of Object.entries(spendMap)) {
                    const amt = Number(v) || 0;
                    next[k] = Math.max(0, (next[k] || 0) - amt);
                }
                return next;
            });
        };
        window.addEventListener('pb:o-elements:spend', onSpend);
        return () => window.removeEventListener('pb:o-elements:spend', onSpend);
    }, [owner]);

    const inc = (name) => {
        setValues(curr => {
            const v = curr[name] ?? 0;
            const cap = 10;
            const allow = overrides[name] || v < cap;
            if (!allow) return curr;
            return { ...curr, [name]: v + 1 };
        });
    };
    const dec = (name) => {
        setValues(curr => {
            const v = curr[name] ?? 0;
            return { ...curr, [name]: Math.max(0, v - 1) };
        });
    };

    // Strict increment that ALWAYS respects the cap (ignores override toggle)
    const strictInc = React.useCallback((name) => {
        setValues((curr) => {
            if (!(name in curr)) return curr;
            const v = curr[name] ?? 0;
            const cap = 10;
            if (v >= cap) return curr;
            return { ...curr, [name]: v + 1 };
        });
    }, []);

    // Only the engine instance listens to external increment/spend/refund events
    React.useEffect(() => {
        if (!engineMode) return;
        const onInc = (e) => {
            const name = e?.detail?.name;
            if (name) inc(name);
        };
        const onIncStrict = (e) => {
            const name = e?.detail?.name;
            if (name) strictInc(name);
        };
        window.addEventListener('pb:elements:inc', onInc);
        window.addEventListener('pb:elements:inc-strict', onIncStrict);
        return () => {
            window.removeEventListener('pb:elements:inc', onInc);
            window.removeEventListener('pb:elements:inc-strict', onIncStrict);
        };
    }, [engineMode, strictInc]);

    // Opponent: allow external increment events (Produce Step, etc.)
    React.useEffect(() => {
        if (owner !== 'opponent') return;

        const onInc = (e) => {
            const name = e?.detail?.name;
            if (name) inc(name);
        };
        const onIncStrict = (e) => {
            const name = e?.detail?.name;
            if (name) strictInc(name);
        };

        window.addEventListener('pb:o-elements:inc', onInc);
        window.addEventListener('pb:o-elements:inc-strict', onIncStrict);
        return () => {
            window.removeEventListener('pb:o-elements:inc', onInc);
            window.removeEventListener('pb:o-elements:inc-strict', onIncStrict);
        };
    }, [owner, strictInc]);

    React.useEffect(() => {
        if (!engineMode) return;
        const onSpend = (e) => {
            const spendMap = (e && e.detail && e.detail.spend) || {};
            setValues(prev => {
                const next = { ...(prev || {}) };
                for (const [k, v] of Object.entries(spendMap)) {
                    const amt = Number(v) || 0;
                    next[k] = Math.max(0, (next[k] || 0) - amt);
                }
                return next;
            });
        };
        window.addEventListener("pb:elements:spend", onSpend);
        return () => window.removeEventListener("pb:elements:spend", onSpend);
    }, [engineMode]);

    const applyRefundToNeutral = React.useCallback((amount) => {
        if (!amount || amount <= 0) return;
        setValues((curr) => {
            const name = 'Neutral';
            const current = curr[name] ?? 0;
            const cap = 10;
            const allowOver = overrides[name];
            const target = allowOver ? current + amount : Math.min(cap, current + amount);
            if (target === current) return curr;
            return { ...curr, [name]: target };
        });
    }, [overrides]);

    React.useEffect(() => {
        if (!engineMode) return;
        const onApply = (e) => {
            const amt = Number(e?.detail?.amount) || 0;
            applyRefundToNeutral(amt);
        };
        window.addEventListener('pb:elements:apply-refund', onApply);
        return () => window.removeEventListener('pb:elements:apply-refund', onApply);
    }, [engineMode, applyRefundToNeutral]);

    // Opponent: listen for opponent refund apply event
    React.useEffect(() => {
        if (owner !== 'opponent') return;
        const onApply = (e) => {
            const amt = Number(e?.detail?.amount) || 0;
            applyRefundToNeutral(amt);
        };
        window.addEventListener('pb:o-elements:apply-refund', onApply);
        return () => window.removeEventListener('pb:o-elements:apply-refund', onApply);
    }, [owner, applyRefundToNeutral]);

    // Only the engine instance should publish to the global (produce step uses this)
    React.useEffect(() => {
        if (!engineMode) return;
        window.__PB_ELEMENTS_STATE = {
            values,
            overrides,
            cap: 10,
            setValues: (updater) =>
                setValues(prev => (typeof updater === "function" ? updater(prev) : (updater || prev))),
            spend: (spendMap) =>
                setValues(prev => {
                    const next = { ...(prev || {}) };
                    for (const [rawK, rawV] of Object.entries(spendMap || {})) {
                        const k = String(rawK).trim();
                        const amt = Math.max(0, Math.floor(Number(rawV) || 0));
                        if (!amt) continue;
                        const cur = Number(next[k] || 0);
                        next[k] = Math.max(0, cur - amt);
                    }
                    return next;
                }),
        };
        return () => {
            // don't clear on unmount unless this instance still owns it
            if (window.__PB_ELEMENTS_STATE?.values === values) {
                delete window.__PB_ELEMENTS_STATE;
            }
        };
    }, [engineMode, values, overrides]);

    // Publish which element trackers are currently visible (per owner) so Cost Modal can mirror the Right Panel
    React.useEffect(() => {
        if (!engineMode) return;
        if (owner === 'player') {
            window.__PB_VISIBLE_ELEMENTS_SET = visibleNames || null;
        } else if (owner === 'opponent') {
            window.__PB_O_VISIBLE_ELEMENTS_SET = visibleNames || null;
        }
    }, [visibleNames, engineMode, owner]);

    // Publish opponent element pools for consumers (Cost Modal, etc.)
    React.useEffect(() => {
        if (owner !== 'opponent') return;
        window.__PB_O_ELEMENTS_STATE = {
            values,
            overrides,
            cap: 10,
            setValues: (updater) =>
                setValues(prev => (typeof updater === "function" ? updater(prev) : (updater || prev))),
            spend: (spendMap) =>
                setValues(prev => {
                    const next = { ...(prev || {}) };
                    for (const [rawK, rawV] of Object.entries(spendMap || {})) {
                        const k = String(rawK).trim();
                        const amt = Math.max(0, Math.floor(Number(rawV) || 0));
                        if (!amt) continue;
                        const cur = Number(next[k] || 0);
                        next[k] = Math.max(0, cur - amt);
                    }
                    return next;
                }),
        };
        return () => {
            if (window.__PB_O_ELEMENTS_STATE?.values === values) {
                delete window.__PB_O_ELEMENTS_STATE;
            }
        };
    }, [owner, values, overrides]);

    React.useEffect(() => {
        const onReset = () => {
            setValues(v => Object.fromEntries(Object.keys(v).map(k => [k, 0])));
            setOverrides(o => Object.fromEntries(Object.keys(o).map(k => [k, false])));
        };
        window.addEventListener('pb:new-game', onReset);
        return () => window.removeEventListener('pb:new-game', onReset);
    }, []);

    return (
        <section className="pb-section er-section">
            <div className="pb-section-title">Element Resources</div>
            <div className="er-list">
                {(visibleNames ? elements.filter(({ name }) => visibleNames.has(name)) : elements).map(({ name, color }) => (
                    <div key={name} className="er-row" style={{ borderColor: color, backgroundColor: hexToRGBA(color, 0.25) }}>
                        <div className="er-left">
                            <div className="er-name">{name}</div>
                        </div>

                        <div className="er-controls" role="group" aria-label={`${name} Resource`}>
                            <button className="pb-btn" title={`Decrease ${name}`} onClick={() => dec(name)}>−</button>
                            <span className="er-value" aria-live="polite">{values[name] ?? 0}</span>
                            <button className="pb-btn" title={`Increase ${name}`} onClick={() => inc(name)}>+</button>
                        </div>

                        <label className="er-override" title={`Allow ${name} above 10`}>
                            <input
                                type="checkbox"
                                checked={!!overrides[name]}
                                onChange={(e) => setOverrides(o => ({ ...o, [name]: e.target.checked }))}
                            />
                            <span>Override</span>
                        </label>
                    </div>
                ))}
            </div>
        </section>
    );
}

// ---------- Refund tracker ----------
function RefundTracker({ engineMode = true, owner = 'player' }) {
    const [value, setValue] = React.useState(0);

    const inc = () => setValue((v) => v + 1);
    const dec = () => setValue((v) => Math.max(0, v - 1));

    // Player engine: apply refund to Player elements on turn wrap
    React.useEffect(() => {
        if (!engineMode || owner !== 'player') return;
        const onWrapped = () => {
            setValue((cur) => {
                const n = Number(cur) || 0;
                if (n > 0) {
                    window.dispatchEvent(
                        new CustomEvent('pb:elements:apply-refund', { detail: { amount: n } })
                    );
                }
                return 0;
            });
        };
        window.addEventListener('pb:turn:wrapped', onWrapped);
        return () => window.removeEventListener('pb:turn:wrapped', onWrapped);
    }, [engineMode, owner]);

    // Opponent: apply refund to Opponent elements on turn wrap
    React.useEffect(() => {
        if (owner !== 'opponent') return;
        const onWrapped = () => {
            setValue((cur) => {
                const n = Number(cur) || 0;
                if (n > 0) {
                    window.dispatchEvent(
                        new CustomEvent('pb:o-elements:apply-refund', { detail: { amount: n } })
                    );
                }
                return 0;
            });
        };
        window.addEventListener('pb:turn:wrapped', onWrapped);
        return () => window.removeEventListener('pb:turn:wrapped', onWrapped);
    }, [owner]);

    React.useEffect(() => {
        const onReset = () => setValue(0);
        window.addEventListener('pb:new-game', onReset);
        return () => window.removeEventListener('pb:new-game', onReset);
    }, []);

    return (
        <section className="pb-section refund-section">
            <div className="pb-section-title">Refund</div>
            <div className="refund-controls" role="group" aria-label="Refund Tracker">
                <button className="pb-btn" title="Decrease Refund" onClick={dec}>−</button>
                <span className="refund-value" aria-live="polite">{value}</span>
                <button className="pb-btn" title="Increase Refund" onClick={inc}>+</button>
            </div>
        </section>
    );
}

// Going First toggle (controlled)
function GoingFirstToggle({ value, setValue }) {
    const setYes = () => setValue('yes');
    const setNo = () => setValue('no');

    return (
        <div className="pb-cost-toggle" role="group" aria-label="Going First">
            <div className="pb-cost-label">Going First?</div>
            <div className="pb-cost-controls">
                <label className="pb-check">
                    <input
                        type="checkbox"
                        checked={value === 'yes'}
                        onChange={setYes}
                    />
                    <span>Yes</span>
                </label>

                <label className="pb-check">
                    <input
                        type="checkbox"
                        checked={value === 'no'}
                        onChange={setNo}
                    />
                    <span>No</span>
                </label>
            </div>
        </div>
    );
}

// NEW: match the exact structure/classes used by Going First?
function OpponentBoardToggle({ value, setValue, blockDisable }) {
    const onYes = () => setValue('yes');
    const onNo = () => {
        // Don't allow turning off if an opponent deck is imported
        // or any opponent slots have cards placed.
        if (blockDisable) {
            window.alert(
                'You cannot hide the Opponent Board while an opponent deck is imported or cards are on the opponent board.'
            );
            return;
        }

        // Only warn if the board is currently visible and user is turning it off
        if (value === 'yes') {
            const ok = window.confirm(
                'Hide the opponent board?\n\nThis will remove the mirrored board from the center.'
            );
            if (!ok) return;
        }
        setValue('no');
    };

    return (
        <div className="pb-cost-toggle" role="group" aria-label="Opponent Board">
            <div className="pb-cost-label">Opponent Board</div>
            <div className="pb-cost-controls">
                <label className="pb-check">
                    <input
                        type="checkbox"
                        checked={value === 'yes'}
                        onChange={onYes}
                    />
                    <span>Yes</span>
                </label>

                <label className="pb-check">
                    <input
                        type="checkbox"
                        checked={value === 'no'}
                        onChange={onNo}
                    />
                    <span>No</span>
                </label>
            </div>
        </div>
    );
}

// Cost Module toggle (placeholder UI)
function CostModuleToggle() {
    const [value, setValue] = React.useState('off'); // default: Off checked

    // ADD (right after: const [value, setValue] = React.useState('off');)
    React.useEffect(() => {
        try {
            // 'on' | 'off'  (default Off to match current UI default)
            window.__PB_COST_MODULE_MODE = value;

            // optional: broadcast for any future listeners
            window.dispatchEvent(new CustomEvent('pb:cost:mode', { detail: { mode: value } }));
        } catch { }
    }, [value]);

    const setOn = () => setValue('on');
    const setOff = () => setValue('off');

    return (
        <div className="pb-cost-toggle" role="group" aria-label="Cost Module">
            <div className="pb-cost-label">Cost Module</div>
            <div className="pb-cost-controls">
                <label className="pb-check">
                    <input
                        type="checkbox"
                        checked={value === 'on'}
                        onChange={setOn}
                    />
                    <span>On</span>
                </label>

                <label className="pb-check">
                    <input
                        type="checkbox"
                        checked={value === 'off'}
                        onChange={setOff}
                    />
                    <span>Off</span>
                </label>
            </div>
        </div>
    );
}

// Placement Module toggle (placeholder UI)
function PlacementModuleToggle() {
    const [value, setValue] = React.useState('off'); // default: Off checked

    const setOn = () => setValue('on');
    const setOff = () => setValue('off');

    return (
        <div className="pb-place-toggle" role="group" aria-label="Placement Module">
            <div className="pb-place-label">Placement Module</div>
            <div className="pb-cost-controls">
                <label className="pb-check">
                    <input
                        type="checkbox"
                        checked={value === 'on'}
                        onChange={setOn}
                    />
                    <span>On</span>
                </label>

                <label className="pb-check">
                    <input
                        type="checkbox"
                        checked={value === 'off'}
                        onChange={setOff}
                    />
                    <span>Off</span>
                </label>
            </div>
        </div>
    );
}

// Hover Preview toggle (wired to enable/disable the preview overlay)
function HoverPreviewToggle({ enabled, setEnabled }) {
    const setOn = () => setEnabled(true);
    const setOff = () => setEnabled(false);

    return (
        <div className="pb-hover-toggle" role="group" aria-label="Hover Preview">
            <div className="pb-hover-label">Hover Preview</div>
            <div className="pb-cost-controls">
                <label className="pb-check">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={setOn}
                    />
                    <span>On</span>
                </label>

                <label className="pb-check">
                    <input
                        type="checkbox"
                        checked={!enabled}
                        onChange={setOff}
                    />
                    <span>Off</span>
                </label>
            </div>
        </div>
    );
}

// NEW: Card Zoom toggle (controls whether CardZoom buttons are active/visible)
function CardZoomToggle({ enabled, setEnabled }) {
    const setOn = () => setEnabled(true);
    const setOff = () => setEnabled(false);

    return (
        <div className="pb-zoom-toggle" role="group" aria-label="Card Zoom">
            <div className="pb-zoom-label">Card Zoom</div>
            <div className="pb-cost-controls">
                <label className="pb-check">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={setOn}
                    />
                    <span>On</span>
                </label>

                <label className="pb-check">
                    <input
                        type="checkbox"
                        checked={!enabled}
                        onChange={setOff}
                    />
                    <span>Off</span>
                </label>
            </div>
        </div>
    );
}

// ---------- Left Panel: Custom Trackers ----------
function CustomTrackerRow({ label, count, onLabel, onInc, onDec, onRemove }) {
    return (
        <div className="pb-custom-row">
            <input
                className="pb-custom-input"
                type="text"
                placeholder="Type a thing to track…"
                value={label}
                onChange={(e) => onLabel(e.target.value)}
                aria-label="Custom tracker label"
            />
            <div className="pb-counter" role="group" aria-label={`Counter for ${label || 'custom tracker'}`}>
                <button className="pb-btn" onClick={onDec} title="Decrease">−</button>
                <output className="hp-display" aria-live="polite">{count}</output>
                <button className="pb-btn" onClick={onInc} title="Increase">+</button>
                <button
                    type="button"
                    className="pb-custom-remove"
                    title="Remove this tracker"
                    aria-label="Remove tracker"
                    onClick={onRemove}
                >
                    ×
                </button>
            </div>
        </div>
    );
}

function CustomTrackers() {
    const [rows, setRows] = React.useState([{ id: 1, label: '', count: 0 }]);

    const addRow = () => {
        setRows((prev) => {
            const nextId = prev.length ? Math.max(...prev.map(r => r.id)) + 1 : 1;
            return [...prev, { id: nextId, label: '', count: 0 }];
        });
    };

    const removeRow = (id) => {
        setRows((prev) => prev.filter(r => r.id !== id));
    };

    const updateLabel = (id, label) =>
        setRows((prev) => prev.map(r => (r.id === id ? { ...r, label } : r)));

    const inc = (id) =>
        setRows((prev) => prev.map(r => (r.id === id ? { ...r, count: r.count + 1 } : r)));

    const dec = (id) =>
        setRows((prev) => prev.map(r => (r.id === id ? { ...r, count: Math.max(0, r.count - 1) } : r)));

    return (
        <section className="pb-section">
            <div className="pb-section-title pb-custom-header">
                <span>Custom Trackers</span>
                <button
                    type="button"
                    className="pb-custom-add"
                    title="Add a custom tracker"
                    onClick={addRow}
                    aria-label="Add custom tracker"
                >
                    +
                </button>
            </div>

            <div className="pb-custom-list">
                {rows.map((r) => (
                    <CustomTrackerRow
                        key={r.id}
                        label={r.label}
                        count={r.count}
                        onLabel={(v) => updateLabel(r.id, v)}
                        onInc={() => inc(r.id)}
                        onDec={() => dec(r.id)}
                        onRemove={() => removeRow(r.id)}
                    />
                ))}
            </div>
        </section>
    );
}

// ---------- Left Panel: Card/Token Galleries ----------
function LeftPanelGalleries() {
    const [open, setOpen] = React.useState(null); // 'cards' | 'tokens' | null
    const [cards, setCards] = React.useState(null);
    const [tokens, setTokens] = React.useState(null);

    const openCards = async () => {
        if (!cards) {
            try { setCards(await fetchJson(DATA_ENDPOINTS.cards)); }
            catch (e) { console.warn('[playtest-board] failed to load cards.json', e); setCards([]); }
        }
        setOpen('cards');
    };

    const openTokens = async () => {
        if (!tokens) {
            try { setTokens(await fetchJson(DATA_ENDPOINTS.tokens)); }
            catch (e) { console.warn('[playtest-board] failed to load tokens.json', e); setTokens([]); }
        }
        setOpen('tokens');
    };

    const openEncounter = async () => {
        if (!tokens) {
            try { setTokens(await fetchJson(DATA_ENDPOINTS.tokens)); }
            catch (e) { console.warn('[playtest-board] failed to load tokens.json', e); setTokens([]); }
        }
        setOpen('encounter');
    };

    return (
        <section className="pb-section">
            <div className="pb-section-title">Galleries</div>
            <div className="pb-actions pb-gallery-actions">
                <button className="tips-btn" onClick={openCards}>Card Gallery</button>
                <button className="tips-btn" onClick={openTokens}>Token Gallery</button>
            </div>

            {/* NEW: full-width Encounter Generator button */}
            <div className="pb-encounter-wrap">
                <button
                    className="tips-btn pb-encounter-btn"
                    onClick={openEncounter}
                    title="Open Encounter Generator"
                >
                    Encounter Generator
                </button>
            </div>

            {open === 'cards' && (
                <GalleryModal
                    title="All Cards"
                    items={Array.isArray(cards) ? cards : cards?.Cards || []}
                    onClose={() => setOpen(null)}
                />
            )}
            {open === 'tokens' && (
                <GalleryModal
                    title="All Tokens"
                    items={Array.isArray(tokens) ? tokens : tokens?.Tokens || []}
                    onClose={() => setOpen(null)}
                />
            )}

            {/* NEW: Encounter Modal (filters + up to 3 random tokens) */}
            {open === 'encounter' && (
                <EncounterModal
                    tokens={Array.isArray(tokens) ? tokens : tokens?.Tokens || []}
                    onClose={() => setOpen(null)}
                />
            )}
        </section>
    );
}

// ---------- Help buttons (from /src/plugins/help-section.jsx) ----------
function LeftPanelHelp() {
    const [Renderer, setRenderer] = React.useState(null);
    const rootRef = React.useRef(null);

    React.useEffect(() => {
        const host = {
            registerHelpSectionRenderer({ render }) {
                setRenderer(() => render);
            },
        };
        try { registerHelpSection(host); }
        catch (e) { console.warn('[playtest-board] help-section init failed:', e); }
    }, []);

    // After the renderer mounts, replace "Tips & Features" with a disabled placeholder
    React.useEffect(() => {
        if (!Renderer) return;
        const root = rootRef.current;
        if (!root) return;

        // Run after the inner HelpSection has painted
        const id = setTimeout(() => {
            // Find the Tips & Features button by visible text
            const btns = Array.from(root.querySelectorAll('button'));
            const tipsBtn = btns.find(b => b.textContent?.trim().toLowerCase() === 'tips & features');
            if (!tipsBtn) return;
            const controls = tipsBtn.closest('.controls');
            const grid = controls?.parentElement;
            if (!controls || !grid) return;

            // Build a placeholder in the same "controls" wrapper
            const dummy = controls.cloneNode(true);
            const dBtn = dummy.querySelector('button');
            if (dBtn) {
                dBtn.textContent = 'Placeholder';
                dBtn.title = 'Coming soon';
                dBtn.disabled = true;         // clearly a dummy
                dBtn.onclick = null;
            }

            // Insert dummy where Tips & Features was, then remove the original
            grid.insertBefore(dummy, controls);
            controls.remove();
        }, 0);

        return () => clearTimeout(id);
    }, [Renderer]);

    if (!Renderer) return null;
    return (
        <div className="pb-help-footer" ref={rootRef}>
            <Renderer />
        </div>
    );
}

// ---------- Turn structure + interactive tracker ----------
// You can rename labels or reorder/insert steps later; the UI renders from this data.
const TURN_STRUCTURE = [
    {
        key: 'start',
        label: 'Start Phase',
        steps: [
            'Ready Step',
            'Draw Step',
            'Produce Step',
            'Start Step',
        ],
    },
    {
        key: 'main',
        label: 'Main Phase',
        steps: [], // Main Phase is highlighted by itself (no step highlight)
    },
    {
        key: 'battle',
        label: 'Battle Phase',
        steps: [
            'Start of Battle Step',
            'Declare Attacker Step',
            'Declare Blocker Step',
            'Reaction Step',
            'Active Player Step',
            'Inactive Player Step',
            'Resolution Step',
            'Closure Step',
        ],
    },
    {
        key: 'end',
        label: 'End Phase',
        steps: [
            'Start of End Step',
            'Refund Step',
            'Cleanup Step',
        ],
    },
];

/**
 * TurnTracker: shows phases horizontally, and (if applicable) the steps of the
 * currently selected phase below it. Clicking a phase or step moves selection.
 *
 * Selection model:
 *   { phase: number, step: number|null }
 *   - For phases with steps: both the phase and step are highlighted together.
 *   - For Main Phase (no steps): only the phase is highlighted.
 */
function TurnTracker({ sel, setPhase, setStep }) {
    const current = TURN_STRUCTURE[sel.phase];
    return (
        <nav className="turnbar" aria-label="Turn Phase Tracker">
            <div className="turnbar-row phases-inline" role="tablist" aria-label="Phases and Steps">
                {TURN_STRUCTURE.map((p, i) => {
                    const active = i === sel.phase;
                    return (
                        <React.Fragment key={p.key}>
                            <button
                                className={`tb-pill phase${active ? ' active' : ''}`}
                                role="tab"
                                aria-selected={active}
                                onClick={() => {
                                    const has = p.steps.length > 0;
                                    setPhase(i, has ? 0 : null);
                                }}
                                title={p.label}
                            >
                                <span className="tb-label">{p.label}</span>
                            </button>

                            {active && p.steps.length > 0 && (
                                <div className="tb-steps-inline" role="group" aria-label={`${p.label} Steps`}>
                                    {p.steps.map((s, si) => {
                                        const isActiveStep = si === sel.step;
                                        const letter = String.fromCharCode(97 + si); // a..z
                                        const shortLabel = s.replace(/\s*Step$/, '');
                                        return (
                                            <button
                                                key={`${p.key}-s${si}`}
                                                className={`tb-pill step${isActiveStep ? ' active' : ''}`}
                                                role="tab"
                                                aria-selected={isActiveStep}
                                                onClick={() => setStep(i, si)}
                                                title={s}
                                            >
                                                <span className="tb-step-index">{letter})</span>
                                                <span className="tb-label">{shortLabel}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {i < TURN_STRUCTURE.length - 1 && <span className="tb-divider" aria-hidden="true" />}
                        </React.Fragment>
                    );
                })}
            </div>
        </nav>
    );
}

// Compute the next selection in-order through steps and phases.
// If at the very end, wrap to Start Phase → first step.
function nextSelection(sel) {
    const p = TURN_STRUCTURE[sel.phase];
    const hasSteps = p.steps.length > 0;

    // If phase has steps and we aren't at the last one, advance step
    if (hasSteps && sel.step !== null && sel.step < p.steps.length - 1) {
        return { phase: sel.phase, step: sel.step + 1 };
    }

    // Otherwise, go to the first step (or no-step) of the next phase
    const nextPhase = (sel.phase + 1) % TURN_STRUCTURE.length;
    const np = TURN_STRUCTURE[nextPhase];
    return { phase: nextPhase, step: np.steps.length ? 0 : null };
}

// Jump to End Phase if not there; if already in End Phase, jump to Start Phase → first step.
function endTurnSelection(sel) {
    const endIdx = TURN_STRUCTURE.findIndex(p => p.key === 'end');
    if (sel.phase === endIdx) {
        // From anywhere in End Phase, go back to the beginning of the turn
        return { phase: 0, step: TURN_STRUCTURE[0].steps.length ? 0 : null };
    }
    // Jump to start of End Phase
    const ep = TURN_STRUCTURE[endIdx];
    return { phase: endIdx, step: ep.steps.length ? 0 : null };
}

function TurnControls({ onNext, onEndTurn }) {
    return (
        <div className="turn-controls" role="group" aria-label="Turn Controls">
            <button className="pb-btn" onClick={onNext} title="Next step/phase">Next</button>
            <button className="pb-btn" onClick={onEndTurn} title="End Turn">End Turn</button>
        </div>
    );
}

function TurnsTracker({ turn, onInc, onDec, canEdit }) {
    return (
        <div className="turns-tracker" role="group" aria-label="Turns Tracker">
            <span className="tt-label">Turn</span>
            <button className="pb-btn" title="Decrease Turn" onClick={onDec} disabled={!canEdit}>−</button>
            <span className="tt-display" aria-live="polite">{turn}</span>
            <button className="pb-btn" title="Increase Turn" onClick={onInc} disabled={!canEdit}>+</button>
        </div>
    );
}

/**
 * TurnBar: holds selection state and renders tracker + controls.
 * Kept separate so you can later persist `sel` to localStorage or broadcast via context.
 */
function TurnBar({ goingFirst = 'yes', opponentBoard = 'no' }) {
    // Default to Start Phase → Ready Step
    const [sel, setSel] = React.useState({ phase: 0, step: 0 });

    // Turn indicator: "Your Turn" vs "Opponent Turn"
    const [isYourTurn, setIsYourTurn] = React.useState(goingFirst === 'yes');

    // EMIT: announce when a phase/step is entered (used by auto-ready)
    React.useEffect(() => {
        const phase = TURN_STRUCTURE[sel.phase];
        const stepLabel = phase?.steps?.length ? phase.steps[sel.step] : null;
        window.dispatchEvent(new CustomEvent('pb:turn:entered', {
            detail: {
                phaseKey: phase?.key,
                phaseLabel: phase?.label,
                stepIndex: sel.step,
                stepLabel,
                isYourTurn, // NEW: expose current turn owner for gating auto actions
            }
        }));
    }, [sel, isYourTurn]);

    const [turnCount, setTurnCount] = React.useState(1);
    const [overrideTurn, setOverrideTurn] = React.useState(false);

    // Reset indicator when "Going First" changes
    React.useEffect(() => {
        setIsYourTurn(goingFirst === 'yes');
    }, [goingFirst]);

    // Flip indicator each time the turn wraps from End → Start (we already dispatch 'pb:turn:wrapped')
    React.useEffect(() => {
        const flip = () => setIsYourTurn(prev => !prev);
        window.addEventListener('pb:turn:wrapped', flip);

        const onReset = () => setIsYourTurn(goingFirst === 'yes');
        window.addEventListener('pb:new-game', onReset);

        return () => {
            window.removeEventListener('pb:turn:wrapped', flip);
            window.removeEventListener('pb:new-game', onReset);
        };
    }, [goingFirst]);

    const setPhase = (pIdx, stepIdx = null) => {
        const p = TURN_STRUCTURE[pIdx];
        setSel({ phase: pIdx, step: p.steps.length ? (stepIdx ?? 0) : null });
    };

    const setStep = (_pIdx, sIdx) => {
        setSel((cur) => ({ phase: cur.phase, step: sIdx }));
    };

    const isStartPhase = (s) => s?.phase === 0 && (s?.step === 0 || s?.step === null);

    const onNext = () => setSel((cur) => {
        const next = nextSelection(cur);
        if (isStartPhase(next)) {
            // When Opponent Board is on, only increment on the specified pill change:
            // - Going First YES: Opponent → Your (isYourTurn was false, becomes true)
            // - Going First  NO: Your → Opponent (isYourTurn was true, becomes false)
            if (opponentBoard === 'yes') {
                const inc =
                    (goingFirst === 'yes' && !isYourTurn) ||
                    (goingFirst === 'no' && isYourTurn);
                if (inc) setTurnCount((t) => t + 1);
            } else {
                // Old behavior when Opponent Board is off
                setTurnCount((t) => t + 1);
            }
            window.dispatchEvent(new CustomEvent('pb:turn:wrapped'));
        }
        return next;
    });

    const onEndTurn = () => setSel((cur) => {
        const next = endTurnSelection(cur);
        if (isStartPhase(next)) {
            if (opponentBoard === 'yes') {
                const inc =
                    (goingFirst === 'yes' && !isYourTurn) ||
                    (goingFirst === 'no' && isYourTurn);
                if (inc) setTurnCount((t) => t + 1);
            } else {
                setTurnCount((t) => t + 1);
            }
            window.dispatchEvent(new CustomEvent('pb:turn:wrapped'));
        }
        return next;
    });

    // Bridge "Next/End Turn" from other UI (e.g., right-panel footer) without lifting state
    React.useEffect(() => {
        const onNextEvt = () => onNext();
        const onEndEvt = () => onEndTurn();
        window.addEventListener('pb:turn:next', onNextEvt);
        window.addEventListener('pb:turn:end', onEndEvt);
        return () => {
            window.removeEventListener('pb:turn:next', onNextEvt);
            window.removeEventListener('pb:turn:end', onEndEvt);
        };
    }, [onNext, onEndTurn]);

    React.useEffect(() => {
        const onReset = () => {
            setSel({ phase: 0, step: 0 });
            setTurnCount(1);
            setOverrideTurn(false);
        };
        window.addEventListener('pb:new-game', onReset);
        return () => window.removeEventListener('pb:new-game', onReset);
    }, []);

    // NEW: publish the current turn count for other modules (e.g., Draw Step gating)
    React.useEffect(() => {
        window.__PB_TURN_COUNT = turnCount;
        return () => {
            // avoid stale value if component unmounts
            if (window.__PB_TURN_COUNT === turnCount) window.__PB_TURN_COUNT = undefined;
        };
    }, [turnCount]);

    return (
        <div className="pb-subheader-inner">
            <div className="pb-subheader-left">
                <div className="turns-left-wrap">
                    <TurnsTracker
                        turn={turnCount}
                        onInc={() => setTurnCount((t) => t + 1)}
                        onDec={() => setTurnCount((t) => Math.max(1, t - 1))}
                        canEdit={overrideTurn}
                    />
                    <label className="tt-override" title="Allow manual +/- on Turn counter">
                        <input
                            type="checkbox"
                            checked={overrideTurn}
                            onChange={(e) => setOverrideTurn(e.target.checked)}
                        />
                        <span>Override</span>
                    </label>
                    {opponentBoard === 'yes' && (
                        <span
                            className={`tt-turn-indicator ${isYourTurn ? 'is-yours' : 'is-opponent'}`}
                            aria-live="polite"
                        >
                            {isYourTurn ? 'Your Turn' : 'Opponent Turn'}
                        </span>
                    )}
                </div>
            </div>

            <div className="pb-subheader-center">
                <TurnTracker sel={sel} setPhase={setPhase} setStep={setStep} />
            </div>

            <div className="pb-subheader-right">
                <TurnControls onNext={onNext} onEndTurn={onEndTurn} />
            </div>
        </div>
    );
}

/**
 * PlaytestBoard
 * Step 1: header only (title on the left, Return to Menu on the right),
 * styled to match pack-simulator's header.
 */
export function PlaytestBoard() {
  // Preload data/assets for future steps (no UI change)
  usePlaytestAssets();

    // ADD: format selector state
    const [formats, setFormats] = React.useState([]);
    const [formatId, setFormatId] = React.useState('Freeform');
    const [depthLevels, setDepthLevels] = React.useState(null);

    // Depth baseline: deck size AFTER opening hand is drawn
    const [openingDeckCount, setOpeningDeckCount] = React.useState(null);
    const [openingODeckCount, setOpeningODeckCount] = React.useState(null);
    // Track whether the user has imported a deck this session
    const [hasImportedDeck, setHasImportedDeck] = React.useState(false);

    // ADD: global Card Zoom toggle (default: on)
    const [zoomEnabled, setZoomEnabled] = React.useState(true);

    const [hoverEnabled, setHoverEnabled] = React.useState(false);

    // NEW: Going First? (default Yes)
    const [goingFirst, setGoingFirst] = React.useState('yes');
    const [opponentBoard, setOpponentBoard] = useState('no');

    // Right panel owner view: 'player' | 'opponent'
    const [rightOwner, setRightOwner] = React.useState('player');

    // ADD: collapsible hand state (only used when opponentBoard === 'yes')
    const [handCollapsed, setHandCollapsed] = React.useState(false);

    React.useEffect(() => {
        // Always start expanded; collapse is user-driven only.
        setHandCollapsed(false);
    }, []);

    // If Opponent Board is turned off, auto-expand the hand
    React.useEffect(() => {
        // Any time Opponent Board is toggled (on or off), reset to expanded
        setHandCollapsed(false);
    }, [opponentBoard]);

    // If Opponent Board is hidden, force the right panel back to Player
    React.useEffect(() => {
        if (opponentBoard !== 'yes') setRightOwner('player');
    }, [opponentBoard]);

    React.useEffect(() => {
        document.body.classList.toggle('hp-disabled', !hoverEnabled);
    }, [hoverEnabled]);

    // --- Importer state (partner + deck pile + meta) ---
    const [partnerId, setPartnerId] = React.useState(null);
    const [deckPile, setDeckPile] = React.useState([]); // array of InternalName (expanded)
    const [shieldPile, setShieldPile] = React.useState([]); // NEW: face-down Shield stack
    const [banishPile, setBanishPile] = React.useState([]); // NEW: face-up Banish stack (top at index 0)
    const [gravePile, setGravePile] = React.useState([]); // NEW: face-up Grave stack (top at index 0)
    const fileInputRef = React.useRef(null);

    // Opponent piles + hand (separate from player)
    const [oDeckPile, setODeckPile] = React.useState([]);
    const [oShieldPile, setOShieldPile] = React.useState([]);
    const [oBanishPile, setOBanishPile] = React.useState([]);
    const [oGravePile, setOGravePile] = React.useState([]);
    const [oHand, setOHand] = React.useState([]);

    // Track opponent's partner id (base id with _a/_b suffix allowed)
    const [oPartnerId, setOPartnerId] = React.useState(null);

    // NEW: Hand + Mulligan state
    const [hand, setHand] = React.useState([]);
    const [showMulligan, setShowMulligan] = React.useState(false);
    const [deckCounts, setDeckCounts] = React.useState(new Map());
    const [dataMaps, setDataMaps] = React.useState({
        cardsById: new Map(),
        partnersById: new Map(),
        tokensById: new Map(),
    });

    // Opponent: mulligan state + file input for import
    const [showOMulligan, setShowOMulligan] = React.useState(false);
    const [pendingOMulligan, setPendingOMulligan] = React.useState(false);
    const [oDeckCounts, setODeckCounts] = React.useState(new Map());
    const oFileInputRef = React.useRef(null);
    // Capture the "opening hand" baseline the first time a hand becomes non-empty.
    // Depth is measured as cards drawn since that moment: (openingDeckCount - currentDeckCount).
    const __prevHandLenRef = React.useRef(0);
    React.useEffect(() => {
        if (openingDeckCount == null && __prevHandLenRef.current === 0 && hand.length > 0) {
            setOpeningDeckCount(deckPile.length);
        }
        __prevHandLenRef.current = hand.length;
    }, [hand.length, deckPile.length, openingDeckCount]);

    const __prevOHandLenRef = React.useRef(0);
    React.useEffect(() => {
        if (openingODeckCount == null && __prevOHandLenRef.current === 0 && oHand.length > 0) {
            setOpeningODeckCount(oDeckPile.length);
        }
        __prevOHandLenRef.current = oHand.length;
    }, [oHand.length, oDeckPile.length, openingODeckCount]);

    // Build the visible element set for the right panel (Partner's elements + Neutral)
    // When no deck has been imported, return null to show all trackers.
    const partnerVisibleElements = React.useMemo(() => {
        if (!hasImportedDeck || !partnerId) return null;

        const partner =
            dataMaps?.partnersById?.get?.(partnerId) ||
            (dataMaps?.partnersById && dataMaps.partnersById[partnerId]) ||
            null;

        if (!partner) return null;

        const set = new Set(['Neutral']);
        [partner.ElementType1, partner.ElementType2, partner.ElementType3]
            .filter(Boolean)
            .forEach((el) => set.add(el));
        return set;
    }, [hasImportedDeck, partnerId, dataMaps]);

    const oPartnerVisibleElements = React.useMemo(() => {
        if (!oPartnerId) return null;
        const partner =
            dataMaps?.partnersById?.get?.(oPartnerId) ||
            (dataMaps?.partnersById && dataMaps.partnersById[oPartnerId]) ||
            null;
        if (!partner) return null;
        const set = new Set(['Neutral']);
        [partner.ElementType1, partner.ElementType2, partner.ElementType3]
            .filter(Boolean)
            .forEach((el) => set.add(el));
        return set;
    }, [oPartnerId, dataMaps]);

    // Click -> open file chooser
    const onImportClick = () => fileInputRef.current?.click();

    // Helper to load all runtime data maps
    async function loadMaps(signal) {
        const data = await loadPlaytestData(signal);
        return {
            cardsById: data.maps.cardsById,
            partnersById: data.maps.partnersById,
            tokensById: data.maps.tokensById,
        };
    }

    // ADD THIS ⬇️ (preload base maps so stats work without a deck import)
    React.useEffect(() => {
        let alive = true;
        const ctrl = new AbortController();
        loadMaps(ctrl.signal)
            .then((maps) => { if (alive) setDataMaps(maps); })
            .catch((err) => {
                if (err?.name !== 'AbortError') {
                    console.warn('[playtest-board] Base maps load failed:', err);
                }
            });
        return () => { alive = false; ctrl.abort(); };
    }, []);

    // Build image src
    const imgSrc = (id, side = 'a') => getImagePath(id, side);

    // File input change -> parse + map schema
    const onFileChosen = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        let json;
        try {
            const text = await file.text();
            json = JSON.parse(text);
        } catch (err) {
            alert(`Invalid or corrupt JSON: ${err?.message || err}`);
            e.target.value = '';
            return;
        }

        // Expecting Map schema { name, formatId, list: { id:count, ... }, maybe? }
        const list = json?.list && typeof json.list === 'object' ? json.list : null;
        if (!list) {
            alert('Import error: expected a "list" object (Map schema).');
            e.target.value = '';
            return;
        }

        /* NEW: format check — ask to switch or cancel */
        const deckFormat = json?.formatId ?? 'Freeform';
        if (deckFormat && deckFormat !== formatId) {
            const ok = window.confirm(
                `This deck is format "${deckFormat}", but the current Format is "${formatId}".\n\n` +
                `Switch to "${deckFormat}" and continue? Click "Cancel" to abort the import.`
            );
            if (!ok) {
                e.target.value = '';
                return;
            }
            setFormatId(deckFormat);
        }

        // Load data maps
        let maps;
        try {
            const ctrl = new AbortController();
            maps = await loadMaps(ctrl.signal);
        } catch (err) {
            alert(`Failed loading data: ${err?.message || err}`);
            e.target.value = '';
            return;
        }

        const { cardsById, partnersById, tokensById } = maps;

        // Detect partners present among keys
        const keys = Object.keys(list);
        const partnerCandidates = keys.filter(k => partnersById.has(k));

        if (partnerCandidates.length === 0) {
            alert('Deck requires a partner.');
            e.target.value = '';
            return;
        }
        if (partnerCandidates.length > 1) {
            alert(`Multiple partners found; using ${partnerCandidates[0]}`);
        }
        const chosenPartner = partnerCandidates[0];

        // Build deck pile (expand counts), skipping:
        // - partner itself (and toast if it appears in main list)
        // - tokens.json entries
        // - unknown IDs (count and toast once)
        let skippedUnknown = 0;
        let skippedPartnerCount = 0;

        const expanded = [];
        for (const id of keys) {
            const count = Number(list[id]) || 0;
            if (count <= 0) continue;

            // Skip partner (not part of deck)
            if (id === chosenPartner) {
                skippedPartnerCount += count;
                continue;
            }

            // Skip tokens
            if (tokensById.has(id)) {
                continue;
            }

            // Only include IDs that resolve in cards.json
            if (!cardsById.has(id)) {
                skippedUnknown += count;
                continue;
            }

            // Expand
            for (let i = 0; i < count; i++) expanded.push(id);
        }

        if (skippedPartnerCount > 1) {
            alert(`Skipped partner from main: ${chosenPartner} (count ${skippedPartnerCount})`);
        } else if (skippedPartnerCount === 1) {
            // Expected: single partner lives in list but is removed from main and set to Partner Zone
            console.info(`[playtest-board] Removed partner from main (as designed): ${chosenPartner}`);
        }
        if (skippedUnknown > 0) {
            alert(`(skipped ${skippedUnknown} unknown IDs)`);
        }

        // Allow empty/zero-count mainboard
        setPartnerId(chosenPartner);
        // Shuffle the deck (Fisher–Yates)
        for (let i = expanded.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [expanded[i], expanded[j]] = [expanded[j], expanded[i]];
        }

        // Build counts for Mulligan selector (unique cards excluding partner/tokens)
        const counts = new Map();
        for (const id of expanded) counts.set(id, (counts.get(id) || 0) + 1);

        setDeckPile(expanded);
        setDeckCounts(counts);
        setDataMaps({ cardsById, partnersById, tokensById });

        // mark that a deck has been imported (used for Return to Menu confirm)
        setHasImportedDeck(true);

        // Open Mulligan UI
        setShowMulligan(true);

        // optional: you may want to keep meta for future features
        // setFormatId(json?.formatId || 'Freeform'); // uncomment if you want to auto-select format from import

        // reset file input so the same file can be chosen again later
        e.target.value = '';
    };

    // Opponent: file input change -> parse + map schema (mirrors onFileChosen)
    const onOFileChosen = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        let json;
        try {
            const text = await file.text();
            json = JSON.parse(text);
        } catch (err) {
            alert(`Invalid or corrupt JSON: ${err?.message || err}`);
            e.target.value = '';
            return;
        }

        // Expecting Map schema { name, formatId, list: { id:count, ... } }
        const list = json?.list && typeof json.list === 'object' ? json.list : null;
        if (!list) {
            alert('Import error: expected a "list" object (Map schema).');
            e.target.value = '';
            return;
        }

        // Opponent import: hard-block on format mismatch (warn & abort; do NOT auto-switch board format)
        const deckFormat = (json?.formatId ?? json?.FormatId ?? 'Freeform');
        if (deckFormat !== formatId) {
            alert(
                `Opponent deck format "${deckFormat}" does not match the selected board format "${formatId}".\n\n` +
                `Import canceled. Change the board format first or choose a deck with a matching format.`
            );
            e.target.value = ''; // reset file input so user can pick another file
            return;              // stop import
        }

        // Load maps (cards/partners/tokens)
        let maps;
        try {
            maps = await loadMaps();
        } catch (err) {
            alert(`Failed to load card data: ${err?.message || err}`);
            e.target.value = '';
            return;
        }

        const { cardsById, partnersById, tokensById } = maps;

        // Detect partner
        const keys = Object.keys(list);
        const partnerCandidates = keys.filter((k) => partnersById.has(k));
        if (partnerCandidates.length === 0) {
            alert('Deck requires a partner.');
            e.target.value = '';
            return;
        }
        if (partnerCandidates.length > 1) {
            alert(`Multiple partners found; using ${partnerCandidates[0]}`);
        }
        const chosenPartner = partnerCandidates[0];

        // Build expanded deck for opponent (skip partner/tokens/unknown like user import)
        let skippedUnknown = 0;
        let skippedPartnerCount = 0;

        const expanded = [];
        for (const id of keys) {
            const count = Number(list[id]) || 0;
            if (count <= 0) continue;

            if (id === chosenPartner) {
                skippedPartnerCount += count;
                continue;
            }
            if (tokensById.has(id)) continue;

            if (!cardsById.has(id) && !tokensById.has(id) && !partnersById.has(id)) {
                skippedUnknown += count;
                continue;
            }

            for (let i = 0; i < count; i++) expanded.push(id);
        }

        if (skippedPartnerCount > 1) {
            alert(`Skipped partner from main: ${chosenPartner} (count ${skippedPartnerCount})`);
        } else if (skippedPartnerCount === 1) {
            console.info(`[playtest-board] Removed opponent partner from main (as designed): ${chosenPartner}`);
        }
        if (skippedUnknown > 0) {
            alert(`(skipped ${skippedUnknown} unknown IDs)`);
        }

        // Shuffle (Fisher–Yates)
        for (let i = expanded.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [expanded[i], expanded[j]] = [expanded[j], expanded[i]];
        }

        // Counts for Mulligan selector
        const counts = new Map();
        for (const id of expanded) counts.set(id, (counts.get(id) || 0) + 1);

        // Write opponent state: piles/hand/partner slot
        setODeckPile(expanded);
        setODeckCounts(counts);
        setOHand([]);

        setOBanishPile([]);  // clear stacks
        setOShieldPile([]);
        setOGravePile([]);

        // Place opponent partner in its zone and reset its side to 'a'
        setBoardSlots((prev) => ({ ...prev, opartner: chosenPartner }));
        setSlotSides((prev) => ({ ...prev, opartner: 'a' }));
        setOPartnerId(chosenPartner);

        // Use already-loaded maps for lookups in UI
        setDataMaps({ cardsById, partnersById, tokensById });

        // Open opponent mulligan
        setShowOMulligan(true);

        // reset input so re-selecting the same file works later
        e.target.value = '';
    };

    // Start a new game with the same imported deck (reshuffle + full reset)
    const onNewGame = () => {
        if (!hasImportedDeck) return;
        const ok = window.confirm(
            'Start a new game?\n\nYour current playtest state will be cleared and the same deck will be reloaded.'
        );
        if (!ok) return;

        // --- Player: rebuild fresh shuffled deck from original counts
        const expanded = [];
        deckCounts.forEach((n, id) => { for (let i = 0; i < n; i++) expanded.push(id); });
        for (let i = expanded.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [expanded[i], expanded[j]] = [expanded[j], expanded[i]];
        }

        // --- Opponent: rebuild fresh shuffled deck if they imported one
        let oExpanded = [];
        if (oDeckCounts && typeof oDeckCounts.forEach === 'function' && oDeckCounts.size > 0) {
            oExpanded = [];
            oDeckCounts.forEach((n, id) => { for (let i = 0; i < n; i++) oExpanded.push(id); });
            for (let i = oExpanded.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [oExpanded[i], oExpanded[j]] = [oExpanded[j], oExpanded[i]];
            }
        }

        // Reset all board state (player + opponent)
        setDeckPile(expanded);
        setShieldPile([]);
        setBanishPile([]);
        setGravePile([]);
        // Reset Depth baselines (will be recaptured after opening hands are drawn)
        setOpeningDeckCount(null);
        setOpeningODeckCount(null);
        setHand([]);

        // Opponent piles
        if (oExpanded.length > 0) {
            setODeckPile(oExpanded);
            setOHand([]);
            setOShieldPile([]);
            setOBanishPile([]);
            setOGravePile([]);
        } else {
            // Even if no opponent deck was imported, clear visible opponent piles
            setODeckPile([]);
            setOHand([]);
            setOShieldPile([]);
            setOBanishPile([]);
            setOGravePile([]);
        }

        // Clear all slots, then re-seat opponent partner in its slot (front side)
        setBoardSlots(() => (oPartnerId ? { opartner: oPartnerId } : {}));
        setSlotSides(prev => ({ ...prev, opartner: 'a' }));

        // Open user Mulligan now; defer opponent Mulligan until user closes theirs
        setPendingOMulligan(oExpanded.length > 0);
        setShowMulligan(true);

        // UI cleanup
        setHoverSlot(null);
        setDragIdx(null);
        setExhaustedSlots(new Set());

        // Notify other modules to reset
        window.dispatchEvent(new Event('pb:new-game'));
    };

    const onResetAll = () => {
        if (!hasImportedDeck) return;
        const ok = window.confirm(
            'Reset and remove imported deck?\n\nThis will clear your playtest state and return to the initial page state.'
        );
        if (!ok) return;

        // Clear all piles/board/hand (no deck) — PLAYER
        setPartnerId(null);
        setDeckPile([]);
        setShieldPile([]);
        setBanishPile([]);
        setGravePile([]);
        setBoardSlots({});
        // Reset Depth baselines
        setOpeningDeckCount(null);
        setOpeningODeckCount(null);
        setHand([]);

        // Clear all piles/hand — OPPONENT
        setOPartnerId(null);
        setODeckPile([]);
        setOShieldPile([]);
        setOBanishPile([]);
        setOGravePile([]);
        setOHand([]);

        // Close mulligans, clear counts/maps/flags
        setShowMulligan(false);
        setShowOMulligan(false);
        setPendingOMulligan(false);
        setDeckCounts(new Map());
        setODeckCounts(new Map());
        // Keep runtime data maps loaded (do not clear) so Unit stat labels still show without a deck.
        setHasImportedDeck(false);

        // Reset Format selector to default (Freeform → else first in list)
        setFormatId((formats && formats.includes && formats.includes('Freeform')) ? 'Freeform' : (formats?.[0] || 'Freeform'));

        // Clear any transient UI state
        setHoverSlot(null);
        setDragIdx(null);
        setExhaustedSlots(new Set());

        // Let other modules (turns/hp/resources/refund) reset themselves
        window.dispatchEvent(new Event('pb:new-game'));
    };

    React.useEffect(() => {
        const prev = window.__PB_DISABLE_HELP_SHORTCUTS;
        window.__PB_DISABLE_HELP_SHORTCUTS = true;
        return () => { window.__PB_DISABLE_HELP_SHORTCUTS = prev; };
    }, []);

    // Load formats from /reference.json once
    React.useEffect(() => {
        let alive = true;
        fetch('/reference.json')
            .then(r => r.json())
            .then(json => {
                if (!alive) return;
                const list = Array.isArray(json?.Format) ? json.Format : [];
                setFormats(list);

                const ro = Array.isArray(json?.Ransack?.Options) ? json.Ransack.Options : [];
                setRansackOptions(ro);

                const dl = json?.DepthLevels || null;
                setDepthLevels(dl);

                // Default to "Freeform" if available; otherwise first in list
                if (!formatId) {
                    const preferred = list.includes('Freeform') ? 'Freeform' : (list[0] || '');
                    setFormatId(preferred);
                }
            })
            .catch(() => { });
        return () => { alive = false; };
    }, []);

    // [ADD] Hand drag & drop (reorder)
    const [dragIdx, setDragIdx] = React.useState(null);
    // Hand DnD handlers now provided by usePlaytestBoardDragNDown(...)
    // [ADD] Board placements (unit/support slots hold 1 card by InternalName)
    const [boardSlots, setBoardSlots] = React.useState({}); // keys: u1..u7, s1..s7
    const [hoverSlot, setHoverSlot] = React.useState(null);
    const [slotSides, setSlotSides] = React.useState({}); // key -> 'a' | 'b'
    const [partnerSide, setPartnerSide] = React.useState('a');
    // ADD — battle role flag per battle slot (e.g., b3: 'attacker')
    const [battleRole, setBattleRole] = React.useState({});
    const battleRoleRef = React.useRef(battleRole);
    React.useEffect(() => { battleRoleRef.current = battleRole; }, [battleRole]);
    // NEW: per-slot counters (future-proof for rules applying to counters)
    const [slotCounters, setSlotCounters] = React.useState({}); // { [slotKey]: { [counterId]: number } }
    const [slotLabels, setSlotLabels] = React.useState({}); // { [slotKey]: string[] }
    // NEW: per-slot resource hoards (element InternalName -> number)
    const [slotResources, setSlotResources] = React.useState({}); // { [slotKey]: { [internalName]: number } }
    // Live ref so step/phase listeners can read latest counters without stale closures
    const slotCountersRef = React.useRef(slotCounters);
    React.useEffect(() => { slotCountersRef.current = slotCounters; }, [slotCounters]);
    // NEW: counter definitions (from keywords.json where IsCounter === "True")
    const [counterDefs, setCounterDefs] = React.useState([]);   // [{ id, name, isStatus }]
    // NEW: modal state for editing a slot's counters
    const [counterPrompt, setCounterPrompt] = React.useState(null); // { slotKey, counts: {id: n} } | null
    // NEW: modal state for editing a slot's hoards
    const [resourcePrompt, setResourcePrompt] = React.useState(null); // { slotKey, counts: {internalName: n} } | null
    const [healPrompt, setHealPrompt] = React.useState(null); // { slotKey, x, damage, statuses } | null
    // ===== Ransack =====
    const [ransackOptions, setRansackOptions] = React.useState([]); // from /reference.json
    const [ransackCounts, setRansackCounts] = React.useState([0, 0, 0, 0, 0, 0]);     // player
    const [oRansackCounts, setORansackCounts] = React.useState([0, 0, 0, 0, 0, 0]);   // opponent
    const [ransackPrompt, setRansackPrompt] = React.useState(null); // { owner, slotKey, rolls, pick } | null
    // Opens the Modify Stat modal when context menu fires 'modify_stat'
    const [statPrompt, setStatPrompt] = React.useState(null); // { slotKey, stat, op, amount } | null
    const [damagePrompt, setDamagePrompt] = React.useState(null); // { slotKey } | null
    const [addLabelPrompt, setAddLabelPrompt] = React.useState(null);       // { slotKey } | null
    const [removeLabelPrompt, setRemoveLabelPrompt] = React.useState(null); // { slotKey, labels: string[] } | null
    // Per-slot modifiers for Units/Battle slots
    const [statMods, setStatMods] = React.useState({}); // { [slotKey]: { atk?:number, def?:number, hp?:number } }
    // Partner modifiers (when partner side is a Unit)
    const [partnerStatMods, setPartnerStatMods] = React.useState(null); // { atk?:number, def?:number, hp?:number } | null
    // Counter → per-counter stat effects (only the ones with gameplay impact right now)
    const COUNTER_STAT_EFFECTS = {
        char_k: { atk: -2, def: 0, hp: 0 },
        damage_k: { atk: 0, def: 0, hp: -1 },
        frostbite_k: { atk: 0, def: 0, hp: -1 },
        health_k: { atk: 0, def: 0, hp: +1 },
        power_k: { atk: +1, def: 0, hp: 0 },
        shieldcount_k: { atk: 0, def: +1, hp: 0 },
    };

    // Sum the counter effects for a given slot key ("u1"…,"s1"…,"b1"…,"partner")
    const getCounterStatDelta = React.useCallback((slotKey) => {
        const counts = (slotCounters?.[slotKey]) || {};
        let dAtk = 0, dDef = 0, dHp = 0;
        for (const [id, nRaw] of Object.entries(counts)) {
            const n = Number(nRaw) || 0;
            if (!n) continue;
            const eff = COUNTER_STAT_EFFECTS[id];
            if (!eff) continue;
            dAtk += (eff.atk || 0) * n;
            dDef += (eff.def || 0) * n;
            dHp += (eff.hp || 0) * n;
        }
        return { atk: dAtk, def: dDef, hp: dHp };
    }, [slotCounters]);

    // Proxy so context-menu's setSlotStatMods can also clear/apply Partner modifiers
    const setSlotStatMods = React.useCallback((arg) => {
        if (typeof arg === 'function') {
            // The action handlers pass a function(prev) => next
            setStatMods((prev) => {
                const next = arg(prev || {});
                // Mirror "partner" key (if present) into dedicated partner state,
                // then strip it from slot map so slots stay slot-only.
                if (next && Object.prototype.hasOwnProperty.call(next, 'partner')) {
                    const partner = next.partner;
                    setPartnerStatMods(partner || null);
                    const { partner: _ignore, ...rest } = next;
                    return rest;
                }
                // If updater removed partner key implicitly, just clear partner mods.
                setPartnerStatMods(null);
                return next;
            });
        } else if (arg && typeof arg === 'object') {
            const { partner, ...rest } = arg;
            setPartnerStatMods(partner || null);
            setStatMods(rest);
        } else {
            setPartnerStatMods(null);
            setStatMods({});
        }
    }, [setStatMods, setPartnerStatMods]);

    // Load counter definitions once
    React.useEffect(() => {
        const ctrl = new AbortController();
        fetchJson('/keywords.json', ctrl.signal)
            .then((list) => {
                const defs = (Array.isArray(list) ? list : [])
                    .filter((k) => String(k?.IsCounter || '').toLowerCase() === 'true')
                    .map((k) => ({
                        id: k.KeywordName,
                        name: k.DisplayName,
                        isStatus: String(k?.IsStatus || '').toLowerCase() === 'true',
                    }));
                setCounterDefs(defs);
            })
            .catch(() => setCounterDefs([]));
        return () => ctrl.abort();
    }, []);

    // Reset counters on "new game"
    React.useEffect(() => {
        const clear = () => setSlotCounters({});
        window.addEventListener('pb:new-game', clear);
        return () => window.removeEventListener('pb:new-game', clear);
    }, []);

    // Reset stat modifiers on "new game"
    React.useEffect(() => {
        const clear = () => { setStatMods({}); setPartnerStatMods(null); };
        window.addEventListener('pb:new-game', clear);
        return () => window.removeEventListener('pb:new-game', clear);
    }, []);

    React.useEffect(() => {
        const clear = () => setSlotLabels({});
        window.addEventListener('pb:new-game', clear);
        return () => window.removeEventListener('pb:new-game', clear);
    }, []);

    React.useEffect(() => {
        const clear = () => setSlotResources({});
        window.addEventListener('pb:new-game', clear);
        return () => window.removeEventListener('pb:new-game', clear);
    }, []);

    // Reset Ransack trackers on "new game"
    React.useEffect(() => {
        const clear = () => {
            setRansackCounts([0, 0, 0, 0, 0, 0]);
            setORansackCounts([0, 0, 0, 0, 0, 0]);
            setRansackPrompt(null);
        };
        window.addEventListener('pb:new-game', clear);
        return () => window.removeEventListener('pb:new-game', clear);
    }, []);

    // Helper: render visible badges for a slot's counters
    const renderCounterBadges = (countsObj) => {
        const entries = Object.entries(countsObj || {}).filter(([, n]) => (n || 0) > 0);
        if (!entries.length) return null;
        return (
            <div className="pb-counter-badges" aria-label="Counters">
                {entries.map(([id, n]) => {
                    const label = (counterDefs.find((d) => d.id === id)?.name) || id;
                    return (
                        <span
                            key={id}
                            className="pb-counter-badge"
                            tabIndex={0}
                            title={label}
                            aria-label={`${label}${n > 1 ? ` ×${n}` : ''}`}
                        >
                            <span className="abbr">{`${(label?.[0] || id?.[0] || '?').toUpperCase()}`}{n > 1 ? `×${n}` : ''}</span>
                            <span className="full">{label}{n > 1 ? ` ×${n}` : ''}</span>
                        </span>
                    );
                })}
            </div>
        );
    };

    const hoardsTotal = (obj) =>
        Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0);

    const renderResourceBadges = (resObj) => {
        const entries = Object.entries(resObj || {}).filter(([, n]) => (Number(n) || 0) > 0);
        if (!entries.length) return null;

        return (
            <div className="pb-resource-badges" aria-label="Hoards">
                {entries.map(([internal, n]) => (
                    <span key={internal} className="pb-resource-badge" title={internal}>
                        <img src={`/images/${internal}.png`} alt={internal} draggable="false" />
                        <span className="pb-resource-qty">{`x ${n}`}</span>
                    </span>
                ))}
            </div>
        );
    };

    // NEW: render visible ad-hoc labels (Add Label) for a slot
    const renderLabelBadges = (labelsArr) => {
        const arr = Array.isArray(labelsArr) ? labelsArr.filter(Boolean) : [];
        if (!arr.length) return null;
        return (
            <div className="pb-label-badges" aria-label="Labels">
                {arr.map((text, i) => (
                    <span key={`${text}_${i}`} className="pb-label-badge" tabIndex={0} title={text}>
                        <span className="full">{text}</span>
                    </span>
                ))}
            </div>
        );
    };

    // NEW: per-unit displayed stats (future-modifiable via effects)
    const [unitStats, setUnitStats] = React.useState({}); // { [slotKey]: { atk, def, hp } }

    // NEW: displayed stats for the partner (when on side 'b' as a Unit)
    const [partnerStats, setPartnerStats] = React.useState(null); // { atk, def, hp } | null

    // Helper: lookup any card/token/partner by InternalName
    const lookupCard = React.useCallback((id) => {
        if (!id) return null;
        const { cardsById, partnersById, tokensById } = dataMaps || {};
        const c = (cardsById?.get?.(id) || cardsById?.[id]) || null;
        if (c) return c;
        const t = (tokensById?.get?.(id) || tokensById?.[id]) || null;
        if (t) return t;
        const p = (partnersById?.get?.(id) || partnersById?.[id]) || null;
        return p || null;
    }, [dataMaps]);

    // Hover Preview — create once for the whole board
    const { overlay, onRowEnter, onRowMove, onRowLeave } = useHoverPreview({
        getMeta: (id) => {
            const info = lookupCard(id);
            return {
                id,
                name: info?.CardName || id,
                typeTag: info?.CardType || '',
                cc: Number(info?.ConvertedCost ?? NaN),
                elements: [info?.ElementType1, info?.ElementType2, info?.ElementType3].filter(Boolean).join(' · '),
                cardText: info?.CardText || '',
            };
        },
        renderImage: (id) => (
            <img
                className="deck-preview-img"
                src={imgSrc(id, 'a')}
                alt={`card:${id}:a`}
                onError={onImgError('card', id, 'a')}
                draggable={false}
            />
        ),
    });

    // convenience wrappers that read data-card-id from the hovered element
    const handleEnter = React.useCallback((e) => {
        const id = e.currentTarget?.dataset?.cardId;
        if (id) onRowEnter(id, e);
    }, [onRowEnter]);

    const handleMove = React.useCallback((e) => { onRowMove(e); }, [onRowMove]);
    const handleLeave = React.useCallback(() => { onRowLeave(); }, [onRowLeave]);

    // Hide hover preview whenever a drag begins (or ends) anywhere on the page
    React.useEffect(() => {
        const hide = () => onRowLeave();
        document.addEventListener('dragstart', hide, true);
        document.addEventListener('dragend', hide, true);
        return () => {
            document.removeEventListener('dragstart', hide, true);
            document.removeEventListener('dragend', hide, true);
        };
    }, [onRowLeave]);

    // Hide hover preview whenever a context menu opens (right-click, Menu key, etc.)
    React.useEffect(() => {
        const hide = () => onRowLeave();

        // Native contextmenu (right-click / long-press)
        document.addEventListener('contextmenu', hide, true);

        // Optional signals from our context-menu plugin (see step 2)
        const onMenuOpen = () => onRowLeave();
        const onMenuClose = () => onRowLeave();
        window.addEventListener('pb:ctx:menu-open', onMenuOpen);
        window.addEventListener('pb:ctx:menu-close', onMenuClose);

        return () => {
            document.removeEventListener('contextmenu', hide, true);
            window.removeEventListener('pb:ctx:menu-open', onMenuOpen);
            window.removeEventListener('pb:ctx:menu-close', onMenuClose);
        };
    }, [onRowLeave]);

    // Helper: safe number
    const toNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    };

    // Initialize/sync unitStats when units are placed/removed in boardSlots
    React.useEffect(() => {
        setUnitStats(prev => {
            const next = { ...prev };
            // prune stats for slots that no longer hold a Unit
            for (const k of Object.keys(next)) {
                const id = boardSlots[k];
                const data = id ? lookupCard(id) : null;
                const isUnit = !!data && String(data.CardType || '').toLowerCase() === 'unit';
                if (!id || !isUnit) delete next[k];
            }
            // add entries for newly placed Units
            for (const [k, id] of Object.entries(boardSlots)) {
                if (next[k]) continue;
                const data = lookupCard(id);
                if (data && String(data.CardType || '').toLowerCase() === 'unit') {
                    next[k] = { atk: toNum(data.ATK), def: toNum(data.DEF), hp: toNum(data.HP) };
                }
            }
            return next;
        });
    }, [boardSlots, lookupCard]);

    // Sync partnerStats to the current partner side (only if that side is a Unit)
    React.useEffect(() => {
        if (!partnerId) { setPartnerStats(null); return; }
        const effectiveId = partnerId.replace(/_(a|b)$/i, `_${partnerSide || 'a'}`);
        const data = lookupCard(effectiveId);
        const isUnit = !!data && String(data.CardType || '').toLowerCase() === 'unit';
        if (!isUnit) { setPartnerStats(null); return; }
        setPartnerStats({ atk: toNum(data.ATK), def: toNum(data.DEF), hp: toNum(data.HP) });
    }, [partnerId, partnerSide, lookupCard]);

    // Render stat chips for a given slot (supports normal Units and Partner on side 'b')
    const renderUnitStats = (slotKey, id) => {
        if (!id) return null;

        // Determine the side for this slot
        const side = (slotKey === 'partner' ? (partnerSide || 'a') : (slotSides?.[slotKey] || 'a'));

        // If the ID has an _a/_b suffix, force it to the active side (covers partners on-board too)
        const effectiveId = String(id || '').replace(/_(a|b)$/i, `_${side}`);

        const data = lookupCard(effectiveId);
        if (!data || String(data.CardType || '').toLowerCase() !== 'unit') return null;

        // Choose the mutable stat source: partnerStats for partner area, unitStats for board slots
        const base = { atk: toNum(data.ATK), def: toNum(data.DEF), hp: toNum(data.HP) };
        const baseStats = slotKey === 'partner'
            ? (partnerStats || base)
            : (unitStats[slotKey] || base);

        const mods = slotKey === 'partner'
            ? (partnerStatMods || {})
            : (statMods[slotKey] || {});

        const counterDelta = getCounterStatDelta(slotKey);
        const s = {
            atk: toNum(baseStats.atk) + toNum(mods.atk) + toNum(counterDelta.atk),
            def: toNum(baseStats.def) + toNum(mods.def) + toNum(counterDelta.def),
            hp: toNum(baseStats.hp) + toNum(mods.hp) + toNum(counterDelta.hp),
        };



        return (
            <div className="pb-unit-stats" data-slot-key={slotKey}>
                <span id={`atk-${slotKey}`} className="stat stat-atk">
                    <span className="label">ATK</span>
                    <span className={`value ${s.atk > toNum(baseStats.atk) ? 'up' : s.atk < toNum(baseStats.atk) ? 'down' : ''}`}>{s.atk}</span>
                </span>
                <span id={`def-${slotKey}`} className="stat stat-def">
                    <span className="label">DEF</span>
                    <span className={`value ${s.def > toNum(baseStats.def) ? 'up' : s.def < toNum(baseStats.def) ? 'down' : ''}`}>{s.def}</span>
                </span>
                <span id={`hp-${slotKey}`} className="stat stat-hp">
                    <span className="label">HP</span>
                    <span className={`value ${s.hp > toNum(baseStats.hp) ? 'up' : s.hp < toNum(baseStats.hp) ? 'down' : ''}`}>{s.hp}</span>
                </span>
            </div>
        );
    };

    // NEW: Top-card reveal (peek) modal
    const [peekCard, setPeekCard] = React.useState(null); // { id, from: 'deck'|'shield' } | null

    // NEW: Fetch Cards prompt (opens Deck fetch modal)
    const [fetchPrompt, setFetchPrompt] = React.useState(null);

    // Live refs to avoid stale closures inside event listeners
    const deckRef = React.useRef(deckPile);
    React.useEffect(() => { deckRef.current = deckPile; }, [deckPile]);

    const shieldRef = React.useRef(shieldPile);
    React.useEffect(() => { shieldRef.current = shieldPile; }, [shieldPile]);

    // NEW: live refs for banish & grave so context-menu actions always see current stacks
    const banishRef = React.useRef(banishPile);
    React.useEffect(() => { banishRef.current = banishPile; }, [banishPile]);

    const graveRef = React.useRef(gravePile);
    React.useEffect(() => { graveRef.current = gravePile; }, [gravePile]);

    // Opponent live refs
    const oDeckRef = React.useRef(oDeckPile);
    React.useEffect(() => { oDeckRef.current = oDeckPile; }, [oDeckPile]);

    const oShieldRef = React.useRef(oShieldPile);
    React.useEffect(() => { oShieldRef.current = oShieldPile; }, [oShieldPile]);

    const oBanishRef = React.useRef(oBanishPile);
    React.useEffect(() => { oBanishRef.current = oBanishPile; }, [oBanishPile]);

    const oGraveRef = React.useRef(oGravePile);
    React.useEffect(() => { oGraveRef.current = oGravePile; }, [oGravePile]);

    // --- Drag & drop reordering inside the Open Stack View (full-stack only) ---
    const [peekDrag, setPeekDrag] = React.useState(null); // { stack, index }

    const [peekSize, setPeekSize] = React.useState(50); // middle = current size

    // NEW: Foresee modal (Deck-only)
    const [foresee, setForesee] = React.useState(null); // { ids: string[], mid: string[], top: string[], bottom: string[] }
    const [foreseeDrag, setForeseeDrag] = React.useState(null); // { zone: 'mid'|'top'|'bottom', index: number }
    const [roil, setRoil] = React.useState(null); // { owner, n, ids, grave, toDeck }

    // ADD THIS near other useState declarations (top-level in PlaytestBoard)
    const [partnerInArea, setPartnerInArea] = React.useState(!!partnerId);

    // keep in sync if partnerId changes (e.g., swap decks)
    React.useEffect(() => {
        setPartnerInArea(!!partnerId);
    }, [partnerId]);

    // symmetric mapping so 50 => 1.0x, <50 shrinks toward PEEK_MIN, >50 grows toward PEEK_MAX
    const PEEK_MIN = 0.40;  // smallest ~65%
    const PEEK_MAX = 1.80;  // largest 180%
    const sliderToScale = (v) => {
        if (v === 50) return 1;
        if (v < 50) {
            const t = (50 - v) / 50;
            return 1 - t * (1 - PEEK_MIN);
        }
        const t = (v - 50) / 50;
        return 1 + t * (PEEK_MAX - 1);
    };
    const peekScale = React.useMemo(() => sliderToScale(peekSize), [peekSize]);

    const moveItem = (arr, from, to) => {
        if (!Array.isArray(arr)) return arr;
        const next = [...arr];
        if (from < 0 || from >= next.length) return arr;
        const [m] = next.splice(from, 1);
        const safeTo = Math.max(0, Math.min(to, next.length));
        next.splice(safeTo, 0, m);
        return next;
    };

    const reorderStack = React.useCallback((stack, from, to, owner = 'player') => {
        if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;

        const isOpp = String(owner || 'player').toLowerCase() === 'opponent';
        const apply = (setter) => setter(prev => moveItem(prev, from, to));

        if (stack === 'deck') apply(isOpp ? setODeckPile : setDeckPile);
        else if (stack === 'shield') apply(isOpp ? setOShieldPile : setShieldPile);
        else if (stack === 'grave') apply(isOpp ? setOGravePile : setGravePile);
        else if (stack === 'banish') apply(isOpp ? setOBanishPile : setBanishPile);

        // Keep the open modal in sync when it's a full-stack view (same owner)
        setPeekCard(prev => {
            if (!prev || !prev.all || prev.from !== stack || !Array.isArray(prev.ids)) return prev;
            const prevOwner = String(prev.owner || 'player').toLowerCase();
            if (prevOwner !== (isOpp ? 'opponent' : 'player')) return prev;
            return { ...prev, ids: moveItem(prev.ids, from, to) };
        });
    }, []);

    const onPeekItemDragStart = (idx) => (e) => {
        // Only allow drag-reorder in "Open Stack View" (full-stack)
        if (!peekCard?.all) { e.preventDefault(); return; }
        setPeekDrag({ stack: peekCard.from, index: idx });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `peek:${peekCard.from}:${idx}`);
    };
    const onPeekItemDragEnd = () => setPeekDrag(null);
    const onPeekItemDragOver = (/*overIdx*/) => (e) => { e.preventDefault(); };

    const onPeekItemDrop = (overIdx) => (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!peekCard?.all) return;
        const src = getDragSource(e);
        if (!src || src.kind !== 'peek' || src.stack !== peekCard.from) return;

        // Insert before/after depending on cursor position
        const rect = e.currentTarget.getBoundingClientRect();
        const isAfter = e.clientX > rect.left + rect.width / 2;
        let to = overIdx + (isAfter ? 1 : 0);
        const from = src.index;
        if (from < to) to--; // account for removal shifting indices

        reorderStack(src.stack, from, to, peekCard.owner || 'player');
        setPeekDrag(null);
    };

    const onPeekBodyDragOver = (e) => { if (peekCard?.all) e.preventDefault(); };
    const onPeekBodyDrop = (e) => {
        e.preventDefault();
        if (!peekCard?.all) return;
        const src = getDragSource(e);
        if (!src || src.kind !== 'peek' || src.stack !== peekCard.from) return;
        const to = Array.isArray(peekCard.ids) ? peekCard.ids.length : 0; // drop to end
        reorderStack(src.stack, src.index, to, peekCard.owner || 'player');
        setPeekDrag(null);
    };

    // ===== Foresee (Deck) — drag/drop state + movers =====
    const moveForesee = (fromZone, fromIdx, toZone, toIdx = null) => {
        setForesee(prev => {
            if (!prev) return prev;
            const zones = {
                mid: [...prev.mid],
                top: [...prev.top],
                bottom: [...prev.bottom],
            };
            const srcArr = zones[fromZone];
            const dstArr = zones[toZone];
            if (!srcArr || !dstArr) return prev;
            if (!Number.isFinite(fromIdx) || fromIdx < 0 || fromIdx >= srcArr.length) return prev;

            const [moved] = srcArr.splice(fromIdx, 1);
            const insertAt = Number.isFinite(toIdx) ? Math.max(0, Math.min(toIdx, dstArr.length)) : dstArr.length;
            dstArr.splice(insertAt, 0, moved);

            return { ...prev, ...zones };
        });
    };

    const parseFZ = (e) => {
        const t = (e?.dataTransfer?.getData('text/pb') || '').split(':');
        if (t.length === 3 && t[0] === 'fz') {
            const [_tag, zone, idxStr] = t;
            const index = Number.parseInt(idxStr, 10);
            if (['mid', 'top', 'bottom'].includes(zone) && Number.isFinite(index)) {
                return { zone, index };
            }
        }
        return null;
    };

    const onFDragStart = (zone, idx) => (e) => {
        setForeseeDrag({ zone, index: idx });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `fz:${zone}:${idx}`);
    };

    const onFDragEnd = () => setForeseeDrag(null);
    const onFDragOver = (e) => { e.preventDefault(); };

    const onFDropOnTile = (zone, overIdx) => (e) => {
        e.preventDefault();
        e.stopPropagation();
        const src = foreseeDrag || parseFZ(e);
        if (!src) return;
        let insertAt = overIdx;
        // adjust index if dropping further in same array
        if (src.zone === zone && src.index < insertAt) insertAt -= 1;
        moveForesee(src.zone, src.index, zone, insertAt);
        setForeseeDrag(null);
    };

    const onFDropOnZone = (zone) => (e) => {
        e.preventDefault();
        const src = foreseeDrag || parseFZ(e);
        if (!src) return;
        moveForesee(src.zone, src.index, zone, null); // append to end
        setForeseeDrag(null);
    };

    const onForeseeReset = () => setForesee(prev => prev ? ({ ...prev, mid: prev.ids.slice(), top: [], bottom: [] }) : prev);
    const onForeseeClose = () => {
        if (!foresee) return;
        const assigned = (foresee.top.length + foresee.bottom.length);
        const dirty = assigned > 0 || foresee.mid.length !== foresee.ids.length;
        if (!dirty || window.confirm('Close Foresee without applying?')) {
            setForesee(null);
        }
    };
    const onForeseeConfirm = () => {
        if (!foresee) return;
        if (foresee.mid.length) return; // safety: require all assigned

        const apply = (prev) => {
            const rest = prev.slice(foresee.ids.length); // remove only the revealed top N
            return [...foresee.top, ...rest, ...foresee.bottom];
        };

        if (String(foresee.owner || 'player') === 'opponent') {
            setODeckPile(apply);
        } else {
            setDeckPile(apply);
        }
        setForesee(null);
    };

    // ===== Roil (Grave -> Deck) =====
    const onRoilClose = () => {
        if (!roil) return;
        const dirty = (roil.toDeck?.length || 0) > 0 || (roil.grave?.length || 0) !== (roil.ids?.length || 0);
        if (!dirty || window.confirm('Close Roil without applying?')) setRoil(null);
    };

    const onRoilConfirm = () => {
        if (!roil) return;
        const n = Number(roil.n) || 0;
        const selected = (roil.toDeck || []).slice(0);
        if (selected.length !== n) return;

        const isOpp = String(roil.owner || 'player') === 'opponent';
        const setDeckPileX = isOpp ? setODeckPile : setDeckPile;
        const setGravePileX = isOpp ? setOGravePile : setGravePile;

        const removeSelected = (pile, picked) => {
            const counts = new Map();
            for (const id of picked) counts.set(id, (counts.get(id) || 0) + 1);
            const out = [];
            for (const id of (pile || [])) {
                const c = counts.get(id) || 0;
                if (c > 0) { counts.set(id, c - 1); continue; }
                out.push(id);
            }
            return out;
        };

        const shuffle = (arr) => {
            const next = [...arr];
            for (let i = next.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [next[i], next[j]] = [next[j], next[i]];
            }
            return next;
        };

        setGravePileX((prev) => removeSelected(prev, selected));
        setDeckPileX((prev) => shuffle([...(prev || []), ...selected]));

        window.dispatchEvent(
            new CustomEvent(isOpp ? 'pb:o-elements:inc' : 'pb:elements:inc', { detail: { name: 'Neutral' } })
        );
        setRoil(null);
    };

    // Close peek on Escape
    React.useEffect(() => {
        if (!peekCard) return;
        const onKey = (e) => { if (e.key === 'Escape') setPeekCard(null); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [peekCard]);

    const [exhaustedSlots, setExhaustedSlots] = React.useState(new Set());
    const [producePrompt, setProducePrompt] = React.useState(null);

    // ADD directly below your other useState hooks:
    const [battleOrigin, setBattleOrigin] = React.useState({});
    const battleOriginRef = React.useRef(battleOrigin);
    React.useEffect(() => {
        battleOriginRef.current = battleOrigin;
    }, [battleOrigin]);

    // DnD handlers from the external plugin (available to the whole component)
    const {
        // payload util used by peek/foresee handlers too
        getDragSource,

        // hand
        onHandDragStart, onHandDragEnd, onHandContainerDragOver, onHandContainerDrop,
        onHandItemDragOver, onHandItemDrop,

        // opponent hand
        onOHandDragStart, onOHandDragEnd, onOHandContainerDragOver, onOHandContainerDrop,
        onOHandItemDragOver, onOHandItemDrop,

        // board slots
        onSlotDragOver, onSlotDragLeave, onSlotDrop, onSlotCardDragStart, onSlotCardDragEnd,

        // partner zone
        onPartnerDragStart, onPartnerAreaDragOver, onPartnerAreaDrop,

        // shield
        onShieldDragOver, onShieldDrop, onShieldDragStart,

        // banish
        onBanishDragOver, onBanishDrop, onBanishDragStart,

        // grave
        onGraveDragOver, onGraveDrop, onGraveDragStart,

        // deck
        onDeckDragOver, onDeckDrop, onDeckDragStart,

        // opponent stacks
        onOShieldDragOver, onOShieldDrop, onOShieldDragStart,
        onOBanishDragOver, onOBanishDrop, onOBanishDragStart,
        onOGraveDragOver, onOGraveDrop, onOGraveDragStart,
        onODeckDragOver, onODeckDrop, onODeckDragStart,

    } = usePlaytestBoardDragNDown({
        partnerId, partnerSide,
        boardSlots, setBoardSlots,
        slotSides, setSlotSides,
        slotCounters, setSlotCounters,
        slotLabels, setSlotLabels,
        slotResources, setSlotResources,
        hand, setHand,
        oHand, setOHand,
        deckPile, setDeckPile,
        shieldPile, setShieldPile,
        banishPile, setBanishPile,
        gravePile, setGravePile,
        dragIdx, setDragIdx,
        setHoverSlot,
        setExhaustedSlots,
        setBattleRole, battleRoleRef,
        setBattleOrigin, battleOriginRef,
        oPartnerId,
        // opponent piles for DnD into opponent stacks
        oDeckPile, setODeckPile,
        oShieldPile, setOShieldPile,
        oBanishPile, setOBanishPile,
        oGravePile, setOGravePile,

        // NEW
        setPartnerInArea,
    });

    // Auto-ready Unit/Support at Start → Ready Step
    // Auto-draw 1 at Start → Draw Step
    React.useEffect(() => {
        const onEntered = (e) => {
            const { phaseKey, stepLabel, isYourTurn: yturn } = e.detail || {};

            // Ready Step: clear exhaustion on unit/support slots, BUT if a slot has >=1 stun_k,
            // remove one stun_k and keep that slot exhausted instead of readying.
            // When Opponent Board is enabled, only auto-ready on Your Turn.
            if (phaseKey === 'start' && stepLabel === 'Ready Step') {
                if (opponentBoard === 'yes' && !yturn) return;

                const stunnedToDecrement = [];
                setExhaustedSlots((prev) => {
                    if (!prev || prev.size === 0) return prev;
                    const next = new Set();
                    for (const key of prev) {
                        const s = String(key);
                        const isUnitOrSupport = s.startsWith('u') || s.startsWith('s');
                        if (!isUnitOrSupport) {
                            next.add(s);
                            continue;
                        }
                        const counts = (slotCountersRef.current && slotCountersRef.current[s]) || {};
                        const hasStun = (counts['stun_k'] || 0) > 0;
                        if (hasStun) {
                            next.add(s);
                            stunnedToDecrement.push(s);
                        }
                    }
                    return next;
                });
                if (stunnedToDecrement.length) {
                    setSlotCounters((prev) => {
                        const base = prev || {};
                        let changed = false;
                        const up = { ...base };
                        for (const slotKey of stunnedToDecrement) {
                            const cur = { ...(up[slotKey] || {}) };
                            const n = (cur['stun_k'] || 0);
                            if (n > 0) {
                                cur['stun_k'] = n - 1;
                                const cleaned = Object.fromEntries(Object.entries(cur).filter(([, v]) => (v || 0) > 0));
                                if (Object.keys(cleaned).length) {
                                    up[slotKey] = cleaned;
                                } else {
                                    delete up[slotKey];
                                }
                                changed = true;
                            }
                        }
                        return changed ? up : base;
                    });
                }
            }

            // Draw Step: draw 1 card from top of Deck to Hand (gated by Going First? + Turn 1)
            // When Opponent Board is enabled, only auto-draw on Your Turn.
            if (phaseKey === 'start' && stepLabel === 'Draw Step') {
                if (opponentBoard === 'yes' && !yturn) return;

                const isFirstTurn = (window.__PB_TURN_COUNT || 1) === 1;
                if (goingFirst === 'yes' && isFirstTurn) {
                    // Skip the automatic draw on Turn 1 if we're going first
                    return;
                }

                setDeckPile((prev) => {
                    if (!prev || prev.length === 0) return prev;
                    const [top, ...rest] = prev;

                    setPeekCard((peek) => {
                        if (peek && peek.all && peek.from === 'deck' && Array.isArray(peek.ids)) {
                            const ids = [...peek.ids];
                            if (ids[0] === top) ids.shift();
                            else {
                                const k = ids.indexOf(top);
                                if (k >= 0) ids.splice(k, 1);
                            }
                            return { ...peek, ids };
                        }
                        return peek;
                    });

                    setHand((h) => {
                        if (top === partnerId && h.includes(partnerId)) return h;
                        return [...h, top];
                    });

                    return rest;
                });
            }

            // Start of End Step: each card with >=1 poison_k gains 1 damage_k
            if (phaseKey === 'end' && stepLabel === 'Start of End Step') {
                setSlotCounters((prev) => {
                    const base = prev || {};
                    let changed = false;
                    const next = { ...base };
                    for (const [slotKey, counts] of Object.entries(base)) {
                        const nPoison = (counts?.['poison_k'] || 0);
                        if (nPoison > 0) {
                            const cur = { ...counts };
                            cur['damage_k'] = (cur['damage_k'] || 0) + 1;
                            next[slotKey] = cur;
                            changed = true;
                        }
                    }
                    return changed ? next : base;
                });
            }

            // Produce Step: open a modal to select one of partner's elements (respect cap)
            if (phaseKey === 'start' && stepLabel === 'Produce Step') {
                const owner = (opponentBoard === 'yes' && !yturn) ? 'opponent' : 'player';

                const isFirstTurn = (window.__PB_TURN_COUNT || 1) === 1;
                if (isFirstTurn) {
                    // Player behavior: if we're going first, skip Turn 1 Produce selection (unchanged)
                    if (owner === 'player' && goingFirst === 'yes') return;

                    // Opponent behavior: if we're going second, skip Opponent Turn 1 Produce selection
                    if (owner === 'opponent' && goingFirst === 'no') return;
                }

                try {
                    const pid = owner === 'opponent' ? oPartnerId : partnerId;
                    if (!pid) return;

                    const partner =
                        dataMaps?.partnersById?.get?.(pid) ||
                        (dataMaps?.partnersById && dataMaps.partnersById[pid]) ||
                        null;

                    const elems = [partner?.ElementType1, partner?.ElementType2, partner?.ElementType3]
                        .filter(Boolean);
                    if (!elems || elems.length === 0) return;

                    const er = owner === 'opponent'
                        ? (window.__PB_O_ELEMENTS_STATE || {})
                        : (window.__PB_ELEMENTS_STATE || {});
                    const cap = Number(er?.cap) || 10;
                    const vals = er?.values || {};
                    const ov = er?.overrides || {};

                    const options = elems.map(name => {
                        const atCap = (vals?.[name] ?? 0) >= cap;
                        const override = !!ov?.[name];
                        return { name, atCap, override };
                    });

                    if (options.every(o => o.atCap && !o.override)) {
                        window.alert(
                            owner === 'opponent'
                                ? 'Produce Step: All of the opponent’s partner element resources are already at cap.'
                                : 'Produce Step: All of your partner’s element resources are already at cap.'
                        );
                        return;
                    }

                    setProducePrompt({ options, cap, owner });
                } catch (err) {
                    console.warn('[Produce Step] failed to prepare modal:', err);
                }
            }
        };

        window.addEventListener('pb:turn:entered', onEntered);
        return () => window.removeEventListener('pb:turn:entered', onEntered);
    }, [partnerId, oPartnerId, dataMaps, hasImportedDeck, goingFirst, opponentBoard]);

    // Slot/Partner/Stack DnD handlers now provided by usePlaytestBoardDragNDown(...)

    // --- Context "Add/Move to Slot" placement mode ---
    // When active, user clicks a Unit/Support slot to place `cardId`.
    // pendingPlace = { source: 'hand'|'viewer', index?: number, cardId: string }
    const [pendingPlace, setPendingPlace] = React.useState(null);

    // Allow cancel via Esc
    React.useEffect(() => {
        if (!pendingPlace) return;
        const onKey = (e) => {
            if (e.key === 'Escape') {
                // Restore any hidden viewer modal
                const m = window.__PB_SUSPENDED_MODAL;
                if (m) {
                    m.classList.remove('is-hidden');
                    window.__PB_SUSPENDED_MODAL = null;
                }
                setPendingPlace(null);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [pendingPlace]);


    // Add target-specific body classes while placement is active
    React.useEffect(() => {
        const b = document.body;
        if (!b) return;

        b.classList.remove(
            'pb-placing',
            'pb-placing-unit',
            'pb-placing-support',
            'pb-placing-owner-player',
            'pb-placing-owner-opponent'
        );

        if (pendingPlace) {
            b.classList.add('pb-placing');
            if (pendingPlace.target === 'unit') b.classList.add('pb-placing-unit');
            if (pendingPlace.target === 'support') b.classList.add('pb-placing-support');

            const owner = String(pendingPlace.owner || 'player').toLowerCase();
            b.classList.add(owner === 'opponent' ? 'pb-placing-owner-opponent' : 'pb-placing-owner-player');
        }

        return () => {
            b.classList.remove(
                'pb-placing',
                'pb-placing-unit',
                'pb-placing-support',
                'pb-placing-owner-player',
                'pb-placing-owner-opponent'
            );
        };
    }, [pendingPlace]);

    const commitPlaceToSlot = React.useCallback((key) => {
        if (!pendingPlace || !key) return;

        // One-shot: grab data and immediately end placement
        const { cardId, source, index, owner } = pendingPlace;
        setPendingPlace(null);

        // Determine target side (player vs opponent) and hard-block cross-side placement
        const keyIsOpp = /^o/.test(String(key));
        const ownerIsOpp = String(owner || 'player').toLowerCase() === 'opponent';

        // If the clicked side doesn't match the pending owner, ignore the click
        if (keyIsOpp !== ownerIsOpp) {
            return;
        }

        const isOppTarget = keyIsOpp;

        // Place onto the target slot (bumping any occupant to the correct Hand)
        setBoardSlots(prev => {
            const up = { ...prev };

            // If placing a partner card anywhere, ensure no duplicate board refs
            if (cardId === partnerId || cardId === oPartnerId) {
                for (const k in up) if (up[k] === cardId) delete up[k];
            }

            const prevInTarget = up[key] || null;
            up[key] = cardId;

            if (prevInTarget) {
                if (isOppTarget) {
                    setOHand(h => [...h, prevInTarget]);
                } else {
                    setHand(h => [...h, prevInTarget]);
                }
            }
            return up;
        });

        // Remove from the correct Hand based on the source
        if (source === 'hand') {
            setHand(prev => {
                const next = [...prev];
                if (Number.isFinite(index) && next[index] === cardId) {
                    next.splice(index, 1);
                } else {
                    const j = next.indexOf(cardId);
                    if (j >= 0) next.splice(j, 1);
                }
                return next;
            });
        } else if (source === 'oHand') {
            setOHand(prev => {
                const next = [...prev];
                if (Number.isFinite(index) && next[index] === cardId) {
                    next.splice(index, 1);
                } else {
                    const j = next.indexOf(cardId);
                    if (j >= 0) next.splice(j, 1);
                }
                return next;
            });
        }

        // If we started from Viewer, bring the hidden modal back now
        if (source === 'viewer') {
            const m = window.__PB_SUSPENDED_MODAL;
            if (m) {
                m.classList.remove('is-hidden');
                window.__PB_SUSPENDED_MODAL = null;
            }
        }
    }, [pendingPlace, partnerId, oPartnerId]);

    // Click handler attached to Unit/Support slots: only acts when placement is pending
    const onSlotClick = (key) => (e) => {
        if (!pendingPlace) return;
        const t = pendingPlace.target;
        const owner = String(pendingPlace.owner || 'player').toLowerCase();

        // Only allow clicks on PLAYER slots when the pending placement owner is the player
        const valid = owner !== 'opponent' && (
            (t === 'unit' && /^u\d+$/.test(key)) ||
            (t === 'support' && /^s\d+$/.test(key))
        );
        if (!valid) return;

        e.preventDefault();
        e.stopPropagation();
        commitPlaceToSlot(key);
    };

    // Opponent board variant (ou*/os*)
    const onOpponentSlotClick = (key) => (e) => {
        if (!pendingPlace) return;
        const t = pendingPlace.target;
        const owner = String(pendingPlace.owner || 'player').toLowerCase();

        // Only allow clicks on OPPONENT slots when the pending placement owner is the opponent
        const valid = owner === 'opponent' && (
            (t === 'unit' && /^ou\d+$/.test(key)) ||
            (t === 'support' && /^os\d+$/.test(key))
        );
        if (!valid) return;

        e.preventDefault();
        e.stopPropagation();
        commitPlaceToSlot(key);
    };

    // NEW: Wire context-menu actions to board operations (now delegated to the plugin)
    React.useEffect(() => {
        const cleanup = installPBActionHandlers({
            // ids / simple values
            partnerId,
            partnerSide,
            boardSlots,
            slotSides,

            // current values needed for the counters modal
            counterDefs,
            slotCounters,
            setStatMods,
            setPartnerStatMods,
            setStatPrompt,
            setSlotStatMods,
            setHealPrompt,
            slotLabels,             // NEW
            setSlotLabels,          // NEW
            slotResources,
            setSlotResources,
            setResourcePrompt,
            setAddLabelPrompt,      // NEW
            setRemoveLabelPrompt,   // NEW
            setDamagePrompt,        // NEW (opens Inflict/Damage X modal)

            // refs (for up-to-date stack contents inside handlers)
            deckRef,
            shieldRef,
            banishRef,
            graveRef,
            oDeckRef,
            oShieldRef,
            oBanishRef,
            oGraveRef,

            // setters (state mutation entry points)
            setHand,
            setBoardSlots,
            setSlotSides,
            setSlotCounters,
            setExhaustedSlots,
            setPartnerSide,
            setDeckPile,
            setShieldPile,
            setBanishPile,
            setGravePile,
            setPeekCard,
            setForesee,
            setRoil,
            setPendingPlace,
            setCounterPrompt, // <-- needed to open the modal
            setODeckPile,
            setOShieldPile,
            setOBanishPile,
            setOGravePile,
            setOHand,

            // other helpers we already have in-scope
            fileInputRef,
            onNewGame,
            onResetAll,

            // NEW for "Remove from Battle"
            battleOriginRef,
            setBattleOrigin,
            setBattleRole,
            battleRoleRef,

            // NEW for "Fetch Cards"
            setFetchPrompt,
            // NEW for "Ransack"
            setRansackPrompt,

        });
        return cleanup;
    }, [partnerId, onNewGame, onResetAll]);

    // NEW: Double click / double tap on Unit/Support slot cards toggles Exhaust
    //      and double click / double tap on the Deck stack slot draws 1 to hand.
    React.useEffect(() => {
        // slot-card (unit/support): toggle Exhaust
        const toggleExhaust = (el) => {
            if (!el || pendingPlace) return; // ignore while placing
            const slotKey = el.dataset?.slotKey;
            if (!slotKey || !/^(?:o?u\d+|o?s\d+)$/.test(slotKey)) return; // allow player + opponent unit/support (u*/s*, ou*/os*)
            window.dispatchEvent(new CustomEvent('pb:ctx:action', {
                detail: {
                    area: 'slot-card',
                    action: 'exhaust_toggle',
                    context: { target: el, data: { slotKey } },
                }
            }));
        };

        // deck stack slot: draw 1 to hand
        const drawFromDeck = (el) => {
            if (!el || pendingPlace) return; // ignore while placing
            window.dispatchEvent(new CustomEvent('pb:ctx:action', {
                detail: {
                    area: 'stack-slot',
                    action: 'deck_draw1',
                    context: { target: el, data: { stack: 'deck' } },
                }
            }));
        };

        // Desktop double-click handler
        const onDblClick = (e) => {
            const slotEl = e.target?.closest?.('[data-menu-area="slot-card"]');
            if (slotEl) { toggleExhaust(slotEl); return; }

            const deckEl = e.target?.closest?.('[data-menu-area="stack-slot"][data-stack="deck"]:not([data-owner="opponent"])');
            if (deckEl) { drawFromDeck(deckEl); }
        };

        // Mobile double-tap (simple 300ms window on the same element)
        let lastTapAt = 0;
        let lastEl = null;
        const onTouchEnd = (e) => {
            const slotEl = e.target?.closest?.('[data-menu-area="slot-card"]');
            const deckEl = e.target?.closest?.('[data-menu-area="stack-slot"][data-stack="deck"]:not([data-owner="opponent"])');
            const el = slotEl || deckEl;
            if (!el) { lastEl = null; lastTapAt = 0; return; }

            const now = Date.now();
            if (lastEl === el && (now - lastTapAt) < 300) {
                e.preventDefault(); // suppress double-tap zoom on iOS
                if (slotEl) toggleExhaust(slotEl);
                else drawFromDeck(deckEl);
                lastEl = null; lastTapAt = 0;
            } else {
                lastEl = el; lastTapAt = now;
                setTimeout(() => {
                    if (Date.now() - lastTapAt >= 320) { lastEl = null; }
                }, 320);
            }
        };

        document.addEventListener('dblclick', onDblClick, true);
        document.addEventListener('touchend', onTouchEnd, { passive: false, capture: true });

        return () => {
            document.removeEventListener('dblclick', onDblClick, true);
            document.removeEventListener('touchend', onTouchEnd, { capture: true });
        };
    }, [pendingPlace]);

    // Depth is "how many cards deep" you are AFTER the opening hand.
    // Example: immediately after drawing opening hand → depthDrawn=0 → Depth Level 1.
    const depthDrawn = (openingDeckCount == null) ? 0 : Math.max(0, openingDeckCount - deckPile.length);
    const oDepthDrawn = (openingODeckCount == null) ? 0 : Math.max(0, openingODeckCount - oDeckPile.length);

    const deckDepthInfo = getDepthLevelInfo(depthDrawn, depthLevels);
    const oDeckDepthInfo = getDepthLevelInfo(oDepthDrawn, depthLevels);

  return (
    <div className={`pb-root ${zoomEnabled ? '' : 'zoom-off'}`}>
          {overlay}
          <header className="pb-header">
              <div className="pb-title">Playtest Board</div>

              {/* NEW: centered Format selector */}
              <div className="pb-header-center">
                  <label className="fmt-label" htmlFor="pb-format">Format</label>
                  <select
                      id="pb-format"
                      className="format-select"
                      value={formatId}
                      onChange={(e) => setFormatId(e.target.value)}
                  >
                      {formats.map(f => (
                          <option key={f} value={f}>{f}</option>
                      ))}
                  </select>
              </div>

              <div className="pb-actions">
                  {hasImportedDeck && (
                      <>
                          <button
                              className="tips-btn"
                              onClick={onResetAll}
                              title="Clear everything and remove the imported deck"
                          >
                              Reset
                          </button>

                          <button
                              className="tips-btn"
                              onClick={onNewGame}
                              title="Reset the board and reshuffle using the same deck"
                          >
                              New Game
                          </button>
                      </>
                  )}

                  {/* Placeholder — only when a deck is imported AND Opponent Board is on */}
                  {hasImportedDeck && opponentBoard === 'yes' && (
                      <button
                          className="tips-btn"
                          onClick={() => oFileInputRef.current?.click()}
                      >
                          Import Opponent Deck
                      </button>
                  )}

                  <button
                      className="tips-btn"
                      onClick={onImportClick}
                  >
                      Import Deck
                  </button>

                  <button
                      className="tips-btn"
                      onClick={() => {
                          if (hasImportedDeck) {
                              const ok = window.confirm(
                                  'Return to the menu? Your imported deck and current playtest state will be cleared.'
                              );
                              if (!ok) return;
                          }
                          window.dispatchEvent(new CustomEvent('tcg:navigate', { detail: { view: 'menu' } }));
                      }}
                  >
                      Return to Menu
                  </button>

                  {/* hidden input so the button can trigger file select */}
                  <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      style={{ display: 'none' }}
                      onChange={onFileChosen}
                  />
                  <input
                      ref={oFileInputRef}
                      type="file"
                      accept=".json,application/json"
                      style={{ display: 'none' }}
                      onChange={onOFileChosen}
                  />
              </div>
          </header>

      <div className="pb-subheader" aria-label="Sub Header">
         <TurnBar goingFirst={goingFirst} opponentBoard={opponentBoard} />
      </div>

      {/* Body placeholder (we'll build this in later steps) */}
          <div className="pb-body">
              <div className="pb-stage">
                  {/* Left panel (empty for now) */}
                  <aside className="pb-side left" aria-label="Left Panel">
                      <div className="pb-panel-title">Settings &amp; Help</div>
                      <OpponentBoardToggle
                          value={opponentBoard}
                          setValue={setOpponentBoard}
                          blockDisable={
                              // Opponent deck imported?
                              (oDeckCounts?.size > 0) ||
                              // Any opponent slots currently hold a card?
                              Object.entries(boardSlots || {}).some(([k, v]) => /^o/.test(k) && !!v)
                          }
                      />
                      <GoingFirstToggle value={goingFirst} setValue={setGoingFirst} />
                      <CostModuleToggle />
                      {/* <PlacementModuleToggle /> */}
                      {/*<HoverPreviewToggle enabled={hoverEnabled} setEnabled={setHoverEnabled} /> Commented Out for Bug Testing*/}
                      <CardZoomToggle enabled={zoomEnabled} setEnabled={setZoomEnabled} />
                      <LeftPanelGalleries />
                      <CustomTrackers />
                      <LeftPanelHelp />
                  </aside>

                  {/* Center column holds the board */}
                  <div className="pb-center">
                      {/* Opponent Board (visual only — Step 1) */}
                      {opponentBoard === 'yes' && (
                          <OpponentBoard
                              boardSlots={boardSlots}
                              slotSides={slotSides}
                              exhaustedSlots={exhaustedSlots}
                              hoverSlot={hoverSlot}
                              onSlotDragOver={onSlotDragOver}
                              onSlotDragLeave={onSlotDragLeave}
                              onSlotDrop={onSlotDrop}
                              onSlotCardDragStart={onSlotCardDragStart}
                              onSlotCardDragEnd={onSlotCardDragEnd}
                              oDeckPile={oDeckPile}
                              oDeckDepthInfo={oDeckDepthInfo}
                              oShieldPile={oShieldPile}
                              oBanishPile={oBanishPile}
                              oGravePile={oGravePile}
                              battleRole={battleRole}
                              // NEW: show counters on opponent slots
                              slotCounters={slotCounters}
                              slotLabels={slotLabels}
                              slotResources={slotResources}
                              renderCounterBadges={renderCounterBadges}
                              renderLabelBadges={renderLabelBadges}
                              renderResourceBadges={renderResourceBadges}
                              renderUnitStats={renderUnitStats}
                              /* NEW: opponent stack drop + drag handlers */
                              onOShieldDragOver={onOShieldDragOver}
                              onOShieldDrop={onOShieldDrop}
                              onOBanishDragOver={onOBanishDragOver}
                              onOBanishDrop={onOBanishDrop}
                              onOGraveDragOver={onOGraveDragOver}
                              onOGraveDrop={onOGraveDrop}
                              onODeckDragOver={onODeckDragOver}
                              onODeckDrop={onODeckDrop}
                              onOShieldDragStart={onOShieldDragStart}
                              onOBanishDragStart={onOBanishDragStart}
                              onOGraveDragStart={onOGraveDragStart}
                              onODeckDragStart={onODeckDragStart}
                              // opponent hand
                              oHand={oHand}
                              onOHandDragStart={onOHandDragStart}
                              onOHandDragEnd={onOHandDragEnd}
                              onOHandContainerDragOver={onOHandContainerDragOver}
                              onOHandContainerDrop={onOHandContainerDrop}
                              onOHandItemDragOver={onOHandItemDragOver}
                              onOHandItemDrop={onOHandItemDrop}
                              onOpponentSlotClick={onOpponentSlotClick}
                          />
                      )}
                      <div className={`pb-board ${exhaustedSlots.size ? 'rotate-safe' : ''}`} role="grid" aria-label="Playtest Board">
                          {/* Row A (top) */}
                          <Slot
                              kind="pile"
                              row={1}
                              col={1}
                              name="Shield"
                              onDragOver={onShieldDragOver}
                              onDrop={onShieldDrop}
                              data-menu-area="stack-slot"  // NEW
                              data-stack="shield"          // NEW
                          >
                              {shieldPile.length > 0 && (
                                  <img
                                      className="pb-card-img"
                                      src={getFallbackPath('b')}
                                      alt="pile:shield"
                                      onError={onImgError('pile', 'card0000', 'b')}
                                      draggable
                                      onDragStart={onShieldDragStart}
                                  />
                              )}
                              <div className="pb-pile-count" aria-label="Shield count">
                                  {shieldPile.length}
                              </div>
                          </Slot>
                          {/* Big visual background: restore the old single battle zone look */}
                          <BattleZone row={1} col={2} span={7} />
                          {/* Row A (battle) — 7 discrete slots aligned above the unit columns */}
                          {BATTLE_SLOTS.map((i) => {
                              const key = `b${i}`;
                              const placed = boardSlots[key];
                              const isExhausted = exhaustedSlots.has(key);
                              const side = slotSides[key] || 'a';

                              return (
                                  <Slot key={key} kind="battle" row={1} col={i + 1} name={i === 1 ? 'Battle Zone' : undefined}>
                                      <div className="pb-slot-inner" data-slot-key={key}>
                                          {/* Intentionally not droppable: cannot put cards *into* battle by drag/drop */}
                                          {placed && (
                                              <div
                                                  className={`pb-slot-card${isExhausted ? ' is-exhausted' : ''}`}
                                                  onMouseEnter={handleEnter}
                                                  onMouseMove={handleMove}
                                                  onMouseLeave={handleLeave}
                                                  onFocus={handleEnter}
                                                  onBlur={handleLeave}
                                                  draggable
                                                  onDragStart={onSlotCardDragStart(key)}  // reuse the same drag-out handler
                                                  onDragEnd={onSlotCardDragEnd}
                                                  data-menu-area="slot-card"
                                                  data-card-id={placed}
                                                  data-slot-key={key}
                                                  data-side={side}
                                                  data-hoards-total={hoardsTotal(slotResources[key])}
                                                  title="Drag to another slot or back to your hand"
                                              >
                                                  <div className="pb-card-frame">
                                                      <CardZoom id={ensureFrontId(placed)} name={placed} />
                                                      <img
                                                          className="pb-card-img"
                                                          src={imgSrc(placed, side)}
                                                          alt={imgAlt('card', placed, side)}
                                                          onError={onImgError('card', placed, side)}
                                                          draggable="false"
                                                      />
                                                      {renderLabelBadges(slotLabels[key])}     {/* NEW */}
                                                      {renderCounterBadges(slotCounters[key])}
                                                      {renderResourceBadges(slotResources[key])}
                                                      {renderUnitStats(key, placed)}
                                                      {/* ADD — attacker badge only while in a battle slot */}
                                                      {/^b\d+$/.test(key) && battleRole[key] === 'attacker' && (
                                                          <div className="pb-battle-badge attacker">ATTACKER</div>
                                                      )}
                                                      {/^b\d+$/.test(key) && battleRole[key] === 'blocker' && (
                                                          <div className="pb-battle-badge blocker">BLOCKER</div>
                                                      )}
                                                  </div>
                                              </div>
                                          )}
                                      </div>
                                  </Slot>
                              );
                          })}
                          <Slot
                              kind="pile"
                              row={1}
                              col={9}
                              name="Banish"
                              onDragOver={onBanishDragOver}
                              onDrop={onBanishDrop}
                              data-menu-area="stack-slot"  // NEW
                              data-stack="banish"          // NEW
                          >
                              {banishPile.length > 0 ? (
                                  <>
                                      <CardZoom id={ensureFrontId(banishPile[0])} name={banishPile[0]} />
                                      <img
                                          className="pb-card-img"
                                          src={imgSrc(banishPile[0], 'a')}
                                          alt={imgAlt('banish', banishPile[0], 'a')}
                                          onError={onImgError('banish', banishPile[0], 'a')}
                                          draggable
                                          onDragStart={onBanishDragStart}
                                      />
                                  </>
                              ) : null}
                              <div className="pb-pile-count" aria-label="Banish count">
                                  {banishPile.length}
                              </div>
                          </Slot>

                          {/* Row B (units) */}
                          <Slot
                              kind="partner"
                              row={2}
                              col={1}
                              name="Partner"
                              onDragOver={onPartnerAreaDragOver}
                              onDrop={onPartnerAreaDrop}
                          >
                              {(() => {
                                  // Normalize IDs so checks work even if a zone holds "<id>_a" or "<id>_b"
                                  const baseId = (id) => String(id || '').replace(/_(a|b)$/i, '');

                                  // Only consider *player* slots for "on board" (preserve earlier fix)
                                  const partnerOnBoard = !!partnerId && Object.entries(boardSlots || {}).some(
                                      ([k, id]) => !/^o/.test(k) && baseId(id) === baseId(partnerId)
                                  );

                                  // Player zones
                                  const partnerInHand = !!partnerId && (hand || []).some((id) => baseId(id) === baseId(partnerId));
                                  const partnerInShield = !!partnerId && (shieldPile || []).some((id) => baseId(id) === baseId(partnerId));
                                  const partnerInBanish = !!partnerId && (banishPile || []).some((id) => baseId(id) === baseId(partnerId));
                                  const partnerInGrave = !!partnerId && (gravePile || []).some((id) => baseId(id) === baseId(partnerId));
                                  const partnerInDeck = !!partnerId && (deckPile || []).some((id) => baseId(id) === baseId(partnerId));

                                  // NEW: render Partner here only if *our* Partner is currently in the Partner area
                                  const shouldShow = !!partnerId && partnerInArea;

                                  return shouldShow ? (
                                      <div
                                          className="pb-slot-card"
                                          onMouseEnter={handleEnter}
                                          onMouseMove={handleMove}
                                          onMouseLeave={handleLeave}
                                          onFocus={handleEnter}
                                          onBlur={handleLeave}
                                          draggable
                                          onDragStart={onPartnerDragStart}
                                          title="Drag partner to a slot"
                                          data-menu-area="slot-card"
                                          data-card-id={partnerId}
                                          data-slot-key="partner"
                                          data-side={partnerSide}
                                          data-hoards-total={hoardsTotal(slotResources['partner'])}
                                      >
                                          <div className="pb-card-frame">
                                              <CardZoom id={ensureFrontId(partnerId)} name={partnerId} />
                                              <img
                                                  className="pb-card-img"
                                                  src={imgSrc(partnerId, partnerSide)}
                                                  alt={imgAlt('partner', partnerId, partnerSide)}
                                                  onError={onImgError('partner', partnerId, partnerSide)}
                                                  draggable="false"
                                              />
                                              {renderLabelBadges(slotLabels['partner'])}
                                              {renderCounterBadges(slotCounters['partner'])}
                                              {renderResourceBadges(slotResources['partner'])}
                                              {renderUnitStats('partner', partnerId)}
                                          </div>
                                      </div>
                                  ) : null;
                              })()}
                          </Slot>

                          {UNIT_SLOTS.map((i) => {
                              const key = `u${i}`;
                              const placed = boardSlots[key];
                              return (
                                  <Slot
                                      key={key}
                                      kind="unit"
                                      row={2}
                                      col={i + 1}
                                      name={`unit${i}`}
                                      onDragOver={onSlotDragOver(key)}
                                      onDragLeave={onSlotDragLeave}
                                      onDrop={onSlotDrop(key)}
                                      onClick={onSlotClick(key)}
                                      style={hoverSlot === key ? { boxShadow: '0 0 0 2px rgba(92,134,255,0.85) inset' } : null}
                                  >
                                      {placed && (
                                          <div
                                              className={`pb-slot-card${exhaustedSlots.has(key) ? ' is-exhausted' : ''}`}
                                              onMouseEnter={handleEnter}
                                              onMouseMove={handleMove}
                                              onMouseLeave={handleLeave}
                                              onFocus={handleEnter}
                                              onBlur={handleLeave}
                                              draggable
                                              onDragStart={onSlotCardDragStart(key)}
                                              onDragEnd={onSlotCardDragEnd}
                                              title="Drag to another slot or back to your hand"
                                              data-menu-area="slot-card"
                                              data-card-id={placed}
                                              data-slot-key={key}
                                              data-side={(slotSides[key] || 'a')}           // NEW — used by menu label
                                              data-no-block={slotCounters[key]?.terrify_k > 0 ? '1' : undefined}
                                              data-hoards-total={hoardsTotal(slotResources[key])}
                                          >
                                              <div className="pb-card-frame">
                                                  <CardZoom id={ensureFrontId(placed)} name={placed} />
                                                  <img
                                                      className="pb-card-img"
                                                      src={imgSrc(placed, slotSides[key] || 'a')}
                                                      alt={imgAlt('card', placed, slotSides[key] || 'a')}
                                                      onError={onImgError('card', placed, slotSides[key] || 'a')}
                                                      draggable="false"
                                                  />
                                                  {renderLabelBadges(slotLabels[key])}     {/* NEW */}
                                                  {renderCounterBadges(slotCounters[key])}
                                                  {renderResourceBadges(slotResources[key])}
                                                  {renderUnitStats(key, placed)}
                                              </div>
                                          </div>
                                      )}
                                  </Slot>
                              );
                          })}

                          <Slot
                              kind="pile"
                              row={2}
                              col={9}
                              name="Deck"
                              onDragOver={onDeckDragOver}
                              onDrop={onDeckDrop}
                              data-menu-area="stack-slot"  // NEW
                              data-stack="deck"            // NEW
                          >
                              {deckPile.length > 0 && (
                                  <img
                                      className="pb-card-img"
                                      src={getFallbackPath('b')}
                                      alt="pile:deck"
                                      onError={onImgError('pile', 'card0000', 'b')}
                                      draggable
                                      onDragStart={onDeckDragStart}
                                  />
                              )}
                              <div className="pb-pile-meta" aria-label="Deck meta">
                                  <div className={`pb-depth-level is-${deckDepthInfo.tone}`} aria-label="Deck depth level">
                                      Depth Level: {deckDepthInfo.level ?? '-'}
                                  </div>
                                  <div className="pb-pile-count" aria-label="Deck count">
                                      {deckPile.length}
                                  </div>
                              </div>
                          </Slot>

                          {/* Row C (supports) */}
                          {SUPPORT_SLOTS.map((i) => {
                              const key = `s${i}`;
                              const placed = boardSlots[key];
                              return (
                                  <Slot
                                      key={key}
                                      kind="support"
                                      row={3}
                                      col={i + 1}
                                      name={`support${i}`}
                                      onDragOver={onSlotDragOver(key)}
                                      onDragLeave={onSlotDragLeave}
                                      onDrop={onSlotDrop(key)}
                                      onClick={onSlotClick(key)}
                                      style={hoverSlot === key ? { boxShadow: '0 0 0 2px rgba(92,134,255,0.85) inset' } : null}
                                  >
                                      {placed && (
                                          <div
                                              className={`pb-slot-card${exhaustedSlots.has(key) ? ' is-exhausted' : ''}`}
                                              onMouseEnter={handleEnter}
                                              onMouseMove={handleMove}
                                              onMouseLeave={handleLeave}
                                              onFocus={handleEnter}
                                              onBlur={handleLeave}
                                              draggable
                                              onDragStart={onSlotCardDragStart(key)}
                                              onDragEnd={onSlotCardDragEnd}
                                              title="Drag to another slot or back to your hand"
                                              data-menu-area="slot-card"
                                              data-card-id={placed}
                                              data-slot-key={key}
                                              data-side={(slotSides[key] || 'a')}           // NEW — used by menu label
                                              data-hoards-total={hoardsTotal(slotResources[key])}
                                          >
                                              <div className="pb-card-frame">
                                                  <CardZoom id={ensureFrontId(placed)} name={placed} />
                                                  <img
                                                      className="pb-card-img"
                                                      src={imgSrc(placed, slotSides[key] || 'a')}                     // NEW
                                                      alt={imgAlt('card', placed, slotSides[key] || 'a')}             // NEW
                                                      onError={onImgError('card', placed, slotSides[key] || 'a')}     // NEW
                                                      draggable="false"
                                                  />
                                                  {renderLabelBadges(slotLabels[key])}     {/* NEW */}
                                                  {renderCounterBadges(slotCounters[key])}
                                                  {renderResourceBadges(slotResources[key])}
                                              </div>
                                          </div>
                                      )}
                                  </Slot>
                              );
                          })}
                          <Slot
                              kind="pile"
                              row={3}
                              col={9}
                              name="Grave"
                              onDragOver={onGraveDragOver}
                              onDrop={onGraveDrop}
                              data-menu-area="stack-slot"  // NEW
                              data-stack="grave"           // NEW
                          >
                              {gravePile.length > 0 ? (
                                  <>
                                      <CardZoom id={ensureFrontId(gravePile[0])} name={gravePile[0]} />
                                      <img
                                          className="pb-card-img"
                                          src={imgSrc(gravePile[0], 'a')}
                                          alt={imgAlt('grave', gravePile[0], 'a')}
                                          onError={onImgError('grave', gravePile[0], 'a')}
                                          draggable
                                          onDragStart={onGraveDragStart}
                                      />
                                  </>
                              ) : null}
                              <div className="pb-pile-count" aria-label="Grave count">
                                  {gravePile.length}
                              </div>
                          </Slot>

                          {/* Hand moved to fixed dock (see .pb-hand-dock at bottom of screen) */}
                      </div>
                      {/* Fixed Hand Dock (pinned between left/right panels at bottom) */}
                      <div
                          className={`pb-hand-dock${opponentBoard === 'yes' ? ' has-opponent' : ''}${handCollapsed ? ' is-collapsed' : ''}`}
                          role="region"
                          aria-label="Hand"
                          /* When collapsed, allow dropping anywhere on the dock */
                          onDragOver={handCollapsed ? onHandContainerDragOver : undefined}
                          onDrop={handCollapsed ? onHandContainerDrop : undefined}
                      >
                          {/* Collapse/Expand control only when Opponent Board is ON */}
                          {opponentBoard === 'yes' && (
                              <div className="pb-hand-toggle">
                                  <button
                                      type="button"
                                      className="pb-fold-btn"
                                      aria-expanded={!handCollapsed}
                                      onClick={() => setHandCollapsed(v => !v)}
                                      title={handCollapsed ? 'Expand Hand' : 'Collapse Hand'}
                                  >
                                      {handCollapsed ? 'Expand ▲' : 'Collapse ▼'}
                                  </button>
                              </div>
                          )}

                          <div
                              className="pb-hand-cards"
                              onDragOver={onHandContainerDragOver}
                              onDrop={onHandContainerDrop}
                          >
                              {hand.map((id, i) => (
                                  <div
                                      key={`${id}-${i}`}
                                      className={`pb-hand-item${dragIdx === i ? ' dragging' : ''}`}
                                      draggable
                                      onDragStart={onHandDragStart(i)}
                                      onDragOver={onHandItemDragOver}
                                      onDrop={onHandItemDrop(i)}
                                      onDragEnd={onHandDragEnd}
                                      aria-grabbed={dragIdx === i ? 'true' : 'false'}
                                      data-menu-area="hand-card"
                                      data-card-id={id}
                                      data-index={i}
                                  >
                                      <CardZoom id={ensureFrontId(id)} name={id} />
                                      <img
                                          className="pb-card-img"
                                          src={imgSrc(id, /_b$/i.test(String(id)) ? 'b' : 'a')}
                                          alt={imgAlt('card', id, /_b$/i.test(String(id)) ? 'b' : 'a')}
                                          onError={onImgError('card', id, /_b$/i.test(String(id)) ? 'b' : 'a')}
                                          draggable="false"
                                      />
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>

                  {/* Right panel (empty for now) */}
                  <aside className="pb-side right" aria-label="Right Panel" data-active-owner={rightOwner}>
                      <div className="pb-panel-title">
                          <div className="pb-owner-switch" role="tablist" aria-label="Owner View">
                              <button
                                  className={`pb-owner-btn ${rightOwner === 'player' ? 'active' : ''}`}
                                  role="tab"
                                  aria-selected={rightOwner === 'player'}
                                  onClick={() => setRightOwner('player')}
                                  title="Show Player trackers"
                              >
                                  Player
                              </button>

                              {opponentBoard === 'yes' && (
                                  <button
                                      className={`pb-owner-btn ${rightOwner === 'opponent' ? 'active' : ''}`}
                                      role="tab"
                                      aria-selected={rightOwner === 'opponent'}
                                      onClick={() => setRightOwner('opponent')}
                                      title="Show Opponent trackers"
                                  >
                                      Opponent
                                  </button>
                              )}
                          </div>
                      </div>

                      {/* PLAYER — this instance is the "engine" (listens to auto events) */}
                      <div className="owner-section" data-owner="player">
                          <HPTracker engineMode />
                          <TempHPTracker engineMode />
                          <ElementResourceTrackers visibleNames={partnerVisibleElements} engineMode />
                          <RefundTracker engineMode />
                      </div>

                      {/* OPPONENT — separate state; does NOT listen to engine auto events */}
                      <div className="owner-section" data-owner="opponent">
                          <HPTracker engineMode={false} />
                          <TempHPTracker engineMode={false} />
                          <ElementResourceTrackers visibleNames={oPartnerVisibleElements} engineMode={false} owner="opponent" />
                          <RefundTracker engineMode={false} owner="opponent" />
                      </div>

                      <div className="pb-right-footer" role="group" aria-label="Turn Controls (Footer)">
                          <button
                              className="pb-btn"
                              title="Next step/phase"
                              onClick={() => window.dispatchEvent(new Event('pb:turn:next'))}
                          >
                              Next
                          </button>
                          <button
                              className="pb-btn"
                              title="End Turn"
                              onClick={() => window.dispatchEvent(new Event('pb:turn:end'))}
                          >
                              End Turn
                          </button>
                      </div>
                  </aside>
              </div>

              

          </div>

          {showMulligan && (
              <MulliganModal
                  deckPile={deckPile}
                  setDeckPile={setDeckPile}
                  counts={deckCounts}
                  cardsById={dataMaps.cardsById}
                  imgSrc={imgSrc}
                  onClose={() => {
                      setShowMulligan(false);
                      if (pendingOMulligan && opponentBoard === 'yes') {
                          setShowOMulligan(true);
                      }
                      setPendingOMulligan(false);
                  }}
                  onKeep={(finalHand) => {
                      setHand(finalHand);
                      setShowMulligan(false);
                      if (pendingOMulligan && opponentBoard === 'yes') {
                          setShowOMulligan(true);
                      }
                      setPendingOMulligan(false);
                  }}
              />
          )}

          {showOMulligan && opponentBoard === 'yes' && (
              <MulliganModal
                  deckPile={oDeckPile}
                  setDeckPile={setODeckPile}
                  counts={oDeckCounts}
                  cardsById={dataMaps.cardsById}
                  imgSrc={imgSrc}
                  onClose={() => setShowOMulligan(false)}
                  onKeep={(finalHand) => { setOHand(finalHand); setShowOMulligan(false); }}
              />
          )}

          {statPrompt && (
              <StatModifyModal
                  slotKey={statPrompt.slotKey}
                  initial={statPrompt}
                  onClose={() => setStatPrompt(null)}
                  onConfirm={({ slotKey, stat, op, amount }) => {
                      const key = String(stat || 'ATK').toLowerCase(); // 'atk' | 'def' | 'hp'
                      const delta = (op === '-' || op === '−') ? -amount : amount;

                      if (slotKey === 'partner') {
                          // Partner (when side 'b' is a Unit)
                          setPartnerStatMods((prev) => ({
                              ...(prev || {}),
                              [key]: (Number(prev?.[key]) || 0) + delta,
                          }));
                      } else {
                          // Normal/battle slot (u1..u7 / b1..b7)
                          setStatMods((prev) => {
                              const next = { ...(prev || {}) };
                              const cur = { ...(next[slotKey] || {}) };
                              cur[key] = (Number(cur[key]) || 0) + delta;
                              next[slotKey] = cur;
                              return next;
                          });
                      }
                      setStatPrompt(null);
                  }}
              />
          )}

          {peekCard && (
              <div
                  className={`pb-modal pb-peek ${peekCard.all ? 'is-stack-view' : ''} ${Array.isArray(peekCard.ids) && peekCard.ids.length > 1 ? 'pb-peek-multi' : ''} ${pendingPlace?.source === 'viewer' ? 'is-hidden' : ''}`}
                  role="dialog"
                  aria-modal="true"
                  onMouseDown={(e) => {
                      // close when clicking outside the panel
                      if (e.target.classList?.contains('pb-modal')) setPeekCard(null);
                  }}
              >
                  <div
                      className="pb-modal-content"
                      style={
                          (!peekCard.all && Array.isArray(peekCard.ids) && peekCard.ids.length > 1)
                              // 3 × 360px cards + 2 gaps(10px) + body padding (10px × 2), capped by viewport
                              ? { width: 'min(calc(3 * 360px + 2 * 10px + 20px), calc(100vw - 32px))', maxWidth: 'none' }
                              : undefined
                      }
                  >
                      <div className="pb-modal-header">
                          <div className="title">
                              {/* Title text */}
                              {(() => {
                                  const from =
                                      peekCard.from === 'shield' ? 'Shield' :
                                          peekCard.from === 'grave' ? 'Grave' :
                                              peekCard.from === 'banish' ? 'Banish' : 'Deck';
                                  if (peekCard.all && Array.isArray(peekCard.ids)) {
                                      return `${from} (${peekCard.ids.length})`;
                                  }
                                  return (Array.isArray(peekCard.ids) && peekCard.ids.length > 0)
                                      ? `Top ${peekCard.ids.length} of ${from}`
                                      : `Top of ${from}`;
                              })()}

                              {/* size slider sits directly beside the title */}
                              {peekCard.all && (
                                  <div className="pb-sizebar" title="Adjust stack card size">
                                      {/* deckbuilder-style icon: stroke-only card outline */}
                                      <svg viewBox="0 0 24 24" aria-hidden="true" className="pb-sizebar-icon">
                                          <rect x="5" y="3" width="12" height="18" rx="2"></rect>
                                          <path d="M8 8h6M8 12h6M8 16h6" fill="none"></path>
                                      </svg>

                                      <input
                                          type="range"
                                          min={0}
                                          max={100}
                                          step={1}
                                          value={peekSize}
                                          onChange={(e) => setPeekSize(Number(e.target.value))}
                                          aria-label="Stack card size"
                                          className="pb-sizebar-range"
                                      />

                                      <button
                                          className="tips-btn"
                                          onClick={() => setPeekSize(50)}
                                          title="Reset to default size"
                                      >
                                          Reset
                                      </button>
                                  </div>
                              )}
                          </div>

                          <button className="tips-btn" onClick={() => setPeekCard(null)}>Close</button>
                      </div>

                      {/* Single vs multiple reveal share the same modal */}
                      {Array.isArray(peekCard.ids) && peekCard.ids.length > 0 ? (
                          <div
                              className="pb-modal-body"
                              style={{ padding: 10, maxHeight: '76vh', overflow: 'auto' }}
                              onDragOver={onPeekBodyDragOver}    // NEW: allow drop to "end"
                              onDrop={onPeekBodyDrop}            // NEW
                          >
                              <div
                                  style={
                                      peekCard.all
                                          ? {
                                              // Stack Viewer (unchanged)
                                              display: 'flex',
                                              flexWrap: 'wrap',
                                              gap: 10,
                                              alignItems: 'flex-start',
                                              justifyContent: 'center',
                                          }
                                          : {
                                              // Reveal X: grid, rows of 3
                                              display: 'grid',
                                              gridTemplateColumns: 'repeat(3, max-content)',
                                              gap: 10,
                                              alignItems: 'start',
                                              justifyContent: 'center',
                                              justifyItems: 'center',
                                          }
                                  }
                              >
                                  {peekCard.ids.map((cid, i) => (
                                      <figure
                                          key={`${cid}-${i}`}
                                          className="pb-gallery-card"
                                          data-menu-area={peekCard.readonly ? 'viewer-card' : 'hand-card'}
                                          data-card-id={cid}
                                          data-stack={peekCard.from}
                                          data-peek-index={i}
                                          data-peek-size={Array.isArray(peekCard.ids) ? peekCard.ids.length : 1}
                                          data-peek-total={Array.isArray(peekCard.ids) ? peekCard.ids.length : 1}
                                          style={{
                                              flex: '0 0 auto',
                                              width: peekCard.all
                                                  ? `min(${Math.round(26 * peekScale)}vw, ${Math.round(360 * peekScale)}px)`
                                                  : 'min(26vw, 360px)'
                                          }}
                                          draggable={!!peekCard.all}                  // NEW: enable drag in full-stack view
                                          onDragStart={onPeekItemDragStart(i)}        // NEW
                                          onDragOver={onPeekItemDragOver(i)}          // NEW
                                          onDrop={onPeekItemDrop(i)}                  // NEW
                                          onDragEnd={onPeekItemDragEnd}               // NEW
                                          title={peekCard.all ? 'Drag to reorder' : undefined}
                                      >
                                          <CardZoom id={ensureFrontId(cid)} name={cid} />
                                          <img
                                              className="pb-card-img"
                                              src={imgSrc(cid, 'a')}
                                              alt={imgAlt('card', cid, 'a')}
                                              onError={onImgError('card', cid, 'a')}
                                              draggable="false"
                                              style={{ width: '100%', height: 'auto' }}
                                          />
                                      </figure>
                                  ))}
                              </div>
                          </div>
                      ) : (
                          <div
                              className="pb-modal-body"
                              style={{ display: 'flex', justifyContent: 'center' }}
                          >
                                  <figure
                                      className="pb-gallery-card"
                                      data-menu-area={peekCard.readonly ? 'viewer-card' : 'hand-card'}
                                      data-card-id={peekCard.id}
                                      data-stack={peekCard.from}   /* 'deck' | 'shield' | 'grave' (readonly) */
                                      data-peek-index={0}
                                      data-peek-size={Array.isArray(peekCard.ids) ? peekCard.ids.length : 1}
                                      data-peek-total={Array.isArray(peekCard.ids) ? peekCard.ids.length : 1}
                                      style={{ width: 'min(56vw, 420px)' }}
                                  >
                                      <CardZoom id={ensureFrontId(peekCard.id)} name={peekCard.id} />
                                      <img
                                          className="pb-card-img"
                                          src={imgSrc(peekCard.id, 'a')}
                                          alt={imgAlt('card', peekCard.id, 'a')}
                                          onError={onImgError('card', peekCard.id, 'a')}
                                          draggable="false"
                                          style={{ width: '100%', height: 'auto' }}
                                      />
                                  </figure>
                          </div>
                      )}
                  </div>
              </div>
          )}

          {/* ADD: Produce Step modal */}
          {producePrompt && (
              <div
                  className="pb-modal pb-produce"
                  role="dialog"
                  aria-modal="true"
                  onMouseDown={(e) => {
                      // close when clicking outside the panel
                      if (e.target.classList?.contains('pb-modal')) setProducePrompt(null);
                  }}
              >
                  <div className="pb-modal-content">
                      <div className="pb-modal-header">
                          <div className="title">Produce Step{producePrompt?.owner === 'opponent' ? ' (Opponent)' : ''}</div>
                          <div className="actions">
                              <button className="tips-btn" onClick={() => setProducePrompt(null)}>Cancel</button>
                          </div>
                      </div>

                      <div className="pb-modal-body">
                          <div className="pb-produce-list">
                              {producePrompt.options.map(opt => (
                                  <button
                                      key={opt.name}
                                      disabled={opt.atCap && !opt.override}
                                      onClick={() => {
                                          if (opt.atCap && !opt.override) return;
                                          // Use non-strict inc so the element's Override toggle can allow producing past cap
                                          window.dispatchEvent(
                                              new CustomEvent(
                                                  (producePrompt?.owner === 'opponent') ? 'pb:o-elements:inc' : 'pb:elements:inc',
                                                  { detail: { name: opt.name } }
                                              )
                                          );
                                          setProducePrompt(null);
                                      }}
                                  >
                                      {opt.name}{opt.atCap ? ' (at cap)' : ''}
                                  </button>
                              ))}
                          </div>
                      </div>
                  </div>
              </div>
          )}

          {counterPrompt && (
              <div
                  className="pb-modal pb-counters"
                  role="dialog"
                  aria-modal="true"
                  onMouseDown={(e) => {
                      if (e.target.classList?.contains('pb-modal')) setCounterPrompt(null);
                  }}
              >
                  <div className="pb-modal-content">
                      <div className="pb-modal-header">
                          <div className="pb-modal-title">Add Counters</div>
                          <button className="tips-btn" onClick={() => setCounterPrompt(null)}>Cancel</button>
                      </div>

                      <div className="pb-modal-body">
                          {counterDefs.length === 0 ? (
                              <div className="pb-empty-state">No counters available.</div>
                          ) : (
                              <div className="pb-counters-list">
                                  {counterDefs.map((c) => {
                                      const n = counterPrompt.counts?.[c.id] ?? 0;
                                      return (
                                          <div key={c.id} className="pb-counter-row">
                                              <div className="pb-counter-name">{c.name}</div>
                                              <div className="pb-mini-counter" role="group" aria-label={`${c.name} counter`}>
                                                  <button
                                                      className="pb-btn"
                                                      onClick={() =>
                                                          setCounterPrompt((prev) => ({
                                                              ...prev,
                                                              counts: { ...(prev.counts || {}), [c.id]: Math.max(0, (prev.counts?.[c.id] || 0) - 1) }
                                                          }))
                                                      }
                                                      title="Decrease"
                                                  >−</button>
                                                  <output className="hp-display" aria-live="polite">{n}</output>
                                                  <button
                                                      className="pb-btn"
                                                      onClick={() =>
                                                          setCounterPrompt((prev) => ({
                                                              ...prev,
                                                              counts: { ...(prev.counts || {}), [c.id]: (prev.counts?.[c.id] || 0) + 1 }
                                                          }))
                                                      }
                                                      title="Increase"
                                                  >+</button>
                                              </div>
                                          </div>
                                      );
                                  })}
                              </div>
                          )}
                      </div>
                      <div className="pb-encounter-actions">
                          <button
                              className="tips-btn pb-encounter-generate"
                              onClick={() => {
                                  if (!counterPrompt) return;
                                  const { slotKey, counts } = counterPrompt;
                                  // strip zeros so we don't store noise
                                  const cleaned = Object.fromEntries(
                                      Object.entries(counts || {}).filter(([, n]) => (n || 0) > 0)
                                  );
                                  setSlotCounters((prev) => ({ ...prev, [slotKey]: cleaned }));
                                  setCounterPrompt(null);
                              }}
                          >
                              Confirm
                          </button>
                          
                          <span className="pb-encounter-count">
                              {Object.values(counterPrompt.counts || {}).reduce((a, b) => a + (b || 0), 0)} total
                          </span>
                          <button
                              className="tips-btn"
                              title="Reset the trackers to the card's current counters"
                              onClick={() => {
                                  if (!counterPrompt) return;
                                  if (!window.confirm('Reset all tracker values to the card’s current counters?')) return;

                                  const { slotKey } = counterPrompt;
                                  const existing = (slotCounters && slotCounters[slotKey]) || {};
                                  const base = {};
                                  // Make sure every available counter is represented
                                  counterDefs.forEach(d => { base[d.id] = existing[d.id] || 0; });

                                  setCounterPrompt(prev => ({ ...prev, counts: base }));
                              }}
                          >
                              Reset
                          </button>

                          <button
                              className="tips-btn"
                              title="Clear all counters from this card"
                              onClick={() => {
                                  if (!counterPrompt) return;
                                  if (!window.confirm('Clear all counters from this card?')) return;

                                  const { slotKey } = counterPrompt;
                                  setSlotCounters(prev => {
                                      const next = { ...(prev || {}) };
                                      // Remove all counters for this slot (same result as setting all to 0)
                                      delete next[slotKey];
                                      return next;
                                  });
                                  // Close the window after clearing
                                  setCounterPrompt(null);
                              }}
                          >
                              Clear All Counters
                          </button>
                      </div>
                  </div>
              </div>
          )}

          {resourcePrompt && (
              <ResourceCountersModal
                  prompt={resourcePrompt}
                  setPrompt={setResourcePrompt}
                  onClose={() => setResourcePrompt(null)}
                  resources={slotResources}
                  setResources={setSlotResources}
              />
          )}

          {ransackPrompt && (
              <RansackModal
                  prompt={ransackPrompt}
                  setPrompt={setRansackPrompt}
                  options={ransackOptions}
                  counts={String(ransackPrompt?.owner || 'player') === 'opponent' ? oRansackCounts : ransackCounts}
                  onClose={() => setRansackPrompt(null)}
                  onConfirm={(optIndex) => {
                      const isOpp = String(ransackPrompt?.owner || 'player') === 'opponent';

                      if (isOpp) {
                          setORansackCounts((prev) => {
                              const next = [...(prev || [0, 0, 0, 0, 0, 0])];
                              next[optIndex] = (Number(next[optIndex]) || 0) + 1;
                              return next;
                          });
                      } else {
                          setRansackCounts((prev) => {
                              const next = [...(prev || [0, 0, 0, 0, 0, 0])];
                              next[optIndex] = (Number(next[optIndex]) || 0) + 1;
                              return next;
                          });
                      }
                  }}
              />
          )}

          {roil && (
              <RoilModal
                  roil={roil}
                  setRoil={setRoil}
                  onClose={onRoilClose}
                  onConfirm={onRoilConfirm}
              />
          )}

          {foresee && (
              <div
                  className="pb-modal pb-foresee"
                  role="dialog"
                  aria-modal="true"
                  onMouseDown={(e) => {
                      if (e.target.classList?.contains('pb-modal')) onForeseeClose();
                  }}
              >
                  <div className="pb-modal-content">
                      <div className="pb-modal-header">
                          <div className="pb-modal-title">Foresee</div>
                          <button className="tips-btn" onClick={onForeseeClose} title="Close">Close</button>
                      </div>

                      <div className="pb-foresee-body">
                          {/* Revealed (unassigned) */}
                          <div
                              className="pb-foresee-zone pb-foresee-reveal"
                              onDragOver={onFDragOver}
                              onDrop={onFDropOnZone('mid')}
                          >
                              {foresee.mid.length === 0 && (
                                  <div className="pb-foresee-placeholder">Revealed Cards Area</div>
                              )}
                              <div className="pb-foresee-cards">
                                  {foresee.mid.map((id, i) => (
                                      <figure
                                          key={`mid-${id}-${i}`}
                                          className="pb-gallery-card pb-foresee-card"
                                          draggable
                                          onDragStart={onFDragStart('mid', i)}
                                          onDragEnd={onFDragEnd}
                                          onDragOver={onFDragOver}
                                          onDrop={onFDropOnTile('mid', i)}
                                      >
                                          <CardZoom id={ensureFrontId(id)} name={id} />
                                          <img
                                              className="pb-card-img"
                                              src={imgSrc(id, 'a')}
                                              alt={imgAlt('card', id, 'a')}
                                              onError={onImgError('card', id, 'a')}
                                              draggable="false"
                                          />
                                      </figure>
                                  ))}
                              </div>
                          </div>

                          {/* Action row */}
                          <div className="pb-foresee-bar">
                              <button
                                  className="tips-btn"
                                  disabled={foresee.mid.length > 0}
                                  onClick={onForeseeConfirm}
                                  title={foresee.mid.length ? 'Assign all cards first' : 'Confirm placement'}
                              >
                                  Confirm
                              </button>
                              <div className="pb-foresee-instructions">Click and Drag Cards to Areas</div>
                              <button className="tips-btn" onClick={onForeseeReset} title="Reset assignments">
                                  Reset
                              </button>
                          </div>

                          {/* Top/Bottom areas */}
                          <div className="pb-foresee-grid">
                              <div
                                  className="pb-foresee-zone"
                                  onDragOver={onFDragOver}
                                  onDrop={onFDropOnZone('top')}
                              >
                                  {foresee.top.length === 0 && (
                                      <div className="pb-foresee-placeholder">Top of Deck Area</div>
                                  )}
                                  <div className="pb-foresee-cards">
                                      {foresee.top.map((id, i) => (
                                          <figure
                                              key={`top-${id}-${i}`}
                                              className="pb-gallery-card pb-foresee-card"
                                              draggable
                                              onDragStart={onFDragStart('top', i)}
                                              onDragEnd={onFDragEnd}
                                              onDragOver={onFDragOver}
                                              onDrop={onFDropOnTile('top', i)}
                                          >
                                              <span className="pb-foresee-index">{i + 1}</span>
                                              <CardZoom id={ensureFrontId(id)} name={id} />
                                              <img
                                                  className="pb-card-img"
                                                  src={imgSrc(id, 'a')}
                                                  alt={imgAlt('card', id, 'a')}
                                                  onError={onImgError('card', id, 'a')}
                                                  draggable="false"
                                              />
                                          </figure>
                                      ))}
                                  </div>
                              </div>

                              <div
                                  className="pb-foresee-zone"
                                  onDragOver={onFDragOver}
                                  onDrop={onFDropOnZone('bottom')}
                              >
                                  {foresee.bottom.length === 0 && (
                                      <div className="pb-foresee-placeholder">Bottom of Deck Area</div>
                                  )}
                                  <div className="pb-foresee-cards">
                                      {foresee.bottom.map((id, i) => (
                                          <figure
                                              key={`bottom-${id}-${i}`}
                                              className="pb-gallery-card pb-foresee-card"
                                              draggable
                                              onDragStart={onFDragStart('bottom', i)}
                                              onDragEnd={onFDragEnd}
                                              onDragOver={onFDragOver}
                                              onDrop={onFDropOnTile('bottom', i)}
                                          >
                                              <span className="pb-foresee-index">{i + 1}</span>
                                              <CardZoom id={ensureFrontId(id)} name={id} />
                                              <img
                                                  className="pb-card-img"
                                                  src={imgSrc(id, 'a')}
                                                  alt={imgAlt('card', id, 'a')}
                                                  onError={onImgError('card', id, 'a')}
                                                  draggable="false"
                                              />
                                          </figure>
                                      ))}
                                  </div>
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          )}

          {healPrompt && (
              <HealModal
                  slotKey={healPrompt.slotKey}
                  x={healPrompt.x}
                  damage={healPrompt.damage}
                  statuses={healPrompt.statuses}
                  onConfirm={({ slotKey, removeDamage, statusId }) => {
                      const DAMAGE_ID = 'damage_k';
                      setSlotCounters(prev => {
                          const current = { ...(prev?.[slotKey] || {}) };

                          if (removeDamage > 0) {
                              current[DAMAGE_ID] = Math.max(0, (current[DAMAGE_ID] || 0) - removeDamage);
                          }
                          if (statusId) {
                              current[statusId] = Math.max(0, (current[statusId] || 0) - 1);
                          }

                          // tidy: drop zeroed entries and remove the slot key if empty
                          const cleaned = Object.fromEntries(
                              Object.entries(current).filter(([, n]) => (n || 0) > 0)
                          );
                          const next = { ...(prev || {}) };
                          if (Object.keys(cleaned).length) next[slotKey] = cleaned; else delete next[slotKey];
                          return next;
                      });
                      setHealPrompt(null);
                  }}
                  onClose={() => setHealPrompt(null)}
              />
          )}

          {addLabelPrompt && (
              <AddLabelModal
                  slotKey={addLabelPrompt.slotKey}
                  onConfirm={({ slotKey, text }) => {
                      setSlotLabels(prev => {
                          const next = { ...(prev || {}) };
                          const arr = Array.isArray(next[slotKey]) ? [...next[slotKey]] : [];
                          arr.push(text);
                          next[slotKey] = arr;
                          return next;
                      });
                      setAddLabelPrompt(null);
                  }}
                  onClose={() => setAddLabelPrompt(null)}
              />
          )}

          {removeLabelPrompt && (
              <RemoveLabelModal
                  slotKey={removeLabelPrompt.slotKey}
                  labels={removeLabelPrompt.labels}
                  onConfirm={({ slotKey, remove }) => {
                      setSlotLabels(prev => {
                          const next = { ...(prev || {}) };
                          const arr = (next[slotKey] || []).filter(t => !remove.includes(t));
                          if (arr.length) next[slotKey] = arr; else delete next[slotKey];
                          return next;
                      });
                      setRemoveLabelPrompt(null);
                  }}
                  onClose={() => setRemoveLabelPrompt(null)}
              />
          )}

          {fetchPrompt && (
              <FetchCardsModal
                  onClose={() => setFetchPrompt(null)}
                  deckRef={(typeof fetchPrompt === 'object' && fetchPrompt?.owner === 'opponent') ? oDeckRef : deckRef}
                  setDeckPile={(typeof fetchPrompt === 'object' && fetchPrompt?.owner === 'opponent') ? setODeckPile : setDeckPile}
                  setHand={(typeof fetchPrompt === 'object' && fetchPrompt?.owner === 'opponent') ? setOHand : setHand}
                  setPeekCard={setPeekCard}
                  // NOTE: let the modal know which stack’s peek to close (only close when it matches)
                  peekFrom={(typeof fetchPrompt === 'object' && fetchPrompt?.owner === 'opponent') ? 'odeck' : 'deck'}
              />
          )}

          {damagePrompt && (
              <InflictDamageModal
                  slotKey={damagePrompt.slotKey}
                  onClose={() => setDamagePrompt(null)}
                  getCardId={(key) => key === 'partner' ? partnerId : boardSlots[key]}
                  getSlotSide={(key) => key === 'partner' ? (partnerSide || 'a') : (slotSides?.[key] || 'a')}
                  counters={slotCounters}
                  setCounters={setSlotCounters}
                  dataMaps={dataMaps}
              />
          )}

    </div>
  );
}

/** Optional plugin activation (kept for parity with other plugins) */
export default function activatePlaytestBoard() {
  // no-op for now
}