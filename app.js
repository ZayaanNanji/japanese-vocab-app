const VOCAB_PATH = "vocab/";
const STORAGE_KEY = "kotoba-progress-v1";

const state = {
  collections: [],
  currentCollection: null,
  session: null,
  sound: true,
  progress: loadProgress(),
};

const views = {
  home: document.querySelector("#home-view"),
  collection: document.querySelector("#collection-view"),
  study: document.querySelector("#study-view"),
  complete: document.querySelector("#complete-view"),
};

const $ = (selector) => document.querySelector(selector);

async function init() {
  bindEvents();
  updateStreak(false);
  try {
    const manifest = await fetch("vocab-manifest.json").then(checkResponse).then((r) => r.json());
    state.collections = await Promise.all(
      manifest.map(async (meta, index) => {
        const text = await fetch(`${VOCAB_PATH}${meta.file}`).then(checkResponse).then((r) => r.text());
        const words = parseCSV(text).map((row) => ({
          id: Number(row.No),
          japanese: row.Japanese,
          romaji: row.Romaji,
          meaning: row.Meaning,
        }));
        return { ...meta, index, words, start: words[0]?.id, end: words.at(-1)?.id };
      })
    );
    renderHome();
    routeFromHash();
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  } catch (error) {
    console.error(error);
    $("#collection-grid").innerHTML = `
      <div class="collection-card" style="grid-column:1/-1">
        <div class="collection-icon">!</div>
        <div><h3>Could not load vocabulary</h3>
        <p>Run this folder through a local web server or open the published GitHub Pages URL.</p></div>
      </div>`;
  }
}

function checkResponse(response) {
  if (!response.ok) throw new Error(`Could not load ${response.url}`);
  return response;
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const clean = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const next = clean[i + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell.length)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift()?.map((h) => h.trim()) || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i]?.trim() ?? ""])));
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const routeButton = event.target.closest("[data-route]");
    if (routeButton) navigate(routeButton.dataset.route);

    const collectionCard = event.target.closest("[data-collection]");
    if (collectionCard) openCollection(Number(collectionCard.dataset.collection));

    const levelCard = event.target.closest("[data-level]");
    if (levelCard) startLevel(Number(levelCard.dataset.level));

    const rating = event.target.closest("[data-rating]");
    if (rating) rateCard(rating.dataset.rating);
  });

  $("#practice-all-button").addEventListener("click", () => startSession(state.currentCollection.words, "All 100"));
  $("#smart-review-button").addEventListener("click", startSmartReview);
  $("#flashcard").addEventListener("click", (event) => {
    if (!event.target.closest(".speak-button")) flipCard();
  });
  $("#speak-button").addEventListener("click", (event) => {
    event.stopPropagation();
    speak(currentWord().japanese);
  });
  $("#quiz-speak-button").addEventListener("click", () => speak(currentWord().japanese));
  $("#mode-toggle").addEventListener("click", toggleMode);
  $(".close-study").addEventListener("click", exitStudy);
  $("#finish-button").addEventListener("click", finishSession);
  $("#study-again-button").addEventListener("click", repeatSession);
  $("#sound-toggle").addEventListener("click", toggleSound);
  window.addEventListener("hashchange", routeFromHash);
  window.addEventListener("keydown", handleKeyboard);

  let touchStart = 0;
  $("#flashcard-stage").addEventListener("touchstart", (e) => touchStart = e.changedTouches[0].clientX, { passive: true });
  $("#flashcard-stage").addEventListener("touchend", (e) => {
    const distance = e.changedTouches[0].clientX - touchStart;
    if (Math.abs(distance) > 70 && $("#flashcard").classList.contains("flipped")) {
      rateCard(distance > 0 ? "knew" : "again");
    }
  }, { passive: true });
}

function navigate(route) {
  location.hash = route === "home" ? "" : route;
  if (!location.hash) routeFromHash();
}

function routeFromHash() {
  const hash = location.hash.slice(1);
  if (hash.startsWith("collection/") && state.collections.length) {
    openCollection(Number(hash.split("/")[1]), false);
  } else if (!hash || hash === "home") {
    showView("home");
    renderHome();
  }
}

