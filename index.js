import {
  WebGLRenderer,
  PerspectiveCamera,
  Scene,
  Mesh,
  PlaneGeometry,
  ShadowMaterial,
  DirectionalLight,
  PCFSoftShadowMap,
  // sRGBEncoding,
  Color,
  AmbientLight,
  Box3,
  LoadingManager,
  MathUtils,
  MeshPhysicalMaterial,
  DoubleSide,
  ACESFilmicToneMapping,
  CanvasTexture,
  Float32BufferAttribute,
  RepeatWrapping,
  BoxGeometry,
  MeshBasicMaterial,
  MeshPhongMaterial,
  BufferGeometry
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import URDFLoader from 'urdf-loader';
// 导入控制工具函数
import { setupKeyboardControls, setupControlPanel } from './robotControls.js';

// 声明为全局变量
let scene, camera, renderer, controls;
// 将robot设为全局变量，便于其他模块访问
window.robot = null;
let keyboardUpdate;

init();
render();

function init() {

  scene = new Scene();
  scene.background = new Color(0x263238);

  camera = new PerspectiveCamera();
  camera.position.set(5, 5, 5);
  camera.lookAt(0, 0, 0);

  renderer = new WebGLRenderer({ antialias: true });
  // renderer.outputEncoding = sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.physicallyCorrectLights = true;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;
  document.body.appendChild(renderer.domElement);

  const directionalLight = new DirectionalLight(0xffffff, 1.0);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.setScalar(1024);
  directionalLight.position.set(5, 30, 5);
  scene.add(directionalLight);

  // Add second directional light for better reflections
  const directionalLight2 = new DirectionalLight(0xffffff, 0.8);
  directionalLight2.position.set(-2, 10, -5);
  scene.add(directionalLight2);

  const ambientLight = new AmbientLight(0xffffff, 0.3);
  scene.add(ambientLight);

  // Create reflective floor (MuJoCo style)
  const groundMaterial = new MeshPhysicalMaterial({
    color: 0x808080,
    metalness: 0.7,
    roughness: 0.3,
    reflectivity: 0.1,
    clearcoat: 0.3,
    side: DoubleSide,
    transparent: true,     // 启用透明度
    opacity: 0.7,          // 设置透明度为0.7（可以根据需要调整，1.0为完全不透明）
  });
  
  // 创建格子纹理的地面
  const gridSize = 60;
  const divisions = 60;
  
  // 创建网格地面
  const ground = new Mesh(new PlaneGeometry(gridSize, gridSize, divisions, divisions), groundMaterial);
  
  // 添加格子纹理
  const geometry = ground.geometry;
  const positionAttribute = geometry.getAttribute('position');
  
  // 创建格子纹理的UV坐标
  const uvs = [];
  const gridScale = 0.01; // 控制格子的密度
  
  for (let i = 0; i < positionAttribute.count; i++) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);
    
    uvs.push(x * gridScale, y * gridScale);
  }
  
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  
  // 更新材质，添加格子纹理
  groundMaterial.map = createGridTexture();
  groundMaterial.roughnessMap = createGridTexture();
  
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.minDistance = 4;
  controls.target.y = 1;
  controls.update();

  // 根据URL hash或默认加载模型
  function loadModelFromHash() {
    // 获取URL hash（去掉#号）
    let modelToLoad = 'so_arm100';
    
    // 加载模型
    const manager = new LoadingManager();
    
    // Add a onProgress callback to track loading progress
    manager.onProgress = (url, itemsLoaded, itemsTotal) => {
      console.log(`Loading ${url}: ${itemsLoaded} of ${itemsTotal} files.`);
    };
    
    // Add an onError callback to catch loading errors
    manager.onError = (url) => {
      console.error(`Error loading ${url}`);
    };
    
    const loader = new URDFLoader(manager);
    
    // Flag to track loading attempts
    let isRetryingWithLowerDetail = false;
    
    // Add parsing options to handle large STL files
    loader.loadMeshCb = (path, manager, onComplete) => {
      if (isRetryingWithLowerDetail) {
        // On retry with error, use a simple box placeholder
        console.warn(`Creating placeholder for ${path} due to previous load error`);
        const boxGeometry = new BoxGeometry(1, 1, 1);
        const material = new MeshBasicMaterial({ color: 0xaaaaaa });
        onComplete(new Mesh(boxGeometry, material));
        return;
      }
      
      try {
        const stlLoader = new STLLoader(manager);
        
        // Set lower memory usage by using a lower mesh detail
        stlLoader.load(
          path,
          (geometry) => {
            try {
              // Simplify geometry if it's too large
              let finalGeometry = geometry;
              const vertexCount = geometry.attributes.position.count;
              
              console.log(`Loaded geometry with ${vertexCount} vertices from ${path}`);
              
              // Different levels of simplification based on vertex count
              if (vertexCount > 50000) {
                finalGeometry = simplifyGeometry(geometry, 0.9); // 90% reduction for very large meshes
              } else if (vertexCount > 20000) {
                finalGeometry = simplifyGeometry(geometry, 0.7); // 70% reduction for large meshes
              } else if (vertexCount > 10000) {
                finalGeometry = simplifyGeometry(geometry, 0.5); // 50% reduction for medium meshes
              }
              
              const material = new MeshPhongMaterial({
                color: 0x999999,
                shininess: 100,
                specular: 0x111111,
              });
              
              onComplete(new Mesh(finalGeometry, material));
            } catch (err) {
              console.error(`Error processing geometry for ${path}:`, err);
              // Create a simple placeholder mesh for the failed processing
              const boxGeometry = new BoxGeometry(1, 1, 1);
              const material = new MeshBasicMaterial({ color: 0xaaaaaa });
              onComplete(new Mesh(boxGeometry, material));
            }
          },
          null,
          (error) => {
            console.error(`Error loading mesh: ${path}`, error);
            // Create a simple placeholder mesh for the failed load
            const boxGeometry = new BoxGeometry(1, 1, 1);
            const material = new MeshBasicMaterial({ color: 0xff0000 });
            onComplete(new Mesh(boxGeometry, material));
          }
        );
      } catch (err) {
        console.error(`Exception during STL loading setup for ${path}:`, err);
        // Create a simple placeholder mesh for catastrophic errors
        const boxGeometry = new BoxGeometry(1, 1, 1);
        const material = new MeshBasicMaterial({ color: 0xff0000 });
        onComplete(new Mesh(boxGeometry, material));
      }
    };

    // First attempt to load with normal settings
    try {
      loader.load(`/URDF/${modelToLoad}.urdf`, result => {
        window.robot = result;
      });
    } catch (err) {
      console.error("Error during initial URDF load, retrying with lower detail:", err);
      isRetryingWithLowerDetail = true;
      
      // Retry with lower detail (all placeholders)
      loader.load(`/URDF/${modelToLoad}.urdf`, result => {
        window.robot = result;
      });
    }

    // 等待模型加载完成
    manager.onLoad = () => {
      window.robot.rotation.x = - Math.PI / 2;
      window.robot.rotation.z = - Math.PI;
      window.robot.traverse(c => {
        c.castShadow = true;
      });
      console.log(window.robot.joints);
      // 记录关节限制信息到控制台，便于调试
      logJointLimits(window.robot);
      
      window.robot.updateMatrixWorld(true);

      const bb = new Box3();
      bb.setFromObject(window.robot);

      window.robot.scale.set(15, 15, 15);
      window.robot.position.y -= bb.min.y;
      scene.add(window.robot);

      // Initialize keyboard controls
      keyboardUpdate = setupKeyboardControls(window.robot);
    };
  }

  // 初始加载模型
  loadModelFromHash();

  onResize();
  window.addEventListener('resize', onResize);

  // Setup UI for control panel
  setupControlPanel();
}

