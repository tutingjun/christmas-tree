import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  Suspense,
} from "react";
import type { FormEvent } from "react";
import { Canvas, useFrame, extend } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Float,
  Stars,
  Sparkles,
  useTexture,
} from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { MathUtils } from "three";
import * as random from "maath/random";
import {
  GestureRecognizer,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

type AuthState = "checking" | "authed" | "unauthenticated";
type AudioStatus = "idle" | "playing" | "paused" | "error";

const FONT_STACK =
  '"PingFang SC","Noto Sans SC","Microsoft YaHei","Helvetica Neue",Arial,sans-serif';
const AUDIO_VOLUME = 0.7;

// --- 动态生成照片列表 (top.jpg + 1.jpg 到 31.jpg) ---
const TOTAL_NUMBERED_PHOTOS = 31;
// 修改：将 top.jpg 加入到数组开头
const bodyPhotoPaths = [
  ...Array.from(
    { length: TOTAL_NUMBERED_PHOTOS },
    (_, i) => `/photos/${i + 1}.png`
  ),
];

// --- 视觉配置 ---
const CONFIG = {
  colors: {
    emerald: "#004225", // 纯正祖母绿
    gold: "#FFD700",
    silver: "#ECEFF1",
    red: "#D32F2F",
    green: "#2E7D32",
    white: "#FFFFFF", // 纯白色
    warmLight: "#FFD54F",
    lights: ["#FF0000", "#00FF00", "#0000FF", "#FFFF00"], // 彩灯
    // 拍立得边框颜色池 (复古柔和色系)
    borders: [
      "#FFFAF0",
      "#F0E68C",
      "#E6E6FA",
      "#FFB6C1",
      "#98FB98",
      "#87CEFA",
      "#FFDAB9",
    ],
    // 圣诞元素颜色
    giftColors: ["#D32F2F", "#FFD700", "#1976D2", "#2E7D32"],
    candyColors: ["#FF0000", "#FFFFFF"],
  },
  counts: {
    foliage: 12000, // 降低颗粒数提升帧率
    ornaments: 240, // 拍立得照片数量
    elements: 240, // 圣诞元素数量
    lights: 420, // 彩灯数量
  },
  tree: { height: 32, radius: 14 }, // 树体尺寸
  photos: {
    // top 属性不再需要，因为已经移入 body
    body: bodyPhotoPaths,
  },
};

// --- Shader Material (Foliage) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.emerald), uProgress: 0 },
  `uniform float uTime; uniform float uProgress; attribute vec3 aTargetPos; attribute float aRandom;
  varying vec2 vUv; varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vUv = uv;
    vec3 noise = vec3(sin(uTime * 1.5 + position.x), cos(uTime + position.y), sin(uTime * 1.5 + position.z)) * 0.15;
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (60.0 * (1.0 + aRandom)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `uniform vec3 uColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 finalColor = mix(uColor * 0.3, uColor * 1.2, vMix);
    gl_FragColor = vec4(finalColor, 1.0);
  }`
);
extend({ FoliageMaterial });

// --- Helper: Tree Shape ---
const getTreePosition = () => {
  const h = CONFIG.tree.height;
  const rBase = CONFIG.tree.radius;
  const y = Math.random() * h - h / 2;
  const normalizedY = (y + h / 2) / h;
  const currentRadius = rBase * (1 - normalizedY);
  const theta = Math.random() * Math.PI * 2;
  const r = Math.random() * currentRadius;
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
};

// --- Component: Foliage ---
const Foliage = ({ state }: { state: "CHAOS" | "FORMED" }) => {
  const materialRef = useRef<any>(null);
  const { positions, targetPositions, randoms } = useMemo(() => {
    const count = CONFIG.counts.foliage;
    const positions = new Float32Array(count * 3);
    const targetPositions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    const spherePoints = random.inSphere(new Float32Array(count * 3), {
      radius: 25,
    }) as Float32Array;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = spherePoints[i * 3];
      positions[i * 3 + 1] = spherePoints[i * 3 + 1];
      positions[i * 3 + 2] = spherePoints[i * 3 + 2];
      const [tx, ty, tz] = getTreePosition();
      targetPositions[i * 3] = tx;
      targetPositions[i * 3 + 1] = ty;
      targetPositions[i * 3 + 2] = tz;
      randoms[i] = Math.random();
    }
    return { positions, targetPositions, randoms };
  }, []);
  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      const targetProgress = state === "FORMED" ? 1 : 0;
      materialRef.current.uProgress = MathUtils.damp(
        materialRef.current.uProgress,
        targetProgress,
        1.5,
        delta
      );
    }
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute
          attach="attributes-aTargetPos"
          args={[targetPositions, 3]}
        />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
};

// --- Component: Photo Ornaments (Double-Sided Polaroid) ---
const PhotoOrnaments = ({ state }: { state: "CHAOS" | "FORMED" }) => {
  const textures = useTexture(CONFIG.photos.body);
  const count = CONFIG.counts.ornaments;
  const groupRef = useRef<THREE.Group>(null);
  // Open palm -> CHAOS -> make the photos pop larger.
  const sizeMultiplier = state === "CHAOS" ? 1.8 : 1;

  const borderGeometry = useMemo(() => new THREE.PlaneGeometry(1.2, 1.5), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const chaosPos = new THREE.Vector3(
        (Math.random() - 0.5) * 70,
        (Math.random() - 0.5) * 70,
        (Math.random() - 0.5) * 70
      );
      const h = CONFIG.tree.height;
      const y = Math.random() * h - h / 2;
      const rBase = CONFIG.tree.radius;
      const currentRadius = rBase * (1 - (y + h / 2) / h) + 0.5;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(
        currentRadius * Math.cos(theta),
        y,
        currentRadius * Math.sin(theta)
      );

      const isBig = Math.random() < 0.2;
      const baseScale = isBig ? 2.2 : 0.8 + Math.random() * 0.6;
      const weight = 0.8 + Math.random() * 1.2;
      const borderColor =
        CONFIG.colors.borders[
          Math.floor(Math.random() * CONFIG.colors.borders.length)
        ];

      const rotationSpeed = {
        x: (Math.random() - 0.5) * 1.0,
        y: (Math.random() - 0.5) * 1.0,
        z: (Math.random() - 0.5) * 1.0,
      };
      const chaosRotation = new THREE.Euler(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );

      return {
        chaosPos,
        targetPos,
        scale: baseScale,
        weight,
        textureIndex: i % textures.length,
        borderColor,
        currentPos: chaosPos.clone(),
        chaosRotation,
        rotationSpeed,
        wobbleOffset: Math.random() * 10,
        wobbleSpeed: 0.5 + Math.random() * 0.5,
      };
    });
  }, [textures, count]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === "FORMED";
    const time = stateObj.clock.elapsedTime;

    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;

      objData.currentPos.lerp(
        target,
        delta * (isFormed ? 0.8 * objData.weight : 0.5)
      );
      group.position.copy(objData.currentPos);

      if (isFormed) {
        const targetLookPos = new THREE.Vector3(
          group.position.x * 2,
          group.position.y + 0.5,
          group.position.z * 2
        );
        group.lookAt(targetLookPos);

        const wobbleX =
          Math.sin(time * objData.wobbleSpeed + objData.wobbleOffset) * 0.05;
        const wobbleZ =
          Math.cos(time * objData.wobbleSpeed * 0.8 + objData.wobbleOffset) *
          0.05;
        group.rotation.x += wobbleX;
        group.rotation.z += wobbleZ;
      } else {
        group.rotation.x += delta * objData.rotationSpeed.x;
        group.rotation.y += delta * objData.rotationSpeed.y;
        group.rotation.z += delta * objData.rotationSpeed.z;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group
          key={i}
          scale={[
            obj.scale * sizeMultiplier,
            obj.scale * sizeMultiplier,
            obj.scale * sizeMultiplier,
          ]}
          rotation={state === "CHAOS" ? obj.chaosRotation : [0, 0, 0]}
        >
          {/* 正面 */}
          <group position={[0, 0, 0.015]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={textures[obj.textureIndex]}
                roughness={0.5}
                metalness={0}
                emissive={CONFIG.colors.white}
                emissiveMap={textures[obj.textureIndex]}
                emissiveIntensity={1.0}
                side={THREE.FrontSide}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial
                color={obj.borderColor}
                roughness={0.9}
                metalness={0}
                side={THREE.FrontSide}
              />
            </mesh>
          </group>
          {/* 背面 */}
          <group position={[0, 0, -0.015]} rotation={[0, Math.PI, 0]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={textures[obj.textureIndex]}
                roughness={0.5}
                metalness={0}
                emissive={CONFIG.colors.white}
                emissiveMap={textures[obj.textureIndex]}
                emissiveIntensity={1.0}
                side={THREE.FrontSide}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial
                color={obj.borderColor}
                roughness={0.9}
                metalness={0}
                side={THREE.FrontSide}
              />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
};

// --- Component: Christmas Elements ---
const ChristmasElements = ({ state }: { state: "CHAOS" | "FORMED" }) => {
  const count = CONFIG.counts.elements;
  const groupRef = useRef<THREE.Group>(null);

  const boxGeometry = useMemo(() => new THREE.BoxGeometry(0.8, 0.8, 0.8), []);
  const sphereGeometry = useMemo(
    () => new THREE.SphereGeometry(0.5, 16, 16),
    []
  );
  const caneStickGeometry = useMemo(
    () => new THREE.CylinderGeometry(0.12, 0.12, 1.2, 12),
    []
  );
  const caneHookGeometry = useMemo(
    () => new THREE.TorusGeometry(0.32, 0.1, 12, 24, Math.PI),
    []
  );

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3(
        (Math.random() - 0.5) * 60,
        (Math.random() - 0.5) * 60,
        (Math.random() - 0.5) * 60
      );
      const h = CONFIG.tree.height;
      const y = Math.random() * h - h / 2;
      const rBase = CONFIG.tree.radius;
      const currentRadius = rBase * (1 - (y + h / 2) / h) * 0.95;
      const theta = Math.random() * Math.PI * 2;

      const targetPos = new THREE.Vector3(
        currentRadius * Math.cos(theta),
        y,
        currentRadius * Math.sin(theta)
      );

      // 0: bauble, 1: gift, 2: candy cane
      const type = Math.floor(Math.random() * 3);
      const color =
        type === 2
          ? Math.random() > 0.5
            ? CONFIG.colors.red
            : CONFIG.colors.white
          : CONFIG.colors.giftColors[
              Math.floor(Math.random() * CONFIG.colors.giftColors.length)
            ];
      const scale =
        type === 0
          ? 0.8 + Math.random() * 0.6
          : type === 1
          ? 0.9 + Math.random() * 0.6
          : 0.9 + Math.random() * 0.4;

      const rotationSpeed = {
        x: (Math.random() - 0.5) * 2.0,
        y: (Math.random() - 0.5) * 2.0,
        z: (Math.random() - 0.5) * 2.0,
      };
      return {
        type,
        chaosPos,
        targetPos,
        color,
        scale,
        currentPos: chaosPos.clone(),
        chaosRotation: new THREE.Euler(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI
        ),
        rotationSpeed,
      };
    });
  }, [boxGeometry, sphereGeometry, caneStickGeometry, caneHookGeometry]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === "FORMED";
    groupRef.current.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 1.5);
      mesh.position.copy(objData.currentPos);
      mesh.rotation.x += delta * objData.rotationSpeed.x;
      mesh.rotation.y += delta * objData.rotationSpeed.y;
      mesh.rotation.z += delta * objData.rotationSpeed.z;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        return (
          <group
            key={i}
            scale={[obj.scale, obj.scale, obj.scale]}
            rotation={obj.chaosRotation}
          >
            {obj.type === 0 && (
              // Bauble ornament
              <mesh geometry={sphereGeometry}>
                <meshStandardMaterial
                  color={obj.color}
                  roughness={0.15}
                  metalness={0.75}
                  emissive={obj.color}
                  emissiveIntensity={0.4}
                />
              </mesh>
            )}
            {obj.type === 1 && (
              // Gift box with ribbon cross
              <>
                <mesh geometry={boxGeometry}>
                  <meshStandardMaterial
                    color={obj.color}
                    roughness={0.35}
                    metalness={0.4}
                    emissive={obj.color}
                    emissiveIntensity={0.25}
                  />
                </mesh>
                <mesh geometry={boxGeometry} scale={[1.02, 0.15, 1.05]}>
                  <meshStandardMaterial
                    color={CONFIG.colors.gold}
                    roughness={0.25}
                    metalness={0.9}
                    emissive={CONFIG.colors.gold}
                    emissiveIntensity={0.4}
                  />
                </mesh>
                <mesh geometry={boxGeometry} scale={[1.05, 1.02, 0.15]}>
                  <meshStandardMaterial
                    color={CONFIG.colors.gold}
                    roughness={0.25}
                    metalness={0.9}
                    emissive={CONFIG.colors.gold}
                    emissiveIntensity={0.4}
                  />
                </mesh>
              </>
            )}
            {obj.type === 2 && (
              // Candy cane: stick + hook
              <>
                <mesh geometry={caneStickGeometry} position={[0, -0.6, 0]}>
                  <meshStandardMaterial
                    color={obj.color}
                    roughness={0.35}
                    metalness={0.2}
                    emissive={obj.color}
                    emissiveIntensity={0.15}
                  />
                </mesh>
                <mesh
                  geometry={caneHookGeometry}
                  position={[0, 0, 0]}
                  rotation={[Math.PI / 2, 0, 0]}
                >
                  <meshStandardMaterial
                    color={obj.color}
                    roughness={0.35}
                    metalness={0.2}
                    emissive={obj.color}
                    emissiveIntensity={0.15}
                  />
                </mesh>
              </>
            )}
          </group>
        );
      })}
    </group>
  );
};

// --- Component: Fairy Lights ---
const FairyLights = ({ state }: { state: "CHAOS" | "FORMED" }) => {
  const count = CONFIG.counts.lights;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.8, 8, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const h = CONFIG.tree.height;
      const t = Math.random();
      const y = Math.pow(t, 1.8) * h - h / 2; // bias more lights toward the lower half
      const chaosPos = new THREE.Vector3(
        (Math.random() - 0.5) * 60,
        y + (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 60
      );
      const rBase = CONFIG.tree.radius;
      const normalizedHeight = (y + h / 2) / h;
      const currentRadius = rBase * (1 - normalizedHeight) + 0.3;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(
        currentRadius * Math.cos(theta),
        y,
        currentRadius * Math.sin(theta)
      );
      const color =
        CONFIG.colors.lights[
          Math.floor(Math.random() * CONFIG.colors.lights.length)
        ];
      const speed = 2 + Math.random() * 3;
      return {
        chaosPos,
        targetPos,
        color,
        speed,
        currentPos: chaosPos.clone(),
        timeOffset: Math.random() * 100,
        normalizedHeight,
      };
    });
  }, []);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === "FORMED";
    const time = stateObj.clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 2.0);
      const mesh = child as THREE.Mesh;
      mesh.position.copy(objData.currentPos);
      const intensity =
        (Math.sin(time * objData.speed + objData.timeOffset) + 1) / 2;
      const heightBoost = 0.55 + (1 - objData.normalizedHeight) * 0.9;
      if (mesh.material) {
        (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity =
          isFormed ? (3 + intensity * 4) * heightBoost : 0;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <mesh key={i} scale={[0.15, 0.15, 0.15]} geometry={geometry}>
          <meshStandardMaterial
            color={obj.color}
            emissive={obj.color}
            emissiveIntensity={0}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
};

// --- Component: Top Star (No Photo, Pure Gold 3D Star) ---
const TopStar = ({ state }: { state: "CHAOS" | "FORMED" }) => {
  const groupRef = useRef<THREE.Group>(null);

  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const outerRadius = 1.3;
    const innerRadius = 0.7;
    const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      i === 0
        ? shape.moveTo(radius * Math.cos(angle), radius * Math.sin(angle))
        : shape.lineTo(radius * Math.cos(angle), radius * Math.sin(angle));
    }
    shape.closePath();
    return shape;
  }, []);

  const starGeometry = useMemo(() => {
    return new THREE.ExtrudeGeometry(starShape, {
      depth: 0.4, // 增加一点厚度
      bevelEnabled: true,
      bevelThickness: 0.1,
      bevelSize: 0.1,
      bevelSegments: 3,
    });
  }, [starShape]);

  // 纯金材质
  const goldMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: CONFIG.colors.gold,
        emissive: CONFIG.colors.gold,
        emissiveIntensity: 1.5, // 适中亮度，既发光又有质感
        roughness: 0.1,
        metalness: 1.0,
      }),
    []
  );

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.5;
      const targetScale = state === "FORMED" ? 1 : 0;
      groupRef.current.scale.lerp(
        new THREE.Vector3(targetScale, targetScale, targetScale),
        delta * 3
      );
    }
  });

  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 1.8, 0]}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.2}>
        <mesh geometry={starGeometry} material={goldMaterial} />
      </Float>
    </group>
  );
};

// --- Main Scene Experience ---
const Experience = ({
  sceneState,
  rotationSpeed,
}: {
  sceneState: "CHAOS" | "FORMED";
  rotationSpeed: number;
}) => {
  const controlsRef = useRef<any>(null);
  useFrame(() => {
    if (controlsRef.current) {
      controlsRef.current.setAzimuthalAngle(
        controlsRef.current.getAzimuthalAngle() + rotationSpeed
      );
      controlsRef.current.update();
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 12, 55]} fov={45} />
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableZoom={true}
        minDistance={38}
        maxDistance={150}
        autoRotate={true}
        maxPolarAngle={Math.PI / 1.7}
      />

      <color attach="background" args={["#000300"]} />
      <Stars
        radius={100}
        depth={50}
        count={5000}
        factor={4}
        saturation={0}
        fade
        speed={1}
      />
      <Environment preset="night" background={false} />

      <ambientLight intensity={0.4} color="#003311" />
      <pointLight
        position={[30, 30, 30]}
        intensity={100}
        color={CONFIG.colors.warmLight}
      />
      <pointLight
        position={[-30, 10, -30]}
        intensity={50}
        color={CONFIG.colors.gold}
      />
      <pointLight position={[0, -20, 10]} intensity={30} color="#ffffff" />

      <group position={[0, -1, 0]}>
        <Foliage state={sceneState} />
        <Suspense fallback={null}>
          <PhotoOrnaments state={sceneState} />
          <ChristmasElements state={sceneState} />
          <FairyLights state={sceneState} />
          <TopStar state={sceneState} />
        </Suspense>
        <Sparkles
          count={600}
          scale={50}
          size={8}
          speed={0.4}
          opacity={0.4}
          color={CONFIG.colors.silver}
        />
      </group>

      <EffectComposer>
        <Bloom
          luminanceThreshold={0.8}
          luminanceSmoothing={0.1}
          intensity={1.5}
          radius={0.5}
          mipmapBlur
        />
        <Vignette eskil={false} offset={0.1} darkness={1.2} />
      </EffectComposer>
    </>
  );
};

// --- Gesture Controller ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GestureController = ({ onGesture, onMove, onStatus, debugMode }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer;
    let requestRef: number;
    let lastX: number | null = null;
    let lastTimestamp: number | null = null;

    const setup = async () => {
      onStatus("DOWNLOADING AI...");
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
        });
        onStatus("REQUESTING CAMERA...");
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
          });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
            onStatus("AI READY: SHOW HAND");
            predictWebcam();
          }
        } else {
          onStatus("ERROR: CAMERA PERMISSION DENIED");
        }
      } catch (err: any) {
        onStatus(`ERROR: ${err.message || "MODEL FAILED"}`);
      }
    };

    const predictWebcam = () => {
      if (gestureRecognizer && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0) {
          const results = gestureRecognizer.recognizeForVideo(
            videoRef.current,
            Date.now()
          );
          const ctx = canvasRef.current.getContext("2d");
          if (ctx && debugMode) {
            ctx.clearRect(
              0,
              0,
              canvasRef.current.width,
              canvasRef.current.height
            );
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
            if (results.landmarks)
              for (const landmarks of results.landmarks) {
                const drawingUtils = new DrawingUtils(ctx);
                drawingUtils.drawConnectors(
                  landmarks,
                  GestureRecognizer.HAND_CONNECTIONS,
                  { color: "#FFD700", lineWidth: 2 }
                );
                drawingUtils.drawLandmarks(landmarks, {
                  color: "#FF0000",
                  lineWidth: 1,
                });
              }
          } else if (ctx && !debugMode)
            ctx.clearRect(
              0,
              0,
              canvasRef.current.width,
              canvasRef.current.height
            );

          if (results.gestures.length > 0) {
            const name = results.gestures[0][0].categoryName;
            const score = results.gestures[0][0].score;
            const isClosedFist = name === "Closed_Fist" && score > 0.4;
            const isOpenPalm = name === "Open_Palm" && score > 0.4;
            if (score > 0.4) {
              if (name === "Open_Palm") onGesture("CHAOS");
              if (isClosedFist) onGesture("FORMED");
              if (debugMode) onStatus(`DETECTED: ${name}`);
            }
            if (results.landmarks.length > 0) {
              const now = performance.now();
              const currentX = results.landmarks[0][0].x;
              const prevX = lastX;
              const prevTimestamp = lastTimestamp;
              const canControlRotation =
                (isClosedFist || isOpenPalm) &&
                prevX !== null &&
                prevTimestamp !== null;
              if (
                canControlRotation &&
                prevX !== null &&
                prevTimestamp !== null
              ) {
                const deltaX = currentX - prevX;
                const deltaT = Math.max(now - prevTimestamp, 1);
                // Amplify camera rotation responsiveness while keeping a tiny deadzone.
                const velocity = (-deltaX / deltaT) * 280;
                onMove(Math.abs(velocity) > 0.0002 ? velocity : 0);
              } else {
                onMove(0);
              }
              lastX = currentX;
              lastTimestamp = now;
            }
          } else {
            onMove(0);
            lastX = null;
            lastTimestamp = null;
            if (debugMode) onStatus("AI READY: NO HAND");
          }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };
    setup();
    return () => cancelAnimationFrame(requestRef);
  }, [onGesture, onMove, onStatus, debugMode]);

  return (
    <>
      <video
        ref={videoRef}
        style={{
          opacity: debugMode ? 0.6 : 0,
          position: "fixed",
          top: 0,
          right: 0,
          width: debugMode ? "320px" : "1px",
          zIndex: debugMode ? 100 : -1,
          pointerEvents: "none",
          transform: "scaleX(-1)",
        }}
        playsInline
        muted
        autoPlay
      />
      <canvas
        ref={canvasRef}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: debugMode ? "320px" : "1px",
          height: debugMode ? "auto" : "1px",
          zIndex: debugMode ? 101 : -1,
          pointerEvents: "none",
          transform: "scaleX(-1)",
        }}
      />
    </>
  );
};

// --- App Entry ---
export default function GrandTreeApp() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
  });
  const [audioStatus, setAudioStatus] = useState<AudioStatus>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/login");
        if (!res.ok) {
          setAuthState("unauthenticated");
          return;
        }
        await res.json();
        setAuthState("authed");
      } catch (err) {
        console.error("Auth check failed", err);
        setAuthState("unauthenticated");
      }
    };
    checkAuth();
  }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setAuthError(payload?.error || "Invalid credentials");
        setAuthState("unauthenticated");
        return;
      }
      await res.json();
      setAuthState("authed");
    } catch (err) {
      console.error("Login failed", err);
      setAuthError("Network error. Please try again.");
      setAuthState("unauthenticated");
    } finally {
      setSubmitting(false);
    }
  };

  const ensureAudio = useCallback(
    async (options?: { silentAttempt?: boolean }) => {
      if (!audioRef.current) {
        const audio = new Audio("/background.mp3");
        audio.loop = true;
        audio.volume = AUDIO_VOLUME;
        audioRef.current = audio;
      }
      try {
        await audioRef.current.play();
        setAudioStatus("playing");
      } catch (err) {
        console.error("Audio play failed", err);
        if (!options?.silentAttempt) {
          setAudioStatus("error");
        }
      }
    },
    []
  );

  const toggleAudio = useCallback(async () => {
    if (audioStatus === "playing") {
      audioRef.current?.pause();
      setAudioStatus("paused");
      return;
    }
    await ensureAudio();
  }, [audioStatus, ensureAudio]);

  useEffect(() => {
    // Try autoplay once after通过认证；若被拦截，不影响后续手势解锁。
    if (authState !== "authed" || audioStatus !== "idle") return;
    ensureAudio({ silentAttempt: true });
  }, [authState, audioStatus, ensureAudio]);

  useEffect(() => {
    // Attach a one-time listener so the first user gesture unlocks audio reliably.
    if (audioStatus !== "idle" || authState !== "authed") return;
    const onFirstGesture = async () => {
      await ensureAudio();
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
    window.addEventListener("pointerdown", onFirstGesture, { once: true });
    window.addEventListener("keydown", onFirstGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
  }, [authState, audioStatus, ensureAudio]);

  const [sceneState, setSceneState] = useState<"CHAOS" | "FORMED">("CHAOS");
  const baseSpin = sceneState === "CHAOS" ? 0.03 : 0.01;
  const [rotationSpeed, setRotationSpeed] = useState(baseSpin);
  const [aiStatus, setAiStatus] = useState("INITIALIZING...");
  const [debugMode, setDebugMode] = useState(false);
  const handleMove = useCallback(
    (speed: number) => {
      // Always keep a gentle auto-spin; hand movement adds to it in either direction.
      setRotationSpeed(baseSpin + speed);
    },
    [baseSpin]
  );

  // Keep auto-spin aligned with the current gesture state (open palm = slower).
  useEffect(() => {
    setRotationSpeed(baseSpin);
  }, [baseSpin]);

  if (authState !== "authed") {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background:
            "radial-gradient(circle at 20% 20%, rgba(255,215,0,0.08), transparent 30%), radial-gradient(circle at 80% 80%, rgba(0,100,0,0.2), transparent 30%), #020b0a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#f7f7f7",
          fontFamily: FONT_STACK,
          padding: "24px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "440px",
            background: "rgba(10, 20, 18, 0.8)",
            border: "1px solid rgba(255, 215, 0, 0.2)",
            borderRadius: "16px",
            padding: "28px",
            boxShadow:
              "0 30px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255,255,255,0.03)",
            backdropFilter: "blur(10px)",
          }}
        >
          <div style={{ marginBottom: "18px" }}>
            <p
              style={{
                letterSpacing: "3px",
                fontSize: "10px",
                color: "rgba(255, 215, 0, 0.7)",
                textTransform: "uppercase",
                marginBottom: "6px",
              }}
            >
              Private Access
            </p>
            <h1
              style={{
                fontSize: "26px",
                margin: 0,
                lineHeight: 1.2,
                color: "#f3f3f3",
                fontWeight: 700,
              }}
            >
              🎄圣诞节快乐
            </h1>
          </div>

          <form onSubmit={handleLogin} style={{ display: "grid", gap: "12px" }}>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={{ fontSize: "12px", color: "#cbd4d0" }}>用户名</span>
              <input
                type="text"
                value={credentials.username}
                onChange={(e) =>
                  setCredentials((prev) => ({
                    ...prev,
                    username: e.target.value,
                  }))
                }
                required
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  backgroundColor: "rgba(0,0,0,0.35)",
                  color: "#fff",
                  outline: "none",
                  fontSize: "14px",
                }}
              />
            </label>

            <label style={{ display: "grid", gap: "6px" }}>
              <span style={{ fontSize: "12px", color: "#cbd4d0" }}>密码</span>
              <input
                type="password"
                value={credentials.password}
                onChange={(e) =>
                  setCredentials((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
                required
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  backgroundColor: "rgba(0,0,0,0.35)",
                  color: "#fff",
                  outline: "none",
                  fontSize: "14px",
                }}
              />
            </label>

            {authError ? (
              <div
                style={{
                  backgroundColor: "rgba(255, 64, 64, 0.08)",
                  border: "1px solid rgba(255, 64, 64, 0.4)",
                  color: "#ff8a8a",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  fontSize: "13px",
                }}
              >
                {authError}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              style={{
                marginTop: "6px",
                width: "100%",
                padding: "12px 14px",
                borderRadius: "10px",
                border: "none",
                background:
                  "linear-gradient(135deg, #0bbf6b 0%, #38a169 50%, #f6e05e 100%)",
                color: "#0a1f1a",
                fontWeight: 700,
                fontSize: "14px",
                letterSpacing: "0.6px",
                cursor: submitting ? "not-allowed" : "pointer",
                boxShadow: "0 15px 30px rgba(0, 255, 170, 0.15)",
                opacity: submitting ? 0.6 : 1,
                transition: "transform 0.15s ease, box-shadow 0.2s ease",
              }}
            >
              {submitting ? "登陆中..." : "登陆"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        backgroundColor: "#000",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: 1,
        }}
      >
        <Canvas
          dpr={[1, 1.5]} // 降低像素比以提升帧率
          gl={{ toneMapping: THREE.ReinhardToneMapping }}
          shadows
        >
          <Experience sceneState={sceneState} rotationSpeed={rotationSpeed} />
        </Canvas>
      </div>
      <GestureController
        onGesture={setSceneState}
        onMove={handleMove}
        onStatus={setAiStatus}
        debugMode={debugMode}
      />

      {/* UI - Stats */}
      <div
        style={{
          position: "absolute",
          bottom: "30px",
          left: "40px",
          color: "#888",
          zIndex: 10,
          fontFamily: FONT_STACK,
          userSelect: "none",
        }}
      >
        <div style={{ marginBottom: "15px" }}>
          <p
            style={{
              fontSize: "15px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              marginBottom: "4px",
            }}
          >
            回忆
          </p>
          <p
            style={{
              fontSize: "24px",
              color: "#FFD700",
              fontWeight: "bold",
              margin: 0,
            }}
          >
            {TOTAL_NUMBERED_PHOTOS.toLocaleString()}{" "}
            <span
              style={{ fontSize: "10px", color: "#555", fontWeight: "normal" }}
            >
              照片
            </span>
          </p>
        </div>
      </div>

      {/* UI - Buttons */}
      <div
        style={{
          position: "absolute",
          bottom: "30px",
          right: "40px",
          zIndex: 10,
          display: "flex",
          gap: "10px",
        }}
      >
        <button
          onClick={toggleAudio}
          style={{
            padding: "12px 15px",
            backgroundColor:
              audioStatus === "playing"
                ? "rgba(15, 178, 102, 0.9)"
                : "rgba(0,0,0,0.5)",
            border: "1px solid rgba(15, 178, 102, 0.9)",
            color: audioStatus === "playing" ? "#02130d" : "#9ef7ca",
            fontFamily: FONT_STACK,
            fontSize: "15x",
            fontWeight: "bold",
            letterSpacing: "3px",
            textTransform: "uppercase",
            cursor: "pointer",
            backdropFilter: "blur(4px)",
          }}
        >
          {audioStatus === "playing"
            ? "🔊 暂停"
            : audioStatus === "error"
            ? "🔊 播放失败"
            : audioStatus === "paused"
            ? "🔊 继续"
            : "🔊 播放"}
        </button>

        <button
          onClick={() => setDebugMode(!debugMode)}
          style={{
            padding: "12px 15px",
            backgroundColor: debugMode ? "#FFD700" : "rgba(0,0,0,0.5)",
            border: "1px solid #FFD700",
            color: debugMode ? "#000" : "#FFD700",
            fontFamily: FONT_STACK,
            fontSize: "15x",
            fontWeight: "bold",
            letterSpacing: "3px",
            textTransform: "uppercase",
            cursor: "pointer",
            backdropFilter: "blur(4px)",
          }}
        >
          {debugMode ? "📸 隐藏" : "📸 开启"}
        </button>

        <button
          onClick={() =>
            setSceneState((s) => (s === "CHAOS" ? "FORMED" : "CHAOS"))
          }
          style={{
            padding: "12px 15px",
            backgroundColor: "rgba(0,0,0,0.5)",
            border: "1px solid rgba(255, 215, 0, 0.5)",
            color: "#FFD700",
            fontFamily: FONT_STACK,
            fontSize: "15x",
            fontWeight: "bold",
            letterSpacing: "3px",
            textTransform: "uppercase",
            cursor: "pointer",
            backdropFilter: "blur(4px)",
          }}
        >
          {sceneState === "CHAOS" ? "🎄 组合" : "🎄 分散"}
        </button>
      </div>

      {/* UI - AI Status */}
      <div
        style={{
          position: "absolute",
          top: "20px",
          left: "50%",
          transform: "translateX(-50%)",
          color: aiStatus.includes("ERROR")
            ? "#FF0000"
            : "rgba(255, 215, 0, 0.4)",
          fontSize: "10px",
          letterSpacing: "2px",
          zIndex: 10,
          background: "rgba(0,0,0,0.5)",
          padding: "4px 8px",
          borderRadius: "4px",
        }}
      >
        {aiStatus}
      </div>
    </div>
  );
}
