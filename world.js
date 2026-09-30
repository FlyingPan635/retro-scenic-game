import * as THREE from './vendor/three.module.js';
import { MAP } from './map.js';
import { createSleepers } from './sleepers.js';

const palette = {
  grass: new THREE.Color('#40bf4c'),
  path: 0xc7b57e,
  red: 0xc34f5b,
  yellow: 0xf8d46e,
  bark: 0x68473c,
  foliage: [0x178f53, 0x1da761, 0x249953, 0x32b362, 0x27855a],
};
const leafMaterials = palette.foliage.map(color => new THREE.MeshLambertMaterial({ color, flatShading: true }));
const trunkMat = new THREE.MeshLambertMaterial({ color: palette.bark, flatShading: true });
const goldMat = new THREE.MeshLambertMaterial({ color: 0xffd85e, emissive: 0x916017, emissiveIntensity: 0.45, flatShading: true });
const seedValue = MAP.seed;
let randomState = seedValue;
const rand = () => ((randomState = (1664525 * randomState + 1013904223) >>> 0) / 4294967296);

function landHeightAt(x, z) {
  const t = MAP.terrain;
  let y = t.base;
  for (const w of t.waves) y += w.amplitude * Math.sin(x * w.frequencyX + w.phase) * Math.cos(z * w.frequencyZ + w.phase * 0.4);
  for (const hill of t.hills) {
    const dx = x - hill.x, dz = z - hill.z;
    y += hill.height * Math.exp(-(dx * dx + dz * dz) / (hill.radius * hill.radius));
  }
  return y;
}

function riverXAt(z) {
  const points = MAP.river.points;
  if (z >= points[0][1]) return points[0][0];
  if (z <= points[points.length - 1][1]) return points[points.length - 1][0];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    if (z > z0 || z < z1) continue;
    const span = z1 - z0, t = (z - z0) / span;
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 2)];
    const m0 = (x1 - before[0]) / (z1 - before[1]) * span;
    const m1 = (after[0] - x0) / (after[1] - z0) * span;
    return (2 * t ** 3 - 3 * t ** 2 + 1) * x0 + (t ** 3 - 2 * t ** 2 + t) * m0
      + (-2 * t ** 3 + 3 * t ** 2) * x1 + (t ** 3 - t ** 2) * m1;
  }
  return points[0][0];
}

export function riverAt(x, z) {
  const river = MAP.river;
  if (!river || z < river.points[river.points.length - 1][1] || z > river.points[0][1]) {
    return { depth: 0, proximity: 0, surfaceY: -Infinity, currentX: 0, currentZ: 0 };
  }
  const distance = Math.abs(x - riverXAt(z));
  const half = river.width / 2;
  // 溪声在河岸外 10 米内渐弱；河面仍保持近处音量，水流物理不受影响。
  const proximity = Math.max(0, 1 - Math.max(0, distance - half) / 10);
  const depth = distance <= half ? Math.max(0, landHeightAt(x, z) - .62 - heightAt(x, z)) : 0;
  const dx = riverXAt(Math.max(river.points[river.points.length - 1][1], z - .5))
    - riverXAt(Math.min(river.points[0][1], z + .5));
  const length = Math.hypot(dx, 1);
  return { depth, proximity, surfaceY: landHeightAt(x, z) - .62, currentX: dx / length, currentZ: -1 / length };
}

function treeOverlapsRiver(x, z, scale = 1) {
  const river = MAP.river;
  if (!river) return false;
  const crownRadius = 1.8 * scale;
  const bottom = river.points[river.points.length - 1][1], top = river.points[0][1];
  if (z + crownRadius < bottom || z - crownRadius > top) return false;
  for (const offset of [-crownRadius, 0, crownRadius]) {
    const sampleZ = THREE.MathUtils.clamp(z + offset, bottom, top);
    if (Math.abs(x - riverXAt(sampleZ)) < river.width / 2 + crownRadius + .35) return true;
  }
  return false;
}

