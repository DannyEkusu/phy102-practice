// =====================================================================
// PHY 102 Practice Bench — vanilla JS, offline, localStorage-backed
// =====================================================================

(function () {
  "use strict";

  // -------------------- Constants / storage keys --------------------
  const LS_BANK = "phy102_bank_v1";
  const LS_HISTORY = "phy102_history_v1";
  const LS_WRONG = "phy102_wrong_v1";
  const LS_THEME = "phy102_theme_v1";

  // -------------------- Utilities --------------------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  function formatClock(totalSeconds) {
    totalSeconds = Math.max(0, Math.round(totalSeconds));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
    return `${pad2(m)}:${pad2(s)}`;
  }

  function formatDuration(totalSeconds) {
    totalSeconds = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  }

  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { console.error("Storage error", e); return false; }
  }
  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // -------------------- Bank management --------------------
  function getBank() {
    const override = loadJSON(LS_BANK, null);
    if (Array.isArray(override) && override.length > 0) return override;
    return window.QUESTION_BANK || [];
  }
  function setBank(bank) { saveJSON(LS_BANK, bank); }
  function resetBank() {
    localStorage.removeItem(LS_BANK);
  }

  function validateImportedQuestion(q) {
    if (!q || typeof q !== "object") return false;
    if (typeof q.question !== "string" || !q.question.trim()) return false;
    if (!Array.isArray(q.options) || q.options.length !== 4) return false;
    if (q.options.some(o => typeof o !== "string" || !o.trim())) return false;
    if (q.answerIndex !== null && q.answerIndex !== undefined &&
        ![0, 1, 2, 3].includes(q.answerIndex)) return false;
    return true;
  }

  // -------------------- Global state --------------------
  const state = {
    bank: [],
    startConfig: {
      mode: "random",
      categories: new Set(),
      count: 10,
      timerMinutes: 0,
      answeredOnly: true,
    },
    test: null,     // active/last test run
    reviewFilter: "all",
  };

  // =====================================================================
  // SCREEN NAVIGATION
  // =====================================================================
  const screens = ["start", "quiz", "results", "review", "dashboard", "bank"];
  function showScreen(name) {
    screens.forEach(s => {
      const el = document.getElementById("screen-" + s);
      if (el) el.classList.toggle("active", s === name);
    });
    document.querySelectorAll(".nav-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.nav === name);
    });
    if (name === "dashboard") renderDashboard();
    if (name === "bank") renderBankScreen();
    if (name === "start") renderStartScreen();
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  document.querySelectorAll(".nav-btn[data-nav]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.nav === "start" && state.test && state.test.inProgress) {
        if (!confirm("Leave this test in progress? Your progress on this attempt will be lost.")) return;
        state.test = null;
      }
      showScreen(btn.dataset.nav);
    });
  });

  // =====================================================================
  // THEME
  // =====================================================================
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.getElementById("themeToggle").textContent = theme === "light" ? "◑" : "◐";
  }
  (function initTheme() {
    const saved = loadJSON(LS_THEME, null) ||
      (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    applyTheme(saved);
  })();
  document.getElementById("themeToggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyTheme(cur);
    saveJSON(LS_THEME, cur);
  });

  // =====================================================================
  // START SCREEN
  // =====================================================================
  const SUBJECT_ORDER = [];

  function subjectsFromBank(bank) {
    const map = new Map();
    bank.forEach(q => {
      const code = q.code || "GEN";
      if (!map.has(code)) map.set(code, { code, subject: q.subject || code, count: 0 });
      map.get(code).count++;
    });
    return Array.from(map.values());
  }

  function renderStartScreen() {
    state.bank = getBank();
    const subjects = subjectsFromBank(state.bank);

    // category chips (build once per bank change, or refresh counts)
    const catWrap = document.getElementById("categoryButtons");
    const existingCodes = Array.from(catWrap.querySelectorAll(".chip")).map(c => c.dataset.code);
    const sameSet = existingCodes.length === subjects.length &&
      subjects.every(s => existingCodes.includes(s.code));

    if (!sameSet) {
      catWrap.innerHTML = "";
      state.startConfig.categories = new Set(subjects.map(s => s.code));
      subjects.forEach(s => {
        const chip = document.createElement("button");
        chip.className = "chip active";
        chip.dataset.code = s.code;
        chip.textContent = `${s.subject} (${s.count})`;
        chip.addEventListener("click", () => {
          if (state.startConfig.categories.has(s.code)) {
            if (state.startConfig.categories.size === 1) { showToast("At least one category must be selected."); return; }
            state.startConfig.categories.delete(s.code);
            chip.classList.remove("active");
          } else {
            state.startConfig.categories.add(s.code);
            chip.classList.add("active");
          }
          refreshGenerateSummary();
        });
        catWrap.appendChild(chip);
      });
    }
    refreshGenerateSummary();
  }

  // Mode chips
  const modeNotes = {
    random: "Random selection across your chosen categories.",
    quick: "A short 10-question set for a quick revision pass, no timer.",
    mock: "A larger, timed set that behaves like a real exam (50 questions, 60 min).",
    weak: "Weighted toward questions you've previously gotten wrong. Build up history first for this to sharpen.",
  };
  document.querySelectorAll("#modeButtons .chip").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#modeButtons .chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const mode = btn.dataset.mode;
      state.startConfig.mode = mode;
      document.getElementById("modeNote").textContent = modeNotes[mode];

      if (mode === "quick") { setCount(10); setTimer(0); }
      else if (mode === "mock") { setCount(50); setTimer(60); }
      else if (mode === "weak") { setCount(15); }
      refreshGenerateSummary();
    });
  });
  document.querySelector('#modeButtons .chip[data-mode="random"]').classList.add("active");

  function setCount(n) {
    state.startConfig.count = n;
    document.querySelectorAll("#countButtons .chip").forEach(b => {
      b.classList.toggle("active", Number(b.dataset.count) === n);
    });
    document.getElementById("customCount").value = "";
  }
  function setTimer(min) {
    state.startConfig.timerMinutes = min;
    document.querySelectorAll("#timerButtons .chip").forEach(b => {
      b.classList.toggle("active", Number(b.dataset.timer) === min);
    });
    document.getElementById("customTimer").value = "";
  }

  document.querySelectorAll("#countButtons .chip").forEach(btn => {
    btn.addEventListener("click", () => { setCount(Number(btn.dataset.count)); refreshGenerateSummary(); });
  });
  document.querySelectorAll("#timerButtons .chip").forEach(btn => {
    btn.addEventListener("click", () => { setTimer(Number(btn.dataset.timer)); refreshGenerateSummary(); });
  });
  document.getElementById("customCount").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    document.querySelectorAll("#countButtons .chip").forEach(b => b.classList.remove("active"));
    if (v > 0) state.startConfig.count = v;
    refreshGenerateSummary();
  });
  document.getElementById("customTimer").addEventListener("input", (e) => {
    const v = parseInt(e.target.value, 10);
    document.querySelectorAll("#timerButtons .chip").forEach(b => b.classList.remove("active"));
    if (v > 0) state.startConfig.timerMinutes = v;
    refreshGenerateSummary();
  });
  document.getElementById("answeredOnly").addEventListener("change", (e) => {
    state.startConfig.answeredOnly = e.target.checked;
    refreshGenerateSummary();
  });

  function getFilteredPool() {
    const cats = state.startConfig.categories;
    return state.bank.filter(q => {
      if (cats && cats.size > 0 && !cats.has(q.code)) return false;
      if (state.startConfig.answeredOnly && (q.answerIndex === null || q.answerIndex === undefined)) return false;
      return true;
    });
  }

  function refreshGenerateSummary() {
    const pool = getFilteredPool();
    const max = pool.length;
    document.getElementById("maxHint").textContent = max > 0 ? `max ${max} available` : "no questions match filters";
    const el = document.getElementById("categoryCount");
    if (el) el.textContent = `${pool.length} question${pool.length === 1 ? "" : "s"} match your current filters.`;

    let count = state.startConfig.count;
    if (count > max) count = max;
    const timer = state.startConfig.timerMinutes;
    document.getElementById("generateSummary").textContent =
      max === 0 ? "" :
      `${Math.min(state.startConfig.count, max)} question${Math.min(state.startConfig.count, max) === 1 ? "" : "s"} · ${timer > 0 ? timer + " min timer" : "no timer"}`;
  }

  // set sensible defaults
  setCount(10);
  setTimer(0);

  document.getElementById("generateBtn").addEventListener("click", () => {
    const pool = getFilteredPool();
    if (pool.length === 0) {
      showToast("No questions match your filters. Try widening categories or including unscored questions.");
      return;
    }
    let count = state.startConfig.count;
    if (!count || count < 1) count = 10;
    if (count > pool.length) count = pool.length;

    let selected;
    if (state.startConfig.mode === "weak") {
      selected = pickWeighted(pool, count);
    } else {
      selected = shuffle(pool).slice(0, count);
    }

    startTest(selected, state.startConfig.timerMinutes, state.startConfig.mode);
  });

  function pickWeighted(pool, count) {
    const wrong = loadJSON(LS_WRONG, {});
    // assign weight = 1 + wrongCount*3, sample without replacement
    const weighted = pool.map(q => ({ q, w: 1 + (wrong[q.id] || 0) * 3 }));
    const picked = [];
    const arr = weighted.slice();
    for (let i = 0; i < count && arr.length > 0; i++) {
      const total = arr.reduce((s, x) => s + x.w, 0);
      let r = Math.random() * total;
      let idx = 0;
      for (; idx < arr.length; idx++) {
        r -= arr[idx].w;
        if (r <= 0) break;
      }
      idx = Math.min(idx, arr.length - 1);
      picked.push(arr[idx].q);
      arr.splice(idx, 1);
    }
    return picked;
  }

  // =====================================================================
  // QUIZ RUNTIME
  // =====================================================================
  function startTest(questions, timerMinutes, mode) {
    // shuffle option order per question, remap answerIndex
    const prepped = questions.map(q => {
      const order = shuffle([0, 1, 2, 3]);
      const options = order.map(i => q.options[i]);
      const answerIndex = (q.answerIndex === null || q.answerIndex === undefined)
        ? null
        : order.indexOf(q.answerIndex);
      return {
        id: q.id,
        subject: q.subject,
        code: q.code,
        question: q.question,
        options,
        answerIndex,
        explanation: q.explanation || null,
        hasKey: q.answerIndex !== null && q.answerIndex !== undefined,
      };
    });

    state.test = {
      questions: prepped,
      answers: new Array(prepped.length).fill(null),
      current: 0,
      mode,
      timerTotalSeconds: timerMinutes > 0 ? timerMinutes * 60 : 0,
      timerRemaining: timerMinutes > 0 ? timerMinutes * 60 : 0,
      startedAt: Date.now(),
      finishedAt: null,
      inProgress: true,
      intervalId: null,
    };

    if (state.test.timerTotalSeconds > 0) {
      state.test.intervalId = setInterval(tickTimer, 1000);
    }

    renderNavGrid();
    renderQuestion();
    updateTimerDisplay();
    showScreen("quiz");
  }

  function tickTimer() {
    const t = state.test;
    if (!t || !t.inProgress) return;
    t.timerRemaining -= 1;
    updateTimerDisplay();
    if (t.timerRemaining <= 0) {
      t.timerRemaining = 0;
      updateTimerDisplay();
      clearInterval(t.intervalId);
      showToast("Time's up — submitting automatically.");
      finishTest(true);
    }
  }

  function updateTimerDisplay() {
    const t = state.test;
    const box = document.getElementById("quizTimer");
    const text = document.getElementById("timerText");
    if (!t || t.timerTotalSeconds === 0) {
      text.textContent = "No timer";
      box.classList.remove("warn", "critical");
      return;
    }
    text.textContent = formatClock(t.timerRemaining);
    box.classList.remove("warn", "critical");
    if (t.timerRemaining <= 30) box.classList.add("critical");
    else if (t.timerRemaining <= Math.max(60, t.timerTotalSeconds * 0.1)) box.classList.add("warn");
  }

  function renderQuestion() {
    const t = state.test;
    const q = t.questions[t.current];
    document.getElementById("qPosition").textContent = `Question ${t.current + 1} of ${t.questions.length}`;
    document.getElementById("qSubjectTag").textContent = q.code;
    document.getElementById("questionText").textContent = q.question;

    const optWrap = document.getElementById("optionsList");
    optWrap.innerHTML = "";
    const letters = ["A", "B", "C", "D"];
    q.options.forEach((opt, i) => {
      const div = document.createElement("div");
      div.className = "option";
      if (t.answers[t.current] === i) div.classList.add("selected");
      div.innerHTML = `<span class="opt-letter">${letters[i]}</span><span>${escapeHtml(opt)}</span>`;
      div.addEventListener("click", () => {
        t.answers[t.current] = i;
        renderQuestion();
        updateNavCell(t.current);
      });
      optWrap.appendChild(div);
    });

    document.getElementById("prevBtn").disabled = t.current === 0;
    document.getElementById("nextBtn").textContent = t.current === t.questions.length - 1 ? "Next ▸" : "Next ▸";
    updateNavGridCurrent();
  }

  function renderNavGrid() {
    const t = state.test;
    const grid = document.getElementById("navGrid");
    grid.innerHTML = "";
    t.questions.forEach((q, i) => {
      const cell = document.createElement("button");
      cell.className = "nav-cell";
      cell.textContent = i + 1;
      cell.addEventListener("click", () => { t.current = i; renderQuestion(); });
      grid.appendChild(cell);
    });
    updateNavGridCurrent();
  }

  function updateNavCell(i) {
    const grid = document.getElementById("navGrid");
    const cell = grid.children[i];
    if (!cell) return;
    cell.classList.toggle("answered", state.test.answers[i] !== null);
  }

  function updateNavGridCurrent() {
    const t = state.test;
    const grid = document.getElementById("navGrid");
    Array.from(grid.children).forEach((cell, i) => {
      cell.classList.toggle("current", i === t.current);
      cell.classList.toggle("answered", t.answers[i] !== null);
    });
  }

  document.getElementById("prevBtn").addEventListener("click", () => {
    const t = state.test;
    if (t.current > 0) { t.current--; renderQuestion(); }
  });
  document.getElementById("nextBtn").addEventListener("click", () => {
    const t = state.test;
    if (t.current < t.questions.length - 1) { t.current++; renderQuestion(); }
    else { showToast("You're on the last question — use Submit Test when ready."); }
  });

  // ---- submit flow ----
  document.getElementById("submitTestBtn").addEventListener("click", () => {
    const t = state.test;
    const unanswered = t.answers.filter(a => a === null).length;
    document.getElementById("submitModalText").textContent = unanswered > 0
      ? `You have ${unanswered} unanswered question${unanswered === 1 ? "" : "s"}. Submit anyway?`
      : "You've answered every question. Submit this test?";
    document.getElementById("submitModal").classList.add("active");
  });
  document.getElementById("cancelSubmit").addEventListener("click", () => {
    document.getElementById("submitModal").classList.remove("active");
  });
  document.getElementById("confirmSubmit").addEventListener("click", () => {
    document.getElementById("submitModal").classList.remove("active");
    finishTest(false);
  });

  function finishTest(auto) {
    const t = state.test;
    if (!t || !t.inProgress) return;
    t.inProgress = false;
    if (t.intervalId) clearInterval(t.intervalId);
    t.finishedAt = Date.now();

    let correct = 0, incorrect = 0, unanswered = 0, unscored = 0;
    const wrongMap = loadJSON(LS_WRONG, {});

    t.questions.forEach((q, i) => {
      const given = t.answers[i];
      if (!q.hasKey) { unscored++; return; }
      if (given === null) { unanswered++; return; }
      if (given === q.answerIndex) {
        correct++;
      } else {
        incorrect++;
        wrongMap[q.id] = (wrongMap[q.id] || 0) + 1;
      }
    });
    saveJSON(LS_WRONG, wrongMap);

    const scored = correct + incorrect + unanswered;
    const pct = scored > 0 ? Math.round((correct / scored) * 100) : 0;

    const timeUsed = t.timerTotalSeconds > 0
      ? (t.timerTotalSeconds - t.timerRemaining)
      : Math.round((t.finishedAt - t.startedAt) / 1000);

    t.results = { correct, incorrect, unanswered, unscored, scored, pct, timeUsed, auto };

    const history = loadJSON(LS_HISTORY, []);
    const cats = Array.from(new Set(t.questions.map(q => q.code)));
    history.unshift({
      date: new Date().toISOString(),
      mode: t.mode,
      total: t.questions.length,
      correct, incorrect, unanswered, unscored, pct,
      timeUsed,
      timerTotal: t.timerTotalSeconds,
      categories: cats,
    });
    saveJSON(LS_HISTORY, history.slice(0, 200));

    renderResults();
    showScreen("results");
  }

  function renderResults() {
    const t = state.test;
    const r = t.results;
    document.getElementById("scoreDial").style.setProperty("--pct", r.pct);
    document.getElementById("scorePct").textContent = r.pct + "%";

    const stats = [
      ["Correct", r.correct],
      ["Incorrect", r.incorrect],
      ["Unanswered", r.unanswered],
      ["Unscored", r.unscored],
      ["Time used", formatDuration(r.timeUsed)],
      ["Total time", t.timerTotalSeconds > 0 ? formatDuration(t.timerTotalSeconds) : "—"],
    ];
    const strip = document.getElementById("statStrip");
    strip.innerHTML = stats.map(([label, val]) =>
      `<div class="stat"><b>${escapeHtml(String(val))}</b><span>${escapeHtml(label)}</span></div>`
    ).join("");
  }

  document.getElementById("reviewBtn").addEventListener("click", () => {
    state.reviewFilter = "all";
    document.querySelectorAll("#reviewFilter .chip").forEach(c => c.classList.toggle("active", c.dataset.filter === "all"));
    renderReview();
    showScreen("review");
  });
  document.getElementById("retakeBtn").addEventListener("click", () => showScreen("start"));
  document.getElementById("retakeBtn2").addEventListener("click", () => showScreen("start"));
  document.getElementById("backToResultsBtn").addEventListener("click", () => showScreen("results"));

  document.querySelectorAll("#reviewFilter .chip").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#reviewFilter .chip").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      state.reviewFilter = btn.dataset.filter;
      renderReview();
    });
  });

  function renderReview() {
    const t = state.test;
    const list = document.getElementById("reviewList");
    list.innerHTML = "";
    const letters = ["A", "B", "C", "D"];

    t.questions.forEach((q, i) => {
      const given = t.answers[i];
      let status; // right | wrong | unscored
      if (!q.hasKey) status = "unscored";
      else if (given === null) status = "wrong";
      else status = given === q.answerIndex ? "right" : "wrong";

      if (state.reviewFilter !== "all" && state.reviewFilter !== status) return;

      const card = document.createElement("div");
      card.className = "review-item";
      const badgeLabel = status === "right" ? "Correct" : status === "wrong" ? "Incorrect" : "Unscored";

      let optsHtml = "";
      q.options.forEach((opt, oi) => {
        let cls = "option";
        if (q.hasKey && oi === q.answerIndex) cls += " correct";
        else if (oi === given && status === "wrong") cls += " incorrect";
        else if (oi === given) cls += " selected";
        optsHtml += `<div class="${cls}"><span class="opt-letter">${letters[oi]}</span><span>${escapeHtml(opt)}</span></div>`;
      });

      const givenText = given === null ? "No answer given" : `${letters[given]} — ${q.options[given]}`;
      const correctText = q.hasKey ? `${letters[q.answerIndex]} — ${q.options[q.answerIndex]}` : "Not available in source material";

      card.innerHTML = `
        <div class="review-item-head">
          <span class="qn">Question ${i + 1} · ${escapeHtml(q.code)}</span>
          <span class="badge ${status}">${badgeLabel}</span>
        </div>
        <p class="question-text">${escapeHtml(q.question)}</p>
        <div class="options-list">${optsHtml}</div>
        <p class="panel-note" style="margin-top:12px;">
          <strong>Your answer:</strong> ${escapeHtml(givenText)}<br>
          <strong>Correct answer:</strong> ${escapeHtml(correctText)}
          ${q.explanation ? `<br><strong>Explanation:</strong> ${escapeHtml(q.explanation)}` : ""}
        </p>
      `;
      list.appendChild(card);
    });

    if (!list.children.length) {
      list.innerHTML = `<p class="empty-note">No questions match this filter.</p>`;
    }
  }

  // =====================================================================
  // DASHBOARD
  // =====================================================================
  function renderDashboard() {
    const history = loadJSON(LS_HISTORY, []);
    const wrongMap = loadJSON(LS_WRONG, {});

    const totalTests = history.length;
    const totalAttempted = history.reduce((s, h) => s + h.total, 0);
    const avgPct = totalTests > 0 ? Math.round(history.reduce((s, h) => s + h.pct, 0) / totalTests) : 0;
    const bestPct = totalTests > 0 ? Math.max(...history.map(h => h.pct)) : 0;

    document.getElementById("dashStats").innerHTML = [
      ["Tests taken", totalTests],
      ["Questions attempted", totalAttempted],
      ["Average score", avgPct + "%"],
      ["Best score", bestPct + "%"],
    ].map(([label, val]) => `<div class="stat"><b>${escapeHtml(String(val))}</b><span>${escapeHtml(label)}</span></div>`).join("");

    const historyList = document.getElementById("historyList");
    if (!history.length) {
      historyList.innerHTML = `<p class="empty-note">No practice tests recorded yet. Generate a test to start tracking progress.</p>`;
    } else {
      historyList.innerHTML = history.slice(0, 40).map(h => {
        const d = new Date(h.date);
        const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
          d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        return `<div class="history-row">
          <div>
            <div>${h.pct}% <span class="hr-meta">(${h.correct}/${h.correct + h.incorrect + h.unanswered} scored, ${h.total} total)</span></div>
            <div class="hr-meta">${escapeHtml(dateStr)} · ${escapeHtml(h.categories.join(", "))} · ${escapeHtml(h.mode)}</div>
          </div>
        </div>`;
      }).join("");
    }

    const bank = getBank();
    const byId = new Map(bank.map(q => [String(q.id), q]));
    const weakList = document.getElementById("weakList");
    const entries = Object.entries(wrongMap).sort((a, b) => b[1] - a[1]).slice(0, 25);
    if (!entries.length) {
      weakList.innerHTML = `<p class="empty-note">No missed questions yet — they'll show up here as you practice.</p>`;
    } else {
      weakList.innerHTML = entries.map(([qid, count]) => {
        const q = byId.get(String(qid));
        const snippet = q ? q.question : "(question no longer in bank)";
        return `<div class="weak-row"><span class="wr-q">${escapeHtml(snippet.slice(0, 90))}${snippet.length > 90 ? "…" : ""}</span><span class="wr-count">×${count}</span></div>`;
      }).join("");
    }
  }

  document.getElementById("clearHistoryBtn").addEventListener("click", () => {
    if (!confirm("Clear all practice history and weak-area tracking? This cannot be undone.")) return;
    localStorage.removeItem(LS_HISTORY);
    localStorage.removeItem(LS_WRONG);
    renderDashboard();
    showToast("Practice history cleared.");
  });

  // =====================================================================
  // QUESTION BANK SCREEN
  // =====================================================================
  function renderBankScreen() {
    const bank = getBank();
    const subjects = subjectsFromBank(bank);
    const answered = bank.filter(q => q.answerIndex !== null && q.answerIndex !== undefined).length;

    document.getElementById("bankStats").innerHTML = [
      ["Total questions", bank.length],
      ["With answer key", answered],
      ["Without answer key", bank.length - answered],
      ["Categories", subjects.length],
    ].map(([label, val]) => `<div class="stat"><b>${escapeHtml(String(val))}</b><span>${escapeHtml(label)}</span></div>`).join("");

    const catSelect = document.getElementById("bankCategoryFilter");
    catSelect.innerHTML = `<option value="">All categories</option>` +
      subjects.map(s => `<option value="${escapeHtml(s.code)}">${escapeHtml(s.subject)} (${s.count})</option>`).join("");

    renderBankList();
  }

  function renderBankList() {
    const bank = getBank();
    const q = document.getElementById("bankSearch").value.trim().toLowerCase();
    const cat = document.getElementById("bankCategoryFilter").value;
    const list = document.getElementById("bankList");

    const filtered = bank.filter(item => {
      if (cat && item.code !== cat) return false;
      if (q && !item.question.toLowerCase().includes(q)) return false;
      return true;
    }).slice(0, 300);

    if (!filtered.length) {
      list.innerHTML = `<p class="empty-note">No questions match your search.</p>`;
      return;
    }
    list.innerHTML = filtered.map(item => `
      <div class="bank-row">
        <div class="br-top">
          <span>#${item.id} · ${escapeHtml(item.code)}</span>
          <span>${item.answerIndex !== null && item.answerIndex !== undefined ? "Answer key ✓" : "No answer key"}</span>
        </div>
        <div>${escapeHtml(item.question)}</div>
      </div>
    `).join("");
    if (bank.filter(item => (!cat || item.code === cat) && (!q || item.question.toLowerCase().includes(q))).length > 300) {
      list.innerHTML += `<p class="empty-note">Showing first 300 matches — refine your search to narrow further.</p>`;
    }
  }
  document.getElementById("bankSearch").addEventListener("input", renderBankList);
  document.getElementById("bankCategoryFilter").addEventListener("change", renderBankList);

  // ---- import / export / reset ----
  document.getElementById("importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = document.getElementById("importStatus");
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (err) { status.textContent = "Could not parse that file as JSON."; status.style.color = "var(--red)"; return; }
      if (!Array.isArray(parsed)) { status.textContent = "JSON must be an array of question objects."; status.style.color = "var(--red)"; return; }

      const valid = [];
      let rejected = 0;
      parsed.forEach(item => {
        if (validateImportedQuestion(item)) valid.push(item);
        else rejected++;
      });
      if (!valid.length) {
        status.textContent = "No valid questions found in that file. Check the required fields.";
        status.style.color = "var(--red)";
        return;
      }

      const mode = document.getElementById("importMode").value;
      let bank = getBank();
      let nextId = bank.reduce((m, q) => Math.max(m, q.id || 0), 0) + 1;
      const normalized = valid.map(q => ({
        id: q.id && !bank.some(b => b.id === q.id) ? q.id : nextId++,
        subject: q.subject || "Imported",
        code: q.code || "IMP",
        question: q.question.trim(),
        options: q.options.map(o => String(o).trim()),
        answerIndex: (q.answerIndex === undefined) ? null : q.answerIndex,
        explanation: q.explanation || null,
      }));

      bank = mode === "replace" ? normalized : bank.concat(normalized);
      setBank(bank);
      status.style.color = "var(--accent-strong)";
      status.textContent = `Imported ${valid.length} question${valid.length === 1 ? "" : "s"}${rejected ? ` (${rejected} skipped — missing required fields)` : ""}. Bank now has ${bank.length} questions.`;
      renderBankScreen();
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  document.getElementById("exportBtn").addEventListener("click", () => {
    const bank = getBank();
    const blob = new Blob([JSON.stringify(bank, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "phy102-question-bank.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  document.getElementById("resetBankBtn").addEventListener("click", () => {
    if (!confirm("Reset to the original PHY 102 archive bank? Any imported or custom questions will be removed.")) return;
    resetBank();
    renderBankScreen();
    renderStartScreen();
    showToast("Question bank reset to the original archive.");
  });

  // =====================================================================
  // INIT
  // =====================================================================
  state.bank = getBank();
  renderStartScreen();
  showScreen("start");

})();
