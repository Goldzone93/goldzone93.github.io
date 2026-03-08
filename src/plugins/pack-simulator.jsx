// /src/plugins/pack-simulator.jsx
import React, { useEffect, useMemo, useState, useCallback, useLayoutEffect, useRef } from 'react';
import '../styles/pack-simulator.css';
import { useHoverPreview } from './hover-preview.jsx';
import { CardZoom } from './card-zoom.jsx';

// --- image helpers (mirror App.core.jsx) ---
const primaryImg = (id) => `/images/${id}.png`;
const aImg       = (id) => `/images/${id}_a.png`;
const bImg       = (id) => `/images/${id}_b.png`;
const defaultBack = '/images/card0000_b.png';

// normalize any _b id to its _a front
const normalizeToFront = (id) => (id?.endsWith('_b') ? id.slice(0, -2) + '_a' : id);

// ensure an id is a FRONT face id (…_a) for image/printing purposes
const ensureFrontId = (id) => {
    const s = String(id || '');
    if (!s) return s;
    if (/_a$/i.test(s)) return s;
    if (/_b$/i.test(s)) return s.replace(/_b$/i, '_a');
    return `${s}_a`;
};

// compute the _b InternalName for a given id
const backIdFor = (id) => (id?.endsWith('_a') ? id.slice(0, -2) + '_b' : id + '_b');

// --- set/variant helpers ---
// Variant IDs may insert _<SET> before _a/_b (e.g. card0001_CS2_a).
// For rules (caps/legality), treat variants as the same base card.
const stripSetVariantId = (id) => {
    const s = String(id || '');
    const m = s.match(/^(.+)_([A-Za-z0-9]+)_([ab])$/i);
    return m ? `${m[1]}_${m[3].toLowerCase()}` : s;
};
const getBaseFrontId = (id) => stripSetVariantId(normalizeToFront(id));

// A card/partner Set field may be a string (single set) or an array (multiple sets).
const getSetIdsFromObj = (obj) => {
    const v = obj?.Set ?? obj?.SetID ?? obj?.SetId ?? obj?.SetIDs ?? obj?.SetIds;
    if (Array.isArray(v)) return v.filter(Boolean).map(String);
    if (typeof v === 'string' && v.trim()) return [v.trim()];
    return [];
};
const intersects = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return false;
    const bs = new Set(b);
    return a.some(x => bs.has(x));
};

// If a card belongs to multiple sets, we may want to "print" it as a specific set-variant id
// (e.g. card0001_CS2_a) so the correct art and set grouping are used in the pack/collection UI.
const applySetVariantToId = (id, setId, setIds) => {
    const ids = Array.isArray(setIds) ? setIds : [];
    if (!id || !setId || ids.length < 2) return id;
    if (String(setId) === String(ids[0])) return id; // first set keeps base filename
    return /_(a|b)$/i.test(id)
        ? String(id).replace(/_(a|b)$/i, `_${setId}_$1`)
        : `${id}_${setId}`;
};

// Determine which Set bucket a specific InternalName should appear under.
const getPrintingSetId = (internalName, cardObj) => {
    const s = String(internalName || '');
    const m = s.match(/^.+_([A-Za-z0-9]+)_(a|b)$/i);
    if (m) return m[1];
    const sets = getSetIdsFromObj(cardObj);
    return sets[0] || 'Unknown';
};

// When we pull a card for a pack, choose a printing id that matches the allowed set pool.
// If only one allowed set is active, multi-set cards will be pulled as that set's variant.
const pickPrintingIdForPull = (cardObj, allowedSetIds, faceId) => {
    const sets = getSetIdsFromObj(cardObj);
    if (sets.length < 2) return faceId;
    if (Array.isArray(allowedSetIds) && allowedSetIds.length === 1) {
        const only = allowedSetIds[0];
        if (sets.includes(only)) return applySetVariantToId(faceId, only, sets);
    }
    return faceId;
};

// Robust image with graceful fallback chain
function CardImg({ id, alt, ...imgProps }) {
    const [src, setSrc] = useState(primaryImg(id));

    // when the id changes (front/back flip), restart the load pipeline
    useEffect(() => {
        setSrc(primaryImg(id));
    }, [id]);

    return (
        <img
            src={src}
            alt={alt || id}
            loading="lazy"
            onError={() => {
                if (src === primaryImg(id)) setSrc(aImg(id));
                else if (src === aImg(id)) setSrc(bImg(id));
                else setSrc(defaultBack);
            }}
            {...imgProps}
        />
    );
}