/**
 * 输出关节限制信息到控制台
 * @param {Object} robot - 机器人对象
 */
function logJointLimits(robot) {
  if (!robot || !robot.joints) return;
  
  console.log("Robot joint limits:");
  Object.entries(robot.joints).forEach(([name, joint]) => {
    console.log(`Joint: ${name}`);
    console.log(`  Type: ${joint.jointType}`);
    
    if (joint.jointType !== 'fixed' && joint.jointType !== 'continuous') {
      console.log(`  Limits: ${joint.limit.lower.toFixed(4)} to ${joint.limit.upper.toFixed(4)} rad`);
      console.log(`  Current value: ${Array.isArray(joint.jointValue) ? joint.jointValue.join(', ') : joint.jointValue}`);
    } else if (joint.jointType === 'continuous') {
      console.log(`  No limits (continuous joint)`);
    } else {
      console.log(`  No limits (fixed joint)`);
    }
  });
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function render() {
  requestAnimationFrame(render);
  
  // Update joint positions based on keyboard input
  if (keyboardUpdate) {
    keyboardUpdate();
  }
  
  renderer.render(scene, camera);
}

// Helper function to simplify geometry by reducing vertex count
function simplifyGeometry(geometry, targetReduction = 0.5) {
  if (!geometry.attributes.position) return geometry;
  
  const positionAttr = geometry.attributes.position;
  const vertexCount = positionAttr.count;
  const targetCount = Math.floor(vertexCount * (1 - targetReduction));
  
  // If the geometry is already small enough, return it as is
  if (vertexCount <= targetCount) return geometry;
  
  // Create a simplified vertex array
  const step = Math.ceil(vertexCount / targetCount);
  const newPositions = [];
  const newNormals = [];
  
  // Keep only a subset of vertices
  for (let i = 0; i < vertexCount; i += step) {
    newPositions.push(
      positionAttr.getX(i),
      positionAttr.getY(i),
      positionAttr.getZ(i)
    );
    
    // Copy normals if they exist
    if (geometry.attributes.normal) {
      const normalAttr = geometry.attributes.normal;
      newNormals.push(
        normalAttr.getX(i),
        normalAttr.getY(i),
        normalAttr.getZ(i)
      );
    }
  }
  
  // Create a new BufferGeometry with reduced data
  const simplified = new BufferGeometry();
  simplified.setAttribute('position', new Float32BufferAttribute(newPositions, 3));
  
  if (geometry.attributes.normal) {
    simplified.setAttribute('normal', new Float32BufferAttribute(newNormals, 3));
  } else {
    // Compute normals if they don't exist
    simplified.computeVertexNormals();
  }
  
  console.log(`Simplified geometry from ${vertexCount} to ${newPositions.length / 3} vertices`);
  return simplified;
}

// 添加创建格子纹理的函数
function createGridTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  
  const context = canvas.getContext('2d');
  
  // 填充底色
  context.fillStyle = '#808080';
  context.fillRect(0, 0, canvas.width, canvas.height);
  
  // 绘制格子线
  context.lineWidth = 1;
  context.strokeStyle = '#606060';
  
  const cellSize = 32; // 每个格子的大小
  
  for (let i = 0; i <= canvas.width; i += cellSize) {
    context.beginPath();
    context.moveTo(i, 0);
    context.lineTo(i, canvas.height);
    context.stroke();
  }
  
  for (let i = 0; i <= canvas.height; i += cellSize) {
    context.beginPath();
    context.moveTo(0, i);
    context.lineTo(canvas.width, i);
    context.stroke();
  }
  
  // 修复: 使用已导入的 CanvasTexture，而不是 THREE.CanvasTexture
  const texture = new CanvasTexture(canvas);
  // 修复: 使用已导入的 RepeatWrapping，而不是 THREE.RepeatWrapping
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(10, 10);
  
  return texture;
}
