import { api, escape } from "../api.js";
import { displayName, session } from "../session.js";
import { toast } from "../ui.js";

// Fil de révision : chaque jour quelques petits pas (une poignée de cartes chacun), la semaine,
// et le fil de ce qui a été fait (séances, mots maîtrisés, séries, nouveaux exercices).

const DAY_MS = 86400000;
const PACES = [2, 3, 5];
const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
const WEEKDAY_NAMES = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const GRADE_CLASSES = { 1: "again", 2: "hard", 3: "good", 4: "easy" };

const plural = (n, word, words = `${word}s`) => `${n} ${n > 1 ? words : word}`;
const percent = (value) => (value === null || value === undefined ? "—" : `${Math.round(value * 100)} %`);
const time = (iso) => {
  const d = new Date(iso);
  return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
};
const utcDay = (iso) => new Date(iso).toISOString().slice(0, 10);

function dayLabel(day, today) {
  const diff = Math.round((Date.parse(today) - Date.parse(day)) / DAY_MS);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function stepTitle(step) {
  if (step.kind === "missed") return `Retravailler ${plural(step.cards, "carte ratée", "cartes ratées")}`;
  if (step.kind === "new") return `Découvrir ${plural(step.cards, "nouvelle carte", "nouvelles cartes")}`;
  return `Revoir ${plural(step.cards, "carte")}`;
}

const DONE_TITLES = { due: "Cartes revues", missed: "Mots ratés retravaillés", new: "Nouveaux mots découverts" };

const stepHref = (step) => `#/exercices/${step.exercise_id}/test?pas=${step.kind}&n=${step.cards}`;

const check = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
const flame = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-6 1-9.5z"/></svg>';
const arrow = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

function subtitle(data) {
  const left = data.pace - data.done.length;
  if (left <= 0) return `Objectif du jour atteint : ${plural(data.done.length, "pas", "pas")} sur ${data.pace}. 太棒了！`;
  if (!data.upcoming.length) {
    return data.done.length
      ? "Tout est à jour : plus rien à réviser pour aujourd'hui."
      : "Rien à réviser pour l'instant : reviens demain, ou lis un texte en attendant.";
  }
  const steps = data.upcoming.slice(0, left);
  const minutes = steps.reduce((n, s) => n + s.minutes, 0);
  return `${data.done.length ? "Encore" : "Aujourd'hui,"} ${plural(steps.length, "petit pas", "petits pas")}${data.done.length ? " aujourd'hui" : ""}, environ ${minutes} min.`;
}

function stepsHtml(data) {
  const left = Math.max(0, data.pace - data.done.length);
  const planned = data.upcoming.slice(0, left);
  const segments = Array.from({ length: Math.max(data.pace, data.done.length) }, (_, i) => {
    if (i < data.done.length) return '<span class="seg done"></span>';
    return `<span class="seg${i === data.done.length && planned.length ? " current" : ""}"></span>`;
  }).join("");

  const done = data.done.map((s) => `
    <li class="step done">
      <span class="step-dot">${check}</span>
      <div class="step-body">
        <div class="step-title">${DONE_TITLES[s.kind]}</div>
        <div class="step-meta good-text">${plural(s.answers, "réponse")} · ${s.good} juste${s.good > 1 ? "s" : ""} · ${time(s.done_at)}</div>
      </div>
    </li>`).join("");

  const todo = planned.map((s, i) => `
    <li class="step${i === 0 ? " current" : ""}">
      <span class="step-dot">${data.done.length + i + 1}</span>
      <div class="step-body">
        <div class="step-title">${stepTitle(s)}</div>
        ${i === 0 && s.words.length ? `<div class="step-words">
          ${s.words.map((w) => `<span class="hanzi-chip" lang="zh">${escape(w)}</span>`).join("")}
          ${s.more_words ? `<span class="muted small">+${s.more_words}</span>` : ""}</div>` : ""}
        <div class="step-meta">${escape(s.exercise_name)} · environ ${s.minutes} min</div>
      </div>
    </li>`).join("");

  const nothing = left > planned.length && !planned.length && data.done.length < data.pace
    ? `<li class="step empty"><span class="step-dot">✓</span><div class="step-body">
         <div class="step-title">Rien d'autre à réviser aujourd'hui</div>
         <div class="step-meta">Les cartes reviendront quand ce sera le moment.</div></div></li>` : "";

  // Objectif atteint : un pas de plus, pour qui veut continuer.
  const extra = !left && data.upcoming.length ? data.upcoming[0] : null;
  const next = planned[0] || extra;
  const label = extra ? "Un pas de plus" : `${data.done.length ? "Continuer" : "Commencer"} · pas ${data.done.length + 1}`;

  return `
    <section class="feed-card feed-steps">
      <div class="feed-card-head">
        <h3>Les pas du jour</h3>
        <span class="muted small">${Math.min(data.done.length, data.pace)} sur ${data.pace}</span>
      </div>
      <div class="segments" style="--n: ${Math.max(data.pace, data.done.length)}">${segments}</div>
      <ol class="steps">${done}${todo}${nothing}</ol>
      ${extra ? `<p class="muted small extra-step">${stepTitle(extra)} · ${escape(extra.exercise_name)} · environ ${extra.minutes} min</p>` : ""}
      ${next ? `<a class="button step-go${extra ? " secondary" : ""}" href="${stepHref(next)}">${label} ${arrow}</a>` : ""}
    </section>`;
}

function weekHtml(data) {
  const todayIndex = data.week.findIndex((d) => d.day === data.today);
  const progress = Math.min(1, data.done.length / data.pace);
  return `
    <section class="feed-card feed-week">
      <div class="feed-card-head">
        <h3>Cette semaine</h3>
        <span class="muted small">${data.best_streak > 1 ? `record : ${data.best_streak} jours` : "un jour à la fois"}</span>
      </div>
      <div class="week">
        ${data.week.map((d, i) => {
          const active = d.answers > 0 || d.steps > 0;
          const cls = i === todayIndex ? "today" : i > todayIndex ? "future" : active ? "active" : "";
          const title = i > todayIndex ? "" : `${plural(d.answers, "réponse")}${d.steps ? ` · ${plural(d.steps, "pas", "pas")}` : ""}`;
          return `<div class="week-day${i === todayIndex ? " is-today" : ""}" title="${title}">
            ${WEEKDAYS[i]}<span class="week-dot ${cls}${i === todayIndex && active ? " active" : ""}"
              style="--p: ${Math.round(progress * 100)}%"></span></div>`;
        }).join("")}
      </div>
    </section>`;
}

function eventHtml(e, data) {
  const item = (dot, body) => `<li class="fil-item"><span class="fil-dot ${dot}"></span><div class="fil-body">${body}</div></li>`;
  switch (e.type) {
    case "sitting":
      return item("good", `
        <div class="fil-title">${e.steps ? (e.steps > 1 ? `${e.steps} pas du fil` : "Un pas du fil") : "Révision libre"}</div>
        <div class="fil-meta">${plural(e.answers, "réponse")}, ${e.good} juste${e.good > 1 ? "s" : ""} · ${time(e.at)}</div>
        <div class="grade-strip" aria-label="${e.good} bonnes réponses sur ${e.answers}">
          ${e.grades.map((g) => `<span class="${GRADE_CLASSES[g]}"></span>`).join("")}</div>`);
    case "goal":
      return item("accent", `
        <div class="fil-title">Objectif du jour atteint</div>
        <div class="fil-meta">${e.steps} pas sur ${e.pace} · ${time(e.at)}</div>`);
    case "mastered":
      return item("easy", `
        <div class="fil-title">Mot maîtrisé</div>
        <div class="word-card">
          <span class="word-card-hanzi" lang="zh">${escape(e.hanzi)}</span>
          <div><div class="word-card-pinyin">${escape(e.pinyin)}</div>
            <div class="fil-meta">${escape(e.translation)} · ne revient pas avant 3 semaines</div></div>
        </div>`);
    case "discovered":
      return item("new", `
        <div class="fil-title">${plural(e.count, "nouveau mot découvert", "nouveaux mots découverts")}</div>
        <div class="step-words">${e.words.map((w) => `<span class="hanzi-chip" lang="zh">${escape(w)}</span>`).join("")}
          ${e.count > e.words.length ? `<span class="muted small">+${e.count - e.words.length}</span>` : ""}</div>`);
    case "streak":
      return item("accent", `
        <div class="fil-title">${e.streak} jours d'affilée</div>
        <div class="fil-meta">${e.streak >= e.best ? "C'est ton record !" : `Plus que ${e.best - e.streak + 1} pour battre ton record.`}</div>`);
    case "exercise":
      return item("hard", `
        <div class="fil-title">Nouveau : ${escape(e.name)}</div>
        <div class="fil-meta">Ajouté pour toi${e.unseen ? ` · ${plural(e.unseen, "carte")} à découvrir` : ""}</div>
        <a class="fil-link" href="#/exercices/${e.exercise_id}/test">Commencer</a>`);
    default:
      return "";
  }
}

function filHtml(data) {
  const days = new Map();
  for (const e of data.events) {
    const day = utcDay(e.at);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(e);
  }
  const tomorrow = data.tomorrow.cards ? `
    <h4 class="fil-day">Demain</h4>
    <ul class="fil"><li class="fil-item"><span class="fil-dot future"></span><div class="fil-body">
      <div class="fil-title muted">${plural(data.tomorrow.cards, "carte revient", "cartes reviennent")}</div>
      <div class="fil-meta">Environ ${data.tomorrow.minutes} min, en ${plural(data.tomorrow.steps, "petit pas", "petits pas")}.</div>
    </div></li></ul>` : "";
  const past = [...days].map(([day, events]) => `
    <h4 class="fil-day">${dayLabel(day, data.today)}</h4>
    <ul class="fil">${events.map((e) => eventHtml(e, data)).join("")}</ul>`).join("");
  return `
    <section class="feed-fil">
      <h3>Le fil</h3>
      ${tomorrow}${past || '<p class="muted">Ton fil se remplira au fil de tes révisions : commence par un premier pas.</p>'}
    </section>`;
}

function progressHtml(data) {
  const p = data.progress;
  const seen = p.words_seen || 0;
  const mastered = p.words_mastered || 0;
  return `
    <section class="feed-card feed-progress">
      <h3>Ma progression</h3>
      <div class="progress-line"><strong>${plural(seen, "mot vu", "mots vus")}</strong>
        <span class="muted">${plural(mastered, "maîtrisé", "maîtrisés")}</span></div>
      <div class="mastery-bar"><span style="width: ${seen ? Math.round((mastered / seen) * 100) : 0}%"></span></div>
      <div class="progress-tiles">
        <div><strong>${percent(p.success_month)}</strong><span class="muted small">justes sur 30 jours</span></div>
        <div><strong>${p.days_active || 0}</strong><span class="muted small">jours actifs</span></div>
      </div>
      <a href="#/statistiques" class="small">Voir mes statistiques</a>
      <a href="#/mes-mots" class="small">${data.my_words ? `Mes mots (${data.my_words})` : "Mes mots : garde les mots qui t'intéressent"}</a>
    </section>`;
}

function paceHtml(data) {
  return `
    <section class="feed-card feed-pace">
      <h3>Mon rythme</h3>
      <p class="muted small">${plural(data.pace, "pas", "pas")} par jour, ${data.step_cards} cartes au plus
        chacun. Les pas suivent les cartes à revoir.</p>
      <div class="pace-choices" role="group" aria-label="Pas par jour">
        ${PACES.map((n) => `<button type="button" class="pace${n === data.pace ? " active" : ""}"
          data-pace="${n}" aria-pressed="${n === data.pace}">${n} pas</button>`).join("")}
      </div>
    </section>`;
}

export async function feedView(el) {
  async function load() {
    const data = await api("/feed");
    const name = session.user ? displayName(session.user) : "";
    el.innerHTML = `
      <div class="feed">
        <div class="feed-head">
          <div>
            <h2>Bonjour ${escape(name)}</h2>
            <p class="muted">${subtitle(data)}</p>
          </div>
          ${data.streak ? `<span class="streak-chip" title="Jours d'affilée avec au moins une réponse">${flame} ${plural(data.streak, "jour")}</span>` : ""}
        </div>
        <div class="feed-layout">
          ${stepsHtml(data)}
          ${filHtml(data)}
          <aside class="feed-aside">
            ${weekHtml(data)}
            ${progressHtml(data)}
            ${paceHtml(data)}
          </aside>
        </div>
      </div>`;
    el.querySelectorAll("[data-pace]").forEach((b) => b.addEventListener("click", async () => {
      try {
        await api("/feed/pace", { method: "PUT", body: { steps: Number(b.dataset.pace) } });
        await load();
      } catch (err) {
        toast(`Erreur : ${err.message}`, "error");
      }
    }));
  }
  await load();
}
