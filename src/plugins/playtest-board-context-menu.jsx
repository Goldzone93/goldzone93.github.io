// /src/plugins/playtest-board-context-menu.jsx
// Context menu framework for the Playtest Board (right-click / long-press)
// Minimal, dependency-free. Dispatches 'pb:ctx:action' events; no direct game logic.
// Usage: this file is side-effect imported by playtest-board.jsx.

import '../styles/playtest-board-context-menu.css';
import { openPlayCostModal, getAvailableElements, spendElements } from './playtest-board-costmodal.jsx';

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
          // fix: read the host .pb-slot-card, not the img itself
          const hostCard = ctx?.target?.closest?.('.pb-slot-card');
          const exhausted = !!hostCard?.classList?.contains('is-exhausted');
          const label = exhausted ? 'Ready' : 'Exhaust';
          // NEW: detect the stats bar on the host card (works on opponent too)
          const hasUnitStats = !!hostCard?.querySelector?.('.pb-unit-stats');
          // Always show, but disable when not applicable
          const canDeclare = /^(?:ou|u)\d+$/.test(slotKey || '');
          const canRemoveBattle = /^(?:ob|b)\d+$/.test(slotKey || '');
          const isFirstTurn = (window.__PB_TURN_COUNT || 1) === 1;

          const items = [
              { id: 'inspect', label: 'Inspect (Zoom)' },
              { id: 'flip', label: flipLabel },
              { id: 'exhaust_toggle', label, disabled: isPartner },
              { separator: true },
              { id: 'add_counters', label: 'Add Counters…' },
              { id: 'heal_x', label: 'Heal X…' },
              { id: 'inflict_damage', label: 'Inflict/Damage X…' }, // NEW
              { id: 'modify_stat', label: 'Modify Stat…', disabled: !hasUnitStats },
              { id: 'clear_stat_mods', label: 'Remove Stat Changes', disabled: !hasUnitStats },
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
      'viewer-card': (ctx) => {
          const base = [
              { id: 'inspect', label: 'Inspect (Zoom)' },
              { separator: true },
              { id: 'add_to_unit', label: 'Add to Unit Slot…' },
              { id: 'add_to_support', label: 'Add to Support Slot…' },
              { separator: true },
              { id: 'add_to_hand', label: 'Add to Hand' },
              { id: 'to_grave', label: 'Send to Grave' },
              { id: 'to_shield', label: 'Put into Shield (shuffle)' },
              { id: 'to_deck_top', label: 'Put on Top of Deck' },
              { id: 'to_deck_bottom', label: 'Put on Bottom of Deck' },
          ];

          // Show Opponent section only if opponent board is currently rendered/toggled on
          const opponentOn = !!document.querySelector('.pb-opponent-wrap');
          if (!opponentOn) return base;

          return [
              ...base,
              { separator: true },
              // non-clickable section label (disabled menu item)
              { id: 'opponent_section', label: 'Opponent Side', disabled: true },
              { separator: true },
              { id: 'o_add_to_unit', label: 'Add to Unit Slot…' },
              { id: 'o_add_to_support', label: 'Add to Support Slot…' },
              { separator: true },
              { id: 'o_add_to_hand', label: 'Add to Hand' },
              { id: 'o_to_grave', label: 'Send to Grave' },
              { id: 'o_to_shield', label: 'Put into Shield (shuffle)' },
              { id: 'o_to_deck_top', label: 'Put on Top of Deck' },
              { id: 'o_to_deck_bottom', label: 'Put on Bottom of Deck' },
          ];
      },
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

        // NEW: If we’re on a stack-slot, disable any “Open Stack View” item when the pile is empty.
        if (ctx?.area === 'stack-slot') {
            const countEl = ctx?.target?.querySelector?.('.pb-pile-count');
            const pileCount = Number.parseInt(countEl?.textContent || '0', 10) || 0;
            const isEmpty = pileCount <= 0;

            if (isEmpty) {
                items = items.map((it) => {
                    if (!it || it.separator) return it;
                    const id = String(it.id || '');
                    // matches: deck_open_view, shield_open_view, grave_open_view, banish_open_view, etc.
                    const isOpenView = /(^|_)open_view$/.test(id);
                    return isOpenView ? { ...it, disabled: true } : it;
                });
            }
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
          const owner = slot.closest('.pb-opponent-wrap') ? 'opponent' : 'player';
          return { area: 'stack-slot', data: { stack: map[name], owner }, target: slot };
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
            const next = [...(prev || []), cardId];
            for (let i = next.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [next[i], next[j]] = [next[j], next[i]];
            }
            return next;
        });
    };

    // Opponent variant of "shuffle into shield"
    const oShieldShuffleIn = (cardId) => {
        if (!cardId) return;
        host.setOShieldPile?.((prev) => {
            const next = [...(prev || []), cardId];
            for (let i = next.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [next[i], next[j]] = [next[j], next[i]];
            }
            return next;
        });
    };

    // Opponent-side helpers
    const toHandOpp = (cardId) => {
        if (!cardId) return;
        host.setOHand?.((prev) => [...(prev || []), cardId]);
    };
    const toOGraveTop = (cardId) => { if (cardId) host.setOGravePile?.((p) => [cardId, ...(p || [])]); };
    const toOBanishTop = (cardId) => { if (cardId) host.setOBanishPile?.((p) => [cardId, ...(p || [])]); };
    const toODeckTop = (cardId) => { if (cardId) host.setODeckPile?.((p) => [cardId, ...(p || [])]); };
    const toODeckBottom = (cardId) => { if (cardId) host.setODeckPile?.((p) => ([...(p || []), cardId])); };

    // Opponent pop-top helpers
    const oDeckPopTop = (routeFn) => {
        host.setODeckPile?.((prev) => {
            if (!prev?.length) return prev;
            const [top, ...rest] = prev;
            routeFn?.(top);
            return rest;
        });
    };
    const oShieldPopTop = (routeFn) => {
        host.setOShieldPile?.((prev) => {
            if (!prev?.length) return prev;
            const [top, ...rest] = prev;
            routeFn?.(top);
            return rest;
        });
    };
    const oBanishPopTop = (routeFn) => {
        host.setOBanishPile?.((prev) => {
            if (!prev?.length) return prev;
            const [top, ...rest] = prev;
            routeFn?.(top);
            return rest;
        });
    };
    const oGravePopTop = (routeFn) => {
        host.setOGravePile?.((prev) => {
            if (!prev?.length) return prev;
            const [top, ...rest] = prev;
            routeFn?.(top);
            return rest;
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

    const removeOHandAt = (idx, routeFn) => {
        if (!Number.isFinite(idx)) return;
        host.setOHand?.((prev = []) => {
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
        if (/^(?:ob|b)\d+$/.test(String(slotKey)) && host.setBattleRole) {
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
            if (!prev?.length) return prev;
            const [top, ...rest] = prev;
            routeFn?.(top);
            return rest;
        });
    };

    // Keep Stack View (peek) in sync when removing by index or id
    const removeFromStackInPeek = (stack, indexMaybe, idMaybe, routeFn, owner = 'player') => {
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

        const isOpp = String(owner).toLowerCase() === 'opponent';
        if (stack === 'deck') (isOpp ? host.setODeckPile : host.setDeckPile)(spliceBy);
        if (stack === 'shield') (isOpp ? host.setOShieldPile : host.setShieldPile)(spliceBy);
        if (stack === 'grave') (isOpp ? host.setOGravePile : host.setGravePile)(spliceBy);
        if (stack === 'banish') (isOpp ? host.setOBanishPile : host.setBanishPile)(spliceBy);
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
            const domOwner = hostEl?.getAttribute?.('data-owner');
            const pOwner = String(data.owner || domOwner || 'player').toLowerCase();
            const isOppPeek = pOwner === 'opponent';

            if (action === 'inspect') { tryZoom(target); return; }

            if (fromPeek && cardId) {
                const route = (fn) => removeFromStackInPeek(pStack, pIdx, cardId, fn, pOwner);

                if (action === 'add_to_hand') route(toHand);
                else if (action === 'to_grave') route(toGraveTop);
                else if (action === 'to_banish') route(toBanishTop);
                else if (action === 'to_shield') route(shieldShuffleIn);
                else if (action === 'to_deck_top') {
                    if (pStack === 'deck') {
                        (isOppPeek ? host.setODeckPile : host.setDeckPile)((prev) => {
                            const next = [...prev];
                            const k = next.indexOf(cardId);
                            if (k === -1) return prev;
                            const [m] = next.splice(k, 1);
                            // unshift for top / push for bottom (keep each block’s original op)
                            next.unshift ? next.unshift(m) : next.push(m);
                            return next;
                        });
                        host.setPeekCard((prev) => {
                            if (!prev) return prev;
                            if (Array.isArray(prev.ids)) {
                                const ids = [...prev.ids];
                                const k = ids.indexOf(cardId);
                                if (k === -1) return prev;
                                ids.splice(k, 1);
                                if (prev.all) { ids.unshift(cardId); return { ...prev, ids, owner: pOwner }; }
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
                        (isOppPeek ? host.setODeckPile : host.setDeckPile)((prev) => {
                            const next = [...prev];
                            const k = next.indexOf(cardId);
                            if (k === -1) return prev;
                            const [m] = next.splice(k, 1);
                            // unshift for top / push for bottom (keep each block’s original op)
                            next.unshift ? next.unshift(m) : next.push(m);
                            return next;
                        });
                        host.setPeekCard((prev) => {
                            if (!prev) return prev;
                            if (Array.isArray(prev.ids)) {
                                const ids = [...prev.ids];
                                const k = ids.indexOf(cardId);
                                if (k === -1) return prev;
                                ids.splice(k, 1);
                                if (prev.all) { ids.push(cardId); return { ...prev, ids, owner: pOwner }; }
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

            // Determine owner (player vs opponent) for non-peek hand actions
            const domOwner2 = hostEl?.getAttribute?.('data-owner');
            const owner2 = String(data.owner || domOwner2 || 'player').toLowerCase();
            const isOppHand = owner2 === 'opponent';

            // Non-peek hand actions
            if (action === 'to_grave') {
                (isOppHand ? removeOHandAt : removeHandAt)(idx, isOppHand ? toOGraveTop : toGraveTop);
            }
            else if (action === 'to_banish') {
                (isOppHand ? removeOHandAt : removeHandAt)(idx, isOppHand ? toOBanishTop : toBanishTop);
            }
            else if (action === 'to_shield') {
                (isOppHand ? removeOHandAt : removeHandAt)(idx, isOppHand ? oShieldShuffleIn : shieldShuffleIn);
            }
            else if (action === 'to_deck_top') {
                (isOppHand ? removeOHandAt : removeHandAt)(idx, isOppHand ? toODeckTop : toDeckTop);
            }
            else if (action === 'to_deck_bottom') {
                (isOppHand ? removeOHandAt : removeHandAt)(idx, isOppHand ? toODeckBottom : toDeckBottom);
            }
            else if (action === 'flip' || action === 'flip_to_front' || action === 'flip_to_back') {
                const flipIn = (arr) => {
                    const i = Number(ctx?.data?.index ?? -1);
                    if (i < 0 || i >= arr.length) return arr;

                    const current = String(arr[i] || '');
                    const base = current.replace(/_(a|b)$/i, '');
                    const isBack = /_b$/i.test(current);

                    let nextId = current;
                    if (action === 'flip') nextId = `${base}_${isBack ? 'a' : 'b'}`;
                    else if (action === 'flip_to_front') nextId = `${base}_a`;
                    else if (action === 'flip_to_back') nextId = `${base}_b`;

                    const next = arr.slice();
                    next[i] = nextId;
                    return next;
                };

                if (isOppHand) {
                    host.setOHand?.((prev = []) => flipIn(prev));
                } else {
                    host.setHand((prev = []) => flipIn(prev));
                }

                // EXTRA GUARD: ensure no phantom 'partner' card was ever inserted
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
                    const available = getAvailableElements(isOppHand ? 'opponent' : 'player');
                    const sideFromId = /_(b)$/i.test(String(cardId)) ? 'b' : 'a';
                    const paid = await openPlayCostModal({
                        cardId,
                        side: sideFromId,
                        available,
                        owner: isOppHand ? 'opponent' : 'player',
                    });
                    if (!paid) return; // cancelled
                    // Deduct the resources now (context-menu path)
                    spendElements(paid, isOppHand ? 'opponent' : 'player');
                }
                host.setPendingPlace({
                    source: isOppHand ? 'oHand' : 'hand',
                    owner: isOppHand ? 'opponent' : 'player',
                    index: idx,
                    cardId,
                    target: 'unit',
                });
            }
            else if (action === 'move_to_support') {
                const mode = (typeof window !== 'undefined' && window.__PB_COST_MODULE_MODE) || 'on';
                if (mode === 'on') {
                    const available = getAvailableElements(isOppHand ? 'opponent' : 'player');
                    const sideFromId = /_(b)$/i.test(String(cardId)) ? 'b' : 'a';
                    const paid = await openPlayCostModal({
                        cardId,
                        side: sideFromId,
                        available,
                        owner: isOppHand ? 'opponent' : 'player',
                    });
                    if (!paid) return; // cancelled
                    // Deduct the resources now (context-menu path)
                    spendElements(paid, isOppHand ? 'opponent' : 'player');
                }
                host.setPendingPlace({
                    source: isOppHand ? 'oHand' : 'hand',
                    owner: isOppHand ? 'opponent' : 'player',
                    index: idx,
                    cardId,
                    target: 'support',
                });
            }
            return;
        }

        if (area === 'slot-card') {
            const slotKey = data.slotKey;
            const isOppSlot = /^o/.test(String(slotKey || ''));

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
            else if (action === 'return_to_hand') removeSlotCard(slotKey, isOppSlot ? toHandOpp : toHand);
            else if (action === 'to_grave') removeSlotCard(slotKey, isOppSlot ? toOGraveTop : toGraveTop);
            else if (action === 'to_banish') removeSlotCard(slotKey, isOppSlot ? toOBanishTop : toBanishTop);
            else if (action === 'to_deck_top') removeSlotCard(slotKey, isOppSlot ? toODeckTop : toDeckTop);
            else if (action === 'to_deck_bottom') removeSlotCard(slotKey, isOppSlot ? toODeckBottom : toDeckBottom);
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
                const fromKey = data?.slotKey;          // e.g., "u3" or "ou3"
                const m = /^(?:ou|u)(\d+)$/.exec(fromKey || '');
                if (!m) return;

                const colIndex = Number(m[1]);          // 1..7
                const toKey = fromKey.startsWith('ou') ? `ob${colIndex}` : `b${colIndex}`;

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
                const fromKey = data?.slotKey;          // e.g. "u3" or "ou3"
                const m = /^(?:ou|u)(\d+)$/.exec(fromKey || '');
                if (!m) return;

                const colIndex = Number(m[1]);          // 1..7
                const toKey = fromKey.startsWith('ou') ? `ob${colIndex}` : `b${colIndex}`;

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
                        const m = /^(?:ob|b)(\d+)$/.exec(fromKey || '');
                        if (!m) return null;
                        return fromKey.startsWith('ob') ? `ou${m[1]}` : `u${m[1]}`;
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
                    if (bumped) {
                        // If returning to an opponent unit slot (ouX), bump to opponent hand; otherwise to player hand.
                        const toOppHand = String(toKey).startsWith('ou');
                        (toOppHand ? toHandOpp : toHand)(bumped);
                    }
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
            const owner = String(data.owner || '').toLowerCase();
            const isOpp = owner === 'opponent';

            const deckRef = isOpp ? host.oDeckRef : host.deckRef;
            const shieldRef = isOpp ? host.oShieldRef : host.shieldRef;
            const banishRef = isOpp ? host.oBanishRef : host.banishRef;
            const graveRef = isOpp ? host.oGraveRef : host.graveRef;

            const setDeckPile = isOpp ? host.setODeckPile : host.setDeckPile;
            const setShieldPile = isOpp ? host.setOShieldPile : host.setShieldPile;
            const setBanishPile = isOpp ? host.setOBanishPile : host.setBanishPile;
            const setGravePile = isOpp ? host.setOGravePile : host.setGravePile;

            const toHandX = isOpp ? toHandOpp : toHand;
            const toGraveTopX = isOpp ? toOGraveTop : toGraveTop;
            const toBanishTopX = isOpp ? toOBanishTop : toBanishTop;
            const toDeckTopX = isOpp ? toODeckTop : toDeckTop;
            const toDeckBottomX = isOpp ? toODeckBottom : toDeckBottom;

            const deckPopTopX = (routeFn) => (isOpp ? oDeckPopTop(routeFn) : deckPopTop(routeFn));
            const shieldPopTopX = (routeFn) => (isOpp ? oShieldPopTop(routeFn) : shieldPopTop(routeFn));
            const banishPopTopX = (routeFn) => (isOpp ? oBanishPopTop(routeFn) : banishPopTop(routeFn));
            const gravePopTopX = (routeFn) => (isOpp ? oGravePopTop(routeFn) : gravePopTop(routeFn));
            if (t === 'deck') {
                if (action === 'deck_open_view') {
                    const ids = (deckRef.current || []).slice(0);
                    host.setPeekCard({ ids, from: 'deck', all: true, owner: isOpp ? 'opponent' : 'player' });
                } else if (action === 'deck_draw1') {
                    deckPopTopX(toHandX);
                } else if (action === 'deck_draw_x') {
                    const max = deckRef.current?.length || 0;
                    if (!max) return;
                    const raw = window.prompt('Draw how many cards to hand?', Math.min(3, max));
                    if (raw == null) return;
                    const n = Math.max(1, Math.min(max, Number.parseInt(raw, 10) || 0));
                    const ids = deckRef.current.slice(0, n);
                    setDeckPile((prev) => prev.slice(ids.length));
                    ids.forEach(toHandX);
                } else if (action === 'deck_reveal_top') {
                    const top = deckRef.current?.[0] || null;
                    if (top) host.setPeekCard({ id: top, from: 'deck', owner: isOpp ? 'opponent' : 'player' });
                } else if (action === 'deck_reveal_x') {
                    const max = deckRef.current?.length || 0;
                    if (!max) return;
                    const raw = window.prompt('Reveal how many cards from the top of the Deck?', Math.min(3, max));
                    if (raw == null) return;
                    const n = Math.max(1, Math.min(max, Number.parseInt(raw, 10) || 0));
                    const ids = deckRef.current.slice(0, n);
                    if (ids.length) host.setPeekCard({ ids, from: 'deck', owner: isOpp ? 'opponent' : 'player' });
                } else if (action === 'deck_foresee_x') {
                    const max = deckRef.current?.length || 0;
                    if (!max) return;
                    const raw = window.prompt('Foresee how many cards from the top of the Deck?', Math.min(3, max));
                    if (raw == null) return;
                    const n = Math.max(1, Math.min(max, Number.parseInt(raw, 10) || 0));
                    const ids = deckRef.current.slice(0, n);
                    if (!ids.length) return;

                    // Prefer opponent-specific setter if your other files defined it; otherwise use a unified setter with owner.
                    const payload = { ids, mid: ids.slice(), top: [], bottom: [], owner: isOpp ? 'opponent' : 'player' };
                    if (isOpp && typeof host.setOForesee === 'function') {
                        host.setOForesee(payload);
                    } else {
                        host.setForesee(payload);
                    }
                } else if (action === 'deck_send_x_to_grave') {
                    const max = deckRef.current?.length || 0;
                    if (!max) return;
                    const raw = window.prompt('Send how many cards from the top of the Deck to Grave?', Math.min(2, max));
                    if (raw == null) return;
                    const n = Math.max(1, Math.min(max, Number.parseInt(raw, 10) || 0));
                    const ids = deckRef.current.slice(0, n);
                    setDeckPile((prev) => prev.slice(ids.length));
                    ids.forEach(toGraveTopX);
                    if (n >= 2) host.setPeekCard({ ids: ids.slice().reverse(), from: 'grave', owner: isOpp ? 'opponent' : 'player' });
                } else if (action === 'deck_fetch_cards') {
                    host.setFetchPrompt?.({ from: 'deck', owner: isOpp ? 'opponent' : 'player' });
                } else if (action === 'deck_shuffle') {
                    setDeckPile((prev) => {
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
                    const ids = (shieldRef.current || []).slice(0);
                    host.setPeekCard({ ids, from: 'shield', all: true, owner: isOpp ? 'opponent' : 'player' });
                } else if (action === 'shield_reveal_top') {
                    const top = shieldRef.current?.[0] || null;
                    if (top) host.setPeekCard({ id: top, from: 'shield', owner: isOpp ? 'opponent' : 'player' });
                } else if (action === 'shield_reveal_x') {
                    const max = shieldRef.current?.length || 0;
                    if (!max) return;
                    const raw = window.prompt('Reveal how many cards from the top of the Shield?', Math.min(2, max));
                    if (raw == null) return;
                    const n = Math.max(1, Math.min(max, Number.parseInt(raw, 10) || 0));
                    const ids = shieldRef.current.slice(0, n);
                    if (ids.length) host.setPeekCard({ ids, from: 'shield', owner: isOpp ? 'opponent' : 'player' });
                } else if (action === 'shield_break') {
                    shieldPopTopX((top) => { if (top) toGraveTopX(top); });
                } else if (action === 'shield_break_x') {
                    const max = shieldRef.current?.length || 0;
                    if (!max) return;
                    const raw = window.prompt('Break how many shields from the top?', Math.min(2, max));
                    if (raw == null) return;
                    const n = Math.max(1, Math.min(max, Number.parseInt(raw, 10) || 0));
                    const ids = shieldRef.current.slice(0, n);
                    setShieldPile((prev) => prev.slice(ids.length));
                    ids.forEach(toGraveTopX);
                } else if (action === 'shield_reinforce_x') {
                    // Prompt for X
                    const raw = window.prompt('Reinforce — how many tokens to add?', '1');
                    if (raw == null) return;
                    const x = Math.max(1, Math.floor(Number(raw) || 0));

                    const shieldCount = shieldRef.current?.length || 0;

                    // If shield has 7+, draw top of deck to hand
                    if (shieldCount >= 7) {
                        deckPopTopX(toHandX);
                        return;
                    }

                    // Otherwise add X copies of token0030_a and shuffle the shield
                    const tokenId = 'token0030_a';
                    const current = shieldRef.current || [];
                    const next = [...current];
                    for (let i = 0; i < x; i++) next.push(tokenId);

                    // Fisher–Yates shuffle
                    for (let i = next.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [next[i], next[j]] = [next[j], next[i]];
                    }

                    setShieldPile(next);

                    // Keep an open Shield peek (view-all) in sync
                    host.setPeekCard((prev) =>
                        (prev && prev.all && prev.from === 'shield')
                            ? { ...prev, ids: next.slice(0) }
                            : prev
                    );
                } else if (action === 'shield_shuffle') {
                    const current = shieldRef.current || [];
                    if (current.length < 2) return;
                    const next = [...current];
                    for (let i = next.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [next[i], next[j]] = [next[j], next[i]];
                    }
                    setShieldPile(next);
                    host.setPeekCard((prev) => (prev && prev.all && prev.from === 'shield') ? { ...prev, ids: next.slice(0) } : prev);
                }
                return;
            }
            if (t === 'grave') {
                if (action === 'grave_open_view') {
                    const ids = (graveRef.current || []).slice(0);
                    host.setPeekCard({ ids, from: 'grave', all: true, owner: isOpp ? 'opponent' : 'player' });
                } else if (action === 'grave_take_top_to_hand') gravePopTopX(toHandX);
                else if (action === 'grave_to_deck_top') gravePopTopX(toDeckTopX);
                else if (action === 'grave_to_deck_bottom') gravePopTopX(toDeckBottomX);
                return;
            }
            if (t === 'banish') {
                if (action === 'banish_open_view') {
                    const ids = (banishRef.current || []).slice(0);
                    host.setPeekCard({ ids, from: 'banish', all: true, owner: isOpp ? 'opponent' : 'player' });
                } else if (action === 'banish_take_top_to_hand') banishPopTopX(toHandX);
                else if (action === 'banish_to_deck_top') banishPopTopX(toDeckTopX);
                else if (action === 'banish_to_deck_bottom') banishPopTopX(toDeckBottomX);
                return;
            }
            return;
        }

        if (area === 'viewer-card') {
            const owner = String(ctx?.data?.owner || target?.closest?.('.pb-modal')?.getAttribute('data-owner') || 'player').toLowerCase();
            const isOpp = owner === 'opponent';

            const toHandX = isOpp ? toHandOpp : toHand;
            const toGraveTopX = isOpp ? toOGraveTop : toGraveTop;
            const toDeckTopX = isOpp ? toODeckTop : toDeckTop;
            const toDeckBottomX = isOpp ? toODeckBottom : toDeckBottom;

            if (action === 'inspect') {
                tryZoom(target);
                return;
            }

            // Existing (owner-aware) viewer actions
            if (action === 'add_to_hand') { toHandX(data.cardId); return; }
            if (action === 'add_to_unit') {
                host.setPendingPlace({ source: 'viewer', cardId: data.cardId, target: 'unit', owner });
                const modal = target?.closest?.('.pb-modal');
                if (modal) { modal.classList.add('is-hidden'); window.__PB_SUSPENDED_MODAL = modal; }
                return;
            }
            if (action === 'add_to_support') {
                host.setPendingPlace({ source: 'viewer', cardId: data.cardId, target: 'support', owner });
                const modal = target?.closest?.('.pb-modal');
                if (modal) { modal.classList.add('is-hidden'); window.__PB_SUSPENDED_MODAL = modal; }
                return;
            }
            if (action === 'to_grave') { toGraveTopX(data.cardId); return; }
            if (action === 'to_shield') { (isOpp ? oShieldShuffleIn : shieldShuffleIn)(data.cardId); return; }
            if (action === 'to_deck_top') { toDeckTopX(data.cardId); return; }
            if (action === 'to_deck_bottom') { toDeckBottomX(data.cardId); return; }

            // NEW — explicit Opponent section actions (force opponent side regardless of current viewer owner)
            if (action === 'o_add_to_hand') { toHandOpp(data.cardId); return; }
            if (action === 'o_to_grave') { toOGraveTop(data.cardId); return; }
            if (action === 'o_to_shield') { oShieldShuffleIn(data.cardId); return; }
            if (action === 'o_to_deck_top') { toODeckTop(data.cardId); return; }
            if (action === 'o_to_deck_bottom') { toODeckBottom(data.cardId); return; }
            if (action === 'o_add_to_unit') {
                host.setPendingPlace({ source: 'viewer', cardId: data.cardId, target: 'unit', owner: 'opponent' });
                const modal = target?.closest?.('.pb-modal');
                if (modal) { modal.classList.add('is-hidden'); window.__PB_SUSPENDED_MODAL = modal; }
                return;
            }
            if (action === 'o_add_to_support') {
                host.setPendingPlace({ source: 'viewer', cardId: data.cardId, target: 'support', owner: 'opponent' });
                const modal = target?.closest?.('.pb-modal');
                if (modal) { modal.classList.add('is-hidden'); window.__PB_SUSPENDED_MODAL = modal; }
                return;
            }

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

