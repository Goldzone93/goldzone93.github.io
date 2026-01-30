// /src/plugins/playtest-board-costmodal.jsx
// Playtest Board – Cost selection modal (plugin)
// Uses existing styles from playtest-board.css

import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

/* =========================
   Public API
   ========================= */

// Snapshot the current element pools from the right panel (owner-aware)
export function getAvailableElements(owner = 'player') {
    const st = (typeof window !== 'undefined')
        ? (owner === 'opponent' ? window.__PB_O_ELEMENTS_STATE : window.__PB_ELEMENTS_STATE)
        : null;
    return { ...((st && st.values) || {}) };
}
// Resolve which element trackers are visible in the Right Panel (owner-aware)
export function getVisibleElementNames(owner = 'player') {
    if (typeof window === 'undefined') return null;

    const key = owner === 'opponent' ? '__PB_O_VISIBLE_ELEMENTS_SET' : '__PB_VISIBLE_ELEMENTS_SET';
    const fromWindow = window[key];
    if (fromWindow && typeof fromWindow.has === 'function') {
        return new Set(Array.from(fromWindow));
    }

    // Fallback: read from the panel that matches the owner
    try {
        const root = document.querySelector(`.owner-section[data-owner="${owner}"]`);
        if (!root) return null;
        const nodes = root.querySelectorAll('.er-section .er-row .er-name');
        const names = Array.from(nodes)
            .map(n => (n.textContent || '').trim())
            .filter(Boolean);
        return names.length ? new Set(names) : null;
    } catch {
        return null;
    }
}

// Best-effort “spend” (owner-aware)
export function spendElements(spendMap, owner = 'player') {
    // Support callers that pass { spend, hoards } payloads
    if (spendMap && typeof spendMap === 'object' && !Array.isArray(spendMap) && spendMap.spend && typeof spendMap.spend === 'object') {
        spendMap = spendMap.spend;
    }

    const st = (typeof window !== 'undefined')
        ? (owner === 'opponent' ? window.__PB_O_ELEMENTS_STATE : window.__PB_ELEMENTS_STATE)
        : null;

    // Normalize once so downstream never double-applies weird values
    const normalized = Object.entries(spendMap || {}).reduce((acc, [rawK, rawV]) => {
        const k = String(rawK).trim();
        const amt = Math.max(0, Math.floor(Number(rawV) || 0));
        if (amt > 0) acc[k] = amt;
        return acc;
    }, {});

    if (st?.setValues || st?.spend) {
        const apply = st.spend || ((map) => st.setValues(prev => {
            const next = { ...(prev || {}) };
            for (const [k, amt] of Object.entries(map)) {
                const cur = Number(next[k] || 0);
                next[k] = Math.max(0, cur - amt);
            }
            return next;
        }));
        apply(normalized);
    } else if (typeof window !== 'undefined') {
        const ev = owner === 'opponent' ? 'pb:o-elements:spend' : 'pb:elements:spend';
        window.dispatchEvent(new CustomEvent(ev, { detail: { spend: normalized } }));
    }
}

// Snapshot the opponent element pools (Right Panel → opponent section)
export function getAvailableElementsOpponent() {
    const st = (typeof window !== "undefined" && window.__PB_O_ELEMENTS_STATE) || {};
    return { ...(st.values || {}) };
}

// Best-effort “spend” from opponent pools
export function spendOpponentElements(spendMap) {
    // Support callers that pass { spend, hoards } payloads
    if (spendMap && typeof spendMap === 'object' && !Array.isArray(spendMap) && spendMap.spend && typeof spendMap.spend === 'object') {
        spendMap = spendMap.spend;
    }

    const st = (typeof window !== "undefined" && window.__PB_O_ELEMENTS_STATE) || null;

    const normalized = Object.entries(spendMap || {}).reduce((acc, [rawK, rawV]) => {
        const k = String(rawK).trim();
        const amt = Math.max(0, Math.floor(Number(rawV) || 0));
        if (amt > 0) acc[k] = amt;
        return acc;
    }, {});

    if (st?.setValues) {
        st.setValues(prev => {
            const next = { ...(prev || {}) };
            for (const [k, amt] of Object.entries(normalized)) {
                const cur = Number(next[k] || 0);
                next[k] = Math.max(0, cur - amt);
            }
            return next;
        });
    } else if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("pb:o-elements:spend", { detail: { spend: normalized } }));
    }
}

// Open the modal; resolves with the spend map or null (if cancelled)
export function openPlayCostModal(opts) {
    ensureMounted();
    return controller.open(opts || {});
}

