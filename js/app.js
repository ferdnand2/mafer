// Cablea la interfaz: biblioteca, pestañas, editor ABC, importación MIDI
// y controles de reproducción, apoyándose en AbcEngine/PianoKeyboard/
// PieceLibrary/midi-tools.
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const els = {
    score: document.getElementById('score'),
    abcInput: document.getElementById('abc-input'),
    abcError: document.getElementById('abc-error'),
    pieceName: document.getElementById('piece-name'),
    btnSavePiece: document.getElementById('btn-save-piece'),
    btnDownloadAbc: document.getElementById('btn-download-abc'),
    inputOpenAbc: document.getElementById('input-open-abc'),
    btnNewPiece: document.getElementById('btn-new-piece'),
    libraryList: document.getElementById('library-list'),
    tabBtns: [...document.querySelectorAll('.tab-btn')],
    tabPanels: { abc: document.getElementById('tab-abc'), midi: document.getElementById('tab-midi') },
    inputOpenMidi: document.getElementById('input-open-midi'),
    midiImportInfo: document.getElementById('midi-import-info'),
    btnConvertMidi: document.getElementById('btn-convert-midi-to-abc'),
    btnPlay: document.getElementById('btn-play'),
    btnPause: document.getElementById('btn-pause'),
    btnRestart: document.getElementById('btn-restart'),
    tempoRange: document.getElementById('tempo-range'),
    tempoValue: document.getElementById('tempo-value'),
    btnDownloadMidi: document.getElementById('btn-download-midi'),
    playbackStatus: document.getElementById('playback-status'),
    keyboardContainer: document.getElementById('keyboard-container'),
    btnHelp: document.getElementById('btn-help'),
    helpModal: document.getElementById('help-modal'),
    btnCloseHelp: document.getElementById('btn-close-help'),
    noteLogList: document.getElementById('note-log-list'),
    btnClearNoteLog: document.getElementById('btn-clear-note-log'),
  };

  const library = new PieceLibrary();
  const keyboard = new PianoKeyboard(els.keyboardContainer, { min: 48, max: 84 });
  const notePreview = new NotePreviewPlayer();

  let currentPieceId = null;
  let currentImportedMidi = null; // { base64, fileName } cuando la pieza viene de un .mid importado
  let pendingMidi = null; // { midi, base64, fileName } recién abierto en "Importar MIDI", sin convertir aún

  const engine = new AbcEngine({
    scoreEl: els.score,
    keyboard,
    onStatusChange: handleStatusChange,
    onNoteClick: (midiList) => handleNoteInteraction(midiList),
  });
  keyboard.onKeyClick = (midi) => handleNoteInteraction([midi]);

  // Toca la(s) nota(s) clicada(s) y añade su nombre a la lista de notas
  // tocadas (una debajo de otra; si es un acorde, todas las notas del clic).
  function handleNoteInteraction(midiList) {
    if (!midiList || midiList.length === 0) return;
    notePreview.playChord(midiList);
    const empty = els.noteLogList.querySelector('.note-log-empty');
    if (empty) empty.remove();
    for (const midi of midiList) {
      const entry = document.createElement('div');
      entry.className = 'note-log-entry';
      entry.textContent = midiToDisplayName(midi);
      els.noteLogList.appendChild(entry);
    }
    while (els.noteLogList.children.length > 200) els.noteLogList.removeChild(els.noteLogList.firstChild);
    els.noteLogList.scrollTop = els.noteLogList.scrollHeight;
  }

  els.btnClearNoteLog.addEventListener('click', () => {
    els.noteLogList.innerHTML = '<p class="note-log-empty">Toca una nota de la partitura o una tecla del teclado.</p>';
  });

  function handleStatusChange(status) {
    const map = {
      playing: { play: true, pause: false, text: 'Reproduciendo…' },
      paused: { play: false, pause: true, text: 'Pausado' },
      stopped: { play: false, pause: true, text: '' },
      finished: { play: false, pause: true, text: 'Fin de la pieza' },
    };
    const m = map[status];
    if (!m) return;
    els.btnPlay.disabled = m.play;
    els.btnPause.disabled = m.pause;
    els.playbackStatus.textContent = m.text;
    // El teclado se ve un poco más grande mientras suena, para que se
    // noten mejor los detalles; vuelve a su tamaño normal al pausar/parar.
    els.keyboardContainer.classList.toggle('is-playing', status === 'playing');
  }

  function showError(err) {
    els.abcError.hidden = false;
    els.abcError.textContent = err && err.message ? err.message : String(err);
  }

  // Se llama al cargar una pieza distinta (nueva, de la biblioteca, de un
  // archivo, o convertida desde MIDI): reinicia tempo y ajusta el teclado
  // a un rango razonable en vez de arrastrar el de la pieza anterior.
  function resetForNewPiece() {
    engine.resetTempo();
    els.tempoRange.value = 100;
    els.tempoValue.textContent = '100%';
    keyboard.setRange(48, 84);
  }

  function renderCurrentAbc() {
    const abcText = els.abcInput.value;
    try {
      const { warnings, pitchRange } = engine.render(abcText);
      els.abcError.hidden = true;
      els.abcError.textContent = '';
      if (pitchRange) keyboard.ensureRangeIncludes(pitchRange.min, pitchRange.max, 3);
      if (warnings && warnings.length) showError({ message: 'Aviso del intérprete ABC: ' + warnings.join(' | ') });
      handleStatusChange('stopped');
    } catch (err) {
      showError(err);
    }
  }

  let renderDebounce = null;
  els.abcInput.addEventListener('input', () => {
    clearTimeout(renderDebounce);
    renderDebounce = setTimeout(renderCurrentAbc, 400);
  });

  // ---- Reproducción ----
  els.btnPlay.addEventListener('click', () => engine.play().catch(showError));
  els.btnPause.addEventListener('click', () => engine.pause());
  els.btnRestart.addEventListener('click', () => engine.restart().catch(showError));

  els.tempoRange.addEventListener('input', () => {
    els.tempoValue.textContent = `${els.tempoRange.value}%`;
  });
  els.tempoRange.addEventListener('change', () => {
    engine.setTempoPercent(Number(els.tempoRange.value)).catch(showError);
  });

  els.btnDownloadMidi.addEventListener('click', () => {
    try {
      const filename = `${sanitizeFilename(els.pieceName.value)}.mid`;
      const blob = currentImportedMidi
        ? new Blob([base64ToUint8Array(currentImportedMidi.base64)], { type: 'audio/midi' })
        : engine.getMidiBlob();
      if (!blob) throw new Error('Primero escribe o abre una pieza ABC válida.');
      downloadBlob(blob, filename);
    } catch (err) {
      showError(err);
    }
  });

  els.btnDownloadAbc.addEventListener('click', () => {
    downloadText(els.abcInput.value, `${sanitizeFilename(els.pieceName.value)}.abc`, 'text/plain');
  });

  els.inputOpenAbc.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    els.abcInput.value = text;
    els.pieceName.value = file.name.replace(/\.[^.]+$/, '');
    currentPieceId = null;
    currentImportedMidi = null;
    resetForNewPiece();
    renderCurrentAbc();
    e.target.value = '';
  });

  // ---- Biblioteca local ----
  function refreshLibraryList() {
    const pieces = library.list();
    els.libraryList.innerHTML = '';
    if (pieces.length === 0) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = 'Todavía no tienes piezas guardadas.';
      els.libraryList.appendChild(li);
      return;
    }
    for (const piece of pieces) {
      const li = document.createElement('li');
      li.className = `library-item${piece.id === currentPieceId ? ' active' : ''}`;
      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = piece.name;
      nameSpan.title = piece.name;
      li.appendChild(nameSpan);

      const actions = document.createElement('span');
      actions.className = 'item-actions';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '🗑️';
      delBtn.title = 'Eliminar de la biblioteca';
      delBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (confirm(`¿Eliminar "${piece.name}" de la biblioteca? Esta acción no se puede deshacer.`)) {
          library.delete(piece.id);
          if (currentPieceId === piece.id) currentPieceId = null;
          refreshLibraryList();
        }
      });
      actions.appendChild(delBtn);
      li.appendChild(actions);

      li.addEventListener('click', () => loadPiece(piece));
      els.libraryList.appendChild(li);
    }
  }

  function loadPiece(piece) {
    engine.stop();
    currentPieceId = piece.id;
    currentImportedMidi = piece.sourceType === 'midi' && piece.midiBase64 ? { base64: piece.midiBase64 } : null;
    els.pieceName.value = piece.name;
    els.abcInput.value = piece.abc;
    switchTab('abc');
    resetForNewPiece();
    renderCurrentAbc();
    refreshLibraryList();
  }

  els.btnSavePiece.addEventListener('click', () => {
    const name = els.pieceName.value.trim() || 'Sin título';
    const saved = library.save({
      id: currentPieceId,
      name,
      abc: els.abcInput.value,
      midiBase64: currentImportedMidi ? currentImportedMidi.base64 : null,
      sourceType: currentImportedMidi ? 'midi' : 'abc',
    });
    currentPieceId = saved.id;
    refreshLibraryList();
    els.playbackStatus.textContent = 'Guardado ✅';
    setTimeout(() => {
      if (els.playbackStatus.textContent === 'Guardado ✅') els.playbackStatus.textContent = '';
    }, 1500);
  });

  els.btnNewPiece.addEventListener('click', () => {
    engine.stop();
    currentPieceId = null;
    currentImportedMidi = null;
    els.pieceName.value = 'Pieza sin título';
    els.abcInput.value = DEFAULT_ABC_TEMPLATE;
    switchTab('abc');
    resetForNewPiece();
    renderCurrentAbc();
    refreshLibraryList();
  });

  // ---- Pestañas ----
  function switchTab(tab) {
    els.tabBtns.forEach((btn) => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    Object.entries(els.tabPanels).forEach(([key, panel]) => panel.classList.toggle('active', key === tab));
  }
  els.tabBtns.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  // ---- Importar MIDI ----
  els.inputOpenMidi.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const midi = parseMidiArrayBuffer(buffer);
      const summary = summarizeMidi(midi);
      pendingMidi = { midi, base64: arrayBufferToBase64(buffer), fileName: file.name };
      els.midiImportInfo.textContent =
        `"${file.name}" — ${summary.noteCount} notas en ${summary.tracksWithNotes} pista(s), ` +
        `${summary.bpm} BPM, ${summary.durationSeconds.toFixed(1)} s. Puedes reproducirlo tras convertirlo a ABC.`;
      els.btnConvertMidi.hidden = false;
    } catch (err) {
      els.midiImportInfo.textContent = `No se pudo leer el archivo MIDI: ${err.message || err}`;
      els.btnConvertMidi.hidden = true;
      pendingMidi = null;
    }
    e.target.value = '';
  });

  els.btnConvertMidi.addEventListener('click', () => {
    if (!pendingMidi) return;
    try {
      const title = pendingMidi.fileName.replace(/\.[^.]+$/, '');
      const abc = midiToAbc(pendingMidi.midi, { title });
      engine.stop();
      currentPieceId = null;
      currentImportedMidi = { base64: pendingMidi.base64, fileName: pendingMidi.fileName };
      els.pieceName.value = title;
      els.abcInput.value = abc;
      switchTab('abc');
      resetForNewPiece();
      renderCurrentAbc();
    } catch (err) {
      els.midiImportInfo.textContent = `No se pudo convertir a ABC: ${err.message || err}`;
    }
  });

  // ---- Ayuda ----
  els.btnHelp.addEventListener('click', () => { els.helpModal.hidden = false; });
  els.btnCloseHelp.addEventListener('click', () => { els.helpModal.hidden = true; });
  els.helpModal.addEventListener('click', (e) => { if (e.target === els.helpModal) els.helpModal.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') els.helpModal.hidden = true; });

  // ---- Arranque ----
  if (!window.abcjs || !abcjs.synth || !abcjs.synth.supportsAudio()) {
    els.btnPlay.disabled = true;
    els.playbackStatus.textContent = 'Este navegador no soporta la reproducción de audio (Web Audio).';
  }
  els.abcInput.value = DEFAULT_ABC_TEMPLATE;
  refreshLibraryList();
  resetForNewPiece();
  renderCurrentAbc();
});
