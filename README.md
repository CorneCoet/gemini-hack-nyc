# GLB Dark Viewer (Node.js + React)

A dark-mode `.glb` viewer built with React + Three.js, with a Gemini-powered right panel that:
- identifies machine buttons and components from multiple screenshots
- tries internet lookups to find matching/public model references

## Prerequisites

- Node.js 18+ (Node.js 20 recommended)
- Google AI Studio API key (`GEMINI_API_KEY`)
- Optional: `GEMINI_MODEL` (defaults to `gemini-3.1-pro-preview`)

## Start Dev Server

```bash
cd /Users/cornecoetzee/playground-consulting/gemini-hack-nyc
npm install
cp .env.example .env
# Edit .env and set GEMINI_API_KEY
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

## Optional: Expose On LAN

```bash
npm run dev:web -- --host
```

## Build And Preview

```bash
npm run build
npm run preview -- --host
```

## Production Server

```bash
npm run build
GEMINI_API_KEY=your_key_here npm run start
```

Then open [http://localhost:4173](http://localhost:4173).

## Use

- Default startup model: `public/breville-coffee-machine.glb` (Breville Coffee Machine).
- Click **Load GLB** and choose a `.glb` file, or drag and drop a file into the page.
- The app captures multiple viewpoints (`iso/front/right/back/left/top`) and sends them to Gemini.
- Gemini returns:
  - machine identification
  - visible button list
  - visible component list
- Click **Tag Next Component** to call Gemini again and place one 3D tag at a time onto the model.
- The server then runs web search queries and shows potential internet matches in the panel.
- Click **Analyze Model** anytime to re-run analysis.
- Use the panel controls to manipulate the model:
  - preset views
  - rotate left/right
  - zoom in/out
  - reset view
- Orbit: left mouse drag
- Pan: right mouse drag
- Zoom: mouse wheel
