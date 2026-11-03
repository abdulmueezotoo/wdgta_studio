// WDGTA Studio — MP4 exporter.
// Draws every frame with the same renderer as the preview, encodes with the browser's
// built-in video/audio encoders (WebCodecs) and packs the result into an .mp4 file.

import { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } from './vendor/mp4-muxer.mjs';
import { drawFrame, drawBookend } from './render.js';
import { isSpeaking, drawSlide } from './features.js';

const FPS = 30;

export function exportSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

async function pickVideoConfig(w, h) {
  const codecs = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640032', 'avc1.42e032'];
  for (const codec of codecs) {
    for (const hw of ['prefer-hardware', 'no-preference', 'prefer-software']) {
      const cfg = { codec, width: w, height: h, bitrate: 3_000_000, bitrateMode: 'variable', framerate: FPS, hardwareAcceleration: hw, avc: { format: 'avc' } };
      try {
        const r = await VideoEncoder.isConfigSupported(cfg);
        if (r.supported) return { cfg: r.config, muxCodec: 'avc' };
      } catch { /* try next */ }
    }
  }
  // Fallback: VP9 (YouTube accepts it; some apps prefer H.264)
  for (const codec of ['vp09.00.40.08', 'vp09.00.10.08']) {
    const cfg = { codec, width: w, height: h, bitrate: 3_000_000, bitrateMode: 'variable', framerate: FPS };
    try {
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r.supported) return { cfg: r.config, muxCodec: 'vp9' };
    } catch { /* next */ }
  }
  throw new Error('This browser cannot encode video. Use the latest Chrome or Edge on a laptop or desktop.');
}

async function pickAudioConfig(sampleRate, channels) {
  const tries = [
    { codec: 'mp4a.40.2', muxCodec: 'aac', sampleRate, numberOfChannels: channels, bitrate: 160_000 },
    { codec: 'opus', muxCodec: 'opus', sampleRate: 48000, numberOfChannels: channels, bitrate: 128_000 },
  ];
  for (const t of tries) {
    if (t.muxCodec === 'opus' && sampleRate !== 48000) continue;
    const { muxCodec, ...cfg } = t;
    try {
      const r = await AudioEncoder.isConfigSupported(cfg);
      if (r.supported) return { cfg: r.config, muxCodec };
    } catch { /* next */ }
  }
  throw new Error('This browser cannot encode the audio track. Use the latest Chrome or Edge.');
}

/**
 * Render one format to MP4.
 * @param {object} o
 *   cards, style, fmt, audioBuffer (AudioBuffer, ideally 48 kHz), start/end (seconds of the recording),
 *   intro/outro (seconds of branded cards before/after; 0 = none),
 *   music ({ buffer: AudioBuffer at the same sample rate, vol 0–1, duck 0–1 } or null), speech (speaking ranges),
 *   writable (FileSystemWritableFileStream|null), onProgress(fraction), signal (AbortSignal)
 * @returns {Promise<{blob?: Blob, audioCodec: string, videoCodec: string}>}
 */
