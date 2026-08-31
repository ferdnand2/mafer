// Biblioteca local de piezas (ABC + MIDI) guardada en localStorage del
// navegador. GitHub Pages no tiene backend, así que todo el "guardado"
// vive en el navegador; se complementa con descarga/subida de archivos.
'use strict';

const LIBRARY_STORAGE_KEY = 'mafer.library.v1';

class PieceLibrary {
  constructor() {
    this._pieces = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error('No se pudo leer la biblioteca guardada, se empieza vacía.', err);
      return [];
    }
  }

  _persist() {
    try {
      localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(this._pieces));
      return true;
    } catch (err) {
      console.error('No se pudo guardar en localStorage (¿cuota llena?).', err);
      return false;
    }
  }

  list() {
    return [...this._pieces].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  get(id) {
    return this._pieces.find((p) => p.id === id) || null;
  }

  /**
   * @param {{id?:string, name:string, abc?:string, midiBase64?:string, sourceType:'abc'|'midi'}} data
   * @returns {object} la pieza guardada
   */
  save(data) {
    const existingIdx = data.id ? this._pieces.findIndex((p) => p.id === data.id) : -1;
    const piece = {
      id: data.id || uid('piece'),
      name: data.name || 'Sin título',
      abc: data.abc || '',
      midiBase64: data.midiBase64 || null,
      sourceType: data.sourceType || 'abc',
      createdAt: existingIdx >= 0 ? this._pieces[existingIdx].createdAt : nowIso(),
      updatedAt: nowIso(),
    };
    if (existingIdx >= 0) this._pieces[existingIdx] = piece;
    else this._pieces.push(piece);
    this._persist();
    return piece;
  }

  delete(id) {
    this._pieces = this._pieces.filter((p) => p.id !== id);
    this._persist();
  }

  rename(id, newName) {
    const piece = this.get(id);
    if (!piece) return null;
    piece.name = newName;
    piece.updatedAt = nowIso();
    this._persist();
    return piece;
  }
}
