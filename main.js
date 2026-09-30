import * as THREE from './vendor/three.module.js';
import { MAP } from './map.js';
import { createWorld, heightAt, riverAt, animateRiver } from './world.js';
import { createAvatar } from './avatar.js';
import { createAudio } from './audio.js';
import { tankStep } from './movement.js';
import { birdFlight } from './bird-flight.js';
import { animateSleepers } from './sleepers.js';

const canvas = document.querySelector('#game');
const sound = createAudio(MAP);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(67, 1, .1, 450);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
const world = createWorld(scene);

const character = createAvatar();
const avatar = character.root;
avatar.position.set(MAP.spawn.x, heightAt(MAP.spawn.x, MAP.spawn.z), MAP.spawn.z);
scene.add(avatar);

let cameraYaw = MAP.spawn.cameraYaw ?? MAP.spawn.facing ?? 0, cameraPitch = .19, cameraDistance = 9;
let verticalSpeed = 0, grounded = true, jumpQueued = false, walkClock = 0;
let stepDistance = 0;
let wasInWater = false;
const keys = new Set();
const joy = { x: 0, y: 0, pointer: null };
const activePointer = { id: null, x: 0, y: 0 };
const clock = new THREE.Clock();
const target = new THREE.Vector3();

function resize() {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  const scale = w < 700 ? .73 : .69;
  renderer.setSize(Math.round(w * scale), Math.round(h * scale), false);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();


addEventListener('keydown', event => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  sound.unlock();
  keys.add(event.code);
  if (event.code === 'Space' && !event.repeat) jumpQueued = true;
});
addEventListener('keyup', event => keys.delete(event.code));
addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });
canvas.addEventListener('contextmenu', event => { event.preventDefault(); keys.clear(); });
canvas.addEventListener('pointerdown', event => {
  if (event.pointerType === 'mouse' && event.button !== 0) { keys.clear(); activePointer.id = null; return; }
  sound.unlock();
  activePointer.id = event.pointerId; activePointer.x = event.clientX; activePointer.y = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerId !== activePointer.id) return;
  const dx = event.clientX - activePointer.x, dy = event.clientY - activePointer.y;
  cameraYaw -= dx * .006;
  cameraPitch = THREE.MathUtils.clamp(cameraPitch + dy * .004, .03, .7);
  activePointer.x = event.clientX; activePointer.y = event.clientY;
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(name, event => { if (event.pointerId === activePointer.id) activePointer.id = null; });
}
canvas.addEventListener('pointerup', event => { if (event.button === 2) keys.clear(); });
canvas.addEventListener('wheel', event => {
  event.preventDefault(); cameraDistance = THREE.MathUtils.clamp(cameraDistance + event.deltaY * .012, 5.5, 14);
}, { passive: false });

const joystick = document.querySelector('#joystick');
const knob = document.querySelector('#joystick-knob');
function updateJoystick(event) {
  const r = joystick.getBoundingClientRect();
  const dx = event.clientX - (r.left + r.width / 2), dy = event.clientY - (r.top + r.height / 2);
  const length = Math.hypot(dx, dy), max = 29, factor = length > max ? max / length : 1;
  joy.x = dx * factor / max; joy.y = dy * factor / max;
  knob.style.transform = `translate(${joy.x * max}px, ${joy.y * max}px)`;
}
joystick.addEventListener('pointerdown', event => { sound.unlock(); joy.pointer = event.pointerId; joystick.setPointerCapture(event.pointerId); updateJoystick(event); });
joystick.addEventListener('pointermove', event => { if (joy.pointer === event.pointerId) updateJoystick(event); });
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  joystick.addEventListener(name, event => { if (joy.pointer === event.pointerId) { joy.pointer = null; joy.x = joy.y = 0; knob.style.transform = ''; } });
}
document.querySelector('#jump-button').addEventListener('pointerdown', event => { event.preventDefault(); sound.unlock(); jumpQueued = true; });

function collides(x, z) {
  if (Math.abs(x) > MAP.size / 2 - 2 || Math.abs(z) > MAP.size / 2 - 2) return true;
  for (const obstacle of world.obstacles) {
    const dx = x - obstacle.x, dz = z - obstacle.z;
    if (dx * dx + dz * dz < (obstacle.radius + .19) ** 2) return true;
  }
  return false;
}

function onPath(x, z) {
  for (const path of MAP.paths) {
    for (let i = 1; i < path.points.length; i++) {
      const [ax, az] = path.points[i - 1], [bx, bz] = path.points[i];
      const dx = bx - ax, dz = bz - az;
      const along = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      if (Math.hypot(x - ax - along * dx, z - az - along * dz) < path.width * .55) return true;
    }
  }
  return false;
}

