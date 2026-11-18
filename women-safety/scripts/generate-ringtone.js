/**
 * Generates assets/sounds/ringtone.wav — an original marimba-style ringtone
 * (synthesised here, no third-party audio). Run: node scripts/generate-ringtone.js
 */
const fs = require("fs");
const path = require("path");

const RATE = 22050;
const freq = (semitonesFromA4) => 440 * Math.pow(2, semitonesFromA4 / 12);
// Two short phrases (E5 G5 C6 G5 | E5 G5 D6 C6) then a pause, ~3 s total — loops cleanly.
const notes = [
  [7, 0.0], [10, 0.16], [15, 0.32], [10, 0.48],
  [7, 0.8], [10, 0.96], [17, 1.12], [15, 1.28],
];
const LENGTH_S = 3.0;
const samples = new Float32Array(Math.round(RATE * LENGTH_S));

for (const [semi, start] of notes) {
  const f = freq(semi);
  const begin = Math.round(start * RATE);
  const dur = Math.round(0.45 * RATE);
  for (let i = 0; i < dur && begin + i < samples.length; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 9); // fast attack, marimba-like decay
    // fundamental + soft 4th harmonic gives a wooden mallet tone
    const v = Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 4 * t) * Math.exp(-t * 30);
    samples[begin + i] += 0.45 * env * v;
  }
}

const data = Buffer.alloc(samples.length * 2);
samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write("data", 36); header.writeUInt32LE(data.length, 40);
const out = path.join(__dirname, "..", "assets", "sounds", "ringtone.wav");
fs.writeFileSync(out, Buffer.concat([header, data]));
console.log(`wrote ${out} (${(header.length + data.length) / 1024 | 0} KB)`);
