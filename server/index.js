import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.1-pro-preview";
const DEV_PORT = 8787;
const PROD_PORT = 4173;
const TAG_DEBUG =
  process.env.TAG_DEBUG === "1" ||
  process.env.NODE_ENV !== "production";

const app = express();
app.use(express.json({ limit: "30mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "..", "dist");
const TAG_CAPTURE_LABELS = ["current", "iso", "front", "right", "back", "left", "top"];
const ESPRESSO_COMPONENT_GUIDE = [
  {
    canonical: "Group Head",
    aliases: ["group head", "grouphead", "brew head", "brew group", "espresso machine group"],
    clue:
      "Front-center brew assembly where the portafilter locks in; target the center of the circular outlet above the portafilter.",
  },
  {
    canonical: "Portafilter",
    aliases: ["portafilter", "group handle", "filter handle"],
    clue: "Metal handled filter basket assembly that twists into the group head.",
  },
  {
    canonical: "Steam Wand",
    aliases: ["steam wand", "milk frother wand"],
    clue: "Swivel metal wand used for steaming milk, usually on the right side.",
  },
  {
    canonical: "Hot Water Outlet",
    aliases: ["hot water outlet", "hot water spout"],
    clue: "Small dedicated outlet for dispensing hot water.",
  },
  {
    canonical: "Pressure Gauge",
    aliases: ["pressure gauge", "espresso gauge"],
    clue: "Round dial gauge on the front panel showing extraction pressure.",
  },
  {
    canonical: "Power Button",
    aliases: ["power button", "on off button", "on/off"],
    clue: "Front control used to turn the machine on or off.",
  },
  {
    canonical: "1 Cup Button",
    aliases: ["1 cup button", "single shot button"],
    clue: "Front button for a single espresso shot.",
  },
  {
    canonical: "2 Cup Button",
    aliases: ["2 cup button", "double shot button"],
    clue: "Front button for a double espresso shot.",
  },
  {
    canonical: "Grind Size Selector",
    aliases: ["grind size selector", "grind size dial", "grind size knob"],
    clue: "Selector near grinder for fine-to-coarse grind setting.",
  },
  {
    canonical: "Grind Amount Dial",
    aliases: ["grind amount dial", "dose dial"],
    clue: "Dial controlling how much coffee is ground into the basket.",
  },
  {
    canonical: "Filter Size Button",
    aliases: ["filter size button", "1 cup 2 cup filter button"],
    clue: "Control telling grinder whether single or double filter is used.",
  },
  {
    canonical: "Bean Hopper",
    aliases: ["bean hopper", "hopper"],
    clue: "Top container that holds whole coffee beans.",
  },
  {
    canonical: "Cup Warming Tray",
    aliases: ["cup warming tray", "top tray"],
    clue: "Flat warming surface on top of the machine.",
  },
  {
    canonical: "Water Tank",
    aliases: ["water tank", "reservoir"],
    clue: "Removable rear tank that stores water.",
  },
  {
    canonical: "Drip Tray",
    aliases: ["drip tray", "drip tray grill"],
    clue: "Bottom tray where drips collect beneath the group head.",
  },
];

function parseImageDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
}

function logTagDebug(message, data) {
  if (!TAG_DEBUG) return;
  if (typeof data === "undefined") {
    console.log(`[tag-debug] ${message}`);
    return;
  }
  console.log(`[tag-debug] ${message}`, data);
}

function previewText(value, maxLength = 400) {
  if (typeof value !== "string") return "";
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength)}...`;
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
  const pickObject = (value) => {
    if (Array.isArray(value)) {
      const firstObject = value.find((item) => item && typeof item === "object");
      return firstObject || {};
    }
    if (value && typeof value === "object") return value;
    return {};
  };

  const analysis = pickObject(data);

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

  const sanitizeLikelyJsonText = (value) =>
    value
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/i, "")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u00A0]/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/,\s*([}\]])/g, "$1");

  const extractObjectCandidate = (value) => {
    const firstBrace = value.indexOf("{");
    const lastBrace = value.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    return value.slice(firstBrace, lastBrace + 1);
  };

  const extractArrayCandidate = (value) => {
    const firstBracket = value.indexOf("[");
    const lastBracket = value.lastIndexOf("]");
    if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) return null;
    return value.slice(firstBracket, lastBracket + 1);
  };

  const parseCandidate = (value) => {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const sanitized = sanitizeLikelyJsonText(rawText);
  const candidates = [
    rawText,
    sanitized,
    extractObjectCandidate(rawText),
    extractObjectCandidate(sanitized),
    extractArrayCandidate(rawText),
    extractArrayCandidate(sanitized),
  ];

  for (const candidate of candidates) {
    const parsed = parseCandidate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function normalizeToken(value) {
  return firstString(value)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeTagCaptureLabel(value, fallback = "current") {
  const cleaned = normalizeToken(value).replace(/\s+/g, "-");
  if (TAG_CAPTURE_LABELS.includes(cleaned)) return cleaned;
  const fallbackCleaned = normalizeToken(fallback).replace(/\s+/g, "-");
  if (TAG_CAPTURE_LABELS.includes(fallbackCleaned)) return fallbackCleaned;
  return "current";
}

function getTokenSet(value) {
  return new Set(normalizeToken(value).split(" ").filter(Boolean));
}

function getTokenOverlapScore(a, b) {
  const tokensA = getTokenSet(a);
  const tokensB = getTokenSet(b);
  if (!tokensA.size || !tokensB.size) return 0;

  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) shared += 1;
  }

  return shared / Math.max(tokensA.size, tokensB.size);
}

function buildComponentGuideHints(component) {
  const componentName = firstString(component?.name, "component");
  let bestMatch = null;
  let bestScore = 0;

  for (const entry of ESPRESSO_COMPONENT_GUIDE) {
    let entryBestScore = getTokenOverlapScore(componentName, entry.canonical);
    for (const alias of entry.aliases) {
      entryBestScore = Math.max(entryBestScore, getTokenOverlapScore(componentName, alias));
    }
    if (entryBestScore > bestScore) {
      bestScore = entryBestScore;
      bestMatch = entry;
    }
  }

  const matched = bestScore >= 0.5 ? bestMatch : null;
  const aliases = new Set([componentName]);
  if (matched) {
    aliases.add(matched.canonical);
    matched.aliases.forEach((alias) => aliases.add(alias));
  }

  return {
    aliases: Array.from(aliases).filter(Boolean),
    matched,
    glossary: ESPRESSO_COMPONENT_GUIDE.map(
      (entry) =>
        `- ${entry.canonical} (aliases: ${entry.aliases.join(", ")}): ${entry.clue}`
    ).join("\n"),
  };
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
    "Use standard ASCII quotes (\") only. Do not use smart quotes.",
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

async function coerceToStrictJson(apiKey, rawText) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL_NAME)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const prompt = [
    "Convert the following model output into strict RFC8259 JSON.",
    "Rules:",
    "- Keep the same data only",
    "- Use standard ASCII quotes (\")",
    "- No markdown code fences",
    "- Return JSON only",
    "",
    rawText,
  ].join("\n");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1400,
        responseMimeType: "application/json",
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? `Gemini coercion failed with status ${response.status}.`
    );
  }
  return getGeminiText(payload);
}

async function fetchGeminiTagForComponent(apiKey, assetName, component, captures) {
  const componentName = firstString(component?.name, "component");
  const componentLocation = firstString(component?.location);
  const componentPurpose = firstString(component?.purpose);
  const hints = buildComponentGuideHints(component);
  const aliasHint = hints.aliases.join(", ");
  const brewHeadSpecificHint = hints.aliases.some((alias) =>
    ["brew head", "group head", "grouphead", "brew group"].includes(normalizeToken(alias))
  )
    ? "For brew/group head targets: mark the circular locking/outlet area directly above where the portafilter connects."
    : "";

  const prompt = [
    "You are tagging one machine component in multiple screenshots from a GLB viewer.",
    `Asset file name: ${assetName}.`,
    `Target component name: ${componentName}.`,
    `Acceptable target aliases: ${aliasHint}.`,
    componentLocation ? `Expected location hint: ${componentLocation}.` : "",
    componentPurpose ? `Expected purpose hint: ${componentPurpose}.` : "",
    hints.matched ? `Canonical component match: ${hints.matched.canonical}.` : "",
    brewHeadSpecificHint,
    "Choose the single capture where the target is most visible, then return coordinates in that capture only.",
    "Coordinate target should land on solid visible geometry (not empty background).",
    "Machine component vocabulary reference:",
    hints.glossary,
    "Return strict JSON only (no markdown):",
    "{",
    '  "componentName": "string",',
    '  "captureLabel": "current|iso|front|right|back|left|top|null",',
    '  "found": true,',
    '  "confidence": "high|medium|low",',
    '  "x": 0.52,',
    '  "y": 0.48,',
    '  "reason": "short reason"',
    "}",
    "x and y must be normalized image coordinates in [0, 1], where (0,0) is top-left.",
    "If you cannot identify the component confidently, set found=false and keep captureLabel/x/y null.",
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
            ...captures.flatMap((capture) => [
              { text: `Capture label: ${capture.label}` },
              {
                inlineData: {
                  mimeType: capture.mimeType,
                  data: capture.data,
                },
              },
            ]),
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 420,
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
    let parsed = parseJsonLoose(rawText);
    if (!parsed) {
      try {
        const repairedText = await coerceToStrictJson(apiKey, rawText);
        parsed = parseJsonLoose(repairedText);
      } catch {
        // keep null and continue with normalization fallback
      }
    }
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
  const tagRequestId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "Missing GEMINI_API_KEY on server. Add it in .env before starting npm run dev.",
    });
    return;
  }

  const { imageDataUrl, captures, assetName, component } = req.body ?? {};
  const parsedCaptures = (Array.isArray(captures) ? captures : [])
    .map((capture, index) => {
      const parsed = parseImageDataUrl(capture?.imageDataUrl);
      if (!parsed) return null;
      return {
        label: normalizeTagCaptureLabel(capture?.label, "current"),
        mimeType: parsed.mimeType,
        data: parsed.data,
      };
    })
    .filter(Boolean)
    .slice(0, 10);

  if (!parsedCaptures.length) {
    const parsedImage = parseImageDataUrl(imageDataUrl);
    if (parsedImage) {
      parsedCaptures.push({
        label: "current",
        mimeType: parsedImage.mimeType,
        data: parsedImage.data,
      });
    }
  }

  if (!parsedCaptures.length) {
    logTagDebug("tag-component invalid image payload", { tagRequestId });
    res.status(400).json({ error: "Invalid or missing screenshot image data." });
    return;
  }

  if (!component || typeof component !== "object") {
    logTagDebug("tag-component missing component payload", { tagRequestId });
    res.status(400).json({ error: "Missing component payload for tagging." });
    return;
  }

  const userAssetName =
    typeof assetName === "string" && assetName.trim() ? assetName.trim() : "unknown asset";
  const componentName = firstString(component?.name, "component");
  logTagDebug("tag-component request", {
    tagRequestId,
    assetName: userAssetName,
    componentName,
    componentLocation: firstString(component?.location),
    componentPurpose: firstString(component?.purpose),
    captureCount: parsedCaptures.length,
    captures: parsedCaptures.map((capture) => ({
      label: capture.label,
      mimeType: capture.mimeType,
      base64Length: capture.data.length,
    })),
  });

  try {
    const rawText = await fetchGeminiTagForComponent(
      apiKey,
      userAssetName,
      component,
      parsedCaptures
    );
    logTagDebug("tag-component gemini raw response", {
      tagRequestId,
      componentName,
      rawPreview: previewText(rawText, 500),
    });

    const parsed = parseJsonLoose(rawText);
    if (!parsed) {
      logTagDebug("tag-component parseJsonLoose returned null", {
        tagRequestId,
        componentName,
      });
    }
    const found = Boolean(parsed?.found);
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    const xIsValid = Number.isFinite(x) && x >= 0 && x <= 1;
    const yIsValid = Number.isFinite(y) && y >= 0 && y <= 1;
    const suggestedCaptureLabel = firstString(parsed?.captureLabel);
    const captureLabel = found
      ? normalizeTagCaptureLabel(suggestedCaptureLabel, parsedCaptures[0]?.label || "current")
      : null;
    const finalFound = found && xIsValid && yIsValid;
    const finalComponentName = firstString(parsed?.componentName, componentName);
    const confidence = firstString(parsed?.confidence, "unknown");
    const reason = firstString(parsed?.reason);
    logTagDebug("tag-component parsed result", {
      tagRequestId,
      componentName: finalComponentName,
      found,
      x,
      y,
      xIsValid,
      yIsValid,
      finalFound,
      captureLabel,
      suggestedCaptureLabel,
      confidence,
      reason,
    });

    res.json({
      componentName: finalComponentName,
      found: finalFound,
      confidence,
      captureLabel: finalFound ? captureLabel : null,
      x: finalFound ? x : null,
      y: finalFound ? y : null,
      reason,
      rawText,
    });
  } catch (error) {
    logTagDebug("tag-component failed", {
      tagRequestId,
      componentName,
      message: error?.message ?? "Unknown tagging error",
      stack: error?.stack ? previewText(error.stack, 800) : "",
    });
    res.status(500).json({
      error: error?.message ?? "Failed to tag component.",
    });
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({
    error: "API route not found. Restart the server to load latest routes.",
  });
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