export function heightAt(x, z) {
  const land = landHeightAt(x, z);
  const river = MAP.river;
  if (!river || z < river.points[river.points.length - 1][1] || z > river.points[0][1]) return land;
  const distance = Math.abs(x - riverXAt(z));
  const inner = river.width / 2 - .6, outer = river.width / 2 + 2.2;
  const t = THREE.MathUtils.clamp((distance - inner) / (outer - inner), 0, 1);
  return land - 1.3 * (1 - t * t * (3 - 2 * t));
}

function addRiver(scene) {
  const river = MAP.river, top = river.points[0][1], bottom = river.points[river.points.length - 1][1];
  const rows = Math.ceil((top - bottom) / .75), half = river.width / 2;
  const makeStrip = (side) => {
    const positions = [], colors = [], indices = [];
    const columns = side === 0 ? 8 : 3;
    const tint = new THREE.Color();
    for (let i = 0; i <= rows; i++) {
      const z = top + (bottom - top) * i / rows, center = riverXAt(z);
      for (let j = 0; j <= columns; j++) {
        const across = j / columns;
        const offset = side === 0 ? (across * 2 - 1) * half : side * (half + .08 + across * 2.1);
        const x = center + offset;
        const y = side === 0 ? landHeightAt(x, z) - .62 : heightAt(x, z) + .07;
        positions.push(x, y, z);
        if (side === 0) {
          tint.setRGB(.10, .56, .69).offsetHSL(0, 0, Math.sin(z * .5 + across * 11) * .035 + (1 - Math.abs(across * 2 - 1)) * .045);
        } else {
          tint.setRGB(.62, .66, .43).offsetHSL(0, 0, Math.sin(z * .42 + across * 8) * .025);
        }
        colors.push(tint.r, tint.g, tint.b);
        if (i < rows && j < columns) {
          const a = i * (columns + 1) + j;
          indices.push(a, a + 1, a + columns + 1, a + 1, a + columns + 2, a + columns + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  makeStrip(-1);
  makeStrip(1);
  makeStrip(0);
  const rippleGeometry = new THREE.PlaneGeometry(1, .13);
  rippleGeometry.rotateX(-Math.PI / 2);
  const rippleMaterial = new THREE.MeshBasicMaterial({ color: 0xc7fff0, transparent: true, opacity: .48, depthWrite: false, side: THREE.DoubleSide });
  const ripples = [];
  for (let i = 0; i < 42; i++) {
    const mesh = new THREE.Mesh(rippleGeometry, rippleMaterial);
    const offset = (rand() * 2 - 1) * (half - .75);
    mesh.scale.x = .55 + rand() * 1.15;
    scene.add(mesh);
    ripples.push({ mesh, offset, startZ: bottom + rand() * (top - bottom), speed: 1.7 + rand() * .9 });
  }
  return ripples;
}

export function animateRiver(ripples, time) {
  if (!MAP.river || !ripples.length) return;
  const top = MAP.river.points[0][1], bottom = MAP.river.points[MAP.river.points.length - 1][1], length = top - bottom;
  for (const ripple of ripples) {
    const z = top - ((top - ripple.startZ + time * ripple.speed) % length);
    const x = riverXAt(z) + ripple.offset;
    ripple.mesh.position.set(x, landHeightAt(x, z) - .57, z);
  }
}

function terrain(scene) {
  const geometry = new THREE.PlaneGeometry(MAP.size, MAP.size, 110, 110);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  const colors = [];
  const scratch = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    const h = heightAt(x, z);
    positions.setY(i, h);
    const shade = Math.sin(x * 0.53 + z * 0.27) * 0.043 + Math.sin(z * 1.19 - x * 0.37) * 0.025 + (h - 1) * 0.009;
    scratch.copy(palette.grass).offsetHSL(0, 0, shade);
    colors.push(scratch.r, scratch.g, scratch.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function path(scene, data) {
  const curve = new THREE.CatmullRomCurve3(data.points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const n = data.points.length * 24;
  const verts = [], uv = [], indices = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = curve.getPoint(t), tangent = curve.getTangent(t);
    const sideX = tangent.z, sideZ = -tangent.x;
    const wobble = Math.sin(t * 51) * 0.11;
    for (let s of [-1, 1]) {
      const x = p.x + sideX * (data.width / 2 + wobble) * s;
      const z = p.z + sideZ * (data.width / 2 + wobble) * s;
      verts.push(x, heightAt(x, z) + 0.055, z);
      uv.push(s < 0 ? 0 : 1, t * 15);
    }
    if (i < n) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: palette.path, side: THREE.DoubleSide, flatShading: true }));
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function sky(scene) {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(340, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying float vY; void main(){ vec3 horizon=vec3(0.82,0.94,1.0); vec3 mid=vec3(0.24,0.57,0.91); vec3 zenith=vec3(0.12,0.35,0.79); float a=smoothstep(-0.18,0.48,vY); float b=smoothstep(0.25,1.0,vY); gl_FragColor=vec4(mix(mix(horizon,mid,a),zenith,b),1.0); }',
  }));
  scene.add(dome);
  // 云层跟随玩家，按环形分布：转向任意方向都能看到天空中的云。
  const cloudRig = new THREE.Group();
  scene.add(cloudRig);
  const cloudMats = [
    new THREE.MeshBasicMaterial({ color: 0xfffdf1, fog: false, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: 0xe0f0ed, fog: false, depthWrite: false }),
  ];
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  let cloudSeed = (MAP.seed ^ 0x9e3779b9) >>> 0;
  const cloudRand = () => ((cloudSeed = (1664525 * cloudSeed + 1013904223) >>> 0) / 4294967296);
  for (let c = 0; c < 25; c++) {
    const angle = (c + (cloudRand() - .5) * .55) * Math.PI * 2 / 25;
    const distance = 96 + cloudRand() * 48;
    const x = Math.sin(angle) * distance, z = Math.cos(angle) * distance;
    const y = 20 + cloudRand() * 21, size = 7 + cloudRand() * 7;
    const cloud = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMats[i === 0 ? 1 : 0]);
      puff.position.set((i - 2.5) * size * .35, (i % 3) * size * .09, (i % 2) * size * .08);
      puff.scale.set(size * (i === 2 || i === 3 ? .55 : .4), size * (i === 2 ? .4 : .3), size * .31);
      cloud.add(puff);
    }
    cloud.position.set(x, y, z);
    cloud.rotation.y = -angle;
    cloudRig.add(cloud);
  }
  return cloudRig;
}

function addTree(scene, item, obstacles) {
  const group = new THREE.Group();
  const s = item.scale || 1;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.17, .25, 2.2, 6), trunkMat);
  trunk.position.y = 1.1;
  trunk.castShadow = true;
  group.add(trunk);
  const colors = [rand() * leafMaterials.length | 0, rand() * leafMaterials.length | 0, rand() * leafMaterials.length | 0];
  const blobs = [
    { x: 0, y: 2.55, z: 0, sx: 1.42, sy: .95, sz: 1.23 },
    { x: -.8, y: 2.48, z: .18, sx: .92, sy: .68, sz: .8 },
    { x: .86, y: 2.45, z: -.12, sx: .9, sy: .72, sz: .8 },
  ];
  blobs.forEach((b, i) => {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), leafMaterials[colors[i]]);
    mesh.position.set(b.x, b.y, b.z);
    mesh.scale.set(b.sx, b.sy, b.sz);
    mesh.rotation.y = rand() * 6.28;
    mesh.castShadow = true;
    group.add(mesh);
  });
  group.position.set(item.x, heightAt(item.x, item.z), item.z);
  group.scale.setScalar(s);
  scene.add(group);
  obstacles.push({ x: item.x, z: item.z, radius: .56 * s });
}

