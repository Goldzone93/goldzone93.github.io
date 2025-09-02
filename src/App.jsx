// /src/App.jsx
import React, { useState, useCallback, useEffect } from 'react';
import { AppRoot } from './plugins/app-root.jsx';
import { TitleScreen } from './plugins/title-screen.jsx';
import { PackSimulator } from './plugins/pack-simulator.jsx';

export default function App() {
    const [view, setView] = useState('menu'); // 'menu' | 'deck' | (future: 'collection', 'settings')

    const navigate = useCallback((next) => setView(next), []);

    // Optional: allow Enter/Space as a shortcut on the Title Screen
    useEffect(() => {
        if (view !== 'menu') return;
        const onKey = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate('deck');
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [view, navigate]);

    // Back-compat: existing "Return to Title" event from the deck builder
    useEffect(() => {
        const onReturn = () => navigate('menu');
        window.addEventListener('tcg:return-to-title', onReturn);
        return () => window.removeEventListener('tcg:return-to-title', onReturn);
    }, [navigate]);

    // New: general-purpose navigation that any plugin can dispatch
    // window.dispatchEvent(new CustomEvent('tcg:navigate', { detail: { view: 'deck' } }))
    useEffect(() => {
        const onNav = (e) => {
            const next = e?.detail?.view;
            if (typeof next === 'string') navigate(next);
        };
        window.addEventListener('tcg:navigate', onNav);
        return () => window.removeEventListener('tcg:navigate', onNav);
    }, [navigate]);

    if (view === 'menu') {
        return (
            <TitleScreen
                onEnter={() => navigate('deck')}
                entries={[
                    { id: 'deck', label: 'Deck Builder', onSelect: () => navigate('deck') },
                    { id: 'pack', label: 'Pack Simulator', onSelect: () => navigate('pack') },
                    // Add more entries as you add features:
                    // { id: 'collection', label: 'Collection', onSelect: () => navigate('collection') },
                    // { id: 'settings',   label: 'Settings',   onSelect: () => navigate('settings') },
                ]}
            />
        );
    }

    if (view === 'deck') {
        return <AppRoot />;
    }

    if (view === 'pack') {
        return <PackSimulator />;
    }

    // Safety fallback: unknown view -> render nothing (or navigate back to menu)
    return null;
}
