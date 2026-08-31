// Utilidades generales: nombres de nota, ids, descargas de archivos.
'use strict';

// El build UMD de abcjs, cargado como <script> normal (sin CommonJS/AMD),
// expone la variable global como `ABCJS` (mayúsculas), no `abcjs`. El resto
// del código de esta app usa `abcjs` en minúscula (como en la documentación
// y como haría `require('abcjs')`), así que creamos ese alias aquí, en el
// primer archivo que se carga.
if (typeof window !== 'undefined' && window.ABCJS && !window.abcjs) {
  window.abcjs = window.ABCJS;
}

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Do central (C4) = MIDI 60. Umbral por defecto para separar manos cuando
// el ABC no trae voces V:1/V:2 explícitas: todo lo que sea >= UMBRAL es
// mano derecha (rojo), lo que quede por debajo es mano izquierda (azul).
const HAND_SPLIT_MIDI_THRESHOLD = 60;

const HAND = { RIGHT: 'right', LEFT: 'left' };

function midiToNoteName(midi) {
  const name = NOTE_NAMES_SHARP[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

function isBlackKeyMidi(midi) {
  const blacks = new Set([1, 3, 6, 8, 10]);
  return blacks.has(midi % 12);
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Dispara la descarga de un Blob con el nombre de archivo dado.
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadText(text, filename, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

function sanitizeFilename(name) {
  return (name || 'pieza').trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'pieza';
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const DEFAULT_ABC_TEMPLATE = `X:1
T:Escala de Do
M:4/4
L:1/4
Q:1/4=90
K:C
V:1 clef=treble name="Mano derecha"
V:2 clef=bass name="Mano izquierda"
V:1
C D E F | G A B c |
V:2
C, D, E, F, | G, A, B, C |
`;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
