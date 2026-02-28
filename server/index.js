import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.1-pro-preview";
const DEV_PORT = 8787;
const PROD_PORT = 4173;

const app = express();
app.use(express.json({ limit: "30mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "..", "dist");

function parseImageDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
}

function getGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}

function decodeEscapedText(value) {
  if (typeof value !== "string") return "";

  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function stripHtml(value) {
  return decodeEscapedText(value).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function firstString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim();
  return cleaned.length ? cleaned : fallback;
}

function normalizeAnalysis(data) {
  const analysis = typeof data === "object" && data ? data : {};

  const normalizeItems = (value, mapper) => {
    if (!Array.isArray(value)) return [];

    return value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        return mapper(item);
      })
      .filter(Boolean);
  };

  const buttons = normalizeItems(analysis.buttons, (button) => ({
    name: firstString(button.name, "Unknown button"),
    location: firstString(button.location),
    function: firstString(button.function),
    color: firstString(button.color),
    labelText: firstString(button.labelText),
    confidence: firstString(button.confidence),
  }));

  const components = normalizeItems(analysis.components, (component) => ({
    name: firstString(component.name, "Unknown component"),
    location: firstString(component.location),
    purpose: firstString(component.purpose),
    notes: firstString(component.notes),
    confidence: firstString(component.confidence),
  }));

  const searchQueries = Array.isArray(analysis.searchQueries)
    ? analysis.searchQueries
        .map((query) => firstString(query))
        .filter(Boolean)
    : [];

  return {
    machineName: firstString(analysis.machineName, "Unknown machine"),
    machineType: firstString(analysis.machineType),
    identification: firstString(analysis.identification),
    confidence: firstString(analysis.confidence, "unknown"),
    buttons,
    components,
    searchQueries,
  };
}

function parseJsonLoose(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) return null;

  try {
    return JSON.parse(rawText);
  } catch {
    // continue
  }

  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const candidate = rawText.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function normalizeToken(value) {
  return firstString(value)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildSearchQueries(assetName, analysis) {
  const output = [];
  const add = (query) => {
    const cleaned = firstString(query);
    if (!cleaned) return;
    if (output.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) {
      return;
    }
    output.push(cleaned);
  };

  add(`${assetName} glb`);

  const machineName = firstString(analysis.machineName);
  const machineType = firstString(analysis.machineType);

  if (machineName) add(`${machineName} 3d model`);
  if (machineName) add(`${machineName} industrial machine`);
  if (machineType) add(`${machineType} 3d model`);

  for (const query of analysis.searchQueries) {
    add(query);
  }

  return output.slice(0, 4);
}

async function searchBrave(query, maxResults = 5) {
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`Search request failed with status ${response.status}.`);
  }

  const html = await response.text();
  const matchRegex = /title:"([^"]+)",url:"(https?:\/\/[^"]+)"/g;
  const seenUrls = new Set();
  const results = [];

  for (const match of html.matchAll(matchRegex)) {
    const title = stripHtml(match[1]);
    const candidateUrl = decodeEscapedText(match[2]);

    if (!candidateUrl.startsWith("http")) continue;
    if (candidateUrl.includes("search.brave.com")) continue;
    if (seenUrls.has(candidateUrl)) continue;

    seenUrls.add(candidateUrl);
    results.push({ title, url: candidateUrl });

    if (results.length >= maxResults) {
      break;
    }
  }

  return results;
}

async function fetchGeminiAnalysis(apiKey, assetName, captures) {
  const prompt = [
    "You are analyzing multiple screenshots of one GLB machine model from different camera angles.",
    `Asset file name: ${assetName}.`,
    "Identify every visible button/control and every visible machine component.",
    "Do not hallucinate text labels that are not readable.",
    "Return strict JSON only (no markdown).",
    "Required JSON shape:",
    "{",
    '  "machineName": "string",',
    '  "machineType": "string",',
    '  "identification": "short sentence",',
    '  "confidence": "high|medium|low",',
    '  "buttons": [',
    "    {",
    '      "name": "string",',
    '      "location": "string",',
    '      "function": "string",',
    '      "color": "string",',
    '      "labelText": "string",',
    '      "confidence": "high|medium|low"',
    "    }",
    "  ],",
    '  "components": [',
    "    {",
    '      "name": "string",',
    '      "location": "string",',
    '      "purpose": "string",',
    '      "notes": "string",',
    '      "confidence": "high|medium|low"',
    "    }",
    "  ],",
    '  "searchQueries": ["string", "string"]',
    "}",
  ].join("\n");

  const parts = [{ text: prompt }];
  for (const capture of captures) {
    parts.push({ text: `View: ${capture.label}` });
    parts.push({
      inlineData: {
        mimeType: capture.mimeType,
        data: capture.data,
      },
    });
  }

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL_NAME)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens: 1400,
        responseMimeType: "application/json",
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? `Gemini request failed with status ${response.status}.`
    );
  }

  return getGeminiText(payload);
}

