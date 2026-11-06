// Ordre des traits avec Hanzi Writer (chargé dans index.html, données des caractères via CDN).

const HANZI = /[一-鿿]/;

function writerOptions(size) {
  const css = getComputedStyle(document.documentElement);
  return {
    width: size,
    height: size,
    padding: 5,
    strokeColor: css.getPropertyValue("--fg").trim() || "#222",
    radicalColor: css.getPropertyValue("--accent").trim() || "#c0392b",
    outlineColor: css.getPropertyValue("--border").trim() || "#ddd",
    drawingColor: css.getPropertyValue("--accent").trim() || "#c0392b",
    highlightColor: css.getPropertyValue("--easy").trim() || "#2e86c1",
    showCharacter: false,
    showOutline: true,
    strokeAnimationSpeed: 1.2,
    delayBetweenStrokes: 150,
    onLoadCharDataError: () => {},
  };
}

/**
 * Affiche une case par caractère de `text` dans `container` et renvoie des commandes
 * { animate(), quiz(onDone) } qui enchaînent les caractères un par un.
 */
export function mountStrokes(container, text, size = 110) {
  container.innerHTML = "";
  if (!window.HanziWriter) {
    container.innerHTML = '<p class="muted">Ordre des traits indisponible (pas de connexion ?).</p>';
    return { animate() {}, quiz() {} };
  }
  const writers = [...text].filter((c) => HANZI.test(c)).map((char) => {
    const box = document.createElement("div");
    box.className = "stroke-box";
    container.append(box);
    return HanziWriter.create(box, char, writerOptions(size));
  });

  // Exécute `step(writer, next)` pour chaque caractère, l'un après l'autre.
  const chain = (step, onDone) => {
    const run = (i) => (i < writers.length ? step(writers[i], () => run(i + 1)) : onDone?.());
    run(0);
  };

  return {
    animate() {
      writers.forEach((w) => w.hideCharacter());
      chain((w, next) => w.animateCharacter({ onComplete: next }));
    },
    quiz(onDone) {
      let mistakes = 0;
      writers.forEach((w) => w.hideCharacter());
      chain(
        (w, next) => w.quiz({
          onComplete: (summary) => {
            mistakes += summary.totalMistakes;
            next();
          },
        }),
        () => onDone?.(mistakes),
      );
    },
  };
}
