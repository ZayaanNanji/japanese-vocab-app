const STORAGE_KEY = "kotoba-progress-v1";

const state = {
  courses: [],
  currentCourse: null,
  collections: [],
  currentCollection: null,
  session: null,
  sound: true,
  progress: loadProgress(),
  user: null,
  supabase: null,
  authMode: "signIn",
  syncTimer: null,
};

const views = {
  tracks: document.querySelector("#tracks-view"),
  home: document.querySelector("#home-view"),
  collection: document.querySelector("#collection-view"),
  wordList: document.querySelector("#word-list-view"),
  study: document.querySelector("#study-view"),
  complete: document.querySelector("#complete-view"),
};

const $ = (selector) => document.querySelector(selector);

async function init() {
  bindEvents();
  updateStreak(false);
  initializeAuth();
  try {
    const courseManifest = await fetch("courses-manifest.json").then(checkResponse).then((r) => r.json());
    state.courses = await Promise.all(courseManifest.map(loadCourse));
    renderTracks();
    routeFromHash();
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js?v=10").catch(() => {});
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

async function loadCourse(courseMeta) {
  const manifest = await fetch(courseMeta.manifest).then(checkResponse).then((r) => r.json());
  const collections = await Promise.all(manifest.map(async (meta, index) => {
    const text = await fetch(`${courseMeta.folder}/${meta.file}`).then(checkResponse).then((r) => r.text());
    const collectionKey = meta.file.replace(/\.csv$/i, "");
    const words = parseCSV(text).map((row, wordIndex) => {
      const id = Number(row.No) || wordIndex + 1;
      return {
        id,
        progressKey: courseMeta.id === "general" ? String(id) : `${collectionKey}:${id}`,
        japanese: row.Japanese,
        romaji: row.Romaji,
        meaning: row.Meaning,
      };
    });
    return { ...meta, index, key: collectionKey, words, start: words[0]?.id, end: words.at(-1)?.id };
  }));
  return { ...courseMeta, collections };
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

    const trackCard = event.target.closest("[data-course]");
    if (trackCard) openCourse(trackCard.dataset.course);

    const levelCard = event.target.closest("[data-level]");
    if (levelCard) startLevel(Number(levelCard.dataset.level));

    const rating = event.target.closest("[data-rating]");
    if (rating) rateCard(rating.dataset.rating);

    const speakWord = event.target.closest("[data-speak-word]");
    if (speakWord && state.currentCollection) {
      const word = state.currentCollection.words[Number(speakWord.dataset.speakWord)];
      if (word) speak(word.japanese);
    }
  });

  $("#practice-all-button").addEventListener("click", () => startSession(state.currentCollection.words, `All ${state.currentCollection.words.length}`));
  $("#view-words-button").addEventListener("click", () => openWordList(state.currentCollection.index));
  $("#word-list-back").addEventListener("click", () => openCollection(state.currentCollection.index));
  $("#word-search-input").addEventListener("input", (event) => renderWordList(event.target.value));
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
  $("#account-button").addEventListener("click", openAuthDialog);
  $("#auth-close").addEventListener("click", closeAuthDialog);
  $("#auth-config-close").addEventListener("click", closeAuthDialog);
  $("#sign-in-tab").addEventListener("click", () => setAuthMode("signIn"));
  $("#sign-up-tab").addEventListener("click", () => setAuthMode("signUp"));
  $("#auth-form").addEventListener("submit", submitAuthForm);
  $("#sign-out-button").addEventListener("click", signOut);
  $("#auth-dialog").addEventListener("click", (event) => {
    if (event.target === $("#auth-dialog")) closeAuthDialog();
  });
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
  if (route === "tracks") location.hash = "";
  else if (route === "home" && state.currentCourse) location.hash = `course/${state.currentCourse.id}`;
  else location.hash = route;
  routeFromHash();
}

