"use strict";

/** DQ6 守備力計算 — Google スプレッドシート v4 の計算ルールを移植。 */
const STORAGE_KEY = "dq6-defense-calculator-state-v1";
const PARTY_NAMES = ["ドランゴ", "ハッサン", "テリー", "チャモロ"];
const DEFAULT_ATTACK = 410;
const MAX_GAIN = 200;
const EMPTY_STATE = () => ({
  initial: [null, null, null, null],
  gains: [0, 0, 0, 0],
  attack: DEFAULT_ATTACK,
  buff: false
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

function damage(attack, currentDefense, buff) {
  // スプレッドシートの ROUNDDOWN( ..., 0) と同様、0方向に切り捨てる。
  return Math.trunc((attack / 2 - currentDefense / 4) * (buff ? 2 : 1));
}

function integerOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 9999 ? n : null;
}

function loadState() {
  const blank = EMPTY_STATE();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || !Array.isArray(saved.initial) || !Array.isArray(saved.gains)) return blank;
    blank.initial = PARTY_NAMES.map((_, i) => integerOrNull(saved.initial[i]));
    blank.gains = PARTY_NAMES.map((_, i) =>
      clampGain(Number.isFinite(Number(saved.gains[i])) ? Number(saved.gains[i]) : 0,
        blank.initial[i]));
    blank.attack = integerOrNull(saved.attack) ?? DEFAULT_ATTACK;
    blank.buff = saved.buff === true;
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

function cardTemplate(name, i) {
  return `<article class="character" data-character="${i}">
    <header class="character-header"><h3>${name}</h3><span class="character-index">0${i+1} / 04</span></header>
    <div class="character-body">
      <label class="initial-label" for="initial-${i}">初期守備力</label>
      <input class="initial-defense" type="number" inputmode="numeric" min="0" max="9999" step="1" id="initial-${i}" data-initial="${i}" placeholder="数値を入力" aria-label="${name}の初期守備力">
      <div class="half-defense" id="half-${i}">初期守備力 / 2：—</div>
      <div class="metric-area">
        <div class="metric gain-metric" id="gain-box-${i}"><small>上昇量</small><strong id="gain-${i}">0</strong></div>
        <div class="metric"><small>現在守備力</small><strong id="defense-${i}">—</strong></div>
      </div>
      <div class="current-defense"><span>下限 −初期守備力</span><strong id="min-gain-${i}">—</strong></div>
      <div class="damage-box"><span>通常攻撃ダメージ</span><strong id="damage-${i}">—</strong></div>
      <div class="spell-grid">
        <button class="btn spell-lucanan" type="button" data-action="lucanan" data-index="${i}">ルカナン</button>
        <button class="btn spell-scala" type="button" data-action="scala" data-index="${i}">スカラ</button>
        <button class="btn spell-reset" type="button" data-action="reset" data-index="${i}">リセット</button>
      </div>
    </div>
  </article>`;
}

function buildCards() {
  document.getElementById("party-cards").innerHTML = PARTY_NAMES.map(cardTemplate).join("");
  PARTY_NAMES.forEach((_, i) => {
    const input = document.getElementById(`initial-${i}`);
    input.value = state.initial[i] ?? "";
    // 変更途中の空欄を許可して、入力のたびに表示を更新。
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
  });
}

function render() {
  PARTY_NAMES.forEach((_, i) => {
    const initial = state.initial[i];
    const gain = state.gains[i];
    const enabled = initial !== null;
    const current = enabled ? initial + gain : null;
    document.getElementById(`half-${i}`).textContent =
      `初期守備力 / 2：${enabled ? Math.floor(initial / 2) : "—"}`;
    document.getElementById(`gain-${i}`).textContent = gain > 0 ? `+${gain}` : `${gain}`;
    document.getElementById(`defense-${i}`).textContent = enabled ? current : "—";
    document.getElementById(`min-gain-${i}`).textContent = enabled ? `−${initial}` : "—";
    document.getElementById(`damage-${i}`).textContent =
      enabled ? damage(state.attack, current, state.buff) : "—";
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
    const action = button.dataset.partyAction;
    button.disabled = action !== "reset" && state.initial.every(v => v === null);
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
  document.getElementById("party-cards").addEventListener("click", e => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    applyAction(btn.dataset.action, [Number(btn.dataset.index)]);
  });
  document.querySelector(".party-actions-buttons").addEventListener("click", e => {
    const btn = e.target.closest("button[data-party-action]");
    if (!btn) return;
    applyAction(btn.dataset.partyAction, [0,1,2,3]);
    if (btn.dataset.partyAction === "reset") showToast("全員の上昇量を0にしました");
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
    attackInput.value = DEFAULT_ATTACK;
    saveState();render();
    showToast("初期守備力を残して、すべて初期値に戻しました");
  });
}

function registerOffline() {
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
}

buildCards();
connectActions();
render();
registerOffline();

// テスト用：ブラウザ公開を必要としない純粋関数を検証できる。
if (typeof module !== "undefined" && module.exports) {
  module.exports = { clampGain, nextGain, damage, integerOrNull };
}