async function fetchGeminiTagForComponent(apiKey, assetName, component, capture) {
  const componentName = firstString(component?.name, "component");
  const componentLocation = firstString(component?.location);
  const componentPurpose = firstString(component?.purpose);

  const prompt = [
    "You are tagging one machine component in a screenshot from a GLB viewer.",
    `Asset file name: ${assetName}.`,
    `Target component name: ${componentName}.`,
    componentLocation ? `Expected location hint: ${componentLocation}.` : "",
    componentPurpose ? `Expected purpose hint: ${componentPurpose}.` : "",
    "Return strict JSON only (no markdown):",
    "{",
    '  "componentName": "string",',
    '  "found": true,',
    '  "confidence": "high|medium|low",',
    '  "x": 0.52,',
    '  "y": 0.48,',
    '  "reason": "short reason"',
    "}",
    "x and y must be normalized image coordinates in [0, 1], where (0,0) is top-left.",
    "If you cannot identify the component confidently, set found=false and keep x/y null.",
  ]
    .filter(Boolean)
    .join("\n");

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL_NAME)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: capture.mimeType,
                data: capture.data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 350,
        responseMimeType: "application/json",
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? `Gemini request failed with status ${response.status}.`
    );
  }

  return getGeminiText(payload);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL_NAME });
});

app.post("/api/analyze-machine", async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "Missing GEMINI_API_KEY on server. Add it in .env before starting npm run dev.",
    });
    return;
  }

  const { captures, assetName } = req.body ?? {};
  const userAssetName =
    typeof assetName === "string" && assetName.trim() ? assetName.trim() : "unknown asset";

  if (!Array.isArray(captures) || captures.length === 0) {
    res.status(400).json({ error: "Missing captures. Provide at least one screenshot." });
    return;
  }

  const parsedCaptures = captures
    .map((capture) => {
      const parsed = parseImageDataUrl(capture?.imageDataUrl);
      if (!parsed) return null;
      return {
        label: firstString(capture?.label, "view"),
        mimeType: parsed.mimeType,
        data: parsed.data,
      };
    })
    .filter(Boolean)
    .slice(0, 8);

  if (!parsedCaptures.length) {
    res.status(400).json({ error: "All captures were invalid image data URLs." });
    return;
  }

  try {
    const rawText = await fetchGeminiAnalysis(apiKey, userAssetName, parsedCaptures);
    const parsed = parseJsonLoose(rawText);
    const analysis = normalizeAnalysis(parsed);
    const searchQueries = buildSearchQueries(userAssetName, analysis);

    const token = normalizeToken(userAssetName);
    const searchGroups = await Promise.all(
      searchQueries.map(async (query) => {
        try {
          const results = await searchBrave(query, 5);
          const ranked = results.sort((a, b) => {
            const score = (value) => {
              const hay = `${value.title} ${value.url}`.toLowerCase();
              let output = 0;
              if (token && hay.includes(token)) output += 3;
              if (hay.includes("meshy")) output += 1;
              return output;
            };
            return score(b) - score(a);
          });

          return {
            query,
            results: ranked,
          };
        } catch (error) {
          return {
            query,
            results: [],
            error: error?.message ?? "Search failed.",
          };
        }
      })
    );

    res.json({
      model: MODEL_NAME,
      analysis,
      rawText,
      searchResults: searchGroups,
    });
  } catch (error) {
    res.status(500).json({
      error: error?.message ?? "Failed to analyze model.",
    });
  }
});

app.post("/api/tag-component", async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "Missing GEMINI_API_KEY on server. Add it in .env before starting npm run dev.",
    });
    return;
  }

  const { imageDataUrl, assetName, component } = req.body ?? {};
  const parsedImage = parseImageDataUrl(imageDataUrl);
  if (!parsedImage) {
    res.status(400).json({ error: "Invalid or missing screenshot image data." });
    return;
  }

  if (!component || typeof component !== "object") {
    res.status(400).json({ error: "Missing component payload for tagging." });
    return;
  }

  const userAssetName =
    typeof assetName === "string" && assetName.trim() ? assetName.trim() : "unknown asset";

  try {
    const rawText = await fetchGeminiTagForComponent(apiKey, userAssetName, component, {
      mimeType: parsedImage.mimeType,
      data: parsedImage.data,
    });

    const parsed = parseJsonLoose(rawText);
    const found = Boolean(parsed?.found);
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    const xIsValid = Number.isFinite(x) && x >= 0 && x <= 1;
    const yIsValid = Number.isFinite(y) && y >= 0 && y <= 1;
    const finalFound = found && xIsValid && yIsValid;

    res.json({
      componentName: firstString(parsed?.componentName, firstString(component?.name, "component")),
      found: finalFound,
      confidence: firstString(parsed?.confidence, "unknown"),
      x: finalFound ? x : null,
      y: finalFound ? y : null,
      reason: firstString(parsed?.reason),
      rawText,
    });
  } catch (error) {
    res.status(500).json({
      error: error?.message ?? "Failed to tag component.",
    });
  }
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

const port = Number(
  process.env.PORT || (process.env.NODE_ENV === "production" ? PROD_PORT : DEV_PORT)
);
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
