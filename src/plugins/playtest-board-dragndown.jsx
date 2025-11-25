// /src/plugins/playtest-board-dragndown.jsx
// /src/plugins/playtest-board-dragndown.jsx
import React from 'react';
import {
    openPlayCostModal,
    getAvailableElements,
    spendElements,
    getAvailableElementsOpponent,
    spendOpponentElements
} from "./playtest-board-costmodal";
/* Drag & Drop + stack move handlers for the Playtest Board.
   This file exports a single function that wires up all handler functions
   without owning state. You pass in the current state values and setters.
*/
export function usePlaytestBoardDragNDown(ctx) {
  // ------------ Shortcuts ------------
    const {
        partnerId, partnerSide, setPartnerSide,
        boardSlots, setBoardSlots,
        slotSides, setSlotSides,
        slotCounters, setSlotCounters,
        slotLabels, setSlotLabels,
        hand, setHand,
        oHand, setOHand,
        deckPile, setDeckPile,
        shieldPile, setShieldPile,
        banishPile, setBanishPile,
        gravePile, setGravePile,

        // NEW
        setPartnerInArea,

        // NEW: opponent partner id
        oPartnerId,

        // NEW: opponent piles
        oDeckPile, setODeckPile,
        oShieldPile, setOShieldPile,
        oBanishPile, setOBanishPile,
        oGravePile, setOGravePile,

        dragIdx, setDragIdx,
        setHoverSlot,
        setExhaustedSlots,
        setBattleRole, battleRoleRef,
        setBattleOrigin, battleOriginRef,
    } = ctx || {};

    // --- Global drag fallback (fix sporadic missing dataTransfer on first drag) ---
    const setGlobalDrag = (payload) => { try { window.__PB_LAST_DRAG = payload; } catch { } };
    const clearGlobalDrag = () => { try { delete window.__PB_LAST_DRAG; } catch { } };

    // Helper: normalize id without _a/_b suffix
    const baseId = (s) => String(s || '').replace(/_(a|b)$/i, '');

    // ---- Drag performance helpers (prevent GPU spikes & reflow storms) ----
    const getDragGhost = () => {
        if (window.__PB_DRAG_GHOST) return window.__PB_DRAG_GHOST;
        const c = document.createElement('canvas');
        c.width = 1; c.height = 1;
        window.__PB_DRAG_GHOST = c;
        return c;
    };

    const addBodyClass = (cls) => { try { document.body && document.body.classList.add(cls); } catch { } };
    const removeBodyClass = (cls) => { try { document.body && document.body.classList.remove(cls); } catch { } };

    // Throttle hover highlight to 1/frame
    const hoverKeyRef = React.useRef(null);
    const rafRef = React.useRef(null);
    const requestHover = (key) => {
        if (hoverKeyRef.current === key) return;
        hoverKeyRef.current = key;
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
            setHoverSlot(hoverKeyRef.current);
            rafRef.current = null;
        });
    };

    const endDrag = () => {
        try { cancelAnimationFrame(rafRef.current); } catch { }
        rafRef.current = null;
        hoverKeyRef.current = null;
        try { document.body && document.body.classList.remove('pb-dragging'); } catch { }
    };

    // Unified begin drag helper (adds body class + uses a real preview image when available)
    const beginDrag = (e, previewEl = null) => {
        addBodyClass('pb-dragging');
        try {
            if (previewEl) {
                const rect = previewEl.getBoundingClientRect();
                e.dataTransfer.setDragImage(previewEl, rect.width / 2, rect.height / 2);
            } else {
                e.dataTransfer.setDragImage(getDragGhost(), 0, 0); // tiny fallback
            }
        } catch { }

        // Clean up on ANY of these end/cancel paths (and a safety timer)
        const once = { once: true, capture: true };
        const cleanup = () => endDrag();

        document.addEventListener('dragend', cleanup, once);
        document.addEventListener('drop', cleanup, once);
        document.addEventListener('mouseup', cleanup, once);
        document.addEventListener('keydown', cleanup, once);
        window.addEventListener('blur', cleanup, once);

        // Safety fallback in case none of the above fire (ESC on macOS, etc.)
        try {
            clearTimeout(window.__PB_DRAG_FAILSAFE);
            window.__PB_DRAG_FAILSAFE = setTimeout(cleanup, 2000);
        } catch { }
    };

  // ------------ Helpers: Tops of stacks (index 0 is top) ------------
  const getDeckTop   = () => (deckPile?.length ? deckPile[0] : null);
  const removeDeckTop = () => setDeckPile(prev => (prev?.length ? prev.slice(1) : prev));

  const getShieldTop   = () => (shieldPile?.length ? shieldPile[0] : null);
  const removeShieldTop = () => setShieldPile(prev => (prev?.length ? prev.slice(1) : prev));

  const getBanishTop   = () => (banishPile?.length ? banishPile[0] : null);
  const removeBanishTop = () => setBanishPile(prev => (prev?.length ? prev.slice(1) : prev));

  const getGraveTop   = () => (gravePile?.length ? gravePile[0] : null);
  const removeGraveTop = () => setGravePile(prev => (prev?.length ? prev.slice(1) : prev));

  const addToDeckTop   = (id) => { if (!id) return; setDeckPile(prev => [id, ...(prev || [])]); };
  const addToBanishTop = (id) => { if (!id) return; setBanishPile(prev => [id, ...(prev || [])]); };
  const addToGraveTop  = (id) => { if (!id) return; setGravePile(prev => [id, ...(prev || [])]); };

  // Shield adds + shuffles immediately (like original behavior)
  const addToShieldShuffled = (id) => {
    if (!id) return;
    setShieldPile(prev => {
      const next = [...(prev || []), id];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    });
  };

    // --- Opponent pile helpers ---
    // tops (index 0 is top)
    const getODeckTop = () => (oDeckPile?.length ? oDeckPile[0] : null);
    const removeODeckTop = () => setODeckPile(prev => (prev?.length ? prev.slice(1) : prev));

    const getOShieldTop = () => (oShieldPile?.length ? oShieldPile[0] : null);
    const removeOShieldTop = () => setOShieldPile(prev => (prev?.length ? prev.slice(1) : prev));

    const getOBanishTop = () => (oBanishPile?.length ? oBanishPile[0] : null);
    const removeOBanishTop = () => setOBanishPile(prev => (prev?.length ? prev.slice(1) : prev));

    const getOGraveTop = () => (oGravePile?.length ? oGravePile[0] : null);
    const removeOGraveTop = () => setOGravePile(prev => (prev?.length ? prev.slice(1) : prev));

    // pushers
    const addToODeckTop = (id) => { if (!id) return; setODeckPile(prev => [id, ...(prev || [])]); };
    const addToOBanishTop = (id) => { if (!id) return; setOBanishPile(prev => [id, ...(prev || [])]); };
    const addToOGraveTop = (id) => { if (!id) return; setOGravePile(prev => [id, ...(prev || [])]); };

    const addToOShieldShuffled = (id) => {
        if (!id) return;
        setOShieldPile(prev => {
            const next = [...(prev || []), id];
            for (let i = next.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [next[i], next[j]] = [next[j], next[i]];
            }
            return next;
        });
    };

  const clearSlotCountersAndLabels = (slotKey) => {
    setSlotCounters(prev => {
      if (!prev || !prev[slotKey]) return prev;
      const up = { ...prev };
      delete up[slotKey];
      return up;
    });
    setSlotLabels(prev => {
      if (!prev || !prev[slotKey]) return prev;
      const up = { ...prev };
      delete up[slotKey];
      return up;
    });
  };

  // While moving from battle slot, clear role/origin on the source battle slot
  const clearBattleFlagsIfSource = (slotKey) => {
    if (!/^(?:ob|b)\d+$/.test(String(slotKey || ''))) return;
    setBattleRole(prev => {
      if (!prev || !prev[slotKey]) return prev;
      const up = { ...prev };
      delete up[slotKey];
      return up;
    });
    setBattleOrigin(prev => {
      if (!prev || !prev[slotKey]) return prev;
      const up = { ...prev };
      delete up[slotKey];
      return up;
    });
  };

  // ------------ Drag Payload Reader ------------
  const getDragSource = (e) => {
      const pb = e?.dataTransfer?.getData?.('text/pb');
      if (pb) {
          if (pb.startsWith('hand:')) return { kind: 'hand', index: Number(pb.slice(5)) };
          if (pb.startsWith('ohand:')) return { kind: 'ohand', index: Number(pb.slice(6)) };
          if (pb.startsWith('slot:')) return { kind: 'slot', key: pb.slice(5) };
          if (pb.startsWith('partner:')) return { kind: 'partner', id: pb.slice(8) };

          // player stacks
          if (pb.startsWith('shield:')) return { kind: 'shield', id: pb.slice(7) };
          if (pb.startsWith('banish:')) return { kind: 'banish', id: pb.slice(7) };
          if (pb.startsWith('grave:')) return { kind: 'grave', id: pb.slice(6) };
          if (pb.startsWith('deck:')) return { kind: 'deck', id: pb.slice(5) };

          // opponent stacks
          if (pb.startsWith('oshield:')) return { kind: 'oshield', id: pb.slice(8) };
          if (pb.startsWith('obanish:')) return { kind: 'obanish', id: pb.slice(8) };
          if (pb.startsWith('ograve:')) return { kind: 'ograve', id: pb.slice(7) };
          if (pb.startsWith('odeck:')) return { kind: 'odeck', id: pb.slice(6) };

          if (pb.startsWith('peek:')) {
              const parts = pb.split(':');
              return { kind: 'peek', stack: parts[1], index: Number(parts[2]) };
          }
      }
      const plain = e?.dataTransfer?.getData?.('text/plain');
      const n = Number(plain);
      if (Number.isFinite(n)) return { kind: 'hand', index: n };
      if (typeof dragIdx === 'number') return { kind: 'hand', index: dragIdx };

      // Last-resort fallback for browsers that sometimes drop the payload on the first drag
      try {
          if (window.__PB_LAST_DRAG) return window.__PB_LAST_DRAG;
      } catch { }
      return null;
  };

  // ------------ Hand DnD ------------
    const onHandDragStart = (index) => (e) => {
        setDragIdx(index);
        setGlobalDrag({ kind: 'hand', index });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `hand:${index}`);
        e.dataTransfer.setData('text/plain', String(index));
        const img = e.currentTarget?.querySelector?.('.pb-card-img') || null;
        beginDrag(e, img);
    };
    const onHandDragEnd = () => { setDragIdx(null); clearGlobalDrag(); endDrag(); };
  const onHandContainerDragOver = (e) => e.preventDefault();

  const onHandContainerDrop = (e) => {
    e.preventDefault();
    // If dropped onto a specific item, that handler owns it
    if (e.target?.closest?.('.pb-hand-item')) return;

    const src = getDragSource(e);
    if (!src) return;

    // Slot → Hand
    if (src.kind === 'slot') {
      const moved = boardSlots?.[src.key];
      if (!moved) return;

      setBoardSlots(prev => {
        if (!prev?.[src.key]) return prev;
        const up = { ...prev };
        delete up[src.key];
        return up;
      });
      setSlotSides(prev => {
        if (!prev?.[src.key]) return prev;
        const up = { ...prev };
        delete up[src.key];
        return up;
      });
      clearSlotCountersAndLabels(src.key);

      setHand(prev => [...prev, moved]);
      setDragIdx(null);
      return;
    }

    // Hand → end of Hand
    if (src.kind === 'hand' && Number.isFinite(src.index)) {
      setHand(prev => {
        const next = [...prev];
        const [m] = next.splice(src.index, 1);
        next.push(m);
        return next;
      });
      setDragIdx(null);
      return;
    }

      // Partner → Hand (move from partner area; avoid dups)
      if (src.kind === 'partner' && partnerId) {
          setHand(prev => (prev.includes(partnerId) ? prev : [...prev, partnerId]));
          // Leaving the partner zone — clear its per-slot state and mark partner as no longer in the area
          clearSlotCountersAndLabels('partner');
          if (typeof setPartnerInArea === 'function') setPartnerInArea(false);
          setDragIdx(null);
          return;
      }

    // Shield/Banish/Grave/Deck (top) → Hand (append)
    if (src.kind === 'shield') { const m = getShieldTop(); if (!m) return; removeShieldTop(); setHand(prev => [...prev, m]); setDragIdx(null); return; }
    if (src.kind === 'banish') { const m = getBanishTop(); if (!m) return; removeBanishTop(); setHand(prev => [...prev, m]); setDragIdx(null); return; }
    if (src.kind === 'grave')  { const m = getGraveTop();  if (!m) return; removeGraveTop();  setHand(prev => [...prev, m]); setDragIdx(null); return; }
    if (src.kind === 'deck')   { const m = getDeckTop();   if (!m) return; removeDeckTop();   setHand(prev => [...prev, m]); setDragIdx(null); return; }
      // OPPONENT Shield/Banish/Grave/Deck (top) → User Hand (append)
      if (src.kind === 'oshield') {
          const m = getOShieldTop(); if (!m) return;
          removeOShieldTop();
          setHand(prev => [...prev, m]);
          setDragIdx(null);
          return;
      }
      if (src.kind === 'obanish') {
          const m = getOBanishTop(); if (!m) return;
          removeOBanishTop();
          setHand(prev => [...prev, m]);
          setDragIdx(null);
          return;
      }
      if (src.kind === 'ograve') {
          const m = getOGraveTop(); if (!m) return;
          removeOGraveTop();
          setHand(prev => [...prev, m]);
          setDragIdx(null);
          return;
      }
      if (src.kind === 'odeck') {
          const m = getODeckTop(); if (!m) return;
          removeODeckTop();
          setHand(prev => [...prev, m]);
          setDragIdx(null);
          return;
      }
      // Opponent Hand → User Hand (append)
      if (src.kind === 'ohand' && Number.isFinite(src.index)) {
          const idx = src.index;
          const moved = oHand?.[idx];
          if (moved == null) return;
          setOHand(prev => {
              const n = [...(prev || [])];
              n.splice(idx, 1);
              return n;
          });
          setHand(prev => [...prev, moved]);
          setDragIdx(null);
          return;
      }

  };

  const onHandItemDragOver = (e) => e.preventDefault();

  const onHandItemDrop = (overIndex) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const src = getDragSource(e);
    if (!src) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const isAfter = e.clientX > rect.left + rect.width / 2;
    let to = overIndex + (isAfter ? 1 : 0);

    // Hand → specific position in Hand
    if (src.kind === 'hand') {
      const from = src.index;
      if (!Number.isFinite(from)) return;
      if (from < to) to--;
      if (to === from) return;
      setHand(prev => {
        const next = [...prev];
        const [m] = next.splice(from, 1);
        next.splice(to, 0, m);
        return next;
      });
      setDragIdx(null);
      return;
    }

    // Slot → Hand (insert)
    if (src.kind === 'slot') {
      const moved = boardSlots?.[src.key];
      if (!moved) return;

        setBoardSlots(prev => {
            if (!prev?.[src.key]) return prev;
            const up = { ...prev };
            delete up[src.key];
            return up;
        });
        setSlotSides(prev => {
            if (!prev?.[src.key]) return prev;
            const up = { ...prev };
            delete up[src.key];
            return up;
        });
        clearSlotCountersAndLabels(src.key);

      setHand(prev => {
        const next = [...prev];
        if (moved === partnerId && next.includes(partnerId)) return next;
        next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
        return next;
      });
      return;
    }

    // Partner → Hand (insert, avoid dups)
    if (src.kind === 'partner' && partnerId) {
      setHand(prev => {
        if (prev.includes(partnerId)) return prev;
        const next = [...prev];
        next.splice(Math.max(0, Math.min(to, next.length)), 0, partnerId);
        return next;
      });
      return;
    }

    // Shield/Banish/Grave/Deck → Hand (insert)
    if (src.kind === 'shield') { const m = getShieldTop(); if (!m) return; removeShieldTop(); setHand(prev => { const n=[...prev]; n.splice(Math.max(0,Math.min(to,n.length)),0,m); return n; }); return; }
    if (src.kind === 'banish') { const m = getBanishTop(); if (!m) return; removeBanishTop(); setHand(prev => { const n=[...prev]; n.splice(Math.max(0,Math.min(to,n.length)),0,m); return n; }); return; }
    if (src.kind === 'grave')  { const m = getGraveTop();  if (!m) return; removeGraveTop();  setHand(prev => { const n=[...prev]; n.splice(Math.max(0,Math.min(to,n.length)),0,m); return n; }); return; }
    if (src.kind === 'deck')   { const m = getDeckTop();   if (!m) return; removeDeckTop();   setHand(prev => { const n=[...prev]; n.splice(Math.max(0,Math.min(to,n.length)),0,m); return n; }); return; }
      // OPPONENT Shield/Banish/Grave/Deck (top) → User Hand (insert)
      if (src.kind === 'oshield') {
          const m = getOShieldTop(); if (!m) return;
          removeOShieldTop();
          setHand(prev => {
              const n = [...prev];
              n.splice(Math.max(0, Math.min(to, n.length)), 0, m);
              return n;
          });
          return;
      }
      if (src.kind === 'obanish') {
          const m = getOBanishTop(); if (!m) return;
          removeOBanishTop();
          setHand(prev => {
              const n = [...prev];
              n.splice(Math.max(0, Math.min(to, n.length)), 0, m);
              return n;
          });
          return;
      }
      if (src.kind === 'ograve') {
          const m = getOGraveTop(); if (!m) return;
          removeOGraveTop();
          setHand(prev => {
              const n = [...prev];
              n.splice(Math.max(0, Math.min(to, n.length)), 0, m);
              return n;
          });
          return;
      }
      if (src.kind === 'odeck') {
          const m = getODeckTop(); if (!m) return;
          removeODeckTop();
          setHand(prev => {
              const n = [...prev];
              n.splice(Math.max(0, Math.min(to, n.length)), 0, m);
              return n;
          });
          return;
      }
      // Opponent Hand → User Hand (insert)
      if (src.kind === 'ohand' && Number.isFinite(src.index)) {
          const idx = src.index;
          const moved = oHand?.[idx];
          if (moved == null) return;
          setOHand(prev => {
              const n = [...(prev || [])];
              n.splice(idx, 1);
              return n;
          });
          setHand(prev => {
              const n = [...prev];
              n.splice(Math.max(0, Math.min(to, n.length)), 0, moved);
              return n;
          });
          setDragIdx(null);
          return;
      }

  };

    // ------------ Opponent Hand DnD (fixed bar) ------------
    const onOHandDragStart = (index) => (e) => {
        setGlobalDrag({ kind: 'ohand', index });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `ohand:${index}`);
        const img = e.currentTarget?.querySelector?.('.pb-card-img') || null;
        beginDrag(e, img);
    };
    const onOHandDragEnd = () => { clearGlobalDrag(); endDrag(); };

    const onOHandContainerDragOver = (e) => {
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch { }
    };

    const onOHandContainerDrop = (e) => {
        e.preventDefault();
        const src = getDragSource(e);
        if (!src) return;

        // Slot → Opponent Hand (append)
        if (src.kind === 'slot') {
            const moved = boardSlots?.[src.key];
            if (!moved) return;
            setBoardSlots(prev => {
                if (!prev?.[src.key]) return prev;
                const up = { ...(prev || {}) };
                delete up[src.key];
                return up;
            });
            setSlotSides(prev => {
                if (!prev?.[src.key]) return prev;
                const up = { ...(prev || {}) };
                delete up[src.key];
                return up;
            });
            clearSlotCountersAndLabels(src.key);
            setOHand(prev => [...(prev || []), moved]);
            return;
        }

        // ohand → end of ohand
        if (src.kind === 'ohand' && Number.isFinite(src.index)) {
            setOHand(prev => {
                const next = [...(prev || [])];
                const [m] = next.splice(src.index, 1);
                next.push(m);
                return next;
            });
            return;
        }

        // User Hand → Opponent Hand (append)
        if (src.kind === 'hand' && Number.isFinite(src.index)) {
            const idx = src.index;
            const moved = hand?.[idx];
            if (moved == null) return;
            setHand(prev => {
                const n = [...prev];
                n.splice(idx, 1);
                return n;
            });
            setOHand(prev => [...(prev || []), moved]);
            setDragIdx(null);
            return;
        }

        // Piles → Opponent Hand (append)
        if (src.kind === 'shield') { const m = getShieldTop(); if (!m) return; removeShieldTop(); setOHand(p => [...(p || []), m]); return; }
        if (src.kind === 'banish') { const m = getBanishTop(); if (!m) return; removeBanishTop(); setOHand(p => [...(p || []), m]); return; }
        if (src.kind === 'grave') { const m = getGraveTop(); if (!m) return; removeGraveTop(); setOHand(p => [...(p || []), m]); return; }
        if (src.kind === 'deck') { const m = getDeckTop(); if (!m) return; removeDeckTop(); setOHand(p => [...(p || []), m]); return; }

        // Opponent piles → Opponent Hand (append)
        if (src.kind === 'oshield') { const m = getOShieldTop(); if (!m) return; removeOShieldTop(); setOHand(p => [...(p || []), m]); return; }
        if (src.kind === 'obanish') { const m = getOBanishTop(); if (!m) return; removeOBanishTop(); setOHand(p => [...(p || []), m]); return; }
        if (src.kind === 'ograve') { const m = getOGraveTop(); if (!m) return; removeOGraveTop(); setOHand(p => [...(p || []), m]); return; }
        if (src.kind === 'odeck') { const m = getODeckTop(); if (!m) return; removeODeckTop(); setOHand(p => [...(p || []), m]); return; }
    };

    const onOHandItemDragOver = (e) => e.preventDefault();

    const onOHandItemDrop = (overIndex) => (e) => {
        e.preventDefault();
        e.stopPropagation();
        const src = getDragSource(e);
        if (!src) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const isAfter = e.clientX > rect.left + rect.width / 2;
        let to = overIndex + (isAfter ? 1 : 0);

        // ohand → position in ohand
        if (src.kind === 'ohand') {
            const from = src.index;
            if (!Number.isFinite(from)) return;
            if (from < to) to--;
            if (to === from) return;
            setOHand(prev => {
                const next = [...(prev || [])];
                const [m] = next.splice(from, 1);
                next.splice(Math.max(0, Math.min(to, next.length)), 0, m);
                return next;
            });
            return;
        }

        // Slot → insert into ohand
        if (src.kind === 'slot') {
            const moved = boardSlots?.[src.key];
            if (!moved) return;
            setBoardSlots(prev => {
                if (!prev?.[src.key]) return prev;
                const up = { ...(prev || {}) };
                delete up[src.key];
                return up;
            });
            setSlotSides(prev => {
                if (!prev?.[src.key]) return prev;
                const up = { ...(prev || {}) };
                delete up[src.key];
                return up;
            });
            clearSlotCountersAndLabels(src.key);
            setOHand(prev => {
                const next = [...(prev || [])];
                next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
                return next;
            });
            return;
        }

        // User Hand → Opponent Hand (insert)
        if (src.kind === 'hand' && Number.isFinite(src.index)) {
            const idx = src.index;
            const moved = hand?.[idx];
            if (moved == null) return;
            setHand(prev => {
                const n = [...prev];
                n.splice(idx, 1);
                return n;
            });
            setOHand(prev => {
                const n = [...(prev || [])];
                n.splice(Math.max(0, Math.min(to, n.length)), 0, moved);
                return n;
            });
            setDragIdx(null);
            return;
        }

        // Piles → insert into ohand
        const insert = (m) => setOHand(prev => {
            const n = [...(prev || [])];
            n.splice(Math.max(0, Math.min(to, n.length)), 0, m);
            return n;
        });
        if (src.kind === 'shield') { const m = getShieldTop(); if (!m) return; removeShieldTop(); insert(m); return; }
        if (src.kind === 'banish') { const m = getBanishTop(); if (!m) return; removeBanishTop(); insert(m); return; }
        if (src.kind === 'grave') { const m = getGraveTop(); if (!m) return; removeGraveTop(); insert(m); return; }
        if (src.kind === 'deck') { const m = getDeckTop(); if (!m) return; removeDeckTop(); insert(m); return; }

        // Opponent piles → insert into ohand
        if (src.kind === 'oshield') { const m = getOShieldTop(); if (!m) return; removeOShieldTop(); insert(m); return; }
        if (src.kind === 'obanish') { const m = getOBanishTop(); if (!m) return; removeOBanishTop(); insert(m); return; }
        if (src.kind === 'ograve') { const m = getOGraveTop(); if (!m) return; removeOGraveTop(); insert(m); return; }
        if (src.kind === 'odeck') { const m = getODeckTop(); if (!m) return; removeODeckTop(); insert(m); return; }
    };

  // ------------ Board Slot DnD ------------
    const onSlotDragOver = (key) => (e) => {
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch { }
        requestHover(key);
    };
    const onSlotDragLeave = () => {
        requestHover(null);
    };

  const onSlotDrop = (key) => async (e) => {
      e.preventDefault();
      e.stopPropagation();
      setHoverSlot(null);
      const src = getDragSource(e);
      if (!src) return;

    // No-op if dropping a slot card onto the same slot
    if (src.kind === 'slot' && src.key === key) return;

    const prevInTarget = boardSlots?.[key] || null;

      // Opponent Partner zone: only accept the opponent's partner; reject all others
      if (String(key) === 'opartner') {

          // Helper to place into opartner
          const placeOPartner = (id, side = 'a') => {
              setBoardSlots(cur => ({ ...(cur || {}), opartner: id }));
              setSlotSides(cur => ({ ...(cur || {}), opartner: side }));
              if (prevInTarget) {
                  // If anything was in opartner (shouldn't be), bump to opponent hand
                  setOHand(p => ([...(p || []), prevInTarget]));
                  clearSlotCountersAndLabels('opartner');
              }
          };

          // Only allow the opponent's partner id
          const allowId = oPartnerId ? baseId(oPartnerId) : null;

          // From opponent HAND → opartner
          if (src?.kind === 'ohand' && Number.isFinite(src.index)) {
              const moved = oHand?.[src.index];
              if (!moved) return;
              if (allowId && baseId(moved) !== allowId) return; // not the partner
              // remove from ohand, place in opartner (preserve face from id)
              setOHand(prev => {
                  const n = [...(prev || [])];
                  n.splice(src.index, 1);
                  return n;
              });
              const sideFromId = /_b$/i.test(String(moved)) ? 'b' : 'a';
              placeOPartner(moved, sideFromId);
              return;
          }

          // From a BOARD SLOT → opartner (only if that slot currently holds the opponent partner)
          if (src?.kind === 'slot') {
              const moved = boardSlots?.[src.key];
              if (!moved) return;
              if (allowId && baseId(moved) !== allowId) return; // not the partner
              // remove from source slot
              const srcSide = (slotSides && slotSides[src.key]) === 'b' ? 'b' : 'a';
              setBoardSlots(prev => {
                  if (!prev?.[src.key]) return prev;
                  const up = { ...(prev || {}) };
                  delete up[src.key];
                  return up;
              });
              setSlotSides(prev => {
                  if (!prev?.[src.key]) return prev;
                  const up = { ...(prev || {}) };
                  delete up[src.key];
                  return up;
              });
              setExhaustedSlots(prev => {
                  if (!prev?.size) return prev;
                  const next = new Set(prev);
                  next.delete(src.key);
                  return next;
              });
              clearBattleFlagsIfSource(src.key);
              clearSlotCountersAndLabels(src.key);
              // place in opartner preserving side from the slot
              placeOPartner(moved, srcSide);
              return;
          }

          // From OPPONENT STACK TOPS → opartner (only if top is the partner)
          const tryFromTop = (getTop, removeTop) => {
              const top = getTop();
              if (!top) return false;
              if (allowId && baseId(top) !== allowId) return false;
              removeTop();
              const sideFromId = /_b$/i.test(String(top)) ? 'b' : 'a';
              placeOPartner(top, sideFromId);
              return true;
          };
          if (src?.kind === 'oshield') { tryFromTop(getOShieldTop, removeOShieldTop); return; }
          if (src?.kind === 'obanish') { tryFromTop(getOBanishTop, removeOBanishTop); return; }
          if (src?.kind === 'ograve') { tryFromTop(getOGraveTop, removeOGraveTop); return; }
          if (src?.kind === 'odeck') { tryFromTop(getODeckTop, removeODeckTop); return; }

          // Any other source → reject (no-op)
          return;
      }

    // Target becomes Ready; if we’re vacating a source slot, clear its exhaustion
    setExhaustedSlots(prev => {
      const next = new Set(prev || []);
      next.delete(key);
      if (src.kind === 'slot') next.delete(src.key);
      return next;
    });

      // Hand → Slot (now goes through Cost Modal for unit/support slots)
      if (src.kind === 'hand') {
          const from = src.index;
          if (!Number.isFinite(from)) return;

          // Only trigger the Cost Modal when dropping to a Unit/Support slot
          const isPlaySlot = /^(?:ou|u)\d+$|^(?:os|s)\d+$/.test(String(key || ""));
          if (isPlaySlot) {

              const mode = (typeof window !== 'undefined' && window.__PB_COST_MODULE_MODE) || 'on';
              // derive the face from the hand card's id
              const cardId = hand?.[from];
              const sideFromId = /_(b)$/i.test(String(cardId)) ? 'b' : 'a';

              if (mode === 'off') {
                  // Bypass the Cost Modal and place the card preserving its face
                  setHand(prev => {
                      const next = [...prev];
                      const [card] = next.splice(from, 1);
                      setBoardSlots(cur => ({ ...(cur || {}), [key]: card }));
                      if (prevInTarget) {
                          if (/^o/.test(String(key))) {
                              setOHand(p => ([...(p || []), prevInTarget]));
                          } else {
                              next.push(prevInTarget);
                          }
                      }
                      return next;
                  });
                  setSlotSides(prev => ({ ...(prev || {}), [key]: sideFromId }));
                  if (prevInTarget) clearSlotCountersAndLabels(key);
                  setDragIdx(null);
                  return;
              }

              // Read current pool counts for the correct owner
              const isOpp = /^o/.test(String(key || ''));
              const owner = isOpp ? 'opponent' : 'player';
              const available = getAvailableElements(owner);
              const paid = await openPlayCostModal({ owner, cardId, side: sideFromId, available });

              // Cancelled → leave everything exactly as-is
              if (!paid) { setDragIdx(null); return; }

              // Spend resources (best effort) THEN place the card
              spendElements(paid, owner);

              setHand(prev => {
                  const next = [...prev];
                  const [card] = next.splice(from, 1);
                  setBoardSlots(cur => ({ ...(cur || {}), [key]: card }));
                  if (prevInTarget) {
                      if (/^o/.test(String(key))) {
                          setOHand(p => ([...(p || []), prevInTarget]));
                      } else {
                          next.push(prevInTarget);
                      }
                  }
                  return next;
              });
              setSlotSides(prev => ({ ...(prev || {}), [key]: 'a' }));
              if (prevInTarget) clearSlotCountersAndLabels(key);
              setDragIdx(null);
              return;
          }

          // Non-play slot: preserve face from hand id
          const cardId = hand?.[from];
          const sideFromId = /_(b)$/i.test(String(cardId)) ? 'b' : 'a';

          setHand(prev => {
              const next = [...prev];
              const [card] = next.splice(from, 1);
              setBoardSlots(cur => ({ ...(cur || {}), [key]: card }));
              if (prevInTarget) {
                  if (/^o/.test(String(key))) {
                      setOHand(p => ([...(p || []), prevInTarget]));
                  } else {
                      next.push(prevInTarget);
                  }
              }
              return next;
          });
          setSlotSides(prev => ({ ...(prev || {}), [key]: sideFromId }));
          if (prevInTarget) clearSlotCountersAndLabels(key);
          setDragIdx(null);
          return;
      }

      // Opponent Hand → Slot (Cost modal for ou*/os*; preserve face from id)
      if (src.kind === 'ohand') {
          const from = src.index;
          if (!Number.isFinite(from)) return;

          // Only charge when playing to opponent Unit/Support slots
          const isOpponentPlaySlot = /^(?:ou|os)\d+$/.test(String(key || ""));
          const mode = (typeof window !== 'undefined' && window.__PB_COST_MODULE_MODE) || 'on';

          // Identify card + face from oHand
          const cardId = oHand?.[from];
          if (!cardId) return;
          const sideFromId = /_(b)$/i.test(String(cardId)) ? 'b' : 'a';

          // If Cost Module is ON and this is a play slot, open the modal with opponent pools
          if (isOpponentPlaySlot && mode !== 'off') {
              const available = (typeof getAvailableElementsOpponent === 'function')
                  ? getAvailableElementsOpponent()
                  : {};

              const paid = await openPlayCostModal({ owner: 'opponent', cardId, side: sideFromId, available });
              if (!paid) { setDragIdx(null); return; }

              if (typeof spendOpponentElements === 'function') {
                  spendOpponentElements(paid);
              }
          }

          const prevInTarget = boardSlots?.[key] || null;
          setOHand(prev => {
              const next = [...(prev || [])];
              const [card] = next.splice(from, 1);
              if (!card) return prev;

              // Preserve face from the id suffix (_a/_b)
              setBoardSlots(cur => ({ ...(cur || {}), [key]: card }));
              setSlotSides(cur => ({ ...(cur || {}), [key]: sideFromId }));

              if (prevInTarget) {
                  // bumped card goes to oHand end
                  next.push(prevInTarget);
              }
              return next;
          });
          return;
      }

    // Slot → Slot (carry side, counters, labels; clear battle flags if leaving)
    if (src.kind === 'slot') {
      const moved = boardSlots?.[src.key];
      if (!moved) return;

      const srcKey = src.key;
      const dstKey = key;

      setBoardSlots(prev => {
        const up = { ...(prev || {}) };
        delete up[srcKey];
        up[dstKey] = moved;
        return up;
      });
      setSlotSides(prev => {
        const next = { ...(prev || {}) };
        const side = prev?.[srcKey] === 'b' ? 'b' : 'a';
        delete next[srcKey];
        next[dstKey] = side;
        return next;
      });

      // counters mirror
      setSlotCounters(prev => {
        const next = { ...(prev || {}) };
        const srcCounters = next[srcKey];
        const tracked = (slot) => /^(?:ou|u)\d+$|^(?:os|s)\d+$|^(?:ob|b)\d+$/.test(slot);
        if (prevInTarget) delete next[dstKey];
        if (srcCounters && tracked(srcKey) && tracked(dstKey)) next[dstKey] = srcCounters;
        delete next[srcKey];
        return next;
      });

      // labels mirror
      setSlotLabels(prev => {
        const next = { ...(prev || {}) };
        const srcLabels = next[srcKey];
        const tracked = (slot) => /^(?:ou|u)\d+$|^(?:os|s)\d+$|^(?:ob|b)\d+$/.test(slot);
        if (prevInTarget) delete next[dstKey];
        if (srcLabels && tracked(srcKey) && tracked(dstKey)) next[dstKey] = srcLabels;
        delete next[srcKey];
        return next;
      });

      clearBattleFlagsIfSource(srcKey);

        if (prevInTarget) {
            if (/^o/.test(String(dstKey))) {
                setOHand(p => ([...(p || []), prevInTarget]));
            } else {
                setHand(prev => [...prev, prevInTarget]);
            }
        }
      return;
    }

    // Shield/Banish/Grave/Deck → Slot
      // Shield/Banish/Grave/Deck → Slot
      const moveTopToSlot = (getTop, removeTop) => {
          const moved = getTop();
          if (!moved) return;
          setBoardSlots(prev => ({ ...(prev || {}), [key]: moved }));
          setSlotSides(prev => ({ ...(prev || {}), [key]: 'a' }));
          removeTop();
          if (prevInTarget) {
              clearSlotCountersAndLabels(key);
              if (/^o/.test(String(key))) {
                  setOHand(p => ([...(p || []), prevInTarget]));
              } else {
                  setHand(prev => [...prev, prevInTarget]);
              }
          }
      };

      if (src.kind === 'shield') { moveTopToSlot(getShieldTop, removeShieldTop); return; }
      if (src.kind === 'banish') { moveTopToSlot(getBanishTop, removeBanishTop); return; }
      if (src.kind === 'grave') { moveTopToSlot(getGraveTop, removeGraveTop); return; }
      if (src.kind === 'deck') { moveTopToSlot(getDeckTop, removeDeckTop); return; }

      // NEW: opponent stacks → Slot
      if (src.kind === 'oshield') { moveTopToSlot(getOShieldTop, removeOShieldTop); return; }
      if (src.kind === 'obanish') { moveTopToSlot(getOBanishTop, removeOBanishTop); return; }
      if (src.kind === 'ograve') { moveTopToSlot(getOGraveTop, removeOGraveTop); return; }
      if (src.kind === 'odeck') { moveTopToSlot(getODeckTop, removeODeckTop); return; }

      // Partner → Slot (unique copy; carry partnerSide; clear any partner-slot counters/labels)
      if (src.kind === 'partner') {
          const id = partnerId;
          if (!id) return;

          // Only trigger Cost Modal when dropping to a Unit/Support slot AND partner is on back side
          const isPlaySlot = /^(?:ou|u)\d+$|^(?:os|s)\d+$/.test(String(key || ""));
          const mode = (typeof window !== 'undefined' && window.__PB_COST_MODULE_MODE) || 'on';
          const shouldUseCostModal = (mode !== 'off') && isPlaySlot && (String(partnerSide) === 'b');

          if (shouldUseCostModal) {
              // Open Cost Modal for the partner's back side (owner-aware)
              const isOpp = /^o/.test(String(key || ''));
              const owner = isOpp ? 'opponent' : 'player';
              const available = getAvailableElements(owner);
              const paid = await openPlayCostModal({ owner, cardId: id, side: 'b', available });
              if (!paid) { return; }
              spendElements(paid, owner);
          }

          setBoardSlots(prev => {
              const up = { ...(prev || {}) };
              up[key] = id;
              return up;
          });

          // Preserve the current partnerSide (a/b) when placing
          setSlotSides(prev => ({ ...(prev || {}), [key]: partnerSide || 'a' }));

          if (prevInTarget) {
              if (/^o/.test(String(key))) {
                  setOHand(p => ([...(p || []), prevInTarget]));
              } else {
                  setHand(prev => [...prev, prevInTarget]);
              }
          }

          clearSlotCountersAndLabels(key);       // drop counters/labels on the card we bumped
          clearSlotCountersAndLabels('partner'); // and partner-slot
          if (typeof setPartnerInArea === 'function') setPartnerInArea(false);
          return;
      }
  };

  // dragging a placed card
    const onSlotCardDragStart = (key) => (e) => {
        setGlobalDrag({ kind: 'slot', key });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `slot:${key}`);
        const img = e.currentTarget?.querySelector?.('.pb-card-img') || null;
        beginDrag(e, img);
    };
    const onSlotCardDragEnd = () => { clearGlobalDrag(); endDrag(); };

  // ------------ Partner zone DnD ------------
    const onPartnerDragStart = (e) => {
        if (!partnerId) return;
        setGlobalDrag({ kind: 'partner', id: partnerId });
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('text/pb', `partner:${partnerId}`);
        const img = e.currentTarget?.querySelector?.('.pb-card-img') || null;
        beginDrag(e, img);
    };
  const onPartnerAreaDragOver = (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch {} };

    const onPartnerAreaDrop = (e) => {
        e.preventDefault();
        const src = getDragSource(e);
        if (!src || !partnerId) return;

        const allowId = baseId(partnerId);
        const setSide = (side) => {
            if (typeof setPartnerSide === 'function') setPartnerSide(side);
        };

        // Slot → Partner area (only if that slot holds our partner, either side)
        if (src.kind === 'slot') {
            const moved = boardSlots?.[src.key];
            if (!moved || baseId(moved) !== allowId) return;

            const srcKey = src.key;
            const sideFromSlot = (slotSides && slotSides[srcKey]) === 'b' ? 'b' : 'a';

            setBoardSlots(prev => {
                if (!prev?.[srcKey]) return prev;
                const up = { ...prev };
                delete up[srcKey];
                return up;
            });

            setSlotSides(prev => {
                if (!prev?.[srcKey]) return prev;
                const up = { ...prev };
                delete up[srcKey];
                return up;
            });

            setExhaustedSlots(prev => {
                if (!prev?.size) return prev;
                const next = new Set(prev);
                next.delete(srcKey);
                return next;
            });
            clearBattleFlagsIfSource(srcKey);
            clearSlotCountersAndLabels(srcKey);

            // Update partner’s current face based on the source slot
            setSide(sideFromSlot);
            if (typeof setPartnerInArea === 'function') setPartnerInArea(true);
            return;
        }

        // Hand → Partner area (only our partner; choose side from id suffix)
        if (src.kind === 'hand' && Number.isFinite(src.index)) {
            const moved = hand?.[src.index];
            if (!moved || baseId(moved) !== allowId) return;

            setHand(prev => {
                const n = [...prev];
                n.splice(src.index, 1);
                return n;
            });
            setDragIdx(null);

            setSide(/_b$/i.test(String(moved)) ? 'b' : 'a');
            if (typeof setPartnerInArea === 'function') setPartnerInArea(true);
            return;
        }

        // Stacks (top) → Partner area (Shield/Banish/Grave/Deck) — only our partner
        const tryFromTop = (pileTop, removeTop) => {
            const top = pileTop();
            if (!top || baseId(top) !== allowId) return false;
            removeTop();
            setSide(/_b$/i.test(String(top)) ? 'b' : 'a');
            if (typeof setPartnerInArea === 'function') setPartnerInArea(true);
            return true;
        };

        if (src.kind === 'shield') { tryFromTop(getShieldTop, removeShieldTop); return; }
        if (src.kind === 'banish') { tryFromTop(getBanishTop, removeBanishTop); return; }
        if (src.kind === 'grave') { tryFromTop(getGraveTop, removeGraveTop); return; }
        if (src.kind === 'deck') { tryFromTop(getDeckTop, removeDeckTop); return; }

        // From Partner area itself: no-op
    };

  // ------------ Shield pile DnD ------------
  const onShieldDragOver = (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch {} };
  const onShieldDrop = (e) => {
    e.preventDefault();
    const src = getDragSource(e);
    if (!src) return;

    const addAndShuffle = addToShieldShuffled;

    // Hand → Shield
    if (src.kind === 'hand' && Number.isFinite(src.index)) {
      const idx = src.index;
      const moved = hand?.[idx];
      if (moved == null) return;
      setHand(prev => { const n=[...prev]; n.splice(idx,1); return n; });
      addAndShuffle(moved);
      setDragIdx(null);
      return;
    }

      // Opponent Hand → Shield
      if (src.kind === 'ohand' && Number.isFinite(src.index)) {
          const idx = src.index;
          const moved = oHand?.[idx];
          if (moved == null) return;
          setOHand(prev => {
              const n = [...(prev || [])];
              n.splice(idx, 1);
              return n;
          });
          // use same helper as Hand → Shield
          const addAndShuffle = addToShieldShuffled;
          addAndShuffle(moved);
          setDragIdx(null);
          return;
      }

    // Slot → Shield
    if (src.kind === 'slot') {
      const moved = boardSlots?.[src.key];
      if (!moved) return;
      setBoardSlots(prev => { const up={...(prev||{})}; delete up[src.key]; return up; });
      clearSlotCountersAndLabels(src.key);
      addAndShuffle(moved);
      return;
    }

    // Deck/Grave/Banish → Shield (top to shuffled)
    if (src.kind === 'deck')   { const m = getDeckTop();   if (!m) return; removeDeckTop();   addAndShuffle(m); return; }
    if (src.kind === 'grave')  { const m = getGraveTop();  if (!m) return; removeGraveTop();  addAndShuffle(m); return; }
    if (src.kind === 'banish') { const m = getBanishTop(); if (!m) return; removeBanishTop(); addAndShuffle(m); return; }
      // NEW: Opponent stacks → Shield (top to shuffled)
      if (src.kind === 'oshield') { const m = getOShieldTop(); if (!m) return; removeOShieldTop(); addAndShuffle(m); return; }
      if (src.kind === 'odeck') { const m = getODeckTop(); if (!m) return; removeODeckTop(); addAndShuffle(m); return; }
      if (src.kind === 'ograve') { const m = getOGraveTop(); if (!m) return; removeOGraveTop(); addAndShuffle(m); return; }
      if (src.kind === 'obanish') { const m = getOBanishTop(); if (!m) return; removeOBanishTop(); addAndShuffle(m); return; }

    // Partner → Shield
    if (src.kind === 'partner' && partnerId) {
      addAndShuffle(partnerId);
      clearSlotCountersAndLabels('partner');
      if (typeof setPartnerInArea === 'function') setPartnerInArea(false);
      return;
    }
  };
    const onShieldDragStart = (e) => {
        const top = getShieldTop();
        if (!top) { e.preventDefault(); return; }
        setGlobalDrag({ kind: 'shield', id: top });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `shield:${top}`);
        beginDrag(e);
    };

  // ------------ Banish pile DnD ------------
  const onBanishDragOver = (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch {} };
  const onBanishDrop = (e) => {
    e.preventDefault();
    const src = getDragSource(e);
    if (!src) return;

    // Hand → Banish
    if (src.kind === 'hand' && Number.isFinite(src.index)) {
      const idx = src.index;
      const moved = hand?.[idx];
      if (moved == null) return;
      setHand(prev => { const n=[...prev]; n.splice(idx,1); return n; });
      addToBanishTop(moved);
      setDragIdx(null);
      return;
    }

      // Opponent Hand → Banish
      if (src.kind === 'ohand' && Number.isFinite(src.index)) {
          const idx = src.index;
          const moved = oHand?.[idx];
          if (moved == null) return;
          setOHand(prev => {
              const n = [...(prev || [])];
              n.splice(idx, 1);
              return n;
          });
          addToBanishTop(moved);
          setDragIdx(null);
          return;
      }

    // Slot → Banish
    if (src.kind === 'slot') {
      const moved = boardSlots?.[src.key];
      if (!moved) return;
      setBoardSlots(prev => { const up={...(prev||{})}; delete up[src.key]; return up; });
      clearSlotCountersAndLabels(src.key);
      addToBanishTop(moved);
      return;
    }

    // Shield/Deck/Grave → Banish
    if (src.kind === 'shield') { const m = getShieldTop(); if (!m) return; removeShieldTop(); addToBanishTop(m); return; }
    if (src.kind === 'deck')   { const m = getDeckTop();   if (!m) return; removeDeckTop();   addToBanishTop(m); return; }
    if (src.kind === 'grave')  { const m = getGraveTop();  if (!m) return; removeGraveTop();  addToBanishTop(m); return; }
      // NEW: Opponent stacks → Banish
      if (src.kind === 'oshield') { const m = getOShieldTop(); if (!m) return; removeOShieldTop(); addToBanishTop(m); return; }
      if (src.kind === 'odeck') { const m = getODeckTop(); if (!m) return; removeODeckTop(); addToBanishTop(m); return; }
      if (src.kind === 'ograve') { const m = getOGraveTop(); if (!m) return; removeOGraveTop(); addToBanishTop(m); return; }
      if (src.kind === 'obanish') { const m = getOBanishTop(); if (!m) return; removeOBanishTop(); addToBanishTop(m); return; }


    // Partner → Banish
    if (src.kind === 'partner' && partnerId) {
      addToBanishTop(partnerId);
      clearSlotCountersAndLabels('partner');
      if (typeof setPartnerInArea === 'function') setPartnerInArea(false);
      return;
    }
  };
    const onBanishDragStart = (e) => {
        const top = getBanishTop();
        if (!top) { e.preventDefault(); return; }
        setGlobalDrag({ kind: 'banish', id: top });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `banish:${top}`);
        beginDrag(e);
    };

  // ------------ Grave pile DnD ------------
  const onGraveDragOver = (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch {} };
  const onGraveDrop = (e) => {
    e.preventDefault();
    const src = getDragSource(e);
    if (!src) return;

    // Hand → Grave
    if (src.kind === 'hand' && Number.isFinite(src.index)) {
      const idx = src.index;
      const moved = hand?.[idx];
      if (moved == null) return;
      setHand(prev => { const n=[...prev]; n.splice(idx,1); return n; });
      addToGraveTop(moved);
      setDragIdx(null);
      return;
    }

      // Opponent Hand → Grave
      if (src.kind === 'ohand' && Number.isFinite(src.index)) {
          const idx = src.index;
          const moved = oHand?.[idx];
          if (moved == null) return;
          setOHand(prev => {
              const n = [...(prev || [])];
              n.splice(idx, 1);
              return n;
          });
          addToGraveTop(moved);
          setDragIdx(null);
          return;
      }

    // Slot → Grave
    if (src.kind === 'slot') {
      const moved = boardSlots?.[src.key];
      if (!moved) return;
      setBoardSlots(prev => { const up={...(prev||{})}; delete up[src.key]; return up; });
      clearSlotCountersAndLabels(src.key);
      addToGraveTop(moved);
      return;
    }

    // Shield/Banish/Deck → Grave
    if (src.kind === 'shield') { const m = getShieldTop(); if (!m) return; removeShieldTop(); addToGraveTop(m); return; }
    if (src.kind === 'banish') { const m = getBanishTop(); if (!m) return; removeBanishTop(); addToGraveTop(m); return; }
    if (src.kind === 'deck')   { const m = getDeckTop();   if (!m) return; removeDeckTop();   addToGraveTop(m); return; }
      // NEW: Opponent stacks → Grave
      if (src.kind === 'oshield') { const m = getOShieldTop(); if (!m) return; removeOShieldTop(); addToGraveTop(m); return; }
      if (src.kind === 'obanish') { const m = getOBanishTop(); if (!m) return; removeOBanishTop(); addToGraveTop(m); return; }
      if (src.kind === 'odeck') { const m = getODeckTop(); if (!m) return; removeODeckTop(); addToGraveTop(m); return; }
      if (src.kind === 'ograve') { const m = getOGraveTop(); if (!m) return; removeOGraveTop(); addToGraveTop(m); return; }

    // Partner → Grave
    if (src.kind === 'partner' && partnerId) {
      addToGraveTop(partnerId);
      clearSlotCountersAndLabels('partner');
      if (typeof setPartnerInArea === 'function') setPartnerInArea(false);
      return;
    }
  };
    const onGraveDragStart = (e) => {
        const top = getGraveTop();
        if (!top) { e.preventDefault(); return; }
        setGlobalDrag({ kind: 'grave', id: top });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `grave:${top}`);
        beginDrag(e);
    };

  // ------------ Deck pile DnD ------------
  const onDeckDragOver = (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch {} };
  const onDeckDrop = (e) => {
    e.preventDefault();
    const src = getDragSource(e);
    if (!src) return;

    // Hand → Deck (top)
    if (src.kind === 'hand' && Number.isFinite(src.index)) {
      const idx = src.index;
      const moved = hand?.[idx];
      if (moved == null) return;
      setHand(prev => { const n=[...prev]; n.splice(idx,1); return n; });
      addToDeckTop(moved);
      setDragIdx(null);
      return;
    }

      // Opponent Hand → Deck (top)
      if (src.kind === 'ohand' && Number.isFinite(src.index)) {
          const idx = src.index;
          const moved = oHand?.[idx];
          if (moved == null) return;
          setOHand(prev => {
              const n = [...(prev || [])];
              n.splice(idx, 1);
              return n;
          });
          addToDeckTop(moved);
          setDragIdx(null);
          return;
      }

    // Slot → Deck (top)
    if (src.kind === 'slot') {
      const moved = boardSlots?.[src.key];
      if (!moved) return;
      setBoardSlots(prev => { const up={...(prev||{})}; delete up[src.key]; return up; });
      clearSlotCountersAndLabels(src.key);
      addToDeckTop(moved);
      return;
    }

    // Shield/Banish/Grave → Deck (top)
    if (src.kind === 'shield') { const m = getShieldTop(); if (!m) return; removeShieldTop(); addToDeckTop(m); return; }
    if (src.kind === 'banish') { const m = getBanishTop(); if (!m) return; removeBanishTop(); addToDeckTop(m); return; }
    if (src.kind === 'grave')  { const m = getGraveTop();  if (!m) return; removeGraveTop();  addToDeckTop(m); return; }
      // NEW: Opponent stacks → Deck (top)
      if (src.kind === 'oshield') { const m = getOShieldTop(); if (!m) return; removeOShieldTop(); addToDeckTop(m); return; }
      if (src.kind === 'ograve') { const m = getOGraveTop(); if (!m) return; removeOGraveTop(); addToDeckTop(m); return; }
      if (src.kind === 'obanish') { const m = getOBanishTop(); if (!m) return; removeOBanishTop(); addToDeckTop(m); return; }
      if (src.kind === 'odeck') { const m = getODeckTop(); if (!m) return; removeODeckTop(); addToDeckTop(m); return; }

    // Partner → Deck (top)
    if (src.kind === 'partner' && partnerId) {
      addToDeckTop(partnerId);
      clearSlotCountersAndLabels('partner');
      if (typeof setPartnerInArea === 'function') setPartnerInArea(false);
      return;
    }
  };

    // ------------ Opponent stacks DnD (drop targets) ------------
    const onOShieldDragOver = (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch { } };
    const onOShieldDrop = (e) => {
        e.preventDefault();
        const src = getDragSource(e);
        if (!src) return;

        // Hand → Opponent Shield
        if (src.kind === 'hand' && Number.isFinite(src.index)) {
            const idx = src.index;
            const moved = hand?.[idx];
            if (moved == null) return;
            setHand(prev => { const n = [...prev]; n.splice(idx, 1); return n; });
            addToOShieldShuffled(moved);
            setDragIdx(null);
            return;
        }

        // Opponent Hand → Opponent Shield
        if (src.kind === 'ohand' && Number.isFinite(src.index)) {
            const idx = src.index;
            const moved = oHand?.[idx];
            if (moved == null) return;
            setOHand(prev => {
                const n = [...(prev || [])];
                n.splice(idx, 1);
                return n;
            });
            addToOShieldShuffled(moved);
            setDragIdx(null);
            return;
        }

        // Slot → Opponent Shield
        if (src.kind === 'slot') {
            const moved = boardSlots?.[src.key];
            if (!moved) return;
            setBoardSlots(prev => { const up = { ...(prev || {}) }; delete up[src.key]; return up; });
            clearSlotCountersAndLabels(src.key);
            addToOShieldShuffled(moved);
            return;
        }

        // Player stacks → Opponent Shield
        if (src.kind === 'deck') { const m = deckPile?.[0]; if (!m) return; setDeckPile(p => p.slice(1)); addToOShieldShuffled(m); return; }
        if (src.kind === 'grave') { const m = gravePile?.[0]; if (!m) return; setGravePile(p => p.slice(1)); addToOShieldShuffled(m); return; }
        if (src.kind === 'banish') { const m = banishPile?.[0]; if (!m) return; setBanishPile(p => p.slice(1)); addToOShieldShuffled(m); return; }

        // NEW: Opponent stacks → Opponent Shield
        if (src.kind === 'odeck') { const m = getODeckTop(); if (!m) return; removeODeckTop(); addToOShieldShuffled(m); return; }
        if (src.kind === 'ograve') { const m = getOGraveTop(); if (!m) return; removeOGraveTop(); addToOShieldShuffled(m); return; }
        if (src.kind === 'obanish') { const m = getOBanishTop(); if (!m) return; removeOBanishTop(); addToOShieldShuffled(m); return; }

        // Partner → Opponent Shield
        if (src.kind === 'partner' && partnerId) {
            addToOShieldShuffled(partnerId);
            clearSlotCountersAndLabels('partner');
            if (typeof setPartnerInArea === 'function') setPartnerInArea(false);
            return;
        }
    };

    const onOBanishDragOver = (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch { } };
    const onOBanishDrop = (e) => {
        e.preventDefault();
        const src = getDragSource(e);
        if (!src) return;

        if (src.kind === 'hand' && Number.isFinite(src.index)) {
            const idx = src.index;
            const moved = hand?.[idx];
            if (moved == null) return;
            setHand(prev => { const n = [...prev]; n.splice(idx, 1); return n; });
            addToOBanishTop(moved);
            setDragIdx(null);
            return;
        }

        // Opponent Hand → Opponent Banish
        if (src.kind === 'ohand' && Number.isFinite(src.index)) {
            const idx = src.index;
            const moved = oHand?.[idx];
            if (moved == null) return;
            setOHand(prev => {
                const n = [...(prev || [])];
                n.splice(idx, 1);
                return n;
            });
            addToOBanishTop(moved);
            setDragIdx(null);
            return;
        }

        if (src.kind === 'slot') {
            const moved = boardSlots?.[src.key];
            if (!moved) return;
            setBoardSlots(prev => { const up = { ...(prev || {}) }; delete up[src.key]; return up; });
            clearSlotCountersAndLabels(src.key);
            addToOBanishTop(moved);
            return;
        }

        // Player stacks → Opponent Banish
        if (src.kind === 'shield') { const m = shieldPile?.[0]; if (!m) return; setShieldPile(p => p.slice(1)); addToOBanishTop(m); return; }
        if (src.kind === 'deck') { const m = deckPile?.[0]; if (!m) return; setDeckPile(p => p.slice(1)); addToOBanishTop(m); return; }
        if (src.kind === 'grave') { const m = gravePile?.[0]; if (!m) return; setGravePile(p => p.slice(1)); addToOBanishTop(m); return; }

        // NEW: Opponent stacks → Opponent Banish
        if (src.kind === 'oshield') { const m = getOShieldTop(); if (!m) return; removeOShieldTop(); addToOBanishTop(m); return; }
        if (src.kind === 'odeck') { const m = getODeckTop(); if (!m) return; removeODeckTop(); addToOBanishTop(m); return; }
        if (src.kind === 'ograve') { const m = getOGraveTop(); if (!m) return; removeOGraveTop(); addToOBanishTop(m); return; }

        if (src.kind === 'partner' && partnerId) {
            addToOBanishTop(partnerId);
            clearSlotCountersAndLabels('partner');
            if (typeof setPartnerInArea === 'function') setPartnerInArea(false);
            return;
        }
    };

    const onOGraveDragOver = (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch { } };
    const onOGraveDrop = (e) => {
        e.preventDefault();
        const src = getDragSource(e);
        if (!src) return;

        if (src.kind === 'hand' && Number.isFinite(src.index)) {
            const idx = src.index;
            const moved = hand?.[idx];
            if (moved == null) return;
            setHand(prev => { const n = [...prev]; n.splice(idx, 1); return n; });
            addToOGraveTop(moved);
            setDragIdx(null);
            return;
        }

        // Opponent Hand → Opponent Grave
        if (src.kind === 'ohand' && Number.isFinite(src.index)) {
            const idx = src.index;
            const moved = oHand?.[idx];
            if (moved == null) return;
            setOHand(prev => {
                const n = [...(prev || [])];
                n.splice(idx, 1);
                return n;
            });
            addToOGraveTop(moved);
            setDragIdx(null);
            return;
        }

        if (src.kind === 'slot') {
            const moved = boardSlots?.[src.key];
            if (!moved) return;
            setBoardSlots(prev => { const up = { ...(prev || {}) }; delete up[src.key]; return up; });
            clearSlotCountersAndLabels(src.key);
            addToOGraveTop(moved);
            return;
        }

        // Player stacks → Opponent Grave
        if (src.kind === 'shield') { const m = shieldPile?.[0]; if (!m) return; setShieldPile(p => p.slice(1)); addToOGraveTop(m); return; }
        if (src.kind === 'banish') { const m = banishPile?.[0]; if (!m) return; setBanishPile(p => p.slice(1)); addToOGraveTop(m); return; }
        if (src.kind === 'deck') { const m = deckPile?.[0]; if (!m) return; setDeckPile(p => p.slice(1)); addToOGraveTop(m); return; }

        // NEW: Opponent stacks → Opponent Grave
        if (src.kind === 'oshield') { const m = getOShieldTop(); if (!m) return; removeOShieldTop(); addToOGraveTop(m); return; }
        if (src.kind === 'obanish') { const m = getOBanishTop(); if (!m) return; removeOBanishTop(); addToOGraveTop(m); return; }
        if (src.kind === 'odeck') { const m = getODeckTop(); if (!m) return; removeODeckTop(); addToOGraveTop(m); return; }

        if (src.kind === 'partner' && partnerId) {
            addToOGraveTop(partnerId);
            clearSlotCountersAndLabels('partner');
            if (typeof setPartnerInArea === 'function') setPartnerInArea(false);
            return;
        }
    };

    const onODeckDragOver = (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch { } };
    const onODeckDrop = (e) => {
        e.preventDefault();
        const src = getDragSource(e);
        if (!src) return;

        if (src.kind === 'hand' && Number.isFinite(src.index)) {
            const idx = src.index;
            const moved = hand?.[idx];
            if (moved == null) return;
            setHand(prev => { const n = [...prev]; n.splice(idx, 1); return n; });
            addToODeckTop(moved);
            setDragIdx(null);
            return;
        }

        // Opponent Hand → Opponent Deck (top)
        if (src.kind === 'ohand' && Number.isFinite(src.index)) {
            const idx = src.index;
            const moved = oHand?.[idx];
            if (moved == null) return;
            setOHand(prev => {
                const n = [...(prev || [])];
                n.splice(idx, 1);
                return n;
            });
            addToODeckTop(moved);
            setDragIdx(null);
            return;
        }

        if (src.kind === 'slot') {
            const moved = boardSlots?.[src.key];
            if (!moved) return;
            setBoardSlots(prev => { const up = { ...(prev || {}) }; delete up[src.key]; return up; });
            clearSlotCountersAndLabels(src.key);
            addToODeckTop(moved);
            return;
        }

        // Player stacks → Opponent Deck
        if (src.kind === 'shield') { const m = shieldPile?.[0]; if (!m) return; setShieldPile(p => p.slice(1)); addToODeckTop(m); return; }
        if (src.kind === 'banish') { const m = banishPile?.[0]; if (!m) return; setBanishPile(p => p.slice(1)); addToODeckTop(m); return; }
        if (src.kind === 'grave') { const m = gravePile?.[0]; if (!m) return; setGravePile(p => p.slice(1)); addToODeckTop(m); return; }

        // NEW: Opponent stacks → Opponent Deck
        if (src.kind === 'oshield') { const m = getOShieldTop(); if (!m) return; removeOShieldTop(); addToODeckTop(m); return; }
        if (src.kind === 'obanish') { const m = getOBanishTop(); if (!m) return; removeOBanishTop(); addToODeckTop(m); return; }
        if (src.kind === 'ograve') { const m = getOGraveTop(); if (!m) return; removeOGraveTop(); addToODeckTop(m); return; }

        if (src.kind === 'partner' && partnerId) {
            addToODeckTop(partnerId);
            clearSlotCountersAndLabels('partner');
            if (typeof setPartnerInArea === 'function') setPartnerInArea(false);
            return;
        }
    };

    // --- Opponent stack drag starts (top-card) ---
    const onOShieldDragStart = (e) => {
        const top = getOShieldTop();
        if (!top) { e.preventDefault(); return; }
        setGlobalDrag({ kind: 'oshield', id: top });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `oshield:${top}`);
        beginDrag(e);
    };
    const onOBanishDragStart = (e) => {
        const top = getOBanishTop();
        if (!top) { e.preventDefault(); return; }
        setGlobalDrag({ kind: 'obanish', id: top });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `obanish:${top}`);
        beginDrag(e);
    };
    const onOGraveDragStart = (e) => {
        const top = getOGraveTop();
        if (!top) { e.preventDefault(); return; }
        setGlobalDrag({ kind: 'ograve', id: top });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `ograve:${top}`);
        beginDrag(e);
    };
    const onODeckDragStart = (e) => {
        const top = getODeckTop();
        if (!top) { e.preventDefault(); return; }
        setGlobalDrag({ kind: 'odeck', id: top });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `odeck:${top}`);
        beginDrag(e);
    };

    const onDeckDragStart = (e) => {
        const top = getDeckTop();
        if (!top) { e.preventDefault(); return; }
        setGlobalDrag({ kind: 'deck', id: top });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `deck:${top}`);
        beginDrag(e);
    };

    return {
        // payload utils
        getDragSource,

        // hand
        onHandDragStart, onHandDragEnd, onHandContainerDragOver, onHandContainerDrop,
        onHandItemDragOver, onHandItemDrop,

        // opponent hand
        onOHandDragStart, onOHandDragEnd, onOHandContainerDragOver, onOHandContainerDrop,
        onOHandItemDragOver, onOHandItemDrop,

        // board slots
        onSlotDragOver, onSlotDragLeave, onSlotDrop, onSlotCardDragStart, onSlotCardDragEnd,

        // partner zone
        onPartnerDragStart, onPartnerAreaDragOver, onPartnerAreaDrop,

        // shield
        onShieldDragOver, onShieldDrop, onShieldDragStart,

        // banish
        onBanishDragOver, onBanishDrop, onBanishDragStart,

        // grave
        onGraveDragOver, onGraveDrop, onGraveDragStart,

        // deck
        onDeckDragOver, onDeckDrop, onDeckDragStart,

        // NEW: opponent stack drop targets + drag starts
        onOShieldDragOver, onOShieldDrop, onOShieldDragStart,
        onOBanishDragOver, onOBanishDrop, onOBanishDragStart,
        onOGraveDragOver, onOGraveDrop, onOGraveDragStart,
        onODeckDragOver, onODeckDrop, onODeckDragStart,
    };
}
