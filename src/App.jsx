import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// ====== Simple Canvas Charts (no external libs) ======

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

        // 1) draw slices
        data.forEach((d, i) => {
            const val = Number(d.value) || 0;
            if (val <= 0) return;
            const ang = (val / total) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.fillStyle = colors[i % colors.length];
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

  // Tips & Features collapsed/expanded
  const [tipsOpen, setTipsOpen] = useState(false); // start collapsed to save space

    // Keywords modal + data
    const [keywordsOpen, setKeywordsOpen] = useState(false);
    const [keywords, setKeywords] = useState([]);

    // Effect Icons modal + data
    const [iconsOpen, setIconsOpen] = useState(false);
    const [icons, setIcons] = useState([]);

    // Element Chart modal + data
    const [elementsOpen, setElementsOpen] = useState(false);
    const [elements, setElements] = useState([]);

    // Turn Structure modal
    const [turnOpen, setTurnOpen] = useState(false);

    // Deck Stats modal
    const [statsOpen, setStatsOpen] = useState(false);

    // Stack View modal
    const [stackOpen, setStackOpen] = useState(false);

    // Probabilities controls (hypergeometric inputs)
    const [probCond, setProbCond] = useState('At Least'); // Condition
    const [probQtyInput, setProbQtyInput] = useState('1');        // Quantity (k)
    const [probHandInput, setProbHandInput] = useState('7');        // Hand Size (n)
    const [probDeckInput, setProbDeckInput] = useState('');         // Deck Size (N)

    // near other modal booleans
    const [layoutOpen, setLayoutOpen] = useState(false);

    // Collapsible Filters
    const [filtersCollapsed, setFiltersCollapsed] = useState(false);
    const [helpCollapsed, setHelpCollapsed] = useState(false);

    // Modal search queries
    const [keywordsQuery, setKeywordsQuery] = useState('');
    const [iconsQuery, setIconsQuery] = useState('');
    const [elementsQuery, setElementsQuery] = useState('');


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
        TurnStructure: [],
        Tips: [],
        CardLayout: null    // NEW
    })

    // NEW: formats.json controls rarity caps & deck size behavior per Format ID
    const [formatsConfig, setFormatsConfig] = useState({});

    // Selected format (IDs come from reference.json -> Format). Fallback to two defaults.
    const [formatId, setFormatId] = useState('Freeform');

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

    
  // existing filters
  const [q, setQ] = useState('')
  const [rarity, setRarity] = useState('Any Rarity')
  const [ccMin, setCcMin] = useState('')
  const [ccMax, setCcMax] = useState('')
  const [setFilter, setSetFilter] = useState('Any Set')

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

        const isPartnerCard = String(card?.CardType || '').trim().toLowerCase() === 'partner';
        if (isPartnerCard) return Number.isFinite(rc?.Partner) ? rc.Partner : 1;

        const r = (card?.Rarity || '').trim();
        if (!r || r === 'Basic') return Infinity;      // Basic has no cap unless you define it
        const cap = rc?.[r];
        return Number.isFinite(cap) ? cap : Infinity;
    };

    // Find the single Partner card currently in the deck (if any)
    const getPartnerInDeck = () => {
        for (const id of Object.keys(deck)) {
            const c = getById(id)
            if (isPartner(c) && (deck[id] ?? 0) > 0) return c
        }
        return null
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

    // Reset every filter back to its initial/empty state
    const resetFilters = React.useCallback(() => {
        setEl1(''); setOp1(''); setEl2(''); setOp2(''); setEl3(''); setOp3('');
        setSup1(''); setSop1('');
        setTyp1(''); setTop1(''); setTyp2(''); setTop2('');
        setSub1(''); setTbop1('');
        setQ(''); setRarity('Any Rarity'); setSetFilter('Any Set');
        setCcMin(''); setCcMax(''); setCostStr('');
        setAtkMin(''); setAtkMax(''); setDefMin(''); setDefMax(''); setHpMin(''); setHpMax('');
    }, []);

    // Click handler for the Clear Filters button
    const onClearFilters = () => {
        if (!window.confirm('Clear all filters and switch to Cards?')) return;
        setActiveDataset(DATASETS.CARDS);
        resetFilters();
    };

  // added filters
  const [costStr, setCostStr] = useState('')

  // NEW: Show only cards that are allowable with the selected Partner
  const [allowOnly, setAllowOnly] = useState(false);

  // NEW: min/max bounds for stats
  const [atkMin, setAtkMin] = useState('')
  const [atkMax, setAtkMax] = useState('')
  const [defMin, setDefMin] = useState('')
  const [defMax, setDefMax] = useState('')
  const [hpMin,  setHpMin]  = useState('')
  const [hpMax,  setHpMax]  = useState('')

  // Deck state
  const [deck, setDeck] = useState({})
  const [deckName, setDeckName] = useState('')
  const [showNameInput, setShowNameInput] = useState(false)
  const nameRef = useRef(null)
  const fileRef = useRef(null)
  const [importFileName, setImportFileName] = useState('')
  const [importFileHandle, setImportFileHandle] = useState(null) // for overwriting via File System Access API

    // ADD THIS:
    const deckCountRef = useRef(0)

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
    const positionPreviewNearCursor = React.useCallback((e) => {
        const rect =
            e.currentTarget.closest?.('.deckRow')?.getBoundingClientRect?.() ||
            e.currentTarget.getBoundingClientRect()

        const vw = window.innerWidth
        const vh = window.innerHeight
        const offset = PREVIEW_OFFSET

        let x = e.clientX + offset
        let y = e.clientY + offset

        const inButtonZone = !!(rect && e.clientX > rect.right - 80) // 80px safety
        const forceLeft = previewLockLeftRef.current || inButtonZone

        if (forceLeft) {
            x = e.clientX - PREVIEW_W - offset
            if (x < 8 && rect) x = rect.left - PREVIEW_W - offset
        }

        // Clamp to viewport
        if (x + PREVIEW_W > vw) x = e.clientX - PREVIEW_W - offset
        if (y + PREVIEW_H > vh) y = e.clientY - PREVIEW_H - offset
        if (x < 8) x = 8
        if (y < 8) y = 8

        setDeckPreview(prev => ({ ...prev, x, y, show: true }))
    }, [])

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
                        TurnStructure: Array.isArray(jTypes?.TurnStructure) ? jTypes.TurnStructure : [],
                        Tips: Array.isArray(jTypes?.Tips) ? jTypes.Tips : [],  // NEW
                        CardLayout: jTypes?.CardLayout || null
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
        if (deckPreview.show && deckPreview.id && !deck[deckPreview.id]) {
            setDeckPreview({ id: null, x: 0, y: 0, show: false })
        }
    }, [deck, deckPreview.show, deckPreview.id])

    // Global keyboard shortcuts for help modals
    useEffect(() => {
        const onKey = (e) => {
            const tag = (e.target?.tagName || '').toLowerCase();
            const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
            if (isTyping) return;

            const open = (setter, reset) => { setter(true); reset?.(''); };

            if (e.key === 'Escape') {
                if (tipsOpen) setTipsOpen(false);
                if (keywordsOpen) setKeywordsOpen(false);
                if (iconsOpen) setIconsOpen(false);
                if (elementsOpen) setElementsOpen(false);
                if (turnOpen) setTurnOpen(false);
                if (layoutOpen) setLayoutOpen(false);
                if (statsOpen) setStatsOpen(false);     // NEW: close Deck Stats
                if (statsOpen) setStatsOpen(false);     // close Deck Stats
                if (stackOpen) setStackOpen(false);     // close Stack View
                return;
            }

            const k = e.key.toLowerCase();
            switch (k) {
                case '?':
                    open(setTipsOpen);
                    break;
                case '/':
                    if (e.shiftKey) { open(setTipsOpen); }
                    break;
                case 'h':
                    open(setTipsOpen);
                    break;
                case 'k':
                    open(setKeywordsOpen, setKeywordsQuery);
                    break;
                case 'i':
                    open(setIconsOpen, setIconsQuery);
                    break;
                case 'e':
                    open(setElementsOpen, setElementsQuery);
                    break;
                case 't':
                    open(setTurnOpen);
                    break;
                case 'l':
                    open(setLayoutOpen);
                    break;
                case 's':
                    // NEW: only open Deck Stats if the deck has cards
                    if (deckCountRef.current > 0) {
                        setStatsOpen(true);
                    }
                    break;
                case 'v':
                    // Toggle Stack View if the deck has cards
                    if (deckCountRef.current > 0) {
                        setStackOpen(prev => !prev);
                    }
                    break;
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [
        tipsOpen, keywordsOpen, iconsOpen, elementsOpen, turnOpen, layoutOpen, statsOpen, stackOpen // added statsOpen
    ]);

    const rawData = useMemo(() => {
        switch (activeDataset) {
            case DATASETS.PARTNERS: return partners
            case DATASETS.TOKENS: return tokens
            default: return cards
        }
    }, [activeDataset, cards, partners, tokens])

    const allById = useMemo(() => {
        const m = new Map()
        for (const c of cards) m.set(c.InternalName, c)
        for (const c of partners) m.set(c.InternalName, c)
        for (const c of tokens) m.set(c.InternalName, c)
        return m
    }, [cards, partners, tokens])

    const getById = useCallback((id) => allById.get(id) ?? null, [allById])

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
        ccMin, ccMax, q, costStr,
        atkMin, atkMax, defMin, defMax, hpMin, hpMax,
        setFilter,
        getAllowedSetsForFormat
    ])


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
        if (allowOnly) {
            return out.filter(card => !isOffElementForPartner(card))
        }
        return out
    }, [filtered, rawData, allowOnly, isOffElementForPartner])

  // ---- Add/remove to deck ----
    const add = useCallback((id, delta = 1) => {
        const frontId = normalizeToFront(id)
        const card = getById(frontId)

        // ❌ Block tokens entirely
        if (isToken(card)) return

        // ✅ Enforce: total Partners allowed by selected format (formats.json → rarityCap.Partner)
        if (isPartner(card) && delta > 0) {
            const rc = getRarityCapMap();                          // pulls from formats.json for current formatId
            const partnerCap = Number.isFinite(rc?.Partner) ? rc.Partner : 1;
            const currentPartnerTotal = Object.entries(deck).reduce((s, [k, q]) => {
                const kc = getById(k);
                return s + (isPartner(kc) ? (q || 0) : 0);
            }, 0);
            if (currentPartnerTotal >= partnerCap) {
                alert(`Only ${partnerCap} Partner${partnerCap === 1 ? '' : 's'} allowed in this format.`);
                return;
            }
        }

        // 🚫 Block adding off-element cards when a Partner is chosen
        if (delta > 0 && isOffElementForPartner(card)) {
            alert('That card has an element not allowed by your selected Partner.');
            return;
        }

        // ✅ Enforce DeckSize based on current Partner
        if (delta > 0) {
            const deckSizeLimit = getDeckSizeLimit()
            const currentTotal = getDeckCount()
            if (Number.isFinite(deckSizeLimit) && currentTotal >= deckSizeLimit) {
                alert(`Deck is full (${deckSizeLimit} cards). Remove a card before adding more.`)
                return
            }
        }

        // Auto-create a deck the first time the user adds a card.
        if (delta > 0 && !showNameInput && Object.keys(deck).length === 0) {
            setShowNameInput(true)
            setDeckName((n) => n || 'New Deck')
            setTimeout(() => nameRef.current?.focus(), 0)
        }

        const cap = cardCap(card)

        let removedId = null
        setDeck(prev => {
            const next = { ...prev }

            // migrate any legacy _b count into the front
            const backId = frontId.replace(/_a$/, '_b')
            if (next[backId]) {
                next[frontId] = (next[frontId] ?? 0) + next[backId]
                delete next[backId]
            }

            const cur = next[frontId] ?? 0

            // Block going over per-card cap
            if (delta > 0 && cur >= cap) {
                if (Number.isFinite(cap)) {
                    alert(`Limit reached: ${cap} cop${cap === 1 ? 'y' : 'ies'} for ${card?.Rarity || 'this rarity'}.`)
                }
                return prev
            }

            // Apply change (also re-check deck size if needed)
            const deckSizeLimit = getDeckSizeLimit()
            const currentTotal = Object.entries(next).reduce((s, [cid, q]) => {
                const cc = getById(cid)
                if (!cc) return s
                if (isToken(cc)) return s
                if (isPartner(cc)) return s       // <-- ignore the Partner
                return s + (q || 0)
            }, 0)

            const increment = delta > 0 ? 1 : (delta < 0 ? -1 : 0)
            if (delta > 0 && Number.isFinite(deckSizeLimit) && currentTotal >= deckSizeLimit) {
                return prev
            }

            const newCount = Math.max(0, Math.min(cur + delta, cap))
            if (newCount <= 0) {
                delete next[frontId]
                removedId = frontId
            } else {
                // If adding 1 would overflow deck size, block
                if (delta > 0 && Number.isFinite(deckSizeLimit) && (currentTotal + 1) > deckSizeLimit) {
                    return prev
                }
                next[frontId] = newCount
            }
            return next
        })

        if (removedId) {
            clearPreviewIf(h => h?.id === removedId)
        }
    }, [normalizeToFront, getById, showNameInput, deck, setShowNameInput, setDeckName, clearPreviewIf, getRarityCapMap])


    // Use CardType if present, otherwise fall back to SuperType (e.g., "Token"), otherwise "Other"
    const getTypeTag = (c) =>
        (c?.CardType && String(c.CardType).trim()) ||
        (c?.SuperType && String(c.SuperType).trim()) ||
        'Other'

    // Which card types are actually present in the current deck?
    const presentTypes = useMemo(() => {
        const ids = Object.keys(deck)
        const set = new Set()
        for (const id of ids) {
            const c = getById(id)
            const tag = getTypeTag(c)
            if (tag) set.add(tag)
        }
        return Array.from(set)
    }, [deck, getById])

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
        const list = Object.entries(deck).map(([id, qty]) => {
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
    }, [deck, typeOrder, getById])

  // ---- Deck actions ----
  const onNewDeck = () => {
    if (!confirmDanger('Start a new deck? This will clear the deck name and all cards.')) return
    setDeck({})
    setDeckName('')
    setShowNameInput(true)  // keep the name box up for immediate typing
    if (fileRef.current) fileRef.current.value = ''
    setTimeout(()=> nameRef.current?.focus(), 0)
  }

    const onClearDeck = () => {
        if (!confirmDanger('Clear this deck? This will remove the deck name and all cards.')) return
        setDeck({})
        setDeckName('')
        setShowNameInput(false) // restore New Deck button
        setFormatId('Freeform') // reset format filter
        if (fileRef.current) fileRef.current.value = ''
        setImportFileName('')   // also clear the "Load File" label
    }

  const exportJSON = () => {
    const payload = { name: deckName || 'New Deck', formatId, list: deck }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${(deckName || 'deck').replace(/[^\w\-]+/g,'_')}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const exportCSV = () => {
    const rows = ['InternalName,Qty,FormatId'].concat(
        deckList.map(r => `${r.id},${r.qty},${formatId}`)
    ).join('\n')
    const blob = new Blob([rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${(deckName || 'deck').replace(/[^\w\-]+/g,'_')}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

    // ADD BELOW exportCSV and ABOVE handleImport
    const saveLoadedFile = async () => {
        const nameFromDeck = (deckName || 'deck').replace(/[^\w\-]+/g, '_');
        const lower = (importFileName || '').toLowerCase();
        const ext = lower.endsWith('.csv') ? 'csv' : (lower.endsWith('.json') ? 'json' : 'json');

        // Build content once
        const csvRows = ['InternalName,Qty,FormatId'].concat(
            deckList.map(r => `${r.id},${r.qty},${formatId}`)
        ).join('\n');
        const jsonPayload = JSON.stringify({ name: deckName || 'New Deck', formatId, list: deck }, null, 2);
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
              const input = (data.list && typeof data.list === 'object') ? data.list : data
              const normalized = {}
              for (const [rawId, qty] of Object.entries(input)) {
                  const frontId = normalizeToFront(rawId)
                  const nQty = Math.max(0, Number(qty) || 0)
                  if (nQty > 0) normalized[frontId] = (normalized[frontId] ?? 0) + nQty
              }
              setDeck(normalized)
              setDeckName(typeof data.name === 'string' ? data.name : '')
              if (typeof data.formatId === 'string') setFormatId(data.formatId)
              setShowNameInput(true)
          }
      } else if (file.name.toLowerCase().endsWith('.csv')) {
          const lines = text.trim().split(/\r?\n/)
          const map = {}
          for (let i = 1; i < lines.length; i++) {
              const [id, qty] = lines[i].split(',')
              if (!id) continue
              const frontId = normalizeToFront(id.trim())
              const nQty = Math.max(0, Number((qty ?? '').trim()) || 0)
              if (nQty > 0) map[frontId] = (map[frontId] ?? 0) + nQty
          }
          setDeck(map)
        // CSV has no canonical name; keep existing or empty
        setShowNameInput(true)
      }
    } catch (e) {
      alert('Failed to import deck: ' + e.message)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

    // Count current cards in the deck (tokens never get into the deck UI already)
    const getDeckCount = () => {
        let total = 0;
        for (const [id, qty] of Object.entries(deck)) {
            const c = getById(id);
            if (!c) continue;
            if (isToken(c)) continue;
            if (isPartner(c)) continue; // ignore the Partner
            total += qty || 0;
        }
        return total;
    };

    // ---- Deck Statistics (excluding Partner and Tokens) ----
    const deckStats = useMemo(() => {
        const partner = getPartnerInDeck();
        const partnerId = partner?.InternalName || null;

        // rows = deck entries we actually count
        const rows = [];
        for (const [id, qty] of Object.entries(deck)) {
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

        return {
            types: toArr(typeMap),
            rarities: toArr(rarityMap),
            elements: toArr(elementMap),
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
    }, [deck, getById, elements]);

    // (now the original three lines)
    const deckSizeLimit = getDeckSizeLimit();
    const deckCount = getDeckCount();
    const isDeckFull = Number.isFinite(deckSizeLimit) && deckCount >= deckSizeLimit;

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
              <div className="controls">
                  <span className="label small filter-label">Cost</span>
                  <input className="filter-input" placeholder="Min CC" value={ccMin} onChange={e => setCcMin(e.target.value)} />
                  <input className="filter-input" placeholder="Max CC" value={ccMax} onChange={e => setCcMax(e.target.value)} />
              </div>

        {/* ATK bounds */}
              <div className="controls">
                  <span className="label small filter-label">ATK</span>
                  <input className="filter-input" placeholder="Min" value={atkMin} onChange={e => setAtkMin(e.target.value)} />
                  <input className="filter-input" placeholder="Max" value={atkMax} onChange={e => setAtkMax(e.target.value)} />
              </div>

        {/* DEF bounds */}
              <div className="controls">
                  <span className="label small filter-label">DEF</span>
                  <input className="filter-input" placeholder="Min" value={defMin} onChange={e => setDefMin(e.target.value)} />
                  <input className="filter-input" placeholder="Max" value={defMax} onChange={e => setDefMax(e.target.value)} />
              </div>

        {/* HP bounds */}
              <div className="controls">
                  <span className="label small filter-label">HP</span>
                  <input className="filter-input" placeholder="Min" value={hpMin} onChange={e => setHpMin(e.target.value)} />
                  <input className="filter-input" placeholder="Max" value={hpMax} onChange={e => setHpMax(e.target.value)} />
              </div>

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
                      onClick={onClearFilters}
                      title="Clear all filters"
                      style={{ marginLeft: 8 }}
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
                  {/* 2-per-row layout for Help buttons */}
                  <div
                      style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                          columnGap: 8,
                          rowGap: 0,
                          marginTop: 8
                      }}
                  >
                      <div className="controls" style={{ marginTop: 0 }}>
                          <button
                              type="button"
                              className="tips-btn"
                              style={{ width: '100%', whiteSpace: 'nowrap' }}
                              onClick={() => setTipsOpen(true)}
                              aria-haspopup="dialog"
                              aria-expanded={tipsOpen}
                          >
                              Tips &amp; Features
                          </button>
                      </div>

                      <div className="controls" style={{ marginTop: 0 }}>
                          <button
                              type="button"
                              className="tips-btn"
                              style={{ width: '100%', whiteSpace: 'nowrap' }}
                              onClick={() => { setKeywordsQuery(''); setKeywordsOpen(true); }}
                              aria-haspopup="dialog"
                              aria-expanded={keywordsOpen}
                              title="Shortcut: K"
                          >
                              Keywords
                          </button>
                      </div>

                      <div className="controls" style={{ marginTop: 0 }}>
                          <button
                              type="button"
                              className="tips-btn"
                              style={{ width: '100%', whiteSpace: 'nowrap' }}
                              onClick={() => { setIconsQuery(''); setIconsOpen(true); }}
                              aria-haspopup="dialog"
                              aria-expanded={iconsOpen}
                              title="Shortcut: I"
                          >
                              Effect Icons
                          </button>
                      </div>

                      <div className="controls" style={{ marginTop: 0 }}>
                          <button
                              type="button"
                              className="tips-btn"
                              style={{ width: '100%', whiteSpace: 'nowrap' }}
                              onClick={() => { setElementsQuery(''); setElementsOpen(true); }}
                              aria-haspopup="dialog"
                              aria-expanded={elementsOpen}
                              title="Shortcut: E"
                          >
                              Element Chart
                          </button>
                      </div>

                      <div className="controls" style={{ marginTop: 0 }}>
                          <button
                              type="button"
                              className="tips-btn"
                              style={{ width: '100%', whiteSpace: 'nowrap' }}
                              onClick={() => setTurnOpen(true)}
                              aria-haspopup="dialog"
                              aria-expanded={turnOpen}
                          >
                              Turn Structure
                          </button>
                      </div>

                      <div className="controls" style={{ marginTop: 0 }}>
                          <button
                              type="button"
                              className="tips-btn"
                              style={{ width: '100%', whiteSpace: 'nowrap' }}
                              onClick={() => setLayoutOpen(true)}
                              aria-haspopup="dialog"
                              aria-expanded={layoutOpen}
                          >
                              Card Layout
                          </button>
                      </div>
                  </div>

                  {/* keep your stacked shortcuts block below, unchanged */}
                  <div className="controls" style={{ marginTop: 10 }}>
                      <div className="small">
                          <strong>Keyboard shortcuts:</strong>
                          <div>? or Shift+/ or H — Tips &amp; Features</div>
                          <div>K — Keywords</div>
                          <div>I — Effect Icons</div>
                          <div>E — Element Chart</div>
                          <div>T — Turn Structure</div>
                          <div>L — Card Layout</div>
                          <div>S — Deck Stats</div>
                          <div>V — Toggle Stack View</div>
                          <div>Esc — Close modals</div>
                      </div>
                  </div>
              </div>
      </aside>

      {/* GRID */}
      <main className="grid">
              {gallery.map(c => {
                  const id = c.InternalName
                  const qty = deck[id] ?? 0
                  const cap = cardCap(c)
                  const atCap = Number.isFinite(cap) && qty >= cap
                  const inDeck = qty > 0
                  const isTokenCard = isToken(c) // ⬅ NEW
                  const isPartnerCard = isPartner(c)
                  const offElement = isOffElementForPartner(c); // NEW
                  const rc = getRarityCapMap();
                  const partnerCap = Number.isFinite(rc?.Partner) ? rc.Partner : 1;
                  const partnerTotal = isPartnerCard
                      ? Object.entries(deck).reduce((s, [k, q]) => s + (isPartner(getById(k)) ? (q || 0) : 0), 0)
                      : 0;
                  const partnerCapReached = isPartnerCard && partnerTotal >= partnerCap;

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
                      <div key={id} className={`card ${inDeck ? 'in-deck' : ''}`}>
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
                                      alert('That card has an element not allowed by your selected Partner.')
                                      return
                                  }
                                  if (isDeckFull) {
                                      alert(`Deck is full (${deckSizeLimit} cards). Remove a card before adding more.`)
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

                          <h4>{displayCard.CardName}</h4>
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
                                      disabled={partnerCapReached || atCap || isDeckFull || offElement}
                                      title={
                                          partnerCapReached
                                              ? `Only ${partnerCap} Partner${partnerCap === 1 ? '' : 's'} allowed`
                                              : offElement
                                                  ? 'Off-element for current Partner'
                                                  : isDeckFull
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
      </main>

      {/* RIGHT: DECK PANEL */}
      <aside className="right" style={{ marginLeft: 0 }}>

              <h3 className="section-title">Format</h3>

              {/* Format selector */}
              <div className="controls" style={{ marginBottom: 8 }}>
                  <select value={formatId} onChange={(e) => setFormatId(e.target.value)}>
                      {(refData.Format?.length ? refData.Format : ['Freeform', 'Standard'])
                          .map(f => (<option key={f} value={f}>{f}</option>))}
                  </select>
              </div>
        <h3 className="section-title">Deck</h3>

        {/* Name area */}
        {!showNameInput ? (
          <div className="row" style={{marginBottom:8}}>
            <button onClick={onNewDeck}>New Deck</button>
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
                              onClick={() => {
                                  if (!confirmDanger('Cancel and clear the current deck? This will remove the deck name and all cards.')) return
                                  setDeck({})
                                  setDeckName('')
                                  setFormatId('Freeform') // reset format filter
                                  setShowNameInput(false)
                                  if (fileRef.current) fileRef.current.value = ''
                                  setImportFileName('')        // NEW: reset displayed file name & hide Save button
                                  setImportFileHandle(null)    // NEW: drop any existing file handle
                              }}
                              title="Cancel and clear deck"
                          >
                              Cancel
                          </button>

          </div>
        )}

              <div className="small">
                  Cards: {getDeckCount()}
                  {(() => {
                      const lim = getDeckSizeLimit()
                      return Number.isFinite(lim) ? ` / ${lim}` : ''
                  })()}
              </div>

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
                                          const warnNotAllowed = notAllowed || offElement;

                                          return (
                                              <div
                                                  key={row.id}
                                                  className={`deckRow ${warnNotAllowed ? 'not-allowed' : ''}`}
                                                  title={
                                                      warnNotAllowed
                                                          ? [
                                                              notAllowed ? 'Not legal in the selected format' : null,
                                                              offElement ? 'Off-element for current Partner' : null
                                                          ].filter(Boolean).join(' • ')
                                                          : undefined
                                                  }
                                                  onMouseEnter={(e) => {
                                                      positionPreviewNearCursor(e);
                                                      setDeckPreview(prev => ({ ...prev, id: row.id, show: true }));
                                                  }}
                                                  onMouseLeave={() => {
                                                      setDeckPreview(prev => ({ ...prev, show: false }));
                                                  }}
                                                  onMouseMove={(e) => {
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
                                                          if (!(atCap || isDeckFull || offElement)) {
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
                                                          {(notAllowed || offElement) && (
                                                              <span className="badge warn" style={{ marginLeft: 6 }}>
                                                                  {[
                                                                      notAllowed ? 'Not in format' : null,
                                                                      offElement ? 'Off element' : null
                                                                  ].filter(Boolean).join(' • ')}
                                                              </span>
                                                          )}
                                                      </div>
                                                  </div>

                                                  <div
                                                      className="qty"
                                                      onMouseEnter={(e) => { previewLockLeftRef.current = true; positionPreviewNearCursor(e); }}
                                                      onMouseMove={(e) => { positionPreviewNearCursor(e); }}
                                                      onMouseLeave={() => { previewLockLeftRef.current = false; }}
                                                      onMouseDown={(e) => {
                                                          previewLockLeftRef.current = true;
                                                          e.preventDefault();
                                                          requestAnimationFrame(() => positionPreviewNearCursor(e));
                                                      }}
                                                      onMouseUp={(e) => {
                                                          requestAnimationFrame(() => positionPreviewNearCursor(e));
                                                      }}
                                                  >
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
                                                          disabled={atCap || isDeckFull || offElement}
                                                          title={
                                                              isDeckFull
                                                                  ? `Deck is full (${deckSizeLimit} cards)`
                                                                  : offElement
                                                                      ? 'Off-element for current Partner'
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

              {tipsOpen && createPortal(
                  <div
                      className="modal-backdrop"
                      onClick={() => setTipsOpen(false)}
                      role="none"
                  >
                      <div
                          className="modal-window"
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="tips-title"
                          onClick={(e) => e.stopPropagation()}
                      >
                          <div className="modal-header">
                              <h2 id="tips-title">Tips &amp; Features</h2>
                              <button
                                  className="modal-close"
                                  aria-label="Close Tips & Features"
                                  onClick={() => setTipsOpen(false)}
                              >
                                  ×
                              </button>
                          </div>

                          <div className="modal-body">
                              {Array.isArray(refData.Tips) && refData.Tips.length > 0 ? (
                                  <ul className="small">
                                      {refData.Tips.map((tip, i) => (
                                          <li key={i}>{tip}</li>
                                      ))}
                                  </ul>
                              ) : (
                                  <div className="small">No tips found. Add a top-level "Tips" array to reference.json.</div>
                              )}
                          </div>
                      </div>
                  </div>,
                  document.body
              )}

              {keywordsOpen && createPortal(
                  <div
                      className="modal-backdrop"
                      onClick={() => setKeywordsOpen(false)}
                      role="none"
                  >
                      <div
                          className="modal-window modal-keywords"
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="keywords-title"
                          onClick={(e) => e.stopPropagation()}
                      >
                          <div className="modal-header">
                              <h2 id="keywords-title">Keywords</h2>
                              <button
                                  className="modal-close"
                                  aria-label="Close Keywords"
                                  onClick={() => setKeywordsOpen(false)}
                              >
                                  ×
                              </button>
                          </div>

                          <div className="modal-body">
                              {keywords.length === 0 ? (
                                  <div className="small">No keywords found.</div>
                              ) : (
                                  <>
                                      <div className="modal-search">
                                          <input
                                              type="text"
                                              placeholder="Filter keywords (name, templating, rules, reminder). Shortcut: K"
                                              value={keywordsQuery}
                                              onChange={e => setKeywordsQuery(e.target.value)}
                                          />
                                      </div>
                                      <div className="keywords-table-wrap">
                                          <table className="keywords-table">
                                              <thead>
                                                  <tr>
                                                      <th>Name</th>
                                                      <th>Templating</th>
                                                      <th>Rules Text</th>
                                                      <th>Reminder Text</th>
                                                  </tr>
                                              </thead>
                                              <tbody>
                                                  {keywords
                                                      .filter(k => {
                                                          const q = keywordsQuery.trim().toLowerCase();
                                                          if (!q) return true;
                                                          const blob = [
                                                              k.DisplayName, k.TemplateName, k.RulesText, k.ReminderText
                                                          ].map(x => String(x || '').toLowerCase()).join(' ');
                                                          return blob.includes(q);
                                                      })
                                                      .map(k => (
                                                          <tr key={String(k.KeywordName || k.DisplayName || Math.random())}>
                                                              <td>{k.DisplayName ?? ''}</td>
                                                              <td>{k.TemplateName ?? ''}</td>
                                                              <td>{k.RulesText ?? ''}</td>
                                                              <td>{k.ReminderText ?? ''}</td>
                                                          </tr>
                                                      ))}
                                              </tbody>
                                          </table>
                                      </div>
                                  </>
                              )}
                          </div>
                      </div>
                  </div>,
                  document.body
              )}

              {elementsOpen && createPortal(
                  <div
                      className="modal-backdrop"
                      onClick={() => setElementsOpen(false)}
                      role="none"
                  >
                      <div
                          className="modal-window modal-elements"
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="elements-title"
                          onClick={(e) => e.stopPropagation()}
                      >
                          <div className="modal-header">
                              <h2 id="elements-title">Element Chart</h2>
                              <button
                                  className="modal-close"
                                  aria-label="Close Element Chart"
                                  onClick={() => setElementsOpen(false)}
                              >
                                  ×
                              </button>
                          </div>

                          <div className="modal-body">
                              {elements.length === 0 ? (
                                  <div className="small">No elements found.</div>
                              ) : (
                                  <>
                                      <div className="modal-search">
                                          <input
                                              type="text"
                                              placeholder="Filter elements (name, strong/weak lists). Shortcut: E"
                                              value={elementsQuery}
                                              onChange={e => setElementsQuery(e.target.value)}
                                          />
                                      </div>
                                      <div className="elements-table-wrap">
                                          <table className="elements-table">
                                              <thead>
                                                  <tr>
                                                      <th>Display Name</th>
                                                      <th>Image</th>
                                                      <th>Strong Against</th>
                                                      <th>Weak To</th>
                                                  </tr>
                                              </thead>
                                              <tbody>
                                                  {elements
                                                      .filter(el => {
                                                          const q = elementsQuery.trim().toLowerCase();
                                                          if (!q) return true;
                                                          const blob = [
                                                              el.DisplayName, el.InternalName,
                                                              ...(Array.isArray(el.StrongAgainst) ? el.StrongAgainst : []),
                                                              ...(Array.isArray(el.WeakTo) ? el.WeakTo : []),
                                                          ].map(x => String(x || '').toLowerCase()).join(' ');
                                                          return blob.includes(q);
                                                      })
                                                      .map(el => (
                                                          <tr key={String(el.InternalName || el.DisplayName || Math.random())}>
                                                              <td>{el.DisplayName ?? ''}</td>
                                                              <td className="elements-cell-img">
                                                                  {el.InternalName ? (
                                                                      <img
                                                                          className="element-img"
                                                                          src={getElementSrc(el.InternalName)}
                                                                          alt={el.DisplayName || el.InternalName}
                                                                          title={el.DisplayName || el.InternalName}
                                                                          data-tried="0"
                                                                          onError={makeElementImgErrorHandler(el.InternalName)}
                                                                          draggable={false}
                                                                      />
                                                                  ) : null}
                                                              </td>
                                                              <td className="elements-list-cell">{renderElementList(el.StrongAgainst)}</td>
                                                              <td className="elements-list-cell">{renderElementList(el.WeakTo)}</td>
                                                          </tr>
                                                      ))}
                                              </tbody>
                                          </table>
                                      </div>
                                  </>
                              )}
                          </div>
                      </div>
                  </div>,
                  document.body
              )}


              {iconsOpen && createPortal(
                  <div
                      className="modal-backdrop"
                      onClick={() => setIconsOpen(false)}
                      role="none"
                  >
                      <div
                          className="modal-window modal-icons"
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="icons-title"
                          onClick={(e) => e.stopPropagation()}
                      >
                          <div className="modal-header">
                              <h2 id="icons-title">Effect Icons</h2>
                              <button
                                  className="modal-close"
                                  aria-label="Close Effect Icons"
                                  onClick={() => setIconsOpen(false)}
                              >
                                  ×
                              </button>
                          </div>

                          <div className="modal-body">
                              {icons.length === 0 ? (
                                  <div className="small">No icons found.</div>
                              ) : (
                                  <>
                                      <div className="modal-search">
                                          <input
                                              type="text"
                                              placeholder="Filter icons (name, rules, search term). Shortcut: I"
                                              value={iconsQuery}
                                              onChange={e => setIconsQuery(e.target.value)}
                                          />
                                      </div>
                                      <div className="icons-table-wrap">
                                          <table className="icons-table">
                                              <thead>
                                                  <tr>
                                                      <th>Display Name</th>
                                                      <th>Image</th>
                                                      <th>Rules Text</th>
                                                      <th>Search Term</th>
                                                  </tr>
                                              </thead>
                                              <tbody>
                                                  {icons
                                                      .filter(ic => {
                                                          const q = iconsQuery.trim().toLowerCase();
                                                          if (!q) return true;
                                                          const blob = [
                                                              ic.DisplayName, ic.RulesText, ic.SearchTerm, ic.InternalName
                                                          ].map(x => String(x || '').toLowerCase()).join(' ');
                                                          return blob.includes(q);
                                                      })
                                                      .map(ic => (
                                                          <tr key={String(ic.InternalName || ic.DisplayName || Math.random())}>
                                                              <td>{ic.DisplayName ?? ''}</td>
                                                              <td className="icons-cell-img">
                                                                  {ic.InternalName ? (
                                                                      <img
                                                                          className="icon-img"
                                                                          src={getIconSrc(ic.InternalName)}
                                                                          alt={ic.DisplayName || ic.InternalName}
                                                                          data-tried="0"
                                                                          onError={makeIconErrorHandler(ic.InternalName)}
                                                                          draggable={false}
                                                                      />
                                                                  ) : null}
                                                              </td>
                                                              <td>{ic.RulesText ?? ''}</td>
                                                              <td>{ic.SearchTerm ?? ''}</td>
                                                          </tr>
                                                      ))}
                                              </tbody>
                                          </table>
                                      </div>
                                  </>
                              )}
                          </div>
                      </div>
                  </div>,
                  document.body
              )}

              {turnOpen && createPortal(
                  <div
                      className="modal-backdrop"
                      onClick={() => setTurnOpen(false)}
                      role="none"
                  >
                      <div
                          className="modal-window modal-turn"
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="turn-title"
                          onClick={(e) => e.stopPropagation()}
                      >
                          <div className="modal-header">
                              <h2 id="turn-title">Turn Structure</h2>
                              <button
                                  className="modal-close"
                                  aria-label="Close Turn Structure"
                                  onClick={() => setTurnOpen(false)}
                              >
                                  ×
                              </button>
                          </div>

                          <div className="modal-body">
                              {Array.isArray(refData.TurnStructure) && refData.TurnStructure.length > 0 ? (
                                  refData.TurnStructure.map((section) => (
                                      <section key={section.section || section.phase} className="turn-section">
                                          <div className="turn-section-title">
                                              {section.section || section.phase}
                                          </div>
                                          <ul className="turn-list">
                                              {(section.items || []).map((step) => (
                                                  <li key={step.name}>
                                                      <span className="turn-step-name">{step.name}:</span>{" "}
                                                      <span className="turn-step-desc">{step.desc}</span>

                                                      {Array.isArray(step.subitems) && step.subitems.length > 0 && (
                                                          <ul className="turn-sublist">
                                                              {step.subitems.map((sub) => (
                                                                  <li key={sub.name}>
                                                                      <span className="turn-step-name">{sub.name}:</span>{" "}
                                                                      <span className="turn-step-desc">{sub.desc}</span>
                                                                  </li>
                                                              ))}
                                                          </ul>
                                                      )}
                                                  </li>
                                              ))}
                                          </ul>
                                      </section>
                                  ))
                              ) : (
                                  <div className="small">No turn structure found. Add "TurnStructure" to reference.json.</div>
                              )}
                          </div>
                      </div>
                  </div>,
                  document.body
              )}

              {layoutOpen && createPortal(
                  <div className="modal-backdrop" onClick={() => setLayoutOpen(false)} role="none">
                      <div
                          className="modal-window modal-cardlayout"
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="cardlayout-title"
                          onClick={(e) => e.stopPropagation()}
                      >
                          <div className="modal-header">
                              <h2 id="cardlayout-title">Card Layout</h2>
                              <button className="modal-close" aria-label="Close Card Layout" onClick={() => setLayoutOpen(false)}>×</button>
                          </div>

                          <div className="modal-body">
                              {refData.CardLayout ? (
                                  <div className="card-layout">
                                      <h3 className="card-layout-title">
                                          {refData.CardLayout.title || 'How to Read a Card'}
                                      </h3>

                                      <figure className="card-layout-figure">
                                          <img
                                              className="card-layout-img"
                                              src={refData.CardLayout.image || '/images/card_layout_example.png'}
                                              alt="Sample card with numbered callouts"
                                              onError={(e) => { e.currentTarget.src = '/images/card_layout_example.png'; }}
                                              draggable={false}
                                          />
                                          {(refData.CardLayout.markers || []).map(m => (
                                              <div
                                                  key={m.id}
                                                  className="cl-bubble"
                                                  style={{ left: `${m.x}%`, top: `${m.y}%` }}
                                                  aria-label={`Marker ${m.id}`}
                                              >
                                                  {m.id}
                                              </div>
                                          ))}
                                      </figure>

                                      <ol className="card-layout-list">
                                          {(refData.CardLayout.sections || []).map(sec => (
                                              <li key={sec.id}>
                                                  <span className="cl-num">{sec.id}.</span>{' '}
                                                  <span className="cl-title">{sec.title}</span>{' '}
                                                  <span className="cl-text">- {sec.text}</span>
                                                  {Array.isArray(sec.subitems) && sec.subitems.length > 0 && (
                                                      <ul className="card-layout-sublist">
                                                          {sec.subitems.map(sub => (
                                                              <li key={sub.id}>
                                                                  <span className="cl-num">{sub.id}.</span>{' '}
                                                                  <span className="cl-title">{sub.title}</span>{' '}
                                                                  <span className="cl-text">- {sub.text}</span>
                                                              </li>
                                                          ))}
                                                      </ul>
                                                  )}
                                              </li>
                                          ))}
                                      </ol>
                                  </div>
                              ) : (
                                  <div className="small">No Card Layout data found. Add a top-level “CardLayout” object to reference.json.</div>
                              )}
                          </div>
                      </div>
                  </div>,
                  document.body
              )}

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

              <h3 className="section-title">Deck Actions</h3>
              <div className="row">
                  <button
                      onClick={() => setStackOpen(true)}
                      disabled={deckCount === 0}
                      title={deckCount === 0 ? 'Add cards to view stacks' : 'View deck in stack layout'}
                  >
                      Stack View
                  </button>
                  <button
                      onClick={() => setStatsOpen(true)}
                      disabled={deckCount === 0}
                      title={deckCount === 0 ? 'Add cards to see stats' : 'View deck statistics'}
                  >
                      Deck Stats
                  </button>
                  <button onClick={onClearDeck}>Clear</button>
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
                  <label htmlFor="import-file" className="btn">Load File</label>

                  <span className="file-name" style={{ marginLeft: 8 }}>
                      {importFileName || 'No file chosen'}
                  </span>

                  {/* Save button shows only after a file has been loaded */}
                  {importFileName ? (
                      <label
                          className="btn"
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
          <button onClick={exportJSON}>Export JSON</button>
          <button onClick={exportCSV}>Export CSV</button>
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
      </aside>
    </div>
  )
}