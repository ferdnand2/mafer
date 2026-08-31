// Motor de partitura ABC: renderiza la notación, sintetiza el audio con
// abcjs y sincroniza el teclado (rojo = mano derecha / voz V:1, azul =
// mano izquierda / voz V:2) mientras suena la pieza.
'use strict';

class AbcEngine {
  constructor({ scoreEl, keyboard, onStatusChange }) {
    this.scoreEl = scoreEl;
    this.keyboard = keyboard;
    this.onStatusChange = onStatusChange || (() => {});

    this.visualObj = null;
    this.abcString = '';
    this.audioContext = null;
    this.synth = null;

    this.tracks = []; // [{ index, notes: [{start, duration, midi}] }]
    this._handMode = 'pitch';
    this.baseQpm = 100;
    this.tempoPercent = 100;
    this.totalDuration = 0;

    this.isPlaying = false;
    this.isPaused = false;
    this._clockOrigin = 0;
    this._pausedAtSeconds = 0;
    this._rafId = null;
    this._activeSets = null;

    this._runLoop = this._runLoop.bind(this);
  }

  /** Renderiza el ABC en pantalla y prepara las pistas para reproducir. */
  render(abcString) {
    this.stop();
    this.scoreEl.innerHTML = '';
    let result;
    try {
      result = abcjs.renderAbc(this.scoreEl, abcString, { responsive: 'resize' });
    } catch (err) {
      throw new Error(`No se pudo interpretar el código ABC: ${err.message || err}`);
    }
    this.visualObj = result && result[0];
    if (!this.visualObj) throw new Error('El código ABC no produjo ninguna partitura.');
    this.abcString = abcString;
    // Nota: no reseteamos tempoPercent aquí a propósito, así una edición en
    // vivo del texto (auto-render mientras se escribe) no te cambia el
    // tempo que ya habías elegido con el control. Usa resetTempo() al
    // cargar una pieza distinta desde cero.
    this.baseQpm = (this.visualObj.metaText && this.visualObj.metaText.tempo && this.visualObj.metaText.tempo.qpm) || 100;
    this._buildTracks();
    const warnings = this.visualObj.warnings || [];
    return { visualObj: this.visualObj, warnings, pitchRange: this._pitchRange() };
  }

  _pitchRange() {
    const pitches = this.tracks.flatMap((t) => t.notes.map((n) => n.midi));
    if (pitches.length === 0) return null;
    return { min: Math.min(...pitches), max: Math.max(...pitches) };
  }

  _effectiveQpm() {
    return Math.max(10, Math.round(this.baseQpm * (this.tempoPercent / 100)));
  }

  _buildTracks() {
    const qpm = this._effectiveQpm();
    const flattened = this.visualObj.setUpAudio({ qpm });
    // setUpAudio() da los tiempos en fracciones de redonda (negra = 0.25),
    // no en segundos: hay que convertirlos usando el tempo real (qpm).
    const tempo = flattened.tempo || qpm;
    const toSeconds = (wholeNoteFraction) => (wholeNoteFraction * 240) / tempo;
    const rawTracks = (flattened && flattened.tracks) || [];
    this.tracks = rawTracks.map((events, index) => ({
      index,
      notes: events
        .filter((ev) => ev.cmd === 'note' && typeof ev.pitch === 'number')
        .map((ev) => ({ start: toSeconds(ev.start), duration: toSeconds(ev.duration), midi: ev.pitch })),
    }));
    const tracksWithNotes = this.tracks.filter((t) => t.notes.length > 0);
    this._handMode = tracksWithNotes.length >= 2 ? 'voice' : 'pitch';
    const noteBasedTotal = Math.max(0, ...this.tracks.flatMap((t) => t.notes.map((n) => n.start + n.duration)));
    this.totalDuration = Math.max(toSeconds(flattened.totalDuration || 0), noteBasedTotal);
    this._activeSets = this.tracks.map(() => new Set());
  }

  _handForNote(trackIndex, midi) {
    if (this._handMode === 'voice') return trackIndex === 0 ? HAND.RIGHT : HAND.LEFT;
    return midi >= HAND_SPLIT_MIDI_THRESHOLD ? HAND.RIGHT : HAND.LEFT;
  }

