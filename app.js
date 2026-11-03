"use strict";

/** DQ6 守備力計算 — 初期守備力基準のバフとSFC版通常攻撃の最大ダメージ。 */
const STORAGE_KEY = "dq6-defense-calculator-state-v1";
const PARTY_NAMES = ["ドランゴ", "ハッサン", "テリー", "チャモロ"];
const DEFAULT_ATTACK = 410;
const MAX_GAIN = 200;
const EMPTY_STATE = () => ({
  initial: [null, null, null, null],
  maxHp: [null, null, null, null],
  gains: [0, 0, 0, 0],
  attack: DEFAULT_ATTACK,
  buff: false,
  visible: [true, true, true, true]
});

/** 下限 −初期守備力、上限 +200。初期守備力が未入力なら上昇量は0。 */
function clampGain(gain, initial) {
  if (initial === null) return 0;
  return Math.max(-initial, Math.min(MAX_GAIN, Math.trunc(gain)));
}

/** v4 と同じ「初期守備力基準」および各増減量の切り捨て。 */
function nextGain(gain, initial, action) {
  if (initial === null) return gain;
  const quarter = Math.floor(initial / 4);
  const half = Math.floor(initial / 2);
  const delta = action === "lucanan" ? -quarter
    : action === "scala" ? half
    : action === "scrult" ? quarter : 0;
  return clampGain(gain + delta, initial);
}

/**
 * SFC版DQ6・通常攻撃の最大ダメージ（会心・痛恨などは対象外）。
 * 攻略解析サイトの3分岐と、DQ6 RTA資料の通常域の乱数幅を組み合わせる。
 * 整数除算のたびに小数点以下を切り捨てる。
 *
 *  A = 攻撃力、B = 現在守備力
 *  X = A - floor(B / 2), D = floor(X / 2)
 *  (1) X <= 1                        : 0～1       → 最大1
 *  (2) D <= floor(A / 16)           : 0～A/16    → 最大floor(A/16)
 *  (3) その他                       : D ± (floor(D/16)+1)
 *  バイキルトは最終的な通常攻撃ダメージに2倍を適用する。
 *
 * 注：公開資料の整数丸め順とROMの内部処理が完全一致するかは未実機検証。
 * 解析: https://gcgx.games/dq6/damage.html
 * RTA資料: https://game.kuneo.org/dq6/20140108_dq6rta_kuneo.pdf
 */
function damage(attack, currentDefense, buff) {
  const a = Math.max(0, Math.trunc(attack));
  const b = Math.max(0, Math.trunc(currentDefense));
  const x = a - Math.floor(b / 2);
  let maximum;

  if (x <= 1) {
    maximum = 1;
  } else {
    const base = Math.floor(x / 2);
    const weakAttackLimit = Math.floor(a / 16);
    if (base <= weakAttackLimit) {
      maximum = weakAttackLimit;
    } else {
      const randomWidth = Math.floor(base / 16) + 1;
      maximum = base + randomWidth;
    }
  }
  return maximum * (buff ? 2 : 1);
}

function integerOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 9999 ? n : null;
}

/** 最大HPは未入力、または1〜9999の整数のみ有効。 */
function hpOrNull(value) {
  const n = integerOrNull(value);
  return n !== null && n >= 1 ? n : null;
}

function loadState() {
  const blank = EMPTY_STATE();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || !Array.isArray(saved.initial) || !Array.isArray(saved.gains)) return blank;
    blank.initial = PARTY_NAMES.map((_, i) => integerOrNull(saved.initial[i]));
    // v6以前の保存データにはmaxHpがない。空欄として移行する。
    blank.maxHp = PARTY_NAMES.map((_, i) =>
      Array.isArray(saved.maxHp) ? hpOrNull(saved.maxHp[i]) : null);
    blank.gains = PARTY_NAMES.map((_, i) =>
      clampGain(Number.isFinite(Number(saved.gains[i])) ? Number(saved.gains[i]) : 0,
        blank.initial[i]));
    blank.attack = integerOrNull(saved.attack) ?? DEFAULT_ATTACK;
    blank.buff = saved.buff === true;
    // v3以前の保存データにはvisibleがない。初回は4人とも表示する。
    blank.visible = PARTY_NAMES.map((_, i) =>
      Array.isArray(saved.visible) ? saved.visible[i] !== false : true);
    return blank;
  } catch (error) {
    return blank;
  }
}

let state = loadState();
let toastTimeout;

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // ブラウザ設定などで保存できなくても計算は使用できる。
  }
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 2300);
}

/** 戦闘中のキャラクターカードには設定入力を置かない。 */
function cardTemplate(name, i) {
  return `<article class="character" id="character-${i}" data-character="${i}">
    <header class="character-header">
      <h3>${name}</h3><span class="character-index">0${i + 1} / 04</span>
    </header>
    <div class="character-body">
      <div class="metric gain-metric" id="gain-box-${i}">
        <small>初期値からの変化</small><strong id="gain-${i}">0</strong>
      </div>
      <div class="spell-grid">
        <button class="btn spell-lucanan" type="button" data-action="lucanan" data-index="${i}">ルカナン</button>
        <button class="btn spell-scala" type="button" data-action="scala" data-index="${i}">スカラ</button>
        <button class="btn spell-reset" type="button" data-action="reset" data-index="${i}">リセット</button>
      </div>
    </div>
  </article>`;
}

