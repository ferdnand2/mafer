// Herramientas MIDI: parseo de archivos .mid (con @tonejs/midi) y
// conversión aproximada de MIDI -> notación ABC.
//
// Convención de alturas ABC usada aquí (estándar del lenguaje ABC):
// 'C' (mayúscula, sin marcas) = Do central = MIDI 60.
// Cada octava hacia arriba pasa a minúscula ('c' = MIDI 72) y añade
// apóstrofes; cada octava hacia abajo añade comas ('C,' = MIDI 48).
'use strict';

const ABC_UNIT_PER_QUARTER = 4; // usamos L:1/16 como grilla de cuantización

function parseMidiArrayBuffer(arrayBuffer) {
  return new Midi(arrayBuffer);
}

function summarizeMidi(midi) {
  const noteCount = midi.tracks.reduce((sum, t) => sum + t.notes.length, 0);
  const tracksWithNotes = midi.tracks.filter((t) => t.notes.length > 0).length;
  const bpm = Math.round(midi.header.tempos?.[0]?.bpm || 120);
  return {
    noteCount,
    tracksWithNotes,
    bpm,
    durationSeconds: midi.duration || 0,
    name: midi.name || null,
  };
}

// Convierte un número MIDI en un token de altura ABC (con posible '^' de
// sostenido). `accState` acumula, por letra+octava, si hay un sostenido
// activo en el compás actual, para no repetir '^' de más ni olvidar el '='.
function resolvePitchToken(midiPitch, accState) {
  const LETTERS = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
  const SHARP_SEMITONES = new Set([1, 3, 6, 8, 10]);
  const semitone = ((midiPitch % 12) + 12) % 12;
  const letter = LETTERS[semitone];
  const isSharp = SHARP_SEMITONES.has(semitone);
  const octaveShift = Math.floor(midiPitch / 12) - 5; // 0 => octava de C4/MIDI60

  const key = `${letter}${octaveShift}`;
  const prevAccidental = accState[key] || null;
  let prefix = '';
  if (isSharp) {
    if (prevAccidental !== '^') {
      prefix = '^';
      accState[key] = '^';
    }
  } else if (prevAccidental === '^') {
    prefix = '=';
    accState[key] = null;
  }

  let core = letter;
  let marks = '';
  if (octaveShift <= 0) {
    marks = ','.repeat(-octaveShift);
  } else {
    core = letter.toLowerCase();
    marks = "'".repeat(octaveShift - 1);
  }
  return `${prefix}${core}${marks}`;
}

// Agrupa notas (ya cuantizadas en unidades) en acordes/silencios sin
// solapes: cada nota que empieza en el mismo instante se combina en un
// acorde; los huecos entre eventos se rellenan con silencios.
function buildChordEvents(notes) {
  if (notes.length === 0) return [];
  const sorted = [...notes].sort((a, b) => a.startUnit - b.startUnit);
  const groups = [];
  for (const n of sorted) {
    let g = groups[groups.length - 1];
    if (!g || g.startUnit !== n.startUnit) {
      g = { startUnit: n.startUnit, pitches: [], durUnits: n.durUnits };
      groups.push(g);
    }
    g.pitches.push(n.midiPitch);
    g.durUnits = Math.max(g.durUnits, n.durUnits);
  }
  for (let i = 0; i < groups.length; i++) {
    const next = groups[i + 1];
    if (next) groups[i].durUnits = Math.min(groups[i].durUnits, next.startUnit - groups[i].startUnit);
    groups[i].durUnits = Math.max(1, groups[i].durUnits);
  }
  const events = [];
  let cursor = 0;
  for (const g of groups) {
    if (g.startUnit > cursor) events.push({ rest: true, durUnits: g.startUnit - cursor });
    events.push({ rest: false, pitches: [...new Set(g.pitches)], durUnits: g.durUnits });
    cursor = g.startUnit + g.durUnits;
  }
  return events;
}

