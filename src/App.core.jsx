import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { pluginHost, loadPlugins } from './pluginCore.jsx'

// --- Gallery header (sticky) — tweak here ---
const GALLERY_HEADER_TITLE = 'Card Gallery';
const GALLERY_HEADER_STYLE = {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    gridColumn: '1 / -1', // span all gallery columns
    background: 'var(--bg)',
    padding: '8px 8px',
    borderBottom: '1px solid rgba(255,255,255,0.08)'
};
// To adjust: edit title, padding, border, or background above.

// ====== Simple Canvas Charts (no external libs) ======

// --- Gallery card size slider — tweak here ---
const GALLERY_BASE_TILE_MIN = 230; // px (current CSS min card width)
const GALLERY_SCALE_MIN = 0.70; // 30% smaller
const GALLERY_SCALE_MAX = 2.00; // 100% larger
const GALLERY_SLIDER_RANGE = { min: 0, max: 100, step: 1 }; // 0→MIN, 50→1.0x, 100→MAX
const GALLERY_SLIDER_WIDTH = 160; // px — width of the slider + label block


// How far the thumb needs to extend past each end so its CENTER hits the track ends.
// Tweak if your thumb size/skin changes (10–16px is typical).
const GALLERY_SLIDER_OVERFLOW = 14; // px

// Space between the slider and the Reset button
const GALLERY_SLIDER_GAP_AFTER = 8; // px

// Default slider position and reset label — tweak here
const GALLERY_SLIDER_DEFAULT = 25;       // middle = current size
const GALLERY_RESET_LABEL = 'Reset';  // button text

// --- Gallery slider icon — tweak here ---
const GALLERY_SLIDER_ID = 'gallery-size';
const GALLERY_ICON_SIZE = 30; // px (was 14)
const GALLERY_ICON_WRAP_STYLE = {
    marginRight: GALLERY_SLIDER_OVERFLOW + 2, // auto-accounts for knob width + tweak
    opacity: 0.85,
    display: 'flex',
    alignItems: 'center',
    color: 'var(--muted)'
};

// Inline SVG so no extra files needed. Tweak size via GALLERY_ICON_SIZE.
const GALLERY_SLIDER_ICON = (
    <svg
        viewBox="0 0 24 24"
        width={GALLERY_ICON_SIZE}
        height={GALLERY_ICON_SIZE}
        aria-hidden="true"
        focusable="false"
        style={{ display: 'block' }}
    >
        {/* outer card */}
        <rect
            x="5" y="3" width="14" height="18" rx="2" ry="2"
            fill="none" stroke="currentColor" strokeWidth="2"
        />
        {/* small filled area to suggest art/window */}
        <rect
            x="8" y="6" width="8" height="5" rx="1" ry="1"
            fill="currentColor" opacity="0.75"
        />
        {/* a corner pip */}
        <circle cx="9.5" cy="16" r="1.2" fill="currentColor" opacity="0.9" />
    </svg>
);


const DEFAULT_SERIES_COLORS = [
    '#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#8b5cf6',
    '#14b8a6', '#eab308', '#f43f5e', '#10b981', '#64748b'
];

function Legend({ items, simple = false }) {
    const colors = DEFAULT_SERIES_COLORS;
    if (!Array.isArray(items) || items.length === 0) {
        return <div className="chart-legend small">No data.</div>;
    }

    const total = items.reduce((s, it) => s + (Number(it.value) || 0), 0);

    return (
        <div className="chart-legend">
            {items.map((it, idx) => {
                const color = it.color || colors[idx % colors.length];
                let text = it.label ?? 'item';

                if (!simple) {
                    const v = Number(it.value);
                    if (Number.isFinite(v)) {
                        const pct = total > 0 ? (v / total) * 100 : 0;
                        const pctStr = `${pct.toFixed(1).replace(/\.0$/, '')}%`;
                        text += ` — ${v} (${pctStr})`;
                    }
                }

                return (
                    <div className="chart-key" key={`${text}-${idx}`}>
                        <span className="chart-swatch" style={{ background: color }} />
                        <span>{text}</span>
                    </div>
                );
            })}
        </div>
    );
}

function PieChart({ data = [], donut = false, width = 360, height = 240 }) {
    const ref = React.useRef(null);

    React.useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0);
        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) * 0.42;
        const innerR = donut ? radius * 0.60 : 0;

        if (total <= 0) {
            // draw a subtle empty ring
            ctx.fillStyle = '#263143';
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        let start = -Math.PI / 2;
        const colors = DEFAULT_SERIES_COLORS;

        // 1) draw slices (prefer per-item color if provided)
        data.forEach((d, i) => {
            const val = Number(d.value) || 0;
            if (val <= 0) return;
            const ang = (val / total) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.fillStyle = (d && d.color) ? d.color : colors[i % colors.length];
            ctx.arc(cx, cy, radius, start, start + ang, false);
            ctx.closePath();
            ctx.fill();
            start += ang;
        });

        // punch the donut hole if needed
        if (donut) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
        }

        // 2) draw percentage labels on slices (skip very small slices)
        let start2 = -Math.PI / 2;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '12px Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
        const labelR = donut ? (innerR + radius) / 2 : radius * 0.7;

        data.forEach((d) => {
            const val = Number(d.value) || 0;
            if (val <= 0) return;

            const frac = val / total;
            const ang = frac * Math.PI * 2;
            const mid = start2 + ang / 2;

            // Skip clutter for tiny slices (<4% of the pie)
            if (frac >= 0.04) {
                const pctStr = `${(frac * 100).toFixed(1).replace(/\.0$/, '')}%`;
                const tx = cx + Math.cos(mid) * labelR;
                const ty = cy + Math.sin(mid) * labelR;
                ctx.fillText(pctStr, tx, ty);
            }

            start2 += ang;
        });
    }, [data, width, height, donut]);

    return <canvas ref={ref} className="chart-canvas" width={width} height={height} />;
}

function StackedColumnChart({
    categories = [],
    series = [],         // [{ label, data: number[] }, ...] order matters
    width = 1000,
    height = 280
}) {
    const ref = React.useRef(null);

    React.useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const pad = { left: 36, right: 12, top: 10, bottom: 28 };
        const W = width - pad.left - pad.right;
        const H = height - pad.top - pad.bottom;

        // totals per category to set the max axis height
        const totals = categories.map((_, i) =>
            series.reduce((s, sr) => s + (Number(sr.data?.[i]) || 0), 0)
        );
        const max = Math.max(1, ...totals);

        // axes
        ctx.strokeStyle = '#263143';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, pad.top);
        ctx.lineTo(pad.left, pad.top + H);
        ctx.lineTo(pad.left + W, pad.top + H);
        ctx.stroke();

        const slot = W / Math.max(1, categories.length);
        const colW = slot * 0.7;
        const gap = slot - colW;

        // font used for both data labels and x labels
        ctx.font = '12px Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
        ctx.textAlign = 'center';

        // draw columns + % labels per segment
        categories.forEach((cat, idx) => {
            let x = pad.left + idx * slot + gap / 2;
            let y = pad.top + H;

            const colTotal = series.reduce((s, sr) => s + (Number(sr.data?.[idx]) || 0), 0);

            series.forEach((sr, si) => {
                const v = Number(sr.data?.[idx]) || 0;
                if (v <= 0) return;

                const hh = (v / max) * H;
                const color = DEFAULT_SERIES_COLORS[si % DEFAULT_SERIES_COLORS.length];

                // segment bar
                ctx.fillStyle = color;
                ctx.fillRect(x, y - hh, colW, hh);

                // value label inside segment (skip tiny bars)
                if (v > 0 && hh >= 12) {
                    const label = String(v);
                    ctx.fillStyle = '#ffffff';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label, x + colW / 2, y - hh / 2);
                }

                y -= hh;
            });

            // x-labels
            ctx.fillStyle = '#9ca3af';
            ctx.textBaseline = 'top';
            ctx.fillText(String(cat), x + colW / 2, pad.top + H + 4);
        });
    }, [categories, series, width, height]);

    return <canvas ref={ref} className="chart-canvas" width={width} height={height} />;
}

// Parse stat values coming from cards.json.
const statVal = (v) => {
  if (v === '' || v == null) return -Infinity
  if (typeof v === 'string' && v.trim().toUpperCase() === 'X') return -Infinity
  const n = Number(v)
  return Number.isFinite(n) ? n : -Infinity
}

// Safer numeric coercion for user-typed bounds
const safeNum = (x, fallback) => {
  const n = Number(x)
  return Number.isFinite(n) ? n : fallback
}

/// --- image helpers ---
// Try <id>.png -> <id>_a.png -> <id>_b.png -> default
const primaryImg = (id) => `/images/${id}.png`
const aImg       = (id) => `/images/${id}_a.png`
const bImg       = (id) => `/images/${id}_b.png`
const defaultBack = '/images/card0000_b.png'

// --- Virtualization helpers (grid) ---
const estimateGalleryRowHeight = (tileMinWidthPx) => {
    // rough: image + badges + buttons; tweak as needed
    // makes row height scale with your slider
    return Math.round(tileMinWidthPx * 1.6 + 220);
};

/**
 * Virtualizes a CSS grid inside a scrollable container (your <main className="grid">).
 * Renders a slice of items, plus top/bottom spacers to preserve scroll size.
 */
function useGridVirtual({
    containerRef,
    itemCount,
    estimateRowHeight,
    minColumnWidth,
    gap = 12,
    overscan = 3,
}) {
    const [state, setState] = React.useState({
        start: 0,
        end: Math.min(itemCount, 60),
        padTop: 0,
        padBottom: 0,
    });

    React.useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const calc = () => {
            const width = el.clientWidth || 1;
            const cols = Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)));
            const rows = Math.max(1, Math.ceil(itemCount / cols));
            const rowH = estimateRowHeight;

            const scrollTop = el.scrollTop;
            const viewH = el.clientHeight;

            const startRow = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
            const endRow = Math.min(rows, Math.ceil((scrollTop + viewH) / rowH) + overscan);

            const start = startRow * cols;
            const end = Math.min(itemCount, endRow * cols);

            const padTop = startRow * rowH;
            const padBottom = Math.max(0, (rows - endRow) * rowH);

            setState({ start, end, padTop, padBottom });
        };

        calc(); // initial
        el.addEventListener('scroll', calc, { passive: true });

        let ro = null;
        if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(calc);
            ro.observe(el);
        } else {
            // Fallback: recompute on window resize
            window.addEventListener('resize', calc, { passive: true });
        }

        return () => {
            el.removeEventListener('scroll', calc);
            if (ro) ro.disconnect();
            else window.removeEventListener('resize', calc);
        };
    }, [containerRef, itemCount, estimateRowHeight, minColumnWidth, gap, overscan]);

    return state;
}

// --- icon helpers ---
// Try in this order: /images/<InternalName>.png -> /icons/<InternalName>.png -> /images/icons/<InternalName>.png
const iconSrcs = (internal) => [
    `/images/${internal}.png`,
    `/icons/${internal}.png`,
    `/images/icons/${internal}.png`,
];

const getIconSrc = (internal) => iconSrcs(internal)[0];

const makeIconErrorHandler = (internal) => (e) => {
    const img = e.currentTarget;
    const tried = Number(img.dataset.tried || 0);
    const next = iconSrcs(internal)[tried + 1];
    if (next) {
        img.dataset.tried = String(tried + 1);
        img.src = next;
    } else {
        img.style.display = 'none'; // hide cell image if no source works
    }
};

// --- element icon helpers ---
// Try in this order: /images/<InternalName>.png -> /elements/<InternalName>.png -> /images/elements/<InternalName>.png
const elementSrcs = (internal) => [
    `/images/${internal}.png`,
    `/elements/${internal}.png`,
    `/images/elements/${internal}.png`,
];
const getElementSrc = (internal) => elementSrcs(internal)[0];
const makeElementImgErrorHandler = (internal) => (e) => {
    const img = e.currentTarget;
    const tried = Number(img.dataset.tried || 0);
    const next = elementSrcs(internal)[tried + 1];
    if (next) {
        img.dataset.tried = String(tried + 1);
        img.src = next;
    } else {
        img.style.display = 'none'; // hide if not found anywhere
    }
};

// onError chain through the patterns above
const makeImgErrorHandler = (id) => (e) => {
  const img = e.currentTarget
  const tried = img.dataset.tried || '' // '', 'a', 'b', 'default'
  if (tried === '') {
    img.dataset.tried = 'a'
    img.src = aImg(id)
  } else if (tried === 'a') {
    img.dataset.tried = 'b'
    img.src = bImg(id)
  } else if (tried === 'b') {
    img.dataset.tried = 'default'
    img.src = defaultBack
  }
}

// compute the _b InternalName for a given id
const backIdFor = (id) => (id.endsWith('_a') ? id.slice(0, -2) + '_b' : id + '_b')