/* =========================
   Internal controller
   ========================= */

let mounted = false;
let controller = null;

function ensureMounted() {
    if (mounted) return;
    const host = document.createElement("div");
    host.id = "pb-cost-modal-host";
    document.body.appendChild(host);
    const root = createRoot(host);
    controller = createController();
    root.render(<CostModalController controller={controller} />);
    mounted = true;
}

function createController() {
    let setState = () => { };
    let resolver = null;

    return {
        subscribe(fn) { setState = fn; },
        open(options) {
            return new Promise((resolve) => {
                resolver = resolve;
                setState({ open: true, options });
            });
        },
        close(payload) {
            setState({ open: false, options: null });
            if (resolver) resolver(payload ?? null);
            resolver = null;
        }
    };
}

function CostModalController({ controller }) {
    const [state, setState] = useState({ open: false, options: null });
    useEffect(() => controller.subscribe(setState), [controller]);
    if (!state.open) return null;
    return (
        <CostModal
            options={state.options}
            onCancel={() => controller.close(null)}
            onConfirm={(spend) => controller.close(spend)}
        />
    );
}

/* =========================
   Image helpers (mirror board rules)
   ========================= */
// Same strategy as the board: strip any trailing "_a" or "_b" and add the desired side,
// plus a solid fallback image if the source is missing. :contentReference[oaicite:0]{index=0}

const IMG = {
    frontOf: (internal) =>
        `/images/${String(internal || "").replace(/_(a|b)$/i, "")}_a.png`,
    backOf: (internal) =>
        `/images/${String(internal || "").replace(/_(a|b)$/i, "")}_b.png`,
    fallbackFront: "/images/card0000_a.png",
    fallbackBack: "/images/card0000_b.png",
};

function getImagePath(internalName, side = "a") {
    return side === "b" ? IMG.backOf(internalName) : IMG.frontOf(internalName);
}

function onImgError(internalName, side = "a") {
    return (e) => {
        e.currentTarget.onerror = null;
        const fallback = side === "b" ? IMG.fallbackBack : IMG.fallbackFront;
        e.currentTarget.src = fallback;
    };
}

/* =========================
   Utilities
   ========================= */

function hexToRGBA(hex, alpha = 1) {
    if (!hex) return `rgba(255,255,255,${alpha})`;
    let c = hex.replace("#", "");
    if (c.length === 3) c = c.split("").map(x => x + x).join("");
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}
const sum = (obj) => Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0);

// Cache element & card metadata
const EL = { list: null, byLetter: null, colorByName: null, order: null, byInternal: null, colorByInternal: null };
const CARDS = { map: null };
// NEW: caches for other public data files
const PARTNERS = { map: null };
const TOKENS = { map: null };

async function getElementsMeta() {
    if (EL.list) return EL;
    const [refRes, elRes] = await Promise.all([
        fetch("/reference.json", { cache: "no-store" }).then(r => r.json()).catch(() => null),
        fetch("/elements.json", { cache: "no-store" }).then(r => r.json()).catch(() => null),
    ]);
    const order = Array.isArray(refRes?.Element) ? refRes.Element : [];
    const list = Array.isArray(elRes) ? elRes : [];
    const byLetter = {};
    const colorByName = {};
    const byInternal = {};
    const colorByInternal = {};
    list.forEach(e => {
        const internal = String(e.InternalName || '').trim();
        const name = e.DisplayName;
        const letter = (e.CostStringLetter || "").toUpperCase();
        const color = e.HexColor || "#888";
        if (letter) byLetter[letter] = name;
        if (name) colorByName[name] = color;
        if (internal) byInternal[internal] = name || internal;
        if (internal) colorByInternal[internal] = color;
    });
    EL.list = list;
    EL.byLetter = byLetter;
    EL.colorByName = colorByName;
    EL.byInternal = byInternal;
    EL.colorByInternal = colorByInternal;
    EL.order = order.length ? order : list.map(e => e.DisplayName).filter(Boolean);
    return EL;
}

async function getCardsMap() {
    if (CARDS.map) return CARDS.map;

    const [cardsRes, partnersRes, tokensRes] = await Promise.all([
        fetch("/cards.json", { cache: "no-store" }).then(r => r.json()).catch(() => []),
        fetch("/partners.json", { cache: "no-store" }).then(r => r.json()).catch(() => []),
        fetch("/tokens.json", { cache: "no-store" }).then(r => r.json()).catch(() => []),
    ]);

    const m = {};
    const addAll = (arr) => {
        (Array.isArray(arr) ? arr : []).forEach(c => {
            if (c?.InternalName) m[c.InternalName] = c;
        });
    };

    addAll(cardsRes);
    addAll(partnersRes);
    addAll(tokensRes);

    CARDS.map = m;
    return CARDS.map;
}