// Convierte una lista de eventos (silencios/acordes en unidades de L:1/16)
// en el cuerpo de texto ABC de una voz, insertando barras de compás y
// ligaduras cuando una nota queda partida por un compás.
//
// El espacio entre notas en ABC controla el "beaming": sin espacio se
// agrupan bajo una sola barra (como corresponde a corcheas/semicorcheas
// dentro de un mismo pulso); con espacio, cada una queda aislada con su
// propia bandera. Por eso solo ponemos un espacio cuando el siguiente
// token cae en un pulso distinto al anterior (agrupado por `beatUnits`),
// no después de cada nota.
function buildHandVoiceAbc(events, unitsPerMeasure, beatUnits) {
  let output = '';
  let unitsInMeasure = 0;
  let accState = {};
  let prevBeatIndex = -1; // -1 = no poner espacio antes del primer token del compás

  for (const ev of events) {
    let remaining = ev.durUnits;
    while (remaining > 0) {
      const spaceLeft = unitsPerMeasure - unitsInMeasure;
      const take = Math.min(remaining, spaceLeft);
      const lengthSuffix = take === 1 ? '' : String(take);
      const beatIndex = Math.floor(unitsInMeasure / beatUnits);
      if (prevBeatIndex !== -1 && beatIndex !== prevBeatIndex) output += ' ';

      if (ev.rest) {
        output += `z${lengthSuffix}`;
      } else {
        const tokens = ev.pitches.map((p) => resolvePitchToken(p, accState));
        const core = tokens.length > 1 ? `[${tokens.join('')}]` : tokens[0];
        const tie = remaining > take ? '-' : '';
        output += `${core}${lengthSuffix}${tie}`;
      }
      prevBeatIndex = beatIndex;

      unitsInMeasure += take;
      remaining -= take;
      if (unitsInMeasure >= unitsPerMeasure) {
        output += ' | ';
        unitsInMeasure = 0;
        accState = {};
        prevBeatIndex = -1;
      }
    }
  }
  if (unitsInMeasure > 0) output += ' |';
  return output.trim();
}

// Duración del pulso (en unidades de L:1/16) según el compás: negra en
// compases simples; negra con puntillo (3 corcheas) en compases
// compuestos de denominador 8 con numerador múltiplo de 3 (6/8, 9/8,
// 12/8, y 3/8 como caso propio de un solo pulso por compás).
function getBeatUnits(numerator, denominator) {
  if (denominator === 8 && numerator % 3 === 0) return 6;
  if (denominator === 8) return 2;
  return 4;
}

/**
 * Convierte un objeto Midi (de @tonejs/midi) en texto ABC de dos voces
 * (V:1 mano derecha, V:2 mano izquierda). Es una conversión aproximada:
 * cuantiza a semicorchea (L:1/16) y asume tempo/compás constantes
 * (toma el primero que encuentre en el archivo).
 */
function midiToAbc(midi, options = {}) {
  const bpm = Math.round(midi.header.tempos?.[0]?.bpm || 120);
  const ts = midi.header.timeSignatures?.[0]?.timeSignature || [4, 4];
  const [numerator, denominator] = ts;
  const unitsPerMeasure = Math.max(1, Math.round((numerator * 16) / denominator));
  const quarterSeconds = 60 / bpm;

  const rawNotes = [];
  midi.tracks.forEach((track, trackIndex) => {
    track.notes.forEach((n) => {
      rawNotes.push({
        midiPitch: n.midi,
        startUnit: Math.round((n.time / quarterSeconds) * ABC_UNIT_PER_QUARTER),
        durUnits: Math.max(1, Math.round((n.duration / quarterSeconds) * ABC_UNIT_PER_QUARTER)),
        trackIndex,
      });
    });
  });

  if (rawNotes.length === 0) {
    throw new Error('El archivo MIDI no tiene notas de instrumento (¿solo percusión o metadatos?).');
  }

  const tracksWithNotes = [...new Set(rawNotes.map((n) => n.trackIndex))].sort((a, b) => a - b);
  const right = [];
  const left = [];
  if (tracksWithNotes.length >= 2) {
    const rightTrack = tracksWithNotes[0];
    for (const n of rawNotes) (n.trackIndex === rightTrack ? right : left).push(n);
  } else {
    for (const n of rawNotes) (n.midiPitch >= HAND_SPLIT_MIDI_THRESHOLD ? right : left).push(n);
  }

  const beatUnits = getBeatUnits(numerator, denominator);
  const rightBody = buildHandVoiceAbc(buildChordEvents(right), unitsPerMeasure, beatUnits) || `z${unitsPerMeasure}`;
  const leftBody = buildHandVoiceAbc(buildChordEvents(left), unitsPerMeasure, beatUnits) || `z${unitsPerMeasure}`;

  const title = (options.title || 'Pieza importada').replace(/[\r\n]+/g, ' ').trim() || 'Pieza importada';

  return [
    'X:1',
    `T:${title}`,
    `M:${numerator}/${denominator}`,
    'L:1/16',
    `Q:1/4=${bpm}`,
    'K:C',
    'V:1 clef=treble name="Mano derecha"',
    'V:2 clef=bass name="Mano izquierda"',
    'V:1',
    rightBody,
    'V:2',
    leftBody,
    '',
  ].join('\n');
}
