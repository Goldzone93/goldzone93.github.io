// /src/plugins/hover-preview.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/hover-preview.css';

/**
 * Reusable hover-preview hook.
 *
 * Props:
 * - getMeta(card) => { id, name, rarity, typeTag, elements, cc, cardText }
 * - renderImage(id, name) => JSX <img .../> (caller controls image component)
 *
 * Returns:
 * - onRowEnter(card, mouseEvent), onRowMove(mouseEvent), onRowLeave()
 * - overlay: JSX element to render near the root of the page section
 */
export function useHoverPreview({ getMeta, renderImage }) {
  const [isHoverCapable, setIsHoverCapable] = useState(false);
  const hoverRef = useRef(null);

  useEffect(() => {
    const mql = window.matchMedia?.('(hover: hover) and (pointer: fine)');
    const update = () => setIsHoverCapable(!!mql?.matches);
    update();
    if (mql?.addEventListener) mql.addEventListener('change', update);
    else if (mql?.addListener) mql.addListener(update);
    return () => {
      if (mql?.removeEventListener) mql.removeEventListener('change', update);
      else if (mql?.removeListener) mql.removeListener(update);
    };
  }, []);

  const computeHoverPos = useCallback((clientX, clientY) => {
    const pad = 8;
    const offset = 14;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const el = hoverRef.current;
    const w = el?.offsetWidth || 260;
    const h = el?.offsetHeight || 380;

    let left = clientX + offset;
    let top = clientY + offset;

    if (left + w + pad > vw) left = clientX - offset - w;
    left = Math.max(pad, Math.min(vw - w - pad, left));

    if (top + h + pad > vh) top = clientY - offset - h;
    top = Math.max(pad, Math.min(vh - h - pad, top));

    return { left, top };
  }, []);

  const [hover, setHover] = useState({
    show: false, x: 0, y: 0,
    id: '', name: '',
    rarity: '', typeTag: '', elements: '', cc: null,
    cardText: '',
  });

    // Hide any active hover preview whenever the Card Zoom modal is open.
    useEffect(() => {
        const body = document?.body;
        if (!body || typeof MutationObserver === 'undefined') return;

        const obs = new MutationObserver(() => {
            if (body.classList.contains('zoom-open')) {
                setHover(prev => (prev.show ? { ...prev, show: false } : prev));
            }
        });

        obs.observe(body, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, []);

    const onRowEnter = useCallback((card, e) => {
        const zooming = !!document?.body?.classList?.contains('zoom-open');
        if (!isHoverCapable || !card || zooming) return;
        const meta = (getMeta?.(card)) || {};
        const pos = computeHoverPos(e.clientX, e.clientY);
        setHover({ show: true, x: pos.left, y: pos.top, ...meta });
    }, [isHoverCapable, getMeta, computeHoverPos]);

    const onRowMove = useCallback((e) => {
        if (document?.body?.classList?.contains('zoom-open')) return;
        const pos = computeHoverPos(e.clientX, e.clientY);
        setHover(prev => prev.show ? { ...prev, x: pos.left, y: pos.top } : prev);
    }, [computeHoverPos]);

  const onRowLeave = useCallback(() => {
    setHover(prev => prev.show ? { ...prev, show: false } : prev);
  }, []);

    const overlay = useMemo(() => {
        const zooming = typeof document !== 'undefined' && document.body?.classList?.contains('zoom-open');
        if (!isHoverCapable || !hover.show || zooming) return null;
        return (
            <div
                ref={hoverRef}
                className="hp-hover-preview deck-preview-float is-visible"
                style={{ left: hover.x, top: hover.y }}
            >
                {renderImage?.(hover.id, hover.name)}
                <div className="deck-preview-meta">
                    <div className="name">{hover.name}</div>
                    <div className="line">
                        {hover.rarity && <span className="badge">{hover.rarity}</span>}
                        {hover.typeTag && <span className="badge">{hover.typeTag}</span>}
                        {Number.isFinite(hover.cc) && <span className="badge">CC {hover.cc}</span>}
                        {hover.elements && <span className="badge">{hover.elements}</span>}
                    </div>
                    {hover.cardText && <div className="text">{hover.cardText}</div>}
                </div>
            </div>
        );
    }, [isHoverCapable, hover, renderImage]);

  return { isHoverCapable, onRowEnter, onRowMove, onRowLeave, overlay };
}

export default function registerHoverPreview() {
  // reserved for future pluginHost wiring if needed
}