// /src/plugins/app-root.jsx
import React from 'react';
import CoreApp from '../App.core.jsx';

/**
 * AppRoot: wraps your original App (now App.core.jsx)
 * without changing any logic/UI.
 */
export function AppRoot(props) {
    return <CoreApp {...props} />;
}

/**
 * Optional plugin registration for a future "root slot".
 * Safe to keep; it only runs if your host supports it.
 */
export default function registerAppRoot(pluginHost) {
    pluginHost?.registerRootRenderer?.({
        id: 'app-root',
        render: () => <AppRoot />,
    });
}
