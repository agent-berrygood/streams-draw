// 스트림스 숫자 타일 구성: 1~30 각 1장 + 11~19 각 1장 추가 + 조커 1장 = 40장
// 한 게임에 20장을 뽑는다.
const TOTAL_ROUNDS = 20;
const JOKER = '★';
const STORAGE_KEY = 'streams-draw-v1';
const SCORES = [0, 1, 3, 5, 7, 9, 11, 15, 20, 25, 30, 35, 40, 50, 60, 70, 85, 100, 150, 300];

const $ = (id) => document.getElementById(id);
const els = {
  roundNow: $('roundNow'),
  tile: $('tile'),
  tileValue: $('tileValue'),
  caption: $('caption'),
  drawBtn: $('drawBtn'),
  speakBtn: $('speakBtn'),
  undoBtn: $('undoBtn'),
  voiceBtn: $('voiceBtn'),
  voiceLabel: $('voiceLabel'),
  prevValue: $('prevValue'),
  slots: $('slots'),
  scoreBody: $('scoreBody'),
  newBtn: $('newBtn'),
  confirmNew: $('confirmNew'),
  confirmYes: $('confirmYes'),
  confirmNo: $('confirmNo'),
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let busy = false;

function makeTiles() {
  const tiles = [];
  for (let n = 1; n <= 30; n++) {
    tiles.push(n);
    if (n >= 11 && n <= 19) tiles.push(n);
  }
  tiles.push(JOKER);
  return tiles;
}

function randomInt(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function freshGame(voice = true) {
  return { bag: shuffle(makeTiles()), drawn: [], voice };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.bag) && Array.isArray(saved.drawn)
        && saved.bag.length + saved.drawn.length === 40) {
      return saved;
    }
  } catch (_) { /* 저장소를 못 쓰면 새 게임으로 */ }
  return null;
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
}

let state = load() || freshGame();

// ---------- 음성 ----------
let koVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  koVoice = voices.find((v) => v.lang === 'ko-KR') || voices.find((v) => v.lang.startsWith('ko')) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

const REPEAT_GAP_MS = 1600; // 두 번 읽을 때 사이 쉬는 시간
let repeatTimer = null;
let speechId = 0; // 멈추거나 새로 읽으면 바뀌어서, 이전 읽기의 두 번째 읽기를 막는다

function stopSpeaking() {
  speechId++;
  clearTimeout(repeatTimer);
  repeatTimer = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function utter(text, onend) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  if (koVoice) u.voice = koVoice;
  u.rate = 0.8;
  u.pitch = 1;
  if (onend) u.onend = onend;
  speechSynthesis.speak(u);
}

function speak(value) {
  if (!state.voice || !('speechSynthesis' in window) || value == null) return;
  stopSpeaking();
  if (value === JOKER) {
    utter('조커! 원하는 숫자를 쓰세요.');
    return;
  }
  // 한 번 읽고, 다 읽은 뒤 잠깐 쉬었다가 한 번 더 읽는다.
  const text = String(value);
  const id = speechId;
  utter(text, () => {
    if (id !== speechId) return;
    repeatTimer = setTimeout(() => {
      repeatTimer = null;
      if (state.voice) utter(text);
    }, REPEAT_GAP_MS);
  });
}

// ---------- 화면 켜짐 유지 ----------
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (_) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
});

// ---------- 그리기 ----------
function buildStatic() {
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= TOTAL_ROUNDS; i++) {
    const li = document.createElement('li');
    li.dataset.order = i;
    frag.appendChild(li);
  }
  els.slots.appendChild(frag);

  // 점수표: 두 열로 나눠 1~10칸 / 11~20칸
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push(`<tr><td>${i + 1}칸</td><td>${SCORES[i]}</td><td>${i + 11}칸</td><td>${SCORES[i + 10]}</td></tr>`);
  }
  els.scoreBody.innerHTML = rows.join('');
}

function setTile(value, { rolling = false } = {}) {
  els.tile.classList.toggle('is-empty', value == null);
  els.tile.classList.toggle('is-rolling', rolling);
  els.tile.classList.toggle('is-joker', value === JOKER && !rolling);
  els.tileValue.textContent = value == null ? '?' : value;
}

