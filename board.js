// 스트림스 보드판: 20칸에 숫자를 적고, 이어진 물줄기 점수를 자동으로 계산한다.
const SLOTS = 20;
const JOKER = '★';
const STORAGE_KEY = 'streams-board-v1';
const DRAW_KEY = 'streams-draw-v1';
const SCORES = [0, 1, 3, 5, 7, 9, 11, 15, 20, 25, 30, 35, 40, 50, 60, 70, 85, 100, 150, 300];
const PAD_VALUES = [...Array.from({ length: 30 }, (_, i) => i + 1), JOKER];

const NS = 'http://www.w3.org/2000/svg';
const CELL = 190;   // 칸 사이 간격
const BOX = 138;    // 칸 크기
const MARGIN_X = 170;
const MARGIN_Y = 130;

const $ = (id) => document.getElementById(id);
const els = {
  board: $('board'),
  total: $('totalScore'),
  hint: $('hint'),
  runList: $('runList'),
  sheet: $('sheet'),
  sheetTitle: $('sheetTitle'),
  pad: $('pad'),
  useDrawn: $('useDrawn'),
  drawnValue: $('drawnValue'),
  clearSlot: $('clearSlot'),
  printBtn: $('printBtn'),
  newBtn: $('newBtn'),
  confirmNew: $('confirmNew'),
  confirmYes: $('confirmYes'),
  confirmNo: $('confirmNo'),
  printScoreBody: $('printScoreBody'),
};

const narrowQuery = window.matchMedia('(max-width: 700px)');
let values = load();
let selected = null;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved) && saved.length === SLOTS) return saved;
  } catch (_) {}
  return Array(SLOTS).fill(null);
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch (_) {}
}

function latestDrawn() {
  try {
    const s = JSON.parse(localStorage.getItem(DRAW_KEY));
    return s && Array.isArray(s.drawn) && s.drawn.length ? s.drawn[s.drawn.length - 1] : null;
  } catch (_) { return null; }
}

// ---------- 점수 계산 ----------
// 번호 순서대로 숫자가 같거나 커지면 한 물줄기로 이어진다. 빈 칸은 물줄기를 끊는다.
// 조커는 어떤 숫자든 될 수 있으므로, 가장 점수가 높아지도록 물줄기를 나눈다.
function canFlow(from, to) {
  let last = -Infinity;
  for (let k = from; k <= to; k++) {
    const v = values[k];
    if (v === JOKER) continue;
    if (v < last) return false;
    last = v;
  }
  return true;
}

function findRuns() {
  const runs = [];
  let s = 0;
  while (s < SLOTS) {
    if (values[s] == null) { s++; continue; }
    let e = s;
    while (e + 1 < SLOTS && values[e + 1] != null) e++;

    const best = { [s]: 0 };
    const back = {};
    for (let j = s; j <= e; j++) {
      best[j + 1] = -1;
      for (let i = s; i <= j; i++) {
        if (!canFlow(i, j)) continue;
        const score = best[i] + SCORES[j - i];
        if (score > best[j + 1]) { best[j + 1] = score; back[j + 1] = i; }
      }
    }
    const chunk = [];
    for (let end = e + 1; end > s; end = back[end]) {
      const start = back[end];
      chunk.unshift({ start, end: end - 1, len: end - start, score: SCORES[end - start - 1] });
    }
    runs.push(...chunk);
    s = e + 1;
  }
  return runs;
}

// ---------- 보드 그리기 ----------
function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

let printing = false; // 인쇄할 때는 화면 크기와 상관없이 가로 5칸 배치

function geometry() {
  const cols = narrowQuery.matches && !printing ? 4 : 5;
  const rows = SLOTS / cols;
  const pos = [];
  for (let i = 0; i < SLOTS; i++) {
    const r = Math.floor(i / cols);
    const c = r % 2 === 0 ? i % cols : cols - 1 - (i % cols);
    pos.push({ x: MARGIN_X + c * CELL, y: MARGIN_Y + r * CELL, row: r });
  }
  return {
    cols, rows, pos,
    width: MARGIN_X * 2 + (cols - 1) * CELL,
    height: MARGIN_Y * 2 + (rows - 1) * CELL,
  };
}

function riverPath(g) {
  const { pos, cols, rows, width } = g;
  const first = pos[0];
  let d = `M ${first.x - MARGIN_X + 20} ${first.y} L ${first.x} ${first.y}`;
  for (let r = 0; r < rows; r++) {
    const end = pos[r * cols + cols - 1];
    d += ` L ${end.x} ${end.y}`;
    if (r < rows - 1) {
      const next = pos[(r + 1) * cols];
      const sweep = r % 2 === 0 ? 1 : 0;
      d += ` A ${CELL / 2} ${CELL / 2} 0 0 ${sweep} ${next.x} ${next.y}`;
    }
  }
  const last = pos[SLOTS - 1];
  const outX = (rows - 1) % 2 === 0 ? width - 20 : 20;
  d += ` L ${outX} ${last.y}`;
  return { d, startX: first.x - MARGIN_X + 20, outX };
}

