import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const ANALYSIS_MODEL = "gemini-3.1-pro-preview";
const VIEW_PRESETS = ["iso", "front", "right", "back", "left", "top"];
const MAX_CAPTURE_DIMENSION = 1024;
const DEFAULT_GLB_URL = "/breville-coffee-machine.glb";
const DEFAULT_GLB_NAME = "Breville Coffee Machine.glb";

function toSafeArray(value) {
  return Array.isArray(value) ? value : [];
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

export default function App() {
  const canvasRef = useRef(null);
  const loadFileRef = useRef(null);
  const analyzeModelRef = useRef(null);
  const viewerControlsRef = useRef({
    capturePresets: null,
    captureCurrent: null,
    setViewPreset: null,
    rotateBy: null,
    zoomBy: null,
    resetView: null,
    addTagMarker: null,
    clearTagMarkers: null,
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

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error ?? "Gemini analysis request failed.");
        }

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
    setTaggedComponents([]);
    setNextTagIndex(0);
    if (analysisData) {
      setTagStatus("Click Tag Next Component to place labels one at a time.");
    } else {
      setTagStatus("Run Analyze Model to start tagging components.");
    }
    viewerControlsRef.current.clearTagMarkers?.();
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
    let currentModel = null;
    let dragDepth = 0;
    let frameId = 0;
    const raycaster = new THREE.Raycaster();
    const ndcVector = new THREE.Vector2();
    const tagGroup = new THREE.Group();
    scene.add(tagGroup);

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

    const createTagSprite = (label) => {
      const canvasTag = document.createElement("canvas");
      canvasTag.width = 768;
      canvasTag.height = 192;
      const context = canvasTag.getContext("2d");
      if (!context) return null;

      context.clearRect(0, 0, canvasTag.width, canvasTag.height);
      context.fillStyle = "#09101be6";
      context.strokeStyle = "#4de3ff";
      context.lineWidth = 8;
      context.beginPath();
      if (typeof context.roundRect === "function") {
        context.roundRect(10, 10, canvasTag.width - 20, canvasTag.height - 20, 32);
      } else {
        context.rect(10, 10, canvasTag.width - 20, canvasTag.height - 20);
      }
      context.fill();
      context.stroke();

      context.fillStyle = "#e6f2ff";
      context.font = "600 64px 'Space Grotesk', sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, canvasTag.width / 2, canvasTag.height / 2);

      const texture = new THREE.CanvasTexture(canvasTag);
      texture.colorSpace = THREE.SRGBColorSpace;

      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(0.9, 0.22, 1);
      return sprite;
    };

    const clearTagMarkers = () => {
      while (tagGroup.children.length > 0) {
        const child = tagGroup.children[0];
        tagGroup.remove(child);
        if (child.material?.map) child.material.map.dispose();
        child.material?.dispose?.();
      }
      renderFrame();
    };

    const addTagMarker = (tag) => {
      if (!currentModel) {
        return { ok: false, message: "No model loaded." };
      }

      const x = Number(tag?.x);
      const y = Number(tag?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        return { ok: false, message: "Gemini returned invalid coordinates." };
      }

      const label = (tag?.label || "component").toString();
      const meshes = [];
      currentModel.traverse((object) => {
        if (object.isMesh) meshes.push(object);
      });

      if (!meshes.length) {
        return { ok: false, message: "No mesh surfaces available for tagging." };
      }

      ndcVector.set(x * 2 - 1, -(y * 2 - 1));
      raycaster.setFromCamera(ndcVector, camera);
      const hits = raycaster.intersectObjects(meshes, true);

      const markerPosition = new THREE.Vector3();
      if (hits.length > 0) {
        markerPosition.copy(hits[0].point);
        const normal = hits[0].face?.normal?.clone()?.transformDirection(hits[0].object.matrixWorld);
        if (normal) {
          markerPosition.addScaledVector(normal, 0.02);
        }
      } else {
        raycaster.ray.at(camera.position.distanceTo(controls.target), markerPosition);
      }

      const sprite = createTagSprite(label);
      if (!sprite) {
        return { ok: false, message: "Could not create tag marker texture." };
      }
      sprite.position.copy(markerPosition);
      sprite.userData.tag = tag;
      tagGroup.add(sprite);
      renderFrame();
      return { ok: true };
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

  const onTagNextComponent = async () => {
    const componentsList = toSafeArray(analysisData?.components);
    const nextComponent = componentsList[nextTagIndex];
    if (!nextComponent) {
      setTagStatus("All components are tagged.");
      return;
    }

    const captureCurrent = viewerControlsRef.current.captureCurrent;
    const addTagMarker = viewerControlsRef.current.addTagMarker;
    if (typeof captureCurrent !== "function" || typeof addTagMarker !== "function") {
      setTagStatus("Viewer controls are not ready yet.");
      return;
    }

    setIsTaggingComponent(true);
    setTagStatus(`Tagging ${nextComponent.name || "component"}...`);

    try {
      await waitForRenderFrames();
      const imageDataUrl = captureCurrent();
      if (!imageDataUrl) {
        throw new Error("Could not capture current view for tagging.");
      }

      const response = await fetch("/api/tag-component", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetName,
          component: nextComponent,
          imageDataUrl,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "Gemini tagging request failed.");
      }

      if (!payload?.found) {
        const message = payload?.reason
          ? `Gemini could not find ${nextComponent.name}: ${payload.reason}`
          : `Gemini could not confidently locate ${nextComponent.name}.`;
        setTagStatus(message);
        return;
      }

      const placement = addTagMarker({
        label: nextComponent.name || `component-${nextTagIndex + 1}`,
        x: payload.x,
        y: payload.y,
      });

      if (!placement.ok) {
        throw new Error(placement.message || "Could not place tag marker in 3D scene.");
      }

      setTaggedComponents((previous) => [
        ...previous,
        {
          ...nextComponent,
          x: payload.x,
          y: payload.y,
          confidence: payload.confidence || "unknown",
        },
      ]);
      setNextTagIndex((previous) => previous + 1);
      setTagStatus(
        `Tagged ${nextComponent.name || "component"} (${payload.confidence || "unknown"} confidence).`
      );
    } catch (error) {
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
  const machineName = analysisData?.machineName ?? "Unknown machine";
  const machineType = analysisData?.machineType ?? "";
  const identification = analysisData?.identification ?? "";
  const confidence = formatConfidence(analysisData?.confidence);

  return (
    <div className={dragActive ? "app drag-active" : "app"}>
      <section className="viewer-shell">
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
                </li>
              ))}
            </ul>
          ) : (
            <p className="analysis-line">No components were confidently detected.</p>
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
