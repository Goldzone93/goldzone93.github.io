// /src/plugins/maybe-board.jsx
import React from 'react';

export default function registerMaybeBoard(pluginHost) {
  pluginHost.registerDeckHeaderRenderer?.({
    id: 'maybe-board-toggle',
    render: () => <MaybeToggle app={pluginHost.getAppApi?.()} />,
  });
}

function MaybeToggle({ app }) {
  if (!app) return null;

  const active = app.getActiveBoard?.() || 'DECK';
  const setActive = (v) => app.setActiveBoard?.(v);

  // Use the same look as the "Cards / Partners / Tokens" tabs
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