function arrow(parent, x, y, dir) {
  // dir: 'right' | 'left' | 'down'
  const s = 15;
  const pts = {
    right: `${x - s} ${y - s} ${x + s} ${y} ${x - s} ${y + s}`,
    left: `${x + s} ${y - s} ${x - s} ${y} ${x + s} ${y + s}`,
    down: `${x - s} ${y - s} ${x} ${y + s} ${x + s} ${y - s}`,
  }[dir];
  svg('polygon', { points: pts, class: 'flow-arrow' }, parent);
}

function renderBoard(runs) {
  const g = geometry();
  const b = els.board;
  b.replaceChildren();
  b.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`);

  // 물줄기
  const river = riverPath(g);
  const riverGroup = svg('g', { 'aria-hidden': 'true' }, b);
  svg('path', { d: river.d, class: 'river-bank', 'stroke-width': 124 }, riverGroup);
  svg('path', { d: river.d, class: 'river-water', 'stroke-width': 92 }, riverGroup);
  svg('path', { d: river.d, class: 'river-shine', 'stroke-width': 8 }, riverGroup);

  for (let i = 0; i < SLOTS - 1; i++) {
    const a = g.pos[i], n = g.pos[i + 1];
    if (a.row === n.row) {
      arrow(riverGroup, (a.x + n.x) / 2, a.y, n.x > a.x ? 'right' : 'left');
    } else {
      const outward = a.row % 2 === 0 ? 1 : -1;
      arrow(riverGroup, a.x + outward * CELL / 2, (a.y + n.y) / 2, 'down');
    }
  }

  const startLabel = svg('text', {
    x: river.startX + 10, y: g.pos[0].y - 76, class: 'river-label', 'text-anchor': 'start',
  }, riverGroup);
  startLabel.textContent = '시작';
  const last = g.pos[SLOTS - 1];
  const endLabel = svg('text', {
    x: river.outX + (river.outX > last.x ? -10 : 10), y: last.y - 76, class: 'river-label',
    'text-anchor': river.outX > last.x ? 'end' : 'start',
  }, riverGroup);
  endLabel.textContent = '끝';

  // 칸
  const runOf = Array(SLOTS).fill(null);
  let color = 0;
  for (const run of runs) {
    if (run.len < 2) continue;
    run.color = color++ % 4;
    for (let k = run.start; k <= run.end; k++) runOf[k] = run;
  }

  g.pos.forEach((p, i) => {
    const v = values[i];
    const run = runOf[i];
    const cls = ['slot'];
    if (v == null) cls.push('is-empty');
    if (run) cls.push(`run-${run.color}`);
    if (selected === i) cls.push('is-selected');

    const slot = svg('g', {
      class: cls.join(' '),
      role: 'button',
      tabindex: 0,
      'data-index': i,
      'aria-label': `${i + 1}번 칸, ${v == null ? '비어 있음' : v === JOKER ? '조커' : v}`,
    }, b);
    const x0 = p.x - BOX / 2, y0 = p.y - BOX / 2;
    svg('rect', { x: x0, y: y0 + 7, width: BOX, height: BOX, rx: 28, class: 'slot-shadow' }, slot);
    svg('rect', { x: x0, y: y0, width: BOX, height: BOX, rx: 28, class: 'slot-box' }, slot);
    svg('text', { x: x0 + 16, y: y0 + 30, class: 'slot-order' }, slot).textContent = i + 1;
    if (v != null) {
      svg('text', {
        x: p.x, y: p.y + 26, 'text-anchor': 'middle',
        class: `slot-value${v === JOKER ? ' is-joker' : ''}`,
      }, slot).textContent = v;
    }
  });

  // 물줄기 점수 배지 (마지막 칸 아래)
  for (const run of runs) {
    if (run.len < 2) continue;
    const p = g.pos[run.end];
    const label = `+${run.score}`;
    const w = 30 + label.length * 15;
    const badge = svg('g', { class: 'run-badge', 'aria-hidden': 'true' }, b);
    svg('rect', { x: p.x - w / 2, y: p.y + BOX / 2 + 12, width: w, height: 38, rx: 19 }, badge);
    svg('text', { x: p.x, y: p.y + BOX / 2 + 40, 'text-anchor': 'middle' }, badge).textContent = label;
  }
}

function render() {
  const runs = findRuns();
  const total = runs.reduce((sum, r) => sum + r.score, 0);
  const filled = values.filter((v) => v != null).length;

  els.total.textContent = total;
  els.hint.textContent = filled === SLOTS
    ? `20칸을 다 채웠어요! 최종 점수는 ${total}점입니다`
    : filled === 0
      ? '빈 칸을 눌러 숫자를 넣으세요'
      : `빈 칸을 눌러 숫자를 넣으세요 · ${SLOTS - filled}칸 남음`;

  renderBoard(runs);

  const scoring = runs.filter((r) => r.len >= 2);
  els.runList.innerHTML = scoring.length
    ? scoring.map((r) => `<li class="run-${r.color}">${r.start + 1}~${r.end + 1}번 · ${r.len}칸 <strong>${r.score}점</strong></li>`).join('')
    : '<li class="empty">아직 두 칸 이상 이어진 물줄기가 없어요</li>';
}

// ---------- 숫자 고르기 ----------
function usedCount(v, except) {
  return values.filter((x, i) => i !== except && x === v).length;
}
function limitOf(v) {
  return typeof v === 'number' && v >= 11 && v <= 19 ? 2 : 1;
}
function isAvailable(v, index) {
  return usedCount(v, index) < limitOf(v);
}

function buildPad() {
  els.pad.innerHTML = PAD_VALUES.map((v) =>
    `<button type="button" data-value="${v}"${v === JOKER ? ' class="is-joker" aria-label="조커"' : ''}>${v}</button>`
  ).join('');
}

function openSheet(index) {
  selected = index;
  const current = values[index];
  const drawn = latestDrawn();

  els.sheetTitle.textContent = `${index + 1}번 칸에 넣을 숫자`;
  [...els.pad.children].forEach((btn) => {
    const v = btn.dataset.value === JOKER ? JOKER : Number(btn.dataset.value);
    btn.disabled = !isAvailable(v, index);
    btn.classList.toggle('is-current', v === current);
  });

  const showDrawn = drawn != null && drawn !== current && isAvailable(drawn, index);
  els.useDrawn.hidden = !showDrawn;
  if (showDrawn) {
    els.drawnValue.textContent = drawn;
    els.useDrawn.dataset.value = drawn;
  }
  els.clearSlot.hidden = current == null;

  els.sheet.hidden = false;
  render();
  (showDrawn ? els.useDrawn : els.pad.querySelector('button:not(:disabled)'))?.focus();
}

function closeSheet() {
  if (els.sheet.hidden) return;
  els.sheet.hidden = true;
  const idx = selected;
  selected = null;
  render();
  els.board.querySelector(`[data-index="${idx}"]`)?.focus();
}

function place(v) {
  if (selected == null) return;
  values[selected] = v;
  save();
  closeSheet();
}

// ---------- 인쇄용 점수표 ----------
function buildPrintScores() {
  const head = Array.from({ length: SLOTS }, (_, i) => `<td>${i + 1}칸</td>`).join('');
  const body = SCORES.map((s) => `<td>${s}</td>`).join('');
  els.printScoreBody.innerHTML = `<tr><td>이어진 칸</td>${head}</tr><tr><td>점수</td>${body}</tr>`;
}

// ---------- 이벤트 ----------
els.board.addEventListener('click', (e) => {
  const slot = e.target.closest('.slot');
  if (slot) openSheet(Number(slot.dataset.index));
});
els.board.addEventListener('keydown', (e) => {
  const slot = e.target.closest('.slot');
  if (slot && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openSheet(Number(slot.dataset.index));
  }
});

els.pad.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  place(btn.dataset.value === JOKER ? JOKER : Number(btn.dataset.value));
});
els.useDrawn.addEventListener('click', () => {
  const v = els.useDrawn.dataset.value;
  place(v === JOKER ? JOKER : Number(v));
});
els.clearSlot.addEventListener('click', () => place(null));
els.sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

els.printBtn.addEventListener('click', () => window.print());

els.newBtn.addEventListener('click', () => {
  if (values.every((v) => v == null)) return;
  els.newBtn.hidden = true;
  els.confirmNew.hidden = false;
  els.confirmNo.focus();
});
els.confirmNo.addEventListener('click', () => {
  els.newBtn.hidden = false;
  els.confirmNew.hidden = true;
});
els.confirmYes.addEventListener('click', () => {
  values = Array(SLOTS).fill(null);
  save();
  els.newBtn.hidden = false;
  els.confirmNew.hidden = true;
  render();
});

narrowQuery.addEventListener('change', render);
window.addEventListener('beforeprint', () => { printing = true; render(); });
window.addEventListener('afterprint', () => { printing = false; render(); });
// 다른 탭에서 숫자를 뽑거나 보드를 바꾸면 따라간다
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) { values = load(); render(); }
});

buildPad();
buildPrintScores();
render();
