// WDGTA Studio — MP4 exporter.
// Draws every frame with the same renderer as the preview, encodes with the browser's
// built-in video/audio encoders (WebCodecs) and packs the result into an .mp4 file.

import { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } from './vendor/mp4-muxer.mjs';
import { drawFrame } from './render.js';

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
 *   cards, style, fmt, audioBuffer (AudioBuffer, ideally 48 kHz), writable (FileSystemWritableFileStream|null),
 *   onProgress(fraction), signal (AbortSignal)
 * @returns {Promise<{blob?: Blob, audioCodec: string}>}
 */
export async function renderMp4({ cards, style, fmt, audioBuffer, writable = null, onProgress = () => {}, signal }) {
  const W = fmt.w, H = fmt.h;
  const duration = audioBuffer.duration;
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

  // audio, fed in step with the video so the muxer can interleave
  const planes = [];
  for (let ch = 0; ch < channels; ch++) planes.push(audioBuffer.getChannelData(ch));
  const sr = audioBuffer.sampleRate, totalSamples = audioBuffer.length;
  const BLOCK = 4096;
  let aPos = 0;
  function feedAudioUntil(sec) {
    const until = Math.min(totalSamples, Math.ceil(sec * sr));
    while (aPos < until) {
      const n = Math.min(BLOCK, totalSamples - aPos);
      const data = new Float32Array(n * channels);
      for (let ch = 0; ch < channels; ch++) data.set(planes[ch].subarray(aPos, aPos + n), ch * n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round(aPos / sr * 1e6), data });
      aenc.encode(ad);
      ad.close();
      aPos += n;
    }
  }

  const nFrames = Math.ceil(duration * FPS);
  const frameDur = 1e6 / FPS;
  let lastReport = 0;
  for (let i = 0; i < nFrames; i++) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    if (failure) throw failure;
    const t = i / FPS;
    feedAudioUntil(t + 1);
    drawFrame(ctx, cards, t, fmt, style, duration);
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
  feedAudioUntil(duration + 1);
  await venc.flush();
  await aenc.flush();
  if (failure) throw failure;
  venc.close(); aenc.close();
  muxer.finalize();
  onProgress(1);

  if (writable) { await writable.close(); return { audioCodec: muxCodec, videoCodec: vCodec }; }
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), audioCodec: muxCodec, videoCodec: vCodec };
}