/** カードとは独立した最大ダメージ欄。表示人数に応じてカードと同じ列幅にする。 */
function damageTemplate(name, i) {
  return `<div class="damage-box" id="damage-panel-${i}" role="group" aria-label="${name}の通常攻撃最大ダメージ">
    <span>通常攻撃・最大ダメージ</span><strong id="damage-${i}">—</strong>
  </div>`;
}

/** 初期守備力は画面下部の事前設定に集約する。 */
function initialInputTemplate(name, i) {
  return `<div class="initial-field">
    <label for="initial-${i}">${name}</label>
    <input class="initial-defense" type="number" inputmode="numeric" min="0" max="9999" step="1"
      id="initial-${i}" data-initial="${i}" placeholder="数値を入力" aria-label="${name}の初期守備力">
    <div class="half-defense" id="half-${i}">初期守備力 / 2：—</div>
  </div>`;
}

/** 最大HPは初期守備力のすぐ下の事前設定に配置する。 */
function maxHpInputTemplate(name, i) {
  return `<div class="initial-field hp-field">
    <label for="max-hp-${i}">${name}</label>
    <input class="maximum-hp" type="number" inputmode="numeric" min="1" max="9999" step="1"
      id="max-hp-${i}" data-max-hp="${i}" placeholder="未入力" aria-label="${name}の最大HP">
  </div>`;
}

/** キャラクターの表示・非表示は画面下部から操作する。 */
function visibilityToggleTemplate(name, i) {
  return `<button class="visibility-toggle" type="button" data-visibility-index="${i}"
    aria-controls="character-${i}" aria-pressed="true">
    <span class="visibility-name">${name}</span>
    <span class="visibility-status">表示中</span>
  </button>`;
}

function buildCards() {
  document.getElementById("party-cards").innerHTML = PARTY_NAMES.map(cardTemplate).join("");
  document.getElementById("damage-grid").innerHTML = PARTY_NAMES.map(damageTemplate).join("");
  document.getElementById("initial-inputs").innerHTML = PARTY_NAMES.map(initialInputTemplate).join("");
  document.getElementById("max-hp-inputs").innerHTML = PARTY_NAMES.map(maxHpInputTemplate).join("");
  document.getElementById("visibility-toggles").innerHTML = PARTY_NAMES.map(visibilityToggleTemplate).join("");
  PARTY_NAMES.forEach((_, i) => {
    const input = document.getElementById(`initial-${i}`);
    input.value = state.initial[i] ?? "";
    // 入力を変更したら、画面上部のダメージを即時更新する。
    input.addEventListener("input", () => {
      const initial = integerOrNull(input.value);
      if (input.value !== "" && initial === null) {
        input.setCustomValidity("0～9999の整数を入力してください。");
        return;
      }
      input.setCustomValidity("");
      state.initial[i] = initial;
      state.gains[i] = clampGain(state.gains[i], initial);
      saveState();
      render();
    });
    input.addEventListener("change", () => {
      if (input.value !== "" && integerOrNull(input.value) === null) {
        input.value = state.initial[i] ?? "";
        input.setCustomValidity("");
        showToast("初期守備力は0～9999の整数で入力してください");
      }
    });

    const hpInput = document.getElementById(`max-hp-${i}`);
    hpInput.value = state.maxHp[i] ?? "";
    hpInput.addEventListener("input", () => {
      const hp = hpOrNull(hpInput.value);
      if (hpInput.value !== "" && hp === null) {
        hpInput.setCustomValidity("最大HPは1～9999の整数で入力してください。");
        return;
      }
      hpInput.setCustomValidity("");
      state.maxHp[i] = hp;
      saveState();
      render();
    });
    hpInput.addEventListener("change", () => {
      if (hpInput.value !== "" && hpOrNull(hpInput.value) === null) {
        hpInput.value = state.maxHp[i] ?? "";
        hpInput.setCustomValidity("");
        showToast("最大HPは1～9999の整数で入力してください");
      }
    });
  });
}

