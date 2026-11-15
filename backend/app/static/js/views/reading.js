import { api, escape } from "../api.js";
import { bindSpeakButtons, speakButton } from "../audio.js";
import { attachKeyboard, close as closeKeyboard } from "../keyboard.js";
import { numbersToMarks } from "../pinyin.js";
import { can, session } from "../session.js";
import { toast } from "../ui.js";
import { openTextEditor, setTextHidden } from "./text-editor.js";
import { openWordDialog, toggleMyWord } from "./word-dialog.js";

// Lecture assistée : un texte chinois découpé en mots (dictionnaire), le pinyin au-dessus, et
// le sens d'un mot en le touchant. Les mots absents du vocabulaire peuvent y être ajoutés ; ceux
// du vocabulaire, gardés dans Mes mots (compte connecté). Avec une progression, les mots du
// vocabulaire pas encore révisés sont surlignés. Textes gradués : #/lecture?texte=3.

const SETTINGS_KEY = "chinese.reading";
const SAMPLE = "我叫小明，是一名大学生。每天早上七点起床，先喝一杯咖啡，然后坐地铁去学校。"
  + "周末我常常和朋友一起去公园散步，有时候也去看电影。";

function readSettings() {
  const defaults = { text: "", pinyin: true, unknown: true, fresh: true };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return defaults;
  }
}

function writeSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Stockage indisponible : le texte ne sera pas gardé.
  }
}

// Pinyin affiché d'un mot : celui du vocabulaire, sinon la lecture du dictionnaire.
const pinyinOf = (info) => info?.pinyin || (info?.reading ? numbersToMarks(info.reading).replace(/ /g, "") : "");

// Textes gradués déjà lus (dans ce navigateur).
const READ_KEY = "chinese.textsRead";

function readTexts() {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function markRead(id, read) {
  const done = readTexts();
  if (read) done.add(id);
  else done.delete(id);
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...done]));
  } catch {
    // Stockage indisponible : la marque ne sera pas gardée.
  }
}

const plural = (n, word, words = `${word}s`) => `${n} ${n > 1 ? words : word}`;

function textCard(t, done, editor) {
  const known = t.known === null ? null : Math.round(t.known * 100);
  const card = `
    <a class="text-card${t.fits ? " fits" : ""}${t.hidden ? " is-hidden" : ""}" href="#/lecture?texte=${t.id}">
      <span class="text-card-tags"><span class="tag">HSK ${t.level}</span>
        ${t.hidden ? '<span class="tag hidden-tag">Masqué</span>' : ""}
        ${t.fits ? '<span class="tag fit">À ta mesure</span>' : ""}
        ${done.has(t.id) ? '<span class="tag done">✓ Lu</span>' : ""}</span>
      <span class="text-card-title" lang="zh">${escape(t.title)}</span>
      <span class="muted small">${escape(t.title_fr)}</span>
      ${known === null ? `<span class="muted small">${plural(t.words, "mot")} · ${t.length} caractères</span>` : `
        <span class="text-known" aria-label="${known} % de mots connus"><span style="width: ${known}%"></span></span>
        <span class="muted small">${known} % de mots connus${t.new_words.length ? ` · ${plural(t.new_words.length, "nouveau", "nouveaux")}` : ""}</span>`}
    </a>`;
  if (!editor) return card;
  return `
    <div class="text-card-wrap">
      ${card}
      <div class="text-card-tools">
        <button type="button" class="link-button small" data-edit="${t.id}">✎ Modifier</button>
        <button type="button" class="link-button small" data-hide="${t.id}" data-hidden="${t.hidden}">${t.hidden ? "Afficher" : "Masquer"}</button>
      </div>
    </div>`;
}

async function gradedTexts(box) {
  let data;
  try {
    data = await api("/texts");
  } catch {
    box.remove();
    return;
  }
  const done = readTexts();
  const editor = data.can_edit;
  const hiddenCount = data.texts.filter((t) => t.hidden).length;
  box.innerHTML = `
    <div class="feed-card-head"><h3>Textes gradués</h3>
      <span class="muted small">${data.progress ? "« À ta mesure » : surtout des mots que tu as déjà vus" : "Textes courts, par niveau HSK"}</span>
      ${editor ? '<button type="button" class="secondary small-button" id="text-new">＋ Nouveau texte</button>' : ""}</div>
    ${editor && hiddenCount ? `<p class="muted small">${plural(hiddenCount, "texte masqué", "textes masqués")} aux élèves (visible${hiddenCount > 1 ? "s" : ""} des professeurs seulement).</p>` : ""}
    ${data.texts.length ? `<div class="text-cards">${data.texts.map((t) => textCard(t, done, editor)).join("")}</div>`
      : '<p class="muted">Aucun texte pour l\'instant.</p>'}`;
  if (!editor) return;
  const refresh = () => gradedTexts(box);
  box.querySelector("#text-new").addEventListener("click", () =>
    openTextEditor(null, (saved) => { location.hash = `#/lecture?texte=${saved.id}`; }));
  box.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", async () => {
    try {
      openTextEditor(await api(`/texts/${b.dataset.edit}`), refresh);
    } catch (err) {
      toast(`Erreur : ${err.message}`, "error");
    }
  }));
  box.querySelectorAll("[data-hide]").forEach((b) => b.addEventListener("click", async () => {
    try {
      await setTextHidden(Number(b.dataset.hide), b.dataset.hidden !== "true");
      refresh();
    } catch (err) {
      toast(`Erreur : ${err.message}`, "error");
    }
  }));
}

