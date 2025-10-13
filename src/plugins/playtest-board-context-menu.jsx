// /src/plugins/playtest-board-context-menu.jsx
// Context menu framework for the Playtest Board (right-click / long-press)
// Minimal, dependency-free. Dispatches 'pb:ctx:action' events; no direct game logic.
// Usage: this file is side-effect imported by playtest-board.jsx.

import '../styles/playtest-board-context-menu.css';
import { openPlayCostModal, getAvailableElements } from './playtest-board-costmodal.jsx';

(function initPBContextMenu() {
  if (window.__PB_CTX_MENU__) return; // singleton

  const LONG_PRESS_MS = 450;
  const Z_INDEX = 12000; // above board modals (which use 10000)

  // Simple state
  const state = {
    rootEl: null,           // the floating menu element
    anchor: { x: 0, y: 0 }, // screen coords
    context: null,          // { area, data, target }
    open: false,
    longPressTimer: null,
    builders: Object.create(null), // registry of area -> (ctx) => items[]
  };

  // Default menu builders — placeholders for now
  // Each returns an array of { id, label, disabled? } or { separator: true }
  const defaults = {
    'hand-card': (ctx) => {
      // When opened from a stack viewer/reveal, cards have data-stack set to that pile.
      // Disable sending to the *same* pile you’re currently viewing.
      const stack = String(ctx?.data?.stack || '').toLowerCase();
      const disableGrave  = stack === 'grave';
      const disableBanish = stack === 'banish';
      const disableShield = stack === 'shield';

      // If no stack is present, the source is the Hand dock → already in hand.
      const disableAddToHand = !stack;

          // Derive current side for label; prefer ctx.data.side, fallback to cardId suffix.
          const cid = String(ctx?.data?.cardId || '');
          const ds = String(ctx?.data?.side || (/_b$/i.test(cid) ? 'b' : 'a')).toLowerCase();
          const flipLabel = ds === 'b' ? 'Flip to Front' : 'Flip to Back';

      return [
        { id: 'inspect', label: 'Inspect (Zoom)' },
        { id: 'flip', label: flipLabel, disabled: !!stack }, // NEW — flip only applies to real hand cards
        { separator: true },
        { id: 'move_to_unit', label: 'Move to Unit Slot…' },
        { id: 'move_to_support', label: 'Move to Support Slot…' },
        { separator: true },
        { id: 'add_to_hand', label: 'Add to Hand', disabled: disableAddToHand }, // NEW
        { id: 'to_grave',   label: 'Send to Grave',                 disabled: disableGrave  },
        { id: 'to_banish',  label: 'Send to Banish',                disabled: disableBanish },
        { id: 'to_shield',  label: 'Put into Shield (shuffle)',     disabled: disableShield },
        { id: 'to_deck_top',    label: 'Put on Top of Deck' },
        { id: 'to_deck_bottom', label: 'Put on Bottom of Deck' },
      ];
    },
      'slot-card': (ctx) => {
          const slotKey = ctx?.data?.slotKey;
          const isPartner = slotKey === 'partner';
          const currentSide = (ctx?.data?.side || 'a').toLowerCase();
          const flipLabel = currentSide === 'b' ? 'Flip to Front' : 'Flip to Back';
          const exhausted = !!ctx?.target?.classList?.contains?.('is-exhausted');
          const label = exhausted ? 'Ready' : 'Exhaust';
          // Always show, but disable when not applicable
          const canDeclare = /^u\d+$/.test(slotKey || '');
          const canRemoveBattle = /^b\d+$/.test(slotKey || '');
          const isFirstTurn = (window.__PB_TURN_COUNT || 1) === 1;

          const items = [
              { id: 'inspect', label: 'Inspect (Zoom)' },
              { id: 'flip', label: flipLabel },
              { id: 'exhaust_toggle', label, disabled: isPartner },
              { separator: true },
              { id: 'add_counters', label: 'Add Counters…' },
              { id: 'heal_x', label: 'Heal X…' },
              { id: 'inflict_damage', label: 'Inflict/Damage X…' }, // NEW
              { id: 'modify_stat', label: 'Modify Stat…', disabled: !ctx?.target?.querySelector?.('.pb-unit-stats') },
              { id: 'clear_stat_mods', label: 'Remove Stat Changes', disabled: !ctx?.target?.querySelector?.('.pb-unit-stats') },
              { separator: true },
              { id: 'add_label', label: 'Add Label/Improve' },
              { id: 'remove_label', label: 'Remove Label…' },
          ];
          items.push(
              { separator: true },
              { id: 'declare_attacker', label: 'Declare Attacker', disabled: !canDeclare || isFirstTurn },
              { id: 'declare_blocker', label: 'Declare Blocker', disabled: !canDeclare || !!ctx?.target?.dataset?.noBlock || isFirstTurn },
              { id: 'remove_from_battle', label: 'Remove from Battle', disabled: !canRemoveBattle },
              { separator: true },
              { id: 'return_to_hand', label: 'Return to Hand' },
              { id: 'to_grave', label: 'Send to Grave' },
              { id: 'to_banish', label: 'Send to Banish' },
              { id: 'to_deck_top', label: 'Put on Top of Deck' },
              { id: 'to_deck_bottom', label: 'Put on Bottom of Deck' },
          );

          return items;
      },
    'stack-slot': (ctx) => {
      const t = ctx?.data?.stack || 'stack';
      if (t === 'deck') {
        return [
          { id: 'deck_open_view', label: 'Open Stack View' },       // NEW
          { id: 'deck_shuffle', label: 'Shuffle' },
          { separator: true },
          { id: 'deck_draw1', label: 'Draw 1 to Hand' },
          { id: 'deck_draw_x', label: 'Draw X to Hand' },
          { id: 'deck_fetch_cards', label: 'Fetch Cards…' },
          { separator: true },
          { id: 'deck_foresee_x', label: 'Foresee X Cards' },
          { id: 'deck_reveal_top', label: 'Reveal Top Card' },
          { id: 'deck_reveal_x', label: 'Reveal X Cards' },
          { separator: true },
          { id: 'deck_send_x_to_grave', label: 'Scour X Cards' },
        ];
      }
      if (t === 'shield') {
        return [
          { id: 'shield_open_view', label: 'Open Stack View' },     // NEW
          { id: 'shield_shuffle', label: 'Shuffle' },               // NEW
          { separator: true },
          { id: 'shield_reveal_top', label: 'Reveal Top' },
          { id: 'shield_reveal_x', label: 'Reveal X Cards' },
          { separator: true },
          { id: 'shield_break', label: 'Break Shield' },
          { id: 'shield_break_x', label: 'Break X Shields' },
          { separator: true },
          { id: 'shield_reinforce_x', label: 'Reinforce X…' },
          
        ];
      }
      // banish / grave
      return [
        { id: `${t}_open_view`, label: 'Open Stack View' },         // NEW
        { separator: true },
        { id: `${t}_take_top_to_hand`, label: 'Take Top to Hand' },
        { id: `${t}_to_deck_top`, label: 'Put Top on Deck' },
        { id: `${t}_to_deck_bottom`, label: 'Put Top on Bottom of Deck' }, // NEW
      ];
    },
    'viewer-card': (ctx) => [
      { id: 'inspect', label: 'Inspect (Zoom)' },
      { separator: true },
      { id: 'add_to_unit', label: 'Add to Unit Slot…' },
      { id: 'add_to_support', label: 'Add to Support Slot…' },
      { separator: true },                                        // NEW
      { id: 'add_to_hand', label: 'Add to Hand' },
      { id: 'to_grave',       label: 'Send to Grave' },           // NEW
      { id: 'to_shield',      label: 'Put into Shield (shuffle)' },// NEW
      { id: 'to_deck_top',    label: 'Put on Top of Deck' },      // NEW
      { id: 'to_deck_bottom', label: 'Put on Bottom of Deck' },   // NEW
    ],
    'global': (ctx) => [
      { id: 'new_game', label: 'New Game' },
      { id: 'reset', label: 'Reset (Clear All)' },
      { separator: true },
      { id: 'import_deck', label: 'Import Deck' },
      { id: 'help', label: 'Help', disabled: true },
    ],
  };

  // Public API (attach to window for future extensions)
  const api = (window.__PB_CTX_MENU__ = {
    register(area, builder) {
      state.builders[area] = builder;
    },
    openAt(x, y, ctx) {
      showMenu(x, y, ctx);
    },
    close() {
      hideMenu();
    },
  });

  // Build the DOM root once
  function ensureRoot() {
    if (state.rootEl) return state.rootEl;
    const el = document.createElement('div');
    el.className = 'pb-ctx-root';
    el.style.zIndex = String(Z_INDEX);
    document.body.appendChild(el);
    state.rootEl = el;
    return el;
  }

  function getBuilder(area) {
    return state.builders[area] || defaults[area] || defaults.global;
  }

  function buildItems(area, ctx) {
    const builder = getBuilder(area);
    let items = [];
    try {
      items = builder(ctx) || [];
    } catch (e) {
      items = [];
      console.warn('[PB CTX] builder error for', area, e);
    }
    // validate & normalize
    return items
      .filter(Boolean)
      .map((it, i) =>
        it.separator ? { separator: true } :
        { id: String(it.id || `item_${i}`), label: String(it.label || '(item)'), disabled: !!it.disabled }
      );
  }

  function renderMenu(area, ctx) {
    const root = ensureRoot();
    root.innerHTML = ''; // clear
    root.dataset.open = '1';

    const panel = document.createElement('div');
    panel.className = 'pb-ctx-panel';
    panel.setAttribute('role', 'menu');
    panel.tabIndex = -1;

    const list = document.createElement('ul');
    list.className = 'pb-ctx-list';

    const items = buildItems(area, ctx);
    items.forEach((it) => {
      if (it.separator) {
        const sep = document.createElement('li');
        sep.className = 'pb-ctx-sep';
        list.appendChild(sep);
        return;
      }
      const li = document.createElement('li');
      li.className = `pb-ctx-item${it.disabled ? ' is-disabled' : ''}`;
      li.setAttribute('role', 'menuitem');
      li.tabIndex = it.disabled ? -1 : 0;
      li.textContent = it.label;
      if (!it.disabled) {
        li.addEventListener('click', () => {
          dispatchAction(area, it.id, ctx);
          hideMenu();
        });
      }
      list.appendChild(li);
    });

    panel.appendChild(list);
    root.appendChild(panel);

    // position
    const rect = panel.getBoundingClientRect();
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
    const margin = 8;
    const x = Math.min(state.anchor.x, vw - rect.width - margin);
    const y = Math.min(state.anchor.y, vh - rect.height - margin);
    panel.style.left = `${Math.max(margin, x)}px`;
    panel.style.top  = `${Math.max(margin, y)}px`;

    // focus mgmt
    requestAnimationFrame(() => {
      const first = panel.querySelector('.pb-ctx-item:not(.is-disabled)');
      (first || panel).focus();
    });
  }

  function showMenu(x, y, ctx) {
    state.anchor = { x, y };
    state.context = ctx;
    state.open = true;
    renderMenu(ctx.area || 'global', ctx);
    addGlobalClosers();
  }

  function hideMenu() {
    const root = ensureRoot();
    root.innerHTML = '';
    root.removeAttribute('data-open');
    state.open = false;
    removeGlobalClosers();
  }

  function addGlobalClosers() {
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('scroll', onAnyScroll, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', hideMenu, true);
  }
  function removeGlobalClosers() {
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('scroll', onAnyScroll, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', hideMenu, true);
  }
  function onDocMouseDown(e) {
    if (!state.open) return;
    const root = ensureRoot();
    if (!root.contains(e.target)) hideMenu();
  }
  function onAnyScroll() {
    if (state.open) hideMenu();
  }
  function onKeyDown(e) {
    if (!state.open) return;
    const root = ensureRoot();
    const current = root.querySelector('.pb-ctx-item:focus');
    const items = Array.from(root.querySelectorAll('.pb-ctx-item:not(.is-disabled)'));
    if (e.key === 'Escape') {
      hideMenu();
      e.preventDefault();
      return;
    }
    if (!items.length) return;

    const idx = items.indexOf(current);
    if (e.key === 'ArrowDown') {
      const next = items[(idx + 1 + items.length) % items.length];
      next?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      const prev = items[(idx - 1 + items.length * 10) % items.length];
      prev?.focus();
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      current?.click();
      e.preventDefault();
    }
  }

  function dispatchAction(area, action, ctx) {
    // Consumers (your board) can listen for this:
    // window.addEventListener('pb:ctx:action', (e) => { console.log(e.detail) })
    const detail = { area, action, context: ctx };
    window.dispatchEvent(new CustomEvent('pb:ctx:action', { detail }));
  }

  // Area detection
  function deriveContextFromTarget(ev) {
    const withinBoard = ev.target.closest?.('.pb-root');
    if (!withinBoard) return null;

    const el = ev.target.closest('[data-menu-area]');
    if (el) {
      const area = el.getAttribute('data-menu-area');
      const data = { ...el.dataset };
      // Strip noisy dataset we don’t need
      delete data.menuArea;
      return { area, data, target: el };
    }

    // Fallback: stack slots by name attribute on .pb-slot
    const slot = ev.target.closest?.('.pb-slot');
    if (slot) {
      const name = (slot.getAttribute('data-name') || '').toLowerCase();
      const map = { deck: 'deck', shield: 'shield', grave: 'grave', banish: 'banish' };
      if (map[name]) {
        return { area: 'stack-slot', data: { stack: map[name] }, target: slot };
      }
    }

    return { area: 'global', data: {}, target: withinBoard };
  }

  // Right-click handler
    function onContextMenu(ev) {
        const ctx = deriveContextFromTarget(ev);
        if (!ctx) return; // not our board

        // Disable the "global" context menu (let the browser menu appear instead)
        if (!ctx.area || ctx.area === 'global') {
            return;
        }

        ev.preventDefault();
        ev.stopPropagation();
        showMenu(ev.clientX, ev.clientY, ctx);
    }

  // Keyboard context-menu key (Shift+F10 / dedicated key)
    function onKeydownOpen(ev) {
        if (ev.key !== 'ContextMenu' && !(ev.shiftKey && ev.key === 'F10')) return;
        const withinBoard = document.activeElement?.closest?.('.pb-root');
        if (!withinBoard) return;
        const fakeEvent = { target: document.activeElement || withinBoard };
        const ctx = deriveContextFromTarget(fakeEvent);
        if (!ctx || !ctx.area || ctx.area === 'global') return; // suppress global menu
        ev.preventDefault();
        const rect = (document.activeElement || withinBoard).getBoundingClientRect();
        showMenu(rect.left + 8, rect.top + 8, ctx);
    }

  // Long-press (mobile)
  function attachLongPress(container) {
    if (!container) return;
    container.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const startTarget = e.target;
        state.longPressTimer = setTimeout(() => {
            const ctx = deriveContextFromTarget({ target: startTarget });
            if (!ctx || !ctx.area || ctx.area === 'global') return; // suppress global menu
            showMenu(t.clientX, t.clientY, ctx);
        }, LONG_PRESS_MS);
    }, { passive: true });

    const cancel = () => { clearTimeout(state.longPressTimer); state.longPressTimer = null; };
    container.addEventListener('touchend', cancel, { passive: true });
    container.addEventListener('touchmove', cancel, { passive: true });
    container.addEventListener('touchcancel', cancel, { passive: true });
  }

  // Wire it up
  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('keydown', onKeydownOpen, true);

  // Defer long-press hookup until .pb-root exists
  const tryAttach = () => {
    const root = document.querySelector('.pb-root');
    if (root) attachLongPress(root); else setTimeout(tryAttach, 250);
  };
  tryAttach();

  // Expose defaults so you can inspect/override later if desired
  api.defaults = defaults;
})();