function showView(name) {
  Object.entries(views).forEach(([key, view]) => view.classList.toggle("active", key === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
  $("#main-content").focus({ preventScroll: true });
}

function renderHome() {
  const mastered = state.collections.flatMap((c) => c.words).filter((w) => wordProgress(w.id).mastery >= 3).length;
  const total = state.collections.reduce((sum, c) => sum + c.words.length, 0) || 1000;
  const percent = Math.round((mastered / total) * 100);
  $("#mastered-total").textContent = mastered;
  $("#overall-percent").textContent = `${percent}%`;
  $("#mastery-ring").style.setProperty("--progress", `${percent}%`);
  $("#collection-count").textContent = `${state.collections.length} collections`;

  const due = getReviewWords().length;
  $("#review-summary").textContent = due
    ? `${due} ${due === 1 ? "word is" : "words are"} ready for review.`
    : "Choose a collection and learn ten words today.";

  $("#collection-grid").innerHTML = state.collections.map((collection) => {
    const progress = collectionProgress(collection);
    return `
      <button class="collection-card" data-collection="${collection.index}" style="--accent:${collection.accent}">
        <span class="collection-icon">${escapeHTML(collection.icon)}</span>
        <span>
          <h3>${escapeHTML(collection.title)}</h3>
          <p>${escapeHTML(collection.subtitle)} · ${collection.start}–${collection.end}</p>
          <span class="mini-progress">
            <span class="progress-track"><span style="display:block;height:100%;width:${progress}%;background:var(--accent);border-radius:inherit"></span></span>
            <span>${progress}%</span>
          </span>
        </span>
        <span class="card-arrow">→</span>
      </button>`;
  }).join("");
}

function openCollection(index, updateHash = true) {
  const collection = state.collections[index];
  if (!collection) return;
  state.currentCollection = collection;
  if (updateHash) history.pushState(null, "", `#collection/${index}`);
  $("#collection-range").textContent = `Words ${collection.start}–${collection.end}`;
  $("#collection-title").textContent = collection.title;
  $("#collection-description").textContent = collection.subtitle;
  const progress = collectionProgress(collection);
  $("#collection-percent").textContent = `${progress}%`;
  $("#collection-progress-bar").style.width = `${progress}%`;
  renderLevels(collection);
  showView("collection");
}

function renderLevels(collection) {
  $("#level-grid").innerHTML = Array.from({ length: 10 }, (_, level) => {
    const words = collection.words.slice(level * 10, level * 10 + 10);
    const mastered = words.filter((word) => wordProgress(word.id).mastery >= 3).length;
    const preview = words.slice(0, 3).map((word) => word.japanese).join(" · ");
    return `
      <button class="level-card" data-level="${level}">
        <span class="level-number">Level ${level + 1}</span>
        <h3>${words[0]?.id}–${words.at(-1)?.id}</h3>
        <p>${escapeHTML(preview)}</p>
        <span class="level-footer">
          <span>${mastered}/10 mastered</span>
          <span class="level-dots">${Array.from({ length: 5 }, (_, i) => `<i class="${i < Math.ceil(mastered / 2) ? "filled" : ""}"></i>`).join("")}</span>
        </span>
      </button>`;
  }).join("");
}

function startLevel(level) {
  const words = state.currentCollection.words.slice(level * 10, level * 10 + 10);
  startSession(words, `Level ${level + 1}`);
}

function startSmartReview() {
  let words = getReviewWords();
  if (!words.length) {
    words = state.collections.flatMap((c) => c.words).filter((w) => wordProgress(w.id).seen > 0);
  }
  if (!words.length) {
    showToast("Learn a level first to build your review queue.");
    state.collections[0] && openCollection(0);
    return;
  }
  startSession(shuffle(words).slice(0, 30), "Smart review");
}

function startSession(words, label, mode = "flashcard") {
  if (!words?.length) return;
  state.session = {
    sourceWords: [...words],
    words: shuffle([...words]),
    index: 0,
    label,
    mode,
    results: [],
    retries: {},
    answered: false,
  };
  $("#study-kicker").textContent = state.currentCollection?.title || "Daily practice";
  $("#study-title").textContent = label;
  renderStudyCard();
  updateModeUI();
  showView("study");
}

function currentWord() {
  return state.session.words[state.session.index];
}

function renderStudyCard() {
  const word = currentWord();
  if (!word) return completeSession();
  state.session.answered = false;
  const position = state.session.index + 1;
  const total = state.session.words.length;
  $("#study-counter").textContent = `${position} / ${total}`;
  $("#study-progress-bar").style.width = `${((position - 1) / total) * 100}%`;
  $("#card-japanese").textContent = word.japanese;
  $("#card-japanese-back").textContent = word.japanese;
  $("#card-romaji").textContent = word.romaji;
  $("#card-meaning").textContent = word.meaning;
  $("#flashcard").classList.remove("flipped");
  $("#rating-controls").classList.remove("enabled");

  if (state.session.mode === "quiz") renderQuiz(word);
  setTimeout(() => speak(word.japanese), 260);
}

function flipCard() {
  if (!state.session || state.session.mode !== "flashcard") return;
  const card = $("#flashcard");
  card.classList.toggle("flipped");
  $("#rating-controls").classList.toggle("enabled", card.classList.contains("flipped"));
}

function rateCard(rating) {
  if (!state.session || state.session.answered) return;
  if (state.session.mode === "flashcard" && !$("#flashcard").classList.contains("flipped")) return;
  state.session.answered = true;
  recordResult(currentWord(), rating);
  animateNext();
}

function recordResult(word, rating) {
  const scores = { again: 0, hard: 1, knew: 2 };
  const previous = wordProgress(word.id);
  let mastery = previous.mastery || 0;
  if (rating === "knew") mastery = Math.min(5, mastery + 1);
  if (rating === "hard") mastery = Math.max(1, mastery);
  if (rating === "again") mastery = Math.max(0, mastery - 1);
  const intervals = [0, 1, 3, 7, 14, 30];
  const due = new Date();
  due.setDate(due.getDate() + intervals[mastery]);
  state.progress.words[word.id] = {
    mastery,
    seen: (previous.seen || 0) + 1,
    correct: (previous.correct || 0) + (rating === "knew" ? 1 : 0),
    due: due.toISOString().slice(0, 10),
  };
  state.session.results.push({ id: word.id, rating, score: scores[rating] });
  if (rating === "again" && !state.session.retries[word.id]) {
    state.session.retries[word.id] = 1;
    state.session.words.push(word);
  }
  saveProgress();
  updateStreak(true);
}

function animateNext() {
  const stage = state.session.mode === "quiz" ? $("#quiz-stage") : $("#flashcard-stage");
  stage.animate(
    [{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: "translateX(-24px)" }],
    { duration: 180, easing: "ease-in", fill: "forwards" }
  ).finished.then(() => {
    state.session.index++;
    if (state.session.index >= state.session.words.length) {
      stage.getAnimations().forEach((a) => a.cancel());
      completeSession();
      return;
    }
    renderStudyCard();
    stage.animate(
      [{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "translateX(0)" }],
      { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" }
    );
  });
}

function toggleMode() {
  if (!state.session) return;
  state.session.mode = state.session.mode === "flashcard" ? "quiz" : "flashcard";
  updateModeUI();
  renderStudyCard();
}

function updateModeUI() {
  const quiz = state.session?.mode === "quiz";
  $("#flashcard-stage").hidden = quiz;
  $("#rating-controls").hidden = quiz;
  $("#quiz-stage").hidden = !quiz;
  $("#mode-toggle").textContent = quiz ? "Multiple choice" : "Flashcards";
  $(".keyboard-hint").hidden = quiz;
}

function renderQuiz(word) {
  const pool = state.currentCollection?.words || state.collections.flatMap((c) => c.words);
  const distractors = shuffle(pool.filter((item) => item.id !== word.id)).slice(0, 3);
  const options = shuffle([word, ...distractors]);
  $("#quiz-japanese").textContent = word.japanese;
  $("#quiz-romaji").textContent = word.romaji;
  $("#quiz-romaji").classList.add("hidden-answer");
  $("#quiz-options").innerHTML = options.map((option) =>
    `<button class="quiz-option" data-answer="${option.id}">${escapeHTML(option.meaning)}</button>`
  ).join("");
  $("#quiz-options").querySelectorAll(".quiz-option").forEach((button) => {
    button.addEventListener("click", () => answerQuiz(button, Number(button.dataset.answer) === word.id));
  });
}

function answerQuiz(button, correct) {
  if (state.session.answered) return;
  state.session.answered = true;
  $("#quiz-romaji").classList.remove("hidden-answer");
  $("#quiz-options").querySelectorAll(".quiz-option").forEach((option) => {
    option.disabled = true;
    if (Number(option.dataset.answer) === currentWord().id) option.classList.add("correct");
  });
  if (!correct) button.classList.add("wrong");
  recordResult(currentWord(), correct ? "knew" : "again");
  setTimeout(animateNext, 650);
}

function completeSession() {
  $("#study-progress-bar").style.width = "100%";
  const results = state.session.results;
  const correct = results.filter((result) => result.rating === "knew").length;
  const mastered = results.filter((result) => wordProgress(result.id).mastery >= 3).length;
  $("#result-cards").textContent = results.length;
  $("#result-accuracy").textContent = `${Math.round((correct / Math.max(1, results.length)) * 100)}%`;
  $("#result-mastered").textContent = mastered;
  showView("complete");
}

function repeatSession() {
  const { sourceWords, label, mode } = state.session;
  startSession(sourceWords, label, mode);
}

function finishSession() {
  if (state.currentCollection) openCollection(state.currentCollection.index);
  else navigate("home");
}

function exitStudy() {
  if (state.currentCollection) openCollection(state.currentCollection.index);
  else navigate("home");
}

function handleKeyboard(event) {
  if (!views.study.classList.contains("active") || !state.session) return;
  if (state.session.mode === "flashcard") {
    if (event.code === "Space") {
      event.preventDefault();
      flipCard();
    }
    if (event.key === "1") rateCard("again");
    if (event.key === "2") rateCard("hard");
    if (event.key === "3") rateCard("knew");
    if (event.key === "ArrowLeft") rateCard("again");
    if (event.key === "ArrowRight") rateCard("knew");
  }
}

function speak(text) {
  if (!state.sound || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 0.82;
  const japaneseVoice = speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith("ja"));
  if (japaneseVoice) utterance.voice = japaneseVoice;
  speechSynthesis.speak(utterance);
}

function toggleSound() {
  state.sound = !state.sound;
  $(".sound-on").hidden = !state.sound;
  $(".sound-off").hidden = state.sound;
  $("#sound-toggle").setAttribute("aria-label", state.sound ? "Mute sound" : "Enable sound");
  if (!state.sound && "speechSynthesis" in window) speechSynthesis.cancel();
  showToast(state.sound ? "Pronunciation enabled" : "Pronunciation muted");
}

function wordProgress(id) {
  return state.progress.words[id] || { mastery: 0, seen: 0, correct: 0, due: null };
}

function collectionProgress(collection) {
  if (!collection?.words.length) return 0;
  const masteryPoints = collection.words.reduce((sum, word) => sum + Math.min(3, wordProgress(word.id).mastery), 0);
  return Math.round((masteryPoints / (collection.words.length * 3)) * 100);
}

function getReviewWords() {
  const today = new Date().toISOString().slice(0, 10);
  return state.collections.flatMap((c) => c.words).filter((word) => {
    const progress = wordProgress(word.id);
    return progress.seen > 0 && (!progress.due || progress.due <= today || progress.mastery < 2);
  });
}

function updateStreak(markToday) {
  const today = new Date();
  const todayKey = localDateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDateKey(yesterday);
  const last = state.progress.lastStudyDate;

  if (markToday && last !== todayKey) {
    state.progress.streak = last === yesterdayKey ? (state.progress.streak || 0) + 1 : 1;
    state.progress.lastStudyDate = todayKey;
    saveProgress();
  } else if (!markToday && last && last !== todayKey && last !== yesterdayKey) {
    state.progress.streak = 0;
  }
  $("#streak-count").textContent = state.progress.streak || 0;
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function loadProgress() {
  try {
    return { words: {}, streak: 0, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { words: {}, streak: 0 };
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char]);
}

let toastTimer;
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

init();