export default function App() {
  // datasets
  const DATASETS = { CARDS: 'CARDS', PARTNERS: 'PARTNERS', TOKENS: 'TOKENS' }
  const [activeDataset, setActiveDataset] = useState(DATASETS.CARDS)
  const ELEMENT_OPTIONS = ['Neutral', 'Earth', 'Fire', 'Nature', 'Storm', 'Water', 'Toxic', 'Void', 'Ice', 'Synthetic']

  // three sources
  const [cards, setCards] = useState([])
  const [partners, setPartners] = useState([])
  const [tokens, setTokens] = useState([])

    // Keywords modal + data
    const [keywords, setKeywords] = useState([]);

    // Effect Icons modal + data
    const [icons, setIcons] = useState([]);

    // Element Chart modal + data
    const [elements, setElements] = useState([]);

    // Deck Stats modal
    const [statsOpen, setStatsOpen] = useState(false);

    // Stack View modal
    const [stackOpen, setStackOpen] = useState(false);

    // Probabilities controls (hypergeometric inputs)
    const [probCond, setProbCond] = useState('At Least'); // Condition
    const [probQtyInput, setProbQtyInput] = useState('1');        // Quantity (k)
    const [probHandInput, setProbHandInput] = useState('7');        // Hand Size (n)
    const [probDeckInput, setProbDeckInput] = useState('');         // Deck Size (N)

    // Collapsible Filters
    const [filtersCollapsed, setFiltersCollapsed] = useState(false);
    const [helpCollapsed, setHelpCollapsed] = useState(false);

    // Gallery size is now plugin-owned; subscribe to its value
    const [galleryScale, setGalleryScale] = useState(pluginHost.getGalleryScale?.() ?? 1);
    useEffect(() => pluginHost.onGalleryScaleChange?.(setGalleryScale), []);

    // Modal search queries
    // (moved to plugin: gallery-header-buttons controls its own sort state)
    const [sortTick, setSortTick] = useState(0); // incremented when a plugin signals sort change

    // === Toasts (non-blocking status messages) ===
    const [toasts, setToasts] = useState([]); // [{ id, message, type }]
    const dismissToast = useCallback((id) => {
        setToasts(t => t.filter(x => x.id !== id));
    }, []);
    const pushToast = useCallback((message, opts = {}) => {
        const id = Math.random().toString(36).slice(2);
        const duration = Number.isFinite(opts.duration) ? opts.duration : 3500;
        const type = opts.type || 'info'; // 'info' | 'success' | 'warn' | 'error'
        setToasts(t => [...t, { id, message, type }]);
        if (duration > 0) {
            setTimeout(() => dismissToast(id), duration);
        }
    }, [dismissToast]);

    // === Mobile Edge Scroll (left edge scrubber) ===============================
    const [edgeEnabled, setEdgeEnabled] = useState(false);
    const edgeRailRef = useRef(null);
    const edgeThumbRef = useRef(null);

    useEffect(() => {
        // show on small screens only (avoid deprecated addListener/removeListener)
        const mq = window.matchMedia('(max-width: 900px)');
        const apply = () => setEdgeEnabled(mq.matches);
        apply();

        if (typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', apply);
            return () => mq.removeEventListener('change', apply);
        } else {
            // Fallback for very old browsers: re-evaluate on window resize
            const onResize = () => apply();
            window.addEventListener('resize', onResize);
            return () => window.removeEventListener('resize', onResize);
        }
    }, []);

    const scrollMax = useCallback(() => {
        const el = document.scrollingElement || document.documentElement || document.body;
        return Math.max(0, el.scrollHeight - el.clientHeight);
    }, []);

    const syncThumb = useCallback(() => {
        if (!edgeRailRef.current || !edgeThumbRef.current) return;
        const el = document.scrollingElement || document.documentElement || document.body;
        const rail = edgeRailRef.current.getBoundingClientRect();
        const max = scrollMax();
        const y = el.scrollTop || 0;
        const p = max ? y / max : 0;                   // 0..1
        const thumbH = 48;                              // keep in sync with CSS --thumb-h
        const offset = 8;                               // rail top/bottom inset in CSS
        const trackH = Math.max(0, rail.height - 2 * offset - thumbH);
        edgeThumbRef.current.style.transform = `translateY(${(p * trackH) + offset}px)`;
    }, [scrollMax]);

    useEffect(() => {
        if (!edgeEnabled) return;
        syncThumb();
        window.addEventListener('scroll', syncThumb, { passive: true });
        window.addEventListener('resize', syncThumb);
        return () => {
            window.removeEventListener('scroll', syncThumb);
            window.removeEventListener('resize', syncThumb);
        };
    }, [edgeEnabled, syncThumb]);

    // Re-sync the edge scroll thumb when page height changes (e.g., Filters/Help collapse/expand)
    useEffect(() => {
        if (!edgeEnabled) return;

        const getScroller = () => document.scrollingElement || document.documentElement || document.body;
        let lastH = getScroller().scrollHeight;

        const target = document.body;
        const obs = new MutationObserver(() => {
            const curH = getScroller().scrollHeight;
            if (curH !== lastH) {
                lastH = curH;
                syncThumb();
            }
        });

        // Watch for DOM changes that affect layout height
        obs.observe(target, { childList: true, subtree: true, attributes: true });

        // Safety: also re-sync periodically for CSS transitions
        const interval = setInterval(syncThumb, 300);

        return () => {
            obs.disconnect();
            clearInterval(interval);
        };
    }, [edgeEnabled, syncThumb]);

    const onEdgePointerDown = useCallback((e) => {
        if (!edgeRailRef.current) return;
        const el = document.scrollingElement || document.documentElement || document.body;
        const moveTo = (clientY) => {
            const rect = edgeRailRef.current.getBoundingClientRect();
            const offset = 8; // must match CSS
            const thumbH = 48;
            const track = Math.max(0, rect.height - 2 * offset - thumbH);
            const y = Math.min(Math.max(clientY - rect.top - offset, 0), track);
            const p = track > 0 ? (y / track) : 0;
            el.scrollTop = scrollMax() * p; // direct, reliable scroll
        };
        moveTo(e.clientY);
        const onMove = (ev) => moveTo(ev.clientY);
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [scrollMax]);

    // ===== Helpers for Element list rendering (must be inside component) =====

    // Build a lookup for DisplayName and InternalName -> element object
    const elementLookup = useMemo(() => {
        const m = new Map();
        for (const e of elements) {
            const dn = String(e?.DisplayName ?? '').trim().toLowerCase();
            const iname = String(e?.InternalName ?? '').trim().toLowerCase();
            if (dn) m.set(dn, e);
            if (iname) m.set(iname, e);
        }
        return m;
    }, [elements]);

    // Split "Fire, Water" / "Fire|Water" / "Fire/Water" into tokens
    const splitElementList = (val) =>
        String(val ?? '')
            .split(/[,\|/]+/)
            .map(s => s.trim())
            .filter(Boolean);

    // Render a row cell showing element icons (fallback to text badge if not found)
    const renderElementList = (val) => {
        const items = splitElementList(val);
        if (items.length === 0) return null;
        return (
            <div className="elements-list">
                {items.map((name, idx) => {
                    const found = elementLookup.get(name.toLowerCase());
                    if (found?.InternalName) {
                        return (
                            <img
                                key={`${name}-${idx}`}
                                className="element-mini"
                                src={getElementSrc(found.InternalName)}
                                alt={found.DisplayName || found.InternalName}
                                title={found.DisplayName || found.InternalName}
                                data-tried="0"
                                onError={makeElementImgErrorHandler(found.InternalName)}
                                draggable={false}
                            />
                        );
                    }
                    // Fallback: show the text if we can't resolve an image
                    return <span key={`${name}-${idx}`} className="badge">{name}</span>;
                })}
            </div>
        );
    };

  // available types from /types.json
    const [refData, setRefData] = useState({
        SuperType: [],
        CardType: [],
        SubType: [],
        Rarity: [],
        Element: [],
        Set: [],
        Format: [],          // NEW
        Formats: [],
        TurnStructure: [],
        Tips: [],
        FAQ: [],
        CardTypeInfo: [],    // NEW: backing data for the Card Types modal
        CardLayout: null,     // NEW
        BoardLayout: null
    })

    // Build an ordered list for the popup using the Format IDs as the source of truth.
    // Falls back gracefully if a description is missing.
    const formatsList = useMemo(() => {
        const ids = (refData?.Format ?? []);
        const byId = new Map((refData?.Formats ?? []).map(f => [f.id, f]));
        return ids.map(id => {
            const entry = byId.get(id);
            return {
                id,
                name: entry?.name ?? id,
                desc: entry?.desc ?? ''
            };
        });
    }, [refData]);

    // NEW: formats.json controls rarity caps & deck size behavior per Format ID
    const [formatsConfig, setFormatsConfig] = useState({});

    // Selected format (IDs come from reference.json -> Format). Fallback to two defaults.
    const [formatId, setFormatId] = useState('Freeform');

    // --- Collection import (restrict Cards gallery to a collection) ---
    const [collectionFilter, setCollectionFilter] = useState(null);
    // { name: string, ids: Set<string>, quantities: Map<string, number> }
    const collectionFileRef = useRef(null);

    const handleImportCollectionClick = () => {
        collectionFileRef.current?.click();
    };

    const handleImportCollection = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            // Accept { CollectionName, cards: [{ InternalName, Quantity, Set }, ...] }
            const list = Array.isArray(data?.cards) ? data.cards : [];
            const ids = new Set();
            const quantities = new Map();

            for (const entry of list) {
                const raw = String(
                    entry.InternalName ?? entry.internalName ?? entry.id ?? ''
                ).trim();
                if (!raw) continue;
                // normalize to front side (_a). If a bare id is provided, append _a.
                const id = /_(a|b)$/.test(raw) ? raw.replace(/_b$/, '_a') : `${raw}_a`;
                ids.add(id);
                const q = Number(entry.Quantity ?? entry.quantity ?? 0);
                if (Number.isFinite(q)) quantities.set(id, q);
            }

            setCollectionFilter({
                name: String(
                    data.CollectionName ?? data.collectionName ?? file.name.replace(/\.[^.]+$/, '')
                ),
                ids,
                quantities,
            });

            // make sure we're on the Cards dataset when a collection is imported
            setActiveDataset(DATASETS.CARDS);
        } catch (err) {
            alert('Invalid collection file. Expected JSON with { CollectionName, cards: [...] }.');
        } finally {
            // allow selecting the same file again later
            e.target.value = '';
        }
    };

    // Helper: allowed Set IDs for the current format.
    // Returns null if "all sets" are allowed; otherwise returns an array of allowed Set IDs.
    const getAllowedSetsForFormat = useCallback(() => {
        const fmt = formatsConfig?.[formatId] || null;
        const allowed = fmt?.allowedSets;

        // No key or explicit "*" means "all sets allowed"
        if (!allowed || allowed === '*' || (Array.isArray(allowed) && allowed.length === 0)) {
            return null;
        }

        // Normalize to array of strings
        if (Array.isArray(allowed)) {
            return allowed.map(String);
        }

        // Anything unexpected -> treat as "all"
        return null;
    }, [formatsConfig, formatId]);

    // NEW: check if a given card is allowed in the current format
    const isCardAllowedInFormat = useCallback((card) => {
        if (!card) return true;
        const allowedSets = getAllowedSetsForFormat(); // null => all sets allowed
        if (!allowedSets) return true;
        return allowedSets.includes(card.Set);
    }, [getAllowedSetsForFormat]);

    // NEW: ban list helpers
    const getBanListForFormat = useCallback(() => {
        const fmt = formatsConfig?.[formatId] || null;
        const raw = fmt?.BanList;

        if (!raw) return [];
        if (Array.isArray(raw)) return raw.map(String);

        // Handle simple string cases: "", "id", or "id1,id2"
        const s = String(raw).trim();
        if (!s) return [];
        if (s.includes(',')) return s.split(',').map(x => x.trim()).filter(Boolean);
        return [s];
    }, [formatsConfig, formatId]);

    const isCardBannedInFormat = useCallback((card) => {
        if (!card) return false;
        const banned = getBanListForFormat();
        return banned.includes(card.InternalName);
    }, [getBanListForFormat]);

    
  // existing filters
  const [q, setQ] = useState('')
  const [rarity, setRarity] = useState('Any Rarity')
  const [ccMin, setCcMin] = useState('')
  const [ccMax, setCcMax] = useState('')
  const [ccExact, setCcExact] = useState('')
  const [setFilter, setSetFilter] = useState('Any Set')

    // "Allowable Only" filter toggle (partner-restricted gallery)
    const [allowOnly, setAllowOnly] = useState(false)

  // SuperType rules
  const [sup1, setSup1] = useState(""); const [sop1, setSop1] = useState("");

  // CardType rules
  const [typ1, setTyp1] = useState(""); const [top1, setTop1] = useState("");
  const [typ2, setTyp2] = useState(""); const [top2, setTop2] = useState("");

  // SubType rules
  const [sub1, setSub1] = useState(""); const [tbop1, setTbop1] = useState("");

  // change helpers to clear lower rows if upper row is emptied
  const onSup1Change = v => { setSup1(v); if (!v) setSop1(""); };
  const onTyp1Change = v => {
      setTyp1(v);
      if (!v) {
          setTop1("");
          setTyp2("");
          setTop2("");
      }
  };
  const onTyp2Change = v => { setTyp2(v); if (!v) setTop2(""); };
  const onSub1Change = v => { setSub1(v); if (!v) setTbop1(""); };

  // Up to 3 element criteria; blank element means "ignore this row"
  const [el1, setEl1] = useState("");
  const [op1, setOp1] = useState("");
  const [el2, setEl2] = useState("");
  const [op2, setOp2] = useState("");
  const [el3, setEl3] = useState("");
  const [op3, setOp3] = useState("");

  // helper functions
  const onEl1Change = (v) => {
      setEl1(v);
      if (!v) { setOp1(""); setEl2(""); setOp2(""); setEl3(""); setOp3(""); }
  };
  const onEl2Change = (v) => {
      setEl2(v);
      if (!v) { setOp2(""); setEl3(""); setOp3(""); }
  };
  const onEl3Change = (v) => {
      setEl3(v);
      if (!v) { setOp3(""); }
  };

    // Format-aware rarity caps (per card). Falls back to prior defaults.
    const getRarityCapMap = () => {
        const fmt = formatsConfig?.[formatId] || null;
        const rc = fmt?.rarityCap || null;
        // Default from your current logic
        const fallback = { Common: 4, Uncommon: 3, Rare: 2, 'Ultra Rare': 1, Partner: 1 };
        // Ensure Partner stays at 1 unless explicitly overridden
        return { ...fallback, ...(rc || {}) };
    };

    // Treat anything labeled "Token" as non-deck-buildable
    const isToken = (c) => {
        const ct = String(c?.CardType || '').trim().toLowerCase()
        const st = String(c?.SuperType || '').trim().toLowerCase()
        return ct === 'token' || st === 'token'
    }

    // Is this card a Partner?
    const isPartner = (c) =>
        String(c?.CardType || '').trim().toLowerCase() === 'partner'

    // Return the per-card cap from its rarity (format-aware)
    const cardCap = (card) => {
        const rc = getRarityCapMap();

        // Partner cap is format-driven only; collection quantities do not apply
        const isPartnerCard = String(card?.CardType || '').trim().toLowerCase() === 'partner';
        if (isPartnerCard) return Number.isFinite(rc?.Partner) ? rc.Partner : 1;

        // Base cap from Rarity (format rules)
        const r = (card?.Rarity || '').trim();
        let cap = (!r || r === 'Basic') ? Infinity : (Number.isFinite(rc?.[r]) ? rc[r] : Infinity);

        // If a collection is active, also cap by owned Quantity for this front side (_a)
        if (collectionFilter?.quantities) {
            // normalize InternalName to its _a front
            const frontId = String(card?.InternalName || '').replace(/_b$/, '_a');
            const owned = collectionFilter.quantities.get(frontId);
            if (Number.isFinite(owned)) {
                cap = Math.min(cap, Math.max(0, owned));
            }
        }

        return cap;
    };

    // Find the single Partner card currently in the deck (if any)
    const getPartnerInDeck = () => {
        for (const id of Object.keys(deck)) {
            const c = getById(id);
            if (isPartner(c) && (deck[id] ?? 0) > 0) return c;
        }
        return null;
    }

    // --- Partner off-element detection (front side only) ---
    // Treat blanks as "no value"; Neutral is always allowed.
    const cleanEl = (v) => {
        const s = String(v ?? '').trim();
        return s === '' ? null : s;
    };
    const getFrontEls = (card) => {
        if (!card) return [];
        return [cleanEl(card.ElementType1), cleanEl(card.ElementType2), cleanEl(card.ElementType3)]
            .filter(Boolean);
    };

    // A deck row is "off-element" if ANY of its front-side ElementType IDs
    // are NOT in the selected Partner's Element set, and it's not Neutral.
    // If no Partner is chosen, we don't flag anything.
    const isOffElementForPartner = useCallback((card) => {
        if (!card) return false;

        const partner = getPartnerInDeck();
        if (!partner) return false; // no Partner selected → no highlight

        const cardEls = getFrontEls(card);
        if (cardEls.includes('Neutral')) return false; // Neutral is always allowed

        const partnerEls = getFrontEls(partner);

        // Use the element list from reference.json (fallback to ELEMENT_OPTIONS)
        const allElements = (refData.Element?.length ? refData.Element : ELEMENT_OPTIONS)
            .filter(Boolean)
            .map(String);

        // Build allowed set = Partner's elements + Neutral
        const allowed = new Set([...partnerEls, 'Neutral']);

        // Disallowed = everything in the master element list that isn't allowed
        const disallowed = new Set(allElements.filter(el => !allowed.has(el)));

        // Off-element if the card has at least one element that is disallowed
        return cardEls.some(el => disallowed.has(el));
    }, [getPartnerInDeck, refData.Element]);

    // Compute DeckSize from the current format rules.
    // formats.json supports:
    //  - { deckSize: { type: "byElements", values: { "1":25, "2":50, "3":75 } } }
    //  - { deckSize: { type: "fixed",      values: 60 } }
    //  - { deckSize: { type: "none" } }  (no limit)
    const getDeckSizeLimit = () => {
        const fmt = formatsConfig?.[formatId] || null;
        const dsz = fmt?.deckSize || null;

        if (!dsz || dsz.type === 'none') {
            return Infinity; // no limit
        }

        if (dsz.type === 'fixed') {
            const n = Number(dsz.values);
            return Number.isFinite(n) ? n : Infinity;
        }

        if (dsz.type === 'byElements') {
            const partner = getPartnerInDeck();
            if (!partner) return Infinity; // keep your current behavior until a Partner is chosen
            const elCount = [partner.ElementType1, partner.ElementType2, partner.ElementType3]
                .filter(v => v != null && String(v).trim() !== '').length;
            const key = String(Math.min(3, Math.max(1, elCount))); // clamp 1..3
            const table = dsz.values || {};
            const n = Number(table[key]);
            return Number.isFinite(n) ? n : Infinity;
        }

        // Unknown type -> no limit
        return Infinity;
    };
        
  // disable flags
  const d2 = !el1;
  const d3 = !el2;

    // added filters (MOVED ABOVE resetFilters to avoid TDZ)
    const [costStr, setCostStr] = useState('')

    // NEW: min/max bounds for stats (MOVED ABOVE resetFilters)
    const [atkMin, setAtkMin] = useState('')
    const [atkMax, setAtkMax] = useState('')
    const [defMin, setDefMin] = useState('')
    const [defMax, setDefMax] = useState('')
    const [hpMin, setHpMin] = useState('')
    const [hpMax, setHpMax] = useState('')
    const [atkExact, setAtkExact] = useState('')
    const [defExact, setDefExact] = useState('')
    const [hpExact, setHpExact] = useState('')

    // Reset every filter back to its initial/empty state
    const resetFilters = React.useCallback(() => {
        setEl1(''); setOp1(''); setEl2(''); setOp2(''); setEl3(''); setOp3('');
        setSup1(''); setSop1('');
        setTyp1(''); setTop1(''); setTyp2(''); setTop2('');
        setSub1(''); setTbop1('');
        setQ(''); setRarity('Any Rarity'); setSetFilter('Any Set');
        setCcMin(''); setCcMax(''); setCcExact(''); setCostStr('');
        setAtkMin(''); setAtkExact(''); setAtkMax('');
        setDefMin(''); setDefExact(''); setDefMax('');
        setHpMin(''); setHpExact(''); setHpMax('');
    }, []);

    // Click handler for the Clear Filters button
    const onClearFilters = () => {
        if (!window.confirm('Clear all filters and switch to Cards?')) return;
        setActiveDataset(DATASETS.CARDS);
        resetFilters();
    };

   // --- Plugin Core: load all plugins once ---
    useEffect(() => {
        loadPlugins();
    }, []);

    // Listen for plugin-driven sort changes (from gallery-header-buttons)
    useEffect(() => {
        const off = pluginHost.onGallerySortChange(() => setSortTick(t => t + 1));
        return off;
    }, []);

  // Deck state
  const [deck, setDeck] = useState({})
  const [maybe, setMaybe] = useState({})                 // Maybe (sideboard) list map
  const [activeBoard, setActiveBoard] = useState('DECK'); // 'DECK' | 'MAYBE'
  const getActiveMap = () => (activeBoard === 'DECK' ? deck : maybe)
    // --- Refs the plugin API will read (kept current every render)
    const deckRef = useRef(deck); deckRef.current = deck;
    const maybeRef = useRef(maybe); maybeRef.current = maybe;
    const formatIdRef = useRef(formatId); formatIdRef.current = formatId;
    const activeBoardRef = useRef(activeBoard); activeBoardRef.current = activeBoard;
  const [deckName, setDeckName] = useState('')
  const [showNameInput, setShowNameInput] = useState(false)
  const nameRef = useRef(null)
  const galleryGridRef = useRef(null)
  const fileRef = useRef(null)
  const [importFileName, setImportFileName] = useState('')
    const [importFileHandle, setImportFileHandle] = useState(null) // for overwriting via File System Access API

    // Force 'DECK' as the default whenever Deck Builder mounts (prevents stale "Maybe" carryover)
    useEffect(() => {
        setActiveBoard('DECK');
    }, []);

    // Keep formatId in sync with reference.json (fallback: Freeform / Standard)
    useEffect(() => {
        const formats = (refData.Format?.length ? refData.Format : ['Freeform', 'Standard'])
        if (!formats.includes(formatId)) {
            setFormatId(formats[0])
        }
    }, [refData.Format])

    // If the current Set filter is not allowed by the selected format, reset it to "Any Set"
    useEffect(() => {
        const allSets = Array.isArray(refData?.Set) ? refData.Set : [];
        const allowedSets = getAllowedSetsForFormat(); // null => all
        const allowedPool = allowedSets ? allSets.filter(s => allowedSets.includes(s)) : allSets;

        if (setFilter !== 'Any Set' && !allowedPool.includes(setFilter)) {
            setSetFilter('Any Set');
        }
    }, [formatId, formatsConfig, refData.Set, setFilter, getAllowedSetsForFormat]);

  // which cards are flipped (by front id)
  const [flipped, setFlipped] = useState({})   // { [frontId]: true|false }

  // Zoomed art modal
    const [zoom, setZoom] = useState({ show: false, src: null, alt: '', id: null })
    const openZoom = (src, alt = 'Card art', id = null) => setZoom({ show: true, src, alt, id })
    const closeZoom = () => setZoom({ show: false, src: null, alt: '', id: null })

  // Floating deck preview (follows cursor)
  const [deckPreview, setDeckPreview] = useState({ id: null, x: 0, y: 0, show: false })
  // Ref: while true, the preview should stay to the LEFT of the cursor (qty area / during click)
  const previewLockLeftRef = useRef(false)

    // Was the last interaction via pointer? (used to ignore mouse-induced focus)
    const pointerDownRef = useRef(false)

    useEffect(() => {
        const onPD = () => { pointerDownRef.current = true }
        const onPU = () => { pointerDownRef.current = false }
        const onWinBlur = () => { pointerDownRef.current = false }

        window.addEventListener('pointerdown', onPD, true) // capture phase: runs before focus
        window.addEventListener('pointerup', onPU, true)
        window.addEventListener('blur', onWinBlur)

        return () => {
            window.removeEventListener('pointerdown', onPD, true)
            window.removeEventListener('pointerup', onPU, true)
            window.removeEventListener('blur', onWinBlur)
        }
    }, [])

    // Hide the floating deck preview if a predicate matches
    const clearPreviewIf = React.useCallback((pred) => {
        setDeckPreview(prev =>
            pred(prev) ? { id: null, x: 0, y: 0, show: false } : prev
        );
    }, []);

  // Simple sizing for edge avoidance (in px)
  const PREVIEW_W = 240
  const PREVIEW_H = 320
    const PREVIEW_OFFSET = 16

    // Position the preview near the cursor; if over the +/- area OR lock is on,
    // place it just to the LEFT of the cursor so it never covers the buttons.
    // Defensive against async calls (RAF) where the React event may be nulled.
    // Also no-op on devices without hover (mobile/tablet).
    const positionPreviewNearCursor = React.useCallback((e) => {
        // Disable on non-hover devices (mobile)
        if (!(window.matchMedia && window.matchMedia('(hover: hover)').matches)) return;
        // Defensive: must have a live event and a target element
        if (!e || !e.currentTarget || typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return;
        if (!e.currentTarget.getBoundingClientRect) return;

        const rect =
            e.currentTarget.closest?.('.deckRow')?.getBoundingClientRect?.() ||
            e.currentTarget.getBoundingClientRect();

        if (!rect) return; // extra guard

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const offset = PREVIEW_OFFSET;

        let x = e.clientX + offset;
        let y = e.clientY + offset;

        const inButtonZone = !!(rect && e.clientX > rect.right - 80); // 80px safety
        const forceLeft = previewLockLeftRef.current || inButtonZone;

        if (forceLeft) {
            x = e.clientX - PREVIEW_W - offset;
            if (x < 8 && rect) x = rect.left - PREVIEW_W - offset;
        }

        // Clamp to viewport
        if (x + PREVIEW_W > vw) x = e.clientX - PREVIEW_W - offset;
        if (y + PREVIEW_H > vh) y = e.clientY - PREVIEW_H - offset;
        if (x < 8) x = 8;
        if (y < 8) y = 8;

        setDeckPreview(prev => ({ ...prev, x, y, show: true }));
    }, []);

  // Track collapsed/expanded state for each card type
  const [collapsedTypes, setCollapsedTypes] = useState({})
  const toggleTypeCollapsed = (type) => {
      setCollapsedTypes((prev) => ({
          ...prev,
          [type]: !prev[type]
      }))
  }

  // long-press control per-card
  const longPressTimerRef = useRef({})         // { [id]: number }
  const pressHandledRef   = useRef({})         // { [id]: boolean }

    const flipCard = useCallback((id) => {
        setFlipped(m => ({ ...m, [id]: !m[id] }))
    }, [])

  // --- helpers for confirm prompts ---
  const hasDeckContent = () =>
    deckName.trim().length > 0 || Object.keys(deck).length > 0

  const confirmDanger = (msg) => {
    if (!hasDeckContent()) return true
    return window.confirm(msg)
  }

  // normalize any _b id to its _a front
    const normalizeToFront = useCallback(
        (id) => (id?.endsWith('_b') ? id.slice(0, -2) + '_a' : id),
        []
    )

    useEffect(() => {
        (async () => {
            try {
                const [r1, r2, r3, rTypes, rFormats, rKeywords, rIcons, rElements] = await Promise.all([
                    fetch('/cards.json'),
                    fetch('/partners.json'),
                    fetch('/tokens.json'),
                    fetch('/reference.json').catch(() => null),
                    fetch('/formats.json').catch(() => null),
                    fetch('/keywords.json').catch(() => null),
                    fetch('/icons.json').catch(() => null),
                    fetch('/elements.json').catch(() => null), // NEW
                ]);

                const [j1, j2, j3] = await Promise.all([r1.json(), r2.json(), r3.json()]);
                setCards(j1 ?? []);
                setPartners(j2 ?? []);
                setTokens(j3 ?? []);

                if (rTypes && rTypes.ok) {
                    const jTypes = await rTypes.json();
                    setRefData({
                        SuperType: Array.isArray(jTypes?.SuperType) ? jTypes.SuperType : [],
                        CardType: Array.isArray(jTypes?.CardType) ? jTypes.CardType : [],
                        SubType: Array.isArray(jTypes?.SubType) ? jTypes.SubType : [],
                        Rarity: Array.isArray(jTypes?.Rarity) ? jTypes.Rarity : [],
                        Element: Array.isArray(jTypes?.Element) ? jTypes.Element : [],
                        Set: Array.isArray(jTypes?.Set) ? jTypes.Set : [],
                        Format: Array.isArray(jTypes?.Format) ? jTypes.Format : [],
                        Formats: Array.isArray(jTypes?.Formats) ? jTypes.Formats : [],
                        TurnStructure: Array.isArray(jTypes?.TurnStructure) ? jTypes.TurnStructure : [],
                        Tips: Array.isArray(jTypes?.Tips) ? jTypes.Tips : [],
                        FAQ: Array.isArray(jTypes?.FAQ) ? jTypes.FAQ : [],
                        CardTypeInfo: Array.isArray(jTypes?.CardTypeInfo) ? jTypes.CardTypeInfo : [],
                        CardLayout: jTypes?.CardLayout || null,
                        BoardLayout: jTypes?.BoardLayout || null,
                        RarityColors: (jTypes && typeof jTypes.RarityColors === 'object') ? jTypes.RarityColors
                            : (jTypes && typeof jTypes.RarityHexColor === 'object') ? jTypes.RarityHexColor
                                : {}
                    });
                }

                if (rFormats && rFormats.ok) {
                    try {
                        const jFormats = await rFormats.json();
                        if (jFormats && typeof jFormats === 'object') {
                            setFormatsConfig(jFormats);
                        }
                    } catch (e) {
                        console.warn('formats.json parse failed, using defaults:', e);
                        setFormatsConfig({});
                    }
                } else {
                    setFormatsConfig({});
                }

                if (rKeywords && rKeywords.ok) {
                    try {
                        const jKeywords = await rKeywords.json();
                        setKeywords(Array.isArray(jKeywords) ? jKeywords : []);
                    } catch {
                        setKeywords([]);
                    }
                } else {
                    setKeywords([]);
                }

                if (rIcons && rIcons.ok) {
                    try {
                        const jIcons = await rIcons.json();
                        setIcons(Array.isArray(jIcons) ? jIcons : []);
                    } catch {
                        setIcons([]);
                    }
                } else {
                    setIcons([]);
                }

                // NEW: elements.json
                if (rElements && rElements.ok) {
                    try {
                        const jElements = await rElements.json();
                        setElements(Array.isArray(jElements) ? jElements : []);
                    } catch {
                        setElements([]);
                    }
                } else {
                    setElements([]);
                }
            } catch (e) {
                console.error('Failed to load data files:', e);
            }
        })();
    }, []);

  useEffect(()=>{
    if (showNameInput) {
      // slight delay to ensure render before focus
      setTimeout(()=> nameRef.current?.focus(), 0)
    }
  }, [showNameInput])

    useEffect(() => {
        // if an element is cleared, reset its operator to blank
        if (el1 === '' && op1 !== '') setOp1('')
        if (el2 === '' && op2 !== '') setOp2('')
        if (el3 === '' && op3 !== '') setOp3('')
    }, [el1, op1, el2, op2, el3, op3])

    useEffect(() => {
        resetFilters()
    }, [activeDataset])

    useEffect(() => {
        if (!deckPreview.show || !deckPreview.id) return;
        const id = deckPreview.id;
        const inDeck = !!deck[id];
        const inMaybe = !!maybe[id];

        // Hide if the hovered row no longer exists in the visible list,
        // or if it no longer exists anywhere.
        if ((activeBoard === 'DECK' && !inDeck) ||
            (activeBoard === 'MAYBE' && !inMaybe) ||
            (!inDeck && !inMaybe)) {
            setDeckPreview({ id: null, x: 0, y: 0, show: false });
        }
    }, [deck, maybe, activeBoard, deckPreview.show, deckPreview.id])

    // ADD THIS:
    const deckCountRef = useRef(0)

    // Global keyboard shortcuts (non-Help). Help modals are handled inside /src/plugins/help-section.jsx
    useEffect(() => {
        const onKey = (e) => {
            const tag = (e.target?.tagName || '').toLowerCase();
            const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
            if (isTyping) return;

            if (e.key === 'Escape') {
                if (statsOpen) setStatsOpen(false);     // close Deck Stats
                if (stackOpen) setStackOpen(false);     // close Stack View
                return;
            }

            const k = e.key.toLowerCase();
            switch (k) {
                case 's':
                    // Only open Deck Stats if the deck has cards
                    if (deckCountRef.current > 0) setStatsOpen(true);
                    break;
                case 'v':
                    // Toggle Stack View if the deck has cards
                    if (deckCountRef.current > 0) setStackOpen(prev => !prev);
                    break;
                default:
                    break;
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [statsOpen, stackOpen]);

    const rawData = useMemo(() => {
        let src =
            activeDataset === DATASETS.PARTNERS ? partners :
                activeDataset === DATASETS.TOKENS ? tokens :
                    cards;

        // If a collection is active and we're browsing Cards, limit to that collection.
        if (activeDataset === DATASETS.CARDS && collectionFilter?.ids) {
            const allowed = collectionFilter.ids;
            src = src.filter(c => allowed.has(String(c?.InternalName || '').replace(/_b$/, '_a')));
        }

        return src;
    }, [activeDataset, cards, partners, tokens, collectionFilter]);

    const allById = useMemo(() => {
        const m = new Map()
        for (const c of cards) m.set(c.InternalName, c)
        for (const c of partners) m.set(c.InternalName, c)
        for (const c of tokens) m.set(c.InternalName, c)
        return m
    }, [cards, partners, tokens])

    const getById = useCallback((id) => allById.get(id) ?? null, [allById])

    // Deck Metrics quick count (search ANY field on the card, similar to gallery search)
    const [statsSearchText, setStatsSearchText] = useState('');
    const statsSearchCount = useMemo(() => {
        const q = statsSearchText.trim().toLowerCase();
        if (!q) return 0;

        // Robustly stringify any value (strings, numbers, arrays, nested objects)
        const valueToString = (v) => {
            if (v == null) return '';
            if (Array.isArray(v)) return v.map(valueToString).join(' ');
            if (typeof v === 'object') return Object.values(v).map(valueToString).join(' ');
            return String(v);
        };

        let total = 0;
        for (const [id, qty] of Object.entries(getActiveMap())) {
            const c = getById(id);
            if (!c) continue;
            const blob = Object.values(c).map(valueToString).join(' ').toLowerCase();
            if (blob.includes(q)) total += (Number(qty) || 0);
        }
        return total;
    }, [statsSearchText, deck, maybe, activeBoard, getById]);

    // Filtered
    const filtered = useMemo(() => {
        const cc_lo = ccMin === '' ? -Infinity : safeNum(ccMin, -Infinity)
        const cc_hi = ccMax === '' ? Infinity : safeNum(ccMax, Infinity)

        const a_lo = atkMin === '' ? -Infinity : safeNum(atkMin, -Infinity)
        const a_hi = atkMax === '' ? Infinity : safeNum(atkMax, Infinity)

        const d_lo = defMin === '' ? -Infinity : safeNum(defMin, -Infinity)
        const d_hi = defMax === '' ? Infinity : safeNum(defMax, Infinity)

        const h_lo = hpMin === '' ? -Infinity : safeNum(hpMin, -Infinity)
        const h_hi = hpMax === '' ? Infinity : safeNum(hpMax, Infinity)

        const cc_eq = ccExact === '' ? null : safeNum(ccExact, null)
        const a_eq = atkExact === '' ? null : safeNum(atkExact, null)
        const d_eq = defExact === '' ? null : safeNum(defExact, null)
        const h_eq = hpExact === '' ? null : safeNum(hpExact, null)

        const costNeedle = costStr.trim().toUpperCase()

        // ----- NEW helper: build AND/OR/EXCLUDE sets -----
        const buildRuleSets = (rows) => {
            const act = rows
                .filter(r => r.value != null && String(r.value).trim() !== '')
                .map(r => ({
                    v: String(r.value).trim(),
                    mode: (r.mode ? String(r.mode).toUpperCase().trim() : 'OR') || 'OR',
                }))
            return {
                and: act.filter(r => r.mode === 'AND').map(r => r.v),
                or: act.filter(r => r.mode === 'OR').map(r => r.v),
                ex: act.filter(r => r.mode === 'EXCLUDE').map(r => r.v),
                hasAny: act.length > 0,
            }
        }

        // ----- NEW helper: test a card's values against sets -----
        const passesSets = (sets, values) => {
            if (!sets.hasAny) return true
            // EXCLUDE: none of the excluded values may be present
            if (sets.ex.length && sets.ex.some(v => values.includes(v))) return false
            // AND: all required must be present
            if (sets.and.length && sets.and.some(v => !values.includes(v))) return false
            // OR: at least one must be present
            if (sets.or.length && !sets.or.some(v => values.includes(v))) return false
            return true
        }

        // ----- Build sets for each rule family from state -----
        const elementSets = buildRuleSets([
            { value: el1, mode: op1 },
            { value: el2, mode: op2 },
            { value: el3, mode: op3 },
        ])

        const superSets = buildRuleSets([
            { value: sup1, mode: sop1 },
        ])

        const typeSets = buildRuleSets([
            { value: typ1, mode: top1 },
            { value: typ2, mode: top2 },
        ])

        const subSets = buildRuleSets([
            { value: sub1, mode: tbop1 },
        ])

        // --- NEW: Group by base name and test both front and back
        const byBase = {}
        for (const card of rawData) {
            const base = card.InternalName.replace(/_(a|b)$/, '')
            if (!byBase[base]) byBase[base] = []
            byBase[base].push(card)
        }

        const matches = []

        for (const base in byBase) {
            const pair = byBase[base]

            // if ANY card in the pair matches, keep them all (front will be picked later)
            const anyMatch = pair.some(c => {
                if (rarity !== 'Any Rarity' && c.Rarity !== rarity) return false

                // Enforce format-allowed sets first
                {
                    const allowedSets = getAllowedSetsForFormat();
                    if (allowedSets && !allowedSets.includes(c.Set)) return false;
                }

                // Then apply the user's Set filter within the allowed pool
                if (setFilter !== 'Any Set' && c.Set !== setFilter) return false

                // ----- NEW multi-family rule checks -----
                const els = [c.ElementType1, c.ElementType2, c.ElementType3]
                    .filter(Boolean).map(s => String(s).trim())

                const sups = (c.SuperType ? [String(c.SuperType).trim()] : [])
                const ctypes = (c.CardType ? [String(c.CardType).trim()] : [])

                // If SubType can contain multiple tokens, split (tweak the splitter if your data differs)
                const subs = (c.SubType ? String(c.SubType).split(/[\/,|]+/).map(s => s.trim()).filter(Boolean) : [])

                // Apply rule families
                if (!passesSets(elementSets, els)) return false
                if (!passesSets(superSets, sups)) return false
                if (!passesSets(typeSets, ctypes)) return false
                if (!passesSets(subSets, subs)) return false

                const cc = Number(c.ConvertedCost ?? 0)
                if (!Number.isFinite(cc) || cc < cc_lo || cc > cc_hi) return false
                if (cc_eq != null && cc !== cc_eq) return false

                if (q) {
                    const blob = `${c.CardName} ${c.CardText} ${c.InternalName} ${c.SubType}`.toLowerCase()
                    if (!blob.includes(q.toLowerCase())) return false
                }

                if (costNeedle) {
                    const hay = String(c.Cost ?? '').toUpperCase()
                    if (!hay.includes(costNeedle)) return false
                }

                const atk = statVal(c.ATK)
                const def = statVal(c.DEF)
                const hp = statVal(c.HP)
                if (atk < a_lo || atk > a_hi) return false
                if (def < d_lo || def > d_hi) return false
                if (hp < h_lo || hp > h_hi) return false
                if (a_eq != null && atk !== a_eq) return false
                if (d_eq != null && def !== d_eq) return false
                if (h_eq != null && hp !== h_eq) return false

                return true
            })

            if (anyMatch) {
                matches.push(...pair)
            }
        }

        return matches
    }, [
        rawData, rarity,
        // element rules
        el1, op1, el2, op2, el3, op3,
        // supertype (1)
        sup1, sop1,
        // cardtype (2)
        typ1, top1, typ2, top2,
        // subtype (1)
        sub1, tbop1,
        // the rest
        ccMin, ccMax, ccExact, q, costStr,
        atkMin, atkExact, atkMax,
        defMin, defExact, defMax,
        hpMin, hpExact, hpMax,
        setFilter,
        getAllowedSetsForFormat
    ])

    // SAFE alias so we never throw even if allowOnly hasn't initialized yet
    const allowOnlyDep = (typeof allowOnly === 'undefined') ? false : allowOnly;

    // Collapse fronts/backs so only one gallery tile shows (prefer the _a "front")
    const gallery = useMemo(() => {
        // Index the current dataset (unfiltered) so we can grab true fronts
        const byId = new Map(rawData.map(c => [c.InternalName, c]))
        const seenBase = new Set()
        const out = []

        for (const c of filtered) {
            const base = c.InternalName.replace(/_(a|b)$/, '')
            if (seenBase.has(base)) continue
            seenBase.add(base)

            // Prefer the front if it exists; otherwise keep whatever matched filters
            const frontId = `${base}_a`
            const front = byId.get(frontId) || c
            out.push(front)
        }

        // NEW: if Allowable Only is on, keep only cards that are NOT off-element
        if (allowOnlyDep) {
            return out.filter(card => !isOffElementForPartner(card));
        }
        return out;
    }, [filtered, rawData, allowOnlyDep, isOffElementForPartner])

    // keep gallery available to plugins without stale closures
    const galleryRef = useRef(gallery); galleryRef.current = gallery;

    // --- Plugin Core: expose minimal app API to plugins (stable; reads from refs) ---
    useEffect(() => {
        pluginHost.setAppApi({
            // Smooth scroll helpers
            scrollGalleryTop: () => {
                const el = galleryGridRef?.current;
                if (el?.scrollTo) el.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                else window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
            },
            scrollGalleryBottom: () => {
                const el = galleryGridRef?.current;
                if (el?.scrollTo) el.scrollTo({ top: el.scrollHeight, left: 0, behavior: 'smooth' });
                else window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior: 'smooth' });
            },

            // Always read the latest values during render
            getActiveBoard: () => activeBoardRef.current,
            setActiveBoard: (val) => {
                const next = (val === 'MAYBE') ? 'MAYBE' : 'DECK';
                setActiveBoard(next);
            },

            // Lightweight snapshot for plugins
            getState: () => ({
                formatId: formatIdRef.current,
                deck: deckRef.current,
                maybe: maybeRef.current,
                gallery: galleryRef.current,
                activeBoard: activeBoardRef.current,
            }),
            // Let plugins open the existing zoom modal for a given card id
            openZoomForCard: (id) => {
                const frontId = normalizeToFront(id);
                const name = allById.get(frontId)?.CardName || 'Card art';
                const src = primaryImg(frontId);
                openZoom(src, name, frontId);
            },
        });
        // Run once; values are live via refs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Apply sorting via plugins (plugin owns the sort state)
    const sortedGallery = useMemo(() => {
        if (pluginHost?.sortGallery) {
            return pluginHost.sortGallery(gallery);
        }
        return [...gallery];
    }, [gallery, sortTick]);

    // Virtualization state for the gallery grid
    const galleryVirt = useGridVirtual({
        containerRef: galleryGridRef,
        itemCount: sortedGallery.length,
        minColumnWidth: Math.round(GALLERY_BASE_TILE_MIN * galleryScale),
        estimateRowHeight: estimateGalleryRowHeight(Math.round(GALLERY_BASE_TILE_MIN * galleryScale)),
        gap: 12,
        overscan: 3,
    });

    // Count current cards in the deck (tokens never get into the deck UI already)
    const getDeckCount = () => {
        let total = 0;
        for (const [id, qty] of Object.entries(getActiveMap())) {
            const c = getById(id);
            if (!c) continue;
            if (isToken(c)) continue;
            if (isPartner(c)) continue; // ignore the Partner
            total += qty || 0;
        }
        return total;
    };

  // ---- Add/remove to deck ----
    const add = useCallback((id, delta = 1) => {
        const frontId = normalizeToFront(id);
        const card = getById(frontId);
        if (isToken(card)) return;

        // 🚫 Banlist still enforced in both boards
        if (delta > 0 && isCardBannedInFormat(card)) {
            pushToast('That card is banned in the selected format.', { type: 'error' });
            return;
        }

        const activeMap = getActiveMap();
        const setMap = (activeBoard === 'DECK') ? setDeck : setMaybe;

        // ✅ Partner rules
        if (isPartner(card) && delta > 0) {
            // NEW: Partners cannot be added to the Maybe board
            if (activeBoard === 'MAYBE') {
                pushToast('Partner cards cannot be added to the Maybe list. Add Partners to your Deck.', { type: 'warn' });
                return;
            }

            // Deck partner cap applies only when adding to the Deck
            const rc = getRarityCapMap();
            const partnerCap = Number.isFinite(rc?.Partner) ? rc.Partner : 1;
            const currentPartnerTotal = Object.entries(activeMap).reduce((s, [k, q]) => {
                const kc = getById(k);
                return s + (isPartner(kc) ? (q || 0) : 0);
            }, 0);
            if (currentPartnerTotal >= partnerCap) {
                pushToast(`Only ${partnerCap} Partner${partnerCap === 1 ? '' : 's'} allowed in this format.`, { type: 'warn' });
                return;
            }
        }

        // Enforce deck size limit ONLY for main deck
        const deckSizeLimit = getDeckSizeLimit();
        const isDeckFull = (activeBoard === 'DECK') && Number.isFinite(deckSizeLimit) && (getDeckCount() >= deckSizeLimit);

        // Enforce Partner element restrictions across both boards when enabled
        const allowOnlyNow = (typeof allowOnly === 'undefined') ? false : allowOnly;
        if (delta > 0 && allowOnlyNow && isOffElementForPartner(card)) {
            pushToast('That card is not allowable with your current Partner elements.', { type: 'warn' });
            return;
        }

        // Auto-enable “Allowable Only” when adding a Partner to the Deck
        if (activeBoard === 'DECK' && delta > 0 && isPartner(card) && !allowOnlyNow) {
            setAllowOnly?.(true);
        }

        // If user adds to either board and no deck has been started yet, start one now
        // (lets you add to Maybe first and still get the naming UX)
        if (
            delta > 0 &&
            !showNameInput &&
            Object.keys(deck).length === 0 &&
            Object.keys(maybe).length === 0
        ) {
            setShowNameInput(true);
            setDeckName((n) => n || 'New Deck');
            setTimeout(() => nameRef.current?.focus(), 0);
        }

        const cap = cardCap(card);
        let removedId = null;

        setMap(prev => {
            const next = { ...prev };

            // migrate any legacy _b count into the front
            const backId = frontId.replace(/_a$/, '_b');
            if (next[backId]) {
                next[frontId] = (next[frontId] ?? 0) + next[backId];
                delete next[backId];
            }

            const cur = next[frontId] ?? 0;
            // For Maybe board, ignore per-card cap? Keep existing per-card cap for consistency.
            const newCount = Math.max(0, Math.min(cur + delta, cap));

            if (newCount <= 0) {
                delete next[frontId];
                removedId = frontId;
            } else {
                // Extra safety: main deck size limit check is already handled above
                next[frontId] = newCount;
            }
            return next;
        });

        if (removedId) clearPreviewIf(h => h?.id === removedId);
    }, [activeBoard, normalizeToFront, getById, showNameInput, deck, getDeckSizeLimit, getDeckCount, setShowNameInput, setDeckName, clearPreviewIf, getRarityCapMap, allowOnly]);

    // NEW: When viewing Maybe list, move all copies of a card into the Deck (up to limits)
    const moveAllToDeck = useCallback((id) => {
        const frontId = normalizeToFront(id);
        const card = getById(frontId);
        if (!card) return;
        if (isToken(card)) return;

        // Banned cards can't go to the deck
        if (isCardBannedInFormat(card)) {
            pushToast('That card is banned in the selected format.', { type: 'error' });
            return;
        }

        // Respect "Allowable Only" restriction when a Partner is chosen
        if (allowOnly && isOffElementForPartner(card)) {
            pushToast('That card is not allowable with your current Partner elements.', { type: 'warn' });
            return;
        }

        // How many of this card are in Maybe right now?
        const maybeMap = maybeRef.current || {};
        const deckMap = deckRef.current || {};
        const qtyInMaybe = Math.max(0, Number(maybeMap[frontId] || 0));
        if (qtyInMaybe <= 0) return;

        // Determine remaining room in the main Deck (non-token, non-partner)
        const deckLimit = getDeckSizeLimit();
        let mainCount = 0;
        for (const [did, q] of Object.entries(deckMap)) {
            const dc = getById(did);
            if (!dc) continue;
            if (isToken(dc)) continue;
            if (isPartner(dc)) continue;
            mainCount += q || 0;
        }
        const slotsLeft = Number.isFinite(deckLimit) ? Math.max(0, deckLimit - mainCount) : Infinity;

        // Per-card cap left in the Deck for this specific card
        const cap = cardCap(card);
        const already = Math.max(0, Number(deckMap[frontId] || 0));
        const perCardLeft = Number.isFinite(cap) ? Math.max(0, cap - already) : Infinity;

        // Also must be allowed by Format (set whitelist)
        if (!isCardAllowedInFormat(card)) {
            pushToast('That card is not legal in the selected format.', { type: 'error' });
            return;
        }

        // Compute how many we can move right now
        const canMove = Math.max(0, Math.min(qtyInMaybe, slotsLeft, perCardLeft));

        if (canMove <= 0) {
            // Either deck is already full or this card has hit its limit
            pushToast('Deck List is full.', { type: 'warn' });
            return;
        }

        // Apply changes
        const leftAfter = Math.max(0, qtyInMaybe - canMove);

        setDeck(prev => {
            const next = { ...prev };
            next[frontId] = (next[frontId] || 0) + canMove;
            return next;
        });

        setMaybe(prev => {
            const next = { ...prev };
            if (leftAfter <= 0) {
                delete next[frontId];
            } else {
                next[frontId] = leftAfter;
            }
            return next;
        });

        // If the card fully left the Maybe list, close the hover preview
        if (leftAfter <= 0 && deckPreview?.id === frontId) {
            setDeckPreview({ id: null, x: 0, y: 0, show: false });
        }

        // If we hit the deck max as a result, tell the user (include moved count)
        if (Number.isFinite(deckLimit) && (mainCount + canMove) >= deckLimit) {
            pushToast(`Moved ${canMove} to Deck. Deck List is full.`, { type: 'warn' });
        }
    }, [
        normalizeToFront,
        getById,
        isToken,
        isPartner,
        isCardBannedInFormat,
        isCardAllowedInFormat,
        isOffElementForPartner,
        allowOnly,
        getDeckSizeLimit,
        cardCap
    ]);

    // NEW: When viewing Deck list, move all copies of a card into the Maybe list
    const moveAllToMaybe = useCallback((id) => {
        const frontId = normalizeToFront(id);
        const card = getById(frontId);
        if (!card) return;
        if (isToken(card)) return;

        const deckMap = deckRef.current || {};
        const maybeMap = maybeRef.current || {};
        const qtyInDeck = Math.max(0, Number(deckMap[frontId] || 0));
        if (qtyInDeck <= 0) return;

        // Respect per-card cap in Maybe (same behavior as add())
        const cap = cardCap(card);
        const already = Math.max(0, Number(maybeMap[frontId] || 0));
        const perCardLeft = Number.isFinite(cap) ? Math.max(0, cap - already) : Infinity;

        const canMove = Math.max(0, Math.min(qtyInDeck, perCardLeft));
        const leftAfter = Math.max(0, qtyInDeck - canMove);

        setMaybe(prev => {
            const next = { ...prev };
            next[frontId] = (next[frontId] || 0) + canMove;
            return next;
        });

        setDeck(prev => {
            const next = { ...prev };
            if (leftAfter <= 0) delete next[frontId];
            else next[frontId] = leftAfter;
            return next;
        });

        // If the card fully left the Deck, close the hover preview
        if (leftAfter <= 0 && deckPreview?.id === frontId) {
            setDeckPreview({ id: null, x: 0, y: 0, show: false });
        }
    }, [normalizeToFront, getById, isToken, cardCap, deckPreview, setDeckPreview]);

    // Use CardType if present, otherwise fall back to SuperType (e.g., "Token"), otherwise "Other"
    const getTypeTag = (c) =>
        (c?.CardType && String(c.CardType).trim()) ||
        (c?.SuperType && String(c.SuperType).trim()) ||
        'Other'

    // Which card types are actually present in the current deck?
    const presentTypes = useMemo(() => {
        const ids = Object.keys(getActiveMap());
        const set = new Set();
        for (const id of ids) {
            const c = getById(id);
            const tag = getTypeTag(c);
            if (tag) set.add(tag);
        }
        return Array.from(set);
    }, [deck, maybe, activeBoard, getById])

    // Final order: types from types.json (or fallback) + any extra ones found in deck
    const typeOrder = useMemo(() => {
        const base = (refData.CardType?.length
            ? refData.CardType
            : ['Partner', 'Unit', 'Ability', 'Event', 'Support', 'Shield'])
        const extras = presentTypes.filter(t => !base.includes(t))
        return [...base, ...extras]
    }, [refData, presentTypes])

    // Build deck list (now safe to sort using typeOrder)
    const deckList = useMemo(() => {
        const list = Object.entries(getActiveMap()).map(([id, qty]) => {
            const c = getById(id)
            return { id, qty, c }
        })
        // 🚫 drop tokens from the visible deck list
        const visible = list.filter(row => !isToken(row.c))
        return visible.sort((a, b) => {
            const typeA = getTypeTag(a.c)
            const typeB = getTypeTag(b.c)
            const typeIndexA = typeOrder.indexOf(typeA)
            const typeIndexB = typeOrder.indexOf(typeB)
            if (typeIndexA !== typeIndexB) return typeIndexA - typeIndexB
            return (a.c?.CardName || '').localeCompare(b.c?.CardName || '')
        })
    }, [deck, maybe, activeBoard, typeOrder, getById])

    // ADD: New Deck handler (clears both lists, focuses name input)
    const onNewDeck = () => {
        if (!confirmDanger('Start a new deck? This will clear the deck name and all cards.')) return;
        setDeck({});
        setMaybe({});
        setActiveBoard('DECK');
        setDeckName('');
        setShowNameInput(true);
        if (fileRef.current) fileRef.current.value = '';
        setImportFileName('');
        setImportFileHandle(null);
        setTimeout(() => nameRef.current?.focus(), 0);
    };

  // ---- Deck actions ----
    const onClearDeck = () => {
        if (!confirmDanger('Clear this deck? This will remove the deck name and all cards.')) return;
        setDeck({});
        setMaybe({});
        setActiveBoard('DECK');
        setDeckName('');
        setShowNameInput(false);
        setFormatId('Freeform');
        if (fileRef.current) fileRef.current.value = '';
        setImportFileName('');
    };
        
  const exportJSON = () => {
    const payload = { name: deckName || 'New Deck', formatId, list: deck, maybe }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${(deckName || 'deck').replace(/[^\w\-]+/g,'_')}.json`; a.click()
    URL.revokeObjectURL(url)
  }

    const exportCSV = () => {
        // Always export BOTH boards and include Deck Name as a column.
        // Import stays backward-compatible (reader uses only first 2 columns).
        const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
        const safeName = deckName?.trim() ? deckName : 'New Deck';

        // Header: keep InternalName,Qty first so import logic still works
        const rows = ['InternalName,Qty,FormatId,Board,DeckName'];

        const pushMap = (map, board) => {
            for (const [id, qty] of Object.entries(map)) {
                const c = getById(id);
                if (!c) continue;
                if (isToken(c)) continue;                 // never export tokens
                const q = Math.max(0, Number(qty) || 0);
                if (q <= 0) continue;
                rows.push(`${id},${q},${formatId},${board},${esc(safeName)}`);
            }
        };

        // Main deck first, then Maybe
        pushMap(deck, 'Deck');
        pushMap(maybe, 'Maybe');

        const csv = rows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(safeName || 'deck').replace(/[^\w\-]+/g, '_')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // ADD BELOW exportCSV and ABOVE handleImport
    const saveLoadedFile = async () => {
        const nameFromDeck = (deckName || 'deck').replace(/[^\w\-]+/g, '_');
        const lower = (importFileName || '').toLowerCase();
        const ext = lower.endsWith('.csv') ? 'csv' : (lower.endsWith('.json') ? 'json' : 'json');

        // Build CSV exactly like exportCSV (Deck + Maybe + DeckName)
        const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
        const safeName = deckName?.trim() ? deckName : 'New Deck';
        const rowsCsv = ['InternalName,Qty,FormatId,Board,DeckName'];
        const pushMapCsv = (map, board) => {
            for (const [id, qty] of Object.entries(map)) {
                const c = getById(id);
                if (!c) continue;
                if (isToken(c)) continue;
                const q = Math.max(0, Number(qty) || 0);
                if (q <= 0) continue;
                rowsCsv.push(`${id},${q},${formatId},${board},${esc(safeName)}`);
            }
        };
        pushMapCsv(deck, 'Deck');
        pushMapCsv(maybe, 'Maybe');
        const csvRows = rowsCsv.join('\n');

        const jsonPayload = JSON.stringify({ name: deckName || 'New Deck', formatId, list: deck, maybe }, null, 2);
        const mime = ext === 'csv' ? 'text/csv' : 'application/json';
        const data = ext === 'csv' ? csvRows : jsonPayload;

        // If we already have a file handle, try to overwrite directly
        if (importFileHandle && importFileHandle.createWritable) {
            try {
                const writable = await importFileHandle.createWritable();
                await writable.write(new Blob([data], { type: mime }));
                await writable.close();
                return;
            } catch (e) {
                console.warn('Direct save failed, will fallback to picker/download:', e);
            }
        }

        // If supported, ask user once where to save (pick the same file to overwrite), then reuse handle
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: importFileName || `${nameFromDeck}.${ext}`,
                    types: [
                        ext === 'csv'
                            ? { description: 'CSV Deck', accept: { 'text/csv': ['.csv'] } }
                            : { description: 'JSON Deck', accept: { 'application/json': ['.json'] } }
                    ]
                });
                const writable = await handle.createWritable();
                await writable.write(new Blob([data], { type: mime }));
                await writable.close();
                setImportFileHandle(handle); // reuse on next Save
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return; // user cancelled
                console.warn('Save picker failed, falling back to download:', e);
            }
        }

        // Fallback: normal download (cannot overwrite automatically)
        const url = URL.createObjectURL(new Blob([data], { type: mime }));
        const a = document.createElement('a');
        a.href = url;
        a.download = importFileName || `${nameFromDeck}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
    };

  const handleImport = async (file) => {
    if (!file) return
    const text = await file.text()
    try {
      if (file.name.toLowerCase().endsWith('.json')) {
        const data = JSON.parse(text)
        // Accept either { name, list } or a raw map { id: qty }
          if (data && typeof data === 'object') {
              const input = (data.list && typeof data.list === 'object') ? data.list : data;
              const normalized = {};
              for (const [rawId, qty] of Object.entries(input)) {
                  const frontId = normalizeToFront(rawId);
                  const nQty = Math.max(0, Number(qty) || 0);
                  if (nQty > 0) normalized[frontId] = (normalized[frontId] ?? 0) + nQty;
              }
              setDeck(normalized);

              // Maybe list (optional)
              const maybeInput = (data.maybe && typeof data.maybe === 'object') ? data.maybe : {};
              const maybeNorm = {};
              for (const [rawId, qty] of Object.entries(maybeInput)) {
                  const frontId = normalizeToFront(rawId);
                  const nQty = Math.max(0, Number(qty) || 0);
                  if (nQty > 0) maybeNorm[frontId] = (maybeNorm[frontId] ?? 0) + nQty;
              }
              setMaybe(maybeNorm);

              // Ensure we show the main Deck after loading
              setActiveBoard('DECK');

              setDeckName(typeof data.name === 'string' ? data.name : '');
              if (typeof data.formatId === 'string') setFormatId(data.formatId);
              setShowNameInput(true);
          }
      } else if (file.name.toLowerCase().endsWith('.csv')) {
          // Parse BOTH boards if present. Backward-compatible with old 2-col CSV.
          const lines = text.trim().split(/\r?\n/).filter(Boolean);
          if (lines.length === 0) return;

          // CSV splitter that respects quotes and doubled quotes
          const splitCsv = (line) => {
              const out = [];
              let cur = '';
              let inQ = false;
              for (let i = 0; i < line.length; i++) {
                  const ch = line[i];
                  if (ch === '"') {
                      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; }
                  } else if (ch === ',' && !inQ) {
                      out.push(cur); cur = '';
                  } else {
                      cur += ch;
                  }
              }
              out.push(cur);
              return out;
          };

          const header = splitCsv(lines[0]).map(s => s.trim());
          const hasHeader = /internalname/i.test(header[0] || '');
          const start = hasHeader ? 1 : 0;

          // Column indexes (default for old CSV: [0]=InternalName, [1]=Qty)
          const idxName = hasHeader ? header.findIndex(h => /internalname/i.test(h)) : 0;
          const idxQty = hasHeader ? header.findIndex(h => /^qty$/i.test(h)) : 1;
          const idxBoard = hasHeader ? header.findIndex(h => /^board$/i.test(h)) : -1;
          const idxDName = hasHeader ? header.findIndex(h => /^deckname$/i.test(h)) : -1;
          const idxFmtId = hasHeader ? header.findIndex(h => /^formatid$/i.test(h)) : -1;

          const deckMap = {};
          const maybeMap = {};
          let csvName = '';
          let csvFormatId = '';

          for (let i = start; i < lines.length; i++) {
              const cols = splitCsv(lines[i]);
              const idRaw = (cols[idxName] ?? '').trim();
              const qtyRaw = (cols[idxQty] ?? '').trim();
              if (!idRaw) continue;

              const nQty = Math.max(0, Number(qtyRaw) || 0);
              if (nQty <= 0) continue;

              const frontId = normalizeToFront(idRaw);
              const card = getById(frontId);
              if (!card) continue;
              if (isToken(card)) continue; // never import tokens

              // Optional columns
              const boardRaw = (idxBoard >= 0 ? (cols[idxBoard] ?? '') : '').trim().toLowerCase();
              const board = boardRaw === 'maybe' ? 'MAYBE' : 'DECK';
              const dname = (idxDName >= 0 ? (cols[idxDName] ?? '') : '').trim();
              if (!csvName && dname) csvName = dname;
              const fmtId = (idxFmtId >= 0 ? (cols[idxFmtId] ?? '') : '').trim();
              if (!csvFormatId && fmtId) csvFormatId = fmtId;

              // Partners are never allowed in Maybe; put them into Deck instead
              const target = (board === 'MAYBE' && isPartner(card)) ? deckMap
                  : (board === 'MAYBE' ? maybeMap : deckMap);

              target[frontId] = (target[frontId] ?? 0) + nQty;
          }

          setDeck(deckMap);
          setMaybe(maybeMap);

          // If CSV contained a deck name, use it; otherwise keep existing
          if (csvName) setDeckName(csvName);

          // If CSV contained a FormatId that exists in reference.json, set it
          if (csvFormatId && (refData?.Format || []).includes(csvFormatId)) {
              setFormatId(csvFormatId);
          }

          // After import, show main deck; keep name input visible for edits
          setActiveBoard('DECK');
          setShowNameInput(true);
      }
    } catch (e) {
        pushToast('Failed to import deck: ' + e.message, { type: 'error' })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

    // ---- Deck Statistics (excluding Partner and Tokens) ----
    const deckStats = useMemo(() => {
        const partner = getPartnerInDeck();
        const partnerId = partner?.InternalName || null;

        // rows = entries we actually count from the active board
        const rows = [];
        for (const [id, qty] of Object.entries(getActiveMap())) {
            if (!qty) continue;
            const c = getById(id);
            if (!c) continue;
            if (isToken(c)) continue;
            if (isPartner(c)) continue;
            if (id === partnerId) continue;
            rows.push({ card: c, qty: qty || 0 });
        }

        const add = (map, key, inc) => {
            const k = String(key ?? '').trim();
            if (!k) return;
            map[k] = (map[k] || 0) + inc;
        };

        const typeMap = {};
        const rarityMap = {};
        const elementMap = {};

        const bins = ['0,1', '2', '3', '4', '5', '6', '7', '8+'];
        const curve = Object.fromEntries(bins.map(b => [b, { noHold: 0, hold: 0 }]));

        for (const { card, qty } of rows) {
            if (qty <= 0) continue;

            // CardType
            add(typeMap, card.CardType, qty);

            // Rarity
            add(rarityMap, card.Rarity, qty);

            // ElementType1/2/3 (ignore blanks)
            ['ElementType1', 'ElementType2', 'ElementType3'].forEach(f => {
                const v = String(card?.[f] ?? '').trim();
                if (v) add(elementMap, v, qty);
            });

            // Curve Breakdown (ConvertedCost) stacked by Hold blank vs not-blank
            // Do NOT count cards with SuperType === "Basic"
            if (String(card.SuperType ?? '').trim() !== 'Basic') {
                const holdBlank = String(card.Hold ?? '').trim() === '' ? 'noHold' : 'hold';
                const cc = Number(card.ConvertedCost);
                if (Number.isFinite(cc)) {
                    let bucket = '0,1';
                    if (cc >= 8) bucket = '8+';
                    else if (cc > 1) bucket = String(cc);
                    curve[bucket][holdBlank] += qty;
                }
            }
        }

        // ---- Totals & Averages (ConvertedCost, Refund) ----
        // - Totals exclude only the Partner (handled by `rows`), include Basics
        // - Averages exclude cards with SuperType === "Basic" AND (value is 0 or blank)
        let totalCC = 0, sumCCForAvg = 0, countCCForAvg = 0;
        let totalRefund = 0, sumRefundForAvg = 0, countRefundForAvg = 0;
        let totalProduce = 0;
        const produceByElement = {}; // e.g., { Earth: 3, Neutral: 2, Wild: 1 }

        rows.forEach(({ card, qty }) => {
            // ConvertedCost
            const ccRaw = card?.ConvertedCost;
            const cc = Number(ccRaw);
            const isBasic = String(card?.SuperType ?? '').trim() === 'Basic';
            const ccBlank = String(ccRaw ?? '').trim() === '';
            if (Number.isFinite(cc)) {
                totalCC += cc * qty;
                const excludeCC = isBasic && (cc === 0 || ccBlank);
                if (!excludeCC) {
                    sumCCForAvg += cc * qty;
                    countCCForAvg += qty;
                }
            }

            // Refund
            const refundRaw = card?.Refund;
            const refund = Number(refundRaw);
            const refundBlank = String(refundRaw ?? '').trim() === '';
            if (Number.isFinite(refund)) {
                totalRefund += refund * qty;
                const excludeRefund = isBasic && (refund === 0 || refundBlank);
                if (!excludeRefund) {
                    sumRefundForAvg += refund * qty;
                    countRefundForAvg += qty;
                }
            }

            // Produce N in CardText — totals + per-element + Wild
            {
                const text = String(card?.CardText ?? '');
                const re = /produce\s+(\d+)/gi;
                const hasInstead = /\binstead\b/i.test(text); // ⬅️ new: only first Produce counts if "instead" is present
                let m;
                while ((m = re.exec(text)) !== null) {
                    const n = Number(m[1]);
                    if (!Number.isFinite(n)) continue;

                    // Always add to grand total for the primary number
                    totalProduce += n * qty;

                    // Look ahead after the match until a period or line break
                    const rest = text.slice(re.lastIndex);
                    const seg = rest.split(/[.\n\r]/, 1)[0];

                    // Wild: any "of ..." phrasing after the number
                    if (/\bof\b/i.test(seg) && /\belement(al)?\b/i.test(seg)) {
                        produceByElement.Wild = (produceByElement.Wild || 0) + n * qty;
                    }

                    // Count for any named elements that appear after the number
                    for (const name of (ELEMENT_OPTIONS || [])) {
                        const rx = new RegExp(`\\b${name}\\b`, 'i');
                        if (rx.test(seg)) {
                            produceByElement[name] = (produceByElement[name] || 0) + n * qty;
                        }
                    }

                    // Also count any trailing "and <num> <Element>" parts toward the total
                    const namesAlt = (ELEMENT_OPTIONS || []).join('|');
                    const andRe = new RegExp(`\\band\\s+(\\d+)\\s+(?:${namesAlt})\\b`, 'gi');
                    let m2;
                    while ((m2 = andRe.exec(seg)) !== null) {
                        const extra = Number(m2[1]);
                        if (Number.isFinite(extra)) totalProduce += extra * qty;
                    }

                    // ⬇️ NEW: if "instead" appears anywhere in the text, only the first Produce counts
                    if (hasInstead) break;
                }
            }
        });

        const avgCC = countCCForAvg ? (sumCCForAvg / countCCForAvg) : 0;
        const avgRefund = countRefundForAvg ? (sumRefundForAvg / countRefundForAvg) : 0;

        // ---- Cost Element Pips from Cost string (exclude Partner; ignore Wild 'A') ----
        const letterToElement = {};
        (elements || []).forEach(el => {
            const letter = String(el?.CostStringLetter ?? '').trim().toUpperCase();
            const name = String(el?.DisplayName ?? '').trim();
            if (letter && name) letterToElement[letter] = name;
        });
        const costPips = {};
        rows.forEach(({ card, qty }) => {
            const costStr = String(card?.Cost ?? '').toUpperCase();
            const re = /(\d+)\s*([A-Z])/g;
            let m;
            while ((m = re.exec(costStr)) !== null) {
                const n = Number(m[1]);
                const L = m[2];
                if (!Number.isFinite(n)) continue;
                if (L === 'A') continue; // ignore Wild
                const elName = letterToElement[L];
                if (!elName) continue;
                costPips[elName] = (costPips[elName] || 0) + n * qty;
            }
        });

        const toArr = (m) => Object.entries(m)
            .map(([label, value]) => ({ label, value }))
            .sort((a, b) => b.value - a.value);

        // --- NEW: color the Element legend entries using elements.json HexColor ---
        const colorByName = new Map();
        for (const e of elements) {
            const dn = String(e?.DisplayName ?? '').trim().toLowerCase();
            const iname = String(e?.InternalName ?? '').trim().toLowerCase();
            const hex = String(e?.HexColor ?? '').trim();
            if (!hex) continue;
            if (dn) colorByName.set(dn, hex);
            if (iname) colorByName.set(iname, hex);
        }
        const elementsArr = toArr(elementMap);
        const elementsWithColor = elementsArr.map(it => {
            const key = String(it.label ?? '').trim().toLowerCase();
            const hex = colorByName.get(key);
            return hex ? { ...it, color: hex } : it;
        });

        // --- NEW: color the Rarity legend/slices using reference.json ---
        const rarityColorsRaw = (refData && (refData.RarityColors || refData.RarityHexColor)) || {};
        const rarityColorByName = new Map(
            Object.entries(rarityColorsRaw).map(([k, v]) => [String(k).trim().toLowerCase(), String(v).trim()])
        );
        const raritiesWithColor = toArr(rarityMap).map(it => {
            const key = String(it.label ?? '').trim().toLowerCase();
            const hex = rarityColorByName.get(key);
            return hex ? { ...it, color: hex } : it;
        });

        return {
            types: toArr(typeMap),
            rarities: raritiesWithColor,
            elements: elementsWithColor,   // ← use colored items
            curve,
            totals: {
                totalCC,
                avgCC,
                totalRefund,
                avgRefund,
                totalProduce,
                produceByElement, // NEW
            },
            costPips, // NEW
        };
    }, [deck, maybe, activeBoard, getById, elements, refData]);

    // (now the original three lines)
    const deckSizeLimit = getDeckSizeLimit();
    const deckCount = getDeckCount();
    // Only the main Deck has a size limit; Maybe is unlimited
    const isDeckFull = (activeBoard === 'DECK') && Number.isFinite(deckSizeLimit) && deckCount >= deckSizeLimit;

    /** Likelihood (single-card) controls — depends on deckList/deckCount */
    const [likeCardName, setLikeCardName] = useState('');
    const [likeQty, setLikeQty] = useState(0);     // successes in population (K)
    const [likeDraws, setLikeDraws] = useState(1); // sample size (n)
    const [likeDeckSize, setLikeDeckSize] = useState(0); // population size (N)

    /* Unique card names present in the current deck */
    const likeNames = useMemo(() => {
        return Array.from(new Set(
            deckList
                .filter(r => !isPartner(r?.c))  // exclude Partners
                .map(r => r?.c?.CardName)
                .filter(Boolean)
        )).sort();
    }, [deckList]);

    /* Count total copies of a card by CardName in the deck */
    const countByName = useCallback((name) => {
        if (!name) return 0;
        return deckList.reduce((sum, row) => {
            if (isPartner(row?.c)) return sum; // exclude Partner rows
            return sum + ((row?.c?.CardName === name ? (Number(row?.qty) || 0) : 0));
        }, 0);
    }, [deckList]);

    /* Default the deck size to your current deck count */
    useEffect(() => {
        setLikeDeckSize(deckCount);
    }, [deckCount]);

    /* Default the selector to the first available card name */
    useEffect(() => {
        if (!likeNames.length) {
            if (likeCardName) setLikeCardName('');
            return;
        }
        if (!likeCardName || !likeNames.includes(likeCardName)) {
            setLikeCardName(likeNames[0]);
        }
    }, [likeCardName, likeNames]);

    /* When the selected card changes, default Quantity to its total copies */
    useEffect(() => {
        if (likeCardName) setLikeQty(countByName(likeCardName));
    }, [likeCardName, countByName]);

    /* Likelihood = P(at least 1 success) = 1 − C(N−K, n) / C(N, n) */
    const likeOdds = useMemo(() => {
        const K = Math.max(0, Number(likeQty) || 0);
        const n = Math.max(0, Number(likeDraws) || 0);
        const N = Math.max(0, Number(likeDeckSize) || 0);
        if (K <= 0 || n <= 0 || N <= 0 || n > N) return 0;

        const choose = (a, b) => {
            if (b < 0 || b > a) return 0;
            if (b === 0 || b === a) return 1;
            b = Math.min(b, a - b);
            let num = 1, den = 1;
            for (let i = 1; i <= b; i++) { num *= (a - (b - i)); den *= i; }
            return num / den;
        };

        const zero = choose(N - K, n) / choose(N, n);
        return Math.max(0, Math.min(1, 1 - zero));
    }, [likeQty, likeDraws, likeDeckSize]);

    // When Deck Stats opens, initialize Deck Size to current deck count
    useEffect(() => {
        if (statsOpen) setProbDeckInput(String(deckCount));
    }, [statsOpen, deckCount]);

    // Keep keyboard handler in sync with whether the deck has cards
    useEffect(() => {
        deckCountRef.current = deckCount;
    }, [deckCount]);

    // ---- Hypergeometric helpers (small n so direct products are fine) ----
    const comb = (n, k) => {
        n = Math.floor(Number(n)); k = Math.floor(Number(k));
        if (!Number.isFinite(n) || !Number.isFinite(k) || k < 0 || k > n) return 0;
        k = Math.min(k, n - k);
        let res = 1;
        for (let i = 1; i <= k; i++) res = (res * (n - k + i)) / i;
        return res;
    };
    const hyperPMF = (K, N, n, x) => {
        if (n > N || x < 0 || x > n || x > K) return 0;
        return (comb(K, x) * comb(N - K, n - x)) / comb(N, n);
    };
    const hyperAtLeast = (K, N, n, k) => {
        if (k <= 0) return 1;
        let s = 0, maxX = Math.min(n, K);
        for (let x = k; x <= maxX; x++) s += hyperPMF(K, N, n, x);
        return s;
    };
    const pct0 = (p) => `${Math.round((Math.max(0, Math.min(1, p)) || 0) * 100)}%`;
    const toInt = (v, d) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : d;
    };

  return (
   <div className="db-root">
          <header className="db-header">
              <div className="db-title">Deck Builder</div>
              <button
                  type="button"
                  className="tips-btn"
                  aria-label="Return to Title Screen"
                  title="Return to Title Screen"
                  onClick={() => {
                      const deckCount = Object.values(deck || {}).reduce((a, b) => a + (b || 0), 0);
                      const maybeCount = Object.values(maybe || {}).reduce((a, b) => a + (b || 0), 0);

                      if (deckCount + maybeCount > 0) {
                          if (!confirmDanger('Do you want to Return to Menu without exporting?')) return;
                      }

                      window.dispatchEvent(new CustomEvent('tcg:return-to-title'));
                  }}
              >
                  Return to Menu
              </button>
          </header>
    <div className="app">
      {/* LEFT FILTERS */}
      <aside className="left">
              <h3 className="section-title filters-header">
                  <span>Filters</span>
                  <button
                      type="button"
                      className="chev-btn"
                      aria-label={filtersCollapsed ? 'Expand filters' : 'Collapse filters'}
                      aria-expanded={!filtersCollapsed}
                      aria-controls="filters-body"
                      onClick={() => setFiltersCollapsed(v => !v)}
                  >
                      <span className="chev" aria-hidden="true">▸</span>
                  </button>
              </h3>

       <div id="filters-body" hidden={filtersCollapsed}>

              {/* Dataset toggle */}
              <div className="dataset-toggle">
                  <button
                      type="button"
                      className={`tab ${activeDataset === DATASETS.CARDS ? 'active' : ''}`}
                      onClick={() => setActiveDataset(DATASETS.CARDS)}
                      aria-pressed={activeDataset === DATASETS.CARDS}
                  >
                      Cards
                  </button>
                  <button
                      type="button"
                      className={`tab ${activeDataset === DATASETS.PARTNERS ? 'active' : ''}`}
                      onClick={() => setActiveDataset(DATASETS.PARTNERS)}
                      aria-pressed={activeDataset === DATASETS.PARTNERS}
                  >
                      Partners
                  </button>
                  <button
                      type="button"
                      className={`tab ${activeDataset === DATASETS.TOKENS ? 'active' : ''}`}
                      onClick={() => setActiveDataset(DATASETS.TOKENS)}
                      aria-pressed={activeDataset === DATASETS.TOKENS}
                  >
                      Tokens
                  </button>
              </div>

         <div className="controls">
          <input
            placeholder="Search name or rules..."
            value={q}
            onChange={e=>setQ(e.target.value)}
          />
         </div>

              {/* Rarity stays simple */}
              <div className="controls">
                  <select value={rarity} onChange={e => setRarity(e.target.value)}>
                      {['Any Rarity', ...(refData.Rarity?.length
                          ? refData.Rarity
                          : ['Basic', 'Common', 'Uncommon', 'Rare', 'Ultra Rare'])]
                          .map(r => (<option key={r}>{r}</option>))}
                  </select>
              </div>

              {/* ===== TYPES: SuperType / CardType / SubType with OR/AND/EXCLUDE ===== */}
              {/* --- SuperType (Top) --- */}
              <div className="controls">
                  <select value={sup1} onChange={e => onSup1Change(e.target.value)}>
                      <option value="">Any SuperType</option>
                      {(refData.SuperType?.length ? refData.SuperType : ['Token', 'Partner', ''])
                          .filter(Boolean)
                          .map(t => (<option key={t} value={t}>{t}</option>))}
                  </select>
                  <select value={sop1} onChange={e => setSop1(e.target.value)} disabled={!sup1}>
                      <option value="">Mode</option>
                      <option value="OR">OR</option>
                      <option value="AND">AND</option>
                      <option value="EXCLUDE">EXCLUDE</option>
                  </select>
              </div>

              {/* --- CardType (Middle, two rows) --- */}
              <div className="controls">
                  <select value={typ1} onChange={e => onTyp1Change(e.target.value)}>
                      <option value="">Any CardType</option>
                      {(refData.CardType?.length ? refData.CardType : ['Partner', 'Unit', 'Ability', 'Event', 'Support', 'Shield'])
                          .map(t => (<option key={t} value={t}>{t}</option>))}
                  </select>
                  <select value={top1} onChange={e => setTop1(e.target.value)} disabled={!typ1}>
                      <option value="">Mode</option>
                      <option value="OR">OR</option>
                      <option value="AND">AND</option>
                      <option value="EXCLUDE">EXCLUDE</option>
                  </select>
              </div>

              <div className="controls">
                  <select
                      value={typ2}
                      onChange={e => onTyp2Change(e.target.value)}
                      disabled={!typ1}                 // ⬅ gate this whole row on typ1
                  >
                      <option value="">Any CardType</option>
                      {(refData.CardType?.length ? refData.CardType : ['Partner', 'Unit', 'Ability', 'Event', 'Support', 'Shield'])
                          .map(t => (<option key={t} value={t}>{t}</option>))}
                  </select>

                  <select
                      value={top2}
                      onChange={e => setTop2(e.target.value)}
                      disabled={!typ1 || !typ2}        // ⬅ needs typ1 AND typ2 to be set
                  >
                      <option value="">Mode</option>
                      <option value="OR">OR</option>
                      <option value="AND">AND</option>
                      <option value="EXCLUDE">EXCLUDE</option>
                  </select>
              </div>

              {/* --- SubType (Bottom) --- */}
              <div className="controls">
                  <select value={sub1} onChange={e => onSub1Change(e.target.value)}>
                      <option value="">Any SubType</option>
                      {(refData.SubType?.length ? refData.SubType : [])
                          .map(t => (<option key={t} value={t}>{t}</option>))}
                  </select>
                  <select value={tbop1} onChange={e => setTbop1(e.target.value)} disabled={!sub1}>
                      <option value="">Mode</option>
                      <option value="OR">OR</option>
                      <option value="AND">AND</option>
                      <option value="EXCLUDE">EXCLUDE</option>
                  </select>
              </div>

              {/* Elements (up to 3 rules) */}
              <div className="controls">
                  <select value={el1} onChange={e => onEl1Change(e.target.value)}>
                      <option value="">Any Element</option>
                      {(refData.Element?.length ? refData.Element : ELEMENT_OPTIONS).map(el => (<option key={el} value={el}>{el}</option>))}
                  </select>
                  <select value={op1} onChange={e => setOp1(e.target.value)} disabled={!el1}>
                      <option value="">Mode</option>
                      <option value="OR">OR</option>
                      <option value="AND">AND</option>
                      <option value="EXCLUDE">EXCLUDE</option>
                  </select>
              </div>

              <div className="controls">
                  <select value={el2} onChange={e => onEl2Change(e.target.value)} disabled={d2}>
                      <option value="">Any Element</option>
                      {(refData.Element?.length ? refData.Element : ELEMENT_OPTIONS).map(el => (<option key={el} value={el}>{el}</option>))}
                  </select>
                  <select value={op2} onChange={e => setOp2(e.target.value)} disabled={!el2}>
                      <option value="">Mode</option>
                      <option value="OR">OR</option>
                      <option value="AND">AND</option>
                      <option value="EXCLUDE">EXCLUDE</option>
                  </select>
              </div>

              <div className="controls">
                  <select value={el3} onChange={e => onEl3Change(e.target.value)} disabled={d3}>
                      <option value="">Any Element</option>
                      {(refData.Element?.length ? refData.Element : ELEMENT_OPTIONS).map(el => (<option key={el} value={el}>{el}</option>))}
                  </select>

                  <select value={op3} onChange={e => setOp3(e.target.value)} disabled={!el3}>
                      <option value="">Mode</option>
                      <option value="OR">OR</option>
                      <option value="AND">AND</option>
                      <option value="EXCLUDE">EXCLUDE</option>
                  </select>
              </div>

              <div className="controls">
                  {(() => {
                      const allSets = Array.isArray(refData?.Set) ? refData.Set : [];
                      const allowedSets = getAllowedSetsForFormat(); // null => all
                      const optionSets = allowedSets ? allSets.filter(s => allowedSets.includes(s)) : allSets;

                      // Build options: "Any Set" + allowed ones
                      const options = ['Any Set', ...optionSets];

                      return (
                          <select
                              value={options.includes(setFilter) ? setFilter : 'Any Set'}
                              onChange={e => setSetFilter(e.target.value)}
                          >
                              {options.map(s => (
                                  <option key={s} value={s}>{s}</option>
                              ))}
                          </select>
                      );
                  })()}
              </div>

         <div className="controls">
          <input
            placeholder="Cost string contains (e.g. 1E4A)"
            value={costStr}
            onChange={e=>setCostStr(e.target.value)}
          />
         </div>

        {/* CC bounds */}
                  <div className="controls bounds-row">
                      <span className="label small filter-label">Cost</span>
                      <input className="filter-input" placeholder="Min" value={ccMin} onChange={e => setCcMin(e.target.value)} />
                      <input className="filter-input" placeholder="Exact" value={ccExact} onChange={e => setCcExact(e.target.value)} />
                      <input className="filter-input" placeholder="Max" value={ccMax} onChange={e => setCcMax(e.target.value)} />
                  </div>

        {/* ATK bounds */}
                  <div className="controls bounds-row">
                      <span className="label small filter-label">ATK</span>
                      <input className="filter-input" placeholder="Min" value={atkMin} onChange={e => setAtkMin(e.target.value)} />
                      <input className="filter-input" placeholder="Exact" value={atkExact} onChange={e => setAtkExact(e.target.value)} />
                      <input className="filter-input" placeholder="Max" value={atkMax} onChange={e => setAtkMax(e.target.value)} />
                  </div>

        {/* DEF bounds */}
                  <div className="controls bounds-row">
                      <span className="label small filter-label">DEF</span>
                      <input className="filter-input" placeholder="Min" value={defMin} onChange={e => setDefMin(e.target.value)} />
                      <input className="filter-input" placeholder="Exact" value={defExact} onChange={e => setDefExact(e.target.value)} />
                      <input className="filter-input" placeholder="Max" value={defMax} onChange={e => setDefMax(e.target.value)} />
                  </div>

        {/* HP bounds */}
                  <div className="controls bounds-row">
                      <span className="label small filter-label">HP</span>
                      <input className="filter-input" placeholder="Min" value={hpMin} onChange={e => setHpMin(e.target.value)} />
                      <input className="filter-input" placeholder="Exact" value={hpExact} onChange={e => setHpExact(e.target.value)} />
                      <input className="filter-input" placeholder="Max" value={hpMax} onChange={e => setHpMax(e.target.value)} />
                  </div>

              <h3 className="section-title">Filter Actions</h3>

              {/* Allowable Only + Clear Filters */}
              <div className="controls" style={{ margin: '8px 0', justifyContent: 'space-between' }}>
                  <button
                      onClick={() => setAllowOnly(v => !v)}
                      aria-pressed={allowOnly}
                      title="Show only cards allowed by your selected Partner"
                      className={`allowable-toggle ${allowOnly ? 'active' : ''}`}
                  >
                      Allowable Only
                  </button>
                      <button
                          className="deck-action-btn"
                          onClick={onClearFilters}
                          title="Clear all filters and switch to Cards"
                      >
                          Clear Filters
                      </button>
              </div>

       </div>

              {/* Help Section title */}
              <h3 id="help-title" className="section-title filters-header">
                  <span>Help Section</span>
                  <button
                      type="button"
                      className="chev-btn"
                      aria-label={helpCollapsed ? 'Expand help' : 'Collapse help'}
                      aria-expanded={!helpCollapsed}
                      aria-controls="help-body"
                      onClick={() => setHelpCollapsed(v => !v)}
                  >
                      <span className="chev" aria-hidden="true">▸</span>
                  </button>
              </h3>
              <div id="help-body" hidden={helpCollapsed}>
                  {/* Help Section content provided by plugins */}
                  {(pluginHost.getHelpSectionRenderers?.() || []).map((h, i) => (
                      h?.render
                          ? <React.Fragment key={`${h.id}-${i}`}>{h.render(pluginHost.getAppApi?.())}</React.Fragment>
                          : null
                  ))}

                  {/* keep your stacked shortcuts block below, unchanged */}
                  <div className="controls" style={{ marginTop: 10 }}>
                      <div className="small">
                          <strong>Keyboard shortcuts:</strong>
                          <div>? or Shift+/ or H — Tips &amp; Features</div>
                          <div>K — Keywords, I — Effect Icons</div>
                          <div>E — Element Chart, T — Turn Structure</div>
                          <div>F — Formats, L — Card Layout, S — Deck Stats</div>
                          <div>B — Board Layout, V — Toggle Stack View </div>
                          <div>Q — FAQ, Esc — Close modals</div>
                      </div>
                  </div>
              </div>
      </aside>

      {/* GRID */}
      <main
              className="grid"
              ref={galleryGridRef}
              style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(GALLERY_BASE_TILE_MIN * galleryScale)}px, 1fr))`
              }}
      >
              {/* Gallery Header (sticky) */}
              <div className="gallery-header" style={GALLERY_HEADER_STYLE}>
                  <div className="gallery-header-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {/* Left: title + plugin-provided controls (size icon/slider/reset + sorting + reverse) */}
                      <div className="gh-left" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{GALLERY_HEADER_TITLE}</div>

                          {(pluginHost.getGalleryHeaderLeftActions?.() || []).map((action, i) => (
                              action?.render
                                  ? <React.Fragment key={`${action.id}-${i}`}>{action.render(pluginHost.getAppApi?.())}</React.Fragment>
                                  : (
                                      <button
                                          key={`${action.id}-${i}`}
                                          type="button"
                                          className="to-top-btn"
                                          onClick={() => action.onClick?.(pluginHost.getAppApi?.())}
                                      >
                                          {action.label}
                                      </button>
                                  )
                          ))}
                      </div>

                      {/* Right: Plugin actions + result count (To Top/Bottom moved to plugin) */}
                      <div className="gh-right" style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                          {(pluginHost.getGalleryHeaderActions?.() || []).map((action, i) => (
                              action?.render
                                  ? <React.Fragment key={`${action.id}-${i}`}>{action.render(pluginHost.getAppApi?.())}</React.Fragment>
                                  : (
                                      <button
                                          key={`${action.id}-${i}`}
                                          type="button"
                                          className="to-top-btn"
                                          onClick={() => action.onClick?.(pluginHost.getAppApi?.())}
                                      >
                                          {action.label}
                                      </button>
                                  )
                          ))}

                          <div style={{ fontSize: 12, opacity: 0.8, whiteSpace: 'nowrap' }}>
                              {gallery.length} results
                          </div>
                      </div>
                  </div>
              </div>

              {/* Virtualized gallery */}
              <div style={{ height: galleryVirt.padTop, gridColumn: '1 / -1' }} />
              {sortedGallery.slice(galleryVirt.start, galleryVirt.end).map(c => {
                  const id = c.InternalName
                  const qty = (getActiveMap()[id] ?? 0)
                  const cap = cardCap(c)
                  const atCap = Number.isFinite(cap) && qty >= cap
                  const inDeck = qty > 0
                  const isTokenCard = isToken(c) // ⬅ NEW
                  const isPartnerCard = isPartner(c)
                  const offElement = isOffElementForPartner(c); // NEW
                  const banned = isCardBannedInFormat(c);
                  const rc = getRarityCapMap();
                  const partnerCap = Number.isFinite(rc?.Partner) ? rc.Partner : 1;
                  const partnerTotal = isPartnerCard
                      ? Object.entries(getActiveMap()).reduce((s, [k, q]) => s + (isPartner(getById(k)) ? (q || 0) : 0), 0)
                      : 0;
                  const partnerCapReached = isPartnerCard && partnerTotal >= partnerCap;
                  // Collection-owned quantity for this card (front id), for the blue badge
                  const collQty = (collectionFilter?.quantities?.get(String(id).replace(/_b$/, '_a')) || 0);

                  // back side lookup within the current dataset pool (not filtered)
                  const backId = backIdFor(id)
                  const backCard = allById.get(backId) || null

                  // which side are we showing?
                  const showingBack = !!flipped[id]
                  const displayCard = showingBack && backCard ? backCard : c

                  // pick the image src + error handler
                  const imgProps = showingBack
                      ? (backCard
                          ? { src: primaryImg(backId), onError: makeImgErrorHandler(backId) } // real back
                          : { src: defaultBack }                                              // fake back
                      )
                      : { src: primaryImg(id), onError: makeImgErrorHandler(id) }             // front

                  const currentImgSrc = showingBack
                      ? (backCard ? primaryImg(backId) : defaultBack)
                      : primaryImg(id)


                  return (
                      <div key={id} className={`card ${inDeck ? 'in-deck' : ''} ${banned ? 'is-banned' : ''}`}>
                          {qty > 0 && !isTokenCard && (
                              <div
                                  className="deck-badge"
                                  title="Click to remove 1 from deck"
                                  onClick={(e) => { e.stopPropagation(); add(id, -1) }}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(id, -1) }
                                  }}
                              >
                                  {qty}
                              </div>
                          )}

                          {/* 🔍 Zoom button (top-right over the image) */}
                          <button
                              className="zoom-btn"
                              title="Zoom card art"
                              onClick={(e) => {
                                  e.stopPropagation()
                                  openZoom(currentImgSrc, displayCard.CardName, id)
                              }}
                              onPointerDown={(e) => e.stopPropagation()} // don’t trigger flip long-press
                          >
                              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                                  <path fill="currentColor" d="M10 2a8 8 0 105.293 14.293l4.707 4.707 1.414-1.414-4.707-4.707A8 8 0 0010 2zm0 2a6 6 0 110 12A6 6 0 0110 4z" />
                              </svg>
                          </button>

                          {/* Existing card image */}
                          {banned && (
                              <div className="ban-overlay" aria-hidden="true">BANNED</div>
                          )}
                          <div className="card-art-wrap">
                              <img
                                  className="cardart clickable"
                                  alt={displayCard.CardName}
                                  {...imgProps}
                                  data-tried=""
                                  draggable={false}

                                  // left click/tap to add one, unless a long-press just fired
                                  onClick={(e) => {
                                      if (pressHandledRef.current[id]) {
                                          pressHandledRef.current[id] = false
                                          e.preventDefault()
                                          e.stopPropagation()
                                          return
                                      }
                                      if (isTokenCard) return
                                      if (atCap) return
                                      if (offElement) {
                                          pushToast('That card has an element not allowed by your selected Partner.', { type: 'warn' })
                                          return
                                      }
                                      if (isDeckFull && !isPartnerCard) {
                                          pushToast(`Deck is full (${deckSizeLimit} cards). Remove a card before adding more.`, { type: 'warn' })
                                          return
                                      }
                                      add(id, +1)
                                  }}

                                  // right-click to flip (desktop)
                                  onContextMenu={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      flipCard(id)
                                  }}

                                  // long-press to flip (mobile)
                                  onPointerDown={(e) => {
                                      pressHandledRef.current[id] = false
                                      longPressTimerRef.current[id] = window.setTimeout(() => {
                                          flipCard(id)
                                          pressHandledRef.current[id] = true
                                      }, 500)
                                  }}
                                  onPointerUp={() => {
                                      window.clearTimeout(longPressTimerRef.current[id])
                                  }}
                                  onPointerLeave={() => {
                                      window.clearTimeout(longPressTimerRef.current[id])
                                  }}
                                  onPointerCancel={() => {
                                      window.clearTimeout(longPressTimerRef.current[id])
                                  }}
                                  role="button"
                                  tabIndex={0}
                                  aria-label={
                                      showingBack
                                          ? `Showing back of ${displayCard.CardName}`
                                          : `Add ${displayCard.CardName} to deck; right-click or long-press to flip`
                                  }
                              />
                              {/* moved: badge now lives in the title row */}
                          </div>

                          <div className="card-title-row">
                              <h4 style={{ margin: 0 }}>{displayCard.CardName}</h4>
                              {collectionFilter && collQty > 0 && (
                                  <div className="collection-badge in-row" title={`In collection: ${collQty}`}>
                                      {collQty}
                                  </div>
                              )}
                          </div>
                          {/* Card rules text under the name */}
                          {displayCard.CardText && (
                              <div className="small" style={{ marginTop: 4, marginBottom: 8 }}>
                                  {displayCard.CardText}
                              </div>
                          )}
                          <div className="row small">
                              <span className="badge">{displayCard.Rarity}</span>
                              <span className="badge">{displayCard.CardType}</span>
                              <span className="badge">
                                  {[displayCard.ElementType1, displayCard.ElementType2, displayCard.ElementType3]
                                      .filter(Boolean).join(' / ') || 'Neutral'}
                              </span>
                              <span className="badge">CC {displayCard.ConvertedCost}</span>

                              {/* Only show these if non-empty */}
                              {displayCard.ATK !== '' && displayCard.ATK != null && (
                                  <span className="badge">ATK {displayCard.ATK}</span>
                              )}
                              {displayCard.DEF !== '' && displayCard.DEF != null && (
                                  <span className="badge">DEF {displayCard.DEF}</span>
                              )}
                              {displayCard.HP !== '' && displayCard.HP != null && (
                                  <span className="badge">HP {displayCard.HP}</span>
                              )}
                              {displayCard.Cost && (
                                  <span className="badge">Cost {displayCard.Cost}</span>
                              )}
                              {displayCard.SuperType && displayCard.SuperType.trim() !== '' && (
                                  <span className="badge">{displayCard.SuperType}</span>
                              )}
                              {displayCard.SubType && displayCard.SubType.trim() !== '' && (
                                  <span className="badge">{displayCard.SubType}</span>
                              )}
                              {displayCard.Refund != null && String(displayCard.Refund).trim() !== '' && (
                                  <span className="badge">Refund {displayCard.Refund}</span>
                              )}
                          </div>
                          {/* Plugin-provided badges */}
                          {(() => {
                              const nodes = pluginHost.getCardBadgeNodes({
                                  card: displayCard,
                                  banned,
                                  isTokenCard
                              });
                              return nodes && nodes.length ? (
                                  <div className="row small">
                                      {nodes.map((node, i) => (
                                          <React.Fragment key={`pbadge-${i}`}>{node}</React.Fragment>
                                      ))}
                                  </div>
                              ) : null;
                          })()}
                          {!isTokenCard && (
                              <div className="row">

                                  {/* New Flip toggle (styled like a badge and highlights when back is showing) */}
                                  <button
                                      type="button"
                                      className="flip-btn"
                                      aria-pressed={!!showingBack}   // toggles highlight style
                                      title="Flip this card"
                                      onClick={(e) => { e.stopPropagation(); flipCard(id); }}
                                      onMouseDown={(e) => e.preventDefault()}
                                  >
                                      Flip
                                  </button>
                                  
                                  <button
                                      onClick={() => add(id, +1)}
                                      disabled={partnerCapReached || atCap || (isDeckFull && !isPartnerCard) || offElement}
                                      title={
                                          partnerCapReached
                                              ? `Only ${partnerCap} Partner${partnerCap === 1 ? '' : 's'} allowed`
                                              : offElement
                                                  ? 'Off-element for current Partner'
                                                  : (isDeckFull && !isPartnerCard)
                                                      ? `Deck is full (${deckSizeLimit} cards)`
                                                      : (atCap ? 'Limit reached' : 'Add 1')
                                      }
                                  >
                                      + Add
                                  </button>
                                                                    
                                  <button onClick={() => add(id, -1)} disabled={qty === 0}>-1</button>
                                  <span className="small">
                                      In deck: {qty}{Number.isFinite(cap) ? ` / ${cap}` : ''}
                                  </span>
                              </div>
                          )}
                      </div>
                  )
              })}
              <div style={{ height: galleryVirt.padBottom, gridColumn: '1 / -1' }} />
      </main>

      {/* RIGHT: DECK PANEL */}
      <aside className="right" style={{ marginLeft: 0 }}>
              <h3 className="section-title">Collection</h3>
              {/* Import Collection (.json) */}
              <div className="deck-action-row" style={{ marginBottom: 8 }}>
                  <input
                      ref={collectionFileRef}
                      type="file"
                      accept=".json,application/json"
                      style={{ display: 'none' }}
                      onChange={handleImportCollection}
                  />
                  <button
                      type="button"
                      className="deck-action-btn"
                      onClick={handleImportCollectionClick}
                      title="Import a collection JSON to filter the Cards gallery"
                  >
                      Import Collection
                  </button>

                  {/* Optional: show which collection is active and provide a quick clear */}
                  {collectionFilter?.name && (
                      <>
                          <button
                              type="button"
                              className="deck-action-btn"
                              onClick={() => setCollectionFilter(null)}
                              style={{ marginLeft: 6 }}
                              title="Clear imported collection filter"
                          >
                              Clear
                          </button>

                          <span
                              className="small"
                              title={collectionFilter.name}
                              style={{
                                  fontSize: '12px',
                                  marginLeft: 8,
                                  opacity: 0.85,
                                  display: 'inline-block',
                                  maxWidth: 220,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  verticalAlign: 'middle'
                              }}
                          >
                              {collectionFilter.name}
                          </span>
                      </>
                  )}

              </div>

              <h3 className="section-title">Format</h3>

              {/* Format selector */}
              <div className="controls" style={{ marginBottom: 8 }}>
                  <select value={formatId} onChange={(e) => setFormatId(e.target.value)}>
                      {(refData.Format?.length ? refData.Format : ['Freeform', 'Standard'])
                          .map(f => (<option key={f} value={f}>{f}</option>))}
                  </select>
              </div>
              <h3 className="section-title">Deck Name</h3>
        {/* Name area */}
        {!showNameInput ? (
          <div className="row" style={{marginBottom:8}}>
            <button className="deck-action-btn" onClick={onNewDeck}>New Deck</button>
          </div>
        ) : (
          <div className="controls" style={{alignItems:'center', gap:'6px'}}>
            <input
              ref={nameRef}
              placeholder="Deck name..."
              value={deckName}
              onChange={(e)=>setDeckName(e.target.value)}
              style={{flex:1}}
            />
                          <button
                              className="deck-action-btn"
                              onClick={() => {
                                  if (!confirmDanger('Cancel and...clear the current deck? This will remove the deck name and all cards.')) return
                                  setDeck({})
                                  setMaybe({})
                                  setActiveBoard('DECK');
                                  setDeckName('')
                                  setFormatId('Freeform')
                                  setShowNameInput(false)
                                  if (fileRef.current) fileRef.current.value = ''
                                  setImportFileName('')
                                  setImportFileHandle(null)
                              }}
                              title="Cancel and clear deck"
                          >
                              Cancel
                          </button>
          </div>
        )}
              <h3 className="section-title"></h3>
              {/* Plugin deck header controls (e.g. Deck/Maybe toggle) */}
              {(pluginHost.getDeckHeaderRenderers?.() || []).map((r, i) => (
                  <React.Fragment key={`${r.id}-${i}`}>{r.render?.()}</React.Fragment>
              ))}
              <h3 className="section-title">
                  Deck List: {getDeckCount()}
                  {activeBoard === 'DECK' ? (() => {
                      const lim = getDeckSizeLimit();
                      return Number.isFinite(lim) ? ` / ${lim}` : '';
                  })() : ''}
              </h3>
              <div style={{ marginTop: 8 }}>
                  {typeOrder.map(type => {
                      const cardsOfType = deckList.filter(row => getTypeTag(row.c) === type)
                      if (cardsOfType.length === 0) return null

                      const totalCount = cardsOfType.reduce((sum, row) => sum + row.qty, 0)
                      const isCollapsed = collapsedTypes[type] || false

                      // sort by CC then name
                      const cardsOfTypeSorted = cardsOfType.slice().sort((a, b) => {
                          const costA = Number(a.c?.ConvertedCost ?? Infinity)
                          const costB = Number(b.c?.ConvertedCost ?? Infinity)
                          if (costA !== costB) return costA - costB
                          return (a.c?.CardName || '').localeCompare(b.c?.CardName || '')
                      })

                      return (
                          <div
                              key={type}
                              className={`deck-type-group ${type === 'Partner' ? 'is-partner' : ''}`}
                          >
                              <div
                                  className="deck-type-header"
                                  onClick={() => toggleTypeCollapsed(type)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault()
                                          toggleTypeCollapsed(type)
                                      }
                                  }}
                              >
                                  <span className={`arrow ${isCollapsed ? 'collapsed' : ''}`}>▶</span>
                                  <span>{type} ({totalCount})</span>
                              </div>

                              {!isCollapsed && (
                                  <div className="deck-type-cards">
                                      {cardsOfTypeSorted.map(row => {
                                          const cap = cardCap(row.c);
                                          const atCap = Number.isFinite(cap) && row.qty >= cap;
                                          // Format legality + off-element (front-only) highlight
                                          const notAllowed = !isCardAllowedInFormat(row.c);
                                          const offElement = isOffElementForPartner(row.c);
                                          const banned = isCardBannedInFormat(row.c);
                                          // NEW: flag when a collection is loaded and this card isn't in it
                                          const notInCollection = !!(collectionFilter && !collectionFilter.ids?.has?.(row.id));
                                          const warnNotAllowed = notAllowed || offElement || banned || notInCollection;

                                          return (
                                              <div
                                                  key={row.id}
                                                  data-id={row.id}
                                                  className={`deckRow ${warnNotAllowed ? 'not-allowed' : ''}`}
                                                  title={
                                                      warnNotAllowed
                                                          ? [
                                                              notInCollection ? 'Not in collection' : null,
                                                              notAllowed ? 'Not legal in the selected format' : null,
                                                              offElement ? 'Off-element for current Partner' : null,
                                                              banned ? 'Banned in the selected format' : null
                                                          ].filter(Boolean).join(' • ')
                                                          : undefined
                                                  }
                                                  onMouseEnter={(e) => {
                                                      if (!(window.matchMedia && window.matchMedia('(hover: hover)').matches)) return;
                                                      positionPreviewNearCursor(e);
                                                      setDeckPreview(prev => ({ ...prev, id: row.id, show: true }));
                                                  }}
                                                  onMouseLeave={() => {
                                                      if (!(window.matchMedia && window.matchMedia('(hover: hover)').matches)) return;
                                                      setDeckPreview(prev => ({ ...prev, show: false }));
                                                  }}
                                                  onMouseMove={(e) => {
                                                      if (!(window.matchMedia && window.matchMedia('(hover: hover)').matches)) return;
                                                      positionPreviewNearCursor(e);
                                                  }}
                                                  onMouseDown={(e) => {
                                                      const rect = e.currentTarget.getBoundingClientRect();
                                                      if (e.clientX > rect.right - 80) {
                                                          e.preventDefault();
                                                          previewLockLeftRef.current = true;
                                                      }
                                                  }}
                                                  tabIndex={0}
                                                  onFocus={(e) => {
                                                      if (pointerDownRef.current) return;
                                                      const rect = e.currentTarget.getBoundingClientRect();
                                                      const vw = window.innerWidth;
                                                      const vh = window.innerHeight;

                                                      let x;
                                                      if (previewLockLeftRef.current) {
                                                          x = rect.left - PREVIEW_W - PREVIEW_OFFSET;
                                                          if (x < 8) x = 8;
                                                      } else {
                                                          x = Math.min(rect.right + PREVIEW_OFFSET, vw - PREVIEW_W - 8);
                                                      }

                                                      let y = rect.top;
                                                      if (y + PREVIEW_H > vh) y = vh - PREVIEW_H - 8;
                                                      if (y < 8) y = 8;

                                                      setDeckPreview({ id: row.id, x, y, show: true });
                                                  }}
                                                  onBlur={() => setDeckPreview(prev => ({ ...prev, show: false }))}
                                              >
                                                  <div
                                                      className="deckRow-main"
                                                      style={{ flex: 1, marginRight: 8, padding: '6px 8px', cursor: 'pointer' }}   // ⬅ widen hit area
                                                      onClick={(e) => {
                                                          e.stopPropagation();
                                                          // Block adds if ANY warning applies: not-in-collection, banned, not-in-format, or off-element
                                                          if (!(atCap || (isDeckFull && !isPartner(row.c)) || warnNotAllowed)) {
                                                              add(row.id, +1);
                                                          }
                                                      }}
                                                      onContextMenu={(e) => {
                                                          e.preventDefault();
                                                          e.stopPropagation();
                                                          add(row.id, -1);
                                                      }}
                                                  >
                                                      <div className="small">{row.c?.CardName || row.id}</div>
                                                      <div className="small">
                                                          CC {row.c?.ConvertedCost ?? '-'}
                                                          {row.c?.Cost ? ` | Cost: ${row.c.Cost}` : ''}
                                                          {row.c?.Hold ? ` | Hold: ${row.c.Hold}` : ''}
                                                          {(notInCollection || notAllowed || offElement || banned) && (
                                                              <span className="badge warn lines" style={{ marginLeft: 6 }}>
                                                                  {[
                                                                      notInCollection ? 'Not in collection' : null,
                                                                      banned ? 'Banned' : null,
                                                                      notAllowed ? 'Not in format' : null,
                                                                      offElement ? 'Off element' : null
                                                                  ]
                                                                      .filter(Boolean)
                                                                      .map((msg, i, arr) => (
                                                                          <span key={i} className="warn-item">
                                                                              {msg}{i < arr.length - 1 ? ',' : ''}
                                                                          </span>
                                                                      ))}
                                                              </span>
                                                          )}
                                                      </div>
                                                  </div>

                                                  <div
                                                      className="qty"
                                                      onMouseEnter={(e) => { if (!(window.matchMedia && window.matchMedia('(hover: hover)').matches)) return; previewLockLeftRef.current = true; positionPreviewNearCursor(e); }}
                                                      onMouseMove={(e) => { if (!(window.matchMedia && window.matchMedia('(hover: hover)').matches)) return; positionPreviewNearCursor(e); }}
                                                      onMouseLeave={() => { if (!(window.matchMedia && window.matchMedia('(hover: hover)').matches)) return; previewLockLeftRef.current = false; }}
                                                      onMouseDown={(e) => {
                                                          previewLockLeftRef.current = true;
                                                          e.preventDefault();
                                                          requestAnimationFrame(() => positionPreviewNearCursor(e));
                                                      }}
                                                      onMouseUp={(e) => {
                                                          requestAnimationFrame(() => positionPreviewNearCursor(e));
                                                      }}
                                                  >
                                                      {activeBoard === 'MAYBE' && (
                                                          <button
                                                              className="to-deck-btn"
                                                              onMouseDown={(e) => e.preventDefault()}
                                                              onClick={(e) => {
                                                                  previewLockLeftRef.current = true;
                                                                  positionPreviewNearCursor(e);
                                                                  moveAllToDeck(row.id);
                                                              }}
                                                              title="Move all copies to your Deck (respects deck size & per-card limits)."
                                                          >
                                                              To Deck
                                                          </button>
                                                      )}
                                                      {activeBoard === 'DECK' && !isPartner(getById(row.id)) && (
                                                          <button
                                                              className="to-deck-btn"
                                                              onMouseDown={(e) => e.preventDefault()}
                                                              onClick={(e) => {
                                                                  previewLockLeftRef.current = true;
                                                                  positionPreviewNearCursor(e);
                                                                  moveAllToMaybe(row.id);
                                                              }}
                                                              title="Move all copies to your Maybe list."
                                                          >
                                                              To Maybe
                                                          </button>
                                                      )}
                                                      <button
                                                          onMouseDown={(e) => e.preventDefault()}
                                                          onClick={(e) => {
                                                              previewLockLeftRef.current = true;
                                                              positionPreviewNearCursor(e);
                                                              add(row.id, -1);
                                                          }}
                                                      >
                                                          -
                                                      </button>
                                                      <div className="badge">
                                                          {row.qty}{Number.isFinite(cap) ? ` / ${cap}` : ''}
                                                      </div>
                                                      <button
                                                          onMouseDown={(e) => e.preventDefault()}
                                                          onClick={(e) => {
                                                              previewLockLeftRef.current = true;
                                                              positionPreviewNearCursor(e);
                                                              add(row.id, +1);
                                                          }}
                                                          disabled={atCap || (isDeckFull && !isPartner(row.c)) || warnNotAllowed}
                                                          title={
                                                              warnNotAllowed
                                                                  ? [
                                                                      notInCollection ? 'Not in collection' : null,
                                                                      banned ? 'Banned' : null,
                                                                      notAllowed ? 'Not in format' : null,
                                                                      offElement ? 'Off element' : null
                                                                  ].filter(Boolean).join(' • ')
                                                                  : (isDeckFull && !isPartner(row.c))
                                                                      ? `Deck is full (${deckSizeLimit} cards)`
                                                                      : atCap
                                                                          ? `Limit reached (${cap}) for ${row.c?.Rarity}`
                                                                          : 'Add 1'
                                                          }
                                                      >
                                                          +
                                                      </button>
                                                  </div>
                                              </div>
                                          );
                                      })}
                                  </div>
                              )}
                          </div>
                      )
                  })}
              </div>

              {/* Zoomed art modal (portal to <body>) */}
              {zoom.show && createPortal(
                  <div className="zoom-backdrop" onClick={closeZoom} aria-modal="true" role="dialog">
                      <div className="zoom-modal" onClick={(e) => e.stopPropagation()}>
                          <button className="zoom-close" aria-label="Close" onClick={closeZoom}>✕</button>
                          <div className="zoom-stack">
                              <img
                                  className="zoom-img"
                                  src={zoom.src || defaultBack}
                                  alt={zoom.alt || 'Card art'}
                                  onError={(e) => { e.currentTarget.src = defaultBack }}
                                  draggable={false}
                                  onContextMenu={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const frontId = zoom?.id ? normalizeToFront(zoom.id) : null;
                                      if (!frontId) return;

                                      const backId = backIdFor(frontId);
                                      const backCard = allById.get(backId) || null;

                                      // compute next side (mirror gallery behavior) then flip global state
                                      const nextShowingBack = !flipped[frontId];
                                      flipCard(frontId);

                                      const nextSrc = nextShowingBack
                                          ? (backCard ? primaryImg(backId) : defaultBack)
                                          : primaryImg(frontId);
                                      const nextAlt = nextShowingBack
                                          ? (backCard?.CardName || zoom.alt || 'Card art')
                                          : (allById.get(frontId)?.CardName || zoom.alt || 'Card art');

                                      setZoom(z => ({ ...z, src: nextSrc, alt: nextAlt }));
                                  }}
                              />

                              <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
                                  <button
                                      type="button"
                                      className="flip-btn"
                                      aria-pressed={!!(zoom?.id && flipped[normalizeToFront(zoom.id)])}
                                      title="Flip this card"
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          const frontId = zoom?.id ? normalizeToFront(zoom.id) : null;
                                          if (!frontId) return;

                                          const backId = backIdFor(frontId);
                                          const backCard = allById.get(backId) || null;

                                          const nextShowingBack = !flipped[frontId];
                                          flipCard(frontId);

                                          const nextSrc = nextShowingBack
                                              ? (backCard ? primaryImg(backId) : defaultBack)
                                              : primaryImg(frontId);
                                          const nextAlt = nextShowingBack
                                              ? (backCard?.CardName || zoom.alt || 'Card art')
                                              : (allById.get(frontId)?.CardName || zoom.alt || 'Card art');

                                          setZoom(z => ({ ...z, src: nextSrc, alt: nextAlt }));
                                      }}
                                      onMouseDown={(e) => e.preventDefault()}
                                  >
                                      Flip
                                  </button>
                              </div>
                          </div>
                      </div>
                  </div>,
                  document.body
              )}
              {/* moved to plugin: /src/plugins/help-section.jsx (Tips) */}
              {/* moved to plugin: /src/plugins/help-section.jsx (Keywords) */}
              {/* moved to plugin: /src/plugins/help-section.jsx (<Elements>) */}
              {/* moved to plugin: /src/plugins/help-section.jsx (Effect Icons) */}
              {/* moved to plugin: /src/plugins/help-section.jsx (<Turn Structure>) */}
              {/* moved to plugin: /src/plugins/help-section.jsx (<Formats>) */}
              {/* moved to plugin: /src/plugins/help-section.jsx (<Card Layout>) */}
              {statsOpen && createPortal(
                  <div className="modal-backdrop" onClick={() => setStatsOpen(false)} role="none">
                      <div
                          className="modal-window modal-stats"
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="deckstats-title"
                          onClick={(e) => e.stopPropagation()}
                      >
                          <div className="modal-header">
                              <h2 id="deckstats-title">Deck Stats</h2>
                              <button
                                  className="modal-close"
                                  aria-label="Close Deck Stats"
                                  onClick={() => setStatsOpen(false)}
                              >
                                  ×
                              </button>
                          </div>

                          <div className="modal-body">
                              <div className="stats-grid">
                                  <div className="chart-card">
                                      <h3 className="chart-title">CardType Breakdown</h3>
                                      <PieChart data={deckStats.types} donut={false} />
                                      <Legend items={deckStats.types} />
                                  </div>

                                  <div className="chart-card">
                                      <h3 className="chart-title">Element Breakdown</h3>
                                      <PieChart data={deckStats.elements} donut={true} />
                                      <Legend items={deckStats.elements} />
                                  </div>

                                  <div className="chart-card">
                                      <h3 className="chart-title">Rarity Breakdown</h3>
                                      <PieChart data={deckStats.rarities} donut={true} />
                                      <Legend items={deckStats.rarities} />
                                  </div>

                                  <div className="chart-card">
                                      <h3 className="chart-title">Deck Metrics</h3>
                                      <table className="stats-table" style={{ width: '100%' }}>
                                          <thead>
                                              <tr>
                                                  <th style={{ textAlign: 'left' }}>Name</th>
                                                  <th style={{ textAlign: 'right' }}>Value</th>
                                              </tr>
                                              {/* Search Value row (under Name header) */}
                                              <tr>
                                                  <th>
                                                      <input
                                                          type="text"
                                                          value={statsSearchText}
                                                          onChange={(e) => setStatsSearchText(e.target.value)}
                                                          placeholder="Search Text Value (e.g. Keywords) "   // faded like other placeholders
                                                          aria-label="Deck Metrics search value"
                                                          style={{ width: '100%' }}
                                                      />
                                                  </th>
                                                  <th style={{ textAlign: 'right' }}>
                                                      {statsSearchText.trim() ? statsSearchCount : 0}
                                                  </th>
                                              </tr>
                                          </thead>
                                          <tbody>
                                              <tr>
                                                  <td>Total Converted Cost</td>
                                                  <td style={{ textAlign: 'right' }}>
                                                      {Number.isFinite(deckStats?.totals?.totalCC) ? deckStats.totals.totalCC : 0}
                                                  </td>
                                              </tr>
                                              <tr>
                                                  <td>Converted Cost Average</td>
                                                  <td style={{ textAlign: 'right' }}>
                                                      {Number.isFinite(deckStats?.totals?.avgCC)
                                                          ? deckStats.totals.avgCC.toFixed(2).replace(/\.00$/, '')
                                                          : '0'}
                                                  </td>
                                              </tr>
                                              <tr>
                                                  <td>Total Refund Amount</td>
                                                  <td style={{ textAlign: 'right' }}>
                                                      {Number.isFinite(deckStats?.totals?.totalRefund) ? deckStats.totals.totalRefund : 0}
                                                  </td>
                                              </tr>
                                              <tr>
                                                  <td>Refund Average</td>
                                                  <td style={{ textAlign: 'right' }}>
                                                      {Number.isFinite(deckStats?.totals?.avgRefund)
                                                          ? deckStats.totals.avgRefund.toFixed(2).replace(/\.00$/, '')
                                                          : '0'}
                                                  </td>
                                              </tr>
                                              <tr>
                                                  <td>Total Produce Amount</td>
                                                  <td style={{ textAlign: 'right' }}>
                                                      {Number.isFinite(deckStats?.totals?.totalProduce) ? deckStats.totals.totalProduce : 0}
                                                  </td>
                                              </tr>
                                              {Object.entries(deckStats?.totals?.produceByElement || {})
                                                  .filter(([, v]) => Number(v) > 0)
                                                  .sort((a, b) => b[1] - a[1]) // highest first
                                                  .map(([el, v]) => (
                                                      <tr key={`prod-${el}`}>
                                                          <td>Total Produce Amount — {el}</td>
                                                          <td style={{ textAlign: 'right' }}>{v}</td>
                                                      </tr>
                                                  ))}
                                          </tbody>
                                      </table>
                                  </div>

                                  <div className="chart-card chart-span-2">
                                      <h3 className="chart-title">Curve Breakdown</h3>
                                      <StackedColumnChart
                                          categories={['0,1', '2', '3', '4', '5', '6', '7', '8+']}
                                          series={[
                                              { label: 'No Hold', data: ['0,1', '2', '3', '4', '5', '6', '7', '8+'].map(b => deckStats.curve[b]?.noHold || 0) },
                                              { label: 'Hold', data: ['0,1', '2', '3', '4', '5', '6', '7', '8+'].map(b => deckStats.curve[b]?.hold || 0) },
                                          ]}
                                      />
                                      <div style={{ marginBottom: 12 }}>
                                          <Legend
                                              items={[
                                                  {
                                                      label: 'No Hold',
                                                      value: ['0,1', '2', '3', '4', '5', '6', '7', '8+'].reduce(
                                                          (s, b) => s + (deckStats.curve[b]?.noHold || 0),
                                                          0
                                                      ),
                                                      color: DEFAULT_SERIES_COLORS[0],
                                                  },
                                                  {
                                                      label: 'Hold',
                                                      value: ['0,1', '2', '3', '4', '5', '6', '7', '8+'].reduce(
                                                          (s, b) => s + (deckStats.curve[b]?.hold || 0),
                                                          0
                                                      ),
                                                      color: DEFAULT_SERIES_COLORS[1],
                                                  },
                                              ]}
                                          />
                                      </div>
                                      <div role="separator" aria-hidden="true" style={{ height: 1, background: '#263143', margin: '4px 0 12px' }} />
                                      <h3 className="chart-title">Amount of Cost Element Pips</h3>
                                      <StackedColumnChart
                                          // show only elements that actually have pips, ordered by your elements.json
                                          categories={(elements || [])
                                              .map(e => String(e?.DisplayName ?? ''))
                                              .filter(name => name && (deckStats?.costPips?.[name] > 0))}
                                          series={[
                                              {
                                                  label: 'Pips',
                                                  data: (elements || [])
                                                      .map(e => String(e?.DisplayName ?? ''))
                                                      .filter(name => name && (deckStats?.costPips?.[name] > 0))
                                                      .map(name => deckStats.costPips[name] || 0),
                                              },
                                          ]}
                                          height={260}
                                      />
                                      <div role="separator" aria-hidden="true" style={{ height: 1, background: '#263143', margin: '8px 0 12px' }} />
                                      <h3 className="chart-title">Probabilities</h3>

                                      {/* Control bar (labeled) */}
                                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap' }}>
                                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                                              <span>Condition</span>
                                              <select value={probCond} onChange={e => setProbCond(e.target.value)} aria-label="Condition">
                                                  <option>At Least</option>
                                                  <option>Exactly</option>
                                              </select>
                                          </label>

                                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                                              <span>Quantity</span>
                                              <input
                                                  type="number"
                                                  value={probQtyInput}
                                                  onChange={e => setProbQtyInput(e.target.value)}
                                                  placeholder="Quantity"
                                                  min="0"
                                                  style={{ width: 90 }}
                                                  aria-label="Quantity"
                                              />
                                          </label>

                                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                                              <span>Hand Size</span>
                                              <input
                                                  type="number"
                                                  value={probHandInput}
                                                  onChange={e => setProbHandInput(e.target.value)}
                                                  placeholder="Hand Size"
                                                  min="0"
                                                  style={{ width: 110 }}
                                                  aria-label="Hand Size"
                                              />
                                          </label>

                                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                                              <span>Deck Size</span>
                                              <input
                                                  type="number"
                                                  value={probDeckInput}
                                                  onChange={e => setProbDeckInput(e.target.value)}
                                                  placeholder="Deck Size"
                                                  min="0"
                                                  style={{ width: 100 }}
                                                  aria-label="Deck Size"
                                              />
                                          </label>
                                      </div>

                                      {/* Results table */}
                                      <table className="stats-table" style={{ width: '100%' }}>
                                          <thead>
                                              <tr>
                                                  <th style={{ textAlign: 'left' }}>Card Type</th>
                                                  <th style={{ textAlign: 'right' }}>Quantity</th>
                                                  <th style={{ textAlign: 'right' }}>Odds</th>
                                              </tr>
                                          </thead>
                                          <tbody>
                                              {(() => {
                                                  const N = toInt(probDeckInput, deckCount); // population size (deck size)
                                                  const n = toInt(probHandInput, 7);         // sample size (hand size)
                                                  const k = toInt(probQtyInput, 1);          // target quantity
                                                  const cond = probCond;

                                                  return (deckStats.types || []).map(row => {
                                                      const K = toInt(row.value, 0);           // successes in population (qty of that CardType)
                                                      let p = 0;
                                                      if (N > 0 && n > 0 && K >= 0) {
                                                          p = (cond === 'Exactly')
                                                              ? hyperPMF(K, N, n, k)
                                                              : hyperAtLeast(K, N, n, k);
                                                      }
                                                      return (
                                                          <tr key={`prob-${row.label}`}>
                                                              <td>{row.label}</td>
                                                              <td style={{ textAlign: 'right' }}>{K}</td>
                                                              <td style={{ textAlign: 'right' }}>{pct0(p)}</td>
                                                          </tr>
                                                      );
                                                  });
                                              })()}
                                          </tbody>
                                      </table>

                                      {/* ⬇ Likelihood (single-card) calculator ⬇ */}
                                      <div className="chart-card chart-span-2 likelihood-card">
                                          <h3 className="chart-title">Likelihood</h3>

                                          {/* Control bar: Card Selector, Quantity (K), To Draw (n), Deck Size (N) */}
                                          <div className="likelihood-controls">
                                              <label className="stats-label">
                                                  <span>Card Selector</span>
                                                  <select
                                                      value={likeCardName}
                                                      onChange={e => setLikeCardName(e.target.value)}
                                                      aria-label="Card Selector"
                                                      style={{ width: '100%' }}  // ~half-width
                                                  >
                                                      {likeNames.map(n => (<option key={n}>{n}</option>))}
                                                  </select>
                                              </label>

                                              <label className="stats-label">
                                                  <span>Quantity</span>
                                                  <input
                                                      className="stats-input"
                                                      type="number"
                                                      min="0"
                                                      placeholder="Quantity"
                                                      value={likeQty}
                                                      onChange={e => setLikeQty(e.target.value)}
                                                      aria-label="Quantity"
                                                      style={{ width: 90 }}   // same as Probabilities → Quantity
                                                  />
                                              </label>

                                              <label className="stats-label">
                                                  <span>To Draw</span>
                                                  <input
                                                      className="stats-input"
                                                      type="number"
                                                      min="0"
                                                      placeholder="To Draw"
                                                      value={likeDraws}
                                                      onChange={e => setLikeDraws(e.target.value)}
                                                      aria-label="To Draw"
                                                      style={{ width: 110 }}  // same as Probabilities → Hand Size
                                                  />
                                              </label>

                                              <label className="stats-label">
                                                  <span>Deck Size</span>
                                                  <input
                                                      className="stats-input"
                                                      type="number"
                                                      min="0"
                                                      placeholder="Deck Size"
                                                      value={likeDeckSize}
                                                      onChange={e => setLikeDeckSize(e.target.value)}
                                                      aria-label="Deck Size"
                                                      style={{ width: 100 }}  // same as Probabilities → Deck Size
                                                  />
                                              </label>
                                          </div>

                                          {/* Single-row result */}
                                          <table className="stats-table like-table" style={{ width: '100%' }}>
                                              {/* Fix the Quantity column width so it doesn't shift when Card Name changes */}
                                              <colgroup>
                                                  <col />                     {/* Card Name fills remaining space */}
                                                  <col style={{ width: 90 }} /> {/* Quantity fixed width (px) */}
                                                  <col style={{ width: 210 }} />                     {/* Odds auto */}
                                              </colgroup>
                                              <thead>
                                                  <tr>
                                                      <th style={{ textAlign: 'left' }}>Card Name</th>
                                                      <th style={{ textAlign: 'right' }}>Quantity</th>
                                                      <th style={{ textAlign: 'right' }}>Odds</th>
                                                  </tr>
                                              </thead>
                                              <tbody>
                                                  <tr>
                                                      <td>{likeCardName || '—'}</td>
                                                      <td style={{ textAlign: 'right' }}>{Number(likeQty) || 0}</td>
                                                      <td style={{ textAlign: 'right' }}>{(likeOdds * 100).toFixed(2)}%</td>
                                                  </tr>
                                              </tbody>
                                          </table>
                                      </div>

                                  </div>
                              </div>
                          </div>
                      </div>
                  </div>,
                  document.body
              )}

              {stackOpen && createPortal(
                  <div className="modal-backdrop" onClick={() => setStackOpen(false)} role="none">
                      <div
                          className="modal-window modal-stack"
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="stackview-title"
                          onClick={(e) => e.stopPropagation()}
                      >
                          <div className="modal-header">
                              <h2 id="stackview-title">Stack View</h2>
                              <button
                                  className="modal-close"
                                  aria-label="Close Stack View"
                                  onClick={() => setStackOpen(false)}
                              >
                                  ×
                              </button>
                          </div>

                          <div className="modal-body">
                              {(() => {
                                  // Group by ConvertedCost → CardType (like Archidekt stacks)
                                  const buckets = new Map(); // key = number (ConvertedCost) or Infinity if blank
                                  for (const row of deckList) {
                                      const ccNum = Number(row.c?.ConvertedCost);
                                      const key = Number.isFinite(ccNum) ? ccNum : Infinity; // blank/NaN at the end
                                      if (!buckets.has(key)) buckets.set(key, []);
                                      buckets.get(key).push(row);
                                  }

                                  // Ordering helpers
                                  const typeIndex = new Map(typeOrder.map((t, i) => [t, i]));
                                  const byTypeThenName = (a, b) => {
                                      const ta = getTypeTag(a.c), tb = getTypeTag(b.c);
                                      const ia = typeIndex.get(ta) ?? 999, ib = typeIndex.get(tb) ?? 999;
                                      if (ia !== ib) return ia - ib;
                                      return (a.c?.CardName || '').localeCompare(b.c?.CardName || '');
                                  };

                                  const sortedCosts = Array.from(buckets.keys()).sort((a, b) => a - b);

                                  return (
                                      <div className="stack-columns">
                                          {sortedCosts.map(cost => {
                                              const rowsSorted = buckets.get(cost).slice().sort(byTypeThenName);

                                              // group this cost column by CardType
                                              const groups = new Map();
                                              rowsSorted.forEach(r => {
                                                  const t = getTypeTag(r.c) || 'Other';
                                                  if (!groups.has(t)) groups.set(t, []);
                                                  groups.get(t).push(r);
                                              });
                                              const types = Array.from(groups.keys())
                                                  .sort((a, b) => (typeIndex.get(a) ?? 999) - (typeIndex.get(b) ?? 999));

                                              const colTotal = rowsSorted.reduce((s, r) => s + (r.qty || 0), 0);

                                              return (
                                                  <div key={`cc_${String(cost)}`} className="stack-col">
                                                      <div className="stack-col-header">
                                                          CC {Number.isFinite(cost) ? cost : '—'} <span className="small">({colTotal})</span>
                                                      </div>

                                                      {types.map(type => (
                                                          <div key={type} className="stack-type">
                                                              <div className="stack-type-title">{type}</div>
                                                              <div className="stack-type-cards">
                                                                  {groups.get(type).map(row => {
                                                                      const id = row.id;
                                                                      const qty = row.qty;
                                                                      const c = row.c;
                                                                      // show back image when flipped (same behavior as gallery)
                                                                      const backId = backIdFor(id);
                                                                      const backCard = allById.get(backId) || null;
                                                                      const showingBack = !!flipped[id];
                                                                      const imgProps = showingBack
                                                                          ? (backCard
                                                                              ? { src: primaryImg(backId), onError: makeImgErrorHandler(backId) }
                                                                              : { src: defaultBack })
                                                                          : { src: primaryImg(id), onError: makeImgErrorHandler(id) };

                                                                      // current src for zoom modal + name
                                                                      const currentImgSrc = showingBack
                                                                          ? (backCard ? primaryImg(backId) : defaultBack)
                                                                          : primaryImg(id);
                                                                      const displayName = (showingBack && backCard?.CardName)
                                                                          ? backCard.CardName
                                                                          : (c?.CardName || id);

                                                                      return (
                                                                          <div
                                                                              key={id}
                                                                              className="stack-card"
                                                                              title="Click to add 1 • Right-click to flip"
                                                                              onClick={(e) => { e.stopPropagation(); add(id, +1); }}
                                                                              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); flipCard(id); }}
                                                                          >
                                                                              {qty > 0 && (
                                                                                  <div
                                                                                      className="deck-badge"
                                                                                      title="Click to remove 1 from deck"
                                                                                      onClick={(e) => { e.stopPropagation(); add(id, -1); }}
                                                                                  >
                                                                                      {qty}
                                                                                  </div>
                                                                              )}

                                                                              {/* 🔍 Zoom button (top-right over the image) */}
                                                                              <button
                                                                                  className="zoom-btn"
                                                                                  title="Zoom card art"
                                                                                  onClick={(e) => { e.stopPropagation(); openZoom(currentImgSrc, displayName, id); }}
                                                                                  onPointerDown={(e) => e.stopPropagation()}
                                                                              >
                                                                                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                                                                                      <path
                                                                                          fill="currentColor"
                                                                                          d="M10 2a8 8 0 105.293 14.293l4.707 4.707 1.414-1.414-4.707-4.707A8 8 0 0010 2zm0 2a6 6 0 110 12A6 6 0 0110 4z"
                                                                                      />
                                                                                  </svg>
                                                                              </button>

                                                                              <img className="stack-art" alt={displayName} {...imgProps} />
                                                                              <div className="stack-name small">{displayName}</div>
                                                                          </div>
                                                                      );
                                                                  })}
                                                              </div>
                                                          </div>
                                                      ))}
                                                  </div>
                                              );
                                          })}
                                      </div>
                                  );
                              })()}
                          </div>
                      </div>
                  </div>,
                  document.body
              )}
              {/* moved to plugin: /src/plugins/help-section.jsx (<Card Types>) */}
              {/* moved to plugin: /src/plugins/help-section.jsx (<Board Layout>) */}
              {/* moved to plugin: /src/plugins/help-section.jsx (<FAQ>) */}
              <h3 className="section-title">Deck Actions</h3>
              <div className="row">
                  <button
                      className="deck-action-btn"
                      onClick={() => setStackOpen(true)}
                      disabled={deckCount === 0}
                      title={deckCount === 0 ? 'Add cards to view stacks' : 'View deck in stack layout'}
                  >
                      Stack View
                  </button>
                  <button
                      className="deck-action-btn"
                      onClick={() => setStatsOpen(true)}
                      disabled={deckCount === 0}
                      title={deckCount === 0 ? 'Add cards to see stats' : 'View deck statistics'}
                  >
                      Deck Stats
                  </button>
                  <button className="deck-action-btn" onClick={onClearDeck}>Clear</button>
              </div>

        <h3 className="section-title">Load/Save Options</h3>

        {/* Actions */}

              <div style={{ marginTop: 8 }} className="row file-row">
                  <input
                      id="import-file"
                      ref={fileRef}
                      type="file"
                      accept=".json,.csv"
                      onChange={(e) => {
                          const f = e.target.files?.[0];
                          setImportFileName(f?.name || '');
                          handleImport(f);
                      }}
                      className="file-input-visually-hidden"
                  />
                  <label htmlFor="import-file" className="deck-action-btn">Load File</label>

                  <span className="file-name" style={{ marginLeft: 8 }}>
                      {importFileName || 'No file chosen'}
                  </span>

                  {/* Save button shows only after a file has been loaded */}
                  {importFileName ? (
                      <label
                          className="deck-action-btn"
                          onClick={async () => { await saveLoadedFile(); }}
                          title={`Save (${importFileName.split('.').pop()?.toUpperCase()})`}
                          style={{ marginLeft: 8 }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  saveLoadedFile();
                              }
                          }}
                      >
                          Save
                      </label>
                  ) : null}
              </div>

        <div style={{marginTop:12}} className="row">
                  <button className="deck-action-btn" onClick={exportJSON}>Export JSON</button>
                  <button className="deck-action-btn" onClick={exportCSV}>Export CSV</button>
        </div>

              {/* Floating deck preview tooltip (rendered to <body>) */}
              {deckPreview.show && deckPreview.id && createPortal((() => {
                  const pc = allById.get(deckPreview.id)
                  if (!pc) return null
                  return (
                      <div
                          className="deck-preview-float"
                          style={{ left: deckPreview.x + 'px', top: deckPreview.y + 'px', pointerEvents: 'none' }}
                          aria-hidden="true"
                      >
                          <img
                              className="deck-preview-img"
                              src={primaryImg(pc.InternalName)}
                              alt={pc.CardName}
                              onError={makeImgErrorHandler(pc.InternalName)}
                              data-tried=""
                              draggable={false}
                          />
                          <div className="deck-preview-meta">
                              <div className="name">{pc.CardName}</div>
                              <div className="line">
                                  <span className="badge">{pc.Rarity}</span>
                                  <span className="badge">{pc.CardType}</span>
                                  <span className="badge">
                                      {[pc.ElementType1, pc.ElementType2, pc.ElementType3].filter(Boolean).join(' / ') || 'Neutral'}
                                  </span>
                                  <span className="badge">CC {pc.ConvertedCost}</span>
                              </div>
                              {pc.CardText && <div className="text small">{pc.CardText}</div>}
                          </div>
                      </div>
                  )
              })(), document.body)}
              {createPortal(
                  <div className="toast-wrap" aria-live="polite" aria-atomic="true">
                      {toasts.map(t => (
                          <div key={t.id} className={`toast ${t.type || 'info'}`}>
                              <span className="toast-msg">{t.message}</span>
                              <button
                                  className="toast-x"
                                  onClick={() => dismissToast(t.id)}
                                  aria-label="Dismiss"
                                  title="Dismiss"
                              >
                                  ×
                              </button>
                          </div>
                      ))}
                  </div>,
                  document.body
              )}
              {edgeEnabled && createPortal(
                  <div className="edge-scroll" ref={edgeRailRef} onPointerDown={onEdgePointerDown} role="scrollbar" aria-label="Page scroll">
                      <div className="edge-track"></div>
                      <div className="edge-thumb" ref={edgeThumbRef} />
                  </div>,
                  document.body
              )}
      </aside>
    </div>
   </div>
  )
}