// Exported from the context-menu plugin: installs the action handlers that used to live in playtest-board.jsx
export function installPBActionHandlers(host) {
    // --- small helpers that only use "host" (React setters/state refs) ---

    const tryZoom = (target) => {
        if (!target) return;
        const btn =
            target.querySelector?.('.zoom-btn') ||
            target.closest?.('.pb-slot-card')?.querySelector?.('.zoom-btn') ||
            target.closest?.('.pb-gallery-card')?.querySelector?.('.zoom-btn');
        if (btn) btn.click();
    };

    const toHand = (cardId) => {
        if (!cardId) return;
        host.setHand((prev) => {
            if (cardId === host.partnerId && prev.includes(host.partnerId)) return prev;
            return [...prev, cardId];
        });
    };
    const toGraveTop = (cardId) => { if (cardId) host.setGravePile((p) => [cardId, ...p]); };
    const toBanishTop = (cardId) => { if (cardId) host.setBanishPile((p) => [cardId, ...p]); };
    const toDeckTop = (cardId) => { if (cardId) host.setDeckPile((p) => [cardId, ...p]); };
    const toDeckBottom = (cardId) => { if (cardId) host.setDeckPile((p) => [...p, cardId]); };

    const shieldShuffleIn = (cardId) => {
        if (!cardId) return;
        host.setShieldPile((prev) => {
            const next = [...prev, cardId];
            for (let i = next.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [next[i], next[j]] = [next[j], next[i]];
            }
            return next;
        });
    };

    const removeHandAt = (idx, routeFn) => {
        if (!Number.isFinite(idx)) return;
        host.setHand((prev) => {
            const next = [...prev];
            if (idx < 0 || idx >= next.length) return prev;
            const [moved] = next.splice(idx, 1);
            if (moved) routeFn?.(moved);
            return next;
        });
    };

    const removeSlotCard = (slotKey, routeFn) => {
        if (!slotKey) return;
        host.setBoardSlots((prev) => {
            const current = prev[slotKey];
            if (!current) return prev;
            const up = { ...prev };
            delete up[slotKey];
            routeFn?.(current);
            return up;
        });
        host.setExhaustedSlots((prev) => {
            const next = new Set(prev);
            next.delete(slotKey);
            return next;
        });
        host.setSlotSides((prev) => {
            if (!prev?.[slotKey]) return prev;
            const next = { ...prev };
            delete next[slotKey];
            return next;
        });
        host.setSlotCounters((prev) => {
            if (!prev?.[slotKey]) return prev;
            const next = { ...prev };
            delete next[slotKey];
            return next;
        });
        // Clear any stat mods for this slot
        host.setSlotStatMods?.((prev) => {
            if (!prev?.[slotKey]) return prev;
            const next = { ...(prev || {}) };
            delete next[slotKey];
            return next;
        });
        // NEW: clear any ad hoc labels for this slot
        host.setSlotLabels?.((prev) => {
            if (!prev?.[slotKey]) return prev;
            const next = { ...(prev || {}) };
            delete next[slotKey];
            return next;
        });
        // NEW — if removing from a battle slot, clear battle role & origin
        if (/^b\d+$/.test(String(slotKey)) && host.setBattleRole) {
            host.setBattleRole(prev => {
                const up = { ...(prev || {}) };
                delete up[slotKey];
                return up;
            });
            if (host.setBattleOrigin) {
                host.setBattleOrigin(prev => {
                    const up = { ...(prev || {}) };
                    delete up[slotKey];
                    return up;
                });
            }
        };
    };

    const deckPopTop = (routeFn) => {
        host.setDeckPile((prev) => {
            if (!prev.length) return prev;
            const [top, ...rest] = prev;
            routeFn?.(top);
            return rest;
        });
    };
    const gravePopTop = (routeFn) => {
        host.setGravePile((prev) => {
            if (!prev.length) return prev;
            const [top, ...rest] = prev;
            routeFn?.(top);
            return rest;
        });
    };
    const banishPopTop = (routeFn) => {
        host.setBanishPile((prev) => {
            if (!prev.length) return prev;
            const [top, ...rest] = prev;
            routeFn?.(top);
            return rest;
        });
    };
    const shieldPopTop = (routeFn) => {
        host.setShieldPile((prev) => {
            if (!prev.length) return prev;
            const [top, ...rest] = prev;
            routeFn?.(top);
            return rest;
        });
    };

    // Keep Stack View (peek) in sync when removing by index or id
    const removeFromStackInPeek = (stack, indexMaybe, idMaybe, routeFn) => {
        const spliceBy = (arr) => {
            // For DECK/GRAVE peeks the index can be stale; prefer removal by id
            if (!['deck', 'grave'].includes(stack) && Number.isFinite(indexMaybe) && indexMaybe >= 0 && indexMaybe < arr.length) {
                const next = [...arr];
                const [moved] = next.splice(indexMaybe, 1);
                if (moved) routeFn?.(moved);
                updateOpenPeek(indexMaybe, moved);
                return next;
            }
            const k = idMaybe ? arr.indexOf(idMaybe) : -1;
            if (k === -1) return arr;
            const next = [...arr];
            const [moved] = next.splice(k, 1);
            if (moved) routeFn?.(moved);
            updateOpenPeek(k, moved);
            return next;
        };

        const updateOpenPeek = (_removedIndex, removedId) => {
            host.setPeekCard((prev) => {
                if (!prev) return prev;
                if (Array.isArray(prev.ids)) {
                    const next = [...prev.ids];
                    const k = removedId != null ? next.indexOf(removedId)
                        : (Number.isFinite(_removedIndex) ? _removedIndex : -1);
                    if (k >= 0 && k < next.length) next.splice(k, 1);
                    return next.length ? { ...prev, ids: next } : null;
                }
                return null;
            });
        };

        if (stack === 'deck') host.setDeckPile(spliceBy);
        if (stack === 'shield') host.setShieldPile(spliceBy);
        if (stack === 'grave') host.setGravePile(spliceBy);
        if (stack === 'banish') host.setBanishPile(spliceBy);
    };

    // --- main handler moved from playtest-board.jsx ---
    const onAction = async (e) => {
        const detail = e?.detail || {};
        const area = detail.area;
        const action = detail.action;
        const ctx = detail.context || {};
        const data = ctx.data || {};
        const target = ctx.target || null;

        if (area === 'hand-card') {
            const idx = Number.parseInt(data.index, 10);
            const cardId = data.cardId;

            const hostEl = target?.closest?.('[data-menu-area="hand-card"]') || target;
            const domStack = hostEl?.getAttribute?.('data-stack');
            const domPeekIndexRaw = hostEl?.getAttribute?.('data-peek-index');

            const pStack = String(data.stack || domStack || '').toLowerCase();
            const pIdx = Number.isFinite(Number.parseInt(data.peekIndex, 10))
                ? Number.parseInt(data.peekIndex, 10)
                : Number.parseInt(domPeekIndexRaw, 10);

            const fromPeek = (pStack === 'deck' || pStack === 'shield' || pStack === 'grave' || pStack === 'banish');

            if (action === 'inspect') { tryZoom(target); return; }

            if (fromPeek && cardId) {
                const route = (fn) => removeFromStackInPeek(pStack, pIdx, cardId, fn);

                if (action === 'add_to_hand') route(toHand);
                else if (action === 'to_grave') route(toGraveTop);
                else if (action === 'to_banish') route(toBanishTop);
                else if (action === 'to_shield') route(shieldShuffleIn);
                else if (action === 'to_deck_top') {
                    if (pStack === 'deck') {
                        host.setDeckPile((prev) => {
                            const next = [...prev];
                            const k = next.indexOf(cardId);
                            if (k === -1) return prev;
                            const [m] = next.splice(k, 1);
                            next.unshift(m);
                            return next;
                        });
                        host.setPeekCard((prev) => {
                            if (!prev) return prev;
                            if (Array.isArray(prev.ids)) {
                                const ids = [...prev.ids];
                                const k = ids.indexOf(cardId);
                                if (k === -1) return prev;
                                ids.splice(k, 1);
                                if (prev.all) { ids.unshift(cardId); return { ...prev, ids }; }
                                return ids.length ? { ...prev, ids } : null;
                            }
                            return null;
                        });
                    } else {
                        route(toDeckTop);
                    }
                }
                else if (action === 'to_deck_bottom') {
                    if (pStack === 'deck') {
                        host.setDeckPile((prev) => {
                            const next = [...prev];
                            const k = next.indexOf(cardId);
                            if (k === -1) return prev;
                            const [m] = next.splice(k, 1);
                            next.push(m);
                            return next;
                        });
                        host.setPeekCard((prev) => {
                            if (!prev) return prev;
                            if (Array.isArray(prev.ids)) {
                                const ids = [...prev.ids];
                                const k = ids.indexOf(cardId);
                                if (k === -1) return prev;
                                ids.splice(k, 1);
                                if (prev.all) { ids.push(cardId); return { ...prev, ids }; }
                                return ids.length ? { ...prev, ids } : null;
                            }
                            return null;
                        });
                    } else {
                        route(toDeckBottom);
                    }
                }
                else if (action === 'move_to_unit' || action === 'move_to_support') {
                    removeFromStackInPeek(pStack, pIdx, cardId, () => { });
                    host.setPendingPlace({ source: 'viewer', cardId, target: action === 'move_to_unit' ? 'unit' : 'support' });
                    const modal = target?.closest?.('.pb-modal');
                    if (modal) {
                        modal.classList.add('is-hidden');
                        window.__PB_SUSPENDED_MODAL = modal;
                    }
                }
                return;
            }

            // Non-peek hand actions
            if (action === 'to_grave') removeHandAt(idx, toGraveTop);
            else if (action === 'to_banish') removeHandAt(idx, toBanishTop);
            else if (action === 'to_shield') removeHandAt(idx, shieldShuffleIn);
            else if (action === 'to_deck_top') removeHandAt(idx, toDeckTop);
            else if (action === 'to_deck_bottom') removeHandAt(idx, toDeckBottom);
            else if (action === 'flip' || action === 'flip_to_front' || action === 'flip_to_back') {
                // Hand card flips — ONLY mutate the hand array; never touch Partner slot/side.
                // Also defensively clear any stray boardSlots.partner entry.
                host.setHand((prev) => {
                    const idx = Number(ctx?.data?.index ?? -1);
                    if (idx < 0 || idx >= prev.length) return prev;

                    const current = String(prev[idx] || '');
                    const base = current.replace(/_(a|b)$/i, '');
                    const isBack = /_b$/i.test(current);

                    let nextId = current;
                    if (action === 'flip') {
                        nextId = `${base}_${isBack ? 'a' : 'b'}`;
                    } else if (action === 'flip_to_front') {
                        nextId = `${base}_a`;
                    } else if (action === 'flip_to_back') {
                        nextId = `${base}_b`;
                    }

                    const next = prev.slice();
                    next[idx] = nextId;
                    return next;
                });

                // EXTRA GUARD: ensure no phantom 'partner' card was ever inserted into boardSlots.
                host.setBoardSlots?.((prev) => {
                    if (!prev || !prev.partner) return prev;
                    const up = { ...prev };
                    delete up.partner;
                    return up;
                });

                return true; // stop here so no other handler runs
            }
            else if (action === 'move_to_unit') {
                const mode = (typeof window !== 'undefined' && window.__PB_COST_MODULE_MODE) || 'on';
                if (mode === 'on') {
                    const available = getAvailableElements();
                    const sideFromId = /_(b)$/i.test(String(cardId)) ? 'b' : 'a';
                    const paid = await openPlayCostModal({ cardId, side: sideFromId, available });
                    if (!paid) return; // cancelled
                }
                host.setPendingPlace({ source: 'hand', index: idx, cardId, target: 'unit' });
            }
            else if (action === 'move_to_support') {
                const mode = (typeof window !== 'undefined' && window.__PB_COST_MODULE_MODE) || 'on';
                if (mode === 'on') {
                    const available = getAvailableElements();
                    const sideFromId = /_(b)$/i.test(String(cardId)) ? 'b' : 'a';
                    const paid = await openPlayCostModal({ cardId, side: sideFromId, available });
                    if (!paid) return; // cancelled
                }
                host.setPendingPlace({ source: 'hand', index: idx, cardId, target: 'support' });
            }
            return;
        }

        if (area === 'slot-card') {
            const slotKey = data.slotKey;

            if (slotKey === 'partner') {
                if (action === 'inspect') tryZoom(target);
                else if (action === 'return_to_hand') toHand(host.partnerId);
                else if (action === 'to_grave') toGraveTop(host.partnerId);
                else if (action === 'to_banish') toBanishTop(host.partnerId);
                else if (action === 'to_deck_top') toDeckTop(host.partnerId);
                else if (action === 'to_deck_bottom') toDeckBottom(host.partnerId);
                else if (action === 'flip') host.setPartnerSide((prev) => (prev === 'b' ? 'a' : 'b'));
                else if (action === 'add_counters') {
                    // Open the counters modal with current values for partner
                    const existing = (host.slotCounters?.partner) || {};
                    const base = {};
                    (host.counterDefs || []).forEach((d) => { base[d.id] = existing[d.id] || 0; });

                    if (host.setCounterPrompt) {
                        host.setCounterPrompt({ slotKey: 'partner', counts: base });
                    } else {
                        // Fallback: at least ensure the entry exists
                        host.setSlotCounters((prev) => ({ ...prev, partner: { ...(prev?.partner || {}) } }));
                    }
                } else if (action === 'modify_stat') {
                    // Opens the React modal from Step 1 (statPrompt)
                    host.setStatPrompt?.({ slotKey: 'partner', stat: 'ATK', op: '+', amount: 1 });
                } else if (action === 'clear_stat_mods') {
                    // Clear all ad-hoc partner stat modifiers
                    host.setSlotStatMods?.((prev) => {
                        const up = { ...(prev || {}) };
                        delete up.partner;
                        return up;
                    });
                } else if (action === 'inflict_damage') {
                    host.setDamagePrompt?.({ slotKey: 'partner' });
                } else if (action === 'heal_x') {
                    const raw = window.prompt('Heal — enter X (damage counters to remove):', '1');
                    const x = Math.max(0, Math.floor(Number(raw) || 0));
                    if (!x) return;

                    const counts = (host.slotCounters?.partner) || {};
                    const damage = counts['damage_k'] || 0;

                    // List the status counters currently present (IsStatus === true, count > 0)
                    const statusOptions = (host.counterDefs || [])
                        .filter(d => d.isStatus)
                        .map(d => ({ id: d.id, name: d.name, n: counts[d.id] || 0 }))
                        .filter(o => o.n > 0);

                    if (!damage && !statusOptions.length) {
                        window.alert('No damage or status counters on this card.');
                        return;
                    }

                    host.setHealPrompt?.({
                        slotKey: 'partner',
                        x,
                        damage,
                        statuses: statusOptions,
                    });
                } else if (['return_to_hand', 'to_grave', 'to_banish', 'to_deck_top', 'to_deck_bottom'].includes(action)) {
                    host.setSlotCounters((prev) => {
                        if (!prev?.partner) return prev;
                        const up = { ...prev };
                        delete up.partner;
                        return up;
                    });
                    host.setSlotStatMods?.((prev) => {
                        if (!prev?.partner) return prev;
                        const up = { ...(prev || {}) };
                        delete up.partner;
                        return up;
                    });
                } else if (action === 'add_label') {
                    host.setAddLabelPrompt?.({ slotKey: 'partner' });

                } else if (action === 'remove_label') {
                    const labels = host.slotLabels?.partner || [];
                    if (!labels.length) {
                        window.alert('No labels on this card.');
                        return;
                    }
                    host.setRemoveLabelPrompt?.({ slotKey: 'partner', labels });
                }
                return;
            }

            if (action === 'inspect') tryZoom(target);
            else if (action === 'return_to_hand') removeSlotCard(slotKey, toHand);
            else if (action === 'to_grave') removeSlotCard(slotKey, toGraveTop);
            else if (action === 'to_banish') removeSlotCard(slotKey, toBanishTop);
            else if (action === 'to_deck_top') removeSlotCard(slotKey, toDeckTop);
            else if (action === 'to_deck_bottom') removeSlotCard(slotKey, toDeckBottom);
            else if (action === 'flip') {
                host.setSlotSides((prev) => ({ ...prev, [slotKey]: (prev?.[slotKey] === 'b' ? 'a' : 'b') }));
            } else if (action === 'exhaust_toggle') {
                host.setExhaustedSlots((prev) => {
                    const next = new Set(prev);
                    if (next.has(slotKey)) next.delete(slotKey); else next.add(slotKey);
                    return next;
                });
            } else if (action === 'add_counters') {
                // Open the counters modal with current values for this slot
                const existing = host.slotCounters?.[slotKey] || {};
                const base = {};
                (host.counterDefs || []).forEach((d) => { base[d.id] = existing[d.id] || 0; });

                if (host.setCounterPrompt) {
                    host.setCounterPrompt({ slotKey, counts: base });
                } else {
                    // Fallback: at least ensure the entry exists
                    host.setSlotCounters((prev) => ({ ...prev, [slotKey]: { ...(prev?.[slotKey] || {}) } }));
                }
            } else if (action === 'modify_stat') {
                // Opens the React modal from Step 1 (statPrompt)
                host.setStatPrompt?.({ slotKey, stat: 'ATK', op: '+', amount: 1 });
            } else if (action === 'clear_stat_mods') {
                host.setSlotStatMods?.((prev) => {
                    const up = { ...(prev || {}) };
                    delete up[slotKey];
                    return up;
                });
            } else if (action === 'inflict_damage') {
                host.setDamagePrompt?.({ slotKey });
            } else if (action === 'heal_x') {
                const raw = window.prompt('Heal — enter X (damage counters to remove):', '1');
                const x = Math.max(0, Math.floor(Number(raw) || 0));
                if (!x) return;

                const counts = host.slotCounters?.[slotKey] || {};
                const damage = counts['damage_k'] || 0;

                const statusOptions = (host.counterDefs || [])
                    .filter(d => d.isStatus)
                    .map(d => ({ id: d.id, name: d.name, n: counts[d.id] || 0 }))
                    .filter(o => o.n > 0);

                if (!damage && !statusOptions.length) {
                    window.alert('No damage or status counters on this card.');
                    return;
                }

                host.setHealPrompt?.({
                    slotKey,
                    x,
                    damage,
                    statuses: statusOptions,
                });
            } else if (action === 'add_label') {
                host.setAddLabelPrompt?.({ slotKey });

            } else if (action === 'remove_label') {
                const labels = host.slotLabels?.[slotKey] || [];
                if (!labels.length) {
                    window.alert('No labels on this card.');
                    return;
                }
                host.setRemoveLabelPrompt?.({ slotKey, labels });
            } else if (action === 'declare_attacker') {
                const fromKey = data?.slotKey;          // e.g., "u3"
                const m = /^u(\d+)$/.exec(fromKey || '');
                if (!m) return;                         // only allowed from unit slots

                const colIndex = Number(m[1]);          // 1..7
                const toKey = `b${colIndex}`;           // battle slot in same column

                // Remember the origin for "Remove from Battle"
                host.setBattleOrigin(prev => ({ ...prev, [toKey]: fromKey }));

                // Move the card uX -> bX (bump any occupant of bX to hand, just in case)
                host.setBoardSlots(prev => {
                    const next = { ...prev };
                    const moving = next[fromKey];
                    if (!moving) return prev;
                    const bumped = next[toKey] || null;
                    next[toKey] = moving;
                    delete next[fromKey];
                    if (bumped) host.setHand(h => [...h, bumped]);
                    return next;
                });

                // Carry over face side; remove stale side on the old slot
                host.setSlotSides((prev) => {
                    const next = { ...(prev || {}) };
                    if (next[fromKey]) next[toKey] = next[fromKey];
                    delete next[fromKey];
                    return next;
                });

                // Move counters with the card, then consume 1 terrify if present
                host.setSlotCounters((prev) => {
                    const next = { ...(prev || {}) };

                    // 1) migrate counters uX -> bX
                    if (next[fromKey]) {
                        next[toKey] = { ...next[fromKey] };
                        delete next[fromKey];
                    }

                    // 2) consume one terrify counter on attack
                    const moved = { ...(next[toKey] || {}) };
                    if ((moved['terrify_k'] || 0) > 0) {
                        moved['terrify_k'] = moved['terrify_k'] - 1;

                        // clean zero entries
                        const cleaned = Object.fromEntries(
                            Object.entries(moved).filter(([, n]) => (n || 0) > 0)
                        );
                        if (Object.keys(cleaned).length) {
                            next[toKey] = cleaned;
                        } else {
                            delete next[toKey];
                        }
                    }

                    return next;
                });

                // Move stat mods with the card
                host.setSlotStatMods?.((prev) => {
                    const next = { ...(prev || {}) };
                    if (next[fromKey]) {
                        next[toKey] = { ...next[fromKey] };
                        delete next[fromKey];
                    }
                    return next;
                });

                // NEW — move labels with the card
                host.setSlotLabels?.((prev) => {
                    const next = { ...(prev || {}) };
                    if (next[fromKey]) {
                        next[toKey] = Array.isArray(next[fromKey]) ? [...next[fromKey]] : [];
                        delete next[fromKey];
                    }
                    return next;
                });

                // Enter battle exhausted
                host.setExhaustedSlots((prev) => {
                    const next = new Set(prev || []);
                    next.delete(fromKey);
                    next.add(toKey);
                    return next;
                });

                // NEW — set the battle role flag so the label renders in bX
                if (host.setBattleRole) {
                    host.setBattleRole(prev => ({ ...(prev || {}), [toKey]: 'attacker' }));
                }
            } else if (action === 'declare_blocker') {
                const fromKey = data?.slotKey;          // e.g. "u3"
                const m = /^u(\d+)$/.exec(fromKey || '');
                if (!m) return;                         // only allowed from unit slots

                const colIndex = Number(m[1]);          // 1..7
                const toKey = `b${colIndex}`;           // battle slot in same column

                // Move unit -> battle, keep side + counters, enter exhausted
                host.setBoardSlots((prev) => {
                    const up = { ...prev };
                    const cardId = up[fromKey];
                    if (!cardId) return prev;
                    if (up[toKey]) return prev;         // already occupied; do nothing
                    up[toKey] = cardId;
                    delete up[fromKey];
                    return up;
                });

                // If your file also stores the unit origin for "Remove from Battle",
                // preserve it just like attacker:
                if (host.setBattleOrigin) {
                    host.setBattleOrigin(prev => ({ ...(prev || {}), [toKey]: fromKey }));
                }

                host.setSlotSides((prev) => {
                    const next = { ...(prev || {}) };
                    if (next[fromKey]) next[toKey] = next[fromKey];
                    return next;
                });

                host.setSlotCounters((prev) => {
                    const next = { ...(prev || {}) };
                    if (next[fromKey]) {
                        next[toKey] = { ...next[fromKey] };
                        delete next[fromKey];
                    }
                    return next;
                });

                // Move stat mods with the card
                host.setSlotStatMods?.((prev) => {
                    const next = { ...(prev || {}) };
                    if (next[fromKey]) {
                        next[toKey] = { ...next[fromKey] };
                        delete next[fromKey];
                    }
                    return next;
                });

                host.setExhaustedSlots((prev) => {
                    const next = new Set(prev || []);
                    next.delete(fromKey);
                    next.add(toKey);                    // enters battle exhausted
                    return next;
                });

                // NEW — set the battle role flag so the label renders in bX
                if (host.setBattleRole) {
                    host.setBattleRole(prev => ({ ...(prev || {}), [toKey]: 'blocker' }));
                };
            } else if (action === 'remove_from_battle') {
                const fromKey = data.slotKey; // battle slot key, e.g. 'b3'
                const originMap = host.battleOriginRef?.current || {};
                // Prefer the stored origin; fallback to the same index unit slot if missing
                const toKey =
                    originMap[fromKey] ||
                    (() => {
                        const m = /^b(\d+)$/.exec(fromKey);
                        return m ? `u${m[1]}` : null;
                    })();

                if (!toKey) return;

                // Move the card back
                host.setBoardSlots(prev => {
                    const next = { ...prev };
                    const moving = next[fromKey];
                    if (!moving) return prev;

                    const bumped = next[toKey] || null;
                    next[toKey] = moving;
                    delete next[fromKey];

                    // If something was sitting in the original slot, bump it to hand
                    if (bumped) host.setHand(h => [...h, bumped]);
                    return next;
                });

                // Keep the card's face side with it
                host.setSlotSides(prev => {
                    const next = { ...(prev || {}) };
                    if (next[fromKey]) next[toKey] = next[fromKey];
                    delete next[fromKey];
                    return next;
                });

                // Move its counters back as well
                host.setSlotCounters(prev => {
                    const next = { ...(prev || {}) };
                    if (next[fromKey]) {
                        next[toKey] = { ...next[fromKey] };
                        delete next[fromKey];
                    }
                    return next;
                });

                // Move its stat mods back as well
                host.setSlotStatMods?.((prev) => {
                    const next = { ...(prev || {}) };
                    if (next[fromKey]) {
                        next[toKey] = { ...next[fromKey] };
                        delete next[fromKey];
                    }
                    return next;
                });

                // ADD — Move any custom labels (from "Add Label") back as well
                host.setSlotLabels?.((prev) => {
                    const next = { ...(prev || {}) };
                    if (next[fromKey]) {
                        // Support either array or object storage of labels
                        next[toKey] = Array.isArray(next[fromKey])
                            ? [...next[fromKey]]
                            : { ...next[fromKey] };
                        delete next[fromKey];
                    }
                    return next;
                });

                // Preserve exhaustion on the card (map bX -> uX)
                host.setExhaustedSlots(prev => {
                    const next = new Set(prev || []);
                    if (next.has(fromKey)) {
                        next.delete(fromKey);
                        next.add(toKey);
                    } else {
                        // If somehow not exhausted in battle, ensure we don't leave a stale flag
                        next.delete(toKey);
                    }
                    return next;
                });

                // Drop the mapping for this battle slot
                host.setBattleOrigin(prev => {
                    const copy = { ...(prev || {}) };
                    delete copy[fromKey];
                    return copy;
                });

                // ADD — also drop any battle role flag (hides ATTACKER label)
                if (host.setBattleRole) {
                    host.setBattleRole(prev => {
                        const copy = { ...(prev || {}) };
                        delete copy[fromKey];
                        return copy;
                    });
                };

                return;
            }
            return;
        }

        if (area === 'stack-slot') {
            const t = (data.stack || '').toLowerCase();
            if (t === 'deck') {
                if (action === 'deck_open_view') {
                    const ids = (host.deckRef.current || []).slice(0);
                    host.setPeekCard({ ids, from: 'deck', all: true });
                } else if (action === 'deck_draw1') {
                    deckPopTop(toHand);
                } else if (action === 'deck_draw_x') {
                    const max = host.deckRef.current?.length || 0;
                    if (!max) return;
                    const raw = window.prompt('Draw how many cards to hand?', Math.min(3, max));
                    if (raw == null) return;
                    const n = Math.max(1, Math.min(max, Number.parseInt(raw, 10) || 0));
                    const ids = host.deckRef.current.slice(0, n);
                    host.setDeckPile((prev) => prev.slice(ids.length));
                    ids.forEach(toHand);
                } else if (action === 'deck_reveal_top') {
                    const top = host.deckRef.current?.[0] || null;
                    if (top) host.setPeekCard({ id: top, from: 'deck' });
                } else if (action === 'deck_reveal_x') {
                    const max = host.deckRef.current?.length || 0;
                    if (!max) return;
                    const raw = window.prompt('Reveal how many cards from the top of the Deck?', Math.min(3, max));
                    if (raw == null) return;
                    const n = Math.max(1, Math.min(max, Number.parseInt(raw, 10) || 0));
                    const ids = host.deckRef.current.slice(0, n);
                    if (ids.length) host.setPeekCard({ ids, from: 'deck' });
                } else if (action === 'deck_foresee_x') {
                    const max = host.deckRef.current?.length || 0;
                    if (!max) return;
                    const raw = window.prompt('Foresee how many cards from the top of the Deck?', Math.min(3, max));
                    if (raw == null) return;
                    const n = Math.max(1, Math.min(max, Number.parseInt(raw, 10) || 0));
                    const ids = host.deckRef.current.slice(0, n);
                    if (ids.length) host.setForesee({ ids, mid: ids.slice(), top: [], bottom: [] });
                } else if (action === 'deck_send_x_to_grave') {
                    const max = host.deckRef.current?.length || 0;
                    if (!max) return;
                    const raw = window.prompt('Send how many cards from the top of the Deck to Grave?', Math.min(2, max));
                    if (raw == null) return;
                    const n = Math.max(1, Math.min(max, Number.parseInt(raw, 10) || 0));
                    const ids = host.deckRef.current.slice(0, n);
                    host.setDeckPile((prev) => prev.slice(ids.length));
                    ids.forEach(toGraveTop);
                    if (n >= 2) host.setPeekCard({ ids: ids.slice().reverse(), from: 'grave' });
                } else if (action === 'deck_fetch_cards') {
                    // Ask the board to open the Fetch Cards modal
                    host.setFetchPrompt?.({ from: 'deck' });
                } else if (action === 'deck_shuffle') {
                    host.setDeckPile((prev) => {
                        if (prev.length < 2) return prev;
                        const next = [...prev];
                        for (let i = next.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [next[i], next[j]] = [next[j], next[i]];
                        }
                        return next;
                    });
                }
                return;
            }
            if (t === 'shield') {
                if (action === 'shield_open_view') {
                    const ids = (host.shieldRef.current || []).slice(0);
                    host.setPeekCard({ ids, from: 'shield', all: true });
                } else if (action === 'shield_reveal_top') {
                    const top = host.shieldRef.current?.[0] || null;
                    if (top) host.setPeekCard({ id: top, from: 'shield' });
                } else if (action === 'shield_reveal_x') {
                    const max = host.shieldRef.current?.length || 0;
                    if (!max) return;
                    const raw = window.prompt('Reveal how many cards from the top of the Shield?', Math.min(2, max));
                    if (raw == null) return;
                    const n = Math.max(1, Math.min(max, Number.parseInt(raw, 10) || 0));
                    const ids = host.shieldRef.current.slice(0, n);
                    if (ids.length) host.setPeekCard({ ids, from: 'shield' });
                } else if (action === 'shield_break') {
                    shieldPopTop((top) => { if (top) toGraveTop(top); });
                } else if (action === 'shield_break_x') {
                    const max = host.shieldRef.current?.length || 0;
                    if (!max) return;
                    const raw = window.prompt('Break how many shields from the top?', Math.min(2, max));
                    if (raw == null) return;
                    const n = Math.max(1, Math.min(max, Number.parseInt(raw, 10) || 0));
                    const ids = host.shieldRef.current.slice(0, n);
                    host.setShieldPile((prev) => prev.slice(ids.length));
                    ids.forEach(toGraveTop);
                } else if (action === 'shield_reinforce_x') {
                    // Prompt for X
                    const raw = window.prompt('Reinforce — how many tokens to add?', '1');
                    if (raw == null) return;
                    const x = Math.max(1, Math.floor(Number(raw) || 0));

                    const shieldCount = host.shieldRef.current?.length || 0;

                    // If shield has 7+, draw top of deck to hand
                    if (shieldCount >= 7) {
                        deckPopTop(toHand);
                        return;
                    }

                    // Otherwise add X copies of token0030_a and shuffle the shield
                    const tokenId = 'token0030_a';
                    const current = host.shieldRef.current || [];
                    const next = [...current];
                    for (let i = 0; i < x; i++) next.push(tokenId);

                    // Fisher–Yates shuffle
                    for (let i = next.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [next[i], next[j]] = [next[j], next[i]];
                    }

                    host.setShieldPile(next);

                    // Keep an open Shield peek (view-all) in sync
                    host.setPeekCard((prev) =>
                        (prev && prev.all && prev.from === 'shield')
                            ? { ...prev, ids: next.slice(0) }
                            : prev
                    );
                } else if (action === 'shield_shuffle') {
                    const current = host.shieldRef.current || [];
                    if (current.length < 2) return;
                    const next = [...current];
                    for (let i = next.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [next[i], next[j]] = [next[j], next[i]];
                    }
                    host.setShieldPile(next);
                    host.setPeekCard((prev) => (prev && prev.all && prev.from === 'shield') ? { ...prev, ids: next.slice(0) } : prev);
                }
                return;
            }
            if (t === 'grave') {
                if (action === 'grave_open_view') {
                    const ids = (host.graveRef.current || []).slice(0);
                    host.setPeekCard({ ids, from: 'grave', all: true });
                } else if (action === 'grave_take_top_to_hand') gravePopTop(toHand);
                else if (action === 'grave_to_deck_top') gravePopTop(toDeckTop);
                else if (action === 'grave_to_deck_bottom') gravePopTop(toDeckBottom);
                return;
            }
            if (t === 'banish') {
                if (action === 'banish_open_view') {
                    const ids = (host.banishRef.current || []).slice(0);
                    host.setPeekCard({ ids, from: 'banish', all: true });
                } else if (action === 'banish_take_top_to_hand') banishPopTop(toHand);
                else if (action === 'banish_to_deck_top') banishPopTop(toDeckTop);
                else if (action === 'banish_to_deck_bottom') banishPopTop(toDeckBottom);
                return;
            }
            return;
        }

        if (area === 'viewer-card') {
            if (action === 'inspect') {
                tryZoom(target);
            } else if (action === 'add_to_hand') {
                toHand(data.cardId);
            } else if (action === 'add_to_unit') {
                host.setPendingPlace({ source: 'viewer', cardId: data.cardId, target: 'unit' });
                const modal = target?.closest?.('.pb-modal');
                if (modal) { modal.classList.add('is-hidden'); window.__PB_SUSPENDED_MODAL = modal; }
            } else if (action === 'add_to_support') {
                host.setPendingPlace({ source: 'viewer', cardId: data.cardId, target: 'support' });
                const modal = target?.closest?.('.pb-modal');
                if (modal) { modal.classList.add('is-hidden'); window.__PB_SUSPENDED_MODAL = modal; }
            } else if (action === 'to_grave') { toGraveTop(data.cardId); }
            else if (action === 'to_shield') { shieldShuffleIn(data.cardId); }
            else if (action === 'to_deck_top') { toDeckTop(data.cardId); }
            else if (action === 'to_deck_bottom') { toDeckBottom(data.cardId); }
            return;
        }

        // global menu
        if (action === 'new_game') {
            host.onNewGame?.();
        } else if (action === 'reset') {
            host.onResetAll?.();
        } else if (action === 'import_deck') {
            host.fileInputRef?.current?.click?.();
        }
    };

    // Attach/cleanup
    window.addEventListener('pb:ctx:action', onAction);
    return () => window.removeEventListener('pb:ctx:action', onAction);
}

