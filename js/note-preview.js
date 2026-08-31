// Reproduce una nota suelta al hacer clic en una nota de la partitura o en
// una tecla del piano. Es independiente del motor de reproducción de la
// pieza completa (AbcEngine): usa un tono sintetizado simple con Web Audio
// para responder al instante, sin depender de la soundfont remota de abcjs.
'use strict';

class NotePreviewPlayer {
  constructor() {
    this.audioContext = null;
  }

  _ensureContext() {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext.state === 'suspended') this.audioContext.resume();
    return this.audioContext;
  }

  /** Reproduce una nota corta (o varias a la vez, si es un acorde). */
  play(midi) {
    if (!window.AudioContext && !window.webkitAudioContext) return;
    const ctx = this._ensureContext();
    const now = ctx.currentTime;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 1);

    // Un toque de armónico a la octava para que no suene tan plano.
    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.0001, now);
    gain2.gain.linearRampToValueAtTime(0.08, now + 0.008);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    gain2.connect(ctx.destination);
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, now);
    osc2.connect(gain2);
    osc2.start(now);
    osc2.stop(now + 0.6);
  }

  playChord(midiList) {
    for (const midi of midiList) this.play(midi);
  }
}
