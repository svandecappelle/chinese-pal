// Ordre des traits avec Hanzi Writer (chargé dans index.html, données des caractères via CDN).

const HANZI = /[一-鿿]/;

function writerOptions(size, outline) {
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
    showOutline: outline,
    // En test, l'indice (trait à tracer) n'apparaît qu'après 3 essais ratés sur un trait.
    showHintAfterMisses: 3,
    strokeAnimationSpeed: 1.2,
    delayBetweenStrokes: 150,
    onLoadCharDataError: () => {},
  };
}

/**
 * Affiche une case par caractère de `text` dans `container` et renvoie des commandes
 * { available, animate(), quiz(onDone), cancel(), reveal() } qui enchaînent les caractères
 * un par un. `outline: false` cache le modèle grisé (pour tracer de mémoire).
 */
export function mountStrokes(container, text, size = 110, { outline = true } = {}) {
  container.innerHTML = "";
  if (!window.HanziWriter) {
    container.innerHTML = '<p class="muted">Ordre des traits indisponible (pas de connexion ?).</p>';
    return { available: false, animate() {}, quiz() {}, cancel() {}, reveal() {} };
  }
  const writers = [...text].filter((c) => HANZI.test(c)).map((char) => {
    const box = document.createElement("div");
    box.className = "stroke-box";
    container.append(box);
    return HanziWriter.create(box, char, writerOptions(size, outline));
  });

  // Exécute `step(writer, next)` pour chaque caractère, l'un après l'autre.
  const chain = (step, onDone) => {
    const run = (i) => (i < writers.length ? step(writers[i], () => run(i + 1)) : onDone?.());
    run(0);
  };

  return {
    available: true,
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
    cancel() {
      writers.forEach((w) => w.cancelQuiz());
    },
    // Montre les caractères entiers (après un abandon, par exemple).
    reveal() {
      writers.forEach((w) => {
        w.cancelQuiz();
        w.showOutline();
        w.showCharacter();
      });
    },
  };
}