// NEW: load /partners.json into a map by InternalName
async function getPartnersMap() {
    if (PARTNERS.map) return PARTNERS.map;
    const res = await fetch("/partners.json", { cache: "no-store" });
    const arr = await res.json();
    const m = {};
    (Array.isArray(arr) ? arr : []).forEach(c => {
        if (c?.InternalName) m[c.InternalName] = c;
    });
    PARTNERS.map = m;
    return PARTNERS.map;
}

// NEW: load /tokens.json into a map by InternalName
async function getTokensMap() {
    if (TOKENS.map) return TOKENS.map;
    const res = await fetch("/tokens.json", { cache: "no-store" });
    const arr = await res.json();
    const m = {};
    (Array.isArray(arr) ? arr : []).forEach(c => {
        if (c?.InternalName) m[c.InternalName] = c;
    });
    TOKENS.map = m;
    return TOKENS.map;
}

// Prefer the record that matches the requested side, regardless of what id was passed
async function getCardRecordById(id, side = "a") {
    const cards = await getCardsMap();
    const base = String(id || "").replace(/_(a|b)$/i, "");
    const desiredKey = `${base}_${side}`;

    // 1) exact desired side, 2) exact id as-is, 3) fallbacks by side
    const rec =
        cards[desiredKey] ||
        cards[id] ||
        cards[`${base}_a`] ||
        cards[`${base}_b`] ||
        null;

    // return both the record and the resolved internal name we actually used
    return { rec, resolvedId: rec?.InternalName || desiredKey || id };
}

function resolveCard(cards, id, side = "a") {
    if (!id) return null;

    // Exact match first
    if (cards[id]) return cards[id];

    // If id has no _a/_b, try with the requested side, then fallbacks
    const hasSuffix = /_(a|b)$/i.test(String(id));
    if (!hasSuffix) {
        if (cards[`${id}_${side}`]) return cards[`${id}_${side}`];
        if (cards[`${id}_a`]) return cards[`${id}_a`];
        if (cards[`${id}_b`]) return cards[`${id}_b`];
    }

    return null;
}

function parseCostString(str, byLetter) {
    // Returns { fixed: {Name:n}, wild:n } ; treats any X? as 0 placeholder
    const out = { fixed: {}, wild: 0 };
    const s = String(str || "").trim().toUpperCase();
    if (!s) return out;
    const re = /(\d+|X)?([A-Z])/g;
    let m;
    while ((m = re.exec(s))) {
        const qty = m[1] == null ? 1 : (String(m[1]) === "X" ? 0 : parseInt(m[1], 10) || 0);
        const L = m[2];
        if (L === "A") { out.wild += qty; continue; }
        const name = byLetter[L] || L;
        out.fixed[name] = (out.fixed[name] || 0) + qty;
    }
    return out;
}

/* =========================
   Modal
   ========================= */