function routeFromHash() {
  const hash = location.hash.slice(1);
  if (!state.courses.length) return;
  if (hash.startsWith("words/")) {
    const [, courseId, collectionIndex] = hash.split("/");
    if (selectCourse(courseId)) openWordList(Number(collectionIndex), false);
  } else if (hash.startsWith("collection/")) {
    const [, courseId, collectionIndex] = hash.split("/");
    if (selectCourse(courseId)) openCollection(Number(collectionIndex), false);
  } else if (hash.startsWith("course/")) {
    openCourse(hash.split("/")[1], false);
  } else {
    state.currentCourse = null;
    state.collections = [];
    state.currentCollection = null;
    $("#streak-count").textContent = "–";
    renderTracks();
    showView("tracks");
  }
}

function selectCourse(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course) return false;
  state.currentCourse = course;
  state.collections = course.collections;
  state.currentCollection = null;
  return true;
}

function openCourse(courseId, updateHash = true) {
  if (!selectCourse(courseId)) return;
  if (updateHash) history.pushState(null, "", `#course/${courseId}`);
  updateStreak(false);
  renderHome();
  showView("home");
}

function renderTracks() {
  $("#track-grid").innerHTML = state.courses.map((course) => {
    const progress = courseProgress(course);
    const total = course.collections.reduce((sum, collection) => sum + collection.words.length, 0);
    return `
      <button class="track-card" data-course="${escapeHTML(course.id)}" style="--accent:${course.accent}">
        <span class="track-icon">${escapeHTML(course.icon)}</span>
        <h2>${escapeHTML(course.title)}</h2>
        <p>${escapeHTML(course.subtitle)}</p>
        <span class="track-footer">
          <span class="track-progress">
            <span>${total ? `${total} words · ${progress}% mastered` : "Ready for vocabulary files"}</span>
            <span class="progress-track"><span style="display:block;height:100%;width:${progress}%;background:var(--accent);border-radius:inherit"></span></span>
          </span>
          <span class="track-arrow">→</span>
        </span>
      </button>`;
  }).join("");
}

function renderHome() {
  const course = state.currentCourse;
  if (!course) return;
  const mastered = state.collections.flatMap((c) => c.words).filter((w) => wordProgress(w).mastery >= 3).length;
  const total = state.collections.reduce((sum, c) => sum + c.words.length, 0);
  const percent = total ? Math.round((mastered / total) * 100) : 0;
  $("#course-eyebrow").textContent = course.eyebrow;
  $("#home-title").innerHTML = `${escapeHTML(course.title)}<br><em>vocabulary.</em>`;
  $("#course-description").textContent = course.subtitle;
  $("#mastered-total").textContent = mastered;
  $("#overall-percent").textContent = `${percent}%`;
  $("#mastery-ring").style.setProperty("--progress", `${percent}%`);
  $("#collection-count").textContent = `${state.collections.length} ${state.collections.length === 1 ? "collection" : "collections"}`;

  const due = getReviewWords().length;
  $("#review-summary").textContent = due
    ? `${due} ${due === 1 ? "word is" : "words are"} ready for review in ${course.title}.`
    : state.collections.length ? "Choose a collection and learn ten words today." : "Add vocabulary CSV files to begin this course.";

  if (!state.collections.length) {
    $("#collection-grid").innerHTML = `
      <div class="empty-collections">
        <h3>No vocabulary files added yet</h3>
        <p>Add CSV files to <code>${escapeHTML(course.folder)}/</code> and list them in <code>${escapeHTML(course.manifest)}</code>.</p>
      </div>`;
    return;
  }

  $("#collection-grid").innerHTML = state.collections.map((collection) => {
    const progress = collectionProgress(collection);
    return `
      <button class="collection-card" data-collection="${collection.index}" style="--accent:${collection.accent}">
        <span class="collection-icon">${escapeHTML(collection.icon)}</span>
        <span>
          <h3>${escapeHTML(collection.title)}</h3>
          <p>${escapeHTML(collection.subtitle)} · ${collection.words.length} words</p>
          <span class="mini-progress">
            <span class="progress-track"><span style="display:block;height:100%;width:${progress}%;background:var(--accent);border-radius:inherit"></span></span>
            <span>${progress}%</span>
          </span>
        </span>
        <span class="card-arrow">→</span>
      </button>`;
  }).join("");
}

