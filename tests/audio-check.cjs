// Run with NODE_PATH pointing to the bundled node_modules directory.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
  let content;
  try { content = fs.readFileSync(file); } catch { res.writeHead(404).end(); return; }
  if (pathname.endsWith('.js')) content = content.toString('utf8');
  if (pathname === '/main.js') {
    content = content.replace('const sound = createAudio(MAP);', `const sound = createAudio(MAP);
      window.audioEvents = [];
      for (const name of ['splash', 'land', 'step']) {
        const original = sound[name];
        sound[name] = (...args) => { window.audioEvents.push([name, ...args]); original(...args); };
      }`);
    content += `\nwindow.gameCheck = { avatar, update, riverAt, heightAt,
      motion(y, velocity, onGround) { avatar.position.y = y; verticalSpeed = velocity; grounded = onGround; },
      resetWater() { wasInWater = false; window.audioEvents.length = 0; } };`;
  }
  if (pathname === '/audio.js') {
    content = content.replace('return { unlock, step, jump, land, splash, tick };',
      `window.mixCheck = () => ({ context, music, ambience, landmarks, tentMusic, windmillMusic });
      return { unlock, step, jump, land, splash, tick };`);
    content = content.replace('function scheduleMusic(at, count) {',
      'function scheduleMusic(at, count) { if (window.soloMixCheck) return;');
  }
  res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.wav') ? 'audio/wav' : 'text/html');
  res.end(content);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_PATH,
    args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'warning' && message.text().includes('小溪音效')) errors.push(message.text()); });
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => !!window.gameCheck);
    await page.keyboard.press('KeyX');
    const water = await page.evaluate(() => {
      const g = window.gameCheck;
      const w = g.riverAt(-15, 17), ground = g.heightAt(-15, 17);
      g.avatar.position.x = -15; g.avatar.position.z = 17;
      g.resetWater(); g.motion(ground, 0, true); g.update(.016, 1);
      const walk = window.audioEvents.filter(e => e[0] === 'splash').length;
      g.resetWater(); g.motion(w.surfaceY + .5, -4, false);
      for (let i = 0; i < 90; i++) g.update(.016, 2 + i * .016);
      const jump = window.audioEvents.filter(e => e[0] === 'splash').length;
      g.motion(w.surfaceY + .5, -4, false); g.update(.016, 4);
      for (let i = 0; i < 90; i++) g.update(.016, 4 + i * .016);
      const reentry = window.audioEvents.filter(e => e[0] === 'splash').length;
      return { walk, jump, reentry };
    });
    assert.deepEqual(water, { walk: 1, jump: 1, reentry: 2 });
    const riverRange = await page.evaluate(() => {
      const { riverAt } = window.gameCheck;
      return { center: riverAt(-15, 17).proximity,
        near: riverAt(-15 + 3.1 + 5, 17).proximity,
        outside: riverAt(-15 + 3.1 + 10.1, 17).proximity };
    });
    assert.equal(riverRange.center, 1);
    assert.ok(riverRange.near > 0 && riverRange.near < 1);
    assert.equal(riverRange.outside, 0, 'creek is audible beyond the reduced range');
    const report = await page.evaluate(async () => {
      const { createAudio } = await import('/audio.js');
      const { MAP } = await import('/map.js');
      const { createStream } = await import('/stream-audio.js');
      const NativeOffline = window.OfflineAudioContext;
      async function render(name, map, x, z, actions = false, options = {}) {
        const duration = options.musicOnly ? 28 : 12;
        let offline, now = 0, random = 42;
        const originalRandom = Math.random;
        Math.random = () => { random = (1664525 * random + 1013904223) >>> 0; return random / 4294967296; };
        window.AudioContext = function () {
          offline = new NativeOffline(1, 44100 * duration, 44100);
          Object.defineProperty(offline, 'currentTime', { get: () => now });
          Object.defineProperty(offline, 'state', { get: () => 'running' });
          offline.resume = () => Promise.resolve();
          return offline;
        };
        const sound = createAudio(map); sound.unlock();
        const buses = window.mixCheck();
        if (options.musicOnly) buses.ambience.gain.value = 0;
        for (let i = 0; i < duration * 20; i++) {
          now = i * .05;
          sound.tick(now, x, z, actions ? 1 : 0);
          if (actions && i === 20) sound.splash();
          if (actions && i % 16 === 0) sound.step('water', true);
          if (actions && i === 60) sound.jump();
          if (actions && i === 70) sound.land('path');
        }
        const buffer = await offline.startRendering();
        Math.random = originalRandom;
        const samples = buffer.getChannelData(0);
        let energy = 0, peak = 0;
        const begin = options.musicOnly ? 44100 * 4 : 0;
        for (let i = begin; i < samples.length; i++) { energy += samples[i] ** 2; peak = Math.max(peak, Math.abs(samples[i])); }
        return { name, rms: Math.sqrt(energy / (samples.length - begin)), peak, samples };
      }
      const empty = { ...MAP, objects: [], sleepers: [], birds: [] };
      const base = await render('base', empty, 0, 0);
      const cases = [
        await render('circus', { ...empty, objects: [MAP.objects[0]] }, -21, -20),
        await render('windmill', { ...empty, objects: [MAP.objects[1]] }, 37, -24),
        await render('flowers', { ...empty, objects: [MAP.objects.find(i => i.type === 'flowerPatch')] }, -8, 6),
        await render('cat', { ...empty, sleepers: [MAP.sleepers[1]] }, 7, 10),
        await render('mouse', { ...empty, sleepers: [MAP.sleepers[0]] }, -4.5, 5),
        await render('birds', { ...empty, birds: [{ x: 0, z: 0 }] }, 0, 0),
        await render('water-actions', empty, 0, 0, true),
        await render('overlap', { ...MAP,
          objects: MAP.objects.map(i => ({ ...i, x: 0, z: 0 })),
          sleepers: MAP.sleepers.map(i => ({ ...i, x: 0, z: 0 })),
          birds: [{ x: 0, z: 0 }] }, 0, 0, true),
      ];
      const rows = cases.map(c => {
        let energy = 0;
        for (let i = 0; i < c.samples.length; i++) energy += (c.samples[i] - base.samples[i]) ** 2;
        return { name: c.name, rms: c.rms, peak: c.peak, differenceRms: Math.sqrt(energy / c.samples.length) };
      });
      // Leaving a flower patch must not leave its bell bus audible.
      const far = await render('far-flowers', { ...empty, objects: [MAP.objects.find(i => i.type === 'flowerPatch')] }, 70, 70);
      let difference = 0;
      for (let i = 0; i < far.samples.length; i++) difference = Math.max(difference, Math.abs(far.samples[i] - base.samples[i]));
      const outside = [];
      for (const [item, radius] of [[MAP.objects[0], 25], [MAP.objects[1], 24]]) {
        const beyond = await render(item.type, { ...empty, objects: [item] }, item.x + radius + .1, item.z);
        let maxDifference = 0;
        for (let i = 0; i < beyond.samples.length; i++) maxDifference = Math.max(maxDifference, Math.abs(beyond.samples[i] - base.samples[i]));
        outside.push({ type: item.type, maxDifference });
      }
      const theme = await render('theme', empty, 0, 0, false, { musicOnly: true });
      const musicLevels = [];
      for (const item of [MAP.objects[0], MAP.objects[1]]) {
        const close = await render(item.type, { ...empty, objects: [item] }, item.x + 3, item.z, false, { musicOnly: true });
        musicLevels.push({ type: item.type, themeRms: theme.rms, closeRms: close.rms, differenceDb: 20 * Math.log10(close.rms / theme.rms) });
      }
      const streamContext = new NativeOffline(2, 22050 * 42, 22050);
      streamContext.decodeAudioData = () => { throw new Error('creek must not decode recordings'); };
      const originalFetch = window.fetch;
      window.fetch = () => { throw new Error('creek must not fetch audio'); };
      const streamLevel = streamContext.createGain(); streamLevel.gain.value = .2 * .72;
      streamLevel.connect(streamContext.destination);
      await createStream(streamContext, streamLevel);
      window.fetch = originalFetch;
      const stream = (await streamContext.startRendering()).getChannelData(0);
      let streamEnergy = 0, streamPeak = 0;
      for (const sample of stream) { streamEnergy += sample ** 2; streamPeak = Math.max(streamPeak, Math.abs(sample)); }
      const windowRms = [];
      for (let i = 22050; i < 22050 * 19; i += 11025) {
        let energy = 0;
        for (let j = i; j < i + 11025; j++) energy += stream[j] ** 2;
        windowRms.push(Math.sqrt(energy / 11025));
      }
      const streamStats = { rms: Math.sqrt(streamEnergy / stream.length), peak: streamPeak,
        minWindow: Math.min(...windowRms), maxWindow: Math.max(...windowRms),
        loopJump: Math.abs(stream[22050 * 24] - stream[22050 * 24 - 1]) };
      const transitions = [];
      window.soloMixCheck = true;
      for (const item of [MAP.objects[0], MAP.objects[1]]) {
        let now = 0;
        const offline = new NativeOffline(1, 44100 * 12, 44100);
        window.AudioContext = function () {
          Object.defineProperty(offline, 'currentTime', { get: () => now });
          Object.defineProperty(offline, 'state', { get: () => 'running' });
          offline.resume = () => Promise.resolve(); return offline;
        };
        const sound = createAudio({ ...empty, objects: [item] }); sound.unlock();
        const buses = window.mixCheck();
        buses.music.gain.value = 0; buses.ambience.gain.value = 0;
        const carrier = offline.createOscillator(); carrier.frequency.value = 500;
        const volume = offline.createGain(); volume.gain.value = .04;
        carrier.connect(volume).connect(item.type === 'tent' ? buses.tentMusic : buses.windmillMusic);
        carrier.start();
        for (let i = 0; i < 240; i++) {
          now = i * .05;
          const distance = now >= 1 && now < 6 ? 3 : 30;
          sound.tick(now, item.x + distance, item.z);
        }
        const data = (await offline.startRendering()).getChannelData(0);
        const rmsAt = start => {
          let energy = 0;
          const a = Math.round(start * 44100), b = Math.round((start + .2) * 44100);
          for (let i = a; i < b; i++) energy += data[i] ** 2;
          return Math.sqrt(energy / (b - a));
        };
        const steady = rmsAt(5.5);
        transitions.push({ type: item.type, attackRatio: rmsAt(1.2) / steady,
          fadeRatio: rmsAt(6.2) / steady, tailRatio: rmsAt(10.5) / steady });
      }
      window.soloMixCheck = false;
      return { base: { rms: base.rms, peak: base.peak }, rows, farDifference: difference, outside, musicLevels, streamStats, transitions };
    });
    console.log(JSON.stringify({ water, ...report }, null, 2));
    assert.equal(errors.length, 0, errors.join('\n'));
    for (const row of report.rows) {
      if (['cat', 'mouse', 'flowers'].includes(row.name)) {
        assert.ok(row.differenceRms < .00001, `${row.name} still makes sound`);
      } else {
        assert.ok(row.differenceRms > (row.name === 'circus' ? .003 : .006), `${row.name} is too quiet: ${row.differenceRms}`);
      }
      assert.ok(row.peak < .95, `${row.name} clips: ${row.peak}`);
    }
    assert.ok(report.farDifference < .00001, 'distant flowers leak into mix');
    for (const outside of report.outside) assert.ok(outside.maxDifference < .00001, `${outside.type} exceeds reduced radius`);
    for (const level of report.musicLevels) assert.ok(Math.abs(level.differenceDb) < 1.5, `${level.type} music differs from theme by ${level.differenceDb} dB`);
    assert.ok(report.streamStats.rms > .002 && report.streamStats.rms < .012, 'quiet creek level does not fit mix');
    assert.ok(report.streamStats.peak < .2, 'creek contains excessive peaks');
    assert.ok(report.streamStats.maxWindow / report.streamStats.minWindow < 2, 'creek surges too much');
    assert.ok(report.streamStats.loopJump < .03, 'creek loop has an audible discontinuity');
    for (const transition of report.transitions) {
      assert.ok(transition.attackRatio > .03 && transition.attackRatio < .35, `${transition.type} fades in too quickly`);
      assert.ok(transition.fadeRatio > .5, `${transition.type} cuts off too quickly`);
      assert.ok(transition.tailRatio < .04, `${transition.type} never fades out`);
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