function addTent(scene, item, obstacles) {
  const g = new THREE.Group(), radius = 4.2, sides = 12, wallH = 3.25, peak = 7.5;
  const stripeMats = [
    new THREE.MeshLambertMaterial({ color: palette.red, side: THREE.DoubleSide, flatShading: true }),
    new THREE.MeshLambertMaterial({ color: palette.yellow, side: THREE.DoubleSide, flatShading: true }),
  ];
  const vertexTri = (points, mat) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;
    g.add(mesh);
  };
  for (let i = 0; i < sides; i++) {
    const a = i * Math.PI * 2 / sides, b = (i + 1) * Math.PI * 2 / sides;
    const x1 = Math.sin(a) * radius, z1 = Math.cos(a) * radius;
    const x2 = Math.sin(b) * radius, z2 = Math.cos(b) * radius;
    const mat = stripeMats[i % 2];
    vertexTri([[x1, .12, z1], [x2, .12, z2], [x1, wallH, z1], [x2, .12, z2], [x2, wallH, z2], [x1, wallH, z1]], mat);
    vertexTri([[x1, wallH, z1], [x2, wallH, z2], [0, peak, 0]], mat);
  }
  const trim = new THREE.Mesh(new THREE.TorusGeometry(radius, .09, 5, sides * 2), new THREE.MeshLambertMaterial({ color: 0xf9e07e }));
  trim.rotation.x = Math.PI / 2;
  trim.position.y = wallH;
  g.add(trim);
  const doorway = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 2.05), new THREE.MeshLambertMaterial({ color: 0x24394b, side: THREE.DoubleSide }));
  doorway.position.set(0, 1.14, radius + .05);
  g.add(doorway);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.045, .055, 1.1, 5), new THREE.MeshLambertMaterial({ color: 0xf8e19a }));
  pole.position.y = peak + .47;
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.ConeGeometry(.5, .72, 3), stripeMats[0]);
  flag.rotation.z = -Math.PI / 2;
  flag.position.set(.35, peak + .85, 0);
  g.add(flag);
  g.position.set(item.x, heightAt(item.x, item.z) - .08, item.z);
  g.scale.setScalar(item.scale || 1);
  scene.add(g);
  obstacles.push({ x: item.x, z: item.z, radius: radius * (item.scale || 1) * .84 });
}

