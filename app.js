// ============================================================
// SAPIX算数演習アプリ
// ============================================================

let currentUser = null;
let categories = [];
let currentCategory = null;
let currentUnits = [];
let currentUnit = null;
let unitData = null;

// Filter & answer state on unit detail page
let currentFilter = 'all';
let filteredQuestionIds = null;
let showingAnswer = false;

// Pending answer: allows re-pressing ○/✕ before committing
// { questionId, isCorrect } — committed on any non-○✕ action
let pendingAnswer = null;

// Google Sheets バックアップ用
let SHEETS_API_URL = localStorage.getItem("math-sheets-api-url") || "https://script.google.com/macros/s/AKfycbw5wMxhrXykDDDMd0hyueaKjgIrr43zdFeARCZSXdOKjGQHgjQxKa3m1GoscK-CEF1ErQ/exec";

// ============================================================
// Screen management
// ============================================================
function showScreen(id) {
  commitPendingAnswer();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ============================================================
// User selection
// ============================================================
function selectUser(name) {
  currentUser = name;
  loadCategories();
}

// ============================================================
// Tracking (LocalStorage)
// ============================================================
function getTrackingKey() {
  return `math-quiz-${currentUser}`;
}

function getTracking() {
  try {
    return JSON.parse(localStorage.getItem(getTrackingKey())) || {};
  } catch { return {}; }
}

function saveTracking(data) {
  localStorage.setItem(getTrackingKey(), JSON.stringify(data));
}

function getQuestionTracking(categoryId, unitId, questionId) {
  const data = getTracking();
  const key = `${categoryId}/${unitId}/${questionId}`;
  return data[key] || { attempts: 0, correct: 0 };
}

function recordAnswer(categoryId, unitId, questionId, isCorrect) {
  const data = getTracking();
  const key = `${categoryId}/${unitId}/${questionId}`;
  if (!data[key]) data[key] = { attempts: 0, correct: 0 };
  data[key].attempts++;
  if (isCorrect) data[key].correct++;
  saveTracking(data);
  backupToSheets();
}

// ============================================================
// Google Sheets バックアップ
// ============================================================
function trackingToNested(flat) {
  const nested = {};
  for (const fullKey in flat) {
    const lastSlash = fullKey.lastIndexOf('/');
    const unitKey = fullKey.substring(0, lastSlash);
    const qKey = fullKey.substring(lastSlash + 1);
    if (!nested[unitKey]) nested[unitKey] = {};
    nested[unitKey][qKey] = flat[fullKey];
  }
  return nested;
}

function nestedToFlat(nested) {
  const flat = {};
  for (const unitKey in nested) {
    for (const qKey in nested[unitKey]) {
      flat[`${unitKey}/${qKey}`] = nested[unitKey][qKey];
    }
  }
  return flat;
}

async function backupToSheets() {
  if (!SHEETS_API_URL) return;
  try {
    const tracking = getTracking();
    await fetch(SHEETS_API_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: currentUser,
        timestamp: new Date().toISOString(),
        data: trackingToNested(tracking)
      })
    });
  } catch (e) {
    console.warn("Sheets backup failed:", e);
  }
}

async function restoreFromSheets() {
  if (!SHEETS_API_URL) {
    alert("スプレッドシートのURLが設定されていません。設定画面で設定してください。");
    return;
  }
  if (!confirm("スプレッドシートからデータを復元しますか？\n現在のローカルデータは上書きされます。")) return;
  const url = SHEETS_API_URL + "?user=" + encodeURIComponent(currentUser);
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.status !== "ok") {
      alert("復元に失敗しました: " + (json.message || "不明なエラー"));
      return;
    }
    if (!json.data || Object.keys(json.data).length === 0) {
      alert("スプレッドシートにデータがありません");
      return;
    }
    const serverFlat = nestedToFlat(json.data);
    const current = getTracking();
    for (const key in serverFlat) {
      current[key] = serverFlat[key];
    }
    saveTracking(current);
    alert("復元しました");
    if (currentCategory && currentUnits.length > 0) renderUnits();
  } catch (e) {
    alert("復元に失敗しました: " + e.message);
  }
}