export async function renderMp4({ cards, style, fmt, audioBuffer, start = 0, end = null, intro = 0, outro = 0, music = null, speech = [], writable = null, onProgress = () => {}, signal }) {
  const W = fmt.w, H = fmt.h;
  start = Math.max(0, start);
  end = Math.min(audioBuffer.duration, end ?? audioBuffer.duration);
  const main = Math.max(0.1, end - start);
  const total = intro + main + outro;
  style = { ...style, range: { start, end } };
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const { cfg: vCfg, muxCodec: vCodec } = await pickVideoConfig(W, H);
  const { cfg: aCfg, muxCodec } = await pickAudioConfig(audioBuffer.sampleRate, channels);

  const target = writable ? new FileSystemWritableFileStreamTarget(writable) : new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: vCodec, width: W, height: H, frameRate: FPS },
    audio: { codec: muxCodec, numberOfChannels: channels, sampleRate: aCfg.sampleRate },
    fastStart: writable ? false : 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let failure = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { failure = e; } });
  venc.configure(vCfg);
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { failure = e; } });
  aenc.configure(aCfg);

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false });

  // ---- audio: voice (offset by the intro) + optional music bed that ducks under speech ----
  const sr = audioBuffer.sampleRate;
  const planes = [];
  for (let ch = 0; ch < channels; ch++) planes.push(audioBuffer.getChannelData(ch));
  const s0 = Math.floor(start * sr), mainS = Math.min(audioBuffer.length - s0, Math.round(main * sr));
  const introS = Math.round(intro * sr), totalS = Math.round(total * sr);
  const mPlanes = music && music.buffer ? Array.from({ length: channels }, (_, ch) => music.buffer.getChannelData(Math.min(ch, music.buffer.numberOfChannels - 1))) : null;
  const mLen = mPlanes ? mPlanes[0].length : 0;
  const mVol = music ? music.vol ?? 0.25 : 0, mDuck = music ? music.duck ?? 0.3 : 0;
  const aDown = 1 - Math.exp(-1 / (0.08 * sr)), aUp = 1 - Math.exp(-1 / (0.45 * sr));
  const fadeIn = sr * 1.0, fadeOut = sr * 2.0;
  let g = mVol;
  const BLOCK = 4096;
  let oPos = 0;
  function feedAudioUntil(sec) {
    const until = Math.min(totalS, Math.ceil(sec * sr));
    while (oPos < until) {
      const n = Math.min(BLOCK, until - oPos);
      const data = new Float32Array(n * channels);
      // voice
      const vFrom = Math.max(oPos, introS), vTo = Math.min(oPos + n, introS + mainS);
      if (vTo > vFrom) for (let ch = 0; ch < channels; ch++) data.set(planes[ch].subarray(s0 + vFrom - introS, s0 + vTo - introS), ch * n + (vFrom - oPos));
      // music
      if (mPlanes) {
        for (let k = 0; k < n; k++) {
          const o = oPos + k;
          if ((k & 255) === 0) {
            var tMain = start + (o - introS) / sr;
            var speaking = o >= introS && o < introS + mainS && isSpeaking(speech, tMain);
            var tgt = mVol * (speaking ? mDuck : 1);
          }
          g += (tgt - g) * (tgt < g ? aDown : aUp);
          const env = Math.min(1, o / fadeIn, (totalS - o) / fadeOut);
          const mi = o % mLen;
          for (let ch = 0; ch < channels; ch++) {
            const idx = ch * n + k;
            const v = data[idx] + mPlanes[ch][mi] * g * env;
            data[idx] = v > 1 ? 1 : v < -1 ? -1 : v;
          }
        }
      }
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round(oPos / sr * 1e6), data });
      aenc.encode(ad);
      ad.close();
      oPos += n;
    }
  }

  const nFrames = Math.ceil(total * FPS);
  const frameDur = 1e6 / FPS;
  let lastReport = 0;
  for (let i = 0; i < nFrames; i++) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    if (failure) throw failure;
    const tt = i / FPS;
    feedAudioUntil(tt + 1);
    if (tt < intro) drawBookend(ctx, fmt, 'intro', tt, intro, style);
    else if (tt < intro + main) drawFrame(ctx, cards, start + tt - intro, fmt, style);
    else drawBookend(ctx, fmt, 'outro', tt - intro - main, outro, style);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) });
    venc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    if (venc.encodeQueueSize > 8 || aenc.encodeQueueSize > 32) {
      await new Promise(r => {
        const check = () => (venc.encodeQueueSize <= 4 && aenc.encodeQueueSize <= 16) || failure ? r() : setTimeout(check, 1);
        check();
      });
    }
    const now = performance.now();
    if (now - lastReport > 120) { lastReport = now; onProgress(i / nFrames); await new Promise(r => setTimeout(r, 0)); }
  }
  feedAudioUntil(total + 1);
  await venc.flush();
  await aenc.flush();
  if (failure) throw failure;
  venc.close(); aenc.close();
  muxer.finalize();
  onProgress(1);

  if (writable) { await writable.close(); return { audioCodec: muxCodec, videoCodec: vCodec }; }
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), audioCodec: muxCodec, videoCodec: vCodec };
}

/** Render one carousel slide (1080×1350) as a PNG. */
export async function renderSlide(slide, index, total, deck) {
  const canvas = new OffscreenCanvas(1080, 1350);
  drawSlide(canvas.getContext('2d', { alpha: false }), slide, index, total, deck);
  return canvas.convertToBlob({ type: 'image/png' });
}

/** Render a single frame as a PNG (for quote cards, carousel slides, thumbnails). */
export async function renderStill({ cards, style, fmt, t, range }) {
  const canvas = new OffscreenCanvas(fmt.w, fmt.h);
  const ctx = canvas.getContext('2d', { alpha: false });
  // draw "settled" text: a moment after the screen's last word so every word is lit
  drawFrame(ctx, cards, t, fmt, { ...style, range });
  return canvas.convertToBlob({ type: 'image/png' });
}