function addWindmill(scene, item, obstacles, moving) {
  const g = new THREE.Group();
  const cream = new THREE.MeshLambertMaterial({ color: 0xf3deb0, flatShading: true });
  const roof = new THREE.MeshLambertMaterial({ color: 0xc55e58, flatShading: true });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.65, 6.3, 8), cream);
  tower.position.y = 3.15; tower.castShadow = true; g.add(tower);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.47, 2, 8), roof);
  cap.position.y = 7.25; cap.castShadow = true; g.add(cap);
  const door = new THREE.Mesh(new THREE.BoxGeometry(.82, 1.35, .1), new THREE.MeshLambertMaterial({ color: 0x694c4a }));
  door.position.set(0, .68, 1.54); g.add(door);
  const hub = new THREE.Group(); hub.position.set(0, 5.65, 1.4);
  const bladeMat = new THREE.MeshLambertMaterial({ color: 0xf8edcd, side: THREE.DoubleSide, flatShading: true });
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(.42, 3.1, .12), bladeMat);
    blade.position.y = 1.65; blade.position.z = .12; blade.rotation.z = .08;
    const pivot = new THREE.Group(); pivot.rotation.z = i * Math.PI / 2; pivot.add(blade); hub.add(pivot);
  }
  const hubPin = new THREE.Mesh(new THREE.SphereGeometry(.28, 6, 5), roof);
  hubPin.position.z = .26; hub.add(hubPin); g.add(hub);
  g.position.set(item.x, heightAt(item.x, item.z), item.z);
  g.scale.setScalar(item.scale || 1);
  scene.add(g); moving.push(hub);
  obstacles.push({ x: item.x, z: item.z, radius: 1.5 * (item.scale || 1) });
}

