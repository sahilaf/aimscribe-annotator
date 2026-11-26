// Audio download with progress, and waveform peaks.
// WAV peaks are read straight from the PCM bytes: decoding a 15-minute file with Web Audio would
// resample it to 48 kHz floats (~170 MB), too much for a phone. Other formats fall back to an
// 8 kHz OfflineAudioContext decode.

/** Read a fetch Response into an ArrayBuffer, reporting progress (0..1). */
export async function readWithProgress(res, total, onProgress) {
  const len = +res.headers.get("content-length") || total || 0;
  if (!res.body || !res.body.getReader) {
    const buf = await res.arrayBuffer();
    onProgress?.(1);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (len) onProgress?.(Math.min(1, got / len), got);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  onProgress?.(1, got);
  return out.buffer;
}

/** RIFF/WAVE header -> {format, channels, sampleRate, bits, dataOffset, dataLength} or null. */
export function parseWav(buf) {
  if (buf.byteLength < 44) return null;
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let o = 12, fmt = null;
  while (o + 8 <= buf.byteLength) {
    const id = tag(o), size = v.getUint32(o + 4, true);
    if (id === "fmt ") {
      let format = v.getUint16(o + 8, true);
      if (format === 0xfffe && size >= 26) format = v.getUint16(o + 32, true); // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, channels: v.getUint16(o + 10, true), sampleRate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    } else if (id === "data" && fmt) {
      const avail = buf.byteLength - (o + 8);
      const dataLength = size === 0 || size === 0xffffffff || size > avail ? avail : size;
      return { ...fmt, dataOffset: o + 8, dataLength };
    }
    o += 8 + size + (size & 1);
  }
  return null;
}

/** Peak amplitude (0..1) per 1/perSec seconds, first channel. */
export function wavPeaks(buf, info, perSec = 100) {
  const { format, channels, sampleRate, bits, dataOffset, dataLength } = info;
  const bytes = bits / 8;
  const frames = Math.floor(dataLength / (bytes * channels));
  const step = Math.max(1, Math.round(sampleRate / perSec));
  const n = Math.ceil(frames / step);
  const peaks = new Float32Array(n);
  let read;
  if (format === 1 && bits === 16 && dataOffset % 2 === 0) {
    const a = new Int16Array(buf, dataOffset, frames * channels);
    read = (f) => a[f * channels] / 32768;
  } else if (format === 3 && bits === 32 && dataOffset % 4 === 0) {
    const a = new Float32Array(buf, dataOffset, frames * channels);
    read = (f) => a[f * channels];
  } else {
    const v = new DataView(buf, dataOffset);
    const fb = bytes * channels;
    if (format === 1 && bits === 8) read = (f) => (v.getUint8(f * fb) - 128) / 128;
    else if (format === 1 && bits === 16) read = (f) => v.getInt16(f * fb, true) / 32768;
    else if (format === 1 && bits === 24) read = (f) => ((v.getUint8(f * fb + 2) << 24) | (v.getUint8(f * fb + 1) << 16) | (v.getUint8(f * fb) << 8)) / 2147483648;
    else if (format === 1 && bits === 32) read = (f) => v.getInt32(f * fb, true) / 2147483648;
    else if (format === 3 && bits === 32) read = (f) => v.getFloat32(f * fb, true);
    else return null;
  }
  for (let i = 0; i < n; i++) {
    let m = 0;
    const end = Math.min(frames, (i + 1) * step);
    for (let f = i * step; f < end; f++) {
      const x = read(f);
      if (x > m) m = x;
      else if (-x > m) m = -x;
    }
    peaks[i] = m;
  }
  return { peaks, perSec: sampleRate / step, duration: frames / sampleRate };
}

/** Fallback for mp3/m4a/ogg: decode at 8 kHz. May fail on very long files; playback still works. */
export async function decodedPeaks(buf, perSec = 100) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx(1, 1, 8000);
  const ab = await new Promise((res, rej) => {
    const p = ctx.decodeAudioData(buf, res, rej);
    if (p && p.then) p.then(res, rej);
  });
  const x = ab.getChannelData(0);
  const step = Math.max(1, Math.round(ab.sampleRate / perSec));
  const n = Math.ceil(x.length / step);
  const peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step, e = Math.min(x.length, j + step); j < e; j++) {
      const a = Math.abs(x[j]);
      if (a > m) m = a;
    }
    peaks[i] = m;
  }
  return { peaks, perSec: ab.sampleRate / step, duration: ab.duration };
}

/** ArrayBuffer -> {url (blob: for <audio>), peaks?}. The buffer is not kept: audio stays in memory only. */
export async function prepareAudio(buf, mimeType) {
  const blob = new Blob([buf], { type: mimeType || "audio/wav" });
  const url = URL.createObjectURL(blob);
  let peaks = null;
  const info = parseWav(buf);
  try {
    peaks = info ? wavPeaks(buf, info) : await decodedPeaks(buf);
  } catch (e) {
    console.warn("waveform unavailable", e);
  }
  // Normalise so quiet recordings are still visible (the data has two loudness groups).
  if (peaks) {
    const sorted = Float32Array.from(peaks.peaks).sort();
    const ref = sorted[Math.floor(sorted.length * 0.995)] || 1;
    for (let i = 0; i < peaks.peaks.length; i++) peaks.peaks[i] = Math.min(1, peaks.peaks[i] / ref);
  }
  return { url, peaks, wav: info };
}

/** A synthetic speech-like WAV for the demo: voiced bursts per segment, pitch by speaker. */
export function synthWav(segments, duration, sampleRate = 16000) {
  const n = Math.ceil(duration * sampleRate);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  const pcm = new Int16Array(buf, 44, n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) pcm[i] = rnd() * 150; // room noise
  const pitch = { S1: 125, S2: 215, S3: 175 };
  for (const s of segments) {
    if (s.start == null || s.end == null) continue;
    const f0 = pitch[s.speaker] || 160;
    const a = Math.floor(s.start * sampleRate), b = Math.min(n, Math.floor(s.end * sampleRate));
    for (let i = a; i < b; i++) {
      const t = i / sampleRate;
      const syl = Math.max(0, Math.sin(2 * Math.PI * 3.6 * (t - s.start))) ** 0.6; // syllable rhythm
      const edge = Math.min(1, (t - s.start) * 20, (s.end - t) * 20);
      const f = f0 * (1 + 0.08 * Math.sin(2 * Math.PI * 0.7 * t));
      let x = 0;
      for (let k = 1; k <= 6; k++) x += Math.sin(2 * Math.PI * f * k * t) / k;
      pcm[i] = Math.max(-32767, Math.min(32767, pcm[i] + x * 5200 * syl * edge));
    }
  }
  return buf;
}
