const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Each bird has its own short glide between sustained bouts of powered flight.
function rhythm(bird, time) {
  const cycle = time * (.27 + .015 * Math.sin(bird.phase)) + bird.phase / TAU;
  const beat = TAU * (time * (3.65 + .3 * Math.sin(bird.phase)) + bird.phase);
  const c = ((cycle % 1) + 1) % 1;
  const power = 1 - smooth(.65, .77, c) + smooth(.9, 1, c);
  return { cycle, beat, power };
}

function path(bird, time) {
  const { cycle } = rhythm(bird, time);
  // Broad, changing arcs; never stop in midair. Speed eases through each bout.
  const a = time * bird.speed * 1.65 + bird.phase + .055 * Math.sin(TAU * cycle);
  const r = bird.radius * 1.65;
  return {
    x: bird.x + r * (Math.sin(a) + .12 * Math.sin(2 * a + bird.phase)),
    z: bird.z + r * (.8 * Math.cos(a) + .1 * Math.sin(3 * a + bird.phase)),
    y: bird.baseY + .8 * Math.sin(a * 2 + bird.phase) - .3 * Math.cos(TAU * cycle),
  };
}

export function birdFlight(bird, time) {
  const p = path(bird, time), before = path(bird, time - .025), after = path(bird, time + .025);
  const vx = (after.x - before.x) / .05, vz = (after.z - before.z) / .05;
  const vy = (after.y - before.y) / .05;
  const ax = (after.x - 2 * p.x + before.x) / (.025 ** 2);
  const az = (after.z - 2 * p.z + before.z) / (.025 ** 2);
  const speed = Math.hypot(vx, vz);
  const bank = clamp(Math.atan2((vz * ax - vx * az) / speed, 9.81), -.55, .55);
  const { beat, power } = rhythm(bird, time);
  // Faster downstroke, slower recovery; the wrist trails the shoulder.
  const phase = ((beat / TAU) % 1 + 1) % 1;
  const stroke = phase < .42
    ? Math.cos(Math.PI * phase / .42)
    : -Math.cos(Math.PI * (phase - .42) / .58);
  return {
    ...p,
    y: p.y + .035 * power * Math.sin(beat - .7),
    heading: Math.atan2(-vx, -vz),
    pitch: Math.atan2(vy, speed) + .025 * power * Math.sin(beat - .4),
    bank,
    flap: .12 + power * (.88 * stroke + .06),
    wrist: power * (.28 * Math.cos(beat - .65) + .16),
    sweep: .08 + .2 * power * (1 - stroke) / 2,
    tail: -.08 - Math.atan2(vy, speed) * .4 + .045 * Math.sin(beat - 1) * power,
    fan: .12 + Math.abs(bank) * .65 + (1 - power) * .1,
  };
}
