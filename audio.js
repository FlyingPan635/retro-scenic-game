// 所有配乐和音效都由 Web Audio 本地计算合成；首次操作后创建 AudioContext。
import { createStream } from './stream-audio.js';

export function createAudio(map) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let context, master, effects, ambience, music, landmarks, windGain, riverGain, noiseBuffer;
  let tentMusic, windmillMusic, bladeGain, melodyGain;
  let nextMusicTime = 0, musicStep = 0;
  let nextBird = 0, birdNearby = false, bladePass = -1;
  let lastEnvironmentUpdate = -1;
  const tent = map.objects.find(item => item.type === 'tent');
  const windmill = map.objects.find(item => item.type === 'windmill');
  const chords = [
    [48, 55, 59, 64], // Cmaj7
    [45, 52, 55, 60], // Am7
    [41, 48, 52, 57], // Fmaj7
    [43, 50, 53, 59], // G7
  ];
  // 八小节的原创旋律；数字是 MIDI 音高，空位留给风和鸟鸣。
  const melody = [
    [76, 79, null, 76, 74, null, 72, null, 71, 72, null, 67, 69, null, 72, null],
    [76, null, 72, 69, null, 67, 69, null, 72, 76, null, 72, 69, null, 67, null],
    [72, 76, null, 79, 81, null, 79, null, 76, 72, null, 69, 72, null, 76, null],
    [74, 79, null, 77, 74, null, 71, null, 69, 71, null, 74, 72, null, null, null],
  ];
  const beat = 60 / 88 / 2; // 八分音符
  const midi = note => 440 * 2 ** ((note - 69) / 12);
  // 近处保留完整音量，外圈平滑淡出；建筑碰撞边界外也能听清。
  const proximity = (x, z, item, radius, inner = 0) => {
    if (!item) return 0;
    const distance = Math.hypot(x - item.x, z - item.z);
    const t = Math.max(0, Math.min(1, (radius - distance) / (radius - inner)));
    return t * t * (3 - 2 * t);
  };

  function init() {
    if (context || !AudioContextClass) return;
    context = new AudioContextClass();
    master = context.createGain(); master.gain.value = .72;
    effects = context.createGain(); effects.gain.value = 1;
    ambience = context.createGain(); ambience.gain.value = 1;
    music = context.createGain(); music.gain.value = .46;
    landmarks = context.createGain(); landmarks.gain.value = .46;
    effects.connect(master); ambience.connect(master); music.connect(master); landmarks.connect(master);
    tentMusic = context.createGain(); tentMusic.gain.value = 0; tentMusic.connect(landmarks);
    windmillMusic = context.createGain(); windmillMusic.gain.value = 0; windmillMusic.connect(landmarks);
    bladeGain = context.createGain(); bladeGain.gain.value = 0; bladeGain.connect(ambience);
    melodyGain = context.createGain(); melodyGain.gain.value = 1; melodyGain.connect(music);
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12; compressor.knee.value = 12;
    compressor.ratio.value = 4; compressor.attack.value = .006; compressor.release.value = .25;
    master.connect(compressor).connect(context.destination);

    noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const wind = context.createBufferSource(); wind.buffer = noiseBuffer; wind.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = 'lowpass'; windFilter.frequency.value = 850;
    windGain = context.createGain(); windGain.gain.value = .065;
    wind.connect(windFilter).connect(windGain).connect(ambience);
    wind.start();
    if (map.river) {
      riverGain = context.createGain(); riverGain.gain.value = 0;
      riverGain.connect(ambience);
      createStream(context, riverGain);
    }
    const gust = context.createOscillator(); gust.type = 'sine'; gust.frequency.value = .11;
    const gustDepth = context.createGain(); gustDepth.gain.value = .018;
    gust.connect(gustDepth).connect(windGain.gain); gust.start();
    nextMusicTime = context.currentTime + .08;
  }

  function unlock() {
    if (!AudioContextClass) return;
    init();
    context.resume().catch(() => {});
  }

  function ready() { return context && context.state === 'running'; }

  function tone(frequency, duration, level, when, type = 'sine', endFrequency = frequency, bus = effects, attack = .012, sustain = 0) {
    if (!ready()) return;
    const start = when ?? context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(.00011, level), start + Math.min(attack, duration / 2));
    if (sustain > 0) gain.gain.setValueAtTime(Math.max(.00011, level), start + Math.max(Math.min(attack, duration / 2), duration * sustain));
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    osc.connect(gain).connect(bus);
    osc.start(start); osc.stop(start + duration + .02);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  function noise(level, duration, cutoff, when = context.currentTime, highpass = 0, bus = effects, offset = null) {
    if (!ready()) return;
    const source = context.createBufferSource(); source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = cutoff;
    const gain = context.createGain();
    gain.gain.setValueAtTime(Math.max(.00011, level), when);
    gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
    let output = source.connect(filter);
    if (highpass) {
      const high = context.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = highpass;
      output = output.connect(high);
    }
    output.connect(gain).connect(bus);
    source.start(when, offset ?? Math.random() * (2 - duration), duration);
    source.stop(when + duration);
    source.onended = () => { source.disconnect(); filter.disconnect(); output.disconnect(); gain.disconnect(); };
  }

  function bell(note, level, when, bus = effects) {
    tone(midi(note), .68, level, when, 'sine', midi(note) * 1.003, bus);
    tone(midi(note) * 2, .24, level * .22, when, 'sine', midi(note) * 2.01, bus);
  }

  function step(surface = 'grass', running = false) {
    if (!ready()) return;
    const t = context.currentTime;
    if (surface === 'water') {
      noise(running ? .28 : .22, .24, 3200, t, 320);
      tone(420, .16, .055, t + .035, 'sine', 170);
    } else if (surface === 'path') {
      noise(running ? .16 : .125, .105, 1800, t, 240);
      tone(145, .085, .027, t, 'triangle', 90);
    } else {
      noise(running ? .19 : .145, .16, 1100, t, 90);
      tone(88, .09, .012, t, 'triangle', 62);
    }
  }
  function jump() {
    if (!ready()) return;
    const t = context.currentTime;
    tone(260, .23, .085, t, 'triangle', 520);
    noise(.055, .13, 1000, t);
  }
  function land(surface = 'grass') {
    if (!ready()) return;
    const t = context.currentTime;
    if (surface === 'water') { step('water'); return; } // 水面溅水由穿过水面时触发。
    noise(.16, .2, surface === 'path' ? 820 : 430, t);
    tone(95, .16, .03, t, 'triangle', 62);
  }
  function splash() {
    if (!ready()) return;
    const t = context.currentTime;
    noise(.48, .34, 4800, t, 300);
    noise(.2, .55, 1500, t + .06, 120);
    [620, 810, 490].forEach((frequency, i) =>
      tone(frequency, .19, .065, t + .08 + i * .07, 'sine', frequency * .42));
  }
  function bird(level) {
    const t = context.currentTime;
    tone(1250, .11, level, t, 'sine', 1780, ambience);
    tone(1600, .16, level * .8, t + .16, 'sine', 1180, ambience);
  }
  function windmillSound() {
    const t = context.currentTime;
    noise(.3, .85, 1800, t, 180, bladeGain, t % 1);
    tone(260, .3, .065, t + .17, 'triangle', 155, bladeGain);
  }
  function scheduleMusic(at, count) {
    const bar = Math.floor(count / 16) % 4;
    const eighth = count % 16;
    const chord = chords[bar];
    if (eighth === 0 || eighth === 8) {
      const notes = eighth === 0 ? chord.slice(1) : [chord[2], chord[3]];
      notes.forEach((note, i) => tone(midi(note), eighth === 0 ? 2.7 : 1.25,
        .025, at + i * .018, 'triangle', midi(note), music, .3));
      tone(midi(chord[0]), .54, .087, at, 'sine', midi(chord[0]) * .98, music, .02);
      tone(72, .15, .043, at, 'sine', 49, music); // 柔和底鼓
    }
    if (eighth === 4 || eighth === 12) noise(.035, .14, 2100, at, 550, music);
    if (eighth === 7 || eighth === 15) noise(.012, .06, 6000, at, 1800, music);
    if ([2, 6, 10, 14].includes(eighth)) {
      const note = chord[[1, 2, 3, 2][Math.floor(eighth / 4)]] + 12;
      bell(note, .023, at, music);
    }
    const note = melody[bar][eighth];
    if (note != null) bell(note, .04, at + .015, melodyGain);
    // 走近景物时，配器自然加入，不另开一首突兀的曲子。
    if (tent) {
      // 固定的两小节旋转木马乐句，音高跟随当前和弦。
      const phrase = [0, null, 1, 2, 1, null, 0, null, 2, null, 1, 0, 1, 2, 1, null];
      const degree = phrase[eighth];
      if (degree != null) {
        const f = midi(chord[degree + 1] + 12);
        // 按整段音乐响度校准：近处加入乐句后仍与主题曲接近。
        tone(f, .31, .0315, at, 'triangle', f, tentMusic, .012, .6);
        tone(f * 2, .25, .0088, at, 'sine', f * 2, tentMusic, .012, .5);
      }
    }
    if (windmill) {
      // 更舒展的笛声乐句，有明确的起伏与收尾。
      const phrase = [0, null, null, null, 1, null, 2, null, 3, null, null, null, 2, null, 1, null];
      const degree = phrase[eighth];
      if (degree != null) {
        const f = midi(chord[degree] + 24);
        tone(f, .7, .0244, at, 'sine', f, windmillMusic, .06, .65);
        tone(f * 2, .55, .0043, at, 'sine', f * 2, windmillMusic, .06, .6);
      }
    }
  }

  function tick(time, x, z, riverLevel = 0, birds = map.birds || []) {
    if (!ready()) return;
    const now = context.currentTime;
    const tentLevel = proximity(x, z, tent, 25, 6 * (tent?.scale || 1));
    const windmillLevel = proximity(x, z, windmill, 24, 4.5 * (windmill?.scale || 1));
    if (time - lastEnvironmentUpdate > .12) {
      // 声部在独立总线上连续渐变，已响起的长音也一起淡入淡出。
      // 1.2 秒时间常数约需 3.6 秒完成 95% 的变化，奔跑时也不会突然切换。
      tentMusic.gain.setTargetAtTime(tentLevel, now, 1.2);
      windmillMusic.gain.setTargetAtTime(windmillLevel, now, 1.2);
      bladeGain.gain.setTargetAtTime(.6 * windmillLevel, now, 1.2);
      windGain.gain.setTargetAtTime(.065 + windmillLevel * .035, now, 1.2);
      const focus = Math.max(tentLevel, windmillLevel);
      music.gain.setTargetAtTime(.46 - .15 * focus, now, 1.2);
      melodyGain.gain.setTargetAtTime(1 - .6 * focus, now, 1.2);
      if (riverGain) {
        const flow = Math.max(0, riverLevel) ** 1.5;
        // 小溪由细流纹理和无规则的微气泡合成，不添加海浪式的周期涨落。
        riverGain.gain.setTargetAtTime(.2 * flow, now, .65);
      }
      lastEnvironmentUpdate = time;
    }
    // 卡顿后跳过已经错过的拍子，避免把几颗过期音符挤在同一瞬间播放。
    if (nextMusicTime < now - .08) {
      const missed = Math.ceil((now + .05 - nextMusicTime) / beat);
      nextMusicTime += missed * beat;
      musicStep += missed;
    }
    while (nextMusicTime < context.currentTime + .16) {
      scheduleMusic(nextMusicTime, musicStep);
      nextMusicTime += beat;
      musicStep++;
    }
    const nearestBird = Math.max(0, ...birds.map(item => proximity(x, z, item.group?.position || item, 42, 8)));
    const nearBird = nearestBird > (birdNearby ? .06 : .12);
    if (nearBird && (!birdNearby || now >= nextBird)) {
      bird(.07 + nearestBird * .09);
      nextBird = now + 3.5 + Math.random() * 2;
    }
    birdNearby = nearBird;
    // 四片叶片，每转过四分之一圈响一次，与画面 .45 rad/s 的转速一致。
    const pass = Math.floor(time * .45 / (Math.PI / 2));
    if (windmill && pass !== bladePass) windmillSound();
    bladePass = pass;
  }

  document.addEventListener('visibilitychange', () => {
    if (!context) return;
    if (document.hidden) context.suspend().catch(() => {});
    else context.resume().catch(() => {});
  });
  return { unlock, step, jump, land, splash, tick };
}
