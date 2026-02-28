import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const ANALYSIS_MODEL = "gemini-3.1-pro-preview";

export default function App() {
  const canvasRef = useRef(null);
  const loadFileRef = useRef(null);
  const [status, setStatus] = useState("No model loaded.");
  const [dragActive, setDragActive] = useState(false);
  const [assetName, setAssetName] = useState("");
  const [analysis, setAnalysis] = useState("Load a GLB and click Analyze View.");
  const [analysisStatus, setAnalysisStatus] = useState("Waiting for screenshot.");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [capturePreview, setCapturePreview] = useState("");

  const waitForRenderFrames = () =>
    new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

  const analyzeCurrentView = async (nameOverride = "") => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const finalAssetName = nameOverride || assetName || "unknown.glb";
    setIsAnalyzing(true);
    setAnalysisStatus(`Analyzing with ${ANALYSIS_MODEL}...`);

    try {
      await waitForRenderFrames();
      const imageDataUrl = canvas.toDataURL("image/jpeg", 0.92);
      setCapturePreview(imageDataUrl);

      const response = await fetch("/api/describe-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl,
          assetName: finalAssetName,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error ?? "Gemini analysis request failed.");
      }

      setAnalysis(payload.description);
      setAnalysisStatus(`Analyzed by ${payload.model ?? ANALYSIS_MODEL}.`);
    } catch (error) {
      setAnalysis("Could not analyze this view.");
      setAnalysisStatus(error?.message ?? "Unknown analysis error.");
    } finally {
      setIsAnalyzing(false);
    }
  };

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

      camera.position.copy(center).addScaledVector(viewDirection, distance);
      camera.near = Math.max(distance / 100, 0.01);
      camera.far = distance * 50;
      camera.updateProjectionMatrix();

      controls.maxDistance = distance * 10;
      controls.target.copy(center);
      controls.update();
    };

    const setModel = (model) => {
      clearModel();
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
    };

    const parseGlb = (data) =>
      new Promise((resolve, reject) => {
        loader.parse(data, "", resolve, reject);
      });

    const loadGlbFile = async (file) => {
      if (!file) return;
      setStatus(`Loading ${file.name}...`);

      try {
        const data = await file.arrayBuffer();
        const gltf = await parseGlb(data);
        setModel(gltf.scene);
        setAssetName(file.name);
        setStatus(`Loaded ${file.name}`);
        setAnalysisStatus("Model loaded. Capturing screenshot...");
        await analyzeCurrentView(file.name);
      } catch (error) {
        const message = error?.message ?? "Unknown file read error.";
        setStatus(`Could not read ${file.name}: ${message}`);
        setAnalysisStatus("Could not load model for analysis.");
      }
    };

    loadFileRef.current = loadGlbFile;

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
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

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);

      clearModel();
      controls.dispose();
      envTexture.dispose();
      roomEnvironment.dispose();
      pmremGenerator.dispose();
      renderer.dispose();
      loadFileRef.current = null;
    };
  }, []);

  const onFileChange = async (event) => {
    const file = event.target.files?.[0];
    await loadFileRef.current?.(file);
    event.target.value = "";
  };

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
          <h2>Gemini Vision</h2>
          <p className="analysis-model">{ANALYSIS_MODEL}</p>
        </div>

        <button
          type="button"
          className="analyze-button"
          onClick={() => analyzeCurrentView()}
          disabled={isAnalyzing}
        >
          {isAnalyzing ? "Analyzing..." : "Analyze View"}
        </button>

        <p className="analysis-status">{analysisStatus}</p>
        <p className="analysis-asset">Asset: {assetName || "none loaded"}</p>

        {capturePreview ? (
          <img className="capture-preview" src={capturePreview} alt="Viewer screenshot for Gemini" />
        ) : null}

        <pre className="analysis-text">{analysis}</pre>
      </aside>
    </div>
  );
}