function courseProgress(course) {
  const words = course.collections.flatMap((collection) => collection.words);
  if (!words.length) return 0;
  const mastery = words.reduce((sum, word) => sum + Math.min(3, wordProgress(word, course.id).mastery), 0);
  return Math.round((mastery / (words.length * 3)) * 100);
}

function showView(name) {
  Object.entries(views).forEach(([key, view]) => view.classList.toggle("active", key === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
  $("#main-content").focus({ preventScroll: true });
}

function openCollection(index, updateHash = true) {
  const collection = state.collections[index];
  if (!collection) return;
  state.currentCollection = collection;
  updateStreak(false);
  if (updateHash) history.pushState(null, "", `#collection/${state.currentCourse.id}/${index}`);
  $("#collection-range").textContent = `Words ${collection.start}–${collection.end}`;
  $("#collection-title").textContent = collection.title;
  $("#collection-description").textContent = collection.subtitle;
  $("#practice-all-title").textContent = `Practice all ${collection.words.length}`;
  const progress = collectionProgress(collection);
  $("#collection-percent").textContent = `${progress}%`;
  $("#collection-progress-bar").style.width = `${progress}%`;
  renderLevels(collection);
  showView("collection");
}

function openWordList(index, updateHash = true) {
  const collection = state.collections[index];
  if (!collection) return;
  state.currentCollection = collection;
  updateStreak(false);
  if (updateHash) history.pushState(null, "", `#words/${state.currentCourse.id}/${index}`);
  $("#word-list-kicker").textContent = state.currentCourse.title;
  $("#word-list-title").textContent = collection.title;
  $("#word-list-summary").textContent = `${collection.words.length} words · ${Math.ceil(collection.words.length / 10)} levels`;
  $("#word-search-input").value = "";
  renderWordList();
  showView("wordList");
}

function renderWordList(query = "") {
  if (!state.currentCollection) return;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = state.currentCollection.words
    .map((word, index) => ({ word, index }))
    .filter(({ word }) => {
      if (!normalizedQuery) return true;
      return [word.japanese, word.romaji, word.meaning, String(word.id)]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });

  const groups = new Map();
  for (const entry of matches) {
    const level = Math.floor(entry.index / 10) + 1;
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level).push(entry);
  }

  $("#word-list-groups").innerHTML = [...groups.entries()].map(([level, entries]) => `
    <section class="word-level-group">
      <div class="word-level-heading">
        <span>Level ${level}</span>
        <small>Words ${(level - 1) * 10 + 1}–${Math.min(level * 10, state.currentCollection.words.length)}</small>
      </div>
      <div class="word-rows">
        ${entries.map(({ word, index }) => {
          const progress = wordProgress(word);
          const status = progress.mastery >= 3 ? "Mastered" : progress.seen > 0 ? "Learning" : "New";
          const statusClass = status.toLowerCase();
          return `
            <article class="word-row">
              <span class="word-number">${escapeHTML(word.id)}</span>
              <span class="word-japanese">
                <strong>${escapeHTML(word.japanese)}</strong>
                <button class="word-speak" data-speak-word="${index}" aria-label="Hear ${escapeHTML(word.japanese)}">♪</button>
              </span>
              <span class="word-romaji">${escapeHTML(word.romaji)}</span>
              <span class="word-meaning">${escapeHTML(word.meaning)}</span>
              <span class="word-status ${statusClass}">${status}</span>
            </article>`;
        }).join("")}
      </div>
    </section>
  `).join("");
  $("#word-list-empty").hidden = matches.length > 0;
}

function renderLevels(collection) {
  const levelCount = Math.ceil(collection.words.length / 10);
  $("#level-grid").innerHTML = Array.from({ length: levelCount }, (_, level) => {
    const words = collection.words.slice(level * 10, level * 10 + 10);
    const mastered = words.filter((word) => wordProgress(word).mastery >= 3).length;
    const preview = words.slice(0, 3).map((word) => word.japanese).join(" · ");
    return `
      <button class="level-card" data-level="${level}">
        <span class="level-number">Level ${level + 1}</span>
        <h3>${words[0]?.id}–${words.at(-1)?.id}</h3>
        <p>${escapeHTML(preview)}</p>
        <span class="level-footer">
          <span>${mastered}/${words.length} mastered</span>
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
    words = state.collections.flatMap((c) => c.words).filter((w) => wordProgress(w).seen > 0);
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
    transitioning: false,
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
  const card = $("#flashcard");
  card.classList.add("resetting");
  card.classList.remove("flipped");
  card.getBoundingClientRect();
  const position = state.session.index + 1;
  const total = state.session.words.length;
  $("#study-counter").textContent = `${position} / ${total}`;
  $("#study-progress-bar").style.width = `${((position - 1) / total) * 100}%`;
  $("#card-japanese").textContent = word.japanese;
  $("#card-romaji").textContent = word.romaji;
  $("#card-meaning").textContent = word.meaning;
  $("#rating-controls").classList.remove("enabled");
  requestAnimationFrame(() => card.classList.remove("resetting"));

  if (state.session.mode === "quiz") renderQuiz(word);
  setTimeout(() => speak(word.japanese), 260);
}

function flipCard() {
  if (!state.session || state.session.mode !== "flashcard" || state.session.transitioning) return;
  const card = $("#flashcard");
  card.classList.toggle("flipped");
  $("#rating-controls").classList.toggle("enabled", card.classList.contains("flipped"));
}

function rateCard(rating) {
  if (!state.session || state.session.answered || state.session.transitioning) return;
  if (state.session.mode === "flashcard" && !$("#flashcard").classList.contains("flipped")) return;
  state.session.answered = true;
  recordResult(currentWord(), rating);
  animateNext();
}

function recordResult(word, rating) {
  const scores = { again: 0, hard: 1, knew: 2 };
  const previous = wordProgress(word);
  let mastery = previous.mastery || 0;
  if (rating === "knew") mastery = Math.min(5, mastery + 1);
  if (rating === "hard") mastery = Math.max(1, mastery);
  if (rating === "again") mastery = Math.max(0, mastery - 1);
  const intervals = [0, 1, 3, 7, 14, 30];
  const due = new Date();
  due.setDate(due.getDate() + intervals[mastery]);
  activeCourseProgress().words[word.progressKey] = {
    mastery,
    seen: (previous.seen || 0) + 1,
    correct: (previous.correct || 0) + (rating === "knew" ? 1 : 0),
    due: due.toISOString().slice(0, 10),
  };
  state.session.results.push({ key: word.progressKey, rating, score: scores[rating] });
  if (rating === "again" && !state.session.retries[word.progressKey]) {
    state.session.retries[word.progressKey] = 1;
    state.session.words.push(word);
  }
  saveProgress();
  updateStreak(true);
}

async function animateNext() {
  const stage = state.session.mode === "quiz" ? $("#quiz-stage") : $("#flashcard-stage");
  state.session.transitioning = true;
  const exitAnimation = stage.animate(
    [{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: "translateX(-24px)" }],
    { duration: 180, easing: "ease-in", fill: "forwards" }
  );
  try {
    await exitAnimation.finished;
  } catch {
    return;
  }
  exitAnimation.cancel();

  state.session.index++;
  if (state.session.index >= state.session.words.length) {
    state.session.transitioning = false;
    completeSession();
    return;
  }

  renderStudyCard();
  const enterAnimation = stage.animate(
    [{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "translateX(0)" }],
    { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" }
  );
  try {
    await enterAnimation.finished;
  } catch {
    return;
  }
  state.session.transitioning = false;
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
  $("#quiz-options").innerHTML = options.map((option) =>
    `<button class="quiz-option" data-answer="${option.id}">${escapeHTML(option.meaning)}</button>`
  ).join("");
  $("#quiz-options").querySelectorAll(".quiz-option").forEach((button) => {
    button.addEventListener("click", () => answerQuiz(button, Number(button.dataset.answer) === word.id));
  });
}

function answerQuiz(button, correct) {
  if (state.session.answered || state.session.transitioning) return;
  state.session.answered = true;
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
  const mastered = results.filter((result) => wordProgressByKey(result.key).mastery >= 3).length;
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

function wordProgress(word, courseId = state.currentCourse?.id) {
  const key = typeof word === "object" ? word.progressKey : String(word);
  return courseProgressData(courseId).words[key] || { mastery: 0, seen: 0, correct: 0, due: null };
}

function wordProgressByKey(key) {
  return activeCourseProgress().words[key] || { mastery: 0, seen: 0, correct: 0, due: null };
}

function collectionProgress(collection) {
  if (!collection?.words.length) return 0;
  const masteryPoints = collection.words.reduce((sum, word) => sum + Math.min(3, wordProgress(word).mastery), 0);
  return Math.round((masteryPoints / (collection.words.length * 3)) * 100);
}

function getReviewWords() {
  const today = new Date().toISOString().slice(0, 10);
  return state.collections.flatMap((c) => c.words).filter((word) => {
    const progress = wordProgress(word);
    return progress.seen > 0 && (!progress.due || progress.due <= today || progress.mastery < 2);
  });
}

function updateStreak(markToday) {
  const today = new Date();
  const todayKey = localDateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDateKey(yesterday);
  const progress = activeCourseProgress();
  const last = progress.lastStudyDate;

  if (markToday && last !== todayKey) {
    progress.streak = last === yesterdayKey ? (progress.streak || 0) + 1 : 1;
    progress.lastStudyDate = todayKey;
    saveProgress();
  } else if (!markToday && last && last !== todayKey && last !== yesterdayKey) {
    progress.streak = 0;
  }
  $("#streak-count").textContent = progress.streak || 0;
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function loadProgress() {
  try {
    return loadStoredProgress(STORAGE_KEY);
  } catch {
    return emptyProgress();
  }
}

function saveProgress() {
  const key = state.user ? `${STORAGE_KEY}:${state.user.id}` : STORAGE_KEY;
  localStorage.setItem(key, JSON.stringify(state.progress));
  if (state.user && state.supabase) scheduleCloudSync();
}

function emptyProgress() {
  return { courses: {} };
}

function loadStoredProgress(key) {
  try {
    return normalizeProgress(JSON.parse(localStorage.getItem(key) || "{}"));
  } catch {
    return emptyProgress();
  }
}

function normalizeProgress(progress = {}) {
  if (progress.courses) return { courses: progress.courses };
  if (progress.words || progress.streak || progress.lastStudyDate) {
    return {
      courses: {
        general: {
          words: progress.words || {},
          streak: progress.streak || 0,
          lastStudyDate: progress.lastStudyDate,
        },
      },
    };
  }
  return emptyProgress();
}

function courseProgressData(courseId = state.currentCourse?.id || "general") {
  state.progress.courses ||= {};
  state.progress.courses[courseId] ||= { words: {}, streak: 0 };
  state.progress.courses[courseId].words ||= {};
  return state.progress.courses[courseId];
}

function activeCourseProgress() {
  return courseProgressData(state.currentCourse?.id || "general");
}

async function initializeAuth() {
  const config = window.KOTOBA_SUPABASE || {};
  if (!config.url || !config.publishableKey) {
    updateAccountUI();
    return;
  }

  const libraryReady = await waitForSupabaseLibrary();
  if (!libraryReady) {
    console.warn("Supabase library could not be loaded. Continuing with local progress.");
    updateAccountUI();
    return;
  }

  state.supabase = window.supabase.createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  const { data, error } = await state.supabase.auth.getSession();
  if (error) console.error("Could not restore account session:", error);
  if (data?.session?.user) await handleSignedIn(data.session.user);
  else updateAccountUI();

  state.supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (event === "SIGNED_OUT" || !session?.user) handleSignedOut();
      else if (event === "SIGNED_IN" && session.user.id !== state.user?.id) handleSignedIn(session.user);
    }, 0);
  });
}

async function waitForSupabaseLibrary() {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (window.supabase?.createClient) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function isAuthConfigured() {
  const config = window.KOTOBA_SUPABASE || {};
  return Boolean(config.url && config.publishableKey && state.supabase);
}

function openAuthDialog() {
  $("#auth-not-configured").hidden = isAuthConfigured();
  $("#auth-signed-out").hidden = !isAuthConfigured() || Boolean(state.user);
  $("#auth-signed-in").hidden = !isAuthConfigured() || !state.user;
  $("#auth-error").textContent = "";
  if (!$("#auth-dialog").open) $("#auth-dialog").showModal();
}

function closeAuthDialog() {
  $("#auth-dialog").close();
}

function setAuthMode(mode) {
  state.authMode = mode;
  const signingUp = mode === "signUp";
  $("#sign-in-tab").classList.toggle("active", !signingUp);
  $("#sign-up-tab").classList.toggle("active", signingUp);
  $("#auth-title").textContent = signingUp ? "Create your account" : "Welcome back";
  $("#auth-copy").textContent = signingUp
    ? "Create an account to sync your vocabulary progress across devices."
    : "Sign in to continue your vocabulary progress on any device.";
  $("#auth-submit").textContent = signingUp ? "Create account" : "Sign in";
  $("#auth-password").autocomplete = signingUp ? "new-password" : "current-password";
  $("#auth-error").textContent = "";
  $("#auth-error").classList.remove("success-message");
}

async function submitAuthForm(event) {
  event.preventDefault();
  if (!state.supabase) return;
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const button = $("#auth-submit");
  button.disabled = true;
  button.textContent = state.authMode === "signUp" ? "Creating account…" : "Signing in…";
  $("#auth-error").textContent = "";
  $("#auth-error").classList.remove("success-message");

  try {
    if (state.authMode === "signUp") {
      const { data, error } = await state.supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}${location.pathname}` },
      });
      if (error) throw error;
      if (!data.session) {
        $("#auth-error").textContent = "Check your email to confirm your account, then sign in.";
        $("#auth-error").classList.add("success-message");
      } else {
        closeAuthDialog();
        showToast("Account created. Your progress is syncing.");
      }
    } else {
      const { error } = await state.supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      closeAuthDialog();
      showToast("Signed in. Your progress is synced.");
    }
  } catch (error) {
    $("#auth-error").classList.remove("success-message");
    $("#auth-error").textContent = friendlyAuthError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = state.authMode === "signUp" ? "Create account" : "Sign in";
  }
}