export async function readingView(el, { query } = {}) {
  const settings = readSettings();
  const textId = Number(query?.get("texte")) || null;
  const graded = textId ? await api(`/texts/${textId}`) : null;
  const progress = Boolean(session.user || session.guest);
  const editor = can("manage_vocab");
  // Mots déjà gardés dans Mes mots (du vocabulaire ou personnels).
  const mine = new Set();
  if (session.user) {
    api("/my-words").then((data) => data.words.forEach((w) => mine.add(w.word_id))).catch(() => {});
  }
  let result = null;
  let selected = null;

  el.innerHTML = `
    ${graded ? `
      <p class="small"><a href="#/lecture">← Tous les textes</a></p>
      <div class="toolbar text-head">
        <div>
          <p class="text-card-tags"><span class="tag">HSK ${graded.level}</span>
            ${graded.hidden ? '<span class="tag hidden-tag">Masqué aux élèves</span>' : ""}</p>
          <h2 lang="zh">${escape(graded.title)} <small class="muted">${escape(graded.title_fr)}</small></h2>
          <p class="muted small">${graded.known === null
            ? `${plural(graded.words, "mot")}`
            : `${Math.round(graded.known * 100)} % de mots connus${graded.new_words.length
              ? ` · ${plural(graded.new_words.length, "mot nouveau", "mots nouveaux")}, surlignés` : ""}`}</p>
        </div>
        <div class="actions">
          ${session.user && graded.new_word_ids.length ? `<button type="button" class="secondary small-button" id="keep-new">＋ Garder les ${plural(graded.new_word_ids.length, "mot nouveau", "mots nouveaux")}</button>` : ""}
          <button type="button" class="secondary small-button" id="mark-read" aria-pressed="false"></button>
          ${graded.can_edit ? `
            <button type="button" class="secondary small-button" id="text-edit">✎ Modifier</button>
            <button type="button" class="secondary small-button" id="text-hide">${graded.hidden ? "Afficher aux élèves" : "Masquer aux élèves"}</button>` : ""}
        </div>
      </div>
      ${graded.translation ? `<details class="card-box text-translation"><summary>Traduction</summary><p>${escape(graded.translation)}</p></details>` : ""}` : `
    <h2>Lecture assistée</h2>
    <section class="card-box graded-texts" id="graded"><p class="muted">Chargement des textes…</p></section>
    <p class="muted">Ou colle et tape ton propre texte en chinois : chaque mot est repéré dans le
      dictionnaire, avec son pinyin. Touche un mot pour voir son sens.</p>`}
    <div class="card-box reading-input" ${graded ? "hidden" : ""}>
      <textarea id="reading-text" rows="4" lang="zh" placeholder="Texte en chinois…"
        aria-label="Texte en chinois">${escape(graded ? graded.text : settings.text)}</textarea>
      <div class="reading-options">
        <label class="check small"><input type="checkbox" id="opt-pinyin" ${settings.pinyin ? "checked" : ""}> Pinyin au-dessus</label>
        <label class="check small"><input type="checkbox" id="opt-unknown" ${settings.unknown ? "checked" : ""}> Souligner les mots hors vocabulaire</label>
        ${progress ? `<label class="check small"><input type="checkbox" id="opt-fresh" ${settings.fresh ? "checked" : ""}> Surligner mes mots nouveaux</label>` : ""}
        <button type="button" class="secondary small-button" id="sample">Texte d'exemple</button>
        <button type="button" id="read">Lire le texte</button>
      </div>
    </div>
    ${graded ? `<div class="reading-options text-options">
      <label class="check small"><input type="checkbox" id="opt-pinyin-2" ${settings.pinyin ? "checked" : ""}> Pinyin au-dessus</label>
      ${progress ? `<label class="check small"><input type="checkbox" id="opt-fresh-2" ${settings.fresh ? "checked" : ""}> Surligner mes mots nouveaux</label>` : ""}
    </div>` : ""}
    <div id="reading-out"></div>`;
  if (!graded) gradedTexts(el.querySelector("#graded"));
  if (graded) bindGraded();
  // Professeurs : modifier ou masquer le texte, puis l'afficher de nouveau.
  const reload = () => readingView(el, { query });
  el.querySelector("#text-edit")?.addEventListener("click", () => openTextEditor(graded, reload));
  el.querySelector("#text-hide")?.addEventListener("click", async () => {
    try {
      await setTextHidden(graded.id, !graded.hidden);
      reload();
    } catch (err) {
      toast(`Erreur : ${err.message}`, "error");
    }
  });

  bindSpeakButtons(el);
  const textarea = el.querySelector("#reading-text");
  attachKeyboard(textarea, "hanzi");
  const out = el.querySelector("#reading-out");

  // Une ponctuation reste collée au mot qui la précède (jamais en début de ligne).
  function textHtml() {
    const parts = [];
    for (const t of result.tokens) {
      if (t.word) {
        const info = result.words[t.text];
        const fresh = info?.word_id && info.seen === false;
        const cls = `rd-word${info?.word_id ? "" : " unknown"}${fresh ? " fresh" : ""}${t.text === selected ? " selected" : ""}`;
        parts.push(`<button type="button" class="${cls}" data-word="${escape(t.text)}"><ruby>${escape(t.text)}<rt>${escape(pinyinOf(info))}</rt></ruby></button>`);
        continue;
      }
      const [, glued, rest] = t.text.match(/^([，。！？、；：,.!?;:」』）》”’…]*)([\s\S]*)$/);
      if (glued && parts.length) parts.push(`<span class="rd-glue">${parts.pop()}${escape(glued)}</span>`);
      else if (glued) parts.push(escape(glued));
      parts.push(escape(rest).replace(/\n/g, "<br>"));
    }
    return parts.join("");
  }

  function renderText() {
    if (!result) return;
    const unknown = Object.entries(result.words).filter(([, w]) => !w.word_id).map(([h]) => h);
    out.innerHTML = `
      <div class="card-box reading${settings.pinyin ? "" : " no-pinyin"}${settings.unknown ? " mark-unknown" : ""}${settings.fresh ? " mark-fresh" : ""}" lang="zh">
        ${textHtml()}
      </div>
      <div id="rd-detail" class="rd-detail card-box" ${selected ? "" : "hidden"}></div>
      ${unknown.length ? `
        <section class="card-box reading-unknown">
          <h3>Hors vocabulaire <small class="muted">(${unknown.length})</small></h3>
          <p class="rd-chips">${unknown.map((h) => `<button type="button" class="tag rd-chip" data-word="${escape(h)}" lang="zh">${escape(h)}</button>`).join("")}</p>
        </section>` : '<p class="muted small">Tous les mots du texte sont dans le vocabulaire.</p>'}`;
    if (selected) renderDetail();
  }

  function renderDetail() {
    const box = out.querySelector("#rd-detail");
    const info = result.words[selected];
    if (!box || !info) return;
    box.hidden = false;
    const pinyin = pinyinOf(info);
    box.innerHTML = `
      <button type="button" class="icon-button rd-close" aria-label="Fermer">✕</button>
      <div class="rd-head">
        <span class="rd-hanzi" lang="zh">${escape(selected)}</span>
        ${speakButton(selected, { pinyin })}
        <span class="rd-pinyin">${escape(pinyin)}</span>
      </div>
      ${info.word_id ? `
        <p>${escape(info.translation)}</p>
        <p class="small"><span class="tag">${info.personal ? "✓ mot personnel" : "✓ dans le vocabulaire"}</span>
          <button type="button" class="link-button" id="rd-open">fiche du mot</button></p>
        ${session.user ? `<button type="button" class="secondary small-button" id="rd-mine"
          aria-pressed="${mine.has(info.word_id)}">${mine.has(info.word_id) ? "✓ Dans Mes mots · retirer" : "＋ Mes mots"}</button>` : ""}` : `
        ${info.english ? `<p>${escape(info.english)} <small class="muted">(CC-CEDICT, en anglais)</small></p>`
          : '<p class="muted">Absent du dictionnaire : lu caractère par caractère.</p>'}
        ${session.user ? `
          <form id="rd-add" class="rd-add">
            <input id="rd-pinyin" required value="${escape(pinyin)}" placeholder="Pinyin" aria-label="Pinyin">
            <input id="rd-translation" required maxlength="200" placeholder="Sens en français" aria-label="Sens en français">
            <button type="submit" value="mine">＋ Mes mots</button>
            ${editor ? '<button type="submit" value="vocab" class="secondary">Ajouter au vocabulaire</button>' : ""}
          </form>
          <p class="muted small">${editor ? "Mes mots : pour toi seul, avec ton sens. Vocabulaire : pour tout le monde."
            : "Le mot entre dans tes révisions avec le sens que tu lui donnes ; il reste visible de toi seul."}</p>` : ""}`}`;
    box.querySelector(".rd-close").addEventListener("click", () => {
      selected = null;
      renderText();
    });
    box.querySelector("#rd-open")?.addEventListener("click", () => openWordDialog(info.word_id, {}, () => {}));
    box.querySelector("#rd-mine")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        const inList = mine.has(info.word_id);
        if (inList && info.personal && !confirm(`${selected} est un mot personnel : le retirer le supprime, avec ta progression. Continuer ?`)) {
          e.target.disabled = false;
          return;
        }
        await toggleMyWord(info.word_id, selected, inList);
        if (inList) mine.delete(info.word_id);
        else mine.add(info.word_id);
        // Mot personnel retiré : supprimé, il redevient hors vocabulaire.
        if (inList && info.personal) {
          Object.assign(info, { word_id: null, pinyin: null, translation: null, personal: false, seen: null });
          renderText();
          return;
        }
      } catch (err) {
        toast(`Erreur : ${err.message}`, "error");
      }
      renderDetail();
    });
    box.querySelector("#rd-add")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const buttons = e.target.querySelectorAll("button");
      buttons.forEach((b) => { b.disabled = true; });
      const body = {
        hanzi: selected,
        pinyin: box.querySelector("#rd-pinyin").value.trim(),
        translation: box.querySelector("#rd-translation").value.trim(),
      };
      try {
        if (e.submitter?.value === "vocab") {
          const word = await api("/words", { method: "POST", body });
          Object.assign(info, { word_id: word.id, pinyin: word.pinyin, translation: word.translation, personal: false, seen: progress ? false : null });
          toast(`${selected} ajouté au vocabulaire.`);
        } else {
          const word = await api("/my-words", { method: "POST", body });
          Object.assign(info, { word_id: word.word_id, pinyin: word.pinyin, translation: word.translation, personal: word.personal, seen: progress ? false : null });
          mine.add(word.word_id);
          toast(`${selected} gardé dans Mes mots : il entre dans tes pas du fil.`, "success");
        }
        renderText();
      } catch (err) {
        toast(`Erreur : ${err.message}`, "error");
        buttons.forEach((b) => { b.disabled = false; });
      }
    });
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function read() {
    const text = textarea.value.trim();
    // Un texte gradué ne remplace pas le texte de l'élève.
    if (!graded) {
      settings.text = textarea.value;
      writeSettings(settings);
    }
    closeKeyboard();
    if (!text) {
      out.innerHTML = "";
      return;
    }
    const button = el.querySelector("#read");
    button.disabled = true;
    try {
      result = await api("/ime/lecture", { method: "POST", body: { text } });
      selected = null;
      renderText();
    } catch (err) {
      out.innerHTML = `<p class="error">Erreur : ${escape(err.message)}</p>`;
    } finally {
      button.disabled = false;
    }
  }

  el.querySelector("#read").addEventListener("click", read);
  el.querySelector("#sample").addEventListener("click", () => {
    textarea.value = SAMPLE;
    read();
  });
  for (const [id, key] of [["#opt-pinyin", "pinyin"], ["#opt-unknown", "unknown"], ["#opt-fresh", "fresh"],
    ["#opt-pinyin-2", "pinyin"], ["#opt-fresh-2", "fresh"]]) {
    el.querySelector(id)?.addEventListener("change", (e) => {
      settings[key] = e.target.checked;
      writeSettings(settings);
      renderText();
    });
  }
  out.addEventListener("click", (e) => {
    const word = e.target.closest("[data-word]");
    if (!word) return;
    selected = word.dataset.word;
    renderText();
  });

  if (textarea.value.trim()) read();
  return () => closeKeyboard();

  function bindGraded() {
    const button = el.querySelector("#mark-read");
    const render = () => {
      const done = readTexts().has(graded.id);
      button.textContent = done ? "✓ Lu" : "J'ai lu ce texte";
      button.setAttribute("aria-pressed", String(done));
    };
    render();
    button.addEventListener("click", () => {
      markRead(graded.id, !readTexts().has(graded.id));
      render();
    });
    el.querySelector("#keep-new")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        for (const id of graded.new_word_ids) {
          await api(`/my-words/${id}`, { method: "PUT" });
          mine.add(id);
        }
        toast(`${plural(graded.new_word_ids.length, "mot gardé", "mots gardés")} dans Mes mots : ils entrent dans tes pas du fil.`, "success");
        e.target.textContent = "✓ Gardés dans Mes mots";
        if (selected) renderDetail();
      } catch (err) {
        toast(`Erreur : ${err.message}`, "error");
        e.target.disabled = false;
      }
    });
  }
}