function render() {
  const visibleCount = state.visible.filter(Boolean).length;
  const grid = document.getElementById("party-cards");
  grid.dataset.visibleCount = String(visibleCount);
  const damageGrid = document.getElementById("damage-grid");
  damageGrid.dataset.visibleCount = String(visibleCount);
  document.querySelector(".damage-section").hidden = visibleCount === 0;
  document.getElementById("visible-count").textContent = `${visibleCount} / 4 人表示中`;
  document.getElementById("party-empty").hidden = visibleCount !== 0;
  PARTY_NAMES.forEach((_, i) => {
    // DOM要素は破棄しないため、非表示中の値やイベントも維持される。
    document.getElementById(`character-${i}`).hidden = !state.visible[i];
    document.getElementById(`damage-panel-${i}`).hidden = !state.visible[i];
    const toggle = document.querySelector(`[data-visibility-index="${i}"]`);
    toggle.classList.toggle("is-visible", state.visible[i]);
    toggle.classList.toggle("is-hidden", !state.visible[i]);
    toggle.setAttribute("aria-pressed", String(state.visible[i]));
    toggle.querySelector(".visibility-status").textContent = state.visible[i] ? "表示中" : "非表示";
    toggle.setAttribute("aria-label", `${PARTY_NAMES[i]}を${state.visible[i] ? "非表示にする" : "表示する"}`);
    const initial = state.initial[i];
    const gain = state.gains[i];
    const enabled = initial !== null;
    const current = enabled ? initial + gain : null;
    document.getElementById(`half-${i}`).textContent =
      `初期守備力 / 2：${enabled ? Math.floor(initial / 2) : "—"}`;
    document.getElementById(`gain-${i}`).textContent = gain > 0 ? `+${gain}` : `${gain}`;
    const maxDamage = enabled ? damage(state.attack, current, state.buff) : null;
    document.getElementById(`damage-${i}`).textContent = maxDamage ?? "—";
    const hp = state.maxHp[i];
    // 最大HPが未入力のときは判定しない。ちょうど同値の場合も赤くする。
    const lethal = maxDamage !== null && hp !== null && maxDamage >= hp;
    const damagePanel = document.getElementById(`damage-panel-${i}`);
    damagePanel.classList.toggle("damage-lethal", lethal);
    damagePanel.setAttribute("aria-label", `${PARTY_NAMES[i]}の通常攻撃最大ダメージ：${maxDamage ?? "未計算"}${lethal ? "。最大HP以上のため警告" : ""}`);
    const box = document.getElementById(`gain-box-${i}`);
    box.classList.toggle("gain-positive", gain > 0);
    box.classList.toggle("gain-negative", gain < 0);
    document.querySelectorAll(`[data-action][data-index="${i}"]`).forEach(button => {
      button.disabled = !enabled && button.dataset.action !== "reset";
    });
  });
  document.getElementById("buff-off").classList.toggle("selected", !state.buff);
  document.getElementById("buff-on").classList.toggle("selected", state.buff);
  document.getElementById("buff-off").setAttribute("aria-pressed", String(!state.buff));
  document.getElementById("buff-on").setAttribute("aria-pressed", String(state.buff));
  document.querySelectorAll("[data-party-action]").forEach(button => {
    button.disabled = state.initial.every(v => v === null);
  });
}

function applyAction(action, indices) {
  let affected = 0;
  indices.forEach(i => {
    if (action === "reset") {
      state.gains[i] = 0;
      affected++;
    } else if (state.initial[i] !== null) {
      state.gains[i] = nextGain(state.gains[i], state.initial[i], action);
      affected++;
    }
  });
  if (!affected) { showToast("先に初期守備力を入力してください"); return; }
  saveState();
  render();
}

function connectActions() {
  document.getElementById("visibility-toggles").addEventListener("click", e => {
    const button = e.target.closest("button[data-visibility-index]");
    if (!button) return;
    const i = Number(button.dataset.visibilityIndex);
    if (!Number.isInteger(i) || i < 0 || i >= PARTY_NAMES.length) return;
    state.visible[i] = !state.visible[i];
    saveState();
    render();
  });
  document.getElementById("party-cards").addEventListener("click", e => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    applyAction(btn.dataset.action, [Number(btn.dataset.index)]);
  });
  document.querySelector(".party-actions-buttons").addEventListener("click", e => {
    const btn = e.target.closest("button[data-party-action]");
    if (!btn) return;
    applyAction(btn.dataset.partyAction, [0,1,2,3]);
  });
  document.getElementById("buff-off").addEventListener("click", () => {
    state.buff = false;saveState();render();
  });
  document.getElementById("buff-on").addEventListener("click", () => {
    state.buff = true;saveState();render();
  });
  const attackInput = document.getElementById("attack-value");
  attackInput.value = state.attack;
  attackInput.addEventListener("input", () => {
    const n = integerOrNull(attackInput.value);
    if (n === null) return;
    state.attack = n;
    saveState();render();
  });
  attackInput.addEventListener("change", () => {
    const n = integerOrNull(attackInput.value);
    if (n === null) {
      attackInput.value = state.attack;
      showToast("攻撃力は0～9999の整数で入力してください");
    }
  });
  document.getElementById("reset-all-settings").addEventListener("click", () => {
    state.gains = [0,0,0,0];
    state.attack = DEFAULT_ATTACK;
    state.buff = false;
    // 初期守備力・最大HP・キャラ表示設定はすべて保持する。
    attackInput.value = DEFAULT_ATTACK;
    saveState();render();
    showToast("データをリセットしました（初期守備力・最大HP・表示設定は保持）");
  });
}

function registerOffline() {
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
}

// Node.js による計算テストでもブラウザDOMなしで読み込めるようにする。
if (typeof document !== "undefined") {
  buildCards();
  connectActions();
  render();
  registerOffline();
}

// テスト用：ブラウザ公開を必要としない純粋関数を検証できる。
if (typeof module !== "undefined" && module.exports) {
  module.exports = { clampGain, nextGain, damage, integerOrNull, hpOrNull };
}