function update(dt, time) {
  const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - joy.y;
  const turn = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + joy.x;
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 8.2 : 5.05;
  const oldX = avatar.position.x, oldZ = avatar.position.z;
  const beforeWater = riverAt(oldX, oldZ);
  const immersion = THREE.MathUtils.clamp((beforeWater.surfaceY - avatar.position.y) / .65, 0, 1);
  const motion = tankStep(avatar.rotation.y, forward, turn, speed * (1 - .42 * immersion), dt);
  avatar.rotation.y = motion.facing;
  // Shallow water slows walking and carries the player along the curved channel.
  const flow = 1.05 * immersion * dt;
  const dx = motion.dx + beforeWater.currentX * flow;
  const dz = motion.dz + beforeWater.currentZ * flow;
  if (!collides(avatar.position.x + dx, avatar.position.z)) avatar.position.x += dx;
  if (!collides(avatar.position.x, avatar.position.z + dz)) avatar.position.z += dz;
  const movedX = avatar.position.x - oldX, movedZ = avatar.position.z - oldZ;
  const movedDistance = Math.hypot(movedX, movedZ);
  const walking = Math.abs(forward) > .05 && movedDistance > .0001;
  const water = riverAt(avatar.position.x, avatar.position.z);
  const inWater = water.depth > .08 && avatar.position.y < water.surfaceY + .1;
  const surface = inWater ? 'water' : onPath(avatar.position.x, avatar.position.z) ? 'path' : 'grass';
  if (walking) {
    walkClock += movedDistance * 2.2 * (forward < 0 ? -1 : 1);
    stepDistance += movedDistance;
    if (grounded && stepDistance > 1.32) {
      stepDistance %= 1.32;
      sound.step(surface, speed > 6);
    }
  }
  else if (Math.abs(turn) > .05) walkClock += dt * 4 * Math.sign(turn);
  character.animate(walking ? 1 : Math.abs(turn) > .05 ? .38 : 0, walkClock, time);
  const ground = heightAt(avatar.position.x, avatar.position.z);
  if (jumpQueued && grounded) { verticalSpeed = inWater ? 6.2 : 7.1; grounded = false; sound.jump(); }
  jumpQueued = false;
  if (!grounded) {
    const submerged = water.depth > .08 && avatar.position.y < water.surfaceY;
    verticalSpeed -= (submerged ? 11 : 19) * dt;
    avatar.position.y += verticalSpeed * dt;
  }
  else avatar.position.y = ground;
  if (avatar.position.y <= ground) {
    const landingSurface = water.depth > .08 && ground < water.surfaceY + .1 ? 'water' : surface;
    if (!grounded && verticalSpeed < -1 && (landingSurface !== 'water' || wasInWater)) sound.land(landingSurface);
    avatar.position.y = ground; verticalSpeed = 0; grounded = true;
  }
  // 在垂直移动之后检查穿过水面：步行、从岸上跳入和水中跳起再落下都能触发。
  const touchingWater = water.depth > .08 && avatar.position.y < water.surfaceY + (wasInWater ? .18 : .08);
  if (touchingWater && !wasInWater) sound.splash();
  wasInWater = touchingWater;
  world.moving.forEach(m => m.rotation.z = time * .45);
  for (const bird of world.birds) {
    const pose = birdFlight(bird, time);
    bird.group.position.set(pose.x, pose.y, pose.z);
    bird.group.rotation.set(pose.pitch, pose.heading, pose.bank);
    for (const { pivot, wrist, side } of bird.wings) {
      pivot.rotation.z = side * (pose.flap + pose.bank * side * .12);
      pivot.rotation.y = -side * pose.sweep;
      wrist.rotation.z = side * pose.wrist;
      wrist.rotation.y = -side * pose.sweep * .7;
    }
    bird.tailRig.rotation.x = pose.tail;
    for (const { mesh, side } of bird.tails) mesh.rotation.y = side * pose.fan;
  }
  animateSleepers(world.sleepers, time);
  animateRiver(world.ripples, time);
  sound.tick(time, avatar.position.x, avatar.position.z, water.proximity, world.birds);
  world.cloudRig.position.set(avatar.position.x, 0, avatar.position.z);

  target.set(avatar.position.x, avatar.position.y + 1.35, avatar.position.z);
  camera.position.set(
    target.x + Math.sin(cameraYaw) * Math.cos(cameraPitch) * cameraDistance,
    target.y + Math.sin(cameraPitch) * cameraDistance,
    target.z + Math.cos(cameraYaw) * Math.cos(cameraPitch) * cameraDistance,
  );
  camera.lookAt(target);
}

target.set(avatar.position.x, avatar.position.y + 1.35, avatar.position.z);
camera.position.set(target.x + Math.sin(cameraYaw) * Math.cos(cameraPitch) * cameraDistance,
  target.y + Math.sin(cameraPitch) * cameraDistance,
  target.z + Math.cos(cameraYaw) * Math.cos(cameraPitch) * cameraDistance);
camera.lookAt(target);
function frame() {
  const dt = Math.min(clock.getDelta(), .05), time = clock.elapsedTime;
  update(dt, time);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
