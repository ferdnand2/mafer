// Teclado de piano en SVG. Se ilumina en rojo (mano derecha) o azul (mano
// izquierda) según las notas que estén sonando en cada instante.
'use strict';

class PianoKeyboard {
  /**
   * @param {HTMLElement} container
   * @param {{min?: number, max?: number}} opts rango MIDI a mostrar (por defecto 3.5 octavas alrededor del Do central)
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.min = opts.min ?? 48; // C3
    this.max = opts.max ?? 84; // C6
    this.whiteWidth = 22;
    this.whiteHeight = 110;
    this.blackWidth = 13;
    this.blackHeight = 68;
    // midi -> { activeRight: bool, activeLeft: bool }
    this.state = new Map();
    this.onKeyClick = null; // callback opcional (midi) => void
    this._build();
  }

  setRange(min, max) {
    this.min = min;
    this.max = max;
    this._build();
  }

  // Expande el rango, si hace falta, para incluir el midi dado (con margen).
  ensureRangeIncludes(minMidi, maxMidi, padding = 2) {
    const newMin = Math.min(this.min, minMidi - padding);
    const newMax = Math.max(this.max, maxMidi + padding);
    if (newMin !== this.min || newMax !== this.max) {
      this.setRange(clamp(newMin, 0, 127), clamp(newMax, 0, 127));
    }
  }

  _build() {
    this.container.innerHTML = '';
    this.state.clear();
    const keys = [];
    let x = 0;
    let whiteCount = 0;
    for (let midi = this.min; midi <= this.max; midi++) {
      if (!isBlackKeyMidi(midi)) {
        keys.push({ midi, black: false, x, width: this.whiteWidth });
        x += this.whiteWidth;
        whiteCount++;
      } else {
        keys.push({ midi, black: true, x: x - this.blackWidth / 2, width: this.blackWidth });
      }
    }
    this.totalWidth = whiteCount * this.whiteWidth;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${this.totalWidth} ${this.whiteHeight}`);
    svg.setAttribute('class', 'piano-svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMin meet');

    // Primero blancas, luego negras encima.
    const whiteEls = [];
    const blackEls = [];
    for (const k of keys) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', k.x);
      rect.setAttribute('y', 0);
      rect.setAttribute('width', k.width);
      rect.setAttribute('height', k.black ? this.blackHeight : this.whiteHeight);
      rect.setAttribute('rx', 2);
      rect.dataset.midi = String(k.midi);
      rect.setAttribute('class', k.black ? 'key key-black' : 'key key-white');
      rect.addEventListener('click', () => {
        if (this.onKeyClick) this.onKeyClick(k.midi);
      });
      this.state.set(k.midi, { el: rect, right: 0, left: 0 });
      (k.black ? blackEls : whiteEls).push(rect);

      // Etiqueta "Do" en cada C blanca, útil como referencia visual.
      if (!k.black && k.midi % 12 === 0) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', k.x + k.width / 2);
        label.setAttribute('y', this.whiteHeight - 8);
        label.setAttribute('class', 'key-label');
        label.textContent = 'C';
        whiteEls.push(label);
      }
    }
    whiteEls.forEach((el) => svg.appendChild(el));
    blackEls.forEach((el) => svg.appendChild(el));
    this.container.appendChild(svg);
  }

  _refresh(midi) {
    const entry = this.state.get(midi);
    if (!entry) return;
    entry.el.classList.remove('active-right', 'active-left', 'active-both');
    if (entry.right > 0 && entry.left > 0) entry.el.classList.add('active-both');
    else if (entry.right > 0) entry.el.classList.add('active-right');
    else if (entry.left > 0) entry.el.classList.add('active-left');
  }

  /** Enciende una nota para una mano ('right' | 'left'). Cuenta referencias
   * para soportar notas repetidas/ligadas que se solapan. */
  noteOn(midi, hand) {
    if (midi < this.min || midi > this.max) this.ensureRangeIncludes(midi, midi);
    const entry = this.state.get(midi);
    if (!entry) return;
    if (hand === HAND.RIGHT) entry.right++;
    else entry.left++;
    this._refresh(midi);
  }

  noteOff(midi, hand) {
    const entry = this.state.get(midi);
    if (!entry) return;
    if (hand === HAND.RIGHT) entry.right = Math.max(0, entry.right - 1);
    else entry.left = Math.max(0, entry.left - 1);
    this._refresh(midi);
  }

  allNotesOff() {
    for (const [midi, entry] of this.state) {
      entry.right = 0;
      entry.left = 0;
      entry.el.classList.remove('active-right', 'active-left', 'active-both');
    }
  }
}
