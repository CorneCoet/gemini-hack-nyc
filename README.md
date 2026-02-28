# GLB Dark Viewer (Node.js + React)

A minimal dark-mode `.glb` viewer built with React and Three.js.

## Prerequisites

- Node.js 18+ (Node.js 20 recommended)

## Start Dev Server

```bash
cd /Users/cornecoetzee/playground-consulting/gemini-hack-nyc
npm install
npm run dev
```

Then open the local URL printed by Vite (usually [http://localhost:5173](http://localhost:5173)).

## Optional: Expose On LAN

```bash
npm run dev -- --host
```

## Build And Preview

```bash
npm run build
npm run preview
```

## Use

- Click **Load GLB** and choose a `.glb` file, or drag and drop a file into the page.
- Orbit: left mouse drag
- Pan: right mouse drag
- Zoom: mouse wheel