function addSign(scene, item) {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x78533e, flatShading: true });
  const board = new THREE.Mesh(new THREE.BoxGeometry(3.4, .82, .19), new THREE.MeshLambertMaterial({ color: 0xc5965f }));
  board.position.y = 2.15; board.castShadow = true; g.add(board);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(.11, .15, 2.45, 5), wood);
  post.position.y = 1.22; g.add(post);
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d9ad70'; ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#845540'; ctx.lineWidth = 7; ctx.strokeRect(9, 8, 494, 112);
  ctx.fillStyle = '#604133'; ctx.font = 'bold 37px Microsoft YaHei, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(item.text, 256, 66);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(3.2, .67), new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
  face.position.set(0, 2.15, .107); g.add(face);
  g.position.set(item.x, heightAt(item.x, item.z), item.z);
  g.rotation.y = item.rotation || 0;
  scene.add(g);
}

function addRock(scene, item) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(.8, 0), new THREE.MeshLambertMaterial({ color: 0xb9b5a0, flatShading: true }));
  rock.scale.set(1.35, .6, .8); rock.scale.multiplyScalar(item.scale || 1);
  rock.position.set(item.x, heightAt(item.x, item.z) + .35 * (item.scale || 1), item.z);
  rock.rotation.y = rand() * 6.28;
  rock.castShadow = true; scene.add(rock);
}

function addFlowers(scene, item) {
  const colors = [0xffdf7b, 0xf6e6da, 0xe3a4a8, 0xfff4c4];
  const stems = new THREE.MeshLambertMaterial({ color: 0x1c8b42 });
  const mats = colors.map(color => new THREE.MeshLambertMaterial({ color }));
  const geo = new THREE.IcosahedronGeometry(.10, 0);
  for (let i = 0; i < item.count; i++) {
    const angle = rand() * Math.PI * 2, d = Math.sqrt(rand()) * item.radius;
    const x = item.x + Math.cos(angle) * d, z = item.z + Math.sin(angle) * d;
    const h = heightAt(x, z), flower = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(.018, .026, .28, 4), stems);
    stem.position.y = .14; flower.add(stem);
    const bloom = new THREE.Mesh(geo, mats[rand() * mats.length | 0]);
    bloom.position.y = .32; flower.add(bloom);
    flower.position.set(x, h, z); scene.add(flower);
  }
}

