/* ============================================================
   SCENE ENGLISH — Minimalist iOS Liquid Glass Learning Experience
   Seamlessly integrated with LUMEN FLIX.
   - Single clickable English subtitle on every movie/episode
   - Instant click-to-translate floating glass popover (dismiss with × or outside click)
   - Clean, distraction-free Scene English movie catalog & practice page
   ============================================================ */
'use strict';

const SE = {
  profile: null,
  vocabMap: new Map(),
  vocabList: [],
  mediaPack: null,          // { videoId, cues, scenes, educationalMeta }
  cueTranslations: {},
  activeSceneIdx: 0,
  playerLearnMode: true,    // Subtitles are always interactive on every video
  subMode: 'en',            // Single English subtitle (no duplicate subtitle bars)
  autoPauseOnClick: true,
  colorHighlight: false,
  activeDockTab: 'transcript',
  loopSegment: null,
  currentCueIdx: -1,
  difficultCues: new Set(),
  reviewQueue: [],
  reviewIdx: 0,
  reviewMode: 'flashcard',
  flashcardFlipped: false,
  placementQuestions: [],
  placementAnswers: {},
  placementGoals: ['Understand movies without subtitles'],
  placementMinutes: 15,
  orderSelected: [],
  activeExStep: 'listen'
};

function getLearnUserId() {
  try {
    const p = typeof getProfile === 'function' ? getProfile() : null;
    return (p && p.name ? p.name : 'Main VIP').trim();
  } catch (e) {
    return 'Main VIP';
  }
}

async function initSceneEnglish() {
  try {
    const uid = getLearnUserId();
    const [profRes, vocRes] = await Promise.all([
      api(`/api/learn/profile?userId=${encodeURIComponent(uid)}`),
      api(`/api/learn/vocab?userId=${encodeURIComponent(uid)}`)
    ]);
    SE.profile = profRes.profile;
    syncVocabMap(vocRes.items || []);
    updateLearnNavBadge();
  } catch (e) {
    console.warn('[SCENE-ENGLISH] Init warning:', e.message);
  }
}

function syncVocabMap(items) {
  SE.vocabList = items || [];
  SE.vocabMap.clear();
  for (const v of SE.vocabList) {
    if (v.lemma) SE.vocabMap.set(v.lemma.toLowerCase(), v);
    if (v.word) SE.vocabMap.set(v.word.toLowerCase(), v);
  }
}

function updateLearnNavBadge() {
  const badge = document.getElementById('learnNavLevel');
  if (badge && SE.profile) {
    badge.textContent = SE.profile.cefrLevel || 'B1';
  }
}

function speakEnglishText(text, rate = 0.95) {
  if (!text) return;
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = 'en-US';
      u.rate = rate;
      const voices = window.speechSynthesis.getVoices();
      const enVoice = voices.find(v => /en[-_](US|GB)/i.test(v.lang) && /natural|google|siri|microsoft/i.test(v.name))
        || voices.find(v => /en/i.test(v.lang));
      if (enVoice) u.voice = enVoice;
      window.speechSynthesis.speak(u);
    }
  } catch (e) {}
}

