import { api, escape, MODES } from "../api.js";
import { bindSpeakButtons, speakButton } from "../audio.js";
import { session } from "../session.js";
import { toast } from "../ui.js";

// Statistiques personnelles : série de jours, calendrier des réponses, réussite par mode
// et mots les plus ratés (à retravailler).

const DAY_MS = 86400000;
const WEEKS = 53;
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

const percent = (value) => (value === null || value === undefined ? "—" : `${Math.round(value * 100)} %`);
const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;

function utcDate(text) {
  const [y, m, d] = text.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const isoDay = (date) => date.toISOString().slice(0, 10);

function level(answers) {
  if (!answers) return 0;
  if (answers < 10) return 1;
  if (answers < 30) return 2;
  if (answers < 60) return 3;
  return 4;
}

// Une colonne par semaine (lundi en haut), la dernière contient aujourd'hui.
function calendarHtml(stats) {
  const byDay = new Map(stats.calendar.map((d) => [d.day, d]));
  const today = utcDate(stats.today);
  const weekday = (today.getUTCDay() + 6) % 7;
  const start = new Date(today.getTime() - (weekday + (WEEKS - 1) * 7) * DAY_MS);
  const cells = [];
  const months = [];
  for (let i = 0; i < WEEKS * 7; i += 1) {
    const date = new Date(start.getTime() + i * DAY_MS);
    if (i % 7 === 0 && date.getUTCDate() <= 7) {
      months.push(`<span style="grid-column: ${i / 7 + 1}">${MONTHS[date.getUTCMonth()]}</span>`);
    }
    if (date > today) {
      cells.push('<span class="cal-day future"></span>');
      continue;
    }
    const day = byDay.get(isoDay(date));
    const label = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} : ${
      day ? `${plural(day.answers, "réponse")}, ${percent(day.good / day.answers)} réussies` : "aucune réponse"}`;
    cells.push(`<span class="cal-day l${level(day?.answers)}" title="${label}"></span>`);
  }
  return `
    <div class="cal-scroll" id="cal-scroll">
      <div class="cal">
        <div class="cal-months">${months.join("")}</div>
        <div class="cal-grid">${cells.join("")}</div>
      </div>
    </div>
    <p class="cal-legend muted small">Moins
      ${[0, 1, 2, 3, 4].map((l) => `<span class="cal-day l${l}"></span>`).join("")} Plus
      · ${plural(stats.days_active, "jour")} de révision en tout</p>`;
}

function modesHtml(stats) {
  if (!stats.modes.length) return '<p class="muted">Aucune réponse ces 30 derniers jours.</p>';
  return `<ul class="mode-stats">${stats.modes.map((m) => {
    const rate = m.good / m.answers;
    return `
      <li>
        <span class="mode-name">${escape(MODES[m.mode]?.label ?? m.mode)}</span>
        <span class="mode-bar" title="${percent(rate)} de réussite"><span style="width: ${rate * 100}%"></span></span>
        <span class="mode-rate">${percent(rate)}</span>
        <small class="muted">${plural(m.answers, "réponse")}</small>
      </li>`;
  }).join("")}</ul>`;
}

function difficultHtml(stats) {
  if (!stats.difficult.length) {
    return '<p class="muted">Aucun mot raté ces 90 derniers jours. Bravo !</p>';
  }
  return `
    <div class="actions">
      <a class="button" href="#/statistiques/reviser">Retravailler ces mots</a>
      <button type="button" class="secondary" id="make-due"
        title="Ils reviendront dans le prochain test des exercices qui les contiennent">Les remettre au prochain test</button>
    </div>
    <ul class="difficult-list">${stats.difficult.map((w) => `
      <li>
        <span class="difficult-hanzi" lang="zh">${escape(w.hanzi)}</span>
        ${speakButton(w.hanzi, { pinyin: w.pinyin })}
        <span class="difficult-word">
          <span>${escape(w.pinyin)} · ${escape(w.translation)}</span>
          <small class="muted">${(w.modes || []).map((m) => escape(MODES[m]?.label ?? m)).join(" · ")}</small>
        </span>
        <span class="difficult-misses" title="Réponses ratées sur ${w.answers}">${w.misses}/${w.answers}</span>
      </li>`).join("")}</ul>`;
}

export async function statsView(el) {
  const stats = await api("/stats");
  bindSpeakButtons(el);
  const guestNote = !session.user
    ? `<p class="muted small">Sans compte, ta progression est gardée dans ce navigateur.
         <a href="#/connexion">Connecte-toi</a> pour la retrouver partout.</p>`
    : "";

  if (stats.empty) {
    el.innerHTML = `
      <h2>Mes statistiques</h2>
      <div class="empty">
        <p>Pas encore de réponse : lance le test d'un exercice, tes statistiques apparaîtront ici.</p>
        <p><a class="button" href="#/">Voir les exercices</a></p>
      </div>
      ${guestNote}`;
    return;
  }

  const tiles = [
    ["🔥", plural(stats.streak, "jour"), stats.reviewed_today || !stats.streak
      ? "d'affilée" : "d'affilée · révise aujourd'hui pour la garder"],
    ["🏆", plural(stats.best_streak, "jour"), "meilleure série"],
    ["✍", stats.answers_today, "réponses aujourd'hui"],
    ["🎯", percent(stats.success_month), "réussite sur 30 jours"],
    ["📚", stats.words_seen, "mots déjà vus"],
    ["⭐", stats.words_mastered, "mots maîtrisés"],
    ["⏰", stats.due, "cartes à revoir"],
  ];

  el.innerHTML = `
    <h2>Mes statistiques</h2>
    ${guestNote}
    <div class="stat-tiles">
      ${tiles.map(([icon, value, label]) => `
        <div class="stat-tile">
          <span class="stat-icon" aria-hidden="true">${icon}</span>
          <strong>${value}</strong>
          <small class="muted">${label}</small>
        </div>`).join("")}
    </div>
    <p class="muted small">Un mot est maîtrisé quand toutes ses cartes ne reviennent qu'après trois semaines ou plus.</p>
    <section class="card-box stats-section">
      <h3>Calendrier</h3>
      ${calendarHtml(stats)}
    </section>
    <section class="card-box stats-section">
      <h3>Réussite par exercice <small class="muted">(30 derniers jours)</small></h3>
      ${modesHtml(stats)}
    </section>
    <section class="card-box stats-section">
      <h3>Mots les plus ratés <small class="muted">(90 derniers jours)</small></h3>
      ${difficultHtml(stats)}
    </section>`;

  // Le calendrier commence par la semaine en cours (à droite) sur petit écran.
  const scroller = el.querySelector("#cal-scroll");
  scroller.scrollLeft = scroller.scrollWidth;

  el.querySelector("#make-due")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const { cards } = await api("/stats/difficult-words/due", { method: "POST" });
      toast(cards ? `${plural(cards, "carte")} à revoir dès le prochain test.` : "Ces mots sont déjà à revoir.");
    } catch (err) {
      toast(`Erreur : ${err.message}`, "error");
      e.target.disabled = false;
    }
  });
}
