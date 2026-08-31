// Motor de partitura ABC: renderiza la notación, sintetiza el audio con
// abcjs y sincroniza el teclado (rojo = mano derecha / voz V:1, azul =
// mano izquierda / voz V:2) mientras suena la pieza.
'use strict';

class AbcEngine {
  constructor({ scoreEl, keyboard, onStatusChange, onNoteClick }) {
    this.scoreEl = scoreEl;
    this.keyboard = keyboard;
    this.onStatusChange = onStatusChange || (() => {});
    this.onNoteClick = onNoteClick || null;
    this._notesByStartChar = new Map();

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

    // Cursor + resaltado en rojo sobre la partitura (via abcjs.TimingCallbacks,
    // que corre en paralelo al synth — misma técnica que usa abcjs internamente
    // para sus propios ejemplos de cursor).
    this._timingCallbacks = null;
    this._highlightedElements = [];
    this._cursorEl = null;
    this._lastCursorTop = null;

    this._runLoop = this._runLoop.bind(this);
  }

  /** Renderiza el ABC en pantalla y prepara las pistas para reproducir. */
  render(abcString) {
    this.stop();
    this.scoreEl.innerHTML = '';
    // Una línea en blanco es, en el estándar ABC, el separador entre dos
    // tonadas distintas dentro de un mismo archivo. Como esta app siempre
    // edita UNA sola pieza (X:1), pero es normal separar visualmente
    // secciones largas con líneas en blanco (como haría cualquier editor
    // de texto), las quitamos antes de parsear para que no corten la
    // pieza en trozos — si no, abcjs solo interpreta hasta la primera
    // línea en blanco y descarta el resto en silencio.
    const cleanedAbc = abcString
      .split('\n')
      .filter((line) => line.trim() !== '')
      .join('\n');
    let result;
    try {
      // Volvemos a responsive (se estira para llenar el ancho de su
      // contenedor — por eso se vio "inmenso" con el .editor-panel entero
      // de ancho), pero ahora el contenedor mismo tiene un max-width en
      // el CSS (ver #score en style.css), así que "llenar el contenedor"
      // ya no significa "llenar toda la pantalla". Sin responsive, el
      // ancho de referencia queda fijo en ~740px sin importar la pantalla,
      // por eso ningún valor de scale se sentía "de verdad" ajustable.
      result = abcjs.renderAbc(this.scoreEl, cleanedAbc, {
        responsive: 'resize',
        clickListener: (abcElem) => this._handleScoreClick(abcElem),
      });
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
    // OJO: metaText.tempo NO tiene un campo `.qpm` (tiene `.bpm` y
    // `.duration`, p.ej. duration:[0.25] para "Q:1/4=90"). Hay que dejar
    // que abcjs resuelva eso a negras-por-minuto reales con getBpm(),
    // que además tiene en cuenta si el tempo se escribió respecto a otra
    // figura (p.ej. "Q:1/8=160" o "Q:160" con L: distinto de 1/4).
    this.baseQpm = typeof this.visualObj.getBpm === 'function' ? this.visualObj.getBpm() : 100;
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
    // setUpAudio() da los tiempos en fracciones de redonda, no en segundos.
    // OJO: getBpm()/qpm son "pulsos por minuto" usando como pulso la
    // duración de getBeatLength() (p.ej. una negra con puntillo = 0.375
    // en 6/8), NO siempre una negra (0.25) — por eso no se puede usar un
    // factor fijo como "240/tempo" (eso solo vale si el pulso es negra).
    // Fórmula general: segundos = fracción_de_redonda * 60 / (beatLength * qpm).
    const beatLength = this.visualObj.getBeatLength ? this.visualObj.getBeatLength() : 0.25;
    const toSeconds = (wholeNoteFraction) => (wholeNoteFraction * 60) / (beatLength * qpm);
    const rawTracks = (flattened && flattened.tracks) || [];
    this.tracks = rawTracks.map((events, index) => ({
      index,
      notes: events
        .filter((ev) => ev.cmd === 'note' && typeof ev.pitch === 'number')
        .map((ev) => ({
          start: toSeconds(ev.start),
          duration: toSeconds(ev.duration),
          midi: ev.pitch,
          startChar: ev.startChar,
        })),
    }));
    const tracksWithNotes = this.tracks.filter((t) => t.notes.length > 0);
    this._handMode = tracksWithNotes.length >= 2 ? 'voice' : 'pitch';
    const noteBasedTotal = Math.max(0, ...this.tracks.flatMap((t) => t.notes.map((n) => n.start + n.duration)));
    this.totalDuration = Math.max(toSeconds(flattened.totalDuration || 0), noteBasedTotal);
    this._activeSets = this.tracks.map(() => new Set());

    // Índice posición-en-el-texto -> midis, para saber qué nota(s) sonaban
    // en el sitio exacto donde el usuario hace clic sobre la partitura.
    this._notesByStartChar = new Map();
    for (const track of this.tracks) {
      for (const note of track.notes) {
        if (typeof note.startChar !== 'number') continue;
        if (!this._notesByStartChar.has(note.startChar)) this._notesByStartChar.set(note.startChar, []);
        this._notesByStartChar.get(note.startChar).push(note.midi);
      }
    }
  }

  _handleScoreClick(abcElem) {
    if (!this.onNoteClick || !abcElem || typeof abcElem.startChar !== 'number') return;
    const midiList = this._notesByStartChar.get(abcElem.startChar);
    if (midiList && midiList.length) this.onNoteClick([...new Set(midiList)]);
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
    this._startScoreCursor(startSeconds);
    this.onStatusChange('playing');
  }

  _startScoreCursor(startSeconds) {
    if (this._timingCallbacks) {
      try { this._timingCallbacks.stop(); } catch (err) { /* ya estaba parado */ }
    }
    this._clearScoreHighlight();
    this._cursorEl = null;
    this._lastCursorTop = null;
    this._timingCallbacks = new abcjs.TimingCallbacks(this.visualObj, {
      qpm: this._effectiveQpm(),
      eventCallback: (ev) => this._handleTimingEvent(ev),
    });
    const percent = this.totalDuration > 0 ? clamp(startSeconds / this.totalDuration, 0, 1) : 0;
    if (percent > 0) this._timingCallbacks.start(percent, 'percent');
    else this._timingCallbacks.start();
  }

  _clearScoreHighlight() {
    for (const el of this._highlightedElements) {
      if (el && el.classList) el.classList.remove('abcjs-note-playing');
    }
    this._highlightedElements = [];
  }

  _handleTimingEvent(event) {
    if (!event) {
      // Fin de la pieza: apaga el resaltado, deja el cursor donde estaba.
      this._clearScoreHighlight();
      return;
    }
    // Algunos eventos son solo "marcadores" internos de abcjs (p.ej. el
    // punto donde una nota ligada cruza una barra de compás) y no traen
    // notas nuevas: si les aplicáramos el resaltado igual, cortaríamos el
    // rojo de una nota ligada justo antes de que termine de sonar.
    if (event.elements && event.elements.length > 0) {
      this._clearScoreHighlight();
      for (const group of event.elements) {
        for (const el of group) {
          if (el && el.classList) {
            el.classList.add('abcjs-note-playing');
            this._highlightedElements.push(el);
          }
        }
      }
    }
    this._positionCursor(event);
  }

  _positionCursor(event) {
    if (event.left === null || event.left === undefined) return;
    // OJO: por defecto abcjs dibuja UN SOLO <svg> para toda la partitura
    // (todas las líneas son <g> dentro de ese mismo svg, con un único
    // sistema de coordenadas) — no un <svg> por renglón. Solo se separa en
    // varios <svg> si se pide explícitamente la opción oneSvgPerLine.
    if (!this._cursorEl) {
      const svg = this.scoreEl.querySelector('svg');
      if (!svg) return;
      this._cursorEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      this._cursorEl.setAttribute('class', 'abcjs-cursor');
      svg.appendChild(this._cursorEl);
    }
    this._cursorEl.setAttribute('x1', event.left);
    this._cursorEl.setAttribute('x2', event.left);
    this._cursorEl.setAttribute('y1', event.top);
    this._cursorEl.setAttribute('y2', event.top + event.height);

    if (event.top !== this._lastCursorTop) {
      this._lastCursorTop = event.top;
      // La partitura "sigue" el compás actual: si la pieza tiene varias
      // líneas, desplaza la página para mantener a la vista la línea que
      // suena ahora (solo al cambiar de renglón, no en cada nota).
      this._cursorEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
  }

  _stopScoreCursor() {
    if (this._timingCallbacks) {
      try { this._timingCallbacks.stop(); } catch (err) { /* ya estaba parado */ }
    }
    this._clearScoreHighlight();
    if (this._cursorEl && this._cursorEl.parentNode) this._cursorEl.parentNode.removeChild(this._cursorEl);
    this._cursorEl = null;
    this._lastCursorTop = null;
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
    if (this._timingCallbacks) this._timingCallbacks.start();
    this.onStatusChange('playing');
  }

  pause() {
    if (!this.isPlaying || this.isPaused) return;
    this.synth && this.synth.pause();
    this.isPaused = true;
    this._pausedAtSeconds = this._currentSeconds();
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._timingCallbacks) this._timingCallbacks.pause();
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
    this._stopScoreCursor();
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
    this._stopScoreCursor();
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
