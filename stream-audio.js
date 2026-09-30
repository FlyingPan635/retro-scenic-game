// Procedural creek: fine turbulent flow and tiny damped bubble resonances.
// All samples are calculated locally, without recordings or audio decoding.
export function createStream(context, destination) {
  const rate = context.sampleRate, seconds = 24, blend = Math.round(rate * .25);
  const length = Math.round(rate * seconds);
  const buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    let seed = 0x71a4e39 + channel * 9137;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const flow = new Float32Array(length + blend);
    const bubbleTexture = new Float32Array(length + blend);
    const fineRate = 1 - Math.exp(-2 * Math.PI * 4600 / rate);
    const bodyRate = 1 - Math.exp(-2 * Math.PI * 480 / rate);
    let fine = 0, body = 0, grain = .6, grainTarget = .6;
    for (let i = 0; i < flow.length; i++) {
      fine += fineRate * (random() * 2 - 1 - fine);
      body += bodyRate * (fine - body);
      if (i % Math.round(rate * .035) === 0) grainTarget = .45 + .35 * random();
      grain += (grainTarget - grain) / (rate * .012);
      // Light fine-grained flow, without a slow surf envelope.
      flow[i] = .075 * (fine - body) * grain;
    }
    function bubbles(density, deep) {
      let at = random() / density;
      while (at < flow.length / rate) {
        const frequency = deep ? 380 + 650 * random() : 1100 + 2800 * random() ** 1.6;
        const duration = deep ? .055 + .065 * random() : .018 + .035 * random();
        const amplitude = deep ? .012 + .022 * random() : .012 + .028 * random();
        const rise = .06 + .12 * random();
        const start = Math.floor(at * rate), count = Math.ceil(duration * rate);
        let phase = random() * Math.PI * 2;
        for (let i = 0; i < count && start + i < flow.length; i++) {
          const age = i / rate, progress = age / duration;
          phase += 2 * Math.PI * frequency * (1 + rise * (1 - Math.exp(-age / .012))) / rate;
          const envelope = (1 - Math.exp(-age / .001)) * Math.exp(-6 * progress) * (1 - progress);
          bubbleTexture[start + i] += amplitude * envelope * (Math.sin(phase) + .12 * Math.sin(phase * 2));
        }
        // Independent arrivals overlap into a trickle, without a beat or melody.
        at += -Math.log(Math.max(.00001, 1 - random())) / density;
      }
    }
    // 少量轻气泡点缀细流，避免密集的汽水冒泡感。
    bubbles(22, false);
    bubbles(2, true);
    const samples = buffer.getChannelData(channel);
    let referenceEnergy = 0, referencePeak = 0, flowEnergy = 0, bubbleEnergy = 0;
    for (let i = 0; i < length; i++) {
      if (i < blend) {
        const angle = i / (blend - 1) * Math.PI / 2;
        flow[i] = flow[length + i] * Math.cos(angle) + flow[i] * Math.sin(angle);
        bubbleTexture[i] = bubbleTexture[length + i] * Math.cos(angle) + bubbleTexture[i] * Math.sin(angle);
      }
      flowEnergy += flow[i] ** 2;
      bubbleEnergy += bubbleTexture[i] ** 2;
      const reference = flow[i] + bubbleTexture[i];
      referenceEnergy += reference ** 2;
      referencePeak = Math.max(referencePeak, Math.abs(reference));
    }
    // Lower only the sandy bed to the bubble layer's RMS level. Keep the previous
    // normalization reference so reducing the bed does not amplify the bubbles.
    const flowLevel = Math.min(1, Math.sqrt(bubbleEnergy / flowEnergy));
    const scale = Math.min(.075 / Math.sqrt(referenceEnergy / length), .5 / referencePeak);
    for (let i = 0; i < length; i++) samples[i] = (flow[i] * flowLevel + bubbleTexture[i]) * scale;
  }
  const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
  const high = context.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 240;
  const low = context.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 5200; low.Q.value = .5;
  source.connect(high).connect(low).connect(destination);
  source.start();
}