// ============================================================
// 1. CLEAN, APPLE-TV STYLE SCENE ENGLISH PAGE (#learn)
// ============================================================
async function renderLearnPage(params = {}) {
  document.title = 'Scane English — SCANE';
  if (!SE.profile) await initSceneEnglish();

  const selLevel = params.level || '';
  const selCat = params.cat || '';
  const view = params.tab === 'practice' ? 'practice' : 'movies';
  const uid = getLearnUserId();

  const levels = [
    { id: '',   label: 'All Levels' },
    { id: 'A2', label: 'A2 · Elementary' },
    { id: 'B1', label: 'B1 · Intermediate' },
    { id: 'B2', label: 'B2 · Upper-Int' },
    { id: 'C1', label: 'C1 · Advanced' }
  ];

  const categories = [
    { id: '',          label: 'All Titles',       icon: 'fa-layer-group' },
    { id: 'beginner',  label: 'Clear Speech',     icon: 'fa-seedling' },
    { id: 'everyday',  label: 'Daily Dialogue',   icon: 'fa-comments' },
    { id: 'listening', label: 'Best for Listening', icon: 'fa-headphones' },
    { id: 'series',    label: 'TV Series',        icon: 'fa-tv' },
    { id: 'advanced',  label: 'Cinema Classics',  icon: 'fa-fire' }
  ];

  setMain(`<div class="se-clean-page">
    <!-- Liquid Glass Hero Header -->
    <section class="se-glass-hero">
      <div class="se-glass-hero-content">
        <div class="se-glass-pill"><i class="fa-solid fa-wand-magic-sparkles"></i> Scane English · Interactive Subtitles</div>
        <h1>Watch Movies. <span>Tap Any Word</span> to Translate.</h1>
        <p>Every movie and series on SCANE has interactive English subtitles. Just play any title and click any word on screen to hear its pronunciation and see its meaning.</p>
        <div class="se-hero-bar">
          <div class="se-level-Segment">
            ${levels.map(lv => `
              <button class="se-seg-btn ${selLevel === lv.id ? 'active' : ''}" onclick="navigate('learn?level=${lv.id}&cat=${selCat}')">${lv.label}</button>
            `).join('')}
          </div>
          <div class="se-hero-actions">
            <button class="se-glass-action ${view === 'movies' ? 'active' : ''}" onclick="navigate('learn')">
              <i class="fa-solid fa-film"></i> Catalog
            </button>
            <button class="se-glass-action ${view === 'practice' ? 'active' : ''}" onclick="navigate('learn?tab=practice')">
              <i class="fa-solid fa-headphones"></i> Quick Practice
            </button>
            <button class="se-glass-action" onclick="openLearnOnboardingModal()">
              <i class="fa-solid fa-sliders"></i> My Level: <strong>${esc(SE.profile?.cefrLevel || 'B1')}</strong>
            </button>
          </div>
        </div>
      </div>
    </section>

    <div class="se-clean-body" id="seHubBody">
      ${view === 'practice' ? `
        <div class="page-loading-spinner" style="height:220px"><div class="spinner-ring-lg"></div></div>
      ` : `
        <div class="se-cat-pills">
          ${categories.map(c => `
            <button class="se-cat-pill ${selCat === c.id ? 'active' : ''}" onclick="navigate('learn?level=${selLevel}&cat=${c.id}')">
              <i class="fa-solid ${c.icon}"></i> ${c.label}
            </button>
          `).join('')}
        </div>
        <div id="seEduCatalogGrid" class="browse-grid">
          <div class="page-loading-spinner" style="height:220px"><div class="spinner-ring-lg"></div></div>
        </div>
      `}
    </div>
    ${typeof buildFooter === 'function' ? buildFooter() : ''}
  </div>`);

  if (view === 'practice') {
    await renderLearnPracticeTab(uid);
  } else {
    try {
      const data = await api(`/api/learn/catalog?cat=${encodeURIComponent(selCat)}&level=${encodeURIComponent(selLevel)}`);
      const grid = document.getElementById('seEduCatalogGrid');
      if (grid) {
        const items = data.items || [];
        grid.innerHTML = items.length
          ? items.map(buildEduMovieCard).join('')
          : `<div class="wl-empty"><p>No titles found for this filter.</p></div>`;
      }
    } catch (e) {}
  }
}

function buildEduMovieCard(m) {
  const edu = m.edu || { cefr: 'B1', speechSpeed: 'Medium' };
  const targetVid = m.firstEpisodeId || m.id;
  const ph = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&q=60';
  const r = m.rating ? Number(m.rating).toFixed(1) : '';
  return `<div class="movie-card se-edu-card" onclick="openMediaInLearnMode('${esc(targetVid)}','${esc(m.id)}',${!!m.is_series})">
    <div class="card-poster-wrap">
      <img src="${esc(m.poster || ph)}" alt="${esc(m.title)}" loading="lazy" onerror="this.onerror=null;this.src='${ph}'">
      <div class="se-cefr-badge cefr-${(edu.cefr || 'b1').toLowerCase()}">${esc(edu.cefr)}</div>
      ${r ? `<div class="card-rating-badge"><i class="fa-solid fa-star"></i>${r}</div>` : ''}
      <div class="card-overlay">
        <div class="card-play-btn" title="Watch with Interactive Subtitles"><i class="fa-solid fa-play"></i></div>
      </div>
    </div>
    <div class="card-caption">
      <div class="card-title">${esc(m.title)}</div>
      <div class="card-meta">
        <span>${m.year || ''}</span>
        <span>· ${m.is_series ? 'Series' : 'Movie'}</span>
      </div>
    </div>
  </div>`;
}

function openMediaInLearnMode(videoId, mediaId, isSeries) {
  SE.playerLearnMode = true;
  if (isSeries) {
    navigate(`player/${videoId}?showId=${encodeURIComponent(mediaId)}`);
  } else {
    navigate(`player/${videoId}`);
  }
}

