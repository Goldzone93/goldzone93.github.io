// /src/plugins/maybe-board.jsx
import React, { useEffect } from 'react';

export default function registerMaybeBoard(pluginHost) {
    pluginHost.registerDeckHeaderRenderer?.({
        id: 'maybe-board-toggle',
        render: () => (
            <>
                <MaybeToggle app={pluginHost.getAppApi?.()} />
                {/* Invisible helper that injects the mobile magnifier buttons into rows */}
                <MobileRowZoomer app={pluginHost.getAppApi?.()} />
            </>
        ),
    });
}

function MaybeToggle({ app }) {
    if (!app) return null;

    const active = app.getActiveBoard?.() || 'DECK';
    const setActive = (v) => app.setActiveBoard?.(v);

    // Same look as the dataset tabs
    return (
        <div className="dataset-toggle" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 4 }}>
            <button
                type="button"
                className={`tab ${active === 'DECK' ? 'active' : ''}`}
                aria-pressed={active === 'DECK'}
                onClick={() => setActive('DECK')}
                title="Show your main deck list (format-limited)."
            >
                Deck
            </button>
            <button
                type="button"
                className={`tab ${active === 'MAYBE' ? 'active' : ''}`}
                aria-pressed={active === 'MAYBE'}
                onClick={() => setActive('MAYBE')}
                title="Show your Maybe list (no size limit)."
            >
                Maybe
            </button>
        </div>
    );
}

/** Inject a mobile-only magnifying-glass button to the left of:
 *  - "To Maybe" on the Deck board
 *  - "To Deck"  on the Maybe board
 *  Uses the same look as the gallery’s zoom button (class "zoom-btn")
 */
function MobileRowZoomer({ app }) {
    useEffect(() => {
        if (!app) return;

        const isMobile = () =>
            window.matchMedia &&
            window.matchMedia('(hover: none), (pointer: coarse), (max-width: 900px)').matches;

        const BTN_CLASS = 'mobile-inline-zoom';
        const MAG_SVG =
            '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 015.292 13.707l4.707 4.707-1.414 1.414-4.707-4.707A8 8 0 1110 2zm0 2a6 6 0 100 12 6 6 0 000-12z"/></svg>';

        const makeBtn = (cardId) => {
            const b = document.createElement('button');
            b.className = `zoom-btn ${BTN_CLASS}`;
            b.title = 'Zoom card art';
            // Override overlay positioning so it sits inline next to the move button
            b.style.position = 'static';
            b.style.width = '28px';
            b.style.height = '28px';
            b.style.marginRight = '6px';
            b.innerHTML = MAG_SVG;
            b.addEventListener('pointerdown', (e) => e.stopPropagation(), { passive: true });
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                app.openZoomForCard?.(cardId);
            });
            return b;
        };

        const inject = () => {
            // Remove if we’re not on mobile
            if (!isMobile()) {
                document.querySelectorAll(`.${BTN_CLASS}`).forEach((n) => n.remove());
                return;
            }

            // Both boards share the same DOM structure under .deck-type-cards
            const rows = document.querySelectorAll('.deck-type-cards .deckRow');
            rows.forEach((row) => {
                const cardId = row.getAttribute('data-id');
                if (!cardId) return;

                const qty = row.querySelector('.qty');
                if (!qty) return;

                // Find the primary move button in this row
                const buttons = Array.from(qty.querySelectorAll('button'));
                const moveBtn = buttons.find((b) => {
                    const t = (b.textContent || '').trim();
                    return t === 'To Deck' || t === 'To Maybe';
                });
                if (!moveBtn) return;

                // Already injected in this row?
                if (qty.querySelector(`.${BTN_CLASS}`)) return;

                // Insert magnifier to the LEFT of the move button
                qty.insertBefore(makeBtn(cardId), moveBtn);
            });
        };

        // Keep it in sync as rows render/update and on viewport changes
        const obs = new MutationObserver(inject);
        obs.observe(document.body, { childList: true, subtree: true });

        inject(); // initial pass
        window.addEventListener('resize', inject);

        return () => {
            obs.disconnect();
            window.removeEventListener('resize', inject);
            document.querySelectorAll(`.${BTN_CLASS}`).forEach((n) => n.remove());
        };
    }, [app]);

    return null;
}
