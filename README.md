# Mafer 🎹

Una app web para leer, escuchar y practicar partituras: escribe (o importa)
notación **ABC**, mírala como partitura de verdad, escúchala sonar y sigue
las notas en un teclado donde la **mano derecha se ilumina en rojo** y la
**mano izquierda en azul**. También puedes importar y exportar **MIDI**.

Es un sitio 100% estático (HTML/CSS/JS, sin build ni backend) pensado para
publicarse en GitHub Pages.

## Funciones

- Editor de código ABC con partitura en vivo (usa [abcjs](https://abcjs.net)).
- Reproducción con sonido real (síntesis de audio de abcjs, sin necesidad de MIDI externo).
- Teclado de piano animado: se ilumina en **rojo** con la voz `V:1` (mano derecha) y en **azul** con `V:2` (mano izquierda). Si el ABC no tiene voces separadas, se reparte automáticamente por altura (Do central como umbral).
- Controles de reproducción: reproducir, pausar, reiniciar y cambiar el tempo (40%–200%).
- Descarga del MIDI de la pieza actual, y descarga del propio código `.abc`.
- Importar un archivo `.mid`/`.midi`: se puede convertir a notación ABC de forma aproximada (cuantizado a semicorchea) y luego reproducirse igual que cualquier pieza ABC.
- Biblioteca personal guardada en el navegador (`localStorage`): guardar, abrir, eliminar piezas. No hay servidor ni cuenta — es local a cada navegador, así que conviene descargar lo importante de vez en cuando.

## Cómo probarlo en local

No hace falta instalar nada ni compilar: es HTML estático. Basta con
servirlo con cualquier servidor simple (abrir `index.html` directo con
`file://` no funciona bien por las restricciones de módulos/CORS del
navegador), por ejemplo:

```bash
# Con Python
python -m http.server 8000

# o con Node
npx serve .
```

Y abrir `http://localhost:8000`.

## Publicar en GitHub Pages

1. Sube este repositorio a GitHub.
2. En **Settings → Pages**, elige "Deploy from a branch", rama `main`, carpeta `/ (root)`.
3. Listo — no hace falta ningún workflow de Actions porque no hay paso de build.

## Estructura

```
index.html          Página principal
css/style.css        Estilos
js/utils.js           Utilidades (notas MIDI, descargas, biblioteca…)
js/keyboard.js         Teclado de piano en SVG, coloreado por mano
js/library.js           Biblioteca local (localStorage)
js/abc-engine.js         Render + reproducción sincronizada con abcjs
js/midi-tools.js          Parseo de MIDI y conversión MIDI → ABC
js/app.js                  Conecta todo con la interfaz
```

## Limitaciones conocidas

- **Guardado local:** al ser un sitio estático sin servidor, la "biblioteca"
  vive en el `localStorage` de cada navegador. No se sincroniza entre
  dispositivos; usa los botones de descarga (`.abc` / MIDI) para hacer
  copias de seguridad de piezas importantes.
- **Conversión MIDI → ABC:** es aproximada. Cuantiza todo a semicorchea
  (`L:1/16`), asume tempo y compás constantes (toma el primero que
  encuentra en el archivo) y separa las manos por pista si hay dos o más, o
  por altura de nota (Do central) si el MIDI viene en una sola pista.
  Funciona mejor con piezas simples, ya cuantizadas (por ejemplo,
  exportadas desde otro editor de partituras) que con grabaciones en vivo
  con mucho rubato.
- El sonido de reproducción usa una soundfont remota que carga abcjs desde
  internet la primera vez que se toca cada instrumento — hace falta
  conexión a internet para escuchar el audio (la partitura en sí se ve
  igual sin conexión, una vez cargada la página).

## Librerías usadas

- [abcjs](https://www.abcjs.net/) v6.7.0 — notación, motor de audio y exportación MIDI.
- [@tonejs/midi](https://github.com/Tonejs/Midi) v2.0.28 — lectura de archivos MIDI importados.

Ambas están alojadas dentro de este repo, en `vendor/` (copiadas tal cual
de sus builds oficiales), en vez de cargarse desde un CDN externo — así el
sitio no depende de que jsDelivr esté disponible ni de que algún
bloqueador de anuncios/red no filtre ese dominio.
