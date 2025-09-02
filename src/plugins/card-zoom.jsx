// /src/plugins/card-zoom.jsx
import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

const primaryImg  = (id) => `/images/${id}.png`;
const defaultBack = '/images/card0000_b.png';

const normalizeToFront = (id) => (id?.endsWith('_b') ? id.slice(0, -2) + '_a' : id);
const backIdFor       = (id) => (id?.endsWith('_a') ? id.slice(0, -2) + '_b' : id + '_b');

export function CardZoom({ id, name }) {
  const [open, setOpen] = useState(false);
  const [showBack, setShowBack] = useState(false);

  const frontId = normalizeToFront(id);
  const backId  = backIdFor(frontId);

  const src = showBack ? primaryImg(backId) : primaryImg(frontId);
  const alt = name || 'Card art';

  const flip  = useCallback(() => setShowBack(v => !v), []);
  const close = useCallback(() => { setOpen(false); setShowBack(false); }, []);

  return (
    <>
          <button
              className="zoom-btn"
              title="Zoom card art"
              onClick={(e) => {
                  e.stopPropagation();

                  // Detect which face is currently visible by finding the nearest card <img>.
                  let faceIsBack = false;
                  try {
                      const btn = e.currentTarget;
                      let node = btn;
                      let imgEl = null;

                      // Walk up a few ancestors until we find an <img> inside.
                      for (let i = 0; i < 6 && node && !imgEl; i++) {
                          imgEl = node.querySelector?.('img') || null;
                          node = node.parentElement;
                      }

                      if (imgEl) {
                          let src = imgEl.getAttribute('src') || '';
                          // strip query/hash then check filename
                          src = src.split('?')[0].split('#')[0];
                          const file = src.substring(src.lastIndexOf('/') + 1);
                          faceIsBack = /_b\.(png|webp|jpg|jpeg|gif)$/i.test(file);
                      } else {
                          // Fallback to id suffix if no image found
                          faceIsBack = !!id && /_b$/.test(id);
                      }
                  } catch {
                      faceIsBack = !!id && /_b$/.test(id);
                  }

                  setShowBack(faceIsBack);
                  setOpen(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
          >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" d="M10 2a8 8 0 105.293 14.293l4.707 4.707 1.414-1.414-4.707-4.707A8 8 0 0010 2zm0 2a6 6 0 110 12A6 6 0 0110 4z" />
              </svg>
          </button>

      {open && createPortal(
        <div className="zoom-backdrop" onClick={close} aria-modal="true" role="dialog">
          <div className="zoom-modal" onClick={(e) => e.stopPropagation()}>
            <button className="zoom-close" aria-label="Close" onClick={close}>✕</button>
            <div className="zoom-stack">
              <img
                className="zoom-img"
                src={src}
                alt={alt}
                draggable={false}
                onError={(e) => { e.currentTarget.src = defaultBack; }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); flip(); }}
              />
              <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
                <button
                  type="button"
                  className="flip-btn"
                  aria-pressed={showBack}
                  title="Flip this card"
                  onClick={(e) => { e.stopPropagation(); flip(); }}
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
    </>
  );
}

// default export for plugin loader (no hooks)
export default function activateCardZoom() {}
