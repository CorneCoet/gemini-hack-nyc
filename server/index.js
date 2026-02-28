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
const ESPRESSO_COMPONENT_FALLBACKS = [
  {
    name: "Bean Hopper",
    location: "Top center",
    purpose: "Stores whole beans before grinding",
    notes: "Transparent bowl/container on top",
    confidence: "low",
  },
  {
    name: "Cup Warming Tray",
    location: "Top panel",
    purpose: "Warms cups before extraction",
    notes: "Flat tray surface near the hopper",
    confidence: "low",
  },
  {
    name: "Group Head",
    location: "Front center",
    purpose: "Brew outlet where portafilter locks in",
    notes: "Directly above portafilter position",
    confidence: "low",
  },
  {
    name: "Portafilter",
    location: "Front lower center",
    purpose: "Holds coffee basket during extraction",
    notes: "Handled metal filter holder",
    confidence: "low",
  },
  {
    name: "Steam Wand",
    location: "Front right side",
    purpose: "Steams and textures milk",
    notes: "Swiveling wand near milk pitcher area",
    confidence: "low",
  },
  {
    name: "Hot Water Outlet",
    location: "Front area",
    purpose: "Dispenses hot water",
    notes: "Separate from steam wand",
    confidence: "low",
  },
  {
    name: "Pressure Gauge",
    location: "Front panel center",
    purpose: "Displays extraction pressure",
    notes: "Round analog dial",
    confidence: "low",
  },
  {
    name: "Water Tank",
    location: "Rear side",
    purpose: "Stores water supply",
    notes: "Rear removable reservoir",
    confidence: "low",
  },
  {
    name: "Drip Tray",
    location: "Bottom front",
    purpose: "Collects overflow and drips",
    notes: "Grill and tray beneath group head",
    confidence: "low",
  },
];
const ESPRESSO_BUTTON_FALLBACKS = [
  {
    name: "Power Button",
    location: "Front panel",
    function: "Turns the machine on and off",
    color: "",
    labelText: "POWER",
    confidence: "low",
  },
  {
    name: "1 Cup Button",
    location: "Front panel right",
    function: "Starts a single-shot extraction",
    color: "",
    labelText: "1 CUP",
    confidence: "low",
  },
  {
    name: "2 Cup Button",
    location: "Front panel right",
    function: "Starts a double-shot extraction",
    color: "",
    labelText: "2 CUP",
    confidence: "low",
  },
  {
    name: "Grind Amount Dial",
    location: "Front panel left",
    function: "Adjusts dose amount",
    color: "",
    labelText: "GRIND AMOUNT",
    confidence: "low",
  },
  {
    name: "Grind Size Selector",
    location: "Front panel left",
    function: "Adjusts grind fineness",
    color: "",
    labelText: "GRIND SIZE",
    confidence: "low",
  },
  {
    name: "Filter Size Button",
    location: "Front panel left",
    function: "Selects single or double basket mode",
    color: "",
    labelText: "FILTER SIZE",
    confidence: "low",
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

function isLikelyEspressoContext(assetName, analysis) {
  const summary = normalizeToken(
    [
      assetName,
      analysis?.machineName,
      analysis?.machineType,
      analysis?.identification,
      ...(Array.isArray(analysis?.components) ? analysis.components.map((item) => item?.name) : []),
      ...(Array.isArray(analysis?.buttons) ? analysis.buttons.map((item) => item?.name) : []),
    ]
      .filter(Boolean)
      .join(" ")
  );

  if (!summary) return false;
  if (summary.includes("breville")) return true;
  if (summary.includes("espresso")) return true;
  if (summary.includes("barista")) return true;
  if (
    summary.includes("coffee") &&
    /(portafilter|steam|grind|hopper|gauge|wand)/.test(summary)
  ) {
    return true;
  }
  return false;
}

function mergeUniqueByName(existingItems, fallbackItems) {
  const output = Array.isArray(existingItems) ? [...existingItems] : [];
  const seen = new Set(
    output.map((item) => normalizeToken(item?.name)).filter(Boolean)
  );

  for (const item of fallbackItems) {
    const token = normalizeToken(item?.name);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    output.push({ ...item });
  }
  return output;
}

function mergeUniqueQueries(existingQueries, fallbackQueries) {
  const output = Array.isArray(existingQueries) ? [...existingQueries] : [];
  const seen = new Set(output.map((query) => normalizeToken(query)).filter(Boolean));

  for (const query of fallbackQueries) {
    const cleaned = firstString(query);
    const token = normalizeToken(cleaned);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    output.push(cleaned);
  }
  return output;
}

function enrichAnalysisWithFallbacks(assetName, analysis) {
  if (!isLikelyEspressoContext(assetName, analysis)) return analysis;

  const machineName = firstString(analysis.machineName);
  const machineType = firstString(analysis.machineType);
  const identification = firstString(analysis.identification);
  const confidence = firstString(analysis.confidence, "unknown");

  const mergedComponents = mergeUniqueByName(
    analysis.components,
    ESPRESSO_COMPONENT_FALLBACKS
  );
  const mergedButtons = mergeUniqueByName(
    analysis.buttons,
    ESPRESSO_BUTTON_FALLBACKS
  );
  const mergedQueries = mergeUniqueQueries(analysis.searchQueries, [
    "Breville Barista Express components",
    "Breville BES870 parts diagram",
    "espresso machine group head and portafilter",
  ]);

  return {
    ...analysis,
    machineName:
      machineName && normalizeToken(machineName) !== "unknown machine"
        ? machineName
        : "Breville Espresso Machine",
    machineType: machineType || "Espresso Machine",
    identification:
      identification ||
      "Semi-automatic espresso machine with integrated grinder, group head, steam wand, and portafilter.",
    confidence: confidence === "unknown" ? "medium" : confidence,
    buttons: mergedButtons,
    components: mergedComponents,
    searchQueries: mergedQueries,
  };
}

function parseTagModelOutput(rawText) {
  const parsed = parseJsonLoose(rawText);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed;
  }

  const text = firstString(rawText);
  if (!text) return null;

  const compact = text.replace(/\s+/g, " ");
  const numericPattern = "(-?(?:\\d+\\.\\d+|\\d+|\\.\\d+))";
  const xMatch =
    compact.match(new RegExp(`["']?x["']?\\s*[:=]\\s*${numericPattern}`, "i")) ||
    compact.match(new RegExp(`\\bx\\s*[:=]\\s*${numericPattern}`, "i"));
  const yMatch =
    compact.match(new RegExp(`["']?y["']?\\s*[:=]\\s*${numericPattern}`, "i")) ||
    compact.match(new RegExp(`\\by\\s*[:=]\\s*${numericPattern}`, "i"));
  const pairMatch = compact.match(
    /\(\s*(-?(?:\d+\.\d+|\d+|\.\d+))\s*,\s*(-?(?:\d+\.\d+|\d+|\.\d+))\s*\)/
  );
  const foundMatch = compact.match(/["']?found["']?\s*[:=]\s*(true|false)/i);
  const confidenceMatch = compact.match(
    /["']?confidence["']?\s*[:=]\s*["']?(high|medium|low|unknown)["']?/i
  );
  const captureMatch = compact.match(
    /["']?(captureLabel|view|preset)["']?\s*[:=]\s*["']?(current|iso|front|right|back|left|top)["']?/i
  );
  const reasonMatch = compact.match(/["']?reason["']?\s*[:=]\s*["']([^"']+)["']/i);

  const x = xMatch ? Number(xMatch[1]) : pairMatch ? Number(pairMatch[1]) : null;
  const y = yMatch ? Number(yMatch[1]) : pairMatch ? Number(pairMatch[2]) : null;
  const hasSignal =
    Number.isFinite(x) ||
    Number.isFinite(y) ||
    Boolean(foundMatch) ||
    Boolean(confidenceMatch) ||
    Boolean(captureMatch);

  if (!hasSignal) return null;

  return {
    found: foundMatch ? foundMatch[1].toLowerCase() === "true" : true,
    x,
    y,
    confidence: confidenceMatch ? confidenceMatch[1].toLowerCase() : "unknown",
    captureLabel: captureMatch ? captureMatch[2].toLowerCase() : "",
    reason: reasonMatch ? reasonMatch[1].trim() : "",
  };
}

function parseSvgOverlayModelOutput(rawText, component) {
  const parsed = parseJsonLoose(rawText);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed;
  }

  const text = firstString(rawText);
  if (!text) return null;
  const svgMatch = text.match(/<svg[\s\S]*<\/svg>/i);
  if (!svgMatch) return null;

  return {
    componentName: firstString(component?.name, "component"),
    captureLabel: firstString(component?.captureLabel, "current"),
    found: true,
    confidence: "low",
    x: Number(component?.x),
    y: Number(component?.y),
    width: 0.16,
    height: 0.16,
    interactionType: inferInteractionType(component),
    interactionSummary: "Generated from fallback SVG extraction.",
    svgCode: svgMatch[0],
  };
}

function sanitizeGeneratedSvg(svgCode) {
  const raw = firstString(svgCode);
  if (!raw) return "";

  const sanitized = raw
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!doctype[\s\S]*?>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");

  const svgMatch = sanitized.match(/<svg[\s\S]*<\/svg>/i);
  return svgMatch ? svgMatch[0].trim() : "";
}

function numberInRange(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeSvgOverlayResult(parsed, component, fallbackCaptureLabel) {
  const defaultX = numberInRange(component?.x, 0, 1, 0.5);
  const defaultY = numberInRange(component?.y, 0, 1, 0.5);
  const x = numberInRange(parsed?.x, 0, 1, defaultX);
  const y = numberInRange(parsed?.y, 0, 1, defaultY);
  const width = numberInRange(parsed?.width, 0.05, 0.7, 0.16);
  const height = numberInRange(parsed?.height, 0.05, 0.7, 0.16);
  const confidence = firstString(parsed?.confidence, "unknown");
  const captureLabel = normalizeTagCaptureLabel(
    firstString(parsed?.captureLabel),
    fallbackCaptureLabel
  );
  const found = parsed?.found === false ? false : true;
  const svgCode = sanitizeGeneratedSvg(parsed?.svgCode);
  const hasSvg = Boolean(svgCode);
  const fallbackInteractionType = inferInteractionType(component);
  const interactionType = normalizeInteractionType(
    firstString(parsed?.interactionType),
    fallbackInteractionType
  );

  return {
    componentName: firstString(parsed?.componentName, firstString(component?.name, "component")),
    found,
    confidence,
    captureLabel,
    x,
    y,
    width,
    height,
    interactionType,
    interactionSummary: firstString(parsed?.interactionSummary),
    svgCode,
    ready: found && hasSvg,
  };
}

function buildFallbackInteractiveSvg(componentName, interactionType) {
  const safeLabel = firstString(componentName, "Component").replace(/</g, "&lt;");

  switch (interactionType) {
    case "gauge":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="${safeLabel} interactive gauge">
  <style>
    .dial{fill:#0d1322;stroke:#6ee7ff;stroke-width:10}
    .ticks{stroke:#9cc6ff;stroke-width:4;opacity:.55}
    .needle{stroke:#ffcf6e;stroke-width:7;stroke-linecap:round;transform-origin:120px 150px;animation:sweep 2.4s ease-in-out infinite alternate}
    .hub{fill:#f1f5ff}
    @keyframes sweep{from{transform:rotate(-32deg)}to{transform:rotate(38deg)}}
  </style>
  <circle class="dial" cx="120" cy="150" r="74"/>
  <path class="ticks" d="M60 150h16M164 150h16M78 108l11 11M151 181l11 11M78 192l11-11M151 119l11-11"/>
  <line class="needle" x1="120" y1="150" x2="174" y2="124"/>
  <circle class="hub" cx="120" cy="150" r="8"/>
</svg>`;
    case "lid":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 220" role="img" aria-label="${safeLabel} interactive lid">
  <style>
    .bowl{fill:#e9eef7;fill-opacity:.25;stroke:#d7e8ff;stroke-width:4}
    .lid{fill:#dbe4f6;fill-opacity:.82;stroke:#f6fbff;stroke-width:3;transform-origin:130px 62px;animation:lift 2.2s ease-in-out infinite}
    .glow{fill:#7dd3fc;fill-opacity:.17;animation:pulse 2.2s ease-in-out infinite}
    @keyframes lift{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
    @keyframes pulse{0%,100%{fill-opacity:.1}50%{fill-opacity:.3}}
  </style>
  <ellipse class="glow" cx="130" cy="108" rx="92" ry="52"/>
  <ellipse class="bowl" cx="130" cy="114" rx="90" ry="56"/>
  <ellipse class="lid" cx="130" cy="62" rx="82" ry="34"/>
</svg>`;
    case "dial":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="${safeLabel} interactive dial">
  <style>
    .outer{fill:#0f172a;stroke:#8cc6ff;stroke-width:8}
    .knob{fill:#dbeafe;stroke:#f8fbff;stroke-width:3;transform-origin:120px 120px;animation:spin 3s linear infinite}
    .mark{fill:#1f2937}
    @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
  </style>
  <circle class="outer" cx="120" cy="120" r="88"/>
  <circle class="knob" cx="120" cy="120" r="52"/>
  <rect class="mark" x="116" y="76" width="8" height="24" rx="4"/>
</svg>`;
    case "lever":
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 180" role="img" aria-label="${safeLabel} interactive lever">
  <style>
    .base{fill:#172033;stroke:#7ab8ff;stroke-width:5}
    .arm{fill:#dbeafe;transform-origin:86px 94px;animation:tilt 2s ease-in-out infinite}
    .tip{fill:#fcd34d;animation:flash 2s ease-in-out infinite}
    @keyframes tilt{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-18deg)}}
    @keyframes flash{0%,100%{opacity:.7}50%{opacity:1}}
  </style>
  <rect class="base" x="26" y="88" width="88" height="28" rx="10"/>
  <rect class="arm" x="80" y="44" width="24" height="92" rx="10"/>
  <circle class="tip" cx="92" cy="42" r="16"/>
</svg>`;
    case "button":
    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220" role="img" aria-label="${safeLabel} interactive button">
  <style>
    .ring{fill:#4de3ff22;stroke:#9be7ff;stroke-width:4;animation:pulse 1.8s ease-in-out infinite}
    .core{fill:#e6f4ff;stroke:#cddff9;stroke-width:4}
    .dot{fill:#1e293b;animation:blink 1.2s steps(2) infinite}
    @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
    @keyframes blink{0%,45%{opacity:1}46%,100%{opacity:.45}}
  </style>
  <circle class="ring" cx="110" cy="110" r="82"/>
  <circle class="core" cx="110" cy="110" r="48"/>
  <circle class="dot" cx="110" cy="110" r="12"/>
</svg>`;
  }
}

function inferInteractionType(component) {
  const token = normalizeToken(
    `${firstString(component?.name)} ${firstString(component?.location)} ${firstString(component?.purpose)}`
  );
  if (/(gauge|pressure)/.test(token)) return "gauge";
  if (/(hopper|lid|cover)/.test(token)) return "lid";
  if (/(dial|knob|wheel|grind size|grind amount)/.test(token)) return "dial";
  if (/(portafilter|lever|wand|handle|spout)/.test(token)) return "lever";
  if (/(button|power|cup|switch)/.test(token)) return "button";
  return "generic";
}

function normalizeInteractionType(value, fallback = "generic") {
  const cleaned = firstString(value).toLowerCase().replace(/[^a-z]+/g, "");
  const allowed = new Set(["button", "lid", "gauge", "dial", "lever", "generic"]);
  if (allowed.has(cleaned)) return cleaned;
  return allowed.has(fallback) ? fallback : "generic";
}

function normalizeTagResult(parsed, fallbackComponentName, fallbackCaptureLabel) {
  const found = Boolean(parsed?.found);
  const x = Number(parsed?.x);
  const y = Number(parsed?.y);
  const xIsValid = Number.isFinite(x) && x >= 0 && x <= 1;
  const yIsValid = Number.isFinite(y) && y >= 0 && y <= 1;
  const finalFound = found && xIsValid && yIsValid;
  const suggestedCaptureLabel = firstString(parsed?.captureLabel);
  const captureLabel = finalFound
    ? normalizeTagCaptureLabel(suggestedCaptureLabel, fallbackCaptureLabel)
    : null;

  return {
    componentName: firstString(parsed?.componentName, fallbackComponentName),
    found,
    x,
    y,
    xIsValid,
    yIsValid,
    finalFound,
    suggestedCaptureLabel,
    captureLabel,
    confidence: firstString(parsed?.confidence, "unknown"),
    reason: firstString(parsed?.reason),
  };
}

function rankCapturesForComponent(component, captures) {
  const query = normalizeToken(
    `${firstString(component?.name)} ${firstString(component?.location)} ${firstString(component?.purpose)}`
  );
  const hints = buildComponentGuideHints(component);
  const aliases = hints.aliases.map((alias) => normalizeToken(alias)).join(" ");
  const allTokens = `${query} ${aliases}`;

  const preferredOrder = (() => {
    if (/(bean|hopper|top|grinder)/.test(allTokens)) {
      return ["top", "iso", "current", "front", "right", "left", "back"];
    }
    if (/(right|steam|wand|water)/.test(allTokens)) {
      return ["right", "front", "iso", "current", "top", "back", "left"];
    }
    if (/(left|dial|grind amount|grind size|power)/.test(allTokens)) {
      return ["left", "front", "iso", "current", "top", "back", "right"];
    }
    if (/(rear|back|tank|reservoir)/.test(allTokens)) {
      return ["back", "left", "right", "iso", "current", "top", "front"];
    }
    if (/(front|panel|group|brew|portafilter|gauge|cup|button)/.test(allTokens)) {
      return ["front", "iso", "current", "right", "left", "top", "back"];
    }
    return ["iso", "front", "current", "right", "left", "top", "back"];
  })();

  const map = new Map(captures.map((capture) => [capture.label, capture]));
  const ordered = [];

  for (const label of preferredOrder) {
    if (!map.has(label)) continue;
    ordered.push(map.get(label));
    map.delete(label);
  }

  for (const capture of map.values()) {
    ordered.push(capture);
  }

  return ordered;
}

async function fetchGeminiTagForSingleCapture(apiKey, assetName, component, capture) {
  const componentName = firstString(component?.name, "component");
  const componentLocation = firstString(component?.location);
  const componentPurpose = firstString(component?.purpose);
  const hints = buildComponentGuideHints(component);
  const aliasHint = hints.aliases.join(", ");
  const beanHopperHint = hints.aliases.some((alias) =>
    normalizeToken(alias).includes("bean hopper")
  )
    ? "Bean hopper means the transparent bowl/container at the top center holding beans."
    : "";
  const brewHeadHint = hints.aliases.some((alias) =>
    ["brew head", "group head", "grouphead", "brew group"].includes(normalizeToken(alias))
  )
    ? "Brew/group head means the circular locking outlet directly above the portafilter."
    : "";

  const prompt = [
    "Locate one machine component in this single screenshot.",
    `Asset file name: ${assetName}.`,
    `Capture label: ${capture.label}.`,
    `Target component: ${componentName}.`,
    `Aliases: ${aliasHint}.`,
    componentLocation ? `Expected location hint: ${componentLocation}.` : "",
    componentPurpose ? `Expected purpose hint: ${componentPurpose}.` : "",
    hints.matched ? `Canonical component match: ${hints.matched.canonical}.` : "",
    beanHopperHint,
    brewHeadHint,
    "If the target is visible, return found=true with best-guess coordinates even if confidence is low.",
    "Return strict JSON only (no markdown):",
    "{",
    '  "componentName": "string",',
    `  "captureLabel": "${capture.label}",`,
    '  "found": true,',
    '  "confidence": "high|medium|low",',
    '  "x": 0.50,',
    '  "y": 0.20,',
    '  "reason": "short reason"',
    "}",
    "x and y are normalized image coordinates in [0,1], top-left origin.",
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
        temperature: 0,
        maxOutputTokens: 260,
        responseMimeType: "application/json",
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? `Gemini single-capture tag request failed with status ${response.status}.`
    );
  }

  return getGeminiText(payload);
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

async function fetchGeminiSvgOverlayForComponent(apiKey, assetName, component, captures) {
  const componentName = firstString(component?.name, "component");
  const componentLocation = firstString(component?.location);
  const componentPurpose = firstString(component?.purpose);
  const inferredInteractionType = inferInteractionType(component);
  const seedX = numberInRange(component?.x, 0, 1, 0.5);
  const seedY = numberInRange(component?.y, 0, 1, 0.5);
  const seedCapture = normalizeTagCaptureLabel(component?.captureLabel, "current");
  const hints = buildComponentGuideHints(component);
  const aliasHint = hints.aliases.join(", ");

  const prompt = [
    "You are generating an interactive SVG overlay for a tagged machine component in a GLB viewer.",
    `Asset file name: ${assetName}.`,
    `Target component: ${componentName}.`,
    `Aliases: ${aliasHint}.`,
    componentLocation ? `Location hint: ${componentLocation}.` : "",
    componentPurpose ? `Purpose hint: ${componentPurpose}.` : "",
    `Inferred interaction type hint: ${inferredInteractionType}.`,
    `Existing tag seed: capture=${seedCapture}, x=${seedX.toFixed(4)}, y=${seedY.toFixed(4)}.`,
    "Choose the best capture where the component is most visible and return normalized placement values.",
    "The goal is to explain the component's role in the whole espresso workflow, not decorative art.",
    "Keep the visual tightly localized to the real component and avoid large off-target graphics.",
    "Use realistic intent cues:",
    "- bean hopper: lid opens and beans feed toward grinder",
    "- pressure gauge: needle sweeps within brew pressure range",
    "- brew head/portafilter: extraction flow toward cup",
    "- steam wand: steam plume near wand tip",
    "- dials: rotational tuning motion",
    "- buttons: concise pulse/activation",
    "Design interaction behavior for the component meaningfully, for example:",
    "- button flashes/pulses",
    "- lid lifts",
    "- gauge needle sweeps",
    "- dial/wheel rotates",
    "- handle/part slides or pivots",
    "SVG requirements:",
    "- Inline SVG only, no external assets",
    "- No JavaScript and no <script> tag",
    "- Use CSS and/or SMIL animation for interactivity",
    "- Keep SVG mostly transparent except the visual indicator",
    "Return strict JSON only (no markdown):",
    "{",
    '  "componentName": "string",',
    '  "captureLabel": "current|iso|front|right|back|left|top",',
    '  "found": true,',
    '  "confidence": "high|medium|low",',
    '  "x": 0.52,',
    '  "y": 0.34,',
    '  "width": 0.18,',
    '  "height": 0.18,',
    '  "interactionType": "button|lid|gauge|dial|lever|generic",',
    '  "interactionSummary": "short sentence",',
    '  "svgCode": "<svg ...>...</svg>"',
    "}",
    "x,y,width,height are normalized to the image size in [0,1].",
    "Keep width/height tightly around the target component size.",
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
        temperature: 0.2,
        maxOutputTokens: 2200,
        responseMimeType: "application/json",
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? `Gemini SVG request failed with status ${response.status}.`
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
    const baseAnalysis = normalizeAnalysis(parsed);
    const analysis = enrichAnalysisWithFallbacks(userAssetName, baseAnalysis);
    logTagDebug("analyze-machine summary", {
      assetName: userAssetName,
      machineName: analysis.machineName,
      machineType: analysis.machineType,
      componentCount: analysis.components.length,
      buttonCount: analysis.buttons.length,
      fallbackAddedComponents: Math.max(
        0,
        analysis.components.length - baseAnalysis.components.length
      ),
      fallbackAddedButtons: Math.max(0, analysis.buttons.length - baseAnalysis.buttons.length),
      usedFallbacks:
        analysis.components.length !== baseAnalysis.components.length ||
        analysis.buttons.length !== baseAnalysis.buttons.length,
    });
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

    let parsed = parseTagModelOutput(rawText);
    if (!parsed && rawText) {
      try {
        const repairedText = await coerceToStrictJson(apiKey, rawText);
        parsed = parseTagModelOutput(repairedText);
        logTagDebug("tag-component coerce-to-json fallback", {
          tagRequestId,
          componentName,
          repairedPreview: previewText(repairedText, 500),
          repairedParsed: Boolean(parsed),
        });
      } catch (error) {
        logTagDebug("tag-component coerce-to-json failed", {
          tagRequestId,
          componentName,
          message: error?.message ?? "Unknown coercion error",
        });
      }
    }

    if (!parsed) {
      logTagDebug("tag-component parse failed after primary + coerce", {
        tagRequestId,
        componentName,
      });
    }

    let normalized = normalizeTagResult(
      parsed,
      componentName,
      parsedCaptures[0]?.label || "current"
    );

    if (!normalized.finalFound) {
      const rankedCaptures = rankCapturesForComponent(component, parsedCaptures).slice(0, 6);
      logTagDebug("tag-component single-capture fallback start", {
        tagRequestId,
        componentName,
        attempts: rankedCaptures.map((capture) => capture.label),
      });

      for (const capture of rankedCaptures) {
        try {
          const fallbackRaw = await fetchGeminiTagForSingleCapture(
            apiKey,
            userAssetName,
            component,
            capture
          );
          let fallbackParsed = parseTagModelOutput(fallbackRaw);
          if (!fallbackParsed && fallbackRaw) {
            try {
              const repairedFallback = await coerceToStrictJson(apiKey, fallbackRaw);
              fallbackParsed = parseTagModelOutput(repairedFallback);
            } catch {
              // keep null and continue to next capture
            }
          }

          const fallbackNormalized = normalizeTagResult(fallbackParsed, componentName, capture.label);
          logTagDebug("tag-component single-capture fallback result", {
            tagRequestId,
            componentName,
            captureLabel: capture.label,
            rawPreview: previewText(fallbackRaw, 260),
            finalFound: fallbackNormalized.finalFound,
            x: fallbackNormalized.x,
            y: fallbackNormalized.y,
            confidence: fallbackNormalized.confidence,
            reason: fallbackNormalized.reason,
          });

          if (fallbackNormalized.finalFound) {
            normalized = {
              ...fallbackNormalized,
              reason: fallbackNormalized.reason || "Recovered with single-capture fallback.",
            };
            break;
          }
        } catch (error) {
          logTagDebug("tag-component single-capture fallback failed", {
            tagRequestId,
            componentName,
            captureLabel: capture.label,
            message: error?.message ?? "Unknown fallback error",
          });
        }
      }
    }

    const finalComponentName = normalized.componentName;
    const confidence = normalized.confidence;
    const reason =
      normalized.reason ||
      (!normalized.finalFound ? "Gemini returned unparseable or low-confidence coordinates." : "");

    logTagDebug("tag-component parsed result", {
      tagRequestId,
      componentName: finalComponentName,
      found: normalized.found,
      x: normalized.x,
      y: normalized.y,
      xIsValid: normalized.xIsValid,
      yIsValid: normalized.yIsValid,
      finalFound: normalized.finalFound,
      captureLabel: normalized.captureLabel,
      suggestedCaptureLabel: normalized.suggestedCaptureLabel,
      confidence,
      reason,
    });

    res.json({
      componentName: finalComponentName,
      found: normalized.finalFound,
      confidence,
      captureLabel: normalized.finalFound ? normalized.captureLabel : null,
      x: normalized.finalFound ? normalized.x : null,
      y: normalized.finalFound ? normalized.y : null,
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

app.post("/api/generate-component-svg", async (req, res) => {
  const svgRequestId = `${Date.now().toString(36)}-${Math.random()
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
  if (!component || typeof component !== "object") {
    res.status(400).json({ error: "Missing component payload for SVG generation." });
    return;
  }

  const parsedCaptures = (Array.isArray(captures) ? captures : [])
    .map((capture) => {
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
    res.status(400).json({ error: "Invalid or missing screenshot image data." });
    return;
  }

  const userAssetName =
    typeof assetName === "string" && assetName.trim() ? assetName.trim() : "unknown asset";
  const componentName = firstString(component?.name, "component");
  logTagDebug("generate-component-svg request", {
    svgRequestId,
    assetName: userAssetName,
    componentName,
    componentLocation: firstString(component?.location),
    componentPurpose: firstString(component?.purpose),
    seedX: component?.x,
    seedY: component?.y,
    seedCapture: firstString(component?.captureLabel),
    captureCount: parsedCaptures.length,
  });

  try {
    const rawText = await fetchGeminiSvgOverlayForComponent(
      apiKey,
      userAssetName,
      component,
      parsedCaptures
    );
    logTagDebug("generate-component-svg raw", {
      svgRequestId,
      componentName,
      rawPreview: previewText(rawText, 560),
    });

    let parsed = parseSvgOverlayModelOutput(rawText, component);
    if (!parsed && rawText) {
      try {
        const repairedText = await coerceToStrictJson(apiKey, rawText);
        parsed = parseSvgOverlayModelOutput(repairedText, component);
        logTagDebug("generate-component-svg coerce-to-json fallback", {
          svgRequestId,
          componentName,
          repairedParsed: Boolean(parsed),
          repairedPreview: previewText(repairedText, 360),
        });
      } catch (error) {
        logTagDebug("generate-component-svg coerce-to-json failed", {
          svgRequestId,
          componentName,
          message: error?.message ?? "Unknown coercion error",
        });
      }
    }

    const normalized = normalizeSvgOverlayResult(
      parsed,
      component,
      parsedCaptures[0]?.label || "current"
    );

    if (!normalized.ready) {
      const interactionType = inferInteractionType(component);
      const fallbackSvg = buildFallbackInteractiveSvg(componentName, interactionType);
      normalized.svgCode = sanitizeGeneratedSvg(fallbackSvg);
      normalized.interactionType = interactionType;
      normalized.found = true;
      normalized.confidence = normalized.confidence === "unknown" ? "low" : normalized.confidence;
      normalized.interactionSummary =
        normalized.interactionSummary ||
        `Fallback interactive SVG: ${interactionType} motion.`;
      normalized.ready = Boolean(normalized.svgCode);
      logTagDebug("generate-component-svg fallback-svg used", {
        svgRequestId,
        componentName,
        interactionType,
        ready: normalized.ready,
      });
    }

    res.json({
      model: MODEL_NAME,
      componentName: normalized.componentName,
      found: normalized.found && normalized.ready,
      confidence: normalized.confidence,
      captureLabel: normalized.captureLabel,
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      interactionType: normalized.interactionType,
      interactionSummary: normalized.interactionSummary,
      svgCode: normalized.svgCode,
      rawText,
    });
  } catch (error) {
    logTagDebug("generate-component-svg failed", {
      svgRequestId,
      componentName,
      message: error?.message ?? "Unknown SVG generation error",
    });
    res.status(500).json({
      error: error?.message ?? "Failed to generate SVG overlay.",
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
