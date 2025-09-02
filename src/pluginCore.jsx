// Minimal plugin core for your TCG Deckbuilder
// All plugins are .jsx files under ./plugins/**

export class PluginHost {
  constructor() {
    this.galleryHeaderActions = []; // [{ id, label, onClick(app) } or { id, render(app) }]
    this.cardBadgeRenderers = [];   // [ ({ card, banned, isTokenCard, app }) => ReactNode | ReactNode[] ]
    this.galleryHeaderLeftActions = []; // same shape as galleryHeaderActions but for the LEFT side of the header
    this.helpSectionRenderers = []; // [{ id, render(app) }]
    this.deckHeaderRenderers = [];  // NEW: [{ id, render(app) }] - rendered under Deck header (right panel)
    this.appApi = null;
    this.gallerySorters = []; // NEW: plugins can provide gallery sorters
    this._gallerySortListeners = new Set(); // listeners for plugin-driven sort changes
    this._galleryScale = 1;
    this._scaleListeners = new Set();
    this._seq = 1; // auto-id counter for plugins without ids
  }

  /** Replace or push by id; auto-id if missing */
  _upsert(list, entry, prefix) {
    if (!entry || typeof entry !== 'object') return;
    if (!entry.id) entry.id = `${prefix || 'plugin'}-${this._seq++}`;
    const i = list.findIndex(x => x?.id === entry.id);
    if (i >= 0) list[i] = entry; else list.push(entry);
  }

  // Registration APIs exposed to plugins
  registerGalleryHeaderAction(action) {
    if (!action) return;
    this._upsert(this.galleryHeaderActions, action, 'gh-right');
  }
  registerCardBadgeRenderer(fn) {
    if (typeof fn === 'function') this.cardBadgeRenderers.push(fn);
  }

    registerGalleryHeaderLeftAction(action) {
        if (!action) return;
        this._upsert(this.galleryHeaderLeftActions, action, 'gh-left');
    }
    getGalleryHeaderLeftActions() { return this.galleryHeaderLeftActions.slice(); }

    registerGallerySorter(fn) {
        if (typeof fn === 'function') this.gallerySorters.push(fn);
    }

    registerHelpSectionRenderer(action) {
        if (action && (action.render || action.onClick)) {
            this._upsert(this.helpSectionRenderers, action, 'help');
        }
    }

    registerDeckHeaderRenderer(action) {
        if (action && (action.render || action.onClick)) {
            this._upsert(this.deckHeaderRenderers, action, 'deck-header');
        }
    }
    getDeckHeaderRenderers() {
        return Array.isArray(this.deckHeaderRenderers) ? this.deckHeaderRenderers : [];
    }

    getHelpSectionRenderers() {
        return Array.isArray(this.helpSectionRenderers) ? this.helpSectionRenderers : [];
    }

    // Call all registered sorters in order; each receives (list, ctx, appApi)
    // and can return a (possibly re-ordered) list.
    sortGallery(list, ctx = {}) {
        let arr = Array.isArray(list) ? [...list] : [];
        if (this.gallerySorters.length === 0) return arr; // no-op fallback
        for (const sorter of this.gallerySorters) {
            try {
                const res = sorter(arr, ctx, this.appApi);
                if (Array.isArray(res)) arr = res;
            } catch (e) {
                console.warn('[PluginCore] sorter failed:', e);
            }
        }
        return arr;
    }

    onGallerySortChange(cb) {
        if (typeof cb === 'function') {
            this._gallerySortListeners.add(cb);
            return () => this._gallerySortListeners.delete(cb);
        }
        return () => { };
    }
    offGallerySortChange(cb) { this._gallerySortListeners.delete(cb); }
    emitGallerySortChange() {
        this._gallerySortListeners.forEach(fn => { try { fn(); } catch { } });
    }

    // ----- Gallery scale bridge (plugin -> app) -----
    setGalleryScale(val) {
        const num = Number(val);
        this._galleryScale = Number.isFinite(num) ? num : 1;
        this._scaleListeners.forEach(fn => { try { fn(this._galleryScale); } catch { } });
    }
    getGalleryScale() {
        return this._galleryScale;
    }
    onGalleryScaleChange(cb) {
        if (typeof cb === 'function') {
            this._scaleListeners.add(cb);
            return () => this._scaleListeners.delete(cb);
        }
        return () => { };
    }

  // Core <-> plugins bridge
  setAppApi(api) { this.appApi = api; }
  getAppApi() { return this.appApi; }
  getGalleryHeaderActions() { return this.galleryHeaderActions.slice(); }

  getCardBadgeNodes(args) {
    const out = [];
    for (const fn of this.cardBadgeRenderers) {
      try {
        const res = fn({ ...args, app: this.appApi });
        if (Array.isArray(res)) out.push(...res);
        else if (res) out.push(res);
      } catch (e) {
        console.warn('[PluginCore] badge renderer failed:', e);
      }
    }
    return out;
  }
}

export const pluginHost =
    (typeof window !== 'undefined' && (window.__tcgPluginHost ||= new PluginHost())) ||
    new PluginHost();

// Eager-load all .jsx plugins in /src/plugins (Vite import.meta.glob)
export function loadPlugins() {
    // Load all .jsx plugins at once from /src/plugins (non-recursive)
    const modules = import.meta.glob('./plugins/*.jsx', { eager: true });
  Object.entries(modules).forEach(([path, mod]) => {
    const activate = mod?.default || mod?.activate || mod?.plugin;
    if (typeof activate === 'function') {
      try { activate(pluginHost); }
      catch (e) { console.warn(`[PluginCore] Failed to activate ${path}`, e); }
    }
  });
}