  async _ensureAudioContext() {
    if (!this.audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
  }

  async _startFrom(startSeconds) {
    await this._ensureAudioContext();
    this.synth = new abcjs.synth.CreateSynth();
    await this.synth.init({
      visualObj: this.visualObj,
      audioContext: this.audioContext,
      options: { qpm: this._effectiveQpm() },
    });
    await this.synth.prime();
    if (startSeconds > 0.01 && this.totalDuration > 0) {
      this.synth.seek(clamp(startSeconds / this.totalDuration, 0, 1), 'percent');
    }
    this.synth.start();
    this.isPlaying = true;
    this.isPaused = false;
    // Usamos el reloj del propio AudioContext (la misma base de tiempo que
    // usa el audio real) en vez de performance.now(), para que el teclado
    // no se desincronice del sonido.
    this._clockOrigin = this.audioContext.currentTime - startSeconds;
    this._runLoop();
    this.onStatusChange('playing');
  }

  _currentSeconds() {
    return clamp(this.audioContext.currentTime - this._clockOrigin, 0, this.totalDuration);
  }

  async play() {
    if (!this.visualObj) return;
    if (this.isPaused) return this.resume();
    if (this.isPlaying) return;
    await this._startFrom(0);
  }

  resume() {
    if (!this.isPaused || !this.synth) return;
    this.synth.resume();
    this._clockOrigin = this.audioContext.currentTime - this._pausedAtSeconds;
    this.isPaused = false;
    this.isPlaying = true;
    this._runLoop();
    this.onStatusChange('playing');
  }

  pause() {
    if (!this.isPlaying || this.isPaused) return;
    this.synth && this.synth.pause();
    this.isPaused = true;
    this._pausedAtSeconds = this._currentSeconds();
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.onStatusChange('paused');
  }

  /** Corta la reproducción y apaga el teclado, sin volver a sonar sola. */
  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    if (this.synth) {
      try { this.synth.stop(); } catch (err) { /* ya estaba parado */ }
    }
    this.isPlaying = false;
    this.isPaused = false;
    this._pausedAtSeconds = 0;
    if (this.keyboard) this.keyboard.allNotesOff();
    this._activeSets = this.tracks.map(() => new Set());
  }

  /** Vuelve al principio y arranca a tocar de nuevo. */
  async restart() {
    this.stop();
    this.onStatusChange('stopped');
    await this.play();
  }

  /** Vuelve el tempo a 100% (llamar antes de render() al cargar una pieza nueva). */
  resetTempo() {
    this.tempoPercent = 100;
  }

  async setTempoPercent(percent) {
    const newPercent = clamp(Math.round(percent), 40, 200);
    if (newPercent === this.tempoPercent) return;
    const wasPlaying = this.isPlaying;
    const wasPaused = this.isPaused;
    let posFraction = 0;
    if ((wasPlaying || wasPaused) && this.totalDuration > 0) {
      posFraction = clamp(this._currentSeconds() / this.totalDuration, 0, 1);
    }
    if (wasPlaying || wasPaused) this.stop();
    this.tempoPercent = newPercent;
    this._buildTracks();
    if (wasPlaying || wasPaused) {
      const startSeconds = posFraction * this.totalDuration;
      await this._startFrom(startSeconds);
      if (wasPaused) this.pause();
    }
  }

  _runLoop() {
    if (!this.isPlaying || this.isPaused) return;
    const t = this._currentSeconds();
    this._updateKeyboard(t);
    if (t >= this.totalDuration) {
      this._finish();
      return;
    }
    this._rafId = requestAnimationFrame(this._runLoop);
  }

  _updateKeyboard(t) {
    this.tracks.forEach((track, idx) => {
      const activeSet = this._activeSets[idx];
      const shouldBeOn = new Set();
      for (const note of track.notes) {
        if (note.start <= t && t < note.start + note.duration) shouldBeOn.add(note);
      }
      for (const note of activeSet) {
        if (!shouldBeOn.has(note)) {
          this.keyboard.noteOff(note.midi, this._handForNote(idx, note.midi));
          activeSet.delete(note);
        }
      }
      for (const note of shouldBeOn) {
        if (!activeSet.has(note)) {
          this.keyboard.noteOn(note.midi, this._handForNote(idx, note.midi));
          activeSet.add(note);
        }
      }
    });
  }

  _finish() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this.isPlaying = false;
    this.isPaused = false;
    if (this.keyboard) this.keyboard.allNotesOff();
    this._activeSets = this.tracks.map(() => new Set());
    this.onStatusChange('finished');
  }

  /** Genera los bytes MIDI (estándar) de la pieza actual como Blob descargable. */
  getMidiBlob() {
    if (!this.visualObj) return null;
    // Pasamos el objeto ya parseado (no el texto ABC) para que abcjs nos
    // devuelva directamente el Uint8Array de esa única tonada, sin
    // envolverlo en un array por tonada como hace con una fuente de texto.
    const bytes = abcjs.synth.getMidiFile(this.visualObj, { midiOutputType: 'binary' });
    return new Blob([bytes], { type: 'audio/midi' });
  }
}