// ============================================================
// QUICK SCENE PRACTICE TAB (Optional, Clean & Focused)
// ============================================================
async function renderLearnPracticeTab(uid) {
  const body = document.getElementById('seHubBody');
  if (!body) return;
  try {
    const cat = await api('/api/learn/catalog?cat=listening');
    const firstMedia = (cat.items || [])[0];
    if (!firstMedia) {
      body.innerHTML = `<div class="wl-empty"><p>No practice scenes available.</p></div>`;
      return;
    }
    const pack = await api(`/api/learn/media-pack/${encodeURIComponent(firstMedia.firstEpisodeId || firstMedia.id)}`);
    SE.mediaPack = pack;
    const scene = (pack.scenes || [])[0];

    body.innerHTML = `
      <div class="se-panel">
        <div class="se-panel-head">
          <div>
            <h3><i class="fa-solid fa-headphones" style="color:var(--red)"></i> Interactive Scene Practice — ${esc(pack.title)}</h3>
            <p class="se-panel-sub">${esc(scene?.title || 'Scene 1')} · Listen to the dialogue and test your comprehension</p>
          </div>
          <button class="btn-red-sm" onclick="openMediaInLearnMode('${esc(pack.videoId)}','${esc(firstMedia.id)}',${!!firstMedia.is_series})">
            <i class="fa-solid fa-play"></i> Watch Movie
          </button>
        </div>
        ${scene ? buildInteractiveExercisesMarkup(scene, pack.videoId, pack.title) : ''}
      </div>
    `;
  } catch (e) {
    body.innerHTML = `<div class="wl-empty"><p>Could not load practice scene.</p></div>`;
  }
}

// ============================================================
// 2. LEVEL & PLACEMENT MODAL (Clean English UI)
// ============================================================
async function openLearnOnboardingModal() {
  const m = document.getElementById('learnOnboardingModal');
  const body = document.getElementById('learnOnboardingBody');
  if (!m || !body) return;
  if (!SE.placementQuestions.length) {
    try {
      const d = await api('/api/learn/placement-questions');
      SE.placementQuestions = d.questions || [];
    } catch (e) {}
  }
  SE.placementAnswers = {};
  renderOnboardingStep1();
  m.classList.add('open');
}

function closeLearnOnboardingModal() {
  const m = document.getElementById('learnOnboardingModal');
  if (m) m.classList.remove('open');
}

function renderOnboardingStep1() {
  const body = document.getElementById('learnOnboardingBody');
  if (!body) return;
  const levels = [
    { id: 'A1', desc: 'Beginner' },
    { id: 'A2', desc: 'Elementary' },
    { id: 'B1', desc: 'Intermediate' },
    { id: 'B2', desc: 'Upper-Int' },
    { id: 'C1', desc: 'Advanced' },
    { id: 'C2', desc: 'Mastery' }
  ];

  body.innerHTML = `
    <div class="se-onboard-wrap">
      <p style="font-size:13.5px;color:var(--text-m);margin-bottom:14px">
        Choose your current English level to filter movie recommendations, or take a quick 2-minute placement check:
      </p>
      <div class="se-levels-row">
        ${levels.map(l => `
          <button class="se-lvl-btn ${SE.profile?.cefrLevel === l.id ? 'active' : ''}" onclick="saveManualCefrLevel('${l.id}')">
            <strong>${l.id}</strong><span>${esc(l.desc)}</span>
          </button>
        `).join('')}
      </div>

      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;color:var(--text-m)">Not sure about your level?</span>
        <button class="btn-red-sm" onclick="renderOnboardingPlacementQuiz()">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Take Quick Level Check
        </button>
      </div>
    </div>
  `;
}

async function saveManualCefrLevel(level) {
  const uid = getLearnUserId();
  const res = await fetch('/api/learn/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: uid,
      cefrLevel: level,
      onboardingDone: true,
      isProvisional: true,
      goals: SE.placementGoals
    })
  });
  const data = await res.json();
  SE.profile = data.profile;
  updateLearnNavBadge();
  closeLearnOnboardingModal();
  showToast(`✓ Level set to ${level}`);
  if (window.location.hash.startsWith('#learn')) renderLearnPage({ level });
}