function friendlyAuthError(message = "") {
  if (message.toLowerCase().includes("invalid login")) return "Incorrect email or password.";
  if (message.toLowerCase().includes("already registered")) return "An account with this email already exists.";
  return message || "Something went wrong. Please try again.";
}

async function signOut() {
  if (!state.supabase) return;
  $("#sign-out-button").disabled = true;
  await flushCloudSync();
  const { error } = await state.supabase.auth.signOut();
  $("#sign-out-button").disabled = false;
  if (error) {
    showToast("Could not sign out. Please try again.");
    return;
  }
  closeAuthDialog();
  showToast("Signed out. Local guest progress is active.");
}

async function handleSignedIn(user) {
  if (!user || state.user?.id === user.id) return;
  const guestProgress = loadStoredProgress(STORAGE_KEY);
  const cachedProgress = loadStoredProgress(`${STORAGE_KEY}:${user.id}`);
  state.user = user;
  updateAccountUI();
  setSyncStatus("Loading cloud progress…", "syncing");

  const cloudProgress = await loadCloudProgress(user.id);
  state.progress = mergeProgress(guestProgress, cachedProgress, cloudProgress);
  updateStreak(false);
  refreshProgressUI();
  localStorage.setItem(`${STORAGE_KEY}:${user.id}`, JSON.stringify(state.progress));

  const synced = await syncProgressToCloud();
  if (synced) localStorage.removeItem(STORAGE_KEY);
}

