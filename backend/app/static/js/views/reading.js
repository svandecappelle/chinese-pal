import { api, escape } from "../api.js";
import { bindSpeakButtons, speakButton } from "../audio.js";
import { attachKeyboard, close as closeKeyboard } from "../keyboard.js";
import { numbersToMarks } from "../pinyin.js";
import { can } from "../session.js";
import { toast } from "../ui.js";
import { openWordDialog } from "./word-dialog.js";

// Lecture assistée : un texte chinois découpé en mots (dictionnaire), le pinyin au-dessus, et
// le sens d'un mot en le touchant. Les mots absents du vocabulaire peuvent y être ajoutés.

const SETTINGS_KEY = "chinese.reading";
const SAMPLE = "我叫小明，是一名大学生。每天早上七点起床，先喝一杯咖啡，然后坐地铁去学校。"
  + "周末我常常和朋友一起去公园散步，有时候也去看电影。";

function readSettings() {
  const defaults = { text: "", pinyin: true, unknown: true };
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

export async function readingView(el) {
  const settings = readSettings();
  const editor = can("manage_vocab");
  let result = null;
  let selected = null;

  el.innerHTML = `
    <h2>Lecture assistée</h2>
    <p class="muted">Colle ou tape un texte en chinois : chaque mot est repéré dans le dictionnaire,
      avec son pinyin. Touche un mot pour voir son sens.</p>
    <div class="card-box reading-input">
      <textarea id="reading-text" rows="4" lang="zh" placeholder="Texte en chinois…"
        aria-label="Texte en chinois">${escape(settings.text)}</textarea>
      <div class="reading-options">
        <label class="check small"><input type="checkbox" id="opt-pinyin" ${settings.pinyin ? "checked" : ""}> Pinyin au-dessus</label>
        <label class="check small"><input type="checkbox" id="opt-unknown" ${settings.unknown ? "checked" : ""}> Souligner les mots hors vocabulaire</label>
        <button type="button" class="secondary small-button" id="sample">Texte d'exemple</button>
        <button type="button" id="read">Lire le texte</button>
      </div>
    </div>
    <div id="reading-out"></div>`;

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
        const cls = `rd-word${info?.word_id ? "" : " unknown"}${t.text === selected ? " selected" : ""}`;
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
      <div class="card-box reading${settings.pinyin ? "" : " no-pinyin"}${settings.unknown ? " mark-unknown" : ""}" lang="zh">
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
        <p class="small"><span class="tag">✓ dans le vocabulaire</span>
          <button type="button" class="link-button" id="rd-open">fiche du mot</button></p>` : `
        ${info.english ? `<p>${escape(info.english)} <small class="muted">(CC-CEDICT, en anglais)</small></p>`
          : '<p class="muted">Absent du dictionnaire : lu caractère par caractère.</p>'}
        ${editor ? `
          <form id="rd-add" class="rd-add">
            <input id="rd-translation" required placeholder="Sens en français" aria-label="Sens en français">
            <button type="submit">Ajouter au vocabulaire</button>
          </form>` : ""}`}`;
    box.querySelector(".rd-close").addEventListener("click", () => {
      selected = null;
      renderText();
    });
    box.querySelector("#rd-open")?.addEventListener("click", () => openWordDialog(info.word_id, {}, () => {}));
    box.querySelector("#rd-add")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = e.target.querySelector("button");
      button.disabled = true;
      try {
        const word = await api("/words", {
          method: "POST",
          body: { hanzi: selected, pinyin, translation: box.querySelector("#rd-translation").value.trim() },
        });
        Object.assign(info, { word_id: word.id, pinyin: word.pinyin, translation: word.translation });
        toast(`${selected} ajouté au vocabulaire.`);
        renderText();
      } catch (err) {
        toast(`Erreur : ${err.message}`, "error");
        button.disabled = false;
      }
    });
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function read() {
    const text = textarea.value.trim();
    settings.text = textarea.value;
    writeSettings(settings);
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
  for (const [id, key] of [["#opt-pinyin", "pinyin"], ["#opt-unknown", "unknown"]]) {
    el.querySelector(id).addEventListener("change", (e) => {
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

  if (settings.text.trim()) read();
  return () => closeKeyboard();
}
