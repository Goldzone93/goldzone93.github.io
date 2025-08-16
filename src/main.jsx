import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css' // FIX: import from src, not /public

createRoot(document.getElementById('root')).render(<App />)