function render() {
  const { drawn } = state;
  const count = drawn.length;
  const last = drawn[count - 1];
  const prev = drawn[count - 2];
  const finished = count >= TOTAL_ROUNDS;

  els.roundNow.textContent = count;
  setTile(last);

  if (count === 0) {
    els.caption.textContent = '아래 버튼을 눌러 첫 숫자를 뽑으세요';
  } else if (finished) {
    els.caption.innerHTML = '<strong>20개를 모두 뽑았어요!</strong><br>점수를 계산해 보세요';
  } else if (last === JOKER) {
    els.caption.innerHTML = `<strong>조커!</strong> 원하는 숫자를 쓰세요 · ${count}번째`;
  } else {
    els.caption.innerHTML = `<strong>${count}번째</strong> 숫자입니다`;
  }

  els.drawBtn.disabled = busy || finished;
  els.drawBtn.classList.toggle('is-finished', finished);
  els.drawBtn.textContent = finished ? '게임 끝' : (count === 0 ? '첫 숫자 뽑기' : '다음 숫자 뽑기');

  els.speakBtn.disabled = busy || count === 0 || !state.voice;
  els.undoBtn.disabled = busy || count === 0;

  els.voiceBtn.setAttribute('aria-pressed', String(state.voice));
  els.voiceLabel.textContent = state.voice ? '소리 켜짐' : '소리 꺼짐';

  els.prevValue.textContent = prev == null ? '–' : prev;
  els.prevValue.classList.toggle('is-joker', prev === JOKER);

  [...els.slots.children].forEach((li, i) => {
    const v = drawn[i];
    li.textContent = v == null ? '' : v;
    li.classList.toggle('is-filled', v != null);
    li.classList.toggle('is-joker', v === JOKER);
    li.classList.toggle('is-latest', i === count - 1);
  });
}

function popTile() {
  if (reduceMotion) return;
  els.tile.classList.remove('pop');
  void els.tile.offsetWidth; // 애니메이션 다시 시작
  els.tile.classList.add('pop');
}

// ---------- 동작 ----------
function draw() {
  if (busy || state.drawn.length >= TOTAL_ROUNDS) return;
  keepAwake();
  busy = true;
  render();

  const finish = () => {
    state.drawn.push(state.bag.pop());
    save();
    busy = false;
    render();
    popTile();
    speak(state.drawn[state.drawn.length - 1]);
  };

  if (reduceMotion) { finish(); return; }

  // 잠깐 숫자가 섞이는 연출 (약 0.7초)
  const started = performance.now();
  const timer = setInterval(() => {
    setTile(1 + randomInt(30), { rolling: true });
    if (performance.now() - started > 700) {
      clearInterval(timer);
      finish();
    }
  }, 70);
}

function undo() {
  if (busy || state.drawn.length === 0) return;
  // 되돌린 타일은 주머니 맨 위로 돌아가므로, 다시 뽑으면 같은 숫자가 나온다.
  state.bag.push(state.drawn.pop());
  save();
  stopSpeaking();
  render();
}

function newGame() {
  stopSpeaking();
  state = freshGame(state.voice);
  save();
  hideConfirm();
  render();
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}

function showConfirm() {
  if (state.drawn.length === 0) { newGame(); return; }
  els.newBtn.hidden = true;
  els.confirmNew.hidden = false;
  els.confirmNo.focus();
}

function hideConfirm() {
  els.newBtn.hidden = false;
  els.confirmNew.hidden = true;
}

els.drawBtn.addEventListener('click', draw);
els.speakBtn.addEventListener('click', () => speak(state.drawn[state.drawn.length - 1]));
els.undoBtn.addEventListener('click', undo);
els.voiceBtn.addEventListener('click', () => {
  state.voice = !state.voice;
  if (!state.voice) stopSpeaking();
  save();
  render();
});
els.newBtn.addEventListener('click', showConfirm);
els.confirmYes.addEventListener('click', newGame);
els.confirmNo.addEventListener('click', hideConfirm);

// 키보드: 스페이스/엔터로 뽑기 (진행자가 노트북을 쓸 때)
document.addEventListener('keydown', (e) => {
  if (e.target.closest('button, summary')) return;
  if (e.code === 'Space' || e.key === 'Enter') {
    e.preventDefault();
    draw();
  }
});

buildStatic();
render();
