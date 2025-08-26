// /src/plugins/gallery-header-buttons.jsx
import React from 'react';

// Module-scoped sort state so the sorter reads the same values the UI sets
let _sortMode = 'UNSORTED';   // 'UNSORTED' | 'COST' | 'NAME' | 'REFUND'
let _reverse = false;

export default function registerGalleryHeaderButtons(pluginHost) {
    // ----- Slider constants (mirrors your App defaults/feel) -----
    const GALLERY_SCALE_MIN = 0.70;
    const GALLERY_SCALE_MAX = 2.00;
    const GALLERY_SLIDER_RANGE = { min: 0, max: 100, step: 1 };
    const GALLERY_SLIDER_DEFAULT = 25;
    const GALLERY_SLIDER_WIDTH = 160;
    const GALLERY_SLIDER_OVERFLOW = 14;
    const GALLERY_SLIDER_GAP_AFTER = 8; // ⬅ reserve space after the slider so it doesn’t overlay next controls
    const GALLERY_SLIDER_ID = 'gallery-size';
    const GALLERY_RESET_LABEL = 'Reset';
    const GALLERY_ICON_SIZE = 30;
    const GALLERY_ICON_WRAP_STYLE = {
        marginRight: GALLERY_SLIDER_OVERFLOW + 2,
        opacity: 0.85,
        display: 'flex',
        alignItems: 'center',
        color: 'var(--muted)'
    };

    const GALLERY_SLIDER_ICON = (
        <svg
            viewBox="0 0 24 24"
            width={GALLERY_ICON_SIZE}
            height={GALLERY_ICON_SIZE}
            aria-hidden="true"
            focusable="false"
            style={{ display: 'block' }}
        >
            <rect x="5" y="3" width="14" height="18" rx="2" ry="2"
                fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="8" y="6" width="8" height="5" rx="1" ry="1"
                fill="currentColor" opacity="0.75" />
            <circle cx="9.5" cy="16" r="1.2" fill="currentColor" opacity="0.9" />
        </svg>
    );

    // --- Non-UI: gallery sorter (plugin-owned), used by App if it delegates sorting to plugins
    pluginHost.registerGallerySorter?.((list) => {
        const arr = Array.isArray(list) ? [...list] : [];
        const mode = _sortMode;

        if (mode === 'COST') {
            arr.sort((a, b) => {
                const aCost = Number(a?.ConvertedCost ?? 0) || 0;
                const bCost = Number(b?.ConvertedCost ?? 0) || 0;
                const byCost = aCost - bCost;
                if (byCost !== 0) return byCost;
                return String(a?.CardName ?? '').localeCompare(String(b?.CardName ?? ''));
            });
        } else if (mode === 'NAME') {
            arr.sort((a, b) =>
                String(a?.CardName ?? '').localeCompare(String(b?.CardName ?? ''))
            );
        } else if (mode === 'REFUND') {
            arr.sort((a, b) => {
                const aRef = Number(a?.RefundID ?? a?.Refund ?? 0) || 0;
                const bRef = Number(b?.RefundID ?? b?.Refund ?? 0) || 0;
                const byRef = aRef - bRef;
                if (byRef !== 0) return byRef;
                return String(a?.CardName ?? '').localeCompare(String(b?.CardName ?? ''));
            });
        }

        if (_reverse) arr.reverse();
        return arr;
    });

    // --- LEFT controls: Size (icon+slider+reset) + Sorting dropdown + Reverse toggle ---

    function SizeControls() {
        // NEW: on small screens, cap the scale so a single card never exceeds the viewport width
        // Matches App's base tile min (≈230px) when computing the cap.
        const BASE_TILE_MIN = 230;      // must mirror App.jsx grid base
        const MOBILE_MAX_W = 768;       // treat <= 768px as “mobile-ish”
        const SIDE_PADDING = 32;        // rough total horizontal padding/gap

        const calcEffectiveMax = () => {
            const vw = (typeof window !== 'undefined' ? window.innerWidth : 0) || 0;
            if (!vw || vw > MOBILE_MAX_W) return GALLERY_SCALE_MAX;
            const usable = Math.max(200, vw - SIDE_PADDING);
            const byWidth = usable / BASE_TILE_MIN;
            return Math.min(GALLERY_SCALE_MAX, Math.max(GALLERY_SCALE_MIN, byWidth));
        };

        const [effectiveMax, setEffectiveMax] = React.useState(calcEffectiveMax);

        React.useEffect(() => {
            const onResize = () => setEffectiveMax(calcEffectiveMax());
            window.addEventListener('resize', onResize);
            return () => window.removeEventListener('resize', onResize);
        }, []);
        const [pct, setPct] = React.useState(GALLERY_SLIDER_DEFAULT);

        // 0..100 => MIN..(mobile-capped MAX) mapping
        const scale = React.useMemo(() => (
            GALLERY_SCALE_MIN + (effectiveMax - GALLERY_SCALE_MIN) * (pct / 100)
        ), [pct, effectiveMax]);

        // push scale to the app through the plugin core bridge (safe-optional)
        React.useEffect(() => {
            pluginHost.setGalleryScale?.(scale);
        }, [scale]);

        return (
            <>
                <label aria-label="Card size" htmlFor={GALLERY_SLIDER_ID} style={GALLERY_ICON_WRAP_STYLE}>
                    {GALLERY_SLIDER_ICON}
                </label>

                <div
                    style={{
                        width: GALLERY_SLIDER_WIDTH,
                        // ⬇⬇ The key fix: reserve space so the widened input doesn’t overlap following controls
                        marginRight: GALLERY_SLIDER_GAP_AFTER + GALLERY_SLIDER_OVERFLOW,
                        position: 'relative'
                    }}
                >
                    <input
                        className="gallery-size-slider"
                        id={GALLERY_SLIDER_ID}
                        type="range"
                        min={GALLERY_SLIDER_RANGE.min}
                        max={GALLERY_SLIDER_RANGE.max}
                        step={GALLERY_SLIDER_RANGE.step}
                        value={pct}
                        onChange={(e) => setPct(Number(e.target.value))}
                        aria-label="Set gallery card size"
                        style={{
                            // widen by a full thumb width and shift by half so the knob center hits both ends
                            width: `calc(100% + ${GALLERY_SLIDER_OVERFLOW * 2}px)`,
                            transform: `translateX(-${GALLERY_SLIDER_OVERFLOW}px)`
                        }}
                    />
                </div>

                <button
                    type="button"
                    className="to-top-btn"
                    onClick={() => setPct(GALLERY_SLIDER_DEFAULT)}
                    title="Reset card size to default"
                    style={{ marginLeft: 8 }}
                >
                    {GALLERY_RESET_LABEL}
                </button>
            </>
        );
    }

    function SortControls() {
        // initialize from module state; also sync to App APIs if they exist (back-compat)
        const api = pluginHost.getAppApi?.();
        const [mode, setMode] = React.useState(_sortMode);
        const [rev, setRev] = React.useState(_reverse);

        React.useEffect(() => {
            _sortMode = mode;
            api?.setSortMode?.(mode);              // keep App in sync if it still owns sort
            pluginHost.emitGallerySortChange?.();  // signal App to recompute if it delegates to plugins
        }, [mode]);

        React.useEffect(() => {
            _reverse = rev;
            api?.setReverseSort?.(rev);            // keep App in sync if it still owns reverse
            pluginHost.emitGallerySortChange?.();  // signal App to recompute if it delegates to plugins
        }, [rev]);

        return (
            <>
                <select
                    aria-label="Sort Card Gallery"
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                    style={{ marginLeft: 8 }}
                >
                    <option value="UNSORTED">Unsorted</option>
                    <option value="COST">Converted Cost</option>
                    <option value="NAME">Name</option>
                    <option value="REFUND">Refund</option>
                </select>

                <button
                    type="button"
                    onClick={() => setRev(v => !v)}
                    aria-pressed={rev}
                    title="Reverse sort order"
                    className={`gallery-toggle ${rev ? 'active' : ''}`}
                    style={{ marginLeft: 8 }}
                >
                    Reverse
                </button>
            </>
        );
    }

    // LEFT slot: render in the same place/order as in App.jsx
    pluginHost.registerGalleryHeaderLeftAction?.({
        id: 'gallery-header-left-controls',
        render: () => (
            <>
                <SizeControls />
                <SortControls />
            </>
        ),
    });

    // RIGHT slot: To Top + To Bottom (unchanged)
    pluginHost.registerGalleryHeaderAction?.({
        id: 'gallery-header-scroll',
        render: (api) => (
            <>
                <button
                    type="button"
                    className="to-top-btn"
                    title="Scroll Card Gallery to top"
                    onClick={() => api?.scrollGalleryTop?.()}
                >
                    To Top
                </button>

                <button
                    type="button"
                    className="to-top-btn"
                    title="Scroll Card Gallery to bottom"
                    onClick={() => api?.scrollGalleryBottom?.()}
                >
                    To Bottom
                </button>
            </>
        )
    });
}