function CostModal({ options, onCancel, onConfirm }) {
    const { cardId, side = "a", available = null, owner = "player", hoardCards = [] } = options || {};
    const [meta, setMeta] = useState({ order: [], colors: {}, byLetter: {}, byInternal: {}, colorByInternal: {} });
    const [baseRequired, setBaseRequired] = useState({ fixed: {}, wild: 0 });
    const [baseCostStr, setBaseCostStr] = useState("");
    const [required, setRequired] = useState({ fixed: {}, wild: 0 });
    const [spend, setSpend] = useState({});
    const [overrideCost, setOverrideCost] = useState(false);
    const [overrideCostStr, setOverrideCostStr] = useState("");
    const [avail, setAvail] = useState(available || getAvailableElements(owner));
    const visibleSet = useMemo(() => getVisibleElementNames(owner), [owner]);
    const [title, setTitle] = useState("Cost Window");
    const [imgSrc, setImgSrc] = useState(null);
    const [anyType, setAnyType] = useState(false);
    const [hoardPick, setHoardPick] = useState({}); // { [slotKey]: internalName }

    // Load metadata and card info
    useEffect(() => {
        (async () => {
            const { order, colorByName, byLetter, byInternal, colorByInternal } = await getElementsMeta();
            setMeta({ order, colors: colorByName, byLetter, byInternal, colorByInternal });

            const { rec: card, resolvedId } = await getCardRecordById(cardId, side);
            const name = card?.Name || card?.CardName || resolvedId || cardId;
            setTitle(name);

            // Always render art for the resolved record + requested side
            setImgSrc(getImagePath(resolvedId || cardId, side));

            // Prefer the resolved record's Cost; if a schema ever encodes back-cost on the same record,
            // we also check the common back-side keys, then fall back to front-side keys.
            const costStr =
                (card?.Cost != null ? card?.Cost : null) ??
                (side === "b" ? (card?.["Cost ID (Back)"] ?? card?.CostIdBack ?? null) : null) ??
                card?.["Cost ID"] ?? card?.CostID ?? card?.CostId ?? card?.CostString ?? "";

            const parsed = parseCostString(costStr, byLetter);
            setBaseCostStr(String(costStr || ""));
            setBaseRequired(parsed);
            setRequired(parsed);

            // Reset override state when opening a new card
            setOverrideCost(false);
            setOverrideCostStr("");
            setHoardPick({});
        })();
    }, [cardId, side]);

    // Apply override cost when enabled
    useEffect(() => {
        if (!overrideCost) {
            setRequired(baseRequired);
            return;
        }

        const str = String(overrideCostStr || baseCostStr || "");
        const parsed = parseCostString(str, meta.byLetter || {});
        setRequired(parsed);
    }, [overrideCost, overrideCostStr, baseCostStr, baseRequired, meta.byLetter]);

    // Initialize spend with zeros for visible keys
    useEffect(() => {
        const ordered = (meta.order && meta.order.length)
            ? meta.order
            : Object.keys(avail || {});

        const names = ordered.filter(n => !visibleSet || visibleSet.has(n));

        const base = {};
        for (const k of names) base[k] = 0;
        setSpend(base);
    }, [avail, meta.order, required.fixed, visibleSet]);

    const hoardSpend = useMemo(() => {
        const out = {};
        for (const internal of Object.values(hoardPick || {})) {
            if (!internal) continue;
            const name = (meta.byInternal && meta.byInternal[internal]) || String(internal);
            out[name] = (out[name] || 0) + 1;
        }
        return out;
    }, [hoardPick, meta.byInternal]);

    const totalRequired = useMemo(() => sum(required.fixed) + (required.wild || 0), [required]);
    const totalSpent = useMemo(() => sum(spend) + sum(hoardSpend), [spend, hoardSpend]);

    // Total fixed requirement (sum across all specific elements)
    const fixedNeedTotal = useMemo(() => sum(required.fixed), [required]);

    const meetsFixed = useMemo(() => {
        if (anyType) {
            // When enabled, any resource can satisfy fixed costs → only the total matters
            return totalSpent >= fixedNeedTotal;
        }
        // Normal rule: meet each element's specific fixed requirement
        for (const [name, need] of Object.entries(required.fixed || {})) {
            const have = (spend[name] || 0) + (hoardSpend[name] || 0);
            if (have < (need || 0)) return false;
        }
        return true;
    }, [required, spend, hoardSpend, totalSpent, anyType, fixedNeedTotal]);

    const meetsWild = useMemo(() => {
        const wildNeed = required.wild || 0;

        if (anyType) {
            // Spend covers fixed first (by total), then leftover covers wild
            const fixedSatisfied = Math.min(totalSpent, fixedNeedTotal);
            const extra = totalSpent - fixedSatisfied;
            return extra >= wildNeed;
        }

        // Normal rule: only "extra beyond fixed-by-type" can cover wild
        const fixedOnly = Object.entries(required.fixed || {}).reduce((acc, [k, need]) => {
            const have = (spend[k] || 0) + (hoardSpend[k] || 0);
            return acc + Math.min(need, have);
        }, 0);
        const extra = totalSpent - fixedOnly;
        return extra >= wildNeed;
    }, [required, spend, totalSpent, anyType, fixedNeedTotal]);

    const canConfirm = meetsFixed && meetsWild && totalSpent === totalRequired;

    const setQty = (name, n) => {
        const have = Number(avail?.[name] || 0);
        setSpend(prev => ({ ...prev, [name]: clamp(n, 0, have) }));
    };

    const toggleHoardPick = (slotKey, internalName) => {
        setHoardPick((prev) => {
            const cur = prev?.[slotKey];
            const next = { ...(prev || {}) };
            if (cur === internalName) {
                delete next[slotKey];
                return next;
            }
            next[slotKey] = internalName;
            return next;
        });
    };

    const chip = (key, label, n, color) => {
        const bg = hexToRGBA(color || "#999", 0.25);
        const bd = color || "#999";
        return (
            <div key={key} className="pb-filter-chip active" style={{ borderColor: bd, backgroundColor: bg }}>
                <span>{label}</span>
                <span style={{ marginLeft: 8, padding: "0 6px", borderRadius: 6, background: "rgba(0,0,0,0.25)" }}>{n}</span>
            </div>
        );
    };

    const requiredChips = [
        ...Object.entries(required.fixed || {}).map(([name, amt]) =>
            chip(`req-${name}`, name, amt, meta.colors[name])
        ),
        ...(required.wild ? [chip("req-wild", "Wild", required.wild, "#9aa0a6")] : []),
    ];

    const payingChips = (() => {
        const combined = { ...(spend || {}) };
        for (const [k, v] of Object.entries(hoardSpend || {})) {
            combined[k] = (combined[k] || 0) + (Number(v) || 0);
        }
        return Object.entries(combined)
            .filter(([, v]) => (v || 0) > 0)
            .map(([name, amt]) => chip(`pay-${name}`, name, amt, meta.colors[name]));
    })();

    return (
        <div className="pb-modal" role="dialog" aria-modal="true">
            <div className="pb-modal-content pb-cost-content">
                <div className="pb-modal-header">
                    <div className="pb-modal-title">Cost Window</div>
                    <button className="tips-btn" onClick={onCancel}>Cancel</button>
                </div>

                {/* === TOP: card preview | required + paying === */}
                <div className="pb-cost-body">
                    <div className="pb-cost-left">
                        <figure className="pb-gallery-card" style={{ width: "min(38vw, 300px)" }}>
                            <img
                                className="pb-card-img"
                                src={imgSrc}
                                alt={`card:${cardId}:${side}`}
                                draggable="false"
                                onError={onImgError(cardId, side)}
                            />
                            <figcaption className="pb-gallery-name" title={title}>{title}</figcaption>
                        </figure>
                    </div>

                    <div className="pb-cost-right">
                        <div className="pb-cost-section">
                            <div className="pb-eg-sectionlabel">Required Cost</div>
                            <div className="pb-filter-group">
                                {requiredChips.length ? requiredChips : <div className="pb-empty-state">Free</div>}
                            </div>
                        </div>

                        <div className="pb-cost-section">
                            <div className="pb-eg-sectionlabel">Currently Paying</div>
                            <div className="pb-filter-group">
                                {payingChips.length ? payingChips : null}
                            </div>
                        </div>
                    </div>
                </div>

                {/* === AVAILABLE RESOURCES === */}
                <div className="pb-cost-alloc">
                    <div className="pb-eg-sectionlabel">Available Resources</div>

                    <div className="cm-rows">
                        {(() => {
                            const ordered = (meta.order && meta.order.length)
                                ? meta.order
                                : Object.keys(avail || {});
                            const namesToShow = ordered.filter(n => !visibleSet || visibleSet.has(n));

                            return namesToShow.map((name) => {
                                const have = Number(avail?.[name] || 0);
                                const v = Number(spend?.[name] || 0);
                                const color = meta.colors[name] || "#777";
                                const steps = Array.from({ length: have + 1 }, (_, i) => i);

                                return (
                                    <div key={name} className="cm-row">
                                        <div
                                            className="cm-elcard"
                                            style={{ borderColor: color, backgroundColor: hexToRGBA(color, 0.25) }}
                                        >
                                            <div className="cm-elname">{name}</div>
                                            <div className="cm-elqty">{have}</div>
                                        </div>

                                        <div className="cm-toggles" role="group" aria-label={`Pay with ${name}`}>
                                            {steps.map(n => {
                                                const active = n === v;
                                                const bg = hexToRGBA(color, active ? 0.35 : 0.18);
                                                const bd = active ? color : hexToRGBA(color, 0.45);
                                                return (
                                                    <button
                                                        key={`${name}-${n}`}
                                                        type="button"
                                                        className={`pb-filter-chip${active ? " active" : ""}`}
                                                        style={{ borderColor: bd, backgroundColor: bg }}
                                                        onClick={() => setQty(name, n)}
                                                        title={`Use ${n} ${name}`}
                                                    >
                                                        {n}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                </div>

                {/* === HOARD COUNTERS (Resource Counters on board cards) === */}
                {Array.isArray(hoardCards) && hoardCards.length ? (
                    <div className="pb-cost-hoards">
                        <div className="pb-eg-sectionlabel">Hoard Counters</div>

                        <div className="pb-cost-hoards-grid">
                            {hoardCards.map((c) => {
                                const slotKey = String(c.slotKey || '').trim();
                                const cid = c.cardId;
                                if (!slotKey || !cid) return null;

                                const counts = c.counts || {};
                                const picked = hoardPick?.[slotKey];
                                const img = getImagePath(cid, c.side || 'a');

                                const chips = Object.entries(counts)
                                    .filter(([, v]) => (Number(v) || 0) > 0)
                                    .map(([internal, v]) => {
                                        const display = (meta.byInternal && meta.byInternal[internal]) || internal;
                                        const color = (meta.colorByInternal && meta.colorByInternal[internal]) || meta.colors[display] || '#777';
                                        const active = picked === internal;
                                        const bg = hexToRGBA(color, active ? 0.35 : 0.18);
                                        const bd = active ? color : hexToRGBA(color, 0.45);
                                        return (
                                            <button
                                                key={`${slotKey}-${internal}`}
                                                type="button"
                                                className={`pb-filter-chip${active ? ' active' : ''}`}
                                                style={{ borderColor: bd, backgroundColor: bg }}
                                                onClick={() => toggleHoardPick(slotKey, internal)}
                                                title={`Use 1 ${display} from ${slotKey}`}
                                            >
                                                <span>{display}</span>
                                                <span style={{ marginLeft: 8, padding: '0 6px', borderRadius: 6, background: 'rgba(0,0,0,0.25)' }}>
                                                    x {Number(v) || 0}
                                                </span>
                                            </button>
                                        );
                                    });

                                return (
                                    <div key={slotKey} className="pb-cost-hoard-item">
                                        <img
                                            className="pb-card-img pb-cost-hoard-img"
                                            src={img}
                                            alt={`hoard:${slotKey}:${cid}`}
                                            draggable="false"
                                            onError={onImgError(cid, c.side || 'a')}
                                        />
                                        <div className="pb-cost-hoard-chips">
                                            {chips.length ? chips : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : null}

                {/* === Footer actions === */}
                <div className="pb-encounter-actions" style={{ justifyContent: "space-between" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                        <button className="tips-btn" onClick={() => {
                            const zeros = {};
                            for (const k of Object.keys(spend || {})) zeros[k] = 0;
                            setSpend(zeros);
                            setHoardPick({});
                        }}>Reset</button>

                        {/* Moved to the RIGHT of Reset; smaller checkbox via pb-check--small */}
                        <label className="pb-check pb-check--small" title="Treat all spent resources as any element type">
                            <span>Spend Resources as Any Type</span>
                            <input
                                type="checkbox"
                                checked={anyType}
                                onChange={(e) => setAnyType(e.target.checked)}
                            />
                        </label>

                        <label className="pb-check pb-check--small" title="Override this card's required cost string">
                            <span>Override Cost</span>
                            <input
                                type="checkbox"
                                checked={overrideCost}
                                onChange={(e) => {
                                    const checked = e.target.checked;
                                    setOverrideCost(checked);
                                    if (checked && !String(overrideCostStr || "").trim()) {
                                        setOverrideCostStr(String(baseCostStr || ""));
                                    }
                                }}
                            />
                        </label>

                        <input
                            className="pb-search-input pb-cost-override-input"
                            type="text"
                            value={overrideCostStr}
                            onChange={(e) => setOverrideCostStr(e.target.value)}
                            disabled={!overrideCost}
                            placeholder={overrideCost ? "e.g. 2W1A" : ""}
                            title="Cost string (same rules as card Cost)"
                        />
                    </div>

                    <div className="pb-encounter-count">{totalSpent} / {totalRequired}</div>

                    <button
                        className="tips-btn pb-encounter-generate"
                        disabled={!canConfirm}
                        onClick={() => {
                            const finalSpend = Object.fromEntries(
                                Object.entries(spend || {})
                                    .map(([k, v]) => [String(k).trim(), Math.max(0, Math.floor(Number(v) || 0))])
                                    .filter(([, v]) => v > 0)
                            );
                            const hoardsUsed = Object.entries(hoardPick || {})
                                .map(([slotKey, internal]) => ({ slotKey: String(slotKey), internal: String(internal) }))
                                .filter((x) => x.slotKey && x.internal);

                            onConfirm({ spend: finalSpend, hoards: hoardsUsed });
                        }}
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
}