function addBird(scene, item, birds) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: item.color, flatShading: true });
  const wingColor = new THREE.Color(item.color).offsetHSL(0, -.04, .09);
  const wingMat = new THREE.MeshLambertMaterial({ color: wingColor, flatShading: true });
  const bellyMat = new THREE.MeshLambertMaterial({ color: 0xfff0d6, flatShading: true });
  const beakMat = new THREE.MeshLambertMaterial({ color: 0xf3b657, flatShading: true });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x263c50 });
  const sphere = new THREE.IcosahedronGeometry(1, 1);
  const body = new THREE.Mesh(sphere, bodyMat);
  body.scale.set(.22, .20, .38);
  group.add(body);
  const belly = new THREE.Mesh(sphere, bellyMat);
  belly.position.set(0, -.13, -.09);
  belly.scale.set(.18, .10, .23);
  group.add(belly);
  const head = new THREE.Mesh(sphere, bodyMat);
  head.position.set(0, .1, -.31);
  head.scale.set(.19, .18, .18);
  group.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(.06, .16, 4), beakMat);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, .065, -.52);
  group.add(beak);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.IcosahedronGeometry(.027, 0), eyeMat);
    eye.position.set(side * .145, .145, -.415);
    group.add(eye);
    const foot = new THREE.Mesh(sphere, beakMat);
    foot.position.set(side * .105, -.17, .19);
    foot.scale.set(.04, .04, .1);
    group.add(foot);
  }
  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * .18, .035, .025);
    // Tapered feather silhouette, with a separate wrist instead of rigid paddles.
    const feather = (points) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
      geometry.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4]);
      geometry.computeVertexNormals();
      return new THREE.Mesh(geometry, wingMat);
    };
    wingMat.side = THREE.DoubleSide;
    pivot.add(feather([[0, 0, -.13], [side * .4, .02, -.16],
      [side * .48, 0, .06], [side * .28, -.025, .23], [0, 0, .18]]));
    const wrist = new THREE.Group();
    wrist.position.set(side * .4, .02, -.08);
    wrist.add(feather([[0, 0, -.08], [side * .43, 0, .1],
      [side * .32, -.015, .23], [side * .16, -.025, .29], [0, 0, .19]]));
    pivot.add(wrist);
    group.add(pivot);
    wings.push({ pivot, wrist, side });
  }
  const tailRig = new THREE.Group();
  tailRig.position.set(0, -.035, .29);
  const tails = [];
  for (const side of [-1, 1]) {
    const tail = new THREE.Mesh(sphere, wingMat);
    tail.position.set(side * .065, 0, .16);
    tail.scale.set(.095, .035, .23);
    tail.rotation.y = side * .2;
    tailRig.add(tail);
    tails.push({ mesh: tail, side });
  }
  group.add(tailRig);
  group.rotation.order = 'YXZ';
  group.scale.setScalar(item.scale || 1);
  scene.add(group);
  birds.push({ group, wings, tailRig, tails, x: item.x, z: item.z, baseY: heightAt(item.x, item.z) + item.altitude, radius: item.radius, speed: item.speed, phase: rand() * 6.28 });
}

export function createWorld(scene) {
  randomState = seedValue;
  scene.background = new THREE.Color('#bde9f2');
  scene.fog = new THREE.FogExp2(0xbce8eb, .0077);
  scene.add(new THREE.HemisphereLight(0xe4f6ff, 0x72a35b, 2.2));
  const sun = new THREE.DirectionalLight(0xfff0cc, 2.5);
  sun.position.set(-23, 48, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -62; sun.shadow.camera.right = 62;
  sun.shadow.camera.top = 62; sun.shadow.camera.bottom = -62;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 140;
  sun.shadow.bias = -.0002;
  scene.add(sun);
  const cloudRig = sky(scene); terrain(scene);
  const ripples = MAP.river ? addRiver(scene) : [];
  MAP.paths.forEach(p => path(scene, p));
  const obstacles = [], moving = [], birds = [];
  for (const item of MAP.objects) {
    if (item.type === 'tree' && !treeOverlapsRiver(item.x, item.z, item.scale || 1)) addTree(scene, item, obstacles);
    if (item.type === 'tent') addTent(scene, item, obstacles);
    if (item.type === 'windmill') addWindmill(scene, item, obstacles, moving);
    if (item.type === 'sign') addSign(scene, item);
    if (item.type === 'rock') addRock(scene, item);
    if (item.type === 'flowerPatch') addFlowers(scene, item);
  }
  for (const grove of MAP.groves) {
    for (let i = 0; i < grove.count; i++) {
      const a = rand() * 6.283, d = Math.sqrt(rand()) * grove.radius;
      const x = grove.x + Math.cos(a) * d, z = grove.z + Math.sin(a) * d;
      if (Math.abs(x) > MAP.size / 2 - 3 || Math.abs(z) > MAP.size / 2 - 3) continue;
      const scale = .67 + rand() * .68;
      if (treeOverlapsRiver(x, z, scale)) continue;
      addTree(scene, { x, z, scale }, obstacles);
    }
  }
  (MAP.birds || []).forEach(item => addBird(scene, item, birds));
  const sleepers = createSleepers(scene, MAP.sleepers || [], heightAt);
  return { obstacles, moving, cloudRig, birds, sleepers, ripples };
}
