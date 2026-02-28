import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.1-pro-preview";
const DEV_PORT = 8787;
const PROD_PORT = 4173;

const app = express();
app.use(express.json({ limit: "25mb" }));

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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL_NAME });
});

app.post("/api/describe-scene", async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "Missing GEMINI_API_KEY on server. Set it before starting `npm run dev`.",
    });
    return;
  }

  const { imageDataUrl, assetName } = req.body ?? {};
  const parsed = parseImageDataUrl(imageDataUrl);
  if (!parsed) {
    res.status(400).json({ error: "Invalid or missing screenshot image data." });
    return;
  }

  const userAssetName =
    typeof assetName === "string" && assetName.trim().length > 0
      ? assetName.trim()
      : "unknown asset";

  const prompt = [
    "You are analyzing a screenshot from a 3D GLB viewer.",
    `Asset file name: ${userAssetName}.`,
    "Identify what object/machine/tool is most likely shown.",
    "Respond with:",
    "1) One-line identification",
    "2) 2-4 key visual clues that support that ID",
    "3) Confidence (high/medium/low)",
    "If uncertain, clearly say what it might be and why.",
  ].join("\n");

  try {
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
                  mimeType: parsed.mimeType,
                  data: parsed.data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 300,
        },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(response.status).json({
        error:
          payload?.error?.message ??
          `Gemini request failed with status ${response.status}.`,
      });
      return;
    }

    const description = getGeminiText(payload);
    if (!description) {
      res.status(502).json({ error: "Gemini returned an empty description." });
      return;
    }

    res.json({
      model: MODEL_NAME,
      description,
    });
  } catch (error) {
    res.status(500).json({
      error: error?.message ?? "Failed to contact Gemini API.",
    });
  }
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

const port = Number(process.env.PORT || (process.env.NODE_ENV === "production" ? PROD_PORT : DEV_PORT));
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
