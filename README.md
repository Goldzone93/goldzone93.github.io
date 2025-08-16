# TCG Deckbuilder (fixed4)

This version fixes Vite issues where files inside `/public` were imported from JS.

**Rules of thumb**

- Files in `/public` must be referenced by URL (e.g. `<img src="/images/foo.png">`) or linked in `index.html`.
- CSS you want to import from JS must live in `src/`. We moved `styles.css` to `src/styles.css` and now `main.jsx` does `import './styles.css'`.
- Card images belong in `/public/images`. For each card, put `<InternalName>_a.png` for the front. If the corresponding `_b` is missing, the UI will show `/images/card0000_b.png` automatically.
- We load `cards.json` from `/public/cards.json` via `fetch('/cards.json')`.

## Run
```bash
npm i
npm run dev
```
