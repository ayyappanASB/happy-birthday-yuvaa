/* ============================================================
   BIRTHDAY SONG — a soft music-box "Happy Birthday to You",
   synthesised live with Web Audio (no audio file to load).
   The melody is public domain.

   Browsers only allow sound after a user gesture, so call
   unlock() from inside a tap/click/key handler; start() can then
   be called any time afterwards. The song loops gently.
   ============================================================ */

const BPM = 104;
const BEAT = 60 / BPM;
const GAP_BEATS = 3;             // breath between repeats
const VOLUME = 0.42;

/* note name -> frequency */
const SEMI = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function freq(n){
  const m = /^([A-G]#?)(\d)$/.exec(n);
  const midi = 12 * (Number(m[2]) + 1) + SEMI[m[1]];
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* melody: [note, beats] — 3/4 with a one-beat pickup */
const MELODY = [
  ['G4', .75], ['G4', .25], ['A4', 1], ['G4', 1], ['C5', 1], ['B4', 2],
  ['G4', .75], ['G4', .25], ['A4', 1], ['G4', 1], ['D5', 1], ['C5', 2],
  ['G4', .75], ['G4', .25], ['G5', 1], ['E5', 1], ['C5', 1], ['B4', 1], ['A4', 1],
  ['F5', .75], ['F5', .25], ['E5', 1], ['C5', 1], ['D5', 1], ['C5', 3],
];
/* one chord per bar, starting after the pickup beat */
const CHORDS = [
  ['C3', 'E3', 'G3'],  // -py birth-day
  ['G2', 'D3', 'F3'],  // to you, hap-
  ['G2', 'D3', 'F3'],  // -py birth-day
  ['C3', 'E3', 'G3'],  // to you, hap-
  ['C3', 'E3', 'A#3'], // -py birth-day
  ['F2', 'C3', 'A3'],  // dear YU-VAA, hap-
  ['G2', 'D3', 'F3'],  // -py birth-day
  ['C3', 'E3', 'G3'],  // to you
];

const SONG_BEATS = MELODY.reduce((s, [, b]) => s + b, 0);

let ctx = null, master = null, bus = null;
let playing = false, muted = false, nextSongAt = 0, timer = 0;

function makeReverb(c){
  const len = Math.floor(c.sampleRate * 2.2);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++){
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  const conv = c.createConvolver(); conv.buffer = buf;
  return conv;
}

function ensure(){
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0;
  master.connect(ctx.destination);
  bus = ctx.createGain(); bus.gain.value = 1;
  const dry = ctx.createGain(); dry.gain.value = 0.8;
  const wet = ctx.createGain(); wet.gain.value = 0.32;
  const verb = makeReverb(ctx);
  bus.connect(dry).connect(master);
  bus.connect(verb).connect(wet).connect(master);
  return true;
}

/* a music-box tine: bright attack, long bell-like decay */
function tine(f, t, vel){
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  g.connect(bus);
  const partials = [[1, 1], [2, 0.32], [3, 0.1], [4.2, 0.06]];
  for (const [mult, amp] of partials){
    const o = ctx.createOscillator();
    const og = ctx.createGain(); og.gain.value = amp;
    o.type = 'sine'; o.frequency.value = f * mult;
    o.connect(og).connect(g);
    o.start(t); o.stop(t + 2.3);
  }
}

/* a soft warm pad under each bar */
function pad(notes, t, dur){
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.05, t + 0.25);
  g.gain.setValueAtTime(0.05, t + dur - 0.3);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
  g.connect(lp).connect(bus);
  for (const n of notes){
    const o = ctx.createOscillator();
    o.type = 'triangle'; o.frequency.value = freq(n);
    o.connect(g); o.start(t); o.stop(t + dur + 0.5);
  }
}

function scheduleSong(t0){
  let beat = 0;
  for (const [n, b] of MELODY){
    tine(freq(n), t0 + beat * BEAT, b < 0.5 ? 0.16 : 0.22);
    beat += b;
  }
  CHORDS.forEach((ch, i) => pad(ch, t0 + (1 + i * 3) * BEAT, 3 * BEAT));
}

/* look-ahead scheduler: queue the next repeat shortly before it is due */
function tick(){
  if (!playing) return;
  while (nextSongAt < ctx.currentTime + 1.0){
    scheduleSong(nextSongAt);
    nextSongAt += (SONG_BEATS + GAP_BEATS) * BEAT;
  }
}

function applyVolume(fade = 0.6){
  if (!ctx) return;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(muted ? 0 : VOLUME, now + fade);
}

export const music = {
  /** call inside a user-gesture handler (tap / click / key) */
  unlock(){
    if (!ensure()) return;
    if (ctx.state !== 'running') ctx.resume();
    // iOS: play one silent sample inside the gesture to fully unlock output
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
  },
  start(){
    if (playing || !ensure()) return;
    playing = true;
    nextSongAt = ctx.currentTime + 0.15;
    tick();
    timer = setInterval(tick, 250);
    applyVolume(1.2);
  },
  get started(){ return playing; },
  get muted(){ return muted; },
  setMuted(m){ muted = m; applyVolume(0.4); },
};

/* pause with the tab so it never plays from a hidden page */
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend(); else if (playing) ctx.resume();
});