function handleSignedOut() {
  state.user = null;
  clearTimeout(state.syncTimer);
  state.syncTimer = null;
  state.progress = loadStoredProgress(STORAGE_KEY);
  updateStreak(false);
  updateAccountUI();
  refreshProgressUI();
}

async function loadCloudProgress(userId) {
  try {
    const { data, error } = await state.supabase
      .from("user_progress")
      .select("progress")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data?.progress || emptyProgress();
  } catch (error) {
    console.error("Could not load cloud progress:", error);
    setSyncStatus("Cloud load failed — using this device", "failed");
    return emptyProgress();
  }
}

function mergeProgress(...sources) {
  const merged = emptyProgress();
  for (const rawSource of sources.filter(Boolean)) {
    const source = normalizeProgress(rawSource);
    for (const [courseId, sourceCourse] of Object.entries(source.courses || {})) {
      merged.courses[courseId] ||= { words: {}, streak: 0 };
      const targetCourse = merged.courses[courseId];
      targetCourse.streak = Math.max(targetCourse.streak || 0, sourceCourse.streak || 0);
      if ((sourceCourse.lastStudyDate || "") > (targetCourse.lastStudyDate || "")) {
        targetCourse.lastStudyDate = sourceCourse.lastStudyDate;
      }
      for (const [id, progress] of Object.entries(sourceCourse.words || {})) {
        const current = targetCourse.words[id] || {};
        const dueDates = [current.due, progress.due].filter(Boolean).sort();
        targetCourse.words[id] = {
          mastery: Math.max(current.mastery || 0, progress.mastery || 0),
          seen: Math.max(current.seen || 0, progress.seen || 0),
          correct: Math.max(current.correct || 0, progress.correct || 0),
          due: dueDates[0] || null,
        };
      }
    }
  }
  return merged;
}

