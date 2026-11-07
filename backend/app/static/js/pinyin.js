// Saisie et vérification du pinyin.
// Formats acceptés : "ni3 hao3", "ni3hao3", "nǐ hǎo", "lv4" / "lu:4" (= lǜ), ton neutre sans chiffre ou 5/0.

const TONE_MARKS = {
  a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", ü: "ǖǘǚǜ",
};

// Règle de placement : a ou e en priorité, o dans "ou", sinon la dernière voyelle du groupe.
// Les majuscules sont conservées ("Bei3jing1" → "Běijīng").
function markSyllable(letters, tone) {
  if (tone < 1 || tone > 4) return letters;
  const lower = letters.toLowerCase();
  const cluster = [...lower.matchAll(/[aeiouü]+/g)].pop();
  if (!cluster) return letters;
  let offset = cluster[0].search(/[ae]/);
  if (offset < 0) offset = cluster[0].indexOf("ou");
  if (offset < 0) offset = cluster[0].length - 1;
  const pos = cluster.index + offset;
  let mark = TONE_MARKS[lower[pos]][tone - 1];
  if (letters[pos] !== lower[pos]) mark = mark.toUpperCase();
  return letters.slice(0, pos) + mark + letters.slice(pos + 1);
}

/** Convertit les chiffres de ton en accents : "ni3 hao3" → "nǐ hǎo". */
export function numbersToMarks(input) {
  return input
    .replace(/u:|v/g, "ü")
    .replace(/U:|V/g, "Ü")
    .replace(/([a-zA-ZüÜ]+)([0-5])/g, (_, letters, tone) => markSyllable(letters, Number(tone)));
}

const normalize = (s) =>
  numbersToMarks(s).toLowerCase().normalize("NFC").replace(/[\s'’\-·.,!?。，！？]/g, "");

// Retire les accents de ton mais garde le tréma du ü.
const stripTones = (s) =>
  s.normalize("NFD").replace(/[̀́̄̌]/g, "").normalize("NFC");

/**
 * Compare une saisie au pinyin attendu.
 * Renvoie "empty", "correct", "tones" (bonnes syllabes, tons faux) ou "wrong".
 */
export function checkPinyin(input, expected) {
  const given = normalize(input);
  const target = normalize(expected);
  if (!given) return "empty";
  if (given === target) return "correct";
  if (stripTones(given) === stripTones(target)) return "tones";
  return "wrong";
}

// Syllabes du mandarin sans ton (ü noté v), pour découper un pinyin tapé sans espaces.
const SYLLABLES = new Set(
  [
    "a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu ca cai can ",
    "cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai ",
    "chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo da dai dan dang dao de dei den ",
    "deng di dia dian diao die ding diu dong dou du duan dui dun duo e ei en eng er fa fan fang ",
    "fei fen feng fiao fo fou fu ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan ",
    "guang gui gun guo ha hai han hang hao he hei hen heng hm hong hou hu hua huai huan huang ",
    "hui hun huo ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ka kai kan kang ",
    "kao ke ken keng kong kou ku kua kuai kuan kuang kui kun kuo la lai lan lang lao le lei leng ",
    "li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lv lve m ma mai man ",
    "mang mao me mei men meng mi mian miao mie min ming miu mo mou mu n na nai nan nang nao ne ",
    "nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nun nuo nv nve o ou pa ",
    "pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu qi qia qian qiang qiao ",
    "qie qin qing qiong qiu qu quan que qun ran rang rao re ren reng ri rong rou ru rua ruan rui ",
    "run ruo sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi ",
    "shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo ta tai tan ",
    "tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo wa wai wan wang wei wen ",
    "weng wo wu xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ya yan yang yao ye ",
    "yi yin ying yo yong you yu yuan yue yun za zai zan zang zao ze zei zen zeng zha zhai zhan ",
    "zhang zhao zhe zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong ",
    "zou zu zuan zui zun zuo",
  ]
    .join("")
    .split(" ")
);

/** Découpe "nihao" en ["ni", "hao"] (le moins de syllabes possible), ou null si impossible. */
function splitSyllables(letters) {
  const best = [[]];
  for (let end = 1; end <= letters.length; end++) {
    for (let start = Math.max(0, end - 6); start < end; start++) {
      const syllable = letters.slice(start, end);
      if (best[start] && SYLLABLES.has(syllable) && (!best[end] || best[start].length + 1 < best[end].length)) {
        best[end] = [...best[start], syllable];
      }
    }
  }
  return best[letters.length] ?? null;
}

/**
 * Met le ton (1–4, 0 = neutre) sur la dernière syllabe d'un texte, en remplaçant un ton déjà
 * présent : "nǐhao" + 3 → "nǐhǎo", "nǐ" + 2 → "ní".
 */
export function toneLastSyllable(text, tone) {
  const run = text.match(/[a-zA-ZÀ-ɏ]+$/)?.[0];
  if (!run) return text;
  // Même longueur que `run` : chaque lettre accentuée devient une seule lettre de base.
  const letters = stripTones(run).toLowerCase().replace(/ü/g, "v");
  const syllables = splitSyllables(letters);
  const start = syllables ? run.length - syllables.at(-1).length : 0;
  const syllable = stripTones(run.slice(start)).replace(/v/g, "ü").replace(/V/g, "Ü");
  return text.slice(0, text.length - run.length + start) + (tone ? markSyllable(syllable, tone) : syllable);
}
