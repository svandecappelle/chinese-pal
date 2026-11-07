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

// Doigt sur écran tactile : moins précis qu'une souris, on accepte des traits plus approximatifs.
const COARSE = window.matchMedia?.("(pointer: coarse)").matches;

// Grande case pour tracer : toute la largeur disponible, sans dépasser la moitié de l'écran en hauteur.
function quizSize(container) {
  // La case des traits peut être resserrée sur son contenu : on prend la largeur d'un parent.
  let block = container;
  while (block.parentElement && block.clientWidth < 260) block = block.parentElement;
  const width = Math.min(block.clientWidth || window.innerWidth, window.innerWidth) - 16;
  return Math.round(Math.max(180, Math.min(width, 340, window.innerHeight * 0.55)));
}

function quizOptions(size, outline) {
  return {
    ...writerOptions(size, outline),
    padding: Math.round(size * 0.06),
    // Trait dessiné plus épais quand la case est grande, plus visible sous le doigt.
    drawingWidth: Math.max(6, Math.round(size / 28)),
    // 1 par défaut ; au-delà, Hanzi Writer accepte un trait plus éloigné du modèle.
    leniency: COARSE ? 1.6 : 1.3,
    // Avec le modèle grisé (entraînement), l'indice vient plus vite ; de mémoire (test), après 3 essais.
    showHintAfterMisses: outline ? 2 : 3,
  };
}

/**
 * Affiche une case par caractère de `text` dans `container` et renvoie des commandes
 * { available, animate(), quiz(onDone), cancel(), reveal() } qui enchaînent les caractères
 * un par un. `outline: false` cache le modèle grisé (pour tracer de mémoire).
 *
 * Pour tracer (quiz), les petites cases laissent place à une seule grande case, caractère après
 * caractère, avec la progression au-dessus : sur téléphone, les traits sont bien plus faciles.
 */
export function mountStrokes(container, text, size = 110, { outline = true } = {}) {
  container.innerHTML = "";
  if (!window.HanziWriter) {
    container.innerHTML = '<p class="muted">Ordre des traits indisponible (pas de connexion ?).</p>';
    return { available: false, animate() {}, quiz() {}, cancel() {}, reveal() {} };
  }
  const chars = [...text].filter((c) => HANZI.test(c));
  const boxes = document.createElement("div");
  boxes.className = "stroke-boxes";
  container.append(boxes);
  const writers = chars.map((char) => {
    const box = document.createElement("div");
    box.className = "stroke-box";
    boxes.append(box);
    return HanziWriter.create(box, char, writerOptions(size, outline));
  });

  // Exécute `step(writer, next)` pour chaque caractère, l'un après l'autre.
  const chain = (step, onDone) => {
    const run = (i) => (i < writers.length ? step(writers[i], () => run(i + 1)) : onDone?.());
    run(0);
  };

  let stage = null;
  let current = null;
  let session = 0;

  function closeStage() {
    session += 1;
    current?.cancelQuiz();
    current = null;
    stage?.remove();
    stage = null;
    boxes.hidden = false;
  }

  return {
    available: true,
    animate() {
      closeStage();
      writers.forEach((w) => w.hideCharacter());
      chain((w, next) => w.animateCharacter({ onComplete: next }));
    },
    quiz(onDone) {
      closeStage();
      const mine = session;
      const big = quizSize(container);
      boxes.hidden = true;
      stage = document.createElement("div");
      stage.className = "stroke-quiz";
      stage.innerHTML = `
        ${chars.length > 1 ? `<div class="stroke-progress">${chars.map(() => "<span>?</span>").join("")}</div>` : ""}
        <div class="stroke-box stroke-quiz-box"></div>`;
      container.append(stage);
      const progress = [...stage.querySelectorAll(".stroke-progress span")];
      const box = stage.querySelector(".stroke-quiz-box");
      let mistakes = 0;

      const run = (i) => {
        if (mine !== session) return;
        if (i === chars.length) {
          closeStage();
          writers.forEach((w) => w.showCharacter());
          onDone?.(mistakes);
          return;
        }
        progress.forEach((p, n) => p.classList.toggle("current", n === i));
        box.innerHTML = "";
        current = HanziWriter.create(box, chars[i], quizOptions(big, outline));
        current.quiz({
          onComplete: (summary) => {
            mistakes += summary.totalMistakes;
            if (progress[i]) {
              progress[i].textContent = chars[i];
              progress[i].classList.add("done");
            }
            // Laisse voir le caractère terminé un instant avant le suivant.
            setTimeout(() => run(i + 1), i < chars.length - 1 ? 450 : 250);
          },
        });
      };
      run(0);
    },
    cancel() {
      closeStage();
      writers.forEach((w) => w.cancelQuiz());
    },
    // Montre les caractères entiers (après un abandon, par exemple).
    reveal() {
      closeStage();
      writers.forEach((w) => {
        w.cancelQuiz();
        w.showOutline();
        w.showCharacter();
      });
    },
  };
}