function openSettings() {
  document.getElementById("settings-url").value = SHEETS_API_URL;
  showScreen("screen-settings");
}

function saveSettings() {
  const url = document.getElementById("settings-url").value.trim();
  SHEETS_API_URL = url;
  localStorage.setItem("math-sheets-api-url", url);
  alert("保存しました");
}

function getUnitStats(categoryId, unitId, questions) {
  const data = getTracking();
  let total = 0, attempted = 0, correct = 0, totalAttempts = 0;
  for (const q of questions) {
    total++;
    const key = `${categoryId}/${unitId}/${q.id}`;
    const t = data[key];
    if (t && t.attempts > 0) {
      attempted++;
      correct += t.correct;
      totalAttempts += t.attempts;
    }
  }
  const rate = totalAttempts > 0 ? Math.round(correct / totalAttempts * 100) : -1;
  return { total, attempted, correct, totalAttempts, rate };
}

// ============================================================
// Categories
// ============================================================
async function loadCategories() {
  const resp = await fetch('categories.json');
  categories = await resp.json();
  renderCategories();
  showScreen('screen-categories');
}

function renderCategories() {
  document.getElementById('user-badge-cat').textContent = currentUser;
  const list = document.getElementById('category-list');
  list.innerHTML = categories.map(cat => `
    <div class="card" onclick="openCategory('${cat.id}')">
      <div class="card-title">${cat.icon} ${cat.name}</div>
      <div class="card-subtitle">${cat.description}</div>
    </div>
  `).join('');
}

// ============================================================
// Units list
// ============================================================
async function openCategory(catId) {
  currentCategory = categories.find(c => c.id === catId);
  const resp = await fetch(`categories/${catId}/units.json`);
  currentUnits = await resp.json();

  for (const u of currentUnits) {
    try {
      const r = await fetch(`categories/${catId}/units/${u.id}/unit.json`);
      u._data = await r.json();
    } catch { u._data = null; }
  }

  renderUnits();
  showScreen('screen-units');
}