// Always show the FRONT face of a partner (…_a.png). Default to card0000_a.png.
function partnerFrontImageSrc(internalName) {
    if (!internalName) return '/images/card0000_a.png';
    const front = internalName.endsWith('_b')
        ? internalName.replace(/_b$/, '_a')
        : internalName.endsWith('_a')
            ? internalName
            : `${internalName}_a`;
    return `/images/${front}.png`;
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function getElementsFromPartner(p) {
  if (!p) return [];
  const els = [p.ElementType1, p.ElementType2, p.ElementType3].filter(Boolean);
  if (!els.includes('Neutral')) els.push('Neutral'); // always allowed
  return els;
}
function strictFrontElementMatch(card, allowed, cardsById) {
    // IMPORTANT: element gating uses ONLY the _a (front) face; _b data is ignored.
    const frontId = normalizeToFront(card?.InternalName);
    const front = (frontId && cardsById && cardsById[frontId]) ? cardsById[frontId] : card;

    const els = [front?.ElementType1, front?.ElementType2, front?.ElementType3]
        .filter(Boolean);
    const uniq = Array.from(new Set(els));
    if (uniq.length === 0) return false;

    const allowedSet = new Set(allowed || []);

    // A selected card must NOT have any front-face elements that are not allowed.
    for (const e of uniq) {
        if (!allowedSet.has(e)) return false;
    }

    // Neutral-only cards are always allowed.
    const nonNeutral = uniq.filter((e) => e !== 'Neutral');
    if (nonNeutral.length === 0) return true;

    // Otherwise, it must share at least one partner element
    // (already guaranteed by the subset check above).
    return true;
}
function groupByRarity(cards) {
  const g = { 'Ultra Rare': [], 'Rare': [], 'Uncommon': [], 'Common': [] };
  for (const c of cards) if (g[c.Rarity]) g[c.Rarity].push(c);
  return g;
}
function pickRandom(list, n, allowDup = false) {
  const out = [];
  if (!Array.isArray(list) || list.length === 0 || n <= 0) return out;
  if (allowDup) { for (let i=0;i<n;i++) out.push(list[Math.floor(Math.random()*list.length)]); return out; }
  const pool = list.slice();
  for (let i=0;i<n;i++) {
    if (!pool.length) break;
    const idx = Math.floor(Math.random()*pool.length);
    out.push(pool[idx]);
    pool.splice(idx,1);
  }
  while (out.length < n && list.length) out.push(list[Math.floor(Math.random()*list.length)]);
  return out;
}

// --- element color helpers (from /elements.json) ---
function hexToRgba(hex, alpha = 0.15) {
    if (!hex) return `rgba(255,255,255,${alpha})`;
    const n = hex.replace('#', '');
    const bigint = parseInt(n.length === 3
        ? n.split('').map(ch => ch + ch).join('')
        : n, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function buildElementColorMap(arr) {
    const m = {};
    if (Array.isArray(arr)) {
        for (const e of arr) {
            const internal = (e?.InternalName || '').toString().trim();   // e.g., "et_earth"
            const display = (e?.DisplayName || '').toString().trim();    // e.g., "Earth"
            const hexRaw = (e?.HexColor || e?.HexColorID || '').toString().trim();
            if (!hexRaw) continue;
            const hex = hexRaw.startsWith('#') ? hexRaw : `#${hexRaw}`;

            if (internal) m[internal.toLowerCase()] = hex;                // "et_earth" -> color
            if (display) m[display.toLowerCase()] = hex;                // "earth"    -> color
            // also support internal without the "et_" prefix, just in case
            if (internal.toLowerCase().startsWith('et_')) {
                m[internal.slice(3).toLowerCase()] = hex;                   // "earth"    -> color
            }
        }
    }
    return m;
}

// ADD BELOW buildElementColorMap(...) — right before `export function PackSimulator() {`
function PsNumberInput({ value, min, max, className = 'ps-input', onCommit }) {
    const [draft, setDraft] = useState(value === 0 ? '0' : (value ?? '') + '');

    // keep draft in sync if external value changes
    useEffect(() => {
        setDraft(value === 0 ? '0' : (value ?? '') + '');
    }, [value]);

    const commit = useCallback(() => {
        const s = (draft ?? '').trim();
        if (s === '') {
            // empty resolves to the lower bound (or 0 if no min)
            const fallback = typeof min === 'number' ? min : 0;
            onCommit(fallback);
            return;
        }
        let n = parseInt(s, 10);
        if (!Number.isFinite(n)) n = 0;

        const lo = typeof min === 'number' ? min : -Infinity;
        const hi = typeof max === 'number' ? max : Infinity;
        onCommit(Math.max(lo, Math.min(hi, n)));
    }, [draft, min, max, onCommit]);

    const onKeyDown = (e) => { if (e.key === 'Enter') commit(); };

    return (
        <input
            type="number"
            inputMode="numeric"
            className={className}
            min={min}
            max={max}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
        />
    );
}

export function PackSimulator() {
  // data
  const [cards, setCards] = useState([]);
  const [partners, setPartners] = useState([]);
  const [elementColors, setElementColors] = useState({});
  const [rarityColors, setRarityColors] = useState({
      Common: '#34d399',
      Uncommon: '#60a5fa',
      Rare: '#ffb300',
      'Ultra Rare': '#f57c00',
  });
    const [selectedPid, setSelectedPid] = useState('');
    const [partnerVariantSet, setPartnerVariantSet] = useState(null);

    // NEW: reference lists + data for formats/packs
    const [refLists, setRefLists] = useState({ Format: [], Packs: [], Set: [] });
    const [formats, setFormats] = useState({}); // from /formats.json
    const [packs, setPacks] = useState({}); // from /packs.json

    // NEW: user selections
    const [selectedFormat, setSelectedFormat] = useState(''); // will default after load
    const [selectedPack, setSelectedPack] = useState(''); // empty = no pack filter

  // controls (defaults)
  const [packSize, setPackSize] = useState(6);
  const [rareQty, setRareQty] = useState(1);
  const [ultraRate, setUltraRate] = useState(0);      // 0..100 %
  const [uncommonQty, setUncommonQty] = useState(2);
  const [commonQty, setCommonQty] = useState(3);
  const [packCount, setPackCount] = useState(1);

  // output
    const [pack, setPack] = useState([]);

    // --- Collection state (right panel) ---
    const [collection, setCollection] = useState(null);   // null = not created yet
    const [collectNext, setCollectNext] = useState(false); // if true, next "Open Pack" populates collection
    // Name for the collection
    const [collectionName, setCollectionName] = useState('Collection Name');

    // NEW: editing mode for manual quantity overrides
    const [isEditingCollection, setIsEditingCollection] = useState(false);

    // NEW: Newly opened cards waiting to be added to the collection
    const [pendingAdd, setPendingAdd] = useState(null); // { counts, meta } or null

    // Collapse state per Set id (e.g., CS1, CS2)
    const [setCollapsed, setSetCollapsed] = useState({});

    // Collapse/expand state for the Collection list
    const [collectionCollapsed, setCollectionCollapsed] = useState(false);

    // Aggregate counts from a list of cards (flat array from current open)
    const aggregatePackCounts = useCallback((list) => {
        const counts = new Map();      // InternalName -> qty
        const meta = new Map();        // InternalName -> card (for name/rarity, etc.)
        for (const c of list) {
            const key = normalizeToFront(c.InternalName);
            counts.set(key, (counts.get(key) || 0) + 1);

            // store meta under the normalized key
            if (!meta.has(key)) meta.set(key, c.InternalName === key ? c : { ...c, InternalName: key });
        }
        return { counts, meta };
    }, []);

    // Button handler: create list now (from current pack) or arm it for the next open
    // Only creates if one does NOT already exist.
    const handleCreateCollection = useCallback(() => {
        if (collection) return; // already created
        setCollectionName('Collection Name'); // default when creating
        if (pack.length > 0) {
            setCollection(aggregatePackCounts(pack));
            setCollectNext(false);
        } else {
            // show an empty shell and auto-fill on the very next Open Pack
            setCollection({ counts: new Map(), meta: new Map() });
            setCollectNext(true);
        }
    }, [collection, pack, aggregatePackCounts]);

    // NEW: Add the most recently opened cards (pendingAdd) into the collection
    const handleAddPendingToCollection = useCallback(() => {
        if (!collection || !pendingAdd) return;

        setCollection(prev => {
            if (!prev) return pendingAdd;

            const nextCounts = new Map(prev.counts);
            const nextMeta = new Map(prev.meta);

            pendingAdd.counts.forEach((qty, key) => {
                nextCounts.set(key, (nextCounts.get(key) || 0) + qty);
                if (!nextMeta.has(key)) nextMeta.set(key, pendingAdd.meta.get(key));
            });

            return { counts: nextCounts, meta: nextMeta };
        });

        setPendingAdd(null);
    }, [collection, pendingAdd, setCollection]);

    // Clear the current collection AND clear any opened pack (no seeding)
    const handleClearCollection = useCallback(() => {
        setCollectionName('Collection Name');                 // reset name
        setCollection({ counts: new Map(), meta: new Map() }); // empty collection
        setCollectNext(true);                                  // next Open Pack will auto-fill
        setIsEditingCollection(false);
        setPack([]);                                           // clear pack view
    }, [setCollection, setCollectNext, setPack]);

    // Confirm-before-clear (native modal like Reset)
    const handleClearClick = useCallback(() => {
        if (!collection) return;
        const hasItems = collection?.counts?.size > 0;
        if (!hasItems) {
            handleClearCollection();
            return;
        }
        const ok = window.confirm(
            'This will clear the current collection and any opened cards. Continue?'
        );
        if (ok) handleClearCollection();
    }, [collection, handleClearCollection]);

    // Close-confirm UI state
    const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

    // Actually close & reset the collection panel
    const closeCollectionNow = useCallback(() => {
        setCollection(null);                 // back to "not created"
        setCollectNext(false);               // don't auto-fill on next open
        setIsEditingCollection(false);
        setCollectionName('Collection Name');
        setSetCollapsed({});                 // reset collapses
    }, []);

    // Click handler for "Close Collection" (decides whether to prompt)
    const handleCloseCollectionClick = useCallback(() => {
        if (!collection) return;
        const hasItems = collection?.counts?.size > 0;
        if (hasItems) {
            setCloseConfirmOpen(true);         // show Yes / No / Cancel
        } else {
            closeCollectionNow();              // nothing to warn about
        }
    }, [collection, closeCollectionNow]);

    // Export current collection (name + InternalName/Quantity/Set) as JSON
    const handleExportCollection = useCallback(() => {
        if (!collection) return;

        const items = [];
        collection.counts.forEach((qty, key) => {
            const card = collection.meta.get(key);
            items.push({
                InternalName: key,
                Quantity: qty,
                Set: getPrintingSetId(key, card),
            });
        });

        const data = {
            CollectionName: (collectionName || 'Collection Name').trim(),
            cards: items,
        };

        const json = JSON.stringify(data, null, 2);

        // simple safe filename from collection name
        const base = (collectionName || 'collection')
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-_ ]+/g, '')
            .replace(/\s+/g, '_') || 'collection';
        const filename = `${base}.json`;

        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }, [collection, collectionName]);

    // --- Import Collection (JSON) ---
    const importFileRef = useRef(null);

    const buildCollectionFromImport = useCallback((data) => {
        const counts = new Map(); // InternalName -> qty
        const meta = new Map();   // InternalName -> card (full record if we have it)

        const items = Array.isArray(data?.cards) ? data.cards : [];
        for (const row of items) {
            const raw = String(row?.InternalName || '').trim();
            const key = normalizeToFront(raw);
            if (!key) continue;
            const qty = Math.max(1, parseInt(row?.Quantity, 10) || 1);

            counts.set(key, (counts.get(key) || 0) + qty);

            // Try to find the full card in our dataset so grouping/badges work.
            // Imported collections may contain set-variant ids (e.g. card0001_CS2_a),
            // which won't exist in the base dataset. In that case, resolve to the base
            // front id for metadata, but keep the printing id for art + set grouping.
            const baseKey = getBaseFrontId(key);
            let baseCard = cards.find(c => c.InternalName === baseKey);

            let card = baseCard
                ? { ...baseCard, InternalName: key } // keep printing id, inherit real name/rarity/etc
                : null;

            if (!card) {
                // Fallback stub (still renders in list)
                card = {
                    InternalName: key,
                    CardName: key,
                    Set: row?.Set || 'Unknown',
                    Rarity: 'Common',
                    CardType: '',
                    ElementType1: 'Neutral',
                };
            }

            if (!meta.has(key)) meta.set(key, card);
        }

        return { counts, meta };
    }, [cards]);

    const triggerImportPicker = useCallback(() => {
        importFileRef.current?.click();
    }, []);

    const onImportFileSelected = useCallback((e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const replaceNow = () => {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data = JSON.parse(String(reader.result || '{}'));
                    const next = buildCollectionFromImport(data);
                    setCollection(next);               // open/replace the collection
                    setCollectNext(false);             // don’t auto-fill on next open
                    setCollectionName(data?.CollectionName?.trim() || 'Collection Name');
                } catch (err) {
                    alert('Import failed: ' + (err?.message || String(err)));
                } finally {
                    e.target.value = '';               // allow re-selecting the same file later
                }
            };
            reader.readAsText(file);
        };

        // If a collection with items exists, confirm replacement.
        const hasCurrent =
            !!collection && collection.counts && collection.counts.size > 0;

        if (hasCurrent) {
            const ok = window.confirm('Importing will replace the current collection. Continue?');
            if (!ok) { e.target.value = ''; return; }
        }
        replaceNow();
    }, [collection, buildCollectionFromImport, setCollection, setCollectNext, setCollectionName]);

    // Confirm actions for the "Would you like to export then close?" prompt
    const confirmExportThenClose = useCallback(() => {
        handleExportCollection();
        closeCollectionNow();
        setCloseConfirmOpen(false);
    }, [handleExportCollection, closeCollectionNow]);

    const confirmCloseNoExport = useCallback(() => {
        closeCollectionNow();
        setCloseConfirmOpen(false);
    }, [closeCollectionNow]);

    const cancelClose = useCallback(() => setCloseConfirmOpen(false), []);

    // Build groups by Set -> Rarity (future-proofed by reference.json Set list)
    const collectionSetGroups = useMemo(() => {
        if (!collection) return [];
        const rarityOrder = ['Ultra Rare', 'Rare', 'Uncommon', 'Common'];

        // Collect cards into map: setId -> rarity -> [{card, qty}]
        const bySet = new Map();
        collection.counts.forEach((qty, key) => {
            const card = collection.meta.get(key);
            if (!card) return;
            const setId = getPrintingSetId(key, card);
            const r = card.Rarity || 'Common';
            if (!bySet.has(setId)) bySet.set(setId, new Map());
            const rmap = bySet.get(setId);
            if (!rmap.has(r)) rmap.set(r, []);
            rmap.get(r).push({ card, qty });
        });

        // Order sets by reference.json Set list; append any unknowns at the end alphabetically
        const refOrder = Array.isArray(refLists?.Set) ? refLists.Set : [];
        const present = Array.from(bySet.keys());
        const known = present.filter(s => refOrder.includes(s)).sort((a, b) => refOrder.indexOf(a) - refOrder.indexOf(b));
        const unknown = present.filter(s => !refOrder.includes(s)).sort();

        const orderedSets = [...known, ...unknown];

        // Build final structure
        const out = orderedSets.map(setId => {
            const rmap = bySet.get(setId) || new Map();
            const groups = [];
            for (const rar of rarityOrder) {
                const rows = (rmap.get(rar) || []).slice()
                    .sort((a, b) => (a.card?.CardName || '').localeCompare(b.card?.CardName || ''));
                if (rows.length) groups.push({ rarity: rar, rows });
            }
            return { setId, groups };
        }).filter(sg => sg.groups.length > 0);

        return out;
    }, [collection, refLists?.Set]);

    const getCapForCard = useCallback((card) => {
        const rc = formats?.[selectedFormat]?.rarityCap ?? {};
        const cap = rc?.[card?.Rarity];
        const n = parseInt(cap, 10);
        return Number.isFinite(n) && n > 0 ? n : Infinity;
    }, [formats, selectedFormat]);

    const adjustCollectionQty = useCallback((key, card, delta) => {
        if (!key || !collection) return;

        setCollection((prev) => {
            if (!prev) return prev;

            const current = prev.counts.get(key) || 0;
            const cap = getCapForCard(card);

            // variants share the same base card cap
            const baseFront = getBaseFrontId(key);
            let baseTotal = 0;
            prev.counts.forEach((q, k) => {
                if (getBaseFrontId(k) === baseFront) baseTotal += (q || 0);
            });

            const otherQty = baseTotal - current;
            const maxForThisPrinting = Math.max(0, cap - otherQty);

            let nextQty = current + delta;

            // clamp upward to remaining cap across variants
            if (nextQty > maxForThisPrinting) nextQty = maxForThisPrinting;

            const nextCounts = new Map(prev.counts);
            const nextMeta = new Map(prev.meta);

            // if reduced below 1, remove from collection
            if (nextQty < 1) {
                nextCounts.delete(key);
                nextMeta.delete(key);
                return { counts: nextCounts, meta: nextMeta };
            }

            nextCounts.set(key, nextQty);
            if (!nextMeta.has(key)) nextMeta.set(key, card);

            return { counts: nextCounts, meta: nextMeta };
        });
    }, [collection, getCapForCard, setCollection]);

    // NEW: Groups for the "Pending Add" list (same shape as collectionSetGroups)
    const pendingSetGroups = useMemo(() => {
        if (!pendingAdd) return [];
        const rarityOrder = ['Ultra Rare', 'Rare', 'Uncommon', 'Common'];

        const bySet = new Map();
        pendingAdd.counts.forEach((qty, key) => {
            const card = pendingAdd.meta.get(key);
            if (!card) return;
            const setId = getPrintingSetId(key, card);
            const r = card.Rarity || 'Common';
            if (!bySet.has(setId)) bySet.set(setId, new Map());
            const rmap = bySet.get(setId);
            if (!rmap.has(r)) rmap.set(r, []);
            rmap.get(r).push({ card, qty });
        });

        const knownSetOrder = Array.isArray(refLists?.Set) ? refLists.Set : [];
        const unknownSets = Array.from(bySet.keys()).filter(s => !knownSetOrder.includes(s)).sort();
        const orderedSets = [...knownSetOrder.filter(s => bySet.has(s)), ...unknownSets];

        const out = orderedSets.map((setId) => {
            const rmap = bySet.get(setId);
            const groups = [];
            for (const rar of rarityOrder) {
                const rows = (rmap?.get(rar) || []).slice().sort((a, b) =>
                    (a.card.CardName || a.card.InternalName).localeCompare(b.card.CardName || b.card.InternalName)
                );
                if (rows.length) groups.push({ rarity: rar, rows });
            }
            return { setId, groups };
        }).filter(sg => sg.groups.length > 0);

        return out;
    }, [pendingAdd, refLists?.Set]);

    // flip state for small thumbnails: key -> boolean (true = show _b)
    const [thumbFlip, setThumbFlip] = useState({});
    const longPressTimers = useRef({});

    const flipThumb = useCallback((key) => {
        setThumbFlip((f) => ({ ...f, [key]: !f[key] }));
    }, []);

    const startLongPress = useCallback((key, e) => {
        // ignore multi-touch
        if (e.touches && e.touches.length > 1) return;
        e.stopPropagation();
        if (longPressTimers.current[key]) clearTimeout(longPressTimers.current[key]);
        longPressTimers.current[key] = setTimeout(() => flipThumb(key), 450); // ~0.45s long-press
    }, [flipThumb]);

    const cancelLongPress = useCallback((key) => {
        if (longPressTimers.current[key]) {
            clearTimeout(longPressTimers.current[key]);
            delete longPressTimers.current[key];
        }
    }, []);

    const getFlipHandlers = useCallback((key) => ({
        onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); flipThumb(key); }, // right-click
        onTouchStart: (e) => startLongPress(key, e),  // long-press begin
        onTouchEnd: () => cancelLongPress(key),     // long-press cancel
        onTouchCancel: () => cancelLongPress(key),
        onTouchMove: () => cancelLongPress(key),
    }), [flipThumb, startLongPress, cancelLongPress]);

    // safety: clear any pending timers on unmount
    useEffect(() => () => {
        const timers = longPressTimers.current;
        Object.keys(timers).forEach((k) => clearTimeout(timers[k]));
    }, []);

    // --- Hover Preview (plugin) ---
    const { onRowEnter, onRowMove, onRowLeave, overlay: hoverOverlay } = useHoverPreview({
        getMeta: (card) => {
            const elements = [card.ElementType1, card.ElementType2, card.ElementType3]
                .filter(Boolean)
                .join(' / ');
            const ccNum = Number(card.ConvertedCost);
            return {
                id: normalizeToFront(card.InternalName),
                name: card.CardName || card.InternalName,
                rarity: card.Rarity || '',
                typeTag: (card.CardType && String(card.CardType).trim()) ||
                    (card.SuperType && String(card.SuperType).trim()) || 'Other',
                elements,
                cc: Number.isFinite(ccNum) ? ccNum : null,
                cardText: card.CardText || '',
            };
        },
        renderImage: (id, name) => (
            <CardImg
                id={id}
                alt={name}
                draggable={false}
                loading="eager"
                className="deck-preview-img"
            />
        ),
    });

    // If the collection becomes empty (or is closed), clear any active hover preview.
    // This prevents the preview from "sticking" when the last row is removed.
    useEffect(() => {
        const isEmpty = !collection || !collection.counts || collection.counts.size === 0;
        if (isEmpty) onRowLeave();
    }, [collection, onRowLeave]);

  // load data from /public
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [cRes, pRes, eRes, rRes, fRes, kRes] = await Promise.all([
                fetch('/cards.json'),
                fetch('/partners.json'),
                fetch('/elements.json'),
                fetch('/reference.json'),
                fetch('/formats.json'),
                fetch('/packs.json'),
            ]);
            const [c, p, e, r, f, k] = await Promise.all([
                cRes.json(), pRes.json(), eRes.json(), rRes.json(), fRes.json(), kRes.json()
            ]);
            if (!cancelled) {
                const allCards = Array.isArray(c) ? c : [];
                const frontCards = allCards.filter(card => !card?.InternalName?.endsWith('_b'));
                setCards(frontCards);

                const allPartners = Array.isArray(p) ? p : [];
                setPartners(allPartners.filter(x => x.CardType === 'Partner' && !x?.InternalName?.endsWith('_b')));

                setElementColors(buildElementColorMap(e));

                // reference lists (Format / Packs / Set)
                setRefLists({
                    Format: Array.isArray(r?.Format) ? r.Format : [],
                    Packs: Array.isArray(r?.Packs) ? r.Packs : [],
                    Set: Array.isArray(r?.Set) ? r.Set : [],
                });

                // rarity color overrides (if present)
                if (r && r.RarityColors) {
                    setRarityColors(prev => ({ ...prev, ...r.RarityColors }));
                }

                // save full format & pack data maps
                setFormats(f && typeof f === 'object' ? f : {});
                setPacks(k && typeof k === 'object' ? k : {});

                // choose a sensible default format (prefer "Freeform", else first)
                const defaultFmt =
                    (Array.isArray(r?.Format) && r.Format.includes('Freeform')) ? 'Freeform' :
                        (Array.isArray(r?.Format) ? r.Format[0] : '');
                setSelectedFormat(defaultFmt || '');
            }
        })();
        return () => { cancelled = true; };
    }, []);

  const selectedPartner = useMemo(
    () => partners.find(p => p.InternalName === selectedPid) || null,
    [partners, selectedPid]
  );

    // Reset variant selection whenever partner changes
    useEffect(() => {
        setPartnerVariantSet(null);
    }, [selectedPid]);

    const partnerSetRaw = selectedPartner?.Set ?? selectedPartner?.SetID ?? selectedPartner?.SetId ?? selectedPartner?.SetIDs ?? selectedPartner?.SetIds;
    const partnerIsVariant = Array.isArray(partnerSetRaw);
    const partnerSetIds = useMemo(() => getSetIdsFromObj(selectedPartner), [selectedPartner]);
    const partnerChosenSet = (partnerIsVariant && partnerSetIds.length)
        ? (partnerVariantSet ?? partnerSetIds[0])
        : null;

    const partnerPrintingFrontId = useMemo(() => {
        if (!selectedPartner?.InternalName) return '';
        const frontId = normalizeToFront(selectedPartner.InternalName);
        if (!partnerIsVariant || !partnerChosenSet) return frontId;
        return applySetVariantToId(frontId, partnerChosenSet, partnerSetIds);
    }, [selectedPartner?.InternalName, partnerIsVariant, partnerChosenSet, partnerSetIds]);

    const partnerImgSrc = useMemo(
        () => partnerFrontImageSrc(selectedPartner?.InternalName),
        [selectedPartner?.InternalName]
    );

    // Which pack IDs should the Pack Selector show for the current format?
    const allowedPackIds = useMemo(() => {
        const all = refLists.Packs || [];
        const fmt = formats?.[selectedFormat];
        if (!fmt) return all;
        const ap = fmt.AllowedPacks;
        if (!ap || ap === '*') return all;
        return Array.isArray(ap) ? ap.filter(id => all.includes(id)) : all;
    }, [refLists.Packs, formats, selectedFormat]);

    // Which Set IDs are allowed for this format? (drives Partner dropdown)
    const formatAllowedSetIds = useMemo(() => {
        const allSets = refLists.Set || [];
        const fmt = formats?.[selectedFormat];
        if (!fmt) return allSets;
        const as = fmt.allowedSets;
        if (!as || as === '*') return allSets;
        return Array.isArray(as) ? as.filter(id => allSets.includes(id)) : allSets;
    }, [refLists.Set, formats, selectedFormat]);

    // For the selected pack, which Set IDs are allowed for card pulls?
    // (pack AllowedSets intersected with format allowedSets)
    const allowedSetIds = useMemo(() => {
        const allSets = refLists.Set || [];
        const fmtSets = Array.isArray(formatAllowedSetIds) ? formatAllowedSetIds : allSets;

        const p = packs?.[selectedPack];
        if (!selectedPack || !p) return fmtSets;                  // no pack picked yet → follow format

        const as = p.AllowedSets;
        const packSets =
            (!as || as === '*') ? allSets :
                (Array.isArray(as) ? as : allSets);

        // intersection
        return packSets.filter(id => fmtSets.includes(id));
    }, [packs, selectedPack, refLists.Set, formatAllowedSetIds]);

    // Partners list filtered by the format's allowedSets
    const partnersFiltered = useMemo(() => {
        if (!Array.isArray(formatAllowedSetIds)) return partners;
        return partners.filter(pt => intersects(getSetIdsFromObj(pt), formatAllowedSetIds));
    }, [partners, formatAllowedSetIds]);

    // If current selected partner falls out of the allowed sets, clear it
    useEffect(() => {
        if (!selectedPid) return;
        const stillOK = partnersFiltered.some(pt => pt.InternalName === selectedPid);
        if (!stillOK) setSelectedPid('');
    }, [partnersFiltered, selectedPid]);

    // When a pack is selected, apply its PackMake defaults but keep inputs editable
    useEffect(() => {
        const pm = packs?.[selectedPack]?.PackMake;
        if (!pm) return;

        if (Number.isFinite(pm.PackSize)) setPackSize(pm.PackSize);
        if (Number.isFinite(pm.Rare)) setRareQty(pm.Rare);
        if (Number.isFinite(pm['UR%'])) setUltraRate(pm['UR%']); // note: bracket for "UR%"
        if (Number.isFinite(pm.Uncommon)) setUncommonQty(pm.Uncommon);
        if (Number.isFinite(pm.Common)) setCommonQty(pm.Common);
    }, [packs, selectedPack, setPackSize, setRareQty, setUltraRate, setUncommonQty, setCommonQty]);

    const allowedElements = useMemo(() => getElementsFromPartner(selectedPartner), [selectedPartner]);

    const cardsById = useMemo(() => {
        const m = {};
        for (const c of cards) m[c.InternalName] = c;
        return m;
    }, [cards]);

    const allowedCards = useMemo(() => {
        const setOK = (c) => !Array.isArray(allowedSetIds) || intersects(getSetIdsFromObj(c), allowedSetIds);

        // No partner selected:
        // allow all cards that are legal for the current format + pack
        if (!selectedPartner) {
            return cards.filter(c => setOK(c));
        }

        // Partner selected:
        // keep the existing element restriction
        return cards.filter(c => setOK(c) && strictFrontElementMatch(c, allowedElements, cardsById));
    }, [cards, allowedElements, selectedPartner, allowedSetIds, cardsById]);

  const byRarity = useMemo(() => groupByRarity(allowedCards), [allowedCards]);
  const configTotal = useMemo(() => rareQty + uncommonQty + commonQty, [rareQty, uncommonQty, commonQty]);
  const configMatches = configTotal === packSize;
    // NEW: per-format cap for how many copies of a single card may appear per open operation
    const rarityCap = useMemo(
        () => (formats?.[selectedFormat]?.rarityCap ?? {}),
        [formats, selectedFormat]
    );

    const generatePack = useCallback(() => {
        if (!selectedPack) return; // require a selected pack

        // Track counts across THIS click (all packs)
        // key: base front id (variants count together)
        const seenCounts = new Map();

        // Baseline counts from the existing Collection (so collection copies count toward the cap)
        const baseCounts = new Map();
        if (collection && collection.counts) {
            collection.counts.forEach((qty, key) => {
                const k = getBaseFrontId(key);
                baseCounts.set(k, (baseCounts.get(k) || 0) + (Number(qty) || 0));
            });
        }

        const capOf = (rarity) => Number.isFinite(rarityCap?.[rarity]) ? rarityCap[rarity] : Infinity;

        // Track 1 "bonus" pull per NEW printing id when the base card is already at cap.
        // key: printed front id (e.g. card0001_CS2_a) -> 0/1
        const seenVariantBonus = new Map();

        const printedIdForCandidate = (card, rarity) => {
            const baseFront = ensureFrontId(getBaseFrontId(card?.InternalName));
            const baseKey = getBaseFrontId(baseFront);

            const cap = capOf(rarity);
            const baseTotal = (baseCounts.get(baseKey) || 0) + (seenCounts.get(baseKey) || 0);

            // At/over cap: if the player doesn't own the ORIGINAL printing yet,
            // allow exactly 1 copy of it (same unlock rule as other variants).
            if (baseTotal >= cap) {
                const ownedOriginal = (collection?.counts?.get(baseFront) || 0);
                const bonusOriginalTaken = (seenVariantBonus.get(baseFront) || 0);
                if (ownedOriginal < 1 && bonusOriginalTaken < 1) {
                    return baseFront;
                }
            }

            // Otherwise, use normal printing selection (set variants, etc.)
            return pickPrintingIdForPull(card, allowedSetIds, baseFront);
        };

        const isEligibleCandidate = (card, rarity, packSeen) => {
            const baseKey = getBaseFrontId(card.InternalName);
            if (packSeen.has(baseKey)) return false;

            const cap = capOf(rarity);
            const baseTotal = (baseCounts.get(baseKey) || 0) + (seenCounts.get(baseKey) || 0);

            // Normal behavior until the card as a whole hits cap
            if (baseTotal < cap) return true;

            // At/over cap: allow exactly 1 copy of a NEW printing (variant) you don't own yet
            const printId = printedIdForCandidate(card, rarity);
            const ownedPrinting = (collection?.counts?.get(printId) || 0);
            const bonusTaken = (seenVariantBonus.get(printId) || 0);

            return ownedPrinting < 1 && bonusTaken < 1;
        };

        // Forbid duplicates *within a single pack* by excluding anything in packSeen.
        const pickOneWithCap = (pool, rarity, packSeen) => {
            if (!Array.isArray(pool) || pool.length === 0) return null;

            const eligible = pool.filter((c) => isEligibleCandidate(c, rarity, packSeen));
            if (eligible.length === 0) return null;

            const pickedBase = eligible[Math.floor(Math.random() * eligible.length)];

            const baseKey = getBaseFrontId(pickedBase.InternalName);
            const cap = capOf(rarity);
            const baseTotalBefore = (baseCounts.get(baseKey) || 0) + (seenCounts.get(baseKey) || 0);

            // Track click-wide counts (still useful for normal pre-cap behavior)
            seenCounts.set(baseKey, (seenCounts.get(baseKey) || 0) + 1);
            packSeen.add(baseKey);

            // Resolve to printed id (variant art)
            const printId = printedIdForCandidate(pickedBase, rarity);
            const picked = (printId && printId !== pickedBase.InternalName)
                ? { ...pickedBase, InternalName: printId }
                : pickedBase;

            // If we were already at/over cap, consume the 1-time bonus for this printing
            if (baseTotalBefore >= cap) {
                seenVariantBonus.set(printId, 1);
            }

            return picked;
        };

        // pick using a fallback chain of rarities, but respect per-pack uniqueness (packSeen)
        const pickWithFallback = (rarityChain, packSeen) => {
            for (const r of rarityChain) {
                const pool = byRarity[r] || [];
                const picked = pickOneWithCap(pool, r, packSeen);
                if (picked) return picked;
            }
            return null; // unfilled
        };

        // Convert a pulled base card into the correct printing id for this open (variant art),
        // based on the current allowedSetIds (format + pack).
        const asPrinted = (card) => {
            if (!card) return null;

            // IMPORTANT: start from the BASE front id so we never apply set-variants twice
            // (e.g. avoid card0001_CS2_CS2_a)
            const baseFront = getBaseFrontId(card.InternalName);
            const face = ensureFrontId(baseFront);

            const printedId = pickPrintingIdForPull(card, allowedSetIds, face);
            return (printedId && printedId !== card.InternalName)
                ? { ...card, InternalName: printedId }
                : card;
        };

        const all = [];
        for (let packIdx = 0; packIdx < packCount; packIdx++) {
            const packSeen = new Set(); // NEW: per-pack uniqueness

            // Decide Ultra Rare vs Rare slots, BUT never downshift if UR/Rare are still available.
            // Also: if only Ultra Rares remain, give Ultra Rares regardless of UR%.
            const hasEligibleWithCap = (pool, rarity, packSeen) => {
                if (!Array.isArray(pool) || pool.length === 0) return false;
                for (const c of pool) {
                    if (isEligibleCandidate(c, rarity, packSeen)) return true;
                }
                return false;
            };

            for (let i = 0; i < rareQty; i++) {
                const urPool = byRarity['Ultra Rare'] || [];
                const rPool = byRarity['Rare'] || [];

                const urAvail = hasEligibleWithCap(urPool, 'Ultra Rare', packSeen);
                const rAvail = hasEligibleWithCap(rPool, 'Rare', packSeen);

                let chain;

                if (urAvail && rAvail) {
                    // Both exist: honor UR% preference, but keep UR/Rare above any downshift.
                    chain = (Math.random() * 100 < ultraRate)
                        ? ['Ultra Rare', 'Rare', 'Uncommon', 'Common']
                        : ['Rare', 'Ultra Rare', 'Uncommon', 'Common'];
                } else if (urAvail) {
                    // Only UR is available: take it (ignore UR%).
                    chain = ['Ultra Rare', 'Rare', 'Uncommon', 'Common'];
                } else if (rAvail) {
                    // Only Rare is available: take it.
                    chain = ['Rare', 'Uncommon', 'Common'];
                } else {
                    // Neither UR nor Rare available: now downshift.
                    chain = ['Uncommon', 'Common'];
                }

                const card = pickWithFallback(chain, packSeen);
                if (card) all.push(asPrinted(card));
            }

            // Uncommon slot fallback: Uncommon -> Common -> unfilled
            for (let i = 0; i < uncommonQty; i++) {
                const card = pickWithFallback(['Uncommon', 'Common'], packSeen);
                if (card) all.push(asPrinted(card));
            }

            // Common slot fallback: Common -> unfilled
            for (let i = 0; i < commonQty; i++) {
                const card = pickWithFallback(['Common'], packSeen);
                if (card) all.push(asPrinted(card));
            }
        }

        // If user armed "Create Collection" with no open packs, auto-fill from this open
        if (collectNext) {
            setCollection(aggregatePackCounts(all));
            setCollectNext(false);
            setPendingAdd(null);
        } else if (collection) {
            // If a collection already exists, queue these opened cards for manual adding.
            setPendingAdd(aggregatePackCounts(all));
        }

        setPack(all);
    }, [
        byRarity,
        rareQty,
        uncommonQty,
        commonQty,
        ultraRate,
        selectedPartner,
        rarityCap,
        packCount,
        collectNext,
        aggregatePackCounts,
        collection,          // NEW: so we can merge when collection exists
        setCollection,       // (setter is stable but included for clarity)
        setPendingAdd,
        selectedPack,
    ]);

    const clearPack = useCallback(() => {
        // clear opened cards
        setPack([]);

        // Keep the current partner selection.

        // If a pack is selected and it has PackMake defaults, use them.
        const pm = packs?.[selectedPack]?.PackMake;
        if (pm) {
            if (Number.isFinite(pm.PackSize)) setPackSize(pm.PackSize);
            if (Number.isFinite(pm.Rare)) setRareQty(pm.Rare);
            if (Number.isFinite(pm['UR%'])) setUltraRate(pm['UR%']); // bracket access for "UR%"
            if (Number.isFinite(pm.Uncommon)) setUncommonQty(pm.Uncommon);
            if (Number.isFinite(pm.Common)) setCommonQty(pm.Common);
        } else {
            // Fallback to global defaults
            setPackSize(6);
            setRareQty(1);
            setUltraRate(0);
            setUncommonQty(2);
            setCommonQty(3);
        }
    }, [packs, selectedPack, setPack, setPackSize, setRareQty, setUltraRate, setUncommonQty, setCommonQty]);

    // Reset everything to Freeform + Pack Select and global defaults (with confirmation)
    const resetAll = useCallback(() => {
        const ok = window.confirm(
            'This will reset Format to Freeform, set Pack Selector to Pack Select, clear the selected Partner and opened cards, and reset all inputs to defaults. Continue?'
        );
        if (!ok) return;

        // clear opened cards
        setPack([]);

        // reset partner
        setSelectedPid('');

        // reset dropdowns
        const free =
            (refLists?.Format || []).includes('Freeform')
                ? 'Freeform'
                : ((refLists?.Format || [])[0] || '');
        setSelectedFormat(free);
        setSelectedPack(''); // shows "Pack Select" placeholder

        // reset numeric inputs to global defaults (remain editable)
        setPackSize(6);
        setRareQty(1);
        setUltraRate(0);
        setUncommonQty(2);
        setCommonQty(3);
        setPackCount(1); // NEW: Number of Packs -> default
    }, [
        refLists,
        setPack,
        setSelectedPid,
        setSelectedFormat,
        setSelectedPack,
        setPackSize,
        setRareQty,
        setUltraRate,
        setUncommonQty,
        setCommonQty,
        setPackCount,
    ]);

    const bandColors = useMemo(() => ({
        top: rarityColors['Rare'] || '#ffb300', // Ultra/Rare row uses Rare color
        mid: rarityColors['Uncommon'] || '#5677fc',
        bot: rarityColors['Common'] || '#4dd0e1',
    }), [rarityColors]);

    // Group + aggregate counts so duplicates render once with a quantity badge
    const packRows = useMemo(() => {
        const g = { 'Ultra Rare': [], 'Rare': [], 'Uncommon': [], 'Common': [] };
        for (const c of pack) (g[c.Rarity] ||= []).push(c);

        const agg = (list) => {
            const map = new Map(); // InternalName -> { card, count }
            const order = [];
            for (const c of list) {
                const key = c.InternalName;
                if (!map.has(key)) {
                    const entry = { card: c, count: 0 };
                    map.set(key, entry);
                    order.push(entry);
                }
                map.get(key).count++;
            }
            return order;
        };

        return {
            top: agg([...g['Ultra Rare'], ...g['Rare']]), // Ultra/Rare row
            mid: agg(g['Uncommon']),
            bot: agg(g['Common']),
        };
    }, [pack]);

    // Keep rarity band heights equal to their corresponding pack-row heights
    useLayoutEffect(() => {
        const rowsSelector = '.ps-pack-rows .ps-pack-row';
        const bandsSelector = '.ps-bands .ps-band';
        const rowsContainer = document.querySelector('.ps-pack-rows');

        const syncHeights = () => {
            const rows = Array.from(document.querySelectorAll(rowsSelector));
            const bands = Array.from(document.querySelectorAll(bandsSelector));

            for (let i = 0; i < Math.max(rows.length, bands.length); i++) {
                const rowEl = rows[i];
                const bandEl = bands[i];
                if (!bandEl) continue;

                // read current row height; if no row (shouldn't happen), clear height
                const h = rowEl ? Math.ceil(rowEl.getBoundingClientRect().height) : 0;
                bandEl.style.height = h ? `${h}px` : '';
            }
        };

        // Observe size changes of the rows container and each row
        const ro = new ResizeObserver(() => {
            // defer to next frame so grid wraps settle
            requestAnimationFrame(syncHeights);
        });

        if (rowsContainer) ro.observe(rowsContainer);
        Array.from(document.querySelectorAll(rowsSelector)).forEach((row) => ro.observe(row));

        // Re-sync on image loads (when images finish loading later)
        const imgs = Array.from(document.querySelectorAll('.ps-pack-rows img'));
        const onImgLoad = () => syncHeights();
        imgs.forEach((img) => {
            if (!img.complete) img.addEventListener('load', onImgLoad, { once: true });
        });

        // Initial + a couple of follow-ups to catch late layout
        syncHeights();
        const t1 = setTimeout(syncHeights, 50);
        const t2 = setTimeout(syncHeights, 200);

        // Also keep window resize (orientation changes, zoom)
        const onResize = () => syncHeights();
        window.addEventListener('resize', onResize);

        return () => {
            window.removeEventListener('resize', onResize);
            clearTimeout(t1);
            clearTimeout(t2);
            imgs.forEach((img) => img.removeEventListener('load', onImgLoad));
            ro.disconnect();

            // Clean inline heights on unmount
            Array.from(document.querySelectorAll(bandsSelector)).forEach((b) => (b.style.height = ''));
        };
    }, [packRows]);

  return (
    <div className="ps-root">
      <header className="ps-header">
        <div className="ps-title">Pack Simulator</div>
        <div className="ps-actions">
                  <button className="tips-btn"
                      onClick={() => {
                          const hasCollectionItems = !!(collection && collection.counts && collection.counts.size > 0);
                          if (hasCollectionItems) {
                              const ok = window.confirm('Do you want to Return to Menu without exporting?');
                              if (!ok) return;
                          }
                          window.dispatchEvent(new CustomEvent('tcg:navigate', { detail: { view: 'menu' } }));
                      }}>
                      Return to Menu
                  </button>
        </div>
      </header>

      <div className="ps-body">
        {/* Left control panel */}
        <aside className="ps-left">
                  <div className="ps-group">
                      <label className="ps-label">Format</label>
                      <select
                          className="ps-select"
                          value={selectedFormat}
                          onChange={(e) => {
                              const nextFmt = e.target.value;
                              setSelectedFormat(nextFmt);

                              // if the current pack is no longer allowed by the new format, clear it
                              const all = refLists.Packs || [];
                              const fmt = formats?.[nextFmt];
                              const ap = fmt?.AllowedPacks;
                              const nextAllowedPackIds = (!fmt || !ap || ap === '*')
                                  ? all
                                  : (Array.isArray(ap) ? ap.filter(id => all.includes(id)) : all);
                              if (selectedPack && !nextAllowedPackIds.includes(selectedPack)) setSelectedPack('');
                          }}
                      >
                          {refLists.Format.map(fmt => (
                              <option key={fmt} value={fmt}>{fmt}</option>
                          ))}
                      </select>
                  </div>

                  <div className="ps-group">
                      <label className="ps-label">Pack Selector</label>
                      <select
                          className="ps-select"
                          value={selectedPack}
                          onChange={(e) => setSelectedPack(e.target.value)}
                      >
                          <option value="">Select Pack</option>
                          {allowedPackIds.map(pid => (
                              <option key={pid} value={pid}>{pid}</option>
                          ))}
                      </select>
                      <div className="ps-hint">Format limits available Packs and Partners. Pack Selector limits which Sets cards can be pulled from.</div>
                  </div>
          <div className="ps-group">
            <label className="ps-label">Partner</label>
                      {/* Partner preview with right-click / long-press flip (only when a partner is selected) */}
                      <div className="ps-partner-art">
                          {selectedPartner && (
                              <>
                                  <CardZoom id={partnerPrintingFrontId || selectedPartner.InternalName} name={selectedPartner.CardName} />
                                  {(() => {
                                      const key = 'partner';
                                      const frontId = partnerPrintingFrontId || normalizeToFront(selectedPartner.InternalName);
                                      const displayId = thumbFlip[key] ? backIdFor(frontId) : frontId;
                                      return (
                                          <CardImg
                                              id={displayId}
                                              alt={selectedPartner.CardName}
                                              draggable={false}
                                              {...getFlipHandlers(key)}   // right-click flips; long-press flips
                                          />
                                      );
                                  })()}
                              </>
                          )}

                          {/* Fallback placeholder when no partner is selected */}
                          {!selectedPartner && (
                              <img
                                  src="/images/card0000_a.png"
                                  alt="Default Partner"
                                  draggable={false}
                              />
                          )}
                      </div>
                      {/* Partner variant buttons (shown only when Partner has Set as an array) */}
                      {selectedPartner && partnerIsVariant && partnerSetIds.length > 1 && (
                          <div className="ps-partner-variants" onMouseDown={(e) => e.stopPropagation()}>
                              {partnerSetIds.map((sid, idx) => {
                                  const isActive =
                                      (partnerChosenSet ? String(partnerChosenSet) : String(partnerSetIds[0])) === String(sid);

                                  return (
                                      <button
                                          key={sid}
                                          type="button"
                                          className={`ps-variant-btn${isActive ? ' active' : ''}`}
                                          onClick={(e) => { e.stopPropagation(); setPartnerVariantSet(sid); }}
                                          title={idx === 0 ? `Use ${sid} (original)` : `Use ${sid} variant`}
                                      >
                                          {sid}
                                      </button>
                                  );
                              })}
                          </div>
                      )}
            <select className="ps-select" value={selectedPid} onChange={(e) => setSelectedPid(e.target.value)}>
              <option value="">— Select Partner —</option>
                          {partnersFiltered.map(p => (
                              <option key={p.InternalName} value={p.InternalName}>{p.CardName}</option>
                          ))}
            </select>

                      <div className="ps-elements">
                          {['ElementType1', 'ElementType2', 'ElementType3', 'Neutral'].map((k) => {
                              // Neutral should act like the others: empty until a partner is selected
                              const val = k === 'Neutral'
                                  ? (selectedPartner ? 'Neutral' : '')
                                  : (selectedPartner?.[k] || '');

                              if (!val) {
                                  return (
                                      <div key={k} className="ps-el is-empty" title="—">
                                          <span className="ps-el-label">—</span>
                                      </div>
                                  );
                              }

                              const hex = elementColors[val.toLowerCase()];
                              return (
                                  <div
                                      key={k}
                                      className="ps-el"
                                      style={{
                                          borderColor: hex || 'rgba(255,255,255,0.15)',
                                          background: hexToRgba(hex, 0.14),
                                      }}
                                      title={val}
                                  >
                                      <span className="ps-el-label">{val}</span>
                                  </div>
                              );
                          })}
                      </div>
          </div>

          <div className="ps-group">
            <div className="ps-row">
              <label className="ps-label">Pack Size</label>
                          <PsNumberInput
                              value={packSize}
                              min={1}
                              onCommit={(n) => setPackSize(n)}
                          />
            </div>

            <div className="ps-row">
              <label className="ps-label">Rares/Ultra Rares</label>
                          <PsNumberInput
                              value={rareQty}
                              min={0}
                              onCommit={(n) => setRareQty(n)}
                          />
            </div>

            <div className="ps-row">
              <label className="ps-label">Ultra Rare %</label>
                          <PsNumberInput
                              value={ultraRate}
                              min={0}
                              max={100}
                              onCommit={(n) => setUltraRate(n)}
                          />
            </div>

            <div className="ps-row">
              <label className="ps-label">Uncommons</label>
                          <PsNumberInput
                              value={uncommonQty}
                              min={0}
                              onCommit={(n) => setUncommonQty(n)}
                          />
            </div>

            <div className="ps-row">
              <label className="ps-label">Commons</label>
                          <PsNumberInput
                              value={commonQty}
                              min={0}
                              onCommit={(n) => setCommonQty(n)}
                          />
            </div>

            <div className="ps-row ps-total">
              <div>Total configured</div>
              <div className={configMatches ? 'ok' : 'warn'}>{configTotal} / {packSize}</div>
            </div>

                      <div className="ps-buttons">
                          {/* NEW: Number of Packs input (above Open Pack) */}
                          <div className="ps-row">
                              <label className="ps-label">Number of Packs</label>
                              <PsNumberInput
                                  value={packCount}
                                  min={1}
                                  onCommit={(n) => setPackCount(n)}
                              />
                          </div>
                          {/* Top row: Open Pack (full width) */}
                          <button
                              className="tips-btn"
                              disabled={!selectedPack || !configMatches}
                              title={
                                  !selectedPack
                                      ? 'Select a pack first'
                                      : (!configMatches
                                          ? 'Sum must equal Pack Size'
                                          : 'Open Pack')
                              }
                              onClick={generatePack}
                          >
                              Open Packs
                          </button>

                          {/* Second row: Clear + Reset side-by-side */}
                          <div className="ps-buttons-row">
                              <button
                                  className="tips-btn"
                                  onClick={clearPack}
                                  title="Reset inputs to selected pack defaults; clear opened pack"
                              >
                                  Clear Packs
                              </button>

                              <button
                                  className="tips-btn"
                                  onClick={resetAll}
                                  title="Set Format to Freeform, Pack Selector to Pack Select, reset inputs to defaults, and clear pack"
                              >
                                  Reset Packs
                              </button>
                          </div>
                      </div>
          </div>
        </aside>

              {/* Center column: bands + pack share one scroll container */}
              <div className="ps-center">
                  {/* Rarity bands (visual guide) */}
                  <div className="ps-bands">
                      <div className="ps-band" style={{ background: bandColors.top }}>
                          <div className="ps-band-label">Ultra Rare/Rare</div>
                      </div>
                      <div className="ps-band" style={{ background: bandColors.mid }}>
                          <div className="ps-band-label">Uncommon</div>
                      </div>
                      <div className="ps-band" style={{ background: bandColors.bot }}>
                          <div className="ps-band-label">Common</div>
                      </div>
                  </div>

                  {/* Pack area */}
                  <section className="ps-pack">
                      <div className="ps-pack-rows">
                          <div className="ps-pack-row" data-row="ultra-rare-rare">
                              {packRows.top.map((entry, idx) => (
                                  <div key={`${entry.card.InternalName}-${idx}`} className="ps-card">
                                      {entry.count > 1 && <div className="ps-qty-badge" title={`${entry.count} copies`}>{entry.count}</div>}

                                      <CardZoom id={entry.card.InternalName} name={entry.card.CardName} />
                                      {(() => {
                                          const key = `top:${idx}`;
                                          const frontId = normalizeToFront(entry.card.InternalName);
                                          const displayId = thumbFlip[key] ? backIdFor(frontId) : frontId;
                                          return (
                                              <CardImg
                                                  id={displayId}
                                                  alt={entry.card.CardName}
                                                  draggable={false}
                                                  {...getFlipHandlers(key)}
                                              />
                                          );
                                      })()}
                                  </div>
                              ))}
                          </div>

                          <div className="ps-pack-row" data-row="uncommon">
                              {packRows.mid.map((entry, idx) => (
                                  <div key={`${entry.card.InternalName}-${idx}`} className="ps-card">
                                      {entry.count > 1 && <div className="ps-qty-badge" title={`${entry.count} copies`}>{entry.count}</div>}

                                      <CardZoom id={entry.card.InternalName} name={entry.card.CardName} />
                                      {(() => {
                                          const key = `mid:${idx}`;
                                          const frontId = normalizeToFront(entry.card.InternalName);
                                          const displayId = thumbFlip[key] ? backIdFor(frontId) : frontId;
                                          return (
                                              <CardImg
                                                  id={displayId}
                                                  alt={entry.card.CardName}
                                                  draggable={false}
                                                  {...getFlipHandlers(key)}
                                              />
                                          );
                                      })()}
                                  </div>
                              ))}
                          </div>

                          <div className="ps-pack-row" data-row="common">
                              {packRows.bot.map((entry, idx) => (
                                  <div key={`${entry.card.InternalName}-${idx}`} className="ps-card">
                                      {entry.count > 1 && <div className="ps-qty-badge" title={`${entry.count} copies`}>{entry.count}</div>}

                                      <CardZoom id={entry.card.InternalName} name={entry.card.CardName} />
                                      {(() => {
                                          const key = `bot:${idx}`;
                                          const frontId = normalizeToFront(entry.card.InternalName);
                                          const displayId = thumbFlip[key] ? backIdFor(frontId) : frontId;
                                          return (
                                              <CardImg
                                                  id={displayId}
                                                  alt={entry.card.CardName}
                                                  draggable={false}
                                                  {...getFlipHandlers(key)}
                                              />
                                          );
                                      })()}
                                  </div>
                              ))}
                          </div>

                      </div>
                  </section>
              </div>

              {/* Right control panel */}
              <aside className="ps-right">
                  <div className="ps-group">
                      <label className="ps-label">Collection</label>

                      <div
                          className="ps-buttons-row ps-buttons-row--collection"
                          style={{ gap: 8 }}
                      >
                          <button
                              type="button"
                              className="tips-btn create-btn"
                              onClick={handleCreateCollection}
                              disabled={!!collection}
                              title={collection ? 'Collection already created' : 'Create a collection'}
                          >
                              Create Collection
                          </button>

                          {/* Hidden file input used by the Import button */}
                          <input
                              ref={importFileRef}
                              type="file"
                              accept="application/json"
                              onChange={onImportFileSelected}
                              style={{ display: 'none' }}
                          />

                          <button
                              type="button"
                              className="tips-btn import-btn"
                              onClick={triggerImportPicker}
                              title="Import a collection (JSON with CollectionName and cards[])"
                          >
                              Import
                          </button>
                      </div>

                      {collection && (
                          <div className="ps-row ps-row--wide" style={{ marginTop: 8 }}>
                              <label className="ps-label">Name</label>
                              <input
                                  type="text"
                                  className="ps-input"
                                  value={collectionName}
                                  onChange={(e) => setCollectionName(e.target.value)}
                                  onFocus={(e) => {
                                      // If the field still has the default text, clear it on focus
                                      if ((e.target.value || '').trim() === 'Collection Name') setCollectionName('');
                                  }}
                                  placeholder="Collection Name"
                              />
                          </div>
                      )}

                      {collection && (
                          <div className="ps-buttons-row" style={{ marginTop: 8 }}>
                              <button
                                  type="button"
                                  className="tips-btn"
                                  onClick={handleExportCollection}
                                  title="Export this collection (name, InternalNames, quantities, and sets) as JSON"
                              >
                                  Export
                              </button>

                              <button
                                  type="button"
                                  className="tips-btn"
                                  onClick={handleClearClick}
                                  title="Clear the current collection and start a new one"
                              >
                                  Clear
                              </button>
                          </div>
                      )}
                                            
                      {collection && (
                          <div className="ps-row ps-row--wide" style={{ marginTop: 8 }}>
                              <button
                                  type="button"
                                  className="tips-btn"
                                  onClick={() => setIsEditingCollection(v => !v)}
                                  title={isEditingCollection ? 'Stop editing collection quantities' : 'Edit collection quantities'}
                                  style={{ width: '100%' }}
                              >
                                  {isEditingCollection ? 'Finish Editing' : 'Edit Collection'}
                              </button>
                          </div>
                      )}

                      {collection && (
                          <div className="ps-row ps-row--wide" style={{ marginTop: 8 }}>
                              <button
                                  type="button"
                                  className="tips-btn"
                                  onClick={handleCloseCollectionClick}
                                  title="Close the collection (optionally export first)"
                                  style={{ width: '100%' }}
                              >
                                  Close Collection
                              </button>
                          </div>
                      )}

                      {collection && (
                          <div className="ps-pending" style={{ marginTop: 10 }}>
                              <div className="ps-row ps-row--wide" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                                  <div className="ps-label" style={{ margin: 0 }}>Newly Opened (Pending)</div>
                              </div>

                              {!pendingAdd ? (
                                  <div className="ps-hint" style={{ marginTop: 6 }}>
                                      Open packs to populate this list, then click “Add to Collection”.
                                  </div>
                              ) : (
                                  <div className="deck-type-cards" style={{ marginTop: 8 }}>
                                      {pendingSetGroups.map((setGrp) => (
                                          <div key={`pending-${setGrp.setId}`} className="deck-type-group" style={{ marginTop: 10 }}>
                                              <div className="deck-type-header">{setGrp.setId}</div>

                                              <div className="deck-type-cards">
                                                  {setGrp.groups.map((grp) => (
                                                      <div key={`pending-${setGrp.setId}-${grp.rarity}`} style={{ marginTop: 8 }}>
                                                          <div className="small" style={{ color: 'var(--muted)' }}>{grp.rarity}</div>
                                                          {grp.rows.map(({ card, qty }) => (
                                                              <div
                                                                  key={`pending-${card.InternalName}`}
                                                                  className="deckRow"
                                                                  onMouseEnter={(e) => onRowEnter(card, e)}
                                                                  onMouseMove={onRowMove}
                                                                  onMouseLeave={onRowLeave}
                                                                  title={card.CardName}
                                                              >
                                                                  <div className="name">{card.CardName}</div>
                                                                  <div className="qty">
                                                                      <span className="badge">{qty}x</span>
                                                                  </div>
                                                              </div>
                                                          ))}
                                                      </div>
                                                  ))}
                                              </div>
                                          </div>
                                      ))}
                                  </div>
                              )}
                          </div>
                      )}

                      {collection && closeConfirmOpen && (
                          <div className="ps-confirm">
                              <div className="ps-confirm-text">Would you like to export then close?</div>
                              <div className="ps-buttons-row" style={{ marginTop: 8 }}>
                                  <button className="tips-btn" onClick={confirmExportThenClose}>Yes</button>
                                  <button className="tips-btn" onClick={confirmCloseNoExport}>No</button>
                                  <button className="tips-btn" onClick={cancelClose}>Cancel</button>
                              </div>
                          </div>
                      )}

                      {!collection && (
                          <div className="ps-hint" style={{ marginTop: 8 }}>
                              Creates a list here using the currently opened pack(s).
                              If no packs are open, the next Open Pack will auto-fill this list.
                          </div>
                      )}

                      {collection && (
                          <div className="ps-pending-actions" style={{ marginTop: 10 }}>
                              <div className="ps-row ps-row--wide" style={{ marginTop: 8 }}>
                                  <button
                                      type="button"
                                      className="tips-btn"
                                      onClick={handleAddPendingToCollection}
                                      disabled={!pendingAdd}
                                      title={pendingAdd ? 'Add these opened cards to the collection' : 'Open packs to queue cards for adding'}
                                      style={{ width: '100%' }}
                                  >
                                      Add to Collection
                                  </button>
                              </div>
                          </div>
                      )}

                      {collection && (
                          <div className="deck-type-cards" style={{ marginTop: 10 }}>
                              {collectionSetGroups.length === 0 ? (
                                  <div className="ps-hint" style={{ marginTop: 6 }}>No cards yet. Open packs to add.</div>
                              ) : (
                                  collectionSetGroups.map((setGrp) => (
                                      <div
                                          key={setGrp.setId}
                                          className={`deck-type-group ${setCollapsed[setGrp.setId] ? 'is-collapsed' : ''}`}
                                          style={{ marginTop: 10 }}
                                      >
                                          <div
                                              className="deck-type-header is-clickable"
                                              role="button"
                                              tabIndex={0}
                                              onClick={() => setSetCollapsed(prev => ({ ...prev, [setGrp.setId]: !prev[setGrp.setId] }))}
                                              onKeyDown={(e) => {
                                                  if (e.key === 'Enter' || e.key === ' ') {
                                                      e.preventDefault();
                                                      setSetCollapsed(prev => ({ ...prev, [setGrp.setId]: !prev[setGrp.setId] }));
                                                  }
                                              }}
                                          >
                                              <span className="arrow">▾</span> {setGrp.setId}
                                          </div>

                                          <div className="deck-type-cards">
                                              {setGrp.groups.map((grp) => (
                                                  <div key={`${setGrp.setId}-${grp.rarity}`} style={{ marginTop: 8 }}>
                                                      <div className="small" style={{ color: 'var(--muted)' }}>{grp.rarity}</div>
                                                      {grp.rows.map(({ card, qty }) => (
                                                          <div
                                                              key={card.InternalName}
                                                              className="deckRow"
                                                              onMouseEnter={(e) => onRowEnter(card, e)}
                                                              onMouseMove={onRowMove}
                                                              onMouseLeave={onRowLeave}
                                                              title={card.CardName}
                                                          >
                                                              <div className="name">{card.CardName}</div>
                                                              <div className={`qty ${isEditingCollection ? 'qty-edit' : ''}`}>
                                                                  {isEditingCollection && (
                                                                      <button
                                                                          type="button"
                                                                          className="qty-btn"
                                                                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); adjustCollectionQty(card.InternalName, card, -1); }}
                                                                          title="Decrease quantity"
                                                                      >
                                                                          −
                                                                      </button>
                                                                  )}

                                                                  <span className="badge">{qty}x</span>

                                                                  {isEditingCollection && (() => {
                                                                      const cap = getCapForCard(card);
                                                                      const baseFront = getBaseFrontId(card.InternalName);
                                                                      let baseTotal = 0;
                                                                      collection?.counts?.forEach((q, k) => {
                                                                          if (getBaseFrontId(k) === baseFront) baseTotal += (q || 0);
                                                                      });
                                                                      const atCap = baseTotal >= cap;

                                                                      return (
                                                                          <button
                                                                              type="button"
                                                                              className="qty-btn"
                                                                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); adjustCollectionQty(card.InternalName, card, +1); }}
                                                                              disabled={atCap}
                                                                              title={atCap ? 'Reached max allowed (combined across variants)' : 'Increase quantity'}
                                                                          >
                                                                              +
                                                                          </button>
                                                                      );
                                                                  })()}
                                                              </div>
                                                          </div>
                                                      ))}
                                                  </div>
                                              ))}
                                          </div>
                                      </div>
                                  ))
                              )}
                          </div>
                      )}
                  </div>
              </aside>

      </div>

          {hoverOverlay}

    </div>
  );
}
// Plugin activation (no-op): App.jsx renders <PackSimulator /> directly.
export default function activatePackSimulator() {
    // In the future you could register routes or pluginHost hooks here.
}
