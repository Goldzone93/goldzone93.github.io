// /src/plugins/playtest-board-dragndown.jsx
import { openPlayCostModal, getAvailableElements, spendElements } from "./playtest-board-costmodal";
/* Drag & Drop + stack move handlers for the Playtest Board.
   This file exports a single function that wires up all handler functions
   without owning state. You pass in the current state values and setters.
*/
export function usePlaytestBoardDragNDown(ctx) {
  // ------------ Shortcuts ------------
  const {
    partnerId, partnerSide,
    boardSlots, setBoardSlots,
    slotSides, setSlotSides,
    slotCounters, setSlotCounters,
    slotLabels, setSlotLabels,
    hand, setHand,
    deckPile, setDeckPile,
    shieldPile, setShieldPile,
    banishPile, setBanishPile,
    gravePile, setGravePile,
    dragIdx, setDragIdx,
    setHoverSlot,
    setExhaustedSlots,
    setBattleRole, battleRoleRef,
    setBattleOrigin, battleOriginRef,
  } = ctx || {};

    // --- Global drag fallback (fix sporadic missing dataTransfer on first drag) ---
    const setGlobalDrag = (payload) => { try { window.__PB_LAST_DRAG = payload; } catch { } };
    const clearGlobalDrag = () => { try { delete window.__PB_LAST_DRAG; } catch { } };

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
    if (!/^b\d+$/.test(String(slotKey || ''))) return;
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
          if (pb.startsWith('slot:')) return { kind: 'slot', key: pb.slice(5) };
          if (pb.startsWith('partner:')) return { kind: 'partner', id: pb.slice(8) };
          if (pb.startsWith('shield:')) return { kind: 'shield', id: pb.slice(7) };
          if (pb.startsWith('banish:')) return { kind: 'banish', id: pb.slice(7) };
          if (pb.startsWith('grave:')) return { kind: 'grave', id: pb.slice(6) };
          if (pb.startsWith('deck:')) return { kind: 'deck', id: pb.slice(5) };
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
        e.dataTransfer.setData('text/plain', String(index)); // fallback
    };
    const onHandDragEnd = () => { setDragIdx(null); clearGlobalDrag(); };
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

    // Partner → Hand (avoid dups)
    if (src.kind === 'partner' && partnerId) {
      setHand(prev => (prev.includes(partnerId) ? prev : [...prev, partnerId]));
      // clear partner-slot counters/labels if leaving that zone
      clearSlotCountersAndLabels('partner');
      setDragIdx(null);
      return;
    }

    // Shield/Banish/Grave/Deck (top) → Hand (append)
    if (src.kind === 'shield') { const m = getShieldTop(); if (!m) return; removeShieldTop(); setHand(prev => [...prev, m]); setDragIdx(null); return; }
    if (src.kind === 'banish') { const m = getBanishTop(); if (!m) return; removeBanishTop(); setHand(prev => [...prev, m]); setDragIdx(null); return; }
    if (src.kind === 'grave')  { const m = getGraveTop();  if (!m) return; removeGraveTop();  setHand(prev => [...prev, m]); setDragIdx(null); return; }
    if (src.kind === 'deck')   { const m = getDeckTop();   if (!m) return; removeDeckTop();   setHand(prev => [...prev, m]); setDragIdx(null); return; }
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
  };

  // ------------ Board Slot DnD ------------
  const onSlotDragOver = (key) => (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setHoverSlot(key); };
  const onSlotDragLeave = () => setHoverSlot(null);

  const onSlotDrop = (key) => async (e) => {
      e.preventDefault();
      e.stopPropagation();
      setHoverSlot(null);
      const src = getDragSource(e);
      if (!src) return;

    // No-op if dropping a slot card onto the same slot
    if (src.kind === 'slot' && src.key === key) return;

    const prevInTarget = boardSlots?.[key] || null;

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
          const isPlaySlot = /^u\d+$|^s\d+$/.test(String(key || ""));
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
                      if (prevInTarget) next.push(prevInTarget);
                      return next;
                  });
                  setSlotSides(prev => ({ ...(prev || {}), [key]: sideFromId }));
                  if (prevInTarget) clearSlotCountersAndLabels(key);
                  setDragIdx(null);
                  return;
              }

              // Read current pool counts; you can also pass your own map here
              const available = getAvailableElements();
              const paid = await openPlayCostModal({ cardId, side: sideFromId, available });

              // Cancelled → leave everything exactly as-is
              if (!paid) { setDragIdx(null); return; }

              // Spend resources (best effort) THEN place the card
              spendElements(paid);

              setHand(prev => {
                  const next = [...prev];
                  const [card] = next.splice(from, 1);
                  setBoardSlots(cur => ({ ...(cur || {}), [key]: card }));
                  if (prevInTarget) next.push(prevInTarget);
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
              if (prevInTarget) next.push(prevInTarget);
              return next;
          });
          setSlotSides(prev => ({ ...(prev || {}), [key]: sideFromId }));
          if (prevInTarget) clearSlotCountersAndLabels(key);
          setDragIdx(null);
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
        const tracked = (slot) => /^u\d+$|^s\d+$|^b\d+$/.test(slot);
        if (prevInTarget) delete next[dstKey];
        if (srcCounters && tracked(srcKey) && tracked(dstKey)) next[dstKey] = srcCounters;
        delete next[srcKey];
        return next;
      });

      // labels mirror
      setSlotLabels(prev => {
        const next = { ...(prev || {}) };
        const srcLabels = next[srcKey];
        const tracked = (slot) => /^u\d+$|^s\d+$|^b\d+$/.test(slot);
        if (prevInTarget) delete next[dstKey];
        if (srcLabels && tracked(srcKey) && tracked(dstKey)) next[dstKey] = srcLabels;
        delete next[srcKey];
        return next;
      });

      clearBattleFlagsIfSource(srcKey);

      if (prevInTarget) setHand(prev => [...prev, prevInTarget]);
      return;
    }

    // Shield/Banish/Grave/Deck → Slot
    const moveTopToSlot = (getTop, removeTop) => {
      const moved = getTop();
      if (!moved) return;
      setBoardSlots(prev => ({ ...(prev || {}), [key]: moved }));
      setSlotSides(prev => ({ ...(prev || {}), [key]: 'a' }));
      removeTop();
      if (prevInTarget) {
        clearSlotCountersAndLabels(key);
        setHand(prev => [...prev, prevInTarget]);
      }
    };

    if (src.kind === 'shield') { moveTopToSlot(getShieldTop, removeShieldTop); return; }
    if (src.kind === 'banish') { moveTopToSlot(getBanishTop, removeBanishTop); return; }
    if (src.kind === 'grave')  { moveTopToSlot(getGraveTop,  removeGraveTop ); return; }
    if (src.kind === 'deck')   { moveTopToSlot(getDeckTop,   removeDeckTop  ); return; }

      // Partner → Slot (unique copy; carry partnerSide; clear any partner-slot counters/labels)
      if (src.kind === 'partner') {
          const id = partnerId;
          if (!id) return;

          // Only trigger Cost Modal when dropping to a Unit/Support slot AND partner is on back side
          const isPlaySlot = /^u\d+$|^s\d+$/.test(String(key || ""));
          const mode = (typeof window !== 'undefined' && window.__PB_COST_MODULE_MODE) || 'on';
          const shouldUseCostModal = (mode !== 'off') && isPlaySlot && (String(partnerSide) === 'b');

          if (shouldUseCostModal) {
              // Open Cost Modal for the partner's back side
              const available = getAvailableElements();
              const paid = await openPlayCostModal({ cardId: id, side: 'b', available });
              // If cancelled, do nothing
              if (!paid) { return; }
              // Apply spend then place
              spendElements(paid);
          }

          setBoardSlots(prev => {
              let existingKey = null;
              for (const k in (prev || {})) if (prev[k] === id) { existingKey = k; break; }
              const up = { ...(prev || {}) };
              if (existingKey && existingKey !== key) delete up[existingKey];
              up[key] = id;
              return up;
          });

          // Preserve the current partnerSide (a/b) when placing
          setSlotSides(prev => ({ ...(prev || {}), [key]: partnerSide || 'a' }));

          if (prevInTarget) setHand(prev => [...prev, prevInTarget]);

          clearSlotCountersAndLabels(key);       // drop counters/labels on the card we bumped
          clearSlotCountersAndLabels('partner'); // and partner-slot
          return;
      }
  };

  // dragging a placed card
    const onSlotCardDragStart = (key) => (e) => {
        setGlobalDrag({ kind: 'slot', key });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `slot:${key}`);
    };
    const onSlotCardDragEnd = () => { clearGlobalDrag(); };

  // ------------ Partner zone DnD ------------
    const onPartnerDragStart = (e) => {
        if (!partnerId) return;
        setGlobalDrag({ kind: 'partner', id: partnerId });
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('text/pb', `partner:${partnerId}`);
    };
  const onPartnerAreaDragOver = (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch {} };

  const onPartnerAreaDrop = (e) => {
    e.preventDefault();
    const src = getDragSource(e);
    if (!src) return;

    // From a slot: remove partner from that slot
      if (src.kind === 'slot' && boardSlots?.[src.key] === partnerId) {
          const srcKey = src.key;

          setBoardSlots(prev => {
              if (!prev?.[srcKey]) return prev;
              const up = { ...prev };
              delete up[srcKey];
              return up;
          });

          // Also clear any side set on the vacated slot
          setSlotSides(prev => {
              if (!prev?.[srcKey]) return prev;
              const up = { ...prev };
              delete up[srcKey];
              return up;
          });

          // Clear exhaustion and any battle flags on that slot
          setExhaustedSlots(prev => {
              if (!prev?.size) return prev;
              const next = new Set(prev);
              next.delete(srcKey);
              return next;
          });
          clearBattleFlagsIfSource(srcKey);

          clearSlotCountersAndLabels(srcKey);
          return;
      }

    // From hand: remove partner from hand
    if (src.kind === 'hand' && hand?.[src.index] === partnerId) {
      const idx = src.index;
      setHand(prev => {
        const next = [...prev];
        next.splice(idx, 1);
        return next;
      });
      setDragIdx(null);
      return;
    }

    // From stacks: if partner is the top, remove from that stack (returns to zone)
    if (src.kind === 'banish' && banishPile?.[0] === partnerId) { setBanishPile(p => (p?.length ? p.slice(1) : p)); return; }
    if (src.kind === 'grave'  && gravePile?.[0]  === partnerId) { setGravePile(p => (p?.length ? p.slice(1) : p));  return; }
    if (src.kind === 'deck'   && deckPile?.[0]   === partnerId) { setDeckPile(p => (p?.length ? p.slice(1) : p));   return; }

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

    // Partner → Shield
    if (src.kind === 'partner' && partnerId) {
      addAndShuffle(partnerId);
      clearSlotCountersAndLabels('partner');
      return;
    }
  };
    const onShieldDragStart = (e) => {
        const top = getShieldTop();
        if (!top) { e.preventDefault(); return; }
        setGlobalDrag({ kind: 'shield', id: top });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `shield:${top}`);
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

    // Partner → Banish
    if (src.kind === 'partner' && partnerId) {
      addToBanishTop(partnerId);
      clearSlotCountersAndLabels('partner');
      return;
    }
  };
    const onBanishDragStart = (e) => {
        const top = getBanishTop();
        if (!top) { e.preventDefault(); return; }
        setGlobalDrag({ kind: 'banish', id: top });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `banish:${top}`);
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

    // Partner → Grave
    if (src.kind === 'partner' && partnerId) {
      addToGraveTop(partnerId);
      clearSlotCountersAndLabels('partner');
      return;
    }
  };
    const onGraveDragStart = (e) => {
        const top = getGraveTop();
        if (!top) { e.preventDefault(); return; }
        setGlobalDrag({ kind: 'grave', id: top });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `grave:${top}`);
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

    // Partner → Deck (top)
    if (src.kind === 'partner' && partnerId) {
      addToDeckTop(partnerId);
      clearSlotCountersAndLabels('partner');
      return;
    }
  };
    const onDeckDragStart = (e) => {
        const top = getDeckTop();
        if (!top) { e.preventDefault(); return; }
        setGlobalDrag({ kind: 'deck', id: top });
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/pb', `deck:${top}`);
    };

  return {
    // payload utils
    getDragSource,

    // hand
    onHandDragStart, onHandDragEnd, onHandContainerDragOver, onHandContainerDrop,
    onHandItemDragOver, onHandItemDrop,

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
  };
}
