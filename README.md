# GLB Dark Viewer (Node.js + React)

A dark-mode `.glb` viewer built with React + Three.js, with Gemini vision analysis in a right-side panel.

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

- Click **Load GLB** and choose a `.glb` file, or drag and drop a file into the page.
- The app takes a screenshot of the viewer and sends it to `gemini-3.1-pro-preview`.
- Gemini's description appears in the right panel.
- Click **Analyze View** anytime to re-analyze the current camera angle.
- Orbit: left mouse drag
- Pan: right mouse drag
- Zoom: mouse wheel
