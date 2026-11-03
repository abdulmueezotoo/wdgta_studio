// WDGTA Studio — speech-to-text worker.
// Runs OpenAI's open-source Whisper model inside the browser (via Transformers.js).
// Audio never leaves the computer; only the model files are downloaded (once, then cached).

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js';

env.allowLocalModels = false;

const MODELS = {
  fast: ['onnx-community/whisper-tiny_timestamped', 'Xenova/whisper-tiny'],
  balanced: ['onnx-community/whisper-base_timestamped', 'Xenova/whisper-base'],
  accurate: ['onnx-community/whisper-small_timestamped', 'Xenova/whisper-small'],
};

const SR = 16000;
let cached = { key: null, asr: null, device: null };

const post = (type, data = {}) => self.postMessage({ type, ...data });

async function hasWebGPU() {
  try {
    if (!self.navigator?.gpu) return false;
    const ad = await self.navigator.gpu.requestAdapter();
    return !!ad;
  } catch { return false; }
}

async function load(quality) {
  const list = MODELS[quality] || MODELS.balanced;
  const gpu = await hasWebGPU();
  const attempts = [];
  for (const model of list) {
    if (gpu) attempts.push({ model, device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } });
    attempts.push({ model, device: 'wasm', dtype: 'q8' });
  }
  let lastErr;
  for (const a of attempts) {
    const key = a.model + '|' + a.device;
    if (cached.key === key) return cached;
    try {
      post('status', { text: `Loading speech model (${a.model.split('/')[1]}, ${a.device === 'webgpu' ? 'graphics card' : 'processor'})…` });
      const files = {};
      const asr = await pipeline('automatic-speech-recognition', a.model, {
        device: a.device,
        dtype: a.dtype,
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            files[p.file] = { loaded: p.loaded, total: p.total };
            let l = 0, t = 0;
            for (const f of Object.values(files)) { l += f.loaded; t += f.total; }
            post('download', { loaded: l, total: t });
          }
        },
      });
      cached = { key, asr, device: a.device, model: a.model };
      return cached;
    } catch (e) {
      lastErr = e;
      post('log', { text: `Could not load ${a.model} on ${a.device}: ${e?.message || e}` });
    }
  }
  throw lastErr || new Error('No speech model could be loaded.');
}

/** Split long audio into ~28s pieces, cutting at the quietest moment near each boundary. */
function splitAudio(audio) {
  const pieces = [];
  const target = 28 * SR, look = 6 * SR, win = Math.round(0.08 * SR);
  let start = 0;
  while (start < audio.length) {
    let end = Math.min(audio.length, start + target);
    if (end < audio.length) {
      let best = end, bestE = Infinity;
      for (let p = end - look; p + win <= end; p += win) {
        let e = 0;
        for (let i = p; i < p + win; i++) e += audio[i] * audio[i];
        if (e < bestE) { bestE = e; best = p + (win >> 1); }
      }
      end = best;
    }
    pieces.push({ start, end });
    start = end;
  }
  return pieces;
}

function wordsFromSegments(chunks, offset) {
  // fallback: spread words evenly (by length) across each segment
  const out = [];
  for (const c of chunks) {
    const [s, e0] = c.timestamp; const e = e0 ?? s + 2;
    const ws = c.text.trim().split(/\s+/).filter(Boolean);
    const total = ws.reduce((a, w) => a + w.length + 1, 0) || 1;
    let t = s;
    for (const w of ws) {
      const d = (e - s) * (w.length + 1) / total;
      out.push({ w, s: offset + t, e: offset + t + d }); t += d;
    }
  }
  return out;
}

async function run({ audio, quality }) {
  const m = await load(quality);
  post('status', { text: 'Listening…' });
  const pieces = splitAudio(audio);
  const words = [];
  let wordMode = true;
  for (let k = 0; k < pieces.length; k++) {
    const { start, end } = pieces[k];
    const seg = audio.subarray(start, end);
    const offset = start / SR;
    let res;
    if (wordMode) {
      try {
        res = await m.asr(seg, { language: 'english', task: 'transcribe', return_timestamps: 'word' });
        for (const c of res.chunks || []) {
          const w = c.text.trim();
          if (!w) continue;
          const [s, e] = c.timestamp;
          words.push({ w, s: offset + (s ?? 0), e: offset + (e ?? s ?? 0) });
        }
      } catch (e) {
        post('log', { text: 'Word timing not available with this model; using phrase timing. ' + (e?.message || e) });
        wordMode = false;
      }
    }
    if (!wordMode) {
      res = await m.asr(seg, { language: 'english', task: 'transcribe', return_timestamps: true });
      words.push(...wordsFromSegments(res.chunks || [{ text: res.text, timestamp: [0, seg.length / SR] }], offset));
    }
    post('progress', { done: k + 1, total: pieces.length, words: words.length });
  }
  // tidy: make timings monotonic and non-zero
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (i && w.s < words[i - 1].s) w.s = words[i - 1].s;
    if (w.e <= w.s) w.e = w.s + 0.12;
  }
  post('done', { words, model: m.model, device: m.device, wordMode });
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'run') {
    try { await run(msg); } catch (e) { post('error', { text: e?.message || String(e) }); }
  }
};
