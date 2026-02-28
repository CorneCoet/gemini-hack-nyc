import * as THREE from "https://unpkg.com/three@0.170.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.170.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://unpkg.com/three@0.170.0/examples/jsm/loaders/GLTFLoader.js";

const canvas = document.getElementById("viewer");
const fileInput = document.getElementById("fileInput");
const status = document.getElementById("status");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#05070b");
scene.fog = new THREE.Fog("#05070b", 14, 55);

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

const hemiLight = new THREE.HemisphereLight("#c1c8ff", "#11213a", 0.9);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight("#ffffff", 1.2);
keyLight.position.set(3.5, 6, 4);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight("#9ac5ff", 0.35);
fillLight.position.set(-4, 2, -2);
scene.add(fillLight);

const grid = new THREE.GridHelper(20, 20, "#4de3ff44", "#4de3ff18");
grid.position.y = -0.001;
scene.add(grid);

const loader = new GLTFLoader();
let currentModel = null;

function updateStatus(message) {
  status.textContent = message;
}

function disposeMaterial(material) {
  if (!material) return;
  Object.values(material).forEach((value) => {
    if (value && typeof value === "object" && "minFilter" in value) {
      value.dispose();
    }
  });
  material.dispose();
}

function clearModel() {
  if (!currentModel) return;

  currentModel.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry?.dispose();
    if (Array.isArray(obj.material)) {
      obj.material.forEach(disposeMaterial);
    } else {
      disposeMaterial(obj.material);
    }
  });

  scene.remove(currentModel);
  currentModel = null;
}

function frameObject(object3d) {
  const box = new THREE.Box3().setFromObject(object3d);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.3;
  const viewDirection = new THREE.Vector3(1, 0.7, 1).normalize();

  camera.position.copy(center).addScaledVector(viewDirection, distance);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 50;
  camera.updateProjectionMatrix();
  controls.maxDistance = distance * 10;
  controls.target.copy(center);
  controls.update();
}

function setModel(model) {
  clearModel();
  currentModel = model;
  scene.add(currentModel);
  frameObject(currentModel);
}

async function loadGlbFile(file) {
  if (!file) return;
  updateStatus(`Loading ${file.name}...`);

  try {
    const data = await file.arrayBuffer();
    loader.parse(
      data,
      "",
      (gltf) => {
        setModel(gltf.scene);
        updateStatus(`Loaded ${file.name}`);
      },
      (error) => {
        const message = error?.message ?? "Unknown GLB parse error.";
        updateStatus(`Could not load ${file.name}: ${message}`);
      }
    );
  } catch (error) {
    const message = error?.message ?? "Unknown file read error.";
    updateStatus(`Could not read ${file.name}: ${message}`);
  }
}

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  await loadGlbFile(file);
  fileInput.value = "";
});

let dragDepth = 0;

window.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  document.body.classList.add("drag-active");
});

window.addEventListener("dragover", (event) => {
  event.preventDefault();
});

window.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth -= 1;
  if (dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove("drag-active");
  }
});

window.addEventListener("drop", async (event) => {
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("drag-active");

  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  await loadGlbFile(file);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();