function renderOnboardingPlacementQuiz() {
  const body = document.getElementById('learnOnboardingBody');
  if (!body) return;
  const qs = SE.placementQuestions;

  body.innerHTML = `
    <div class="se-placement-quiz">
      ${qs.map((q, idx) => `
        <div class="se-pq-item">
          <div class="se-pq-head">
            <span class="se-cefr-badge cefr-${q.level.toLowerCase()}">${q.level}</span>
            <strong>${idx + 1}. ${esc(q.prompt)}</strong>
            ${q.audioText ? `<button class="btn-glass-sm" onclick="speakEnglishText('${esc(q.audioText)}')"><i class="fa-solid fa-volume-high"></i> Listen</button>` : ''}
          </div>
          <div class="se-pq-opts">
            ${q.options.map((opt, oIdx) => `
              <label class="se-pq-opt">
                <input type="radio" name="pq_${q.id}" value="${oIdx}" onchange="SE.placementAnswers['${q.id}']=${oIdx}">
                <span>${esc(opt)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      `).join('')}
      <div style="display:flex;justify-content:space-between;margin-top:18px">
        <button class="btn-glass-sm" onclick="renderOnboardingStep1()"><i class="fa-solid fa-arrow-left"></i> Back</button>
        <button class="btn-red" onclick="submitPlacementTest()"><i class="fa-solid fa-check"></i> See My Level</button>
      </div>
    </div>
  `;
}

async function submitPlacementTest() {
  const uid = getLearnUserId();
  const res = await fetch('/api/learn/placement-submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: uid,
      answers: SE.placementAnswers,
      goals: SE.placementGoals,
      dailyMinutes: SE.placementMinutes
    })
  });
  const data = await res.json();
  SE.profile = data.profile;
  updateLearnNavBadge();
  const a = data.assessment;

  const body = document.getElementById('learnOnboardingBody');
  if (body && a) {
    body.innerHTML = `
      <div style="text-align:center;padding:24px 12px">
        <div class="se-level-circle" style="width:72px;height:72px;font-size:26px;margin:0 auto 14px">${esc(a.estimatedLevel)}</div>
        <h3>Estimated Level: <span style="color:#f5b50a">${esc(a.estimatedLevel)}</span> (${data.profile.estimatedScore}%)</h3>
        <p style="font-size:13px;color:var(--text-m);max-width:440px;margin:8px auto 18px">
          Correct answers: ${a.correctCount} / ${a.totalQuestions}.
        </p>
        <button class="btn-red" onclick="closeLearnOnboardingModal(); if(window.location.hash.startsWith('#learn')) renderLearnPage({level:'${esc(a.estimatedLevel)}'});">
          Browse ${esc(a.estimatedLevel)} Movies
        </button>
      </div>
    `;
  }
}

// ============================================================
// 3. INTERACTIVE EXERCISES (Step-by-Step)
// ============================================================
function buildInteractiveExercisesMarkup(scene, videoId, mediaTitle) {
  const ex = scene.exercises || {};
  const lc = ex.listenChoose || {};
  const fb = ex.fillBlank || {};
  const dc = ex.dictation || {};
  const so = ex.sentenceOrder || {};
  const sh = ex.shadowing || {};
  SE.orderSelected = [];
  if (!SE.activeExStep) SE.activeExStep = 'listen';
  SE._lastExerciseCtx = { scene, videoId, mediaTitle };

  const steps = [
    { id: 'listen',    icon: 'fa-headphones',    label: '1. Listen' },
    { id: 'blank',     icon: 'fa-pen-to-square', label: '2. Fill Blank' },
    { id: 'dictation', icon: 'fa-keyboard',      label: '3. Dictation' },
    { id: 'order',     icon: 'fa-puzzle-piece',  label: '4. Word Order' },
    { id: 'speaking',  icon: 'fa-microphone',    label: '5. Speaking' }
  ];

  let activeStepHtml = '';
  if (SE.activeExStep === 'listen') {
    activeStepHtml = `
      <div class="se-ex-box">
        <div class="se-ex-head">
          <span>🎧 Listen and choose the correct line</span>
          <button class="btn-glass-sm" onclick="playSceneAudioSegment(${lc.startTime || 0}, ${lc.endTime || 5}, '${esc(lc.correctAnswer || '')}')">
            <i class="fa-solid fa-volume-high"></i> Play Audio
          </button>
        </div>
        <div class="se-quiz-options">
          ${(lc.options || []).map(opt => `
            <button class="se-quiz-opt" onclick="verifySceneExerciseOption(this, '${esc(opt)}', '${esc(lc.correctAnswer)}', 'listening', '${esc(videoId)}', '${esc(scene.id)}')">${esc(opt)}</button>
          `).join('')}
        </div>
      </div>`;
  } else if (SE.activeExStep === 'blank') {
    activeStepHtml = `
      <div class="se-ex-box">
        <div class="se-ex-head">
          <span>✍️ Complete the missing word</span>
          <button class="btn-glass-sm" onclick="playSceneAudioSegment(${fb.startTime || 0}, ${fb.endTime || 5}, '${esc(fb.fullSentence || '')}')">
            <i class="fa-solid fa-volume-high"></i> Listen
          </button>
        </div>
        <div class="se-blank-sent">"${esc(fb.sentenceWithBlank || '')}"</div>
        <div class="se-quiz-options">
          ${(fb.options || []).map(opt => `
            <button class="se-quiz-opt" onclick="verifySceneExerciseOption(this, '${esc(opt)}', '${esc(fb.correctAnswer)}', 'listening', '${esc(videoId)}', '${esc(scene.id)}')">${esc(opt)}</button>
          `).join('')}
        </div>
      </div>`;
  } else if (SE.activeExStep === 'dictation') {
    activeStepHtml = `
      <div class="se-ex-box">
        <div class="se-ex-head">
          <span>⌨️ Type the sentence you hear</span>
          <div style="display:flex;gap:6px">
            <button class="btn-glass-sm" onclick="playSceneAudioSegment(${dc.startTime || 0}, ${dc.endTime || 5}, '${esc(dc.targetSentence || '')}', 1.0)"><i class="fa-solid fa-play"></i> 1x</button>
            <button class="btn-glass-sm" onclick="playSceneAudioSegment(${dc.startTime || 0}, ${dc.endTime || 5}, '${esc(dc.targetSentence || '')}', 0.75)"><i class="fa-solid fa-gauge"></i> 0.75x</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input type="text" class="pay-input" id="seDictInput_${scene.id}" placeholder="Type the English sentence...">
          <button class="btn-red-sm" onclick="checkSceneDictation('${esc(scene.id)}', '${esc(dc.targetSentence || '')}', '${esc(videoId)}')">Check</button>
        </div>
        <div id="seDictFeedback_${scene.id}" style="margin-top:10px"></div>
      </div>`;
  } else if (SE.activeExStep === 'order') {
    activeStepHtml = `
      <div class="se-ex-box">
        <div class="se-ex-head">
          <span>🧩 Put the words in order</span>
          <button class="btn-glass-sm" onclick="resetSentenceOrdering('${esc(scene.id)}')">Reset</button>
        </div>
        <div class="se-order-answer" id="seOrderAns_${scene.id}">Click words in order...</div>
        <div class="se-order-tokens" id="seOrderToks_${scene.id}">
          ${(so.shuffledWords || []).map((w) => `
            <button class="se-word-chip" onclick="pickOrderWord(this, '${esc(scene.id)}', '${esc(w)}', '${esc((so.correctTokens || []).join(' '))}', '${esc(videoId)}')">${esc(w)}</button>
          `).join('')}
        </div>
      </div>`;
  } else {
    activeStepHtml = `
      <div class="se-ex-box">
        <div class="se-ex-head">
          <span>🎙️ Shadowing & Pronunciation</span>
          <button class="btn-glass-sm" onclick="playSceneAudioSegment(${sh.startTime || 0}, ${sh.endTime || 5}, '${esc(sh.targetSentence || '')}')">
            <i class="fa-solid fa-volume-high"></i> Listen
          </button>
        </div>
        <div class="se-shadow-target">"${esc(sh.targetSentence || '')}"</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px">
          <button class="btn-red-sm" id="seMicBtn_${scene.id}" onclick="startShadowingPractice('${esc(scene.id)}', '${esc(sh.targetSentence || '')}', '${esc(videoId)}')">
            <i class="fa-solid fa-microphone"></i> Speak Now
          </button>
        </div>
        <div id="seShadowFeedback_${scene.id}" style="margin-top:10px"></div>
      </div>`;
  }

  return `
    <div id="seExercisesContainer">
      <div class="se-ex-steps">
        ${steps.map(s => `
          <button class="se-ex-step-btn ${SE.activeExStep === s.id ? 'active' : ''}" onclick="switchExerciseStep('${s.id}')">
            <i class="fa-solid ${s.icon}"></i> ${s.label}
          </button>
        `).join('')}
      </div>
      <div class="se-exercises-stack">
        ${activeStepHtml}
      </div>
    </div>
  `;
}

function switchExerciseStep(stepId) {
  SE.activeExStep = stepId;
  const ctx = SE._lastExerciseCtx;
  const wrap = document.getElementById('seExercisesContainer');
  if (ctx && wrap) {
    wrap.outerHTML = buildInteractiveExercisesMarkup(ctx.scene, ctx.videoId, ctx.mediaTitle);
  }
}

function playSceneAudioSegment(start, end, fallbackText, speed = 1.0) {
  const vid = document.getElementById('pvid');
  if (vid && vid.duration) {
    vid.playbackRate = speed;
    vid.currentTime = start;
    SE.loopSegment = { start, end, once: true };
    vid.play().catch(() => {});
  } else if (fallbackText) {
    speakEnglishText(fallbackText, speed);
  }
}

async function verifySceneExerciseOption(btn, chosen, correct, type, videoId, sceneId) {
  const isOk = chosen.trim().toLowerCase() === correct.trim().toLowerCase();
  btn.classList.add(isOk ? 'correct' : 'wrong');
  showToast(isOk ? '✅ Correct!' : `❌ Correct answer: ${correct}`);
  const uid = getLearnUserId();
  await fetch('/api/learn/exercise-submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, mediaId: videoId, sceneId, type, score: isOk ? 100 : 0, maxScore: 100 })
  });
}

async function checkSceneDictation(sceneId, targetSentence, videoId) {
  const inp = document.getElementById(`seDictInput_${sceneId}`);
  const fb = document.getElementById(`seDictFeedback_${sceneId}`);
  if (!inp || !fb) return;
  const res = await fetch('/api/learn/dictation-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetSentence, userInput: inp.value })
  });
  const data = await res.json();

  const wordsHtml = (data.wordDiffs || []).map(w => {
    if (w.state === 'correct') return `<span style="color:#4ade80;font-weight:700">${esc(w.word)}</span>`;
    if (w.state === 'spelling') return `<span style="color:#facc15;text-decoration:underline">${esc(w.word)}</span>`;
    return `<span style="color:#f87171">[${esc(w.word)}]</span>`;
  }).join(' ');

  fb.innerHTML = `
    <div class="se-dict-result">
      <div><strong>Accuracy: ${data.score}%</strong></div>
      <div style="margin-top:6px;font-size:13px">${wordsHtml}</div>
    </div>
  `;
}

function pickOrderWord(btn, sceneId, word, targetJoined, videoId) {
  btn.disabled = true;
  btn.style.opacity = '0.35';
  SE.orderSelected.push(word);
  const ansEl = document.getElementById(`seOrderAns_${sceneId}`);
  if (ansEl) ansEl.textContent = SE.orderSelected.join(' ');

  const targetCount = targetJoined.split(' ').length;
  if (SE.orderSelected.length >= targetCount) {
    const userStr = SE.orderSelected.join(' ').toLowerCase();
    const isOk = userStr === targetJoined.toLowerCase();
    if (ansEl) {
      ansEl.style.borderColor = isOk ? 'var(--green)' : 'var(--red)';
      ansEl.innerHTML = `${esc(SE.orderSelected.join(' '))} — <strong>${isOk ? '✅ Correct!' : `❌ "${esc(targetJoined)}"`}</strong>`;
    }
  }
}

function resetSentenceOrdering(sceneId) {
  SE.orderSelected = [];
  const ansEl = document.getElementById(`seOrderAns_${sceneId}`);
  if (ansEl) { ansEl.textContent = 'Click words in order...'; ansEl.style.borderColor = ''; }
  const wrap = document.getElementById(`seOrderToks_${sceneId}`);
  if (wrap) wrap.querySelectorAll('button').forEach(b => { b.disabled = false; b.style.opacity = '1'; });
}

function startShadowingPractice(sceneId, targetSentence, videoId) {
  const fb = document.getElementById(`seShadowFeedback_${sceneId}`);
  const btn = document.getElementById(`seMicBtn_${sceneId}`);
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRec) {
    if (fb) fb.innerHTML = `<div class="se-dict-result">Speech recognition is not supported in this browser.</div>`;
    return;
  }

  try {
    const rec = new SpeechRec();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    if (btn) btn.innerHTML = `<i class="fa-solid fa-circle-dot fa-beat" style="color:#ef4444"></i> Listening...`;

    rec.onresult = async (ev) => {
      const spoken = ev.results?.[0]?.[0]?.transcript || '';
      if (btn) btn.innerHTML = `<i class="fa-solid fa-microphone"></i> Try Again`;
      const checkRes = await fetch('/api/learn/dictation-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetSentence, userInput: spoken })
      });
      const d = await checkRes.json();
      if (fb) {
        fb.innerHTML = `<div class="se-dict-result">
          <div>🎙️ <strong>You said:</strong> "${esc(spoken)}" (${d.score}% match)</div>
        </div>`;
      }
    };
    rec.onerror = () => {
      if (btn) btn.innerHTML = `<i class="fa-solid fa-microphone"></i> Speak Now`;
    };
    rec.start();
  } catch (e) {}
}

// ============================================================
// 4. UNIVERSAL SINGLE INTERACTIVE SUBTITLE & CLICK-TO-TRANSLATE
//    Works automatically on EVERY movie and episode!
//    - Never renders 2 subtitles on top of each other
//    - Clicking any word opens a clean Liquid Glass translation card
//    - Clicking outside or pressing × closes the card
// ============================================================
async function attachSceneEnglishToPlayer(videoId) {
  if (!SE.profile) initSceneEnglish();
  SE.playerLearnMode = true;
  SE.currentCueIdx = -1;

  // Hide the top-left mode bar and right dock completely so the video is 100% clean
  const bar = document.getElementById('seSubModeBar');
  if (bar) bar.style.display = 'none';
  const dock = document.getElementById('sePlayerDock');
  if (dock) dock.classList.remove('open');

  // Ensure native browser track is hidden so there is only ONE subtitle on screen
  const vid = document.getElementById('pvid');
  if (vid && vid.textTracks) {
    for (let i = 0; i < vid.textTracks.length; i++) {
      vid.textTracks[i].mode = 'hidden';
    }
  }

  const overlay = document.getElementById('seSubOverlay');
  if (overlay) {
    overlay.style.display = STATE.subtitlesEnabled !== false ? 'flex' : 'none';
    overlay.innerHTML = '';
  }

  try {
    const pack = await api(`/api/learn/media-pack/${encodeURIComponent(videoId)}?userId=${encodeURIComponent(getLearnUserId())}`);
    SE.mediaPack = pack;
    SE.cueTranslations = {};
    SE.activeSceneIdx = 0;
    if (vid) updateInteractiveSubtitleAtTime(vid.currentTime || 0, true);
  } catch (e) {
    console.warn('[SUBTITLE] Media pack load error:', e.message);
  }
}

function togglePlayerLearnMode() {
  if (typeof toggleSubtitles === 'function') toggleSubtitles();
}

function onSePlayerTimeUpdate(curTime) {
  if (SE.loopSegment && curTime >= SE.loopSegment.end) {
    const vid = document.getElementById('pvid');
    if (vid) {
      if (SE.loopSegment.once) {
        vid.pause();
        vid.playbackRate = STATE.speed || 1.0;
        SE.loopSegment = null;
      } else {
        vid.currentTime = SE.loopSegment.start;
      }
    }
  }
  updateInteractiveSubtitleAtTime(curTime, false);
}

function getActiveSubtitleCues() {
  if (SE.mediaPack?.cues && SE.mediaPack.cues.length) return SE.mediaPack.cues;
  const vid = document.getElementById('pvid');
  if (vid && vid.textTracks && vid.textTracks[0] && vid.textTracks[0].cues) {
    return Array.from(vid.textTracks[0].cues).map((rc, i) => ({
      index: i,
      startTime: rc.startTime,
      endTime: rc.endTime,
      text: (rc.text || '').replace(/<[^>]+>/g, '').trim()
    }));
  }
  return [];
}

function getSubtitleSnippetAtTime(sec) {
  const offset = STATE.subtitleOffset || 0;
  const adj = sec - offset;
  const cues = getActiveSubtitleCues();
  const c = cues.find(x => adj >= x.startTime && adj <= x.endTime);
  if (!c || !c.text) return '';
  return c.text.length > 52 ? c.text.slice(0, 52) + '...' : c.text;
}

function seekToAdjacentCue(dir) {
  const vid = document.getElementById('pvid');
  if (!vid) return;
  const cues = getActiveSubtitleCues();
  if (!cues.length) {
    seekBy(dir * 5);
    return;
  }
  const offset = STATE.subtitleOffset || 0;
  const adj = (vid.currentTime || 0) - offset;
  let idx = cues.findIndex(c => adj >= c.startTime && adj <= c.endTime);
  if (idx === -1) {
    if (dir > 0) {
      idx = cues.findIndex(c => c.startTime > adj);
    } else {
      for (let i = cues.length - 1; i >= 0; i--) {
        if (cues[i].startTime < adj - 0.5) { idx = i; break; }
      }
    }
  } else {
    idx = idx + dir;
  }
  idx = Math.max(0, Math.min(cues.length - 1, idx));
  const target = cues[idx];
  if (target) {
    vid.currentTime = Math.max(0, target.startTime + offset + 0.02);
    updateInteractiveSubtitleAtTime(vid.currentTime, true);
  }
}

function updateInteractiveSubtitleAtTime(curTime, forceRender = false) {
  const overlay = document.getElementById('seSubOverlay');
  if (!overlay) return;

  // Ensure native textTrack never shows duplicate subtitles
  const vid = document.getElementById('pvid');
  if (vid && vid.textTracks) {
    for (let i = 0; i < vid.textTracks.length; i++) {
      if (vid.textTracks[i].mode === 'showing') vid.textTracks[i].mode = 'hidden';
    }
  }

  if (STATE.subtitlesEnabled === false) {
    overlay.style.display = 'none';
    return;
  }
  overlay.style.display = 'flex';

  const offset = STATE.subtitleOffset || 0;
  const adjTime = curTime - offset;

  const cues = getActiveSubtitleCues();
  const cueIdx = cues.findIndex(c => adjTime >= c.startTime && adjTime <= c.endTime);
  const cue = cueIdx >= 0 ? cues[cueIdx] : null;

  const cueKey = cue ? `${cue.startTime}_${cue.text}` : '';
  if (!forceRender && cueKey === SE._lastCueKey) return;
  SE._lastCueKey = cueKey;

  if (!cue || !cue.text) {
    overlay.innerHTML = '';
    return;
  }

  // Render ONE clean English subtitle pill with subtle prev/next line arrows and clickable words
  overlay.innerHTML = `
    <div class="se-sub-en">
      <button class="se-sub-nav" onclick="event.stopPropagation();seekToAdjacentCue(-1)" title="Previous line ([)"><i class="fa-solid fa-chevron-left"></i></button>
      <span class="se-sub-line-text">${tokenizeInteractiveSubtitleLine(cue.text, cueIdx)}</span>
      <button class="se-sub-nav" onclick="event.stopPropagation();seekToAdjacentCue(1)" title="Next line (])"><i class="fa-solid fa-chevron-right"></i></button>
    </div>
  `;
}

function tokenizeInteractiveSubtitleLine(sentence, cueIdx) {
  const safeSent = String(sentence || '');
  return safeSent.split(/(\s+)/).map(part => {
    if (/^\s+$/.test(part)) return part;
    const pure = part.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '');
    if (pure.length < 2) return esc(part);
    return `<span class="se-sub-word" onclick="event.stopPropagation();openContextualWordPopup('${esc(pure)}', ${cueIdx})">${esc(part)}</span>`;
  }).join('');
}

async function openContextualWordPopup(word, cueIdx) {
  const vid = document.getElementById('pvid');
  const pop = document.getElementById('seWordPopup');
  if (!pop) return;

  // Smart Auto-Pause: remember if video was playing before opening the popup
  if (pop.style.display === 'none') {
    SE._wasPlayingBeforePopup = !!(vid && !vid.paused);
  }
  if (vid && !vid.paused) {
    vid.pause();
  }

  const cues = getActiveSubtitleCues();
  const cue = cues[cueIdx] || { index: cueIdx, text: '', startTime: vid?.currentTime || 0 };
  SE._activePopupSentence = cue.text || '';

  pop.style.display = 'block';
  pop.innerHTML = `
    <div class="se-wp-head">
      <div>
        <span class="se-wp-word">${esc(word)}</span>
      </div>
      <button class="se-wp-close" onclick="closeWordPopup()"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div style="padding:8px 0;color:var(--text-m);font-size:13px"><i class="fa-solid fa-circle-notch fa-spin"></i> Translating...</div>
  `;

  try {
    const info = await api(`/api/learn/lookup?word=${encodeURIComponent(word)}&sentence=${encodeURIComponent(cue.text || '')}&userId=${encodeURIComponent(getLearnUserId())}`);
    speakEnglishText(info.word);

    pop.innerHTML = `
      <div class="se-wp-head">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="se-wp-word">${esc(info.word)}</span>
          ${info.ipa ? `<span class="se-wp-ipa">${esc(info.ipa)}</span>` : ''}
          <button class="se-tts-btn" onclick="speakEnglishText('${esc(info.word)}')" title="Listen"><i class="fa-solid fa-volume-high"></i></button>
        </div>
        <button class="se-wp-close" onclick="closeWordPopup()" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="se-wp-body">
        <div class="se-wp-uz">${esc(info.uzMeaning)}</div>
        <div class="se-wp-meta">
          <span>${esc(info.pos || 'word')}</span>
          ${info.cefr ? `<span class="se-cefr-badge cefr-${info.cefr.toLowerCase()}">${esc(info.cefr)}</span>` : ''}
        </div>
        ${info.relatedIdiom ? `
          <div class="se-wp-idiom">
            💡 <strong>${esc(info.relatedIdiom.phrase)}</strong> — ${esc(info.relatedIdiom.uz)}
          </div>
        ` : ''}
        ${cue.text ? `
          <div class="se-wp-sent-wrap" id="seWpSentWrap">
            <button class="se-wp-sent-btn" onclick="translateCurrentPopupSentence()">
              <i class="fa-solid fa-language"></i> Translate Full Sentence
            </button>
          </div>
        ` : ''}
      </div>
    `;
  } catch (e) {
    pop.innerHTML = `
      <div class="se-wp-head">
        <span class="se-wp-word">${esc(word)}</span>
        <button class="se-wp-close" onclick="closeWordPopup()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div style="padding:6px 0;color:var(--text-m);font-size:13px">Translation unavailable.</div>
    `;
  }
}

async function translateCurrentPopupSentence() {
  const wrap = document.getElementById('seWpSentWrap');
  const sent = SE._activePopupSentence || '';
  if (!wrap || !sent) return;
  wrap.innerHTML = `<div class="se-wp-sent-box"><i class="fa-solid fa-circle-notch fa-spin"></i> Translating sentence...</div>`;
  try {
    const res = await fetch('/api/learn/translate-cues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cues: [{ index: 0, text: sent }] })
    });
    const data = await res.json();
    const uzSent = data?.translations?.[0] || '';
    wrap.innerHTML = `
      <div class="se-wp-sent-box">
        <div class="se-wp-sent-en">"${esc(sent)}"</div>
        <div class="se-wp-sent-uz">${esc(uzSent || 'Translation unavailable')}</div>
      </div>
    `;
  } catch (e) {
    wrap.innerHTML = `<div class="se-wp-sent-box">Sentence translation unavailable.</div>`;
  }
}

function closeWordPopup() {
  const pop = document.getElementById('seWordPopup');
  if (pop && pop.style.display !== 'none') {
    pop.style.display = 'none';
    const vid = document.getElementById('pvid');
    if (SE._wasPlayingBeforePopup && vid && vid.paused) {
      SE._wasPlayingBeforePopup = false;
      vid.play().catch(() => {});
    }
  }
}

// Close word popup or player settings menu when clicking anywhere outside on the screen
document.addEventListener('click', (e) => {
  const pop = document.getElementById('seWordPopup');
  if (pop && pop.style.display !== 'none' && !pop.contains(e.target) && !e.target.classList.contains('se-sub-word')) {
    closeWordPopup();
  }
  const more = document.getElementById('pMoreMenu');
  const moreBtn = document.getElementById('pvMoreBtn');
  if (more && more.style.display !== 'none' && !more.contains(e.target) && (!moreBtn || !moreBtn.contains(e.target))) {
    more.style.display = 'none';
  }
});

document.addEventListener('DOMContentLoaded', () => {
  initSceneEnglish();
});
