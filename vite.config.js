// vite.config.js (after)
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    base: '/', // ✅ correct for https://goldzone93.github.io/
})