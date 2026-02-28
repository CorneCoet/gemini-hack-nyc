import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

const ANALYSIS_MODEL = "gemini-3.1-pro-preview";
const VIEW_PRESETS = ["iso", "front", "right", "back", "left", "top"];
const TAG_CAPTURE_LABELS = ["current", ...VIEW_PRESETS];
const MAX_CAPTURE_DIMENSION = 1024;
const DEFAULT_GLB_URL = "/breville-coffee-machine.glb";
const DEFAULT_GLB_NAME = "Breville Coffee Machine.glb";
const TAG_DEBUG =
  import.meta.env.DEV ||
  String(import.meta.env.VITE_TAG_DEBUG || "").toLowerCase() === "true";
const INTERACTION_TYPES = ["button", "lid", "gauge", "dial", "lever", "generic"];

function toSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTagCaptureLabel(value, fallback = "current") {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (TAG_CAPTURE_LABELS.includes(cleaned)) return cleaned;
  return TAG_CAPTURE_LABELS.includes(fallback) ? fallback : "current";
}

function normalizeInteractionType(value, fallback = "generic") {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z]+/g, "")
    .trim();
  if (INTERACTION_TYPES.includes(cleaned)) return cleaned;
  return INTERACTION_TYPES.includes(fallback) ? fallback : "generic";
}

function inferInteractionTypeFromHints(...values) {
  const token = values
    .map((value) => String(value || ""))
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ");
  if (/(gauge|needle|pressure)/.test(token)) return "gauge";
  if (/(lid|cover|hopper|top cap)/.test(token)) return "lid";
  if (/(dial|wheel|knob|rotate|grind)/.test(token)) return "dial";
  if (/(lever|wand|handle|spout|portafilter|arm)/.test(token)) return "lever";
  if (/(button|flash|pulse|power|cup|switch)/.test(token)) return "button";
  return "generic";
}

function formatConfidence(value) {
  if (!value || typeof value !== "string") return "unknown";
  return value.trim().toLowerCase();
}

function resizeCanvasToDataUrl(canvas, maxDimension, quality) {
  if (!canvas) return "";

  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return "";

  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));

  const offscreen = document.createElement("canvas");
  offscreen.width = outWidth;
  offscreen.height = outHeight;

  const context = offscreen.getContext("2d");
  if (!context) return "";

  context.drawImage(canvas, 0, 0, outWidth, outHeight);
  return offscreen.toDataURL("image/jpeg", quality);
}

function buildTagGlyph(label) {
  const words = (label || "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!words.length) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
}

function logTagDebug(message, data) {
  if (!TAG_DEBUG) return;
  if (typeof data === "undefined") {
    console.log(`[tag-debug] ${message}`);
    return;
  }
  console.log(`[tag-debug] ${message}`, data);
}

function toShortVec3(vector) {
  if (!vector) return null;
  const round = (value) => Number(value.toFixed(4));
  return {
    x: round(vector.x),
    y: round(vector.y),
    z: round(vector.z),
  };
}

function toStoredVec3(vector) {
  if (!vector) return null;
  const x = Number(vector.x);
  const y = Number(vector.y);
  const z = Number(vector.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function numberInRange(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function sanitizeSvgMarkup(svgCode) {
  const raw = String(svgCode || "").trim();
  if (!raw) return "";

  const sanitized = raw
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!doctype[\s\S]*?>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");

  const match = sanitized.match(/<svg[\s\S]*<\/svg>/i);
  return match ? match[0].trim() : "";
}

function revokeOverlayBlobUrls(overlays) {
  toSafeArray(overlays).forEach((overlay) => {
    if (!overlay?.blobUrl) return;
    try {
      URL.revokeObjectURL(overlay.blobUrl);
    } catch {
      // Ignore browser URL revocation errors.
    }
  });
}

async function parseApiResponse(response, fallbackMessage) {
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (response.ok) {
    if (!isJson) {
      throw new Error(`${fallbackMessage}: unexpected non-JSON response.`);
    }

    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      throw new Error(`${fallbackMessage}: invalid JSON response.`);
    }
    return payload;
  }

  if (isJson) {
    const payload = await response.json().catch(() => null);
    const detail = payload?.error || payload?.message;
    if (detail) {
      throw new Error(detail);
    }
  } else {
    const text = await response.text().catch(() => "");
    const cleaned = text.replace(/\s+/g, " ").trim().slice(0, 220);
    if (cleaned) {
      throw new Error(`${fallbackMessage} (HTTP ${response.status}): ${cleaned}`);
    }
  }

  throw new Error(`${fallbackMessage} (HTTP ${response.status}).`);
}

export default function App() {
  const viewerShellRef = useRef(null);
  const canvasRef = useRef(null);
  const loadFileRef = useRef(null);
  const analyzeModelRef = useRef(null);
  const svgOverlaysRef = useRef([]);
  const viewerControlsRef = useRef({
    capturePresets: null,
    captureCurrent: null,
    setViewPreset: null,
    rotateBy: null,
    zoomBy: null,
    resetView: null,
    addTagMarker: null,
    clearTagMarkers: null,
    addSvgOverlay: null,
    removeSvgOverlay: null,
    clearSvgOverlays: null,
  });

  const [status, setStatus] = useState("No model loaded.");
  const [dragActive, setDragActive] = useState(false);
  const [assetName, setAssetName] = useState("");
  const [analysisData, setAnalysisData] = useState(null);
  const [analysisRawText, setAnalysisRawText] = useState("Load a GLB and click Analyze Model.");
  const [analysisStatus, setAnalysisStatus] = useState("Waiting for screenshot.");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [capturePreview, setCapturePreview] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [taggedComponents, setTaggedComponents] = useState([]);
  const [nextTagIndex, setNextTagIndex] = useState(0);
  const [isTaggingComponent, setIsTaggingComponent] = useState(false);
  const [tagStatus, setTagStatus] = useState("Run Analyze Model to start tagging components.");
  const [svgOverlays, setSvgOverlays] = useState([]);
  const [overlayStatus, setOverlayStatus] = useState(
    "Tag a component, then generate an interactive SVG overlay."
  );
  const [overlayBusyKey, setOverlayBusyKey] = useState("");

  const waitForRenderFrames = useCallback(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
    []
  );

  const analyzeModel = useCallback(
    async (nameOverride = "") => {
      const finalAssetName = nameOverride || assetName;
      if (!finalAssetName) {
        setAnalysisStatus("Load a GLB before running analysis.");
        return;
      }

      const capturePresets = viewerControlsRef.current.capturePresets;
      if (typeof capturePresets !== "function") {
        setAnalysisStatus("Viewer is not ready yet.");
        return;
      }

      setAnalysisData(null);
      setAnalysisRawText("");
      setSearchResults([]);
      setCapturePreview("");
      setAnalysisStatus("Capturing multiple screenshots...");
      setIsAnalyzing(true);

      try {
        const captures = await capturePresets();
        if (!captures.length) {
          throw new Error("Could not capture screenshots from the viewer.");
        }

        setCapturePreview(captures[0].imageDataUrl);
        setAnalysisStatus(`Analyzing with ${ANALYSIS_MODEL}...`);

        const response = await fetch("/api/analyze-machine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assetName: finalAssetName,
            captures,
          }),
        });

        const payload = await parseApiResponse(response, "Gemini analysis request failed");

        setAnalysisData(payload.analysis ?? null);
        setAnalysisRawText(payload.rawText ?? "");
        setSearchResults(toSafeArray(payload.searchResults));
        setAnalysisStatus(`Analyzed by ${payload.model ?? ANALYSIS_MODEL}.`);
      } catch (error) {
        setAnalysisData(null);
        setAnalysisRawText("Could not analyze this model.");
        setSearchResults([]);
        setAnalysisStatus(error?.message ?? "Unknown analysis error.");
      } finally {
        setIsAnalyzing(false);
      }
    },
    [assetName]
  );

  useEffect(() => {
    analyzeModelRef.current = analyzeModel;
  }, [analyzeModel]);

  useEffect(() => {
    svgOverlaysRef.current = svgOverlays;
  }, [svgOverlays]);

  useEffect(
    () => () => {
      revokeOverlayBlobUrls(svgOverlaysRef.current);
    },
    []
  );

  useEffect(() => {
    setTaggedComponents([]);
    setNextTagIndex(0);
    setOverlayBusyKey("");
    setOverlayStatus("Tag a component, then generate an interactive SVG overlay.");
    setSvgOverlays((previous) => {
      revokeOverlayBlobUrls(previous);
      return [];
    });
    if (analysisData) {
      setTagStatus("Click Tag Next Component to place labels one at a time.");
    } else {
      setTagStatus("Run Analyze Model to start tagging components.");
    }
    viewerControlsRef.current.clearTagMarkers?.();
    viewerControlsRef.current.clearSvgOverlays?.();
  }, [analysisData, assetName]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.65;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#05070b");

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    const envTexture = pmremGenerator.fromScene(roomEnvironment, 0.05).texture;
    scene.environment = envTexture;

    const camera = new THREE.PerspectiveCamera(
      52,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(3.5, 2.5, 3.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(0, 1, 0);

    const hemiLight = new THREE.HemisphereLight("#c1c8ff", "#11213a", 1.1);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight("#ffffff", 2);
    keyLight.position.set(3.5, 6, 4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight("#9ac5ff", 1.1);
    fillLight.position.set(-4, 2, -2);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight("#66ddff", 0.7);
    rimLight.position.set(-3, 5, 5);
    scene.add(rimLight);

    const grid = new THREE.GridHelper(20, 20, "#4de3ff44", "#4de3ff18");
    grid.position.y = -0.001;
    scene.add(grid);

    const loader = new GLTFLoader();
    const textureLoader = new THREE.TextureLoader();
    const svgLoader = new SVGLoader();
    let currentModel = null;
    let dragDepth = 0;
    let frameId = 0;
    let currentTagWorldSize = 0.08;
    const raycaster = new THREE.Raycaster();
    const ndcVector = new THREE.Vector2();
    const clock = new THREE.Clock();
    const tagGroup = new THREE.Group();
    const svgGroup = new THREE.Group();
    const svgOverlayMap = new Map();
    const svgOverlayUpdaters = new Map();
    scene.add(tagGroup);
    scene.add(svgGroup);

    const renderFrame = () => {
      controls.update();
      renderer.render(scene, camera);
    };

    const getViewDirection = (presetName) => {
      switch (presetName) {
        case "front":
          return {
            direction: new THREE.Vector3(0, 0, 1),
            up: new THREE.Vector3(0, 1, 0),
          };
        case "right":
          return {
            direction: new THREE.Vector3(1, 0, 0),
            up: new THREE.Vector3(0, 1, 0),
          };
        case "back":
          return {
            direction: new THREE.Vector3(0, 0, -1),
            up: new THREE.Vector3(0, 1, 0),
          };
        case "left":
          return {
            direction: new THREE.Vector3(-1, 0, 0),
            up: new THREE.Vector3(0, 1, 0),
          };
        case "top":
          return {
            direction: new THREE.Vector3(0, 1, 0.02),
            up: new THREE.Vector3(0, 0, -1),
          };
        case "iso":
        default:
          return {
            direction: new THREE.Vector3(1, 0.7, 1),
            up: new THREE.Vector3(0, 1, 0),
          };
      }
    };

    const setViewPreset = (presetName) => {
      const { direction, up } = getViewDirection(presetName);
      const normalizedDirection = direction.clone().normalize();
      const target = controls.target.clone();
      const distance = camera.position.distanceTo(target);

      camera.up.copy(up);
      camera.position.copy(target).addScaledVector(normalizedDirection, distance);
      camera.lookAt(target);
      renderFrame();
    };

    const rotateBy = (angleInRadians) => {
      controls.rotateLeft(angleInRadians);
      renderFrame();
    };

    const zoomBy = (scaleFactor) => {
      const offset = camera.position.clone().sub(controls.target);
      offset.multiplyScalar(scaleFactor);
      camera.position.copy(controls.target).add(offset);
      renderFrame();
    };

    const resetView = () => {
      controls.reset();
      camera.up.set(0, 1, 0);
      renderFrame();
    };

    const createTagMaterial = (label) => {
      const canvasTag = document.createElement("canvas");
      canvasTag.width = 512;
      canvasTag.height = 512;
      const context = canvasTag.getContext("2d");
      if (!context) return null;

      context.clearRect(0, 0, canvasTag.width, canvasTag.height);

      const cx = canvasTag.width / 2;
      const cy = canvasTag.height / 2;
      const outerRadius = 210;
      const innerRadius = 128;

      context.fillStyle = "#d8b77a66";
      context.beginPath();
      context.arc(cx, cy, outerRadius, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "#eceff4f2";
      context.beginPath();
      context.arc(cx, cy, innerRadius, 0, Math.PI * 2);
      context.fill();

      context.strokeStyle = "#ffffffbb";
      context.lineWidth = 8;
      context.beginPath();
      context.arc(cx, cy, innerRadius, 0, Math.PI * 2);
      context.stroke();

      context.fillStyle = "#1e293b";
      context.font = "700 90px 'Space Grotesk', sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(buildTagGlyph(label), cx, cy + 8);

      const texture = new THREE.CanvasTexture(canvasTag);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;

      return new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
    };

    const disposeRenderable = (object) => {
      if (!object) return;
      object.traverse((node) => {
        if (!node.isMesh) return;
        node.geometry?.dispose?.();
        if (Array.isArray(node.material)) {
          node.material.forEach((material) => {
            material?.map?.dispose?.();
            material?.dispose?.();
          });
          return;
        }
        node.material?.map?.dispose?.();
        node.material?.dispose?.();
      });
    };

    const clearTagMarkers = () => {
      while (tagGroup.children.length > 0) {
        const child = tagGroup.children[0];
        tagGroup.remove(child);
        disposeRenderable(child);
      }
      renderFrame();
    };

    const clearSvgOverlays = () => {
      for (const [overlayId, mesh] of svgOverlayMap.entries()) {
        svgGroup.remove(mesh);
        disposeRenderable(mesh);
        svgOverlayMap.delete(overlayId);
        svgOverlayUpdaters.delete(overlayId);
      }
      renderFrame();
    };

    const removeSvgOverlay = (overlayId) => {
      if (!overlayId) return;
      const mesh = svgOverlayMap.get(overlayId);
      if (!mesh) return;
      svgGroup.remove(mesh);
      disposeRenderable(mesh);
      svgOverlayMap.delete(overlayId);
      svgOverlayUpdaters.delete(overlayId);
      renderFrame();
    };

    const findSurfaceHit = (x, y, meshes) => {
      let probeCount = 0;
      const castAt = (sampleX, sampleY) => {
        probeCount += 1;
        ndcVector.set(sampleX * 2 - 1, -(sampleY * 2 - 1));
        raycaster.setFromCamera(ndcVector, camera);
        const hits = raycaster.intersectObjects(meshes, true);
        return hits.length ? hits[0] : null;
      };

      const direct = castAt(x, y);
      if (direct) {
        logTagDebug("raycast direct hit", {
          sample: { x, y },
          probeCount,
          objectName: direct.object?.name || "unnamed-mesh",
          distance: Number(direct.distance.toFixed(4)),
        });
        return direct;
      }

      const maxRadius = 0.16;
      const radiusStep = 0.01;
      const angleStep = Math.PI / 6;
      let bestHit = null;
      let bestScore = Number.POSITIVE_INFINITY;
      let bestSample = null;

      for (let radius = radiusStep; radius <= maxRadius; radius += radiusStep) {
        for (let angle = 0; angle < Math.PI * 2; angle += angleStep) {
          const sampleX = x + Math.cos(angle) * radius;
          const sampleY = y + Math.sin(angle) * radius;
          if (sampleX < 0 || sampleX > 1 || sampleY < 0 || sampleY > 1) continue;

          const hit = castAt(sampleX, sampleY);
          if (hit) {
            const score = radius + hit.distance * 0.0001;
            if (score < bestScore) {
              bestScore = score;
              bestHit = hit;
              bestSample = { sampleX, sampleY, radius };
            }
          }
        }
      }

      if (bestHit) {
        logTagDebug("raycast nearby hit", {
          target: { x, y },
          sample: {
            x: Number(bestSample.sampleX.toFixed(4)),
            y: Number(bestSample.sampleY.toFixed(4)),
          },
          radius: Number(bestSample.radius.toFixed(4)),
          score: Number(bestScore.toFixed(5)),
          probeCount,
          objectName: bestHit.object?.name || "unnamed-mesh",
          distance: Number(bestHit.distance.toFixed(4)),
        });
        return bestHit;
      }

      logTagDebug("raycast miss", {
        target: { x, y },
        probeCount,
        meshCount: meshes.length,
      });
      return null;
    };

    const createSurfaceBadgeFallback = (label, position, normal, tag) => {
      const badgeMaterial = createTagMaterial(label);
      if (!badgeMaterial) return null;

      const badgeSize = Math.max(currentTagWorldSize * 0.42, 0.028);
      const badgeGeometry = new THREE.PlaneGeometry(badgeSize, badgeSize);
      const badgeMesh = new THREE.Mesh(badgeGeometry, badgeMaterial);
      const unitNormal = normal.clone().normalize();

      badgeMesh.position.copy(position).addScaledVector(unitNormal, 0.0025);
      badgeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), unitNormal);
      badgeMesh.renderOrder = 11;
      badgeMesh.userData.tag = tag;
      return badgeMesh;
    };

    const computeOverlayWorldSizeFromCapture = (surfaceHit, widthNorm, heightNorm) => {
      const normalizedWidth = THREE.MathUtils.clamp(Number(widthNorm) || 0.16, 0.03, 0.42);
      const normalizedHeight = THREE.MathUtils.clamp(Number(heightNorm) || 0.16, 0.03, 0.42);
      const distance = camera.position.distanceTo(surfaceHit.point);
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const worldScreenHeight = 2 * Math.tan(vFov / 2) * distance;
      const worldScreenWidth = worldScreenHeight * camera.aspect;

      const worldWidth = THREE.MathUtils.clamp(
        worldScreenWidth * normalizedWidth,
        currentTagWorldSize * 0.2,
        currentTagWorldSize * 4
      );
      const worldHeight = THREE.MathUtils.clamp(
        worldScreenHeight * normalizedHeight,
        currentTagWorldSize * 0.2,
        currentTagWorldSize * 4
      );
      const worldDepth = THREE.MathUtils.clamp(
        Math.min(worldWidth, worldHeight) * 0.5,
        0.006,
        Math.max(worldWidth, worldHeight) * 0.9
      );

      return new THREE.Vector3(worldWidth, worldHeight, worldDepth);
    };

    const computeSurfaceOrientation = (surfaceNormal, surfacePoint) => {
      const normal = surfaceNormal.clone().normalize();
      const viewDirection = camera.position.clone().sub(surfacePoint).normalize();
      let tangent = new THREE.Vector3().crossVectors(camera.up, normal);
      if (tangent.lengthSq() < 1e-6) {
        tangent = new THREE.Vector3().crossVectors(viewDirection, normal);
      }
      if (tangent.lengthSq() < 1e-6) {
        tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), normal);
      }
      if (tangent.lengthSq() < 1e-6) {
        tangent.set(0, 1, 0);
      }
      tangent.normalize();
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
      const basis = new THREE.Matrix4().makeBasis(tangent, bitangent, normal);
      const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
      const euler = new THREE.Euler().setFromQuaternion(quaternion);
      return { quaternion, euler };
    };

    const parseStoredVec3 = (value) => {
      const x = Number(value?.x);
      const y = Number(value?.y);
      const z = Number(value?.z);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
      return new THREE.Vector3(x, y, z);
    };

    const findMeshByNameOrUuid = (meshUuid, meshName) => {
      if (!currentModel) return null;
      const targetUuid = String(meshUuid || "").trim();
      const targetName = String(meshName || "").trim();
      let matchByUuid = null;
      let matchByName = null;
      currentModel.traverse((object) => {
        if (!object.isMesh) return;
        if (!matchByUuid && targetUuid && object.uuid === targetUuid) {
          matchByUuid = object;
          return;
        }
        if (!matchByName && targetName && object.name === targetName) {
          matchByName = object;
        }
      });
      return matchByUuid || matchByName || null;
    };

    const inferOverlayInteractionType = (overlay) => {
      const explicitRaw = String(overlay?.interactionType || "").trim();
      if (explicitRaw) {
        return normalizeInteractionType(explicitRaw, "generic");
      }
      const token = `${overlay?.componentName || ""} ${overlay?.interactionSummary || ""}`
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ");
      if (/(gauge|needle|pressure)/.test(token)) return "gauge";
      if (/(lid|cover|hopper)/.test(token)) return "lid";
      if (/(dial|wheel|knob|rotate)/.test(token)) return "dial";
      if (/(lever|wand|handle|slide|pull)/.test(token)) return "lever";
      if (/(button|flash|pulse|power|cup)/.test(token)) return "button";
      return "generic";
    };

    const createMeshMaterial = (color, opacity) =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });

    const loadSvgTexture = (svgMarkup) =>
      new Promise((resolve, reject) => {
        const blobUrl = URL.createObjectURL(
          new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" })
        );
        textureLoader.load(
          blobUrl,
          (texture) => {
            URL.revokeObjectURL(blobUrl);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = Math.min(
              8,
              renderer?.capabilities?.getMaxAnisotropy?.() || 1
            );
            texture.needsUpdate = true;
            resolve(texture);
          },
          undefined,
          (error) => {
            URL.revokeObjectURL(blobUrl);
            reject(error || new Error("Could not load SVG texture."));
          }
        );
      });

    const createSvgVectorOverlay = (svgMarkup, targetSize) => {
      const cleaned = sanitizeSvgMarkup(svgMarkup);
      if (!cleaned) return null;

      try {
        const svgData = svgLoader.parse(cleaned);
        const vectorGroup = new THREE.Group();

        for (const path of svgData.paths) {
          const style = path.userData?.style || {};
          const fill = style.fill;
          if (!fill || fill === "none") continue;
          const shapes = SVGLoader.createShapes(path);
          const opacity = THREE.MathUtils.clamp(
            Number(style.fillOpacity ?? style.opacity ?? 1),
            0,
            1
          );
          if (opacity <= 0) continue;
          const material = createMeshMaterial(fill, Math.min(0.96, opacity));
          for (const shape of shapes) {
            const geometry = new THREE.ShapeGeometry(shape);
            const mesh = new THREE.Mesh(geometry, material);
            vectorGroup.add(mesh);
          }
        }

        if (!vectorGroup.children.length) {
          disposeRenderable(vectorGroup);
          return null;
        }

        const bounds = new THREE.Box3().setFromObject(vectorGroup);
        if (bounds.isEmpty()) {
          disposeRenderable(vectorGroup);
          return null;
        }

        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const maxAxis = Math.max(size.x, size.y, 1e-4);
        const scale = Math.max(targetSize, 0.02) / maxAxis;

        vectorGroup.position.set(-center.x, -center.y, Math.max(targetSize * 0.06, 0.002));
        vectorGroup.scale.set(scale, -scale, scale);
        return vectorGroup;
      } catch (error) {
        logTagDebug("createSvgVectorOverlay parse failed", {
          message: error?.message ?? "Unknown SVG parse error",
        });
        return null;
      }
    };

    const createSvgDecalMesh = async (targetMesh, position, orientation, overlaySize, svgMarkup) => {
      const cleaned = sanitizeSvgMarkup(svgMarkup);
      if (!cleaned) return null;

      const decalGeometry = new DecalGeometry(targetMesh, position, orientation, overlaySize);
      if (!decalGeometry.attributes?.position?.count) {
        decalGeometry.dispose();
        return null;
      }

      try {
        const texture = await loadSvgTexture(cleaned);
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: 0.95,
          depthTest: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -6,
          polygonOffsetUnits: -6,
        });
        const mesh = new THREE.Mesh(decalGeometry, material);
        mesh.renderOrder = 13;
        return mesh;
      } catch (error) {
        logTagDebug("createSvgDecalMesh texture failed", {
          message: error?.message ?? "Unknown SVG texture error",
        });
        decalGeometry.dispose();
        return null;
      }
    };

    const createInteractiveOverlayGroup = (overlay, position, orientationQuaternion, overlaySize) => {
      const group = new THREE.Group();
      const interactionType = inferOverlayInteractionType(overlay);

      group.position.copy(position);
      group.quaternion.copy(orientationQuaternion);
      group.renderOrder = 12;
      group.userData.svgOverlay = overlay;
      group.userData.interactionType = interactionType;

      const minDimension = Math.max(Math.min(overlaySize.x, overlaySize.y), 0.02);
      const maxDimension = Math.max(overlaySize.x, overlaySize.y);
      const ringRadius = minDimension * 0.42;
      const ringTube = Math.max(minDimension * 0.05, 0.003);
      const timeSeed = Math.random() * Math.PI * 2;
      const svgVector = createSvgVectorOverlay(overlay?.svgCode, minDimension * 0.88);
      const svgVectorBaseScale = svgVector ? svgVector.scale.clone() : null;
      const svgVectorBaseZ = svgVector ? svgVector.position.z : 0;
      if (svgVector) {
        group.add(svgVector);
      }
      let updater = () => {};

      if (interactionType === "gauge") {
        const arcGeometry = new THREE.RingGeometry(ringRadius * 0.72, ringRadius * 0.96, 40, 1, 0.24, Math.PI * 1.52);
        const arcMesh = new THREE.Mesh(arcGeometry, createMeshMaterial("#7dd3fc", 0.65));
        arcMesh.rotation.z = Math.PI * 0.74;
        group.add(arcMesh);

        const needleGeometry = new THREE.BoxGeometry(ringRadius * 0.88, Math.max(ringTube * 1.2, 0.003), ringTube);
        needleGeometry.translate(ringRadius * 0.44, 0, 0);
        const needleMesh = new THREE.Mesh(needleGeometry, createMeshMaterial("#fbbf24", 0.95));
        needleMesh.position.z = ringTube * 1.8;
        group.add(needleMesh);

        const hubMesh = new THREE.Mesh(
          new THREE.CircleGeometry(ringTube * 2.4, 24),
          createMeshMaterial("#dbeafe", 0.95)
        );
        hubMesh.position.z = ringTube * 2.2;
        group.add(hubMesh);

        updater = (elapsed) => {
          const angle = Math.sin(elapsed * 1.8 + timeSeed) * (Math.PI * 0.32);
          needleMesh.rotation.z = angle;
          arcMesh.material.opacity = 0.45 + Math.abs(Math.sin(elapsed * 1.4 + timeSeed)) * 0.28;
          if (svgVector) svgVector.rotation.z = angle * 0.3;
        };
      } else if (interactionType === "dial") {
        const ringMesh = new THREE.Mesh(
          new THREE.TorusGeometry(ringRadius, ringTube, 20, 84),
          createMeshMaterial("#7dd3fc", 0.52)
        );
        group.add(ringMesh);

        const markerMesh = new THREE.Mesh(
          new THREE.BoxGeometry(ringTube * 1.6, ringRadius * 0.45, ringTube * 1.1),
          createMeshMaterial("#dbeafe", 0.92)
        );
        markerMesh.position.y = ringRadius * 0.22;
        markerMesh.position.z = ringTube * 1.8;
        group.add(markerMesh);

        updater = (elapsed) => {
          group.rotation.z = elapsed * 0.9 + timeSeed;
          ringMesh.material.opacity = 0.35 + Math.abs(Math.sin(elapsed * 1.2 + timeSeed)) * 0.35;
          if (svgVector) {
            svgVector.rotation.z = elapsed * 0.9 + timeSeed;
          }
        };
      } else if (interactionType === "lever") {
        const stemMesh = new THREE.Mesh(
          new THREE.BoxGeometry(ringTube * 1.8, ringRadius * 1.05, ringTube * 1.5),
          createMeshMaterial("#e2e8f0", 0.88)
        );
        stemMesh.position.y = ringRadius * 0.5;
        stemMesh.position.z = ringTube * 1.5;
        group.add(stemMesh);

        const tipMesh = new THREE.Mesh(
          new THREE.SphereGeometry(ringTube * 2.8, 20, 20),
          createMeshMaterial("#fbbf24", 0.92)
        );
        tipMesh.position.y = ringRadius * 1.02;
        tipMesh.position.z = ringTube * 2.2;
        group.add(tipMesh);

        updater = (elapsed) => {
          const sway = Math.sin(elapsed * 2 + timeSeed) * 0.28;
          stemMesh.rotation.z = sway;
          tipMesh.position.x = Math.sin(elapsed * 2 + timeSeed) * ringRadius * 0.18;
          if (svgVector) {
            svgVector.rotation.z = sway * 0.65;
          }
        };
      } else if (interactionType === "lid") {
        const baseRing = new THREE.Mesh(
          new THREE.RingGeometry(ringRadius * 0.62, ringRadius * 1.02, 52),
          createMeshMaterial("#93c5fd", 0.28)
        );
        group.add(baseRing);

        const lidDisk = new THREE.Mesh(
          new THREE.CircleGeometry(ringRadius * 0.72, 52),
          createMeshMaterial("#e2e8f0", 0.44)
        );
        lidDisk.position.z = ringTube * 1.1;
        group.add(lidDisk);

        const lidHandle = new THREE.Mesh(
          new THREE.TorusGeometry(ringRadius * 0.18, Math.max(ringTube * 0.5, 0.0024), 18, 48),
          createMeshMaterial("#f8fafc", 0.72)
        );
        lidHandle.position.y = ringRadius * 0.12;
        lidHandle.position.z = ringTube * 1.8;
        group.add(lidHandle);

        updater = (elapsed) => {
          const lift = Math.max(0, Math.sin(elapsed * 1.75 + timeSeed)) * ringRadius * 0.52;
          const tilt = -0.18 * Math.min(1, lift / (ringRadius * 0.52));
          lidDisk.position.z = ringTube * 1.1 + lift;
          lidDisk.rotation.x = tilt;
          lidHandle.position.z = ringTube * 1.8 + lift * 1.05;
          lidHandle.rotation.x = tilt;
          baseRing.material.opacity = 0.2 + Math.abs(Math.sin(elapsed * 1.45 + timeSeed)) * 0.2;
          if (svgVector) {
            svgVector.position.z = svgVectorBaseZ + lift * 0.5;
            svgVector.rotation.x = tilt * 0.9;
          }
        };
      } else {
        const pulseRing = new THREE.Mesh(
          new THREE.TorusGeometry(ringRadius, ringTube, 20, 84),
          createMeshMaterial("#67e8f9", 0.55)
        );
        group.add(pulseRing);

        const centerMesh = new THREE.Mesh(
          new THREE.CircleGeometry(ringRadius * 0.44, 36),
          createMeshMaterial("#f8fafc", interactionType === "button" ? 0.9 : 0.68)
        );
        centerMesh.position.z = ringTube * 1.6;
        group.add(centerMesh);

        updater = (elapsed) => {
          const pulse = 0.9 + Math.abs(Math.sin(elapsed * 2.3 + timeSeed)) * 0.35;
          pulseRing.scale.setScalar(pulse);
          pulseRing.material.opacity = 0.25 + Math.abs(Math.sin(elapsed * 2.3 + timeSeed)) * 0.4;
          if (interactionType === "button") {
            centerMesh.material.opacity = 0.4 + Math.abs(Math.sin(elapsed * 4.4 + timeSeed)) * 0.55;
          }
          if (svgVector && svgVectorBaseScale) {
            const svgPulse = 0.94 + Math.abs(Math.sin(elapsed * 2.3 + timeSeed)) * 0.12;
            svgVector.scale.set(
              svgVectorBaseScale.x * svgPulse,
              svgVectorBaseScale.y * svgPulse,
              svgVectorBaseScale.z * svgPulse
            );
          }
        };
      }

      return {
        group,
        updater,
        interactionType,
        hasVectorSvg: Boolean(svgVector),
        footprint: maxDimension,
      };
    };

    const addSvgOverlay = async (overlay) => {
      if (!currentModel) {
        return { ok: false, message: "No model loaded." };
      }

      const overlayId = String(
        overlay?.overlayId || overlay?.componentKey || `${Date.now()}-${Math.random()}`
      );
      const x = Number(overlay?.x);
      const y = Number(overlay?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        return { ok: false, message: "Invalid overlay coordinates." };
      }

      const meshes = [];
      currentModel.traverse((object) => {
        if (object.isMesh) meshes.push(object);
      });
      if (!meshes.length) {
        return { ok: false, message: "No mesh surfaces available for SVG overlay." };
      }

      let placementSource = "raycast";
      let hitObject = null;
      let hitPoint = null;
      let normal = null;

      const anchorPoint = parseStoredVec3(overlay?.hitPoint);
      const anchorNormal = parseStoredVec3(overlay?.hitNormal)?.normalize();
      const anchorMesh = findMeshByNameOrUuid(overlay?.meshUuid, overlay?.meshName);
      if (anchorMesh && anchorPoint && anchorNormal) {
        hitObject = anchorMesh;
        hitPoint = anchorPoint;
        normal = anchorNormal;
        placementSource = "tag-anchor";
      } else {
        const surfaceHit = findSurfaceHit(x, y, meshes);
        if (!surfaceHit) {
          return { ok: false, message: "Could not project SVG onto model surface." };
        }
        hitObject = surfaceHit.object;
        hitPoint = surfaceHit.point.clone();
        normal = surfaceHit.face?.normal
          ?.clone()
          ?.transformDirection(surfaceHit.object.matrixWorld)
          ?.normalize();
      }

      if (!normal || !hitObject || !hitPoint) {
        return { ok: false, message: "Could not determine surface normal for SVG overlay." };
      }

      const position = hitPoint.clone().addScaledVector(normal, 0.0015);
      const surfaceOrientation = computeSurfaceOrientation(normal, hitPoint);
      const overlaySize = computeOverlayWorldSizeFromCapture(
        { point: hitPoint },
        overlay?.width,
        overlay?.height
      );

      removeSvgOverlay(overlayId);
      const interactive = createInteractiveOverlayGroup(
        overlay,
        position,
        surfaceOrientation.quaternion,
        overlaySize
      );
      if (!interactive?.group) {
        return { ok: false, message: "Could not build interactive 3D overlay." };
      }

      const overlayRoot = new THREE.Group();
      overlayRoot.userData.overlayId = overlayId;
      overlayRoot.userData.interactionType = interactive.interactionType;

      // A tiny invisible decal anchor gives better depth continuity on curved surfaces.
      const anchorMaterial = new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.0001,
        depthTest: true,
        depthWrite: false,
      });
      const anchorGeometry = new DecalGeometry(
        hitObject,
        position,
        surfaceOrientation.euler,
        overlaySize
      );
      if (anchorGeometry.attributes?.position?.count) {
        const anchorMesh = new THREE.Mesh(anchorGeometry, anchorMaterial);
        anchorMesh.renderOrder = 11;
        overlayRoot.add(anchorMesh);
      } else {
        anchorGeometry.dispose();
        anchorMaterial.dispose();
      }

      const svgDecalMesh = await createSvgDecalMesh(
        hitObject,
        position,
        surfaceOrientation.euler,
        overlaySize,
        overlay?.svgCode
      );
      if (svgDecalMesh) {
        overlayRoot.add(svgDecalMesh);
      }

      overlayRoot.add(interactive.group);
      svgGroup.add(overlayRoot);
      svgOverlayMap.set(overlayId, overlayRoot);
      svgOverlayUpdaters.set(overlayId, interactive.updater);
      renderFrame();
      logTagDebug("addSvgOverlay success", {
        overlayId,
        placementSource,
        componentName: overlay?.componentName || "component",
        meshUuid: hitObject?.uuid || "",
        meshName: hitObject?.name || "",
        hitPoint: toShortVec3(hitPoint),
        normal: toShortVec3(normal),
      });
      return {
        ok: true,
        mode: svgDecalMesh
          ? `threejs-surface-svg-${interactive.interactionType}-${placementSource}`
          : `threejs-${interactive.interactionType}-${placementSource}`,
        overlayId,
      };
    };

    const addTagMarker = (tag) => {
      if (!currentModel) {
        logTagDebug("addTagMarker skipped: no model loaded");
        return { ok: false, message: "No model loaded." };
      }

      const x = Number(tag?.x);
      const y = Number(tag?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        logTagDebug("addTagMarker invalid coordinates", { x: tag?.x, y: tag?.y });
        return { ok: false, message: "Gemini returned invalid coordinates." };
      }

      const label = (tag?.label || "component").toString();
      const meshes = [];
      currentModel.traverse((object) => {
        if (object.isMesh) meshes.push(object);
      });
      logTagDebug("addTagMarker start", {
        label,
        normalizedPoint: { x, y },
        meshCount: meshes.length,
      });

      if (!meshes.length) {
        logTagDebug("addTagMarker failed: no meshes");
        return { ok: false, message: "No mesh surfaces available for tagging." };
      }

      const surfaceHit = findSurfaceHit(x, y, meshes);
      if (!surfaceHit) {
        logTagDebug("addTagMarker failed: no surface hit", { label, x, y });
        return {
          ok: false,
          message: "Could not project this tag onto the machine surface. Rotate the model and retry.",
        };
      }

      const normal = surfaceHit.face?.normal
        ?.clone()
        ?.transformDirection(surfaceHit.object.matrixWorld)
        ?.normalize();
      if (!normal) {
        logTagDebug("addTagMarker failed: no surface normal", {
          label,
          objectName: surfaceHit.object?.name || "unnamed-mesh",
        });
        return { ok: false, message: "Could not determine surface normal for tag placement." };
      }

      const position = surfaceHit.point.clone().addScaledVector(normal, 0.0015);
      const orientationMatrix = new THREE.Matrix4().lookAt(
        new THREE.Vector3(0, 0, 0),
        normal,
        new THREE.Vector3(0, 1, 0)
      );
      const orientation = new THREE.Euler().setFromRotationMatrix(orientationMatrix);
      const decalSize = new THREE.Vector3(
        currentTagWorldSize,
        currentTagWorldSize,
        currentTagWorldSize
      );

      const decalGeometry = new DecalGeometry(
        surfaceHit.object,
        position,
        orientation,
        decalSize
      );

      if (!decalGeometry.attributes?.position?.count) {
        logTagDebug("addTagMarker failed: empty decal geometry", {
          label,
          hitObject: surfaceHit.object?.name || "unnamed-mesh",
          hitPoint: toShortVec3(surfaceHit.point),
          normal: toShortVec3(normal),
          position: toShortVec3(position),
        });
        decalGeometry.dispose();
        const fallbackBadge = createSurfaceBadgeFallback(label, position, normal, tag);
        if (!fallbackBadge) {
          return { ok: false, message: "Could not build decal geometry at this location." };
        }
        tagGroup.add(fallbackBadge);
        logTagDebug("addTagMarker fallback badge success", {
          label,
          hitObject: surfaceHit.object?.name || "unnamed-mesh",
          placedAt: toShortVec3(fallbackBadge.position),
        });
        renderFrame();
        return {
          ok: true,
          meshName: surfaceHit.object?.name || "",
          meshUuid: surfaceHit.object?.uuid || "",
          hitPoint: toStoredVec3(surfaceHit.point),
          hitNormal: toStoredVec3(normal),
        };
      }

      const decalMaterial = createTagMaterial(label);
      if (!decalMaterial) {
        logTagDebug("addTagMarker failed: no decal material", { label });
        decalGeometry.dispose();
        return { ok: false, message: "Could not create tag marker texture." };
      }

      const decalMesh = new THREE.Mesh(decalGeometry, decalMaterial);
      decalMesh.renderOrder = 10;
      decalMesh.userData.tag = tag;
      tagGroup.add(decalMesh);
      logTagDebug("addTagMarker success", {
        label,
        hitObject: surfaceHit.object?.name || "unnamed-mesh",
        hitPoint: toShortVec3(surfaceHit.point),
        normal: toShortVec3(normal),
        placedAt: toShortVec3(position),
        decalVertexCount: decalGeometry.attributes.position.count,
      });

      renderFrame();
      return {
        ok: true,
        meshName: surfaceHit.object?.name || "",
        meshUuid: surfaceHit.object?.uuid || "",
        hitPoint: toStoredVec3(surfaceHit.point),
        hitNormal: toStoredVec3(normal),
      };
    };

    const captureCurrent = () =>
      resizeCanvasToDataUrl(canvas, MAX_CAPTURE_DIMENSION, 0.9);

    const capturePresets = async () => {
      const original = {
        position: camera.position.clone(),
        target: controls.target.clone(),
        up: camera.up.clone(),
      };

      const captures = [];
      for (const preset of VIEW_PRESETS) {
        setViewPreset(preset);
        await waitForRenderFrames();
        const imageDataUrl = captureCurrent();
        if (imageDataUrl) {
          captures.push({ label: preset, imageDataUrl });
        }
      }

      camera.position.copy(original.position);
      controls.target.copy(original.target);
      camera.up.copy(original.up);
      renderFrame();
      return captures;
    };

    viewerControlsRef.current = {
      capturePresets,
      captureCurrent,
      setViewPreset,
      rotateBy,
      zoomBy,
      resetView,
      addTagMarker,
      clearTagMarkers,
      addSvgOverlay,
      removeSvgOverlay,
      clearSvgOverlays,
    };

    const disposeMaterial = (material) => {
      if (!material) return;
      Object.values(material).forEach((value) => {
        if (value && typeof value === "object" && "minFilter" in value) {
          value.dispose();
        }
      });
      material.dispose();
    };

    const clearModel = () => {
      if (!currentModel) return;

      currentModel.traverse((object) => {
        if (!object.isMesh) return;
        object.geometry?.dispose();

        if (Array.isArray(object.material)) {
          object.material.forEach(disposeMaterial);
          return;
        }
        disposeMaterial(object.material);
      });

      scene.remove(currentModel);
      currentModel = null;
    };

    const frameObject = (object3d) => {
      const box = new THREE.Box3().setFromObject(object3d);
      if (box.isEmpty()) return;

      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z);
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const distance = (maxDimension / (2 * Math.tan(fov / 2))) * 1.3;
      const viewDirection = new THREE.Vector3(1, 0.7, 1).normalize();
      currentTagWorldSize = THREE.MathUtils.clamp(maxDimension * 0.08, 0.03, 0.2);

      camera.up.set(0, 1, 0);
      camera.position.copy(center).addScaledVector(viewDirection, distance);
      camera.near = Math.max(distance / 100, 0.01);
      camera.far = distance * 50;
      camera.updateProjectionMatrix();

      controls.maxDistance = distance * 10;
      controls.target.copy(center);
      controls.update();
      controls.saveState();
    };

    const setModel = (model) => {
      clearModel();
      clearTagMarkers();
      clearSvgOverlays();
      currentModel = model;

      currentModel.traverse((object) => {
        if (!object.isMesh) return;

        const setMaterialProps = (material) => {
          if (!material || !("envMapIntensity" in material)) return;
          material.envMapIntensity = 1.4;
          material.needsUpdate = true;
        };

        if (Array.isArray(object.material)) {
          object.material.forEach(setMaterialProps);
          return;
        }
        setMaterialProps(object.material);
      });

      scene.add(currentModel);
      frameObject(currentModel);
      renderFrame();
    };

    const parseGlb = (data) =>
      new Promise((resolve, reject) => {
        loader.parse(data, "", resolve, reject);
      });

    const loadGlbData = async (modelName, data) => {
      try {
        const gltf = await parseGlb(data);
        setModel(gltf.scene);
        setAssetName(modelName);
        setStatus(`Loaded ${modelName}`);
        setAnalysisStatus("Model loaded. Capturing screenshots...");
        await analyzeModelRef.current?.(modelName);
      } catch (error) {
        const message = error?.message ?? "Unknown file read error.";
        setStatus(`Could not load ${modelName}: ${message}`);
        setAnalysisStatus("Could not load model for analysis.");
      }
    };

    const loadGlbFromUrl = async (url, modelName) => {
      setStatus(`Loading ${modelName}...`);
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.arrayBuffer();
        await loadGlbData(modelName, data);
      } catch (error) {
        const message = error?.message ?? "Unknown URL load error.";
        setStatus(`Could not load ${modelName}: ${message}`);
        setAnalysisStatus("Could not load default model.");
      }
    };

    const loadGlbFile = async (file) => {
      if (!file) return;
      setStatus(`Loading ${file.name}...`);
      try {
        const data = await file.arrayBuffer();
        await loadGlbData(file.name, data);
      } catch (error) {
        const message = error?.message ?? "Unknown file read error.";
        setStatus(`Could not read ${file.name}: ${message}`);
        setAnalysisStatus("Could not load model for analysis.");
      }
    };

    loadFileRef.current = loadGlbFile;

    const handleResize = () => {
      const panelWidth = window.innerWidth > 980 ? 380 : 0;
      const viewerWidth = Math.max(1, window.innerWidth - panelWidth);
      camera.aspect = viewerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(viewerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    };

    const handleDragEnter = (event) => {
      event.preventDefault();
      dragDepth += 1;
      setDragActive(true);
    };

    const handleDragOver = (event) => {
      event.preventDefault();
    };

    const handleDragLeave = (event) => {
      event.preventDefault();
      dragDepth -= 1;
      if (dragDepth <= 0) {
        dragDepth = 0;
        setDragActive(false);
      }
    };

    const handleDrop = async (event) => {
      event.preventDefault();
      dragDepth = 0;
      setDragActive(false);
      const file = event.dataTransfer?.files?.[0];
      await loadGlbFile(file);
    };

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      for (const updater of svgOverlayUpdaters.values()) {
        updater?.(elapsed);
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    window.addEventListener("resize", handleResize);
    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    handleResize();
    void loadGlbFromUrl(DEFAULT_GLB_URL, DEFAULT_GLB_NAME);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);

      clearModel();
      clearTagMarkers();
      clearSvgOverlays();
      controls.dispose();
      envTexture.dispose();
      roomEnvironment.dispose();
      pmremGenerator.dispose();
      renderer.dispose();
      loadFileRef.current = null;
      viewerControlsRef.current = {
        capturePresets: null,
        captureCurrent: null,
        setViewPreset: null,
        rotateBy: null,
        zoomBy: null,
        resetView: null,
        addTagMarker: null,
        clearTagMarkers: null,
        addSvgOverlay: null,
        removeSvgOverlay: null,
        clearSvgOverlays: null,
      };
    };
  }, [waitForRenderFrames]);

  const onFileChange = async (event) => {
    const file = event.target.files?.[0];
    await loadFileRef.current?.(file);
    event.target.value = "";
  };

  const onAnalyzeClick = async () => {
    await analyzeModel(assetName);
  };

  const collectViewerCaptures = async () => {
    const captureCurrent = viewerControlsRef.current.captureCurrent;
    const capturePresets = viewerControlsRef.current.capturePresets;
    if (typeof captureCurrent !== "function") {
      throw new Error("Viewer capture controls are not ready.");
    }

    await waitForRenderFrames();
    const currentImageDataUrl = captureCurrent();
    if (!currentImageDataUrl) {
      throw new Error("Could not capture current viewer frame.");
    }

    const captures = [{ label: "current", imageDataUrl: currentImageDataUrl }];
    if (typeof capturePresets === "function") {
      const presetCaptures = await capturePresets();
      for (const capture of presetCaptures) {
        if (!capture?.imageDataUrl) continue;
        captures.push({
          label: normalizeTagCaptureLabel(capture.label, "current"),
          imageDataUrl: capture.imageDataUrl,
        });
      }
    }

    return { currentImageDataUrl, captures };
  };

  const upsertSvgOverlay = (overlay) => {
    setSvgOverlays((previous) => {
      const next = [];
      let replaced = false;
      for (const item of previous) {
        if (item.componentKey === overlay.componentKey) {
          if (item.blobUrl) {
            try {
              URL.revokeObjectURL(item.blobUrl);
            } catch {
              // Ignore browser URL revocation errors.
            }
          }
          next.push(overlay);
          replaced = true;
          continue;
        }
        next.push(item);
      }
      if (!replaced) {
        next.push(overlay);
      }
      return next;
    });
  };

  const removeSvgOverlay = (componentKey) => {
    viewerControlsRef.current.removeSvgOverlay?.(componentKey);
    setSvgOverlays((previous) => {
      const removeTarget = previous.find((item) => item.componentKey === componentKey);
      if (removeTarget?.blobUrl) {
        try {
          URL.revokeObjectURL(removeTarget.blobUrl);
        } catch {
          // Ignore browser URL revocation errors.
        }
      }
      return previous.filter((item) => item.componentKey !== componentKey);
    });
  };

  const onGenerateSvgOverlay = async (taggedComponent) => {
    if (!taggedComponent) return;
    const componentKey = taggedComponent.componentKey || `${taggedComponent.sourceIndex || 0}`;
    setOverlayBusyKey(componentKey);
    setOverlayStatus(`Generating interactive SVG for ${taggedComponent.name || "component"}...`);

    try {
      const setViewPreset = viewerControlsRef.current.setViewPreset;
      const addSvgOverlay = viewerControlsRef.current.addSvgOverlay;
      if (typeof addSvgOverlay !== "function") {
        throw new Error("Viewer SVG overlay controls are not ready.");
      }
      const { currentImageDataUrl, captures } = await collectViewerCaptures();
      const response = await fetch("/api/generate-component-svg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetName,
          imageDataUrl: currentImageDataUrl,
          captures,
          component: taggedComponent,
        }),
      });
      const payload = await parseApiResponse(response, "Gemini SVG generation request failed");
      logTagDebug("onGenerateSvgOverlay payload", {
        componentName: payload?.componentName,
        found: payload?.found,
        captureLabel: payload?.captureLabel,
        x: payload?.x,
        y: payload?.y,
        width: payload?.width,
        height: payload?.height,
      });

      if (!payload?.found || !payload?.svgCode) {
        const reason = payload?.reason || payload?.interactionSummary || "No SVG was generated.";
        throw new Error(`Could not generate SVG for ${taggedComponent.name}: ${reason}`);
      }

      const taggedCaptureLabel = normalizeTagCaptureLabel(taggedComponent.captureLabel, "current");
      const modelCaptureLabel = normalizeTagCaptureLabel(payload?.captureLabel, taggedCaptureLabel);
      const taggedX = numberInRange(taggedComponent.x, 0, 1, 0.5);
      const taggedY = numberInRange(taggedComponent.y, 0, 1, 0.5);
      const modelX = numberInRange(payload?.x, 0, 1, taggedX);
      const modelY = numberInRange(payload?.y, 0, 1, taggedY);
      const normalizedDistance = Math.hypot(modelX - taggedX, modelY - taggedY);
      const useModelPlacement = normalizedDistance <= 0.12;
      const selectedCaptureLabel = useModelPlacement ? modelCaptureLabel : taggedCaptureLabel;
      if (selectedCaptureLabel !== "current" && typeof setViewPreset === "function") {
        setViewPreset(selectedCaptureLabel);
        await waitForRenderFrames();
      }

      const cleanedSvg = sanitizeSvgMarkup(payload.svgCode);
      if (!cleanedSvg) {
        throw new Error("Gemini returned invalid SVG markup.");
      }

      const overlayX = useModelPlacement ? modelX : taggedX;
      const overlayY = useModelPlacement ? modelY : taggedY;
      const maxOverlaySize = useModelPlacement ? 0.42 : 0.24;
      const defaultOverlaySize = useModelPlacement ? 0.14 : 0.12;
      const overlayWidth = numberInRange(payload?.width, 0.05, maxOverlaySize, defaultOverlaySize);
      const overlayHeight = numberInRange(payload?.height, 0.05, maxOverlaySize, defaultOverlaySize);
      const inferredType = inferInteractionTypeFromHints(
        taggedComponent.name,
        taggedComponent.location,
        taggedComponent.purpose,
        payload?.interactionSummary
      );
      const interactionType = normalizeInteractionType(payload?.interactionType, inferredType);
      if (!useModelPlacement) {
        logTagDebug("onGenerateSvgOverlay using tagged anchor", {
          componentName: taggedComponent.name || "component",
          taggedX,
          taggedY,
          modelX,
          modelY,
          normalizedDistance: Number(normalizedDistance.toFixed(4)),
        });
      }
      const placement = await addSvgOverlay({
        overlayId: componentKey,
        componentKey,
        componentName: payload?.componentName || taggedComponent.name || "component",
        x: overlayX,
        y: overlayY,
        width: overlayWidth,
        height: overlayHeight,
        meshName: taggedComponent.meshName || "",
        meshUuid: taggedComponent.meshUuid || "",
        hitPoint: taggedComponent.hitPoint || null,
        hitNormal: taggedComponent.hitNormal || null,
        interactionType,
        interactionSummary: payload?.interactionSummary || "",
        svgCode: cleanedSvg,
      });

      if (!placement?.ok) {
        throw new Error(placement?.message || "Could not place SVG overlay on model surface.");
      }

      const blobUrl = URL.createObjectURL(
        new Blob([cleanedSvg], { type: "image/svg+xml;charset=utf-8" })
      );
      const overlay = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        componentKey,
        componentName: payload?.componentName || taggedComponent.name || "component",
        captureLabel: selectedCaptureLabel,
        x: overlayX,
        y: overlayY,
        width: overlayWidth,
        height: overlayHeight,
        interactionSummary:
          payload?.interactionSummary || "Interactive overlay generated for this component.",
        interactionType,
        svgCode: cleanedSvg,
        blobUrl,
        placementMode: placement.mode || "decal",
      };

      upsertSvgOverlay(overlay);
      const placementHint = useModelPlacement ? "model-guided placement" : "tag-anchor placement";
      setOverlayStatus(
        `Generated 3D SVG overlay for ${overlay.componentName} (${selectedCaptureLabel} view, ${placementHint}, ${overlay.placementMode}).`
      );
    } catch (error) {
      setOverlayStatus(error?.message ?? "Could not generate SVG overlay.");
    } finally {
      setOverlayBusyKey("");
    }
  };

  const onTagNextComponent = async () => {
    const componentsList = toSafeArray(analysisData?.components);
    const nextComponent = componentsList[nextTagIndex];
    if (!nextComponent) {
      setTagStatus("All components are tagged.");
      logTagDebug("onTagNextComponent no remaining components", {
        nextTagIndex,
        componentCount: componentsList.length,
      });
      return;
    }

    const captureCurrent = viewerControlsRef.current.captureCurrent;
    const capturePresets = viewerControlsRef.current.capturePresets;
    const setViewPreset = viewerControlsRef.current.setViewPreset;
    const addTagMarker = viewerControlsRef.current.addTagMarker;
    if (typeof captureCurrent !== "function" || typeof addTagMarker !== "function") {
      setTagStatus("Viewer controls are not ready yet.");
      logTagDebug("onTagNextComponent viewer controls missing", {
        hasCaptureCurrent: typeof captureCurrent === "function",
        hasCapturePresets: typeof capturePresets === "function",
        hasAddTagMarker: typeof addTagMarker === "function",
        hasSetViewPreset: typeof setViewPreset === "function",
      });
      return;
    }

    setIsTaggingComponent(true);
    setTagStatus(`Tagging ${nextComponent.name || "component"}...`);
    logTagDebug("onTagNextComponent start", {
      nextTagIndex,
      componentName: nextComponent.name || "component",
      componentLocation: nextComponent.location || "",
      componentPurpose: nextComponent.purpose || "",
    });

    try {
      const { currentImageDataUrl, captures } = await collectViewerCaptures();

      const base64Data = currentImageDataUrl.split(",")[1] || "";
      logTagDebug("onTagNextComponent captured screenshot", {
        assetName,
        mimeType: currentImageDataUrl.slice(5, currentImageDataUrl.indexOf(";")),
        base64Length: base64Data.length,
        captureCount: captures.length,
        captureLabels: captures.map((capture) => capture.label),
      });

      const response = await fetch("/api/tag-component", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetName,
          component: nextComponent,
          imageDataUrl: currentImageDataUrl,
          captures,
        }),
      });
      logTagDebug("onTagNextComponent api response", {
        status: response.status,
        ok: response.ok,
      });

      const payload = await parseApiResponse(response, "Gemini tagging request failed");
      logTagDebug("onTagNextComponent parsed payload", {
        componentName: payload?.componentName,
        found: payload?.found,
        confidence: payload?.confidence,
        x: payload?.x,
        y: payload?.y,
        captureLabel: payload?.captureLabel,
        reason: payload?.reason,
      });

      if (!payload?.found) {
        const message = payload?.reason
          ? `Gemini could not find ${nextComponent.name}: ${payload.reason}`
          : `Gemini could not confidently locate ${nextComponent.name}.`;
        setTagStatus(message);
        logTagDebug("onTagNextComponent not found", { message });
        return;
      }

      const selectedCaptureLabel = normalizeTagCaptureLabel(payload?.captureLabel, "current");
      if (selectedCaptureLabel !== "current" && typeof setViewPreset === "function") {
        logTagDebug("onTagNextComponent switching to capture view for placement", {
          componentName: nextComponent.name || "component",
          selectedCaptureLabel,
        });
        setViewPreset(selectedCaptureLabel);
        await waitForRenderFrames();
      }

      const placement = addTagMarker({
        label: nextComponent.name || `component-${nextTagIndex + 1}`,
        x: payload.x,
        y: payload.y,
      });

      if (!placement.ok) {
        logTagDebug("onTagNextComponent placement failed", {
          componentName: nextComponent.name || "component",
          x: payload.x,
          y: payload.y,
          message: placement.message,
        });
        throw new Error(placement.message || "Could not place tag marker in 3D scene.");
      }
      logTagDebug("onTagNextComponent placement success", {
        componentName: nextComponent.name || "component",
        x: payload.x,
        y: payload.y,
      });

      setTaggedComponents((previous) => [
        ...previous,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sourceIndex: nextTagIndex,
          componentKey: `${nextTagIndex}-${(nextComponent.name || "component")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")}`,
          ...nextComponent,
          x: payload.x,
          y: payload.y,
          confidence: payload.confidence || "unknown",
          captureLabel: selectedCaptureLabel,
          meshName: placement.meshName || "",
          meshUuid: placement.meshUuid || "",
          hitPoint: placement.hitPoint || null,
          hitNormal: placement.hitNormal || null,
        },
      ]);
      setNextTagIndex((previous) => previous + 1);
      setTagStatus(
        `Tagged ${nextComponent.name || "component"} on the model surface (${payload.confidence || "unknown"} confidence, ${selectedCaptureLabel} view).`
      );
      setOverlayStatus(
        `Tagged ${nextComponent.name || "component"}. You can now generate an interactive SVG overlay.`
      );
    } catch (error) {
      logTagDebug("onTagNextComponent error", {
        componentName: nextComponent?.name || "component",
        message: error?.message || "Unknown tagging error",
      });
      setTagStatus(error?.message ?? "Could not tag this component.");
    } finally {
      setIsTaggingComponent(false);
    }
  };

  const onPresetClick = (presetName) => {
    viewerControlsRef.current.setViewPreset?.(presetName);
  };

  const onRotateLeft = () => {
    viewerControlsRef.current.rotateBy?.(Math.PI / 12);
  };

  const onRotateRight = () => {
    viewerControlsRef.current.rotateBy?.(-Math.PI / 12);
  };

  const onZoomIn = () => {
    viewerControlsRef.current.zoomBy?.(0.85);
  };

  const onZoomOut = () => {
    viewerControlsRef.current.zoomBy?.(1.15);
  };

  const onResetView = () => {
    viewerControlsRef.current.resetView?.();
  };

  const buttons = toSafeArray(analysisData?.buttons);
  const components = toSafeArray(analysisData?.components);
  const nextComponent = components[nextTagIndex] ?? null;
  const overlaysByComponentKey = new Map(
    svgOverlays.map((overlay) => [overlay.componentKey, overlay])
  );
  const machineName = analysisData?.machineName ?? "Unknown machine";
  const machineType = analysisData?.machineType ?? "";
  const identification = analysisData?.identification ?? "";
  const confidence = formatConfidence(analysisData?.confidence);

  return (
    <div className={dragActive ? "app drag-active" : "app"}>
      <section ref={viewerShellRef} className="viewer-shell">
        <header className="topbar">
          <label className="load-button">
            Load GLB
            <input type="file" accept=".glb,model/gltf-binary" onChange={onFileChange} />
          </label>
          <p className="status">{status}</p>
        </header>

        <canvas ref={canvasRef} className="viewer" />
        <div className="drop-hint">Drop a .glb file anywhere to view it</div>
      </section>

      <aside className="analysis-panel">
        <div className="analysis-head">
          <h2>Gemini Inspector</h2>
          <p className="analysis-model">{ANALYSIS_MODEL}</p>
        </div>

        <button
          type="button"
          className="analyze-button"
          onClick={onAnalyzeClick}
          disabled={isAnalyzing || !assetName}
        >
          {isAnalyzing ? "Analyzing..." : "Analyze Model"}
        </button>

        <button
          type="button"
          className="tag-button"
          onClick={onTagNextComponent}
          disabled={
            isTaggingComponent ||
            !assetName ||
            !components.length ||
            nextTagIndex >= components.length
          }
        >
          {isTaggingComponent ? "Tagging..." : "Tag Next Component"}
        </button>
        <p className="tag-status">{tagStatus}</p>
        <p className="overlay-status">
          {overlayStatus} Active overlays: {svgOverlays.length}
        </p>
        {nextComponent ? (
          <p className="tag-current">
            Next: {nextComponent.name || "component"}
            {nextComponent.location ? ` (${nextComponent.location})` : ""}
          </p>
        ) : (
          <p className="tag-current">No remaining components to tag.</p>
        )}

        <div className="view-controls">
          {VIEW_PRESETS.map((presetName) => (
            <button
              key={presetName}
              type="button"
              className="view-button"
              onClick={() => onPresetClick(presetName)}
            >
              {presetName}
            </button>
          ))}
          <button type="button" className="view-button" onClick={onRotateLeft}>
            rotate left
          </button>
          <button type="button" className="view-button" onClick={onRotateRight}>
            rotate right
          </button>
          <button type="button" className="view-button" onClick={onZoomIn}>
            zoom in
          </button>
          <button type="button" className="view-button" onClick={onZoomOut}>
            zoom out
          </button>
          <button type="button" className="view-button" onClick={onResetView}>
            reset
          </button>
        </div>

        <p className="analysis-status">{analysisStatus}</p>
        <p className="analysis-asset">Asset: {assetName || "none loaded"}</p>

        {capturePreview ? (
          <img className="capture-preview" src={capturePreview} alt="Viewer screenshot for Gemini" />
        ) : null}

        <section className="analysis-block">
          <h3>Identification</h3>
          <p className="analysis-line">{machineName}</p>
          {machineType ? <p className="analysis-line">{machineType}</p> : null}
          {identification ? <p className="analysis-line">{identification}</p> : null}
          <p className="analysis-line">Confidence: {confidence}</p>
        </section>

        <section className="analysis-block">
          <h3>Buttons ({buttons.length})</h3>
          {buttons.length ? (
            <ul className="entity-list">
              {buttons.map((button, index) => (
                <li key={`button-${index}`}>
                  <strong>{button.name || "Unknown button"}</strong>
                  {button.location ? ` - ${button.location}` : ""}
                  {button.function ? ` - ${button.function}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="analysis-line">No buttons were confidently detected.</p>
          )}
        </section>

        <section className="analysis-block">
          <h3>
            Components ({components.length}) - Tagged {taggedComponents.length}
          </h3>
          {components.length ? (
            <ul className="entity-list">
              {components.map((component, index) => (
                <li key={`component-${index}`} className="component-item">
                  <span className={index < nextTagIndex ? "tag-chip done" : "tag-chip pending"}>
                    {index < nextTagIndex ? "tagged" : "pending"}
                  </span>
                  <strong>{component.name || "Unknown component"}</strong>
                  {component.location ? ` - ${component.location}` : ""}
                  {component.purpose ? ` - ${component.purpose}` : ""}
                  {index < nextTagIndex ? (
                    (() => {
                      const taggedComponent = taggedComponents.find(
                        (entry) => entry.sourceIndex === index
                      );
                      if (!taggedComponent) {
                        return (
                          <p className="component-overlay-meta">
                            Tagged marker available. Generate SVG overlay next.
                          </p>
                        );
                      }
                      const overlay = overlaysByComponentKey.get(taggedComponent.componentKey);
                      const busy = overlayBusyKey === taggedComponent.componentKey;
                      return (
                        <div className="component-overlay-actions">
                          <button
                            type="button"
                            className="overlay-generate-button"
                            onClick={() => onGenerateSvgOverlay(taggedComponent)}
                            disabled={busy}
                          >
                            {busy
                              ? "Generating SVG..."
                              : overlay
                                ? "Regenerate SVG Overlay"
                                : "Generate SVG Overlay"}
                          </button>
                          {overlay ? (
                            <p className="component-overlay-meta">
                              Overlay: {overlay.captureLabel} view - {overlay.interactionSummary}
                            </p>
                          ) : null}
                        </div>
                      );
                    })()
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="analysis-line">No components were confidently detected.</p>
          )}
        </section>

        <section className="analysis-block">
          <h3>SVG Overlays ({svgOverlays.length})</h3>
          {svgOverlays.length ? (
            <ul className="entity-list">
              {svgOverlays.map((overlay) => (
                <li key={`overlay-${overlay.id}`} className="overlay-list-item">
                  <strong>{overlay.componentName}</strong> - {overlay.captureLabel} view
                  <p className="component-overlay-meta">
                    {overlay.interactionSummary}
                    {overlay.placementMode ? ` (${overlay.placementMode})` : ""}
                  </p>
                  <div className="component-overlay-actions">
                    <a href={overlay.blobUrl} target="_blank" rel="noreferrer">
                      Open SVG
                    </a>
                    <button
                      type="button"
                      className="overlay-remove-button"
                      onClick={() => removeSvgOverlay(overlay.componentKey)}
                    >
                      Remove Overlay
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="analysis-line">No interactive overlays generated yet.</p>
          )}
        </section>

        <section className="analysis-block">
          <h3>Internet Matches</h3>
          {searchResults.length ? (
            <div className="search-results">
              {searchResults.map((group, index) => (
                <div key={`search-group-${index}`} className="search-group">
                  <p className="search-query">Query: {group.query}</p>
                  <ul className="entity-list">
                    {toSafeArray(group.results).map((result, resultIndex) => (
                      <li key={`result-${index}-${resultIndex}`}>
                        <a href={result.url} target="_blank" rel="noreferrer">
                          {result.title || result.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="analysis-line">No strong public match found yet.</p>
          )}
        </section>

        {analysisRawText ? <pre className="analysis-text">{analysisRawText}</pre> : null}
      </aside>
    </div>
  );
}