function renderUnits() {
  document.getElementById('user-badge-units').textContent = currentUser;
  document.getElementById('units-title').textContent = currentCategory.name;
  const list = document.getElementById('unit-list');

  list.innerHTML = currentUnits.map(u => {
    const allQ = getAllQuestions(u._data);
    const stats = getUnitStats(currentCategory.id, u.id, allQ);
    const rateClass = stats.rate < 0 ? 'acc-none' : stats.rate >= 80 ? 'acc-high' : stats.rate >= 50 ? 'acc-mid' : 'acc-low';
    const rateText = stats.rate < 0 ? '未回答' : `${stats.rate}%`;

    return `
      <div class="card" onclick="openUnit('${u.id}')">
        <div class="card-title">${u.title}</div>
        <div class="card-stats">
          <div class="stat">問題数: <span class="stat-value">${stats.total}</span></div>
          <div class="stat">回答済: <span class="stat-value">${stats.attempted}/${stats.total}</span></div>
          <div class="stat">正答率: <span class="stat-value">${rateText}</span></div>
        </div>
        <div class="accuracy-bar">
          <div class="accuracy-bar-fill ${rateClass}" style="width: ${stats.rate < 0 ? 0 : stats.rate}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// Unit detail
// ============================================================
async function openUnit(unitId) {
  const u = currentUnits.find(u => u.id === unitId);
  if (!u || !u._data) return;
  currentUnit = u;
  unitData = u._data;
  currentFilter = 'all';
  filteredQuestionIds = null;
  showingAnswer = false;
  renderUnitDetail();
  showScreen('screen-unit-detail');
}

function getAllQuestions(data) {
  if (!data || !data.daimons) return [];
  const qs = [];
  for (const d of data.daimons) {
    for (const q of d.questions) {
      qs.push({ ...q, daimon: d.id, page: d.page });
    }
  }
  return qs;
}

// ============================================================
// Filter
// ============================================================
function setFilter(mode) {
  commitPendingAnswer();
  currentFilter = mode;
  filteredQuestionIds = null;

  const allQ = getAllQuestions(unitData);

  if (mode === 'below50' || mode === 'below67' || mode === 'below99') {
    const threshold = mode === 'below50' ? 50 : mode === 'below67' ? 67 : 99;
    const filtered = allQ.filter(q => {
      const t = getQuestionTracking(currentCategory.id, currentUnit.id, q.id);
      if (t.attempts === 0) return true;
      return Math.round(t.correct / t.attempts * 100) <= threshold;
    });
    filteredQuestionIds = new Set(filtered.map(q => q.id));
  } else if (mode === 'unanswered') {
    const filtered = allQ.filter(q => {
      const t = getQuestionTracking(currentCategory.id, currentUnit.id, q.id);
      return t.attempts === 0;
    });
    filteredQuestionIds = new Set(filtered.map(q => q.id));
  }

  // Update button states
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  updateQuestionCards();
  drawPreviewHighlights();
}

// ============================================================
// Render unit detail
// ============================================================
function renderUnitDetail() {
  document.getElementById('user-badge-detail').textContent = currentUser;
  document.getElementById('unit-detail-title').textContent =
    `${currentCategory.name} ${currentUnit.title}`;

  // Reset filter buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === currentFilter);
  });

  // Answer toggle button state
  const ansBtn = document.getElementById('answer-toggle-btn');
  ansBtn.textContent = showingAnswer ? '問題に戻る' : '解答';
  ansBtn.classList.toggle('active', showingAnswer);

  // Question cards
  renderQuestionCards();

  // Page images
  renderPageImages();
}

function renderQuestionCards() {
  const container = document.getElementById('accuracy-table-container');
  let html = '<div class="question-cards-flow" id="question-cards-flow">';
  for (const d of unitData.daimons) {
    html += `<div class="daimon-divider">${d.id}</div>`;
    for (const q of d.questions) {
      const label = q.label ? `${d.id}-${q.label}` : `${d.id}`;
      html += `<div class="question-card" data-qid="${q.id}">
        <div class="question-card-label">${label}</div>
        <div class="question-card-attempts"></div>
        <div class="question-card-rate"></div>
        <div class="question-card-answer-btns" style="display:none">
          <button class="btn btn-small btn-accent" onclick="markDetailAnswer('${q.id}', true, event)">○</button>
          <button class="btn btn-small btn-danger" onclick="markDetailAnswer('${q.id}', false, event)">✕</button>
        </div>
      </div>`;
    }
  }
  html += '</div>';
  container.innerHTML = html;
  updateQuestionCards();
}

function updateQuestionCards() {
  const cards = document.querySelectorAll('.question-card[data-qid]');
  for (const card of cards) {
    const qId = card.dataset.qid;
    const t = getQuestionTracking(currentCategory.id, currentUnit.id, qId);
    const rate = t.attempts > 0 ? Math.round(t.correct / t.attempts * 100) : -1;
    const rateClass = rate < 0 ? 'rate-none' : rate >= 80 ? 'rate-high' : rate >= 50 ? 'rate-mid' : 'rate-low';
    const attemptsText = t.attempts > 0 ? `${t.correct}/${t.attempts}` : '-';
    const rateText = rate < 0 ? '未回答' : rate + '%';

    card.querySelector('.question-card-attempts').textContent = attemptsText;
    const rateEl = card.querySelector('.question-card-rate');
    rateEl.textContent = rateText;
    rateEl.className = 'question-card-rate ' + rateClass;

    // Dim if filtered out
    const isDimmed = filteredQuestionIds && !filteredQuestionIds.has(qId);
    card.classList.toggle('dimmed', isDimmed);

    // Show/hide ○/× buttons based on answer mode
    const answerBtns = card.querySelector('.question-card-answer-btns');
    answerBtns.style.display = (showingAnswer && !isDimmed) ? 'flex' : 'none';
  }
}

function commitPendingAnswer() {
  if (!pendingAnswer) return;
  recordAnswer(currentCategory.id, currentUnit.id, pendingAnswer.questionId, pendingAnswer.isCorrect);
  pendingAnswer = null;
  updateQuestionCards();
}

function markDetailAnswer(questionId, isCorrect, event) {
  event.stopPropagation();

  // If there's a pending answer for a DIFFERENT question, commit it first
  if (pendingAnswer && pendingAnswer.questionId !== questionId) {
    commitPendingAnswer();
  }

  // Set (or overwrite) pending answer for this question
  pendingAnswer = { questionId, isCorrect };

  // Visual feedback: highlight the selected button
  const card = document.querySelector(`.question-card[data-qid="${questionId}"]`);
  if (card) {
    const btns = card.querySelectorAll('.question-card-answer-btns .btn');
    btns[0].style.opacity = isCorrect ? '1' : '0.35';   // ○
    btns[1].style.opacity = isCorrect ? '0.35' : '1';    // ✕
  }
}

// ============================================================
// Page images (question / answer toggle)
// ============================================================
function renderPageImages() {
  const preview = document.getElementById('question-pages-preview');
  const basePath = `categories/${currentCategory.id}/units/${currentUnit.id}/`;
  const pages = showingAnswer ? unitData.answerPages : unitData.questionPages;
  const pageLabel = showingAnswer ? '解答ページ' : '問題ページ';

  preview.innerHTML = pages.map((p, i) => `
    <div class="page-preview">
      <div class="preview-image-wrapper">
        <img src="${basePath}${p}" loading="lazy" alt="${pageLabel}${i+1}"
             data-page-idx="${i}"
             onload="onPageImageLoad(this)">
        <canvas class="preview-canvas" data-page-idx="${i}"></canvas>
      </div>
      <div class="page-preview-label">${pageLabel} ${i+1}</div>
    </div>
  `).join('');
}

function onPageImageLoad(img) {
  // Check if image needs rotation (landscape answer pages with text sideways)
  if (showingAnswer && img.naturalWidth > img.naturalHeight) {
    // Landscape image: likely needs 90-degree rotation
    // Adjust wrapper to accommodate rotated image
    const wrapper = img.parentElement;
    const ratio = img.naturalHeight / img.naturalWidth;
    img.classList.add('rotated');
    // Set wrapper height to match rotated image width
    wrapper.style.paddingBottom = (1 / ratio * 100) + '%';
    wrapper.style.height = '0';
    img.style.position = 'absolute';
    img.style.top = '50%';
    img.style.left = '50%';
    img.style.transform = 'translate(-50%, -50%) rotate(90deg)';
    img.style.width = (1 / ratio * 100) + '%';
  }
  drawPreviewHighlights();
}

// ============================================================
// Answer toggle
// ============================================================
function toggleDetailAnswer() {
  commitPendingAnswer();
  showingAnswer = !showingAnswer;

  const ansBtn = document.getElementById('answer-toggle-btn');
  ansBtn.textContent = showingAnswer ? '問題に戻る' : '解答';
  ansBtn.classList.toggle('active', showingAnswer);

  // Update cards (show/hide ○/× buttons)
  updateQuestionCards();

  // Swap page images
  renderPageImages();
}

// ============================================================
// Preview highlight drawing
// ============================================================
function drawPreviewHighlights() {
  if (showingAnswer) return; // No highlights on answer pages

  const canvases = document.querySelectorAll('.preview-canvas');
  for (const canvas of canvases) {
    const pageIdx = parseInt(canvas.dataset.pageIdx);
    const wrapper = canvas.parentElement;
    const img = wrapper.querySelector('img');

    if (!img.complete || img.naturalWidth === 0) continue;

    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!filteredQuestionIds) continue;

    const daimonsOnPage = unitData.daimons.filter(d => d.page === pageIdx);
    const W = img.clientWidth;
    const H = img.clientHeight;
    const daimonR = Math.max(W, H) * 0.022;
    const subR = Math.max(W, H) * 0.016;

    for (const d of daimonsOnPage) {
      const hasSubs = d.questions.length > 1 || d.questions[0].label;

      if (hasSubs) {
        for (const q of d.questions) {
          if (!filteredQuestionIds.has(q.id)) continue;
          const pos = q.numberPos;
          if (!pos) continue;
          drawNumberHighlight(ctx, pos[0] * W, pos[1] * H, subR, '#ff3b30');
        }
      } else {
        const q = d.questions[0];
        if (!filteredQuestionIds.has(q.id)) continue;
        const pos = d.numberPos;
        if (!pos) continue;
        drawNumberHighlight(ctx, pos[0] * W, pos[1] * H, daimonR, '#ff3b30');
      }
    }
  }
}

function drawNumberHighlight(ctx, cx, cy, r, color) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color + '30';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

// ============================================================
// Print with highlights
// ============================================================
function printWithHighlights() {
  commitPendingAnswer();
  const container = document.getElementById('print-container');
  const basePath = `categories/${currentCategory.id}/units/${currentUnit.id}/`;
  const pages = showingAnswer ? unitData.answerPages : unitData.questionPages;

  if (!filteredQuestionIds) {
    // No filter: just print plain images
    container.innerHTML = pages.map(p =>
      `<img src="${basePath}${p}" style="width:100%">`
    ).join('');
    setTimeout(() => window.print(), 300);
    return;
  }

  // With filter: render highlights onto canvases, then print as data URLs
  let loaded = 0;
  const images = [];

  pages.forEach((p, pageIdx) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      loaded++;
      images[pageIdx] = img;
      if (loaded === pages.length) {
        renderPrintCanvases(images, container);
      }
    };
    img.src = basePath + p;
  });
}

function renderPrintCanvases(images, container) {
  container.innerHTML = '';

  images.forEach((img, pageIdx) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');

    // Draw the image
    ctx.drawImage(img, 0, 0);

    // Draw highlights
    if (filteredQuestionIds) {
      const daimonsOnPage = unitData.daimons.filter(d => d.page === pageIdx);
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      const daimonR = Math.max(W, H) * 0.022;
      const subR = Math.max(W, H) * 0.016;

      // Use thicker lines for print
      const origLineWidth = 2.5;
      const printScale = W / 800; // scale up for high-res
      ctx.lineWidth = origLineWidth * printScale;

      for (const d of daimonsOnPage) {
        const hasSubs = d.questions.length > 1 || d.questions[0].label;
        if (hasSubs) {
          for (const q of d.questions) {
            if (!filteredQuestionIds.has(q.id)) continue;
            const pos = q.numberPos;
            if (!pos) continue;
            drawNumberHighlight(ctx, pos[0] * W, pos[1] * H, subR, '#ff3b30');
          }
        } else {
          const q = d.questions[0];
          if (!filteredQuestionIds.has(q.id)) continue;
          const pos = d.numberPos;
          if (!pos) continue;
          drawNumberHighlight(ctx, pos[0] * W, pos[1] * H, daimonR, '#ff3b30');
        }
      }

      // Reset line width
      ctx.lineWidth = origLineWidth;
    }

    const printImg = document.createElement('img');
    printImg.src = canvas.toDataURL('image/png');
    printImg.style.width = '100%';
    container.appendChild(printImg);
  });

  setTimeout(() => window.print(), 300);
}

// ============================================================
// Print (plain, from quiz screen)
// ============================================================
function printPage() {
  const basePath = `categories/${currentCategory.id}/units/${currentUnit.id}/`;
  const container = document.getElementById('print-container');
  container.innerHTML = unitData.questionPages.map(p =>
    `<img src="${basePath}${p}" style="width:100%">`
  ).join('');
  setTimeout(() => window.print(), 300);
}

// ============================================================
// Resize handler
// ============================================================
window.addEventListener('resize', () => {
  if (document.getElementById('screen-unit-detail').classList.contains('active')) {
    drawPreviewHighlights();
  }
});