function scheduleCloudSync() {
  clearTimeout(state.syncTimer);
  setSyncStatus("Syncing…", "syncing");
  state.syncTimer = setTimeout(syncProgressToCloud, 700);
}

async function flushCloudSync() {
  if (!state.syncTimer) return;
  clearTimeout(state.syncTimer);
  state.syncTimer = null;
  await syncProgressToCloud();
}

async function syncProgressToCloud() {
  if (!state.user || !state.supabase) return false;
  state.syncTimer = null;
  setSyncStatus("Syncing…", "syncing");
  try {
    const { error } = await state.supabase
      .from("user_progress")
      .upsert({
        user_id: state.user.id,
        progress: state.progress,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    if (error) throw error;
    setSyncStatus("Progress synced", "synced");
    return true;
  } catch (error) {
    console.error("Could not sync progress:", error);
    setSyncStatus("Sync failed — saved on this device", "failed");
    return false;
  }
}

function refreshProgressUI() {
  if (state.courses.length) renderTracks();
  if (state.currentCourse) renderHome();
  if (state.currentCollection && views.collection.classList.contains("active")) {
    openCollection(state.currentCollection.index, false);
  }
}

function updateAccountUI() {
  const email = state.user?.email || "";
  const initial = email ? email[0].toUpperCase() : "人";
  $("#account-avatar").textContent = initial;
  $("#account-large-avatar").textContent = initial;
  $("#account-label").textContent = state.user ? email.split("@")[0] : "Sign in";
  $("#auth-user-email").textContent = email;
  $("#auth-signed-out").hidden = Boolean(state.user);
  $("#auth-signed-in").hidden = !state.user;
}

function setSyncStatus(message, status = "") {
  const element = $("#sync-status");
  element.textContent = message;
  element.className = `sync-status ${status}`.trim();
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
