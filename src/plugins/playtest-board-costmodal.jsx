// /src/plugins/playtest-board-costmodal.jsx
// Playtest Board – Cost selection modal (plugin)
// Uses existing styles from playtest-board.css

import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

/* =========================
   Public API
   ========================= */

// Snapshot the current element pools from the right panel
export function getAvailableElements() {
    const st = (typeof window !== "undefined" && window.__PB_ELEMENTS_STATE) || {};
    return { ...(st.values || {}) };
}

// Resolve which element trackers are visible in the Right Panel
export function getVisibleElementNames() {
    if (typeof window === "undefined") return null;

    const fromWindow = window.__PB_VISIBLE_ELEMENTS_SET;
    if (fromWindow && typeof fromWindow.has === "function") {
        return new Set(Array.from(fromWindow));
    }

    try {
        const nodes = document.querySelectorAll(".er-section .er-row .er-name");
        const names = Array.from(nodes)
            .map(n => (n.textContent || "").trim())
            .filter(Boolean);
        return names.length ? new Set(names) : null;
    } catch {
        return null;
    }
}

// Best-effort “spend”
export function spendElements(spendMap) {
    const st = (typeof window !== "undefined" && window.__PB_ELEMENTS_STATE) || null;
    if (st?.setValues) {
        st.setValues(prev => {
            const next = { ...(prev || {}) };
            for (const [k, v] of Object.entries(spendMap || {})) {
                const cur = Number(next[k] || 0);
                next[k] = Math.max(0, cur - (Number(v) || 0));
            }
            return next;
        });
    } else if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("pb:elements:spend", { detail: { spend: spendMap } }));
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
            onConfirm={(spend) => {
                try { spendElements(spend); } catch (_) { }
                controller.close(spend);
            }}
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
const EL = { list: null, byLetter: null, colorByName: null, order: null };
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
    list.forEach(e => {
        const name = e.DisplayName;
        const letter = (e.CostStringLetter || "").toUpperCase();
        const color = e.HexColor || "#888";
        if (letter) byLetter[letter] = name;
        if (name) colorByName[name] = color;
    });
    EL.list = list;
    EL.byLetter = byLetter;
    EL.colorByName = colorByName;
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
    const { cardId, side = "a", available = null } = options || {};
    const [meta, setMeta] = useState({ order: [], colors: {}, byLetter: {} });
    const [required, setRequired] = useState({ fixed: {}, wild: 0 });
    const [spend, setSpend] = useState({});
    const [avail, setAvail] = useState(available || getAvailableElements());
    const visibleSet = useMemo(() => getVisibleElementNames(), []);
    const [title, setTitle] = useState("Cost Window");
    const [imgSrc, setImgSrc] = useState(null);
    const [anyType, setAnyType] = useState(false);

    // Load metadata and card info
    useEffect(() => {
        (async () => {
            const { order, colorByName, byLetter } = await getElementsMeta();
            setMeta({ order, colors: colorByName, byLetter });

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
            setRequired(parsed);
        })();
    }, [cardId, side]);

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

    const totalRequired = useMemo(() => sum(required.fixed) + (required.wild || 0), [required]);
    const totalSpent = useMemo(() => sum(spend), [spend]);

    // Total fixed requirement (sum across all specific elements)
    const fixedNeedTotal = useMemo(() => sum(required.fixed), [required]);

    const meetsFixed = useMemo(() => {
        if (anyType) {
            // When enabled, any resource can satisfy fixed costs → only the total matters
            return totalSpent >= fixedNeedTotal;
        }
        // Normal rule: meet each element's specific fixed requirement
        for (const [name, need] of Object.entries(required.fixed || {})) {
            if ((spend[name] || 0) < (need || 0)) return false;
        }
        return true;
    }, [required, spend, totalSpent, anyType, fixedNeedTotal]);

    const meetsWild = useMemo(() => {
        const wildNeed = required.wild || 0;

        if (anyType) {
            // Spend covers fixed first (by total), then leftover covers wild
            const fixedSatisfied = Math.min(totalSpent, fixedNeedTotal);
            const extra = totalSpent - fixedSatisfied;
            return extra >= wildNeed;
        }

        // Normal rule: only "extra beyond fixed-by-type" can cover wild
        const fixedOnly = Object.entries(required.fixed || {}).reduce(
            (acc, [k, need]) => acc + Math.min(need, spend[k] || 0), 0
        );
        const extra = totalSpent - fixedOnly;
        return extra >= wildNeed;
    }, [required, spend, totalSpent, anyType, fixedNeedTotal]);

    const canConfirm = meetsFixed && meetsWild && totalSpent === totalRequired;

    const setQty = (name, n) => {
        const have = Number(avail?.[name] || 0);
        setSpend(prev => ({ ...prev, [name]: clamp(n, 0, have) }));
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

    const payingChips = Object.entries(spend || {})
        .filter(([, v]) => (v || 0) > 0)
        .map(([name, amt]) => chip(`pay-${name}`, name, amt, meta.colors[name]));

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

                {/* === Footer actions === */}
                <div className="pb-encounter-actions" style={{ justifyContent: "space-between" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                        <button className="tips-btn" onClick={() => {
                            const zeros = {};
                            for (const k of Object.keys(spend || {})) zeros[k] = 0;
                            setSpend(zeros);
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
                    </div>

                    <div className="pb-encounter-count">{totalSpent} / {totalRequired}</div>

                    <button className="tips-btn pb-encounter-generate" disabled={!canConfirm} onClick={() => onConfirm(spend)}>
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
}
