// /src/plugins/title-screen.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import '../styles/title-screen.css';

/**
 * TitleScreen (keyboard navigable)
 * - Arrow keys (← → ↑ ↓) move the highlight between items (roving tabindex).
 * - Enter/Space activates the highlighted item.
 * - Defaults to a single "Deck Builder" item that calls onEnter().
 * - Pass an optional `entries` prop for multiple items:
 *     [{ id: 'deck', label: 'Deck Builder', onSelect: fn }, ...]
 */
export function TitleScreen({ onEnter, entries }) {
    // Build the menu items (future-proof: supports multiple)
    const items = useMemo(() => {
        if (entries?.length) return entries;
        return [
            { id: 'deckbuilder', label: 'Deck Builder', onSelect: onEnter },
        ];
    }, [entries, onEnter]);

    const [activeIndex, setActiveIndex] = useState(0);
    const btnRefs = useRef([]);
    const rootRef = useRef(null);

    const focusIndex = useCallback((idx) => {
        const clamped = Math.max(0, Math.min(items.length - 1, idx));
        setActiveIndex(clamped);
    }, [items.length]);

    const move = useCallback((delta) => {
        setActiveIndex((prev) => {
            const next = (prev + delta + items.length) % items.length;
            return next;
        });
    }, [items.length]);

    // Keep focus on the active item
    useEffect(() => {
        const el = btnRefs.current[activeIndex];
        if (el && typeof el.focus === 'function') el.focus();
    }, [activeIndex]);

    // On mount, grab focus synchronously so arrow keys work without clicking
    useLayoutEffect(() => {
        const btn = btnRefs.current?.[0];
        if (btn && typeof btn.focus === 'function') {
            btn.focus();
        } else {
            rootRef.current?.focus({ preventScroll: true });
        }
        // one micro follow-up in case buttons render a tick later
        const t = setTimeout(() => {
            const b = btnRefs.current?.[0];
            if (document.activeElement !== b && b?.focus) b.focus();
        }, 0);
        return () => clearTimeout(t);
    }, []);

    
    // Handle keyboard on the overlay
    const onKeyDown = useCallback((e) => {
        switch (e.key) {
            case 'ArrowRight':
            case 'ArrowDown':
                e.preventDefault();
                move(1);
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                e.preventDefault();
                move(-1);
                break;
            case 'Home':
                e.preventDefault();
                focusIndex(0);
                break;
            case 'End':
                e.preventDefault();
                focusIndex(items.length - 1);
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                items[activeIndex]?.onSelect?.();
                break;
            default:
                break;
        }
    }, [items, activeIndex, move, focusIndex]);

    return (
        <div
            className="ts-root"
            role="dialog"
            aria-modal="true"
            onKeyDown={onKeyDown}
            tabIndex={0}
            ref={rootRef}
        >
            <div className="ts-panel">
                <div className="ts-brand">
                    <h1 className="ts-title">TCG Deckbuilder</h1>
                    <p className="ts-subtitle">Build • Tinker • Dominate</p>
                </div>

                {/* Menu container (ARIA) */}
                <nav
                    className="ts-menu"
                    role="menu"
                    aria-label="Main menu"
                    aria-activedescendant={`ts-item-${activeIndex}`}
                >
                    <div className="ts-items">
                        {items.map((it, idx) => (
                            <button
                                key={it.id ?? idx}
                                id={`ts-item-${idx}`}
                                ref={(el) => (btnRefs.current[idx] = el)}
                                type="button"
                                role="menuitem"
                                // roving tabindex: only the active item is tabbable
                                tabIndex={idx === activeIndex ? 0 : -1}
                                autoFocus={idx === activeIndex}  // <— ensure initial focus lands here
                                className={`ts-item ts-cta ${idx === activeIndex ? 'is-active' : ''}`}
                                aria-current={idx === activeIndex ? 'true' : undefined}
                                onClick={() => it.onSelect?.()}
                                title={it.title || it.label}
                            >
                                {it.label}
                            </button>
                        ))}
                    </div>
                </nav>

                <div className="ts-footer">
                    Use <strong>↑ ↓</strong> to choose, press <strong>Enter</strong> to select
                </div>
            </div>
        </div>
    );
}

/**
 * Plugin activation (no-op for now).
 */
export default function activateTitleScreen() {
    // Intentionally empty: App.jsx imports <TitleScreen /> directly.
}
