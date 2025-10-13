// /src/plugins/help-section.jsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';

export default function registerHelpSection(pluginHost) {
  // One renderer that outputs: (A) the Help buttons, and (B) the modals (portaled).
  pluginHost.registerHelpSectionRenderer?.({
    id: 'core-help-section',
    render: () => <HelpSection />,
  });
}

function HelpSection() {
  // -----------------------------
  // Local state (independent)
  // -----------------------------
  const [tipsOpen, setTipsOpen] = useState(false);

  const [keywordsOpen, setKeywordsOpen] = useState(false);
  const [keywords, setKeywords] = useState([]);
  const [keywordsQuery, setKeywordsQuery] = useState('');

  const [iconsOpen, setIconsOpen] = useState(false);
  const [icons, setIcons] = useState([]);
  const [iconsQuery, setIconsQuery] = useState('');

  const [elementsOpen, setElementsOpen] = useState(false);
  const [elements, setElements] = useState([]);
  const [elementsQuery, setElementsQuery] = useState('');

  const [turnOpen, setTurnOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);

  const [formatsOpen, setFormatsOpen] = useState(false);
  const [formatsConfig, setFormatsConfig] = useState({});

  const [cardTypesOpen, setCardTypesOpen] = useState(false);
  const [cardTypesQuery, setCardTypesQuery] = useState('');

  const [boardLayoutOpen, setBoardLayoutOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);

  // Primary reference data (from reference.json)
  const [refData, setRefData] = useState({
    SuperType: [],
    CardType: [],
    SubType: [],
    Rarity: [],
    Element: [],
    Set: [],
    Format: [],
    Formats: [],
    TurnStructure: [],
    Tips: [],
    FAQ: [],
    CardTypeInfo: [],
    CardLayout: null,
    BoardLayout: null,
  });

  // (Optional) card lookup used in Formats modal (Ban List nice display)
  const [cards, setCards] = useState([]);
  const [partners, setPartners] = useState([]);
  const [tokens, setTokens] = useState([]);
  const allById = useMemo(() => {
    const m = new Map();
    for (const c of cards) m.set(c.InternalName, c);
    for (const c of partners) m.set(c.InternalName, c);
    for (const c of tokens) m.set(c.InternalName, c);
    return m;
  }, [cards, partners, tokens]);
  const getById = useCallback((id) => allById.get(id) ?? null, [allById]);

  // -----------------------------
  // Data loading (independent)
  // -----------------------------
  useEffect(() => {
    (async () => {
      try {
        const [
          rCards, rPartners, rTokens,
          rRef, rFormats, rKeywords, rIcons, rElements
        ] = await Promise.all([
          fetch('/cards.json').catch(() => null),
          fetch('/partners.json').catch(() => null),
          fetch('/tokens.json').catch(() => null),
          fetch('/reference.json').catch(() => null),
          fetch('/formats.json').catch(() => null),
          fetch('/keywords.json').catch(() => null),
          fetch('/icons.json').catch(() => null),
          fetch('/elements.json').catch(() => null),
        ]);

        // card pools (for Formats ban list friendly names)
        if (rCards?.ok) setCards(await rCards.json());
        if (rPartners?.ok) setPartners(await rPartners.json());
        if (rTokens?.ok) setTokens(await rTokens.json());

        // reference.json
        if (rRef?.ok) {
          const j = await rRef.json();
          setRefData({
            SuperType: arr(j.SuperType),
            CardType: arr(j.CardType),
            SubType: arr(j.SubType),
            Rarity: arr(j.Rarity),
            Element: arr(j.Element),
            Set: arr(j.Set),
            Format: arr(j.Format),
            Formats: arr(j.Formats),
            TurnStructure: arr(j.TurnStructure),
            Tips: arr(j.Tips),
            FAQ: arr(j.FAQ),
            CardTypeInfo: arr(j.CardTypeInfo),
            CardLayout: j?.CardLayout || null,
            BoardLayout: j?.BoardLayout || null,
          });
        }

        // formats.json
        if (rFormats?.ok) {
          try { setFormatsConfig(await rFormats.json()); }
          catch { setFormatsConfig({}); }
        } else setFormatsConfig({});

        // keywords.json
        if (rKeywords?.ok) {
          try { setKeywords(await rKeywords.json() ?? []); }
          catch { setKeywords([]); }
        } else setKeywords([]);

        // icons.json
        if (rIcons?.ok) {
          try { setIcons(await rIcons.json() ?? []); }
          catch { setIcons([]); }
        } else setIcons([]);

        // elements.json
        if (rElements?.ok) {
          try { setElements(await rElements.json() ?? []); }
          catch { setElements([]); }
        } else setElements([]);

      } catch {
        // leave defaults
      }
    })();
  }, []);

  // formats list derived from reference.json (Format IDs are the order)
  const formatsList = useMemo(() => {
    const ids = (refData?.Format ?? []);
    const byId = new Map((refData?.Formats ?? []).map(f => [f.id, f]));
    return ids.map(id => ({
      id,
      name: byId.get(id)?.name ?? id,
      desc: byId.get(id)?.desc ?? '',
    }));
  }, [refData]);

  // -----------------------------
  // Helpers for icon/element images
  // -----------------------------
  const iconSrcs = (internal) => [
    `/images/${internal}.png`,
    `/icons/${internal}.png`,
    `/images/icons/${internal}.png`,
  ];
  const getIconSrc = (internal) => iconSrcs(internal)[0];
  const makeIconErrorHandler = (internal) => (e) => {
    const img = e.currentTarget;
    const tried = Number(img.dataset.tried || 0);
    const next = iconSrcs(internal)[tried + 1];
    if (next) {
      img.dataset.tried = String(tried + 1);
      img.src = next;
    } else {
      img.style.display = 'none';
    }
  };

  const elementSrcs = (internal) => [
    `/images/${internal}.png`,
    `/elements/${internal}.png`,
    `/images/elements/${internal}.png`,
  ];
  const getElementSrc = (internal) => elementSrcs(internal)[0];
  const makeElementImgErrorHandler = (internal) => (e) => {
    const img = e.currentTarget;
    const tried = Number(img.dataset.tried || 0);
    const next = elementSrcs(internal)[tried + 1];
    if (next) {
      img.dataset.tried = String(tried + 1);
      img.src = next;
    } else {
      img.style.display = 'none';
    }
  };

  const elementLookup = useMemo(() => {
    const m = new Map();
    for (const e of elements) {
      const dn = String(e?.DisplayName ?? '').trim().toLowerCase();
      const iname = String(e?.InternalName ?? '').trim().toLowerCase();
      if (dn) m.set(dn, e);
      if (iname) m.set(iname, e);
    }
    return m;
  }, [elements]);

  const splitElementList = (val) =>
    String(val ?? '')
      .split(/[,\|/]+/)
      .map(s => s.trim())
      .filter(Boolean);

  const renderElementList = (val) => {
    const items = splitElementList(val);
    if (items.length === 0) return null;
    return (
      <div className="elements-list">
        {items.map((name, idx) => {
          const found = elementLookup.get(name.toLowerCase());
          if (found?.InternalName) {
            return (
              <img
                key={`${name}-${idx}`}
                className="element-mini"
                src={getElementSrc(found.InternalName)}
                alt={found.DisplayName || found.InternalName}
                title={found.DisplayName || found.InternalName}
                data-tried="0"
                onError={makeElementImgErrorHandler(found.InternalName)}
                draggable={false}
              />
            );
          }
          return <span key={`${name}-${idx}`} className="badge">{name}</span>;
        })}
      </div>
    );
  };

  // -----------------------------
  // Keyboard shortcuts (independent)
  // -----------------------------
  useEffect(() => {
    const onKey = (e) => {
      // Global opt-out: when true, Help hotkeys are disabled
      if (window.__PB_DISABLE_HELP_SHORTCUTS) return;

      const tag = (e.target?.tagName || '').toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
      if (isTyping) return;

      const open = (setter, reset) => { setter(true); reset?.(''); };

      if (e.key === 'Escape') {
        if (tipsOpen) setTipsOpen(false);
        if (keywordsOpen) setKeywordsOpen(false);
        if (iconsOpen) setIconsOpen(false);
        if (elementsOpen) setElementsOpen(false);
        if (turnOpen) setTurnOpen(false);
        if (layoutOpen) setLayoutOpen(false);
        if (formatsOpen) setFormatsOpen(false);
        if (cardTypesOpen) setCardTypesOpen(false);
        if (boardLayoutOpen) setBoardLayoutOpen(false);
        if (faqOpen) setFaqOpen(false);
        return;
      }

      switch (e.key.toLowerCase()) {
        case '?':
        case '/':     // Shift+/ also yields '?'
        case 'h':
          open(setTipsOpen);
          break;
        case 'k':
          open(setKeywordsOpen, setKeywordsQuery);
          break;
        case 'c':
          open(setCardTypesOpen, setCardTypesQuery);
          break;
        case 'f':
          open(setFormatsOpen);
          break;
        case 'b':
          open(setBoardLayoutOpen);
          break;
        case 'i':
          open(setIconsOpen, setIconsQuery);
          break;
        case 'e':
          open(setElementsOpen, setElementsQuery);
          break;
        case 't':
          open(setTurnOpen);
          break;
        case 'l':
          open(setLayoutOpen);
          break;
        case 'q':
          open(setFaqOpen);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    tipsOpen, keywordsOpen, iconsOpen, elementsOpen,
    turnOpen, layoutOpen, formatsOpen, cardTypesOpen, boardLayoutOpen, faqOpen
  ]);

  // -----------------------------
  // UI: Help buttons (exact layout)
  // -----------------------------
  return (
    <>
      {/* 2-per-row layout for Help buttons */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          columnGap: 8,
          rowGap: 0,
          marginTop: 8
        }}
      >
        <div className="controls" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="tips-btn"
            style={{ width: '100%', whiteSpace: 'nowrap' }}
            onClick={() => setTipsOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={tipsOpen}
            title="Shortcut: ? / H"
          >
            Tips &amp; Features
          </button>
        </div>

        <div className="controls" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="tips-btn"
            style={{ width: '100%', whiteSpace: 'nowrap' }}
            onClick={() => { setKeywordsQuery(''); setKeywordsOpen(true); }}
            aria-haspopup="dialog"
            aria-expanded={keywordsOpen}
            title="Keywords"
          >
            Keywords
          </button>
        </div>

        <div className="controls" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="tips-btn"
            style={{ width: '100%', whiteSpace: 'nowrap' }}
            onClick={() => { setIconsQuery(''); setIconsOpen(true); }}
            aria-haspopup="dialog"
            aria-expanded={iconsOpen}
            title="Effect Icons"
          >
            Effect Icons
          </button>
        </div>

        <div className="controls" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="tips-btn"
            style={{ width: '100%', whiteSpace: 'nowrap' }}
            onClick={() => { setElementsQuery(''); setElementsOpen(true); }}
            aria-haspopup="dialog"
            aria-expanded={elementsOpen}
            title="Element Chart"
          >
            Element Chart
          </button>
        </div>

        <div className="controls" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="tips-btn"
            style={{ width: '100%', whiteSpace: 'nowrap' }}
            onClick={() => setTurnOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={turnOpen}
            title="Turn Structure"
          >
            Turn Structure
          </button>
        </div>

        <div className="controls" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="tips-btn"
            style={{ width: '100%', whiteSpace: 'nowrap' }}
            onClick={() => setLayoutOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={layoutOpen}
            title="Card Layout"
          >
            Card Layout
          </button>
        </div>
      </div>

      {/* Formats + Card Types side-by-side */}
      <div className="controls" style={{ marginTop: 0 }}>
        <button
          type="button"
          className="tips-btn"
          style={{ flex: 1, whiteSpace: 'nowrap' }}
          onClick={() => setFormatsOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={formatsOpen}
          title="Formats"
        >
          Formats
        </button>

        <button
          type="button"
          className="tips-btn"
          style={{ flex: 1, whiteSpace: 'nowrap' }}
          onClick={() => { setCardTypesQuery(''); setCardTypesOpen(true); }}
          aria-haspopup="dialog"
          aria-expanded={cardTypesOpen}
          title="Card Types"
        >
          Card Types
        </button>
      </div>

      <div className="controls" style={{ marginTop: 0 }}>
        <button
          type="button"
          className="tips-btn"
          style={{ flex: 1, whiteSpace: 'nowrap' }}
          onClick={() => setBoardLayoutOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={boardLayoutOpen}
          title="Board Layout"
        >
          Board Layout
        </button>

        <button
          type="button"
          className="tips-btn"
          style={{ flex: 1, whiteSpace: 'nowrap' }}
          onClick={() => setFaqOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={faqOpen}
          title="FAQ"
        >
          FAQ
        </button>
      </div>

      {/* ----------------------------- */}
      {/* Modals (ported verbatim)     */}
      {/* ----------------------------- */}

      {tipsOpen && createPortalLike(
        <div
          className="modal-window"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tips-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h2 id="tips-title">Tips &amp; Features</h2>
            <button
              className="modal-close"
              aria-label="Close Tips & Features"
              onClick={() => setTipsOpen(false)}
            >×</button>
          </div>
          <div className="modal-body">
            {Array.isArray(refData.Tips) && refData.Tips.length > 0 ? (
              <ul className="small">
                {refData.Tips.map((tip, i) => (<li key={i}>{tip}</li>))}
              </ul>
            ) : (
              <div className="small">No tips found. Add a top-level "Tips" array to reference.json.</div>
            )}
          </div>
        </div>,
        () => setTipsOpen(false)
      )}

      {keywordsOpen && createPortalLike(
        <div
          className="modal-window modal-keywords"
          role="dialog"
          aria-modal="true"
          aria-labelledby="keywords-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h2 id="keywords-title">Keywords</h2>
            <button className="modal-close" aria-label="Close Keywords" onClick={() => setKeywordsOpen(false)}>×</button>
          </div>
          <div className="modal-body">
            {keywords.length === 0 ? (
              <div className="small">No keywords found.</div>
            ) : (
              <>
                <div className="modal-search">
                  <input
                    type="text"
                    placeholder="Filter keywords (name, templating, rules, reminder). Shortcut: K"
                    value={keywordsQuery}
                    onChange={e => setKeywordsQuery(e.target.value)}
                  />
                </div>
                <div className="keywords-table-wrap">
                  <table className="keywords-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Templating</th>
                        <th>Rules Text</th>
                        <th>Reminder Text</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keywords
                        .filter(k => {
                          const q = keywordsQuery.trim().toLowerCase();
                          if (!q) return true;
                          const blob = [
                            k.DisplayName, k.TemplateName, k.RulesText, k.ReminderText
                          ].map(x => String(x || '').toLowerCase()).join(' ');
                          return blob.includes(q);
                        })
                        .map(k => (
                          <tr key={String(k.KeywordName || k.DisplayName || Math.random())}>
                            <td>{k.DisplayName ?? ''}</td>
                            <td>{k.TemplateName ?? ''}</td>
                            <td>{k.RulesText ?? ''}</td>
                            <td>{k.ReminderText ?? ''}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>,
        () => setKeywordsOpen(false)
      )}

      {iconsOpen && createPortalLike(
        <div
          className="modal-window modal-icons"
          role="dialog"
          aria-modal="true"
          aria-labelledby="icons-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h2 id="icons-title">Effect Icons</h2>
            <button className="modal-close" aria-label="Close Effect Icons" onClick={() => setIconsOpen(false)}>×</button>
          </div>
          <div className="modal-body">
            {icons.length === 0 ? (
              <div className="small">No icons found.</div>
            ) : (
              <>
                <div className="modal-search">
                  <input
                    type="text"
                    placeholder="Filter icons (name, rules, search term). Shortcut: I"
                    value={iconsQuery}
                    onChange={e => setIconsQuery(e.target.value)}
                  />
                </div>
                <div className="icons-table-wrap">
                  <table className="icons-table">
                    <thead>
                      <tr>
                        <th>Display Name</th>
                        <th>Image</th>
                        <th>Rules Text</th>
                        <th>Search Term</th>
                      </tr>
                    </thead>
                    <tbody>
                      {icons
                        .filter(ic => {
                          const q = iconsQuery.trim().toLowerCase();
                          if (!q) return true;
                          const blob = [
                            ic.DisplayName, ic.RulesText, ic.SearchTerm, ic.InternalName
                          ].map(x => String(x || '').toLowerCase()).join(' ');
                          return blob.includes(q);
                        })
                        .map(ic => (
                          <tr key={String(ic.InternalName || ic.DisplayName || Math.random())}>
                            <td>{ic.DisplayName ?? ''}</td>
                            <td className="icons-cell-img">
                              {ic.InternalName ? (
                                <img
                                  className="icon-img"
                                  src={getIconSrc(ic.InternalName)}
                                  alt={ic.DisplayName || ic.InternalName}
                                  data-tried="0"
                                  onError={makeIconErrorHandler(ic.InternalName)}
                                  draggable={false}
                                />
                              ) : null}
                            </td>
                            <td>{ic.RulesText ?? ''}</td>
                            <td>{ic.SearchTerm ?? ''}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>,
        () => setIconsOpen(false)
      )}

      {elementsOpen && createPortalLike(
        <div
          className="modal-window modal-elements"
          role="dialog"
          aria-modal="true"
          aria-labelledby="elements-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h2 id="elements-title">Element Chart</h2>
            <button className="modal-close" aria-label="Close Element Chart" onClick={() => setElementsOpen(false)}>×</button>
          </div>
          <div className="modal-body">
            {elements.length === 0 ? (
              <div className="small">No elements found.</div>
            ) : (
              <>
                <div className="modal-search">
                  <input
                    type="text"
                    placeholder="Filter elements (name, strong/weak lists). Shortcut: E"
                    value={elementsQuery}
                    onChange={e => setElementsQuery(e.target.value)}
                  />
                </div>
                <div className="elements-table-wrap">
                  <table className="elements-table">
                    <thead>
                      <tr>
                        <th>Display Name</th>
                        <th>Image</th>
                        <th>Strong Against</th>
                        <th>Weak To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {elements
                        .filter(el => {
                          const q = elementsQuery.trim().toLowerCase();
                          if (!q) return true;
                          const blob = [
                            el.DisplayName, el.InternalName,
                            ...(Array.isArray(el.StrongAgainst) ? el.StrongAgainst : []),
                            ...(Array.isArray(el.WeakTo) ? el.WeakTo : []),
                          ].map(x => String(x || '').toLowerCase()).join(' ');
                          return blob.includes(q);
                        })
                        .map(el => (
                          <tr key={String(el.InternalName || el.DisplayName || Math.random())}>
                            <td>{el.DisplayName ?? ''}</td>
                            <td className="elements-cell-img">
                              {el.InternalName ? (
                                <img
                                  className="element-img"
                                  src={getElementSrc(el.InternalName)}
                                  alt={el.DisplayName || el.InternalName}
                                  title={el.DisplayName || el.InternalName}
                                  data-tried="0"
                                  onError={makeElementImgErrorHandler(el.InternalName)}
                                  draggable={false}
                                />
                              ) : null}
                            </td>
                            <td className="elements-list-cell">{renderElementList(el.StrongAgainst)}</td>
                            <td className="elements-list-cell">{renderElementList(el.WeakTo)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>,
        () => setElementsOpen(false)
      )}

      {turnOpen && createPortalLike(
        <div
          className="modal-window modal-turn"
          role="dialog"
          aria-modal="true"
          aria-labelledby="turn-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h2 id="turn-title">Turn Structure</h2>
            <button className="modal-close" aria-label="Close Turn Structure" onClick={() => setTurnOpen(false)}>×</button>
          </div>
          <div className="modal-body">
            {Array.isArray(refData.TurnStructure) && refData.TurnStructure.length > 0 ? (
              refData.TurnStructure.map((section) => (
                <section key={section.section || section.phase} className="turn-section">
                  <div className="turn-section-title">
                    {section.section || section.phase}
                  </div>
                  <ul className="turn-list">
                          {(section.items || []).map((step, idx) => (
                              <li key={keyOrIdx(step?.name, idx, 'step')}>
                                  <span className="turn-step-name">{step?.name ? `${step.name}:` : 'Step:'}</span>{' '}
                                  <span className="turn-step-desc">{step?.desc ?? ''}</span>
                              </li>
                          ))}
                  </ul>
                </section>
              ))
            ) : (
              <div className="small">No TurnStructure found in reference.json.</div>
            )}
          </div>
        </div>,
        () => setTurnOpen(false)
      )}

      {layoutOpen && createPortalLike(
        <div
          className="modal-window modal-cardlayout"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cardlayout-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h2 id="cardlayout-title">Card Layout</h2>
            <button className="modal-close" aria-label="Close Card Layout" onClick={() => setLayoutOpen(false)}>×</button>
          </div>
          <div className="modal-body">
            {refData.CardLayout ? (
              <div>
                <h3 className="card-layout-title">{refData.CardLayout.title || 'How to Read a Card'}</h3>
                <figure className="card-layout-figure">
                  <img
                    className="card-layout-img"
                    src={refData.CardLayout.image || '/images/card_layout_example.png'}
                    alt="Sample card with numbered callouts"
                    onError={(e) => { e.currentTarget.src = '/images/card_layout_example.png'; }}
                    draggable={false}
                  />
                              {(refData.CardLayout.markers || []).map((m, idx) => (
                                  <div key={keyOrIdx(m?.id, idx, 'marker')} className="cl-bubble" style={{ left: `${m.x}%`, top: `${m.y}%` }} aria-label={`Marker ${m?.id ?? idx}`}>
                                      {m?.id ?? idx}
                                  </div>
                              ))}
                </figure>
                <ol className="card-layout-list">
                              {(refData.CardLayout.sections || []).map((sec, idx) => (
                                  <li key={keyOrIdx(sec?.id, idx, 'section')}>
                                      <span className="cl-num">{(sec?.id ?? idx)}.</span>{' '}
                                      <span className="cl-title">{sec?.title}</span>{' '}
                                      <span className="cl-text">- {sec?.text}</span>
                                      {Array.isArray(sec?.subitems) && sec.subitems.length > 0 && (
                                          <ul className="card-layout-sublist">
                                              {sec.subitems.map((sub, jdx) => (
                                                  <li key={keyOrIdx(sub?.id, jdx, 'sub')}>
                                                      <span className="cl-num">{(sub?.id ?? jdx)}.</span>{' '}
                                                      <span className="cl-title">{sub?.title}</span>{' '}
                                                      <span className="cl-text">- {sub?.text}</span>
                                                  </li>
                                              ))}
                                          </ul>
                                      )}
                                  </li>
                              ))}
                </ol>
              </div>
            ) : (
              <div className="small">No CardLayout found. Add a top-level “CardLayout” object to reference.json.</div>
            )}
          </div>
        </div>,
        () => setLayoutOpen(false)
      )}

      {formatsOpen && createPortalLike(
        <div
          className="modal-window modal-formats"
          role="dialog"
          aria-modal="true"
          aria-labelledby="formats-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h2 id="formats-title">Formats</h2>
            <button className="modal-close" aria-label="Close Formats" onClick={() => setFormatsOpen(false)}>×</button>
          </div>
          <div className="modal-body">
            {Array.isArray(formatsList) && formatsList.length ? (
              <table className="stats-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Format</th>
                    <th style={{ textAlign: 'left' }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {formatsList.map((f, idx) => {
                    const cfg = (formatsConfig && formatsConfig[f.id]) || {};

                    const deckSizeText = (() => {
                      const dsz = cfg.deckSize;
                      if (!dsz || dsz.type === 'none') return 'No deck size limit';
                      if (dsz.type === 'fixed') {
                        const n = Number(dsz.values);
                        return Number.isFinite(n) ? `${n} cards` : 'No deck size limit';
                      }
                      if (dsz.type === 'byElements') {
                        const vals = dsz.values || {};
                        const pairs = Object.entries(vals)
                          .sort((a, b) => Number(a[0]) - Number(b[0]))
                          .map(([k, v]) => `${k} → ${v}`);
                        return `By Partner elements: ${pairs.join(', ')}`;
                      }
                      return 'No deck size limit';
                    })();

                    const allowedSetsText = (() => {
                      const allowed = cfg.allowedSets;
                      if (!allowed || allowed === '*' || (Array.isArray(allowed) && allowed.length === 0)) {
                        return 'All sets';
                      }
                      return Array.isArray(allowed) ? allowed.join(', ') : 'All sets';
                    })();

                    const rarityCapText = (() => {
                      const rc = cfg.rarityCap || {};
                      const order = ['Common', 'Uncommon', 'Rare', 'Ultra Rare', 'Partner'];
                      const parts = order
                        .filter(r => rc[r] != null)
                        .map(r => `${r}: ${rc[r]}`);
                      Object.keys(rc).forEach(k => {
                        if (!order.includes(k)) parts.push(`${k}: ${rc[k]}`);
                      });
                      return parts.join(' · ');
                    })();

                    const banListText = (() => {
                      const raw = cfg?.BanList;
                      if (!raw) return '';
                      let ids = [];
                      if (Array.isArray(raw)) ids = raw.map(String);
                      else {
                        const s = String(raw).trim();
                        if (s) ids = s.includes(',') ? s.split(',').map(x => x.trim()).filter(Boolean) : [s];
                      }
                      if (!ids.length) return '';
                      return ids
                        .map(id => (getById ? (getById(id)?.CardName || id) : id))
                        .join(', ');
                    })();

                    return (
                        <tr key={keyOrIdx(f?.id, idx, 'format')}>
                        <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>{f.name}</td>
                        <td style={{ verticalAlign: 'top' }}>
                          <div style={{ marginBottom: 6 }}>
                            {f.desc || <span style={{ opacity: 0.7 }}>(no description yet)</span>}
                          </div>
                          <div className="small" style={{ opacity: 0.95, lineHeight: 1.5 }}>
                            <div><strong>Deck Size:</strong> {deckSizeText}</div>
                            <div><strong>Allowed Sets:</strong> {allowedSetsText}</div>
                            {rarityCapText && (<div><strong>Rarity Caps:</strong> {rarityCapText}</div>)}
                            {banListText && (<div><strong>Ban List:</strong> {banListText}</div>)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="small">No formats found in reference.json.</div>
            )}
          </div>
        </div>,
        () => setFormatsOpen(false)
      )}

      {cardTypesOpen && createPortalLike(
        <div
          className="modal-window modal-keywords"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cardtypes-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h2 id="cardtypes-title">Card Types</h2>
            <button className="modal-close" aria-label="Close Card Types" onClick={() => setCardTypesOpen(false)}>×</button>
          </div>
          <div className="modal-body">
            {(!Array.isArray(refData?.CardTypeInfo) || refData.CardTypeInfo.length === 0) ? (
              <div className="small">No card types found. Add a top-level "CardTypeInfo" array to reference.json.</div>
            ) : (
              <>
                <div className="modal-search">
                  <input
                    type="text"
                    placeholder="Filter card types (name, description)"
                    value={cardTypesQuery}
                    onChange={e => setCardTypesQuery(e.target.value)}
                  />
                </div>
                <div className="keywords-table-wrap cardtypes-table">
                  <table className="keywords-table">
                    <thead>
                      <tr>
                        <th style={{ width: 120, minWidth: 120 }}>Type</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refData.CardTypeInfo
                        .filter(ct => {
                          const q = cardTypesQuery.trim().toLowerCase();
                          if (!q) return true;
                          const blob = [ct.CardType, ct.CardTypeDescription]
                            .map(x => String(x || '').toLowerCase()).join(' ');
                          return blob.includes(q);
                        })
                        .map(ct => (
                          <tr key={String(ct.CardType || Math.random())}>
                            <td style={{ width: 120, minWidth: 120 }}>{ct.CardType ?? ''}</td>
                            <td>{ct.CardTypeDescription ?? ''}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>,
        () => setCardTypesOpen(false)
      )}

      {boardLayoutOpen && createPortalLike(
        <div
          className="modal-window modal-boardlayout"
          role="dialog"
          aria-modal="true"
          aria-labelledby="boardlayout-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h2 id="boardlayout-title">{refData?.BoardLayout?.title || 'Board Layout'}</h2>
            <button className="modal-close" aria-label="Close Board Layout" onClick={() => setBoardLayoutOpen(false)}>×</button>
          </div>
          <div className="modal-body">
            <figure className="board-layout-figure">
              <img
                src={refData?.BoardLayout?.image || '/images/game_board_layout.png'}
                alt="Board layout"
                className="board-layout-img"
              />
                      {(refData?.BoardLayout?.markers || []).map((m, idx) => (
                          <span key={keyOrIdx(m?.id, idx, 'bl-marker')} className="bl-bubble" style={{ left: `${m.x}%`, top: `${m.y}%` }}>
                              {m?.id ?? idx}
                          </span>
                      ))}
            </figure>
            <ol className="board-layout-list">
                      {(refData?.BoardLayout?.zones || []).map((z, idx) => (
                          <li key={keyOrIdx(z?.ZoneNum, idx, 'zone')}>
                              <span className="cl-title">{z?.ZoneName}</span>
                              <div>{z?.ZoneDescription}</div>
                          </li>
                      ))}
            </ol>
          </div>
        </div>,
        () => setBoardLayoutOpen(false)
      )}

      {faqOpen && createPortalLike(
        <div
          className="modal-window modal-faq"
          role="dialog"
          aria-modal="true"
          aria-labelledby="faq-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h2 id="faq-title">FAQ</h2>
            <button className="modal-close" aria-label="Close FAQ" onClick={() => setFaqOpen(false)}>×</button>
          </div>
          <div className="modal-body">
            {(!refData?.FAQ || refData.FAQ.length === 0) ? (
              <div className="small">
                No FAQ entries found. Add an <code>"FAQ"</code> array to <code>reference.json</code>.
              </div>
            ) : (
              <div className="faq-list">
                {refData.FAQ.map((item, idx) => (
                  <div key={idx} className="faq-item" style={{ marginBottom: 12 }}>
                    <div className="faq-q" style={{ fontWeight: 600 }}>
                      {item.question}
                    </div>
                    <div className="faq-a" style={{ marginTop: 4, opacity: 0.9 }}>
                      {item.answer}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>,
        () => setFaqOpen(false)
      )}
    </>
  );
}

// small utility
function arr(x) { return Array.isArray(x) ? x : []; }
function keyOrIdx(val, idx, prefix) {
    const s = String(val ?? '').trim();
    return s || `${prefix}-${idx}`;
}

// Minimal “createPortal” wrapper using the same backdrop behavior seen in App.jsx
function createPortalLike(windowNode, onClose) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="none">
      {React.cloneElement(windowNode, {
        onClick: (e) => { e.stopPropagation(); }
      })}
    </div>
  );
}
