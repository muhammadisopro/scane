// ============================================================
// SCENE ENGLISH — Smart Language Learning Backend Engine
// Deeply integrated with LUMEN FLIX streaming platform.
// Provides:
//  - Persistent Learner Profiles & CEFR Placement Assessment (A1-C2)
//  - Contextual English->Uzbek Dictionary, Lemmatizer & Idiom Detector
//  - FSRS-inspired Spaced Repetition System (Red/Yellow/Green states)
//  - Subtitle Scene Segmentation (1.5-4 min mini-lessons)
//  - Real Dialogue Listening Trainer, Grammar-in-Context & Quizzes
//  - Context-Aware AI English Tutor (Gemini/OpenAI + deterministic fallback)
//  - Adaptive Learning Engine & Educational Movie Discovery Metadata
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const WRITE_DIR = process.env.VERCEL ? os.tmpdir() : __dirname;
const DB_PATH = path.join(WRITE_DIR, 'learning_db.json');
const TRANS_CACHE_PATH = path.join(WRITE_DIR, 'translation_cache.json');
const BUNDLED_TRANS_CACHE_PATH = path.join(__dirname, 'translation_cache.json');

// ============================================================
// 1. PERSISTENT DATABASE LAYER
// ============================================================
let db = {
  profiles: {},          // { [userId]: LearnerProfile }
  placementHistory: [],  // Array of placement test records
  vocabulary: [],        // Array of saved user vocabulary entries
  reviewHistory: [],     // Array of SRS review logs
  exerciseAttempts: [],  // Array of listening/grammar/quiz/shadowing attempts
  sceneProgress: [],     // Array of completed scene mini-lessons
  grammarProgress: {},   // { [userId_topicId]: { userId, topicId, attempts, correct, lastPracticedAt } }
};

let transCache = {}; // { [enText]: uzText }

function loadLearningDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
      db = { ...db, ...raw };
    }
  } catch (e) {
    console.error('[SCENE-ENGLISH] Failed to load learning_db.json:', e.message);
  }
  try {
    if (fs.existsSync(TRANS_CACHE_PATH)) {
      transCache = JSON.parse(fs.readFileSync(TRANS_CACHE_PATH, 'utf-8'));
    } else if (fs.existsSync(BUNDLED_TRANS_CACHE_PATH)) {
      transCache = JSON.parse(fs.readFileSync(BUNDLED_TRANS_CACHE_PATH, 'utf-8'));
    }
  } catch (e) {}
}

let _saveTimer = null;
function saveLearningDb(immediate = false) {
  if (immediate) {
    try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch (e) {}
    return;
  }
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch (e) {}
  }, 300);
}

let _transSaveTimer = null;
function saveTransCache() {
  clearTimeout(_transSaveTimer);
  _transSaveTimer = setTimeout(() => {
    try { fs.writeFileSync(TRANS_CACHE_PATH, JSON.stringify(transCache)); } catch (e) {}
  }, 1000);
}

loadLearningDb();

function getOrCreateProfile(userId = 'default') {
  const uid = String(userId || 'default').trim() || 'default';
  if (!db.profiles[uid]) {
    db.profiles[uid] = {
      userId: uid,
      cefrLevel: 'B1',
      estimatedScore: null,
      isProvisional: true,
      onboardingDone: false,
      goals: ['Filmlarni subtitrsiz tushunish', 'Lug‘at boyligini kengaytirish'],
      dailyMinutes: 15,
      preferences: {
        subMode: 'en_uz',          // 'en' | 'en_uz' | 'uz' | 'off'
        autoPauseOnClick: true,
        colorHighlight: true,
        subSize: 'medium',
        subBg: 'semi',
        speechSpeed: 1.0,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveLearningDb();
  }
  return db.profiles[uid];
}

function updateProfile(userId, patch) {
  const prof = getOrCreateProfile(userId);
  if (patch.cefrLevel && ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(patch.cefrLevel)) {
    prof.cefrLevel = patch.cefrLevel;
  }
  if (typeof patch.onboardingDone === 'boolean') prof.onboardingDone = patch.onboardingDone;
  if (typeof patch.isProvisional === 'boolean') prof.isProvisional = patch.isProvisional;
  if (Array.isArray(patch.goals)) prof.goals = patch.goals.slice(0, 6);
  if (typeof patch.dailyMinutes === 'number') prof.dailyMinutes = Math.max(5, Math.min(60, patch.dailyMinutes));
  if (patch.preferences && typeof patch.preferences === 'object') {
    prof.preferences = { ...prof.preferences, ...patch.preferences };
  }
  prof.updatedAt = new Date().toISOString();
  saveLearningDb(true);
  return prof;
}

// ============================================================
// 2. CEFR PLACEMENT ASSESSMENT (ADAPTIVE A1-C2)
// ============================================================
const PLACEMENT_QUESTIONS = [
  {
    id: 'q1',
    level: 'A1',
    skill: 'vocabulary',
    weight: 1,
    prompt: 'Filmda qahramon "I need to find my keys right now" desa, "right now" nimani anglatadi?',
    context: '"I need to find my keys right now."',
    options: ['Hozirning o‘zida / darhol', 'O‘ng tomonda', 'Ertaga ertalab', 'Hech qachon'],
    correct: 0,
    explanation: '"Right now" birikmasi "ayni damda, darhol" degan ma’noni bildiradi.'
  },
  {
    id: 'q2',
    level: 'A2',
    skill: 'grammar',
    weight: 2,
    prompt: 'Bo‘sh joyga mos so‘zni tanlang: "She ___ never seen the ocean before."',
    context: '"She ___ never seen the ocean before."',
    options: ['has', 'did', 'is', 'was'],
    correct: 0,
    explanation: 'Present Perfect zamonida uchinchi shaxs birlik (She) bilan "has + V3 (seen)" ishlatiladi.'
  },
  {
    id: 'q3',
    level: 'A2',
    skill: 'comprehension',
    weight: 2,
    prompt: 'Dialog: "Are you coming with us?" — "I’ll pass, I’m exhausted." Ikkinchi kishi nima demoqchi?',
    context: '"I’ll pass, I’m exhausted."',
    options: [
      'Men bormayman, juda charchadim.',
      'Men imtihondan o‘taman.',
      'Men sizlar bilan boraman.',
      'Yo‘lni ko‘rsatib yuboraman.'
    ],
    correct: 0,
    explanation: '"I’ll pass" og‘zaki nutqda taklifni muloyim rad etish ("men qatnashmayman"), "exhausted" esa "juda holdan toygan" degani.'
  },
  {
    id: 'q4',
    level: 'B1',
    skill: 'vocabulary',
    weight: 3,
    prompt: '"We have to figure out what happened here." — "figure out" fe’lli birikmasining ma’nosi nima?',
    context: '"We have to figure out what happened here."',
    options: [
      'Tushunib yetmoq / aniqlamoq',
      'Rasm chizmoq',
      'Tashqariga chiqmoq',
      'Unutib yubormoq'
    ],
    correct: 0,
    explanation: '"Figure out" — muammo yoki sirning sababini o‘ylab topish, aniqlash degan ma’noni beradi.'
  },
  {
    id: 'q5',
    level: 'B1',
    skill: 'listening',
    audioText: 'If I had known the truth earlier, I would have told you immediately.',
    weight: 3,
    prompt: 'Tinglang yoki o‘qing: "If I had known the truth earlier, I would have told you immediately." Qahramon haqiqatni oldinroq bilganmi?',
    context: '"If I had known the truth earlier, I would have told you immediately."',
    options: [
      'Yo‘q, u haqiqatni oldin bilmagan va shuning uchun ayta olmagan.',
      'Ha, u bilgan va darhol aytgan.',
      'U haqiqatni ertaga aytmoqchi.',
      'U haqiqatni hech qachon bilishni xohlamaydi.'
    ],
    correct: 0,
    explanation: 'Third Conditional ("If I had known..., I would have told...") o‘tmishda sodir bo‘lmagan ish haqida afsuslanishni ifodalaydi.'
  },
  {
    id: 'q6',
    level: 'B2',
    skill: 'vocabulary',
    weight: 4,
    prompt: '"Let’s not jump to conclusions before we see the evidence." Bu ibora nimani anglatadi?',
    context: '"Let’s not jump to conclusions before we see the evidence."',
    options: [
      'Dalillarni ko‘rmasdan turib shoshilinch xulosa chiqarmaylik.',
      'Xulosaga sakrab o‘taylik.',
      'Dalillarni yashirib qo‘yaylik.',
      'Sud jarayonini tezroq tugataylik.'
    ],
    correct: 0,
    explanation: '"Jump to conclusions" — yetarli dalilsiz shoshma-shosharlik bilan xulosa chiqarish idiomasi.'
  },
  {
    id: 'q7',
    level: 'C1',
    skill: 'grammar',
    weight: 5,
    prompt: '"Hardly had we entered the building when the alarm went off." Bu gapning ma’nosi qaysi javobda to‘g‘ri berilgan?',
    context: '"Hardly had we entered the building when the alarm went off."',
    options: [
      'Binoga endigina kirgan ham edikki, signalizatsiya ishlab ketdi.',
      'Biz binoga arang kirdik, chunki signalizatsiya o‘chirilgan edi.',
      'Signalizatsiya chalinganidan keyin binoga kirdik.',
      'Biz binoga umuman kira olmadik.'
    ],
    correct: 0,
    explanation: '"Hardly had + S + V3 ... when ..." — C1 darajasidagi inversiya bo‘lib, bitta ish tugashi bilanoq ikkinchisi boshlanganini bildiradi.'
  },
  {
    id: 'q8',
    level: 'C2',
    skill: 'comprehension',
    weight: 6,
    prompt: '"His apology was nothing short of disingenuous, given his subsequent actions." Gapda qahramonning uzri qanday baholanmoqda?',
    context: '"His apology was nothing short of disingenuous, given his subsequent actions."',
    options: [
      'Uning keyingi xatti-harakatlariga qaraganda, uzri mutlaqo nosamimiy (soxta) edi.',
      'Uning uzri juda qisqa, lekin chin dildan edi.',
      'U keyingi ishlari uchun yana bir bor uzr so‘radi.',
      'Uning uzri barchani hayratda qoldirdi.'
    ],
    correct: 0,
    explanation: '"Nothing short of disingenuous" — "mutlaqo nosamimiy/ikkiyuzlamachi" degan yuqori uslubdagi ifoda.'
  }
];

function evaluatePlacement(userId, answers = {}, goals = [], dailyMinutes = 15) {
  let earned = 0;
  let maxWeight = 0;
  const breakdown = { vocabulary: { ok: 0, total: 0 }, grammar: { ok: 0, total: 0 }, comprehension: { ok: 0, total: 0 }, listening: { ok: 0, total: 0 } };
  let correctCount = 0;

  for (const q of PLACEMENT_QUESTIONS) {
    maxWeight += q.weight;
    const sk = breakdown[q.skill] || (breakdown[q.skill] = { ok: 0, total: 0 });
    sk.total++;
    const userAns = answers[q.id];
    if (Number(userAns) === q.correct) {
      earned += q.weight;
      correctCount++;
      sk.ok++;
    }
  }

  const ratio = maxWeight > 0 ? earned / maxWeight : 0;
  let estimatedLevel = 'A1';
  if (ratio >= 0.88) estimatedLevel = 'C2';
  else if (ratio >= 0.72) estimatedLevel = 'C1';
  else if (ratio >= 0.55) estimatedLevel = 'B2';
  else if (ratio >= 0.36) estimatedLevel = 'B1';
  else if (ratio >= 0.18) estimatedLevel = 'A2';

  const record = {
    id: 'pl_' + Date.now(),
    userId,
    score: earned,
    maxWeight,
    correctCount,
    totalQuestions: PLACEMENT_QUESTIONS.length,
    estimatedLevel,
    breakdown,
    completedAt: new Date().toISOString()
  };
  db.placementHistory.push(record);

  const prof = updateProfile(userId, {
    cefrLevel: estimatedLevel,
    onboardingDone: true,
    isProvisional: false,
    goals: goals && goals.length ? goals : undefined,
    dailyMinutes: dailyMinutes || 15
  });
  prof.estimatedScore = Math.round(ratio * 100);
  saveLearningDb(true);

  return { profile: prof, assessment: record };
}

// ============================================================
// 3. CONTEXTUAL DICTIONARY, LEMMATIZER & IDIOM ENGINE
// ============================================================
const IRREGULAR_LEMMAS = {
  was: 'be', were: 'be', been: 'be', am: 'be', is: 'be', are: 'be',
  had: 'have', has: 'have', having: 'have',
  did: 'do', does: 'do', done: 'do', doing: 'do',
  went: 'go', gone: 'go', goes: 'go', going: 'go',
  saw: 'see', seen: 'see',
  took: 'take', taken: 'take', taking: 'take',
  came: 'come', coming: 'come',
  knew: 'know', known: 'know',
  thought: 'think',
  told: 'tell',
  found: 'find',
  gave: 'give', given: 'give',
  made: 'make', making: 'make',
  said: 'say',
  got: 'get', gotten: 'get', getting: 'get',
  felt: 'feel',
  left: 'leave', leaving: 'leave',
  kept: 'keep',
  brought: 'bring',
  bought: 'buy',
  caught: 'catch',
  chosen: 'choose', chose: 'choose',
  fell: 'fall', fallen: 'fall',
  flew: 'fly', flown: 'fly',
  forgot: 'forget', forgotten: 'forget',
  held: 'hold',
  heard: 'hear',
  lost: 'lose', losing: 'lose',
  met: 'meet',
  paid: 'pay',
  put: 'put',
  ran: 'run', running: 'run',
  sent: 'send',
  spoke: 'speak', spoken: 'speak',
  spent: 'spend',
  stood: 'stand',
  taught: 'teach',
  understood: 'understand',
  won: 'win', winning: 'win',
  wrote: 'write', written: 'write',
  children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth', mice: 'mouse',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad', further: 'far', farthest: 'far'
};

function lemmatize(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z']/g, '');
  if (!w) return '';
  if (IRREGULAR_LEMMAS[w]) return IRREGULAR_LEMMAS[w];
  if (w.endsWith("n't")) return w.slice(0, -3);
  if (w.endsWith("'s") || w.endsWith("'d") || w.endsWith("'m")) return w.slice(0, -2);
  if (w.endsWith("'re") || w.endsWith("'ve") || w.endsWith("'ll")) return w.slice(0, -3);
  if (w.length > 5 && w.endsWith('ing')) {
    const stem = w.slice(0, -3);
    if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) return stem.slice(0, -1);
    return stem;
  }
  if (w.length > 4 && w.endsWith('ied')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('ed')) {
    const stem = w.slice(0, -2);
    if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) return stem.slice(0, -1);
    return stem;
  }
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('es') && /(sh|ch|x|s|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
  return w;
}

// High-value curated cinema vocabulary & phrasal verbs with Uzbek contextual explanations
const CURATED_DICT = {
  actually: {
    uz: 'aslida, haqiqatan ham',
    pos: 'Adverb (Ravish)',
    ipa: '/ˈæk.tʃu.ə.li/',
    explain: 'Suhbatda kutilmagan haqiqatni aytish yoki gapga aniqlik kiritish uchun ishlatiladi.',
    example: 'Actually, I have already seen this movie twice.',
    cefr: 'A2'
  },
  suppose: {
    uz: 'faraz qilmoq, deb o‘ylamoq',
    pos: 'Verb (Fe’l)',
    ipa: '/səˈpəʊz/',
    explain: 'Biror narsani taxmin qilish yoki ikkilanib rozilik bildirishda ("I suppose so") qo‘llanadi.',
    example: 'I suppose we should leave before it gets dark.',
    cefr: 'B1'
  },
  evidence: {
    uz: 'dalil, isbot',
    pos: 'Noun (Ot)',
    ipa: '/ˈev.ɪ.dəns/',
    explain: 'Detektiv va sud haqidagi filmlarda biror voqeani tasdiqlovchi ashyoviy yoki og‘zaki isbot.',
    example: 'There is no evidence that he was at the crime scene.',
    cefr: 'B2'
  },
  exhausted: {
    uz: 'holdan toygan, o‘ta charchagan',
    pos: 'Adjective (Sifat)',
    ipa: '/ɪɡˈzɔː.stɪd/',
    explain: '"Very tired" iborasining kuchli shakli bo‘lib, quvvati qolmaganlikni bildiradi.',
    example: 'After the long mission, the whole team was exhausted.',
    cefr: 'B1'
  },
  meanwhile: {
    uz: 'shu orada, ayni vaqtda',
    pos: 'Adverb (Ravish)',
    ipa: '/ˈmiːn.waɪl/',
    explain: 'Bir vaqtning o‘zida sodir bo‘layotgan ikkinchi voqeaga o‘tishda ishlatiladi.',
    example: 'You pack the bags; meanwhile, I will call a taxi.',
    cefr: 'B1'
  },
  inevitable: {
    uz: 'muqarrar, qochib bo‘lmas',
    pos: 'Adjective (Sifat)',
    ipa: '/ɪˈnev.ɪ.tə.bəl/',
    explain: 'Oldini olib bo‘lmaydigan, albatta sodir bo‘ladigan hodisa haqida aytiladi.',
    example: 'Change is inevitable in every hero’s journey.',
    cefr: 'B2'
  },
  betray: {
    uz: 'xiyonat qilmoq, sotmoq',
    pos: 'Verb (Fe’l)',
    ipa: '/bɪˈtreɪ/',
    explain: 'Do‘st yoki ittifoqchining ishonchini suiiste’mol qilib, dushman tomoniga o‘tish.',
    example: 'He promised he would never betray his friends.',
    cefr: 'B2'
  },
  suspicious: {
    uz: 'shubhali, gumonli',
    pos: 'Adjective (Sifat)',
    ipa: '/səˈspɪʃ.əs/',
    explain: 'G‘alati yoki yashirin xatti-harakat tufayli shubha uyg‘otadigan holat.',
    example: 'The guard noticed a suspicious shadow near the gate.',
    cefr: 'B2'
  },
  survivor: {
    uz: 'tirik qolgan, omon qolgan kishi',
    pos: 'Noun (Ot)',
    ipa: '/səˈvaɪ.vər/',
    explain: 'Xavfli halokat yoki jangdan so‘ng omon qolgan inson.',
    example: 'She was the only survivor of the crash.',
    cefr: 'B1'
  },
  destiny: {
    uz: 'taqdir, qismat',
    pos: 'Noun (Ot)',
    ipa: '/ˈdes.tɪ.ni/',
    explain: 'Insonning kelajakda oldindan belgilangan yo‘li yoki buyuk vazifasi.',
    example: 'He believed it was his destiny to protect the kingdom.',
    cefr: 'B2'
  },
  realize: {
    uz: 'anglab yetmoq, tushunmoq',
    pos: 'Verb (Fe’l)',
    ipa: '/ˈrɪə.laɪz/',
    explain: 'Biror faktni to‘satdan yoki chuqur o‘ylab tushunib yetish.',
    example: 'I didn’t realize how late it was.',
    cefr: 'A2'
  },
  pretend: {
    uz: 'o‘zini ...dek tutmoq, mug‘ombirlik qilmoq',
    pos: 'Verb (Fe’l)',
    ipa: '/prɪˈtend/',
    explain: 'Aslida unday bo‘lmasa ham, boshqalarni ishontirish uchun rol o‘ynamoq.',
    example: 'Don’t pretend you don’t know what happened.',
    cefr: 'B1'
  },
  ridiculous: {
    uz: 'kulgi uyg‘otadigan, bema’ni',
    pos: 'Adjective (Sifat)',
    ipa: '/rɪˈdɪk.jə.ləs/',
    explain: 'Mantiqqa to‘g‘ri kelmaydigan darajada ahmoqona yoki kulgili narsa.',
    example: 'That is the most ridiculous excuse I have ever heard.',
    cefr: 'B1'
  },
  appreciate: {
    uz: 'qadrlamoq, minnatdor bo‘lmoq',
    pos: 'Verb (Fe’l)',
    ipa: '/əˈpriː.ʃi.eɪt/',
    explain: 'Kimningdir yordami yoki yaxshiligini yuqori baholash va rahmat aytish.',
    example: 'I really appreciate everything you have done for our family.',
    cefr: 'B1'
  },
  consequence: {
    uz: 'oqibat, natija',
    pos: 'Noun (Ot)',
    ipa: '/ˈkɒn.sɪ.kwəns/',
    explain: 'Qilingan qaror yoki harakatning (ko‘pincha jiddiy) natijasi.',
    example: 'Every choice has a consequence.',
    cefr: 'B2'
  },
  glorious: {
    uz: 'shonli, ulug‘vor',
    pos: 'Adjective (Sifat)',
    ipa: '/ˈɡlɔː.ri.əs/',
    explain: 'Shuhrat va ulug‘vorlikka to‘la, hayratlanarli.',
    example: 'I am burdened with glorious purpose.',
    cefr: 'B2'
  },
  purpose: {
    uz: 'maqsad, vazifa',
    pos: 'Noun (Ot)',
    ipa: '/ˈpɜː.pəs/',
    explain: 'Biror narsaning mavjud bo‘lish sababi yoki ko‘zlangan niyat.',
    example: 'What is the main purpose of this mission?',
    cefr: 'B1'
  },
  burden: {
    uz: 'og‘ir yuk, mas’uliyat',
    pos: 'Noun / Verb',
    ipa: '/ˈbɜː.dən/',
    explain: 'Ruhiy yoki jismoniy jihatdan og‘irlik qiladigan vazifa yoki tashvish.',
    example: 'I don’t want to be a burden to anyone.',
    cefr: 'B2'
  }
};

// Phrasal verbs & idioms recognized as multi-word units in subtitles
const PHRASAL_IDIOMS = [
  { phrase: 'figure out', uz: 'tushunib yetmoq, yechimini topmoq', pos: 'Phrasal Verb', explain: 'Murakkab vaziyat yoki muammoni o‘ylab topish, hal qilish.', example: 'We need to figure out how they escaped.' },
  { phrase: 'give up', uz: 'taslim bo‘lmoq, voz kechmoq', pos: 'Phrasal Verb', explain: 'Urinishni to‘xtatish yoki umidni uzish.', example: 'Never give up on what matters to you.' },
  { phrase: 'find out', uz: 'bilib olmoq, fosh qilmoq', pos: 'Phrasal Verb', explain: 'Yashirin ma’lumot yoki haqiqatni aniqlash.', example: 'If they find out we are here, we are in trouble.' },
  { phrase: 'turn out', uz: '...bo‘lib chiqmoq, natijalanmoq', pos: 'Phrasal Verb', explain: 'Voqeaning kutilmagan tarzda yakunlanishi.', example: 'It turned out that he was telling the truth all along.' },
  { phrase: 'run out of', uz: 'tugab qolmoq (vaqt yoki zaxira)', pos: 'Phrasal Verb', explain: 'Biror narsaning oxirigacha sarflanib tugashi.', example: 'We are running out of time!' },
  { phrase: 'look after', uz: 'g‘amxo‘rlik qilmoq, qarab turmoq', pos: 'Phrasal Verb', explain: 'Kimnidir yoki biror narsani ehtiyot qilib parvarishlash.', example: 'Promise me you will look after her.' },
  { phrase: 'make sense', uz: 'mantiqiy bo‘lmoq, tushunarli bo‘lmoq', pos: 'Idiom', explain: 'Vaziyatning aqlga sig‘ishi va tushunarli ekanligi.', example: 'Wait, none of this makes sense!' },
  { phrase: 'right now', uz: 'hozirning o‘zida, darhol', pos: 'Expression', explain: 'Hech qanday kechikishsiz, ayni soniyada.', example: 'We have to leave the building right now.' },
  { phrase: 'by the way', uz: 'darvoqe, aytgancha', pos: 'Expression', explain: 'Suhbat mavzusiga qo‘shimcha fikr qo‘shishda ishlatiladi.', example: 'By the way, did you talk to the captain?' },
  { phrase: 'in charge of', uz: 'mas’ul, boshqaruvchi', pos: 'Expression', explain: 'Biror ish yoki guruh ustidan nazorat va javobgarlikka ega bo‘lish.', example: 'Who is in charge of this operation?' },
  { phrase: 'no matter what', uz: 'nima bo‘lishidan qat’i nazar', pos: 'Expression', explain: 'Har qanday qiyinchilikda ham qaror o‘zgarmasligini bildiradi.', example: 'Stick to the plan, no matter what happens.' },
  { phrase: 'get rid of', uz: 'qutulmoq, yo‘qotmoq', pos: 'Phrasal Verb', explain: 'Keraksiz yoki xavfli narsadan xalos bo‘lish.', example: 'We need to get rid of the tracker.' },
  { phrase: 'count on', uz: 'ishonmoq, suyanmoq', pos: 'Phrasal Verb', explain: 'Qiyin vaziyatda kimningdir yordamiga tayanish.', example: 'You can always count on me.' },
  { phrase: 'calm down', uz: 'tinchlanmoq, o‘zini bosmoq', pos: 'Phrasal Verb', explain: 'Hayajon yoki g‘azabdan keyin xotirjam bo‘lish.', example: 'Take a deep breath and calm down.' },
  { phrase: 'hang on', uz: 'kutib turmoq / mahkam ushlamoq', pos: 'Phrasal Verb', explain: 'Qisqa muddat kutishni so‘rash yoki qattiq ushlab turish.', example: 'Hang on a second, I hear something.' }
];

function detectPhrasesInSentence(sentence) {
  const low = String(sentence || '').toLowerCase();
  return PHRASAL_IDIOMS.filter(p => low.includes(p.phrase));
}

function getHttpsText(urlStr, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*'
    };
    const req = https.get(urlStr, { headers }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return getHttpsText(res.headers.location, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Multi-Engine Free English -> Uzbek Translator & Dictionary Cascade
async function translateEnToUzWithDict(text) {
  const clean = String(text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return { uz: '', synonyms: [], pos: '' };

  // Engine 1: Google Android Dictionary API (client=at&dt=t&dt=bd&dj=1) -> Returns translation + Uzbek dictionary synonyms!
  try {
    const u1 = `https://translate.google.com/translate_a/single?client=at&dt=t&dt=bd&dj=1&sl=en&tl=uz&q=${encodeURIComponent(clean)}`;
    const raw1 = await getHttpsText(u1, 4500);
    const j1 = JSON.parse(raw1);
    const trans = (j1.sentences || []).map(s => s.trans || '').join('').trim();
    const dictEntry = Array.isArray(j1.dict) && j1.dict[0] ? j1.dict[0] : null;
    const synonyms = dictEntry && Array.isArray(dictEntry.terms) ? dictEntry.terms.slice(0, 5) : [];
    const pos = dictEntry && dictEntry.pos ? dictEntry.pos : '';
    if (trans) {
      transCache[clean] = trans;
      saveTransCache();
      return { uz: trans, synonyms, pos };
    }
  } catch (e) {}

  // Engine 2: Chrome Extension Dictionary API (clients5.google.com/translate_a/t?client=dict-chrome-ex)
  try {
    const u2 = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=uz&q=${encodeURIComponent(clean)}`;
    const raw2 = await getHttpsText(u2, 4500);
    const j2 = JSON.parse(raw2);
    const trans = Array.isArray(j2) ? (typeof j2[0] === 'string' ? j2[0] : (j2[0] && j2[0][0] ? j2[0][0] : '')) : '';
    if (trans) {
      transCache[clean] = trans.trim();
      saveTransCache();
      return { uz: trans.trim(), synonyms: [], pos: '' };
    }
  } catch (e) {}

  // Engine 3: MyMemory Free Translation API (api.mymemory.translated.net)
  try {
    const u3 = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean)}&langpair=en|uz`;
    const raw3 = await getHttpsText(u3, 5000);
    const j3 = JSON.parse(raw3);
    const trans = j3?.responseData?.translatedText || '';
    if (trans && !/MYMEMORY WARNING/i.test(trans)) {
      transCache[clean] = trans.trim();
      saveTransCache();
      return { uz: trans.trim(), synonyms: [], pos: '' };
    }
  } catch (e) {}

  return { uz: transCache[clean] || '', synonyms: [], pos: '' };
}

async function translateEnToUz(text) {
  const clean = String(text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (transCache[clean] && transCache[clean].toLowerCase() !== clean.toLowerCase()) {
    return transCache[clean];
  }
  const res = await translateEnToUzWithDict(clean);
  return res.uz || '';
}

async function translateBatchCues(cues = []) {
  const results = {};
  const missing = [];
  for (const c of cues) {
    const clean = String(c.text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    if (transCache[clean] && transCache[clean].toLowerCase() !== clean.toLowerCase()) {
      results[c.index] = transCache[clean];
    } else {
      missing.push({ index: c.index, text: clean });
    }
  }
  // Batch in chunks of 10 lines separated by newline
  for (let i = 0; i < missing.length; i += 10) {
    const slice = missing.slice(i, i + 10);
    const joined = slice.map(x => x.text).join('\n');
    const tr = await translateEnToUzWithDict(joined);
    if (tr.uz) {
      const lines = tr.uz.split('\n');
      slice.forEach((item, idx) => {
        const trLine = (lines[idx] || '').trim();
        if (trLine) {
          transCache[item.text] = trLine;
          results[item.index] = trLine;
        }
      });
    }
  }
  if (missing.length) saveTransCache();
  return results;
}

async function lookupContextualWord({ word, sentence = '', userId = 'default' }) {
  const rawInput = String(word || '').trim().replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '');
  const lowInput = rawInput.toLowerCase();
  const isPhrase = lowInput.includes(' ');
  const baseLemma = isPhrase ? lowInput : lemmatize(lowInput);

  // Check if user already has this word in their vocabulary bank
  const existingVocab = db.vocabulary.find(v => v.userId === userId && (v.lemma === baseLemma || v.word.toLowerCase() === lowInput));
  const detectedPhrases = detectPhrasesInSentence(sentence);
  const matchingIdiom = PHRASAL_IDIOMS.find(p => p.phrase === lowInput || (sentence && p.phrase.split(' ').includes(lowInput) && sentence.toLowerCase().includes(p.phrase)));

  // 1. Check Curated Dictionary or Idiom table first
  const curated = CURATED_DICT[baseLemma] || CURATED_DICT[lowInput];

  let ipa = curated?.ipa || '';
  let pos = curated?.pos || (isPhrase ? 'Phrase / Birikma' : 'Word');
  let audioUrl = '';
  let enDefinition = '';
  let example = curated?.example || '';

  const posMap = {
    noun: 'Noun (Ot)',
    verb: 'Verb (Fe’l)',
    adjective: 'Adjective (Sifat)',
    adverb: 'Adverb (Ravish)',
    pronoun: 'Pronoun (Olmosh)',
    preposition: 'Preposition (Predlog)',
    conjunction: 'Conjunction (Bog‘lovchi)',
    interjection: 'Interjection (Undov)'
  };

  // 2. Query Free Dictionary API + Multi-Engine Uzbek Dictionary in parallel
  const [dictApiRes, wordRichRes, lemmaRichRes, uzSentence] = await Promise.all([
    (!isPhrase && baseLemma.length >= 2)
      ? getHttpsText(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(baseLemma)}`, 3500).then(r => JSON.parse(r)).catch(() => null)
      : Promise.resolve(null),
    curated
      ? Promise.resolve({ uz: curated.uz, synonyms: [], pos: curated.pos })
      : (matchingIdiom && matchingIdiom.phrase === lowInput
          ? Promise.resolve({ uz: matchingIdiom.uz, synonyms: [], pos: matchingIdiom.pos })
          : translateEnToUzWithDict(rawInput)),
    (!curated && !isPhrase && baseLemma !== lowInput)
      ? translateEnToUzWithDict(baseLemma)
      : Promise.resolve(null),
    sentence ? translateEnToUz(sentence) : Promise.resolve('')
  ]);

  if (Array.isArray(dictApiRes) && dictApiRes[0]) {
    const entry = dictApiRes[0];
    if (!ipa) ipa = entry.phonetic || (entry.phonetics?.find(p => p.text)?.text) || '';
    audioUrl = entry.phonetics?.find(p => p.audio)?.audio || '';
    const m0 = entry.meanings?.[0];
    if (m0) {
      if (!curated?.pos) pos = posMap[m0.partOfSpeech?.toLowerCase()] || m0.partOfSpeech;
      enDefinition = m0.definitions?.[0]?.definition || '';
      if (!example) example = m0.definitions?.[0]?.example || '';
    }
  }

  if (pos === 'Word' && wordRichRes?.pos) {
    pos = posMap[wordRichRes.pos.toLowerCase()] || wordRichRes.pos;
  }

  // Combine primary meaning + dictionary synonyms so the user gets a rich Uzbek dictionary translation!
  const allSynonyms = [
    ...(wordRichRes?.synonyms || []),
    ...(lemmaRichRes?.synonyms || [])
  ].filter((v, idx, arr) => v && v.toLowerCase() !== rawInput.toLowerCase() && arr.indexOf(v) === idx);

  let primaryUz = wordRichRes?.uz || lemmaRichRes?.uz || curated?.uz || '';
  if (allSynonyms.length > 0) {
    const topSyns = allSynonyms.filter(s => s.toLowerCase() !== primaryUz.toLowerCase()).slice(0, 3);
    if (topSyns.length > 0) {
      primaryUz = primaryUz ? `${primaryUz} (${topSyns.join(', ')})` : topSyns.join(', ');
    }
  }

  const uzMeaning = primaryUz || rawInput;
  const uzExplanation = curated?.explain
    || (matchingIdiom ? `Bu sahnada "${matchingIdiom.phrase}" birikmasi "${matchingIdiom.uz}" ma’nosida qo‘llangan. ${matchingIdiom.explain}` : '')
    || (uzSentence ? `Sahna tarjimasi: "${uzSentence}"` : `"${rawInput}" so‘zining o‘zbekcha ma’nosi: ${uzMeaning}.`);

  if (!example) {
    example = sentence || `Can you explain what "${rawInput}" means in this scene?`;
  }

  return {
    word: rawInput,
    lemma: baseLemma,
    isPhrase,
    uzMeaning,
    pos,
    ipa: ipa || `/${baseLemma}/`,
    audioUrl,
    uzExplanation,
    contextSentence: sentence || '',
    contextUz: uzSentence || '',
    example,
    cefr: curated?.cefr || (baseLemma.length <= 4 ? 'A1' : baseLemma.length <= 6 ? 'A2' : baseLemma.length <= 8 ? 'B1' : 'B2'),
    relatedIdiom: matchingIdiom || (detectedPhrases[0] || null),
    userStatus: existingVocab ? existingVocab.status : 'neutral',
    vocabId: existingVocab ? existingVocab.id : null
  };
}

// ============================================================
// 4. PERSONAL VOCABULARY BANK & FSRS SPACED REPETITION
// ============================================================
function saveUserVocab(userId, payload) {
  const uid = String(userId || 'default').trim() || 'default';
  const word = String(payload.word || '').trim();
  if (!word) throw new Error('Word is required');
  const lemma = payload.lemma || lemmatize(word) || word.toLowerCase();

  // Check duplicate by userId + lemma (unless it's a distinct multi-word expression)
  let entry = db.vocabulary.find(v => v.userId === uid && v.lemma === lemma && v.word.toLowerCase() === word.toLowerCase());
  const now = new Date();

  if (entry) {
    if (payload.status && ['red', 'yellow', 'green'].includes(payload.status)) entry.status = payload.status;
    if (payload.uzMeaning) entry.uzMeaning = payload.uzMeaning;
    if (payload.contextSentence) entry.contextSentence = payload.contextSentence;
    if (payload.mediaId) {
      entry.mediaId = payload.mediaId;
      entry.mediaTitle = payload.mediaTitle || entry.mediaTitle;
      entry.timestamp = payload.timestamp ?? entry.timestamp;
    }
    entry.updatedAt = now.toISOString();
  } else {
    entry = {
      id: 'voc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      userId: uid,
      word,
      lemma,
      pos: payload.pos || 'Word',
      ipa: payload.ipa || '',
      uzMeaning: payload.uzMeaning || '',
      uzExplanation: payload.uzExplanation || '',
      contextSentence: payload.contextSentence || '',
      originalExample: payload.example || payload.contextSentence || '',
      mediaId: payload.mediaId || null,
      mediaTitle: payload.mediaTitle || 'Movie Scene',
      isSeries: !!payload.isSeries,
      season: payload.season || null,
      episode: payload.episode || null,
      timestamp: typeof payload.timestamp === 'number' ? Math.round(payload.timestamp) : 0,
      status: payload.status && ['red', 'yellow', 'green'].includes(payload.status) ? payload.status : 'red',
      // FSRS state parameters
      stability: 0.5,
      difficulty: 5.0,
      reps: 0,
      lapses: 0,
      intervalDays: 0,
      lastReviewedAt: null,
      nextReviewAt: now.toISOString(), // Immediately due for first reinforcement
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    db.vocabulary.unshift(entry);
  }
  saveLearningDb(true);
  return entry;
}

function updateVocabStatus(userId, vocabId, status) {
  const entry = db.vocabulary.find(v => v.userId === userId && (v.id === vocabId || v.lemma === vocabId));
  if (!entry) return null;
  if (['red', 'yellow', 'blue', 'white', 'green'].includes(status)) {
    entry.status = status === 'green' ? 'white' : status;
    if (entry.status === 'white') entry.reps = Math.max(3, entry.reps || 3);
    else if (entry.status === 'blue') entry.reps = 2;
    else if (entry.status === 'yellow') entry.reps = 1;
    else if (entry.status === 'red') {
      entry.reps = 0;
      entry.nextReviewAt = new Date().toISOString();
    }
    entry.updatedAt = new Date().toISOString();
    saveLearningDb(true);
  }
  return entry;
}

function deleteUserVocab(userId, vocabId) {
  const idx = db.vocabulary.findIndex(v => v.userId === userId && v.id === vocabId);
  if (idx >= 0) {
    const removed = db.vocabulary.splice(idx, 1)[0];
    saveLearningDb(true);
    return removed;
  }
  return null;
}

function getUserVocabList(userId) {
  const uid = String(userId || 'default').trim() || 'default';
  return db.vocabulary.filter(v => v.userId === uid);
}

/**
 * FSRS-inspired Spaced Repetition Scheduler
 * Ratings:
 *  1 = Esimda yo'q (Again)
 *  2 = Qiyin (Hard)
 *  3 = Yaxshi (Good)
 *  4 = Juda oson (Easy)
 */
function submitVocabReview(userId, { vocabId, rating, reviewFormat = 'flashcard' }) {
  const uid = String(userId || 'default').trim() || 'default';
  const card = db.vocabulary.find(v => v.userId === uid && v.id === vocabId);
  if (!card) throw new Error('Vocabulary card not found');

  const r = Math.max(1, Math.min(4, Number(rating) || 3));
  const now = new Date();

  // Update FSRS difficulty (1..10) & stability (days)
  const prevS = card.stability || 0.5;
  const prevD = card.difficulty || 5.0;
  card.difficulty = Math.max(1, Math.min(10, prevD - 0.6 * (r - 3)));

  let nextIntervalDays = 0;
  if (r === 1) {
    // Wrong / Forgot -> reset to Red (0/3)
    card.lapses = (card.lapses || 0) + 1;
    card.reps = Math.max(0, (card.reps || 0) - 1);
    card.stability = Math.max(0.25, prevS * 0.4);
    nextIntervalDays = 0;
  } else {
    // Correct answer -> increment mastery stage (0 -> 1 -> 2 -> 3)
    card.reps = (card.reps || 0) + 1;
    card.stability = card.reps === 1 ? 1.5 : prevS * 2.0;
    nextIntervalDays = Math.max(1, Math.round(card.stability));
  }

  // 4-Stage Color Mastery Progression:
  // 0 reps -> 'red' (🔴 New)
  // 1 rep  -> 'yellow' (🟡 Learning)
  // 2 reps -> 'blue' (🔵 Almost Mastered)
  // 3+ reps -> 'white' (⚪ Mastered / Default White)
  if ((card.reps || 0) <= 0) card.status = 'red';
  else if (card.reps === 1) card.status = 'yellow';
  else if (card.reps === 2) card.status = 'blue';
  else card.status = 'white';

  card.intervalDays = nextIntervalDays;
  card.lastReviewedAt = now.toISOString();
  card.nextReviewAt = new Date(now.getTime() + (nextIntervalDays === 0 ? 10 * 60000 : nextIntervalDays * 86400000)).toISOString();
  card.updatedAt = now.toISOString();

  const log = {
    id: 'rev_' + Date.now(),
    userId: uid,
    vocabId: card.id,
    word: card.word,
    rating: r,
    reviewFormat,
    scheduledDays: nextIntervalDays,
    newStatus: card.status,
    reviewedAt: now.toISOString()
  };
  db.reviewHistory.push(log);
  saveLearningDb(true);
  return { card, log };
}

function getReviewQueue(userId) {
  const list = getUserVocabList(userId);
  const now = Date.now();
  const due = list.filter(v => !v.nextReviewAt || new Date(v.nextReviewAt).getTime() <= now + 3600000);

  // Build distractor pool from user's own words + curated dictionary
  const distractorPool = [
    ...list.map(v => ({ en: v.word, uz: v.uzMeaning })).filter(x => x.uz),
    ...Object.entries(CURATED_DICT).map(([en, d]) => ({ en, uz: d.uz }))
  ];

  const items = (due.length ? due : list.slice(0, 10)).map((card, i) => {
    const wrongUz = distractorPool
      .filter(d => d.en.toLowerCase() !== card.word.toLowerCase() && d.uz !== card.uzMeaning)
      .slice(0, 12)
      .sort(() => 0.5 - Math.random())
      .slice(0, 3)
      .map(d => d.uz);
    while (wrongUz.length < 3) {
      const fallbacks = ['aniqlamoq, tushunmoq', 'muqarrar, aniq', 'vaqtinchalik holat', 'xavfli vaziyat'];
      const pick = fallbacks[wrongUz.length % fallbacks.length];
      if (!wrongUz.includes(pick) && pick !== card.uzMeaning) wrongUz.push(pick);
      else break;
    }
    const uzOptions = [card.uzMeaning || 'ma’nosi', ...wrongUz].sort(() => 0.5 - Math.random());

    const wrongEn = distractorPool
      .filter(d => d.en.toLowerCase() !== card.word.toLowerCase())
      .slice(0, 12)
      .sort(() => 0.5 - Math.random())
      .slice(0, 3)
      .map(d => d.en);
    const enOptions = [card.word, ...wrongEn].sort(() => 0.5 - Math.random());

    // Blank out the word in the example sentence for Fill-in-the-blank format
    const sent = card.contextSentence || card.originalExample || `This scene uses the word ${card.word}.`;
    const re = new RegExp(`\\b${card.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const blankSentence = re.test(sent) ? sent.replace(re, '_____') : `${sent} (_____)`;

    return {
      card,
      formats: {
        enToUz: {
          question: `"${card.word}" so‘zining o‘zbekcha ma’nosi qaysi?`,
          options: uzOptions,
          correctAnswer: card.uzMeaning
        },
        uzToEn: {
          question: `"${card.uzMeaning}" ma’nosini beruvchi inglizcha so‘zni toping:`,
          options: enOptions,
          correctAnswer: card.word
        },
        fillBlank: {
          question: `Bo‘sh joyni to‘ldiring: "${blankSentence}"`,
          options: enOptions,
          correctAnswer: card.word
        }
      }
    };
  });

  return {
    dueCount: due.length,
    totalVocab: list.length,
    items
  };
}

// ============================================================
// 5. GRAMMAR-IN-CONTEXT DETECTOR & EXPLAINER
// ============================================================
const GRAMMAR_RULES = [
  {
    id: 'present_perfect',
    title: 'Present Perfect (have/has + V3)',
    regex: /\b(have|has|haven't|hasn't|'ve)\s+(?:never\s+|already\s+|just\s+|ever\s+)?(been|seen|done|made|taken|found|gone|known|heard|told|lost|met|felt|become|given|spoken|written|[a-z]+ed)\b/i,
    explainA: 'O‘tmishda boshlangan yoki sodir bo‘lgan, lekin natijasi hozirgi vaqtga bog‘liq bo‘lgan ish-harakat (have/has + V3).',
    explainB: 'Present Perfect tajriba ("I have seen"), yaqinda tugagan harakat ("She has just left") yoki hozirgacha davom etayotgan holatni ifodalaydi.',
    example: 'I have never seen anything like this before.',
    quiz: {
      q: 'Qaysi gapda Present Perfect to‘g‘ri qo‘llangan?',
      options: ['We have already finished the mission.', 'We has finish the mission yesterday.', 'We are finished the mission ago.', 'We did have finished it.'],
      correct: 0
    }
  },
  {
    id: 'modals_deduction',
    title: 'Modal Verbs (must / should / could / might)',
    regex: /\b(must|should|shouldn't|could|couldn't|might|have to|ought to)\s+(?:be|have|go|know|find|take|stay|leave|stop|tell|do|get)\b/i,
    explainA: 'Majburiyat ("must", "have to"), maslahat ("should") yoki ehtimollikni ("might", "could") bildiruvchi yordamchi fe’llar.',
    explainB: 'Modal fe’llardan keyin asosiy fe’l doim "to" yuklamasisiz (V1) keladi; "must/might + have V3" esa o‘tmish haqidagi taxminni bildiradi.',
    example: 'You should listen carefully before making a decision.',
    quiz: {
      q: 'Maslahat berish uchun qaysi modal fe’l eng mos?',
      options: ['You should get some rest.', 'You must to get rest.', 'You might resting now.', 'You can to rest.'],
      correct: 0
    }
  },
  {
    id: 'conditionals',
    title: 'Conditionals (If + shart ergash gaplar)',
    regex: /\bif\s+(?:i|you|we|they|he|she|it)\s+(?:had|were|was|knew|found|went|could|didn't|don't|stay|leave)\b/i,
    explainA: '"If" (agar) so‘zi bilan boshlanib, shart va uning natijasini ("will" yoki "would") ifodalovchi gap qurilmasi.',
    explainB: 'Real shartlar (1st Conditional: If + Present, will + V1) kelajakni, noreal shartlar (2nd/3rd Conditional: If + Past/Past Perfect, would) esa farazni bildiradi.',
    example: 'If we stay together, we will survive this.',
    quiz: {
      q: 'First Conditional qoidasiga mos gapni toping:',
      options: ['If it rains, we will stay inside.', 'If it will rain, we stay inside.', 'If it rained, we will stayed.', 'If it rain, we would stay.'],
      correct: 0
    }
  },
  {
    id: 'passive_voice',
    title: 'Passive Voice (Majhul nisbat: be + V3)',
    regex: /\b(was|were|is|are|been)\s+(?:being\s+)?(built|made|killed|taken|stolen|chosen|sent|destroyed|created|found|locked|hidden|written|told)\b/i,
    explainA: 'Ish-harakatni kim bajargani emas, balki ishning o‘zi muhim bo‘lganda "be + V3" (majhul nisbat) ishlatiladi.',
    explainB: 'Filmlarda jinoyat yoki tarixiy voqealar haqida gapirilganda ("The artifact was stolen") bajaruvchi noma’lum bo‘lgani uchun Passive Voice ko‘p qo‘llanadi.',
    example: 'The secret door was locked from the inside.',
    quiz: {
      q: '"Xat kecha yuborildi" gapining inglizcha Passive Voice shakli qaysi?',
      options: ['The letter was sent yesterday.', 'The letter sent yesterday.', 'The letter is send yesterday.', 'The letter were sending.'],
      correct: 0
    }
  },
  {
    id: 'present_continuous',
    title: 'Present / Past Continuous (be + V-ing)',
    regex: /\b(am|is|are|was|were|'m|'re|'s)\s+(?:not\s+)?[a-z]+ing\b/i,
    explainA: 'Ayni nutq lahzasida yoki o‘tmishning ma’lum bir vaqtida davom etayotgan harakatni (be + fe’l+ing) bildiradi.',
    explainB: 'Jonli dialoglarda "What are you doing?" yoki yaqin kelajakdagi aniq rejani ("We are leaving tonight") ifodalash uchun juda faol ishlatiladi.',
    example: 'What are you talking about?',
    quiz: {
      q: 'Hozir davom etayotgan harakatni bildiruvchi gapni tanlang:',
      options: ['They are waiting for us outside.', 'They wait for us right now.', 'They waiting outside.', 'They is wait for us.'],
      correct: 0
    }
  },
  {
    id: 'spoken_contractions',
    title: 'Spoken English (gonna / wanna / gotta)',
    regex: /\b(gonna|wanna|gotta|ain't|lemme|gimme|kinda|outta)\b/i,
    explainA: 'Kino va kundalik jonli nutqda "going to" -> "gonna", "want to" -> "wanna", "got to" -> "gotta" tarzida qisqartirib aytiladi.',
    explainB: 'Bu qisqartmalar og‘zaki ingliz tilida tabiiy eshitiladi va tez gapirilgan dialoglarni (Listening) tushunishning asosiy kalitidir.',
    example: 'I’m gonna find out what happened.',
    quiz: {
      q: '"We gotta move fast!" gapidagi "gotta" nimaning qisqartmasi?',
      options: ['have got to / must (majburmiz)', 'going to (ketmoqchi)', 'want to (xohlamoq)', 'gave to (berdi)'],
      correct: 0
    }
  }
];

function analyzeSentenceGrammar(sentence, cefrLevel = 'B1') {
  const s = String(sentence || '').trim();
  const matches = [];
  const isBeginner = ['A1', 'A2'].includes(cefrLevel);
  for (const rule of GRAMMAR_RULES) {
    if (rule.regex.test(s)) {
      matches.push({
        id: rule.id,
        title: rule.title,
        explanation: isBeginner ? rule.explainA : `${rule.explainA} ${rule.explainB}`,
        example: rule.example,
        matchedSentence: s,
        quiz: rule.quiz
      });
    }
  }
  if (!matches.length && s.length > 8) {
    // Provide general sentence structure breakdown
    const isQuestion = s.endsWith('?');
    const isImperative = /^(don't|do not|let's|come|go|look|listen|wait|stop|take|tell|give|stay|keep)\b/i.test(s);
    matches.push({
      id: isQuestion ? 'question_structure' : (isImperative ? 'imperative_mood' : 'declarative_sentence'),
      title: isQuestion ? 'Question Structure (So‘roq gap qurilishi)' : (isImperative ? 'Imperative (Buyruq va undov gaplar)' : 'Spoken Sentence Pattern (Dialog qurilishi)'),
      explanation: isQuestion
        ? 'Ingliz tilida so‘roq gaplarda yordamchi fe’l (do/does/did/are/will) egadan oldinga chiqadi.'
        : (isImperative
          ? 'Buyruq gaplar to‘g‘ridan-to‘g‘ri fe’lning asosiy shakli (V1) yoki "Don’t + V1" bilan boshlanadi.'
          : 'Ingliz tilida darak gaplar qat’iy "Ega (Subject) + Kesim (Verb) + To‘ldiruvchi (Object)" tartibiga amal qiladi.'),
      example: s,
      matchedSentence: s,
      quiz: {
        q: 'Ingliz tilida to‘g‘ri so‘z tartibiga ega gapni toping:',
        options: ['Where did you find this key?', 'Where you found this key?', 'Did where you find this?', 'You where did find this?'],
        correct: 0
      }
    });
  }
  return matches;
}

// ============================================================
// 6. SUBTITLE PARSER, SCENE SEGMENTER & EXERCISE GENERATOR
// ============================================================
function parseVttOrSrtToCues(rawText) {
  if (!rawText) return [];
  const lines = String(rawText).replace(/\r\n/g, '\n').split('\n');
  const cues = [];
  const timeRe = /(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})/;

  const toSec = (h, m, s, ms) => (parseInt(h || 0, 10) * 3600) + (parseInt(m, 10) * 60) + parseInt(s, 10) + (parseInt(ms, 10) / 1000);

  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(timeRe);
    if (m) {
      const start = toSec(m[1], m[2], m[3], m[4]);
      const end = toSec(m[5], m[6], m[7], m[8]);
      i++;
      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '' && !timeRe.test(lines[i])) {
        textLines.push(lines[i].trim());
        i++;
      }
      const clean = textLines.join(' ').replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').trim();
      if (clean && clean.length > 1 && !/^(opensubtitles|subtitles by|synced by|www\.|http)/i.test(clean)) {
        cues.push({
          index: cues.length,
          startTime: Math.round(start * 100) / 100,
          endTime: Math.round(end * 100) / 100,
          text: clean
        });
      }
    } else {
      i++;
    }
  }
  return cues;
}

const COMMON_STOPWORDS = new Set([
  'the','and','for','that','this','with','you','are','was','were','have','has','had','not','but','what','all','when','where','who','will','can','just','your','from','they','been','one','out','there','know','get','like','about','into','them','some','could','would','make','time','look','think','come','see','now','how','then','its','our','two','more','want','way','well','back','here','don','didn','isn','wasn','aren','won','let','yes','yeah','okay','hey','right','going','got'
]);

/**
 * Segment cues into 1.5 - 4 minute Scene Mini-Lessons with:
 *  - Before Watching: key vocabulary & expressions + listening objective
 *  - During Watching: cue range & time boundaries
 *  - After Watching: Listening exercises (Listen & Choose, Fill Blank, Dictation, Sentence Order),
 *                    Grammar in context, Comprehension quiz, and Shadowing line.
 */
function buildSceneLearningPack(cues = [], mediaInfo = {}) {
  if (!cues.length) {
    return {
      scenes: [],
      educationalMeta: computeCatalogEduMeta(mediaInfo, [])
    };
  }

  const scenes = [];
  const TARGET_DURATION = 165; // ~2.75 minutes per learning scene
  let bucket = [];
  let bucketStart = cues[0].startTime;

  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    bucket.push(c);
    const elapsed = c.endTime - bucketStart;
    const gapNext = cues[i + 1] ? (cues[i + 1].startTime - c.endTime) : 999;

    if ((elapsed >= TARGET_DURATION && (gapNext >= 2.2 || elapsed >= 230)) || i === cues.length - 1) {
      if (bucket.length >= 4 || scenes.length === 0) {
        scenes.push(createSceneLesson(scenes.length + 1, bucket));
        bucket = [];
        if (cues[i + 1]) bucketStart = cues[i + 1].startTime;
      }
    }
    if (scenes.length >= 24) break; // Cap at 24 scenes for UI clarity & speed
  }

  return {
    scenes,
    educationalMeta: computeCatalogEduMeta(mediaInfo, cues)
  };
}

function createSceneLesson(sceneNum, sceneCues) {
  const startTime = sceneCues[0].startTime;
  const endTime = sceneCues[sceneCues.length - 1].endTime;
  const fullText = sceneCues.map(c => c.text).join(' ');

  // 1. Extract key vocabulary for "Before Watching"
  const wordFreq = new Map();
  const cueForWord = new Map();
  for (const c of sceneCues) {
    const tokens = c.text.split(/[^a-zA-Z']+/).filter(w => w.length >= 5);
    for (const tok of tokens) {
      const low = tok.toLowerCase();
      if (COMMON_STOPWORDS.has(low)) continue;
      const lem = lemmatize(low);
      if (COMMON_STOPWORDS.has(lem) || lem.length < 4) continue;
      wordFreq.set(lem, (wordFreq.get(lem) || 0) + 1);
      if (!cueForWord.has(lem)) cueForWord.set(lem, { raw: tok, cue: c });
    }
  }

  // Prioritize words that exist in CURATED_DICT, then medium-length content words
  const sortedLemmas = [...wordFreq.keys()].sort((a, b) => {
    const ca = CURATED_DICT[a] ? 1 : 0;
    const cb = CURATED_DICT[b] ? 1 : 0;
    if (ca !== cb) return cb - ca;
    return b.length - a.length;
  }).slice(0, 5);

  const preWatchVocab = sortedLemmas.map(lem => {
    const info = cueForWord.get(lem);
    const cur = CURATED_DICT[lem];
    return {
      word: info ? info.raw : lem,
      lemma: lem,
      uzMeaning: cur ? cur.uz : '',
      pos: cur ? cur.pos : 'Key Word',
      ipa: cur ? cur.ipa : `/${lem}/`,
      contextSentence: info ? info.cue.text : '',
      timestamp: info ? info.cue.startTime : startTime
    };
  });

  // 2. Detect phrases / idioms in this scene
  const phrases = detectPhrasesInSentence(fullText).slice(0, 3);

  // 3. Pick good dialogue cues (6..16 words) for Listening, Dictation, Ordering & Shadowing
  const goodCues = sceneCues.filter(c => {
    const wc = c.text.split(/\s+/).length;
    return wc >= 5 && wc <= 16 && /[a-zA-Z]/.test(c.text);
  });
  const pickCue = (idx) => goodCues[idx % Math.max(1, goodCues.length)] || sceneCues[0];

  const cListen = pickCue(0);
  const cFill = pickCue(1);
  const cDict = pickCue(2);
  const cOrder = pickCue(3);
  const cShadow = pickCue(4);

  // Build Fill-in-the-blank exercise from cFill
  const fillWords = cFill.text.split(/\s+/);
  let targetIdx = fillWords.findIndex(w => w.replace(/[^a-zA-Z]/g, '').length >= 5 && !COMMON_STOPWORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')));
  if (targetIdx < 0) targetIdx = Math.min(2, fillWords.length - 1);
  const missingClean = fillWords[targetIdx].replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '');
  const blankedWords = [...fillWords];
  blankedWords[targetIdx] = '_____';

  const distractorWords = ['actually', 'believe', 'nothing', 'together', 'moment', 'remember', 'understand', 'problem']
    .filter(w => w.toLowerCase() !== missingClean.toLowerCase())
    .slice(0, 3);
  const fillOptions = [missingClean, ...distractorWords].sort(() => 0.5 - Math.random());

  // Build Sentence Ordering tokens from cOrder
  const orderTokens = cOrder.text.replace(/[.?!]+$/, '').split(/\s+/).filter(Boolean);
  const shuffledTokens = [...orderTokens].sort(() => 0.5 - Math.random());

  // Build Listen & Choose options
  const otherLines = sceneCues.filter(c => c.index !== cListen.index && c.text.length >= 12).slice(0, 3).map(c => c.text);
  while (otherLines.length < 3) {
    otherLines.push('We need to wait until tomorrow morning.');
    if (otherLines.length < 3) otherLines.push('Nobody knew what was inside the room.');
    if (otherLines.length < 3) otherLines.push('I thought you already spoke with the captain.');
  }
  const listenOptions = [cListen.text, ...otherLines.slice(0, 3)].sort(() => 0.5 - Math.random());

  // Detect Grammar in this scene
  let grammarItem = null;
  for (const c of sceneCues) {
    const g = analyzeSentenceGrammar(c.text, 'B1');
    if (g.length && g[0].id !== 'declarative_sentence') {
      grammarItem = { ...g[0], timestamp: c.startTime };
      break;
    }
  }
  if (!grammarItem) {
    grammarItem = { ...analyzeSentenceGrammar(cListen.text, 'B1')[0], timestamp: cListen.startTime };
  }

  // Estimate scene difficulty (A1-C1)
  const durationMin = Math.max(0.5, (endTime - startTime) / 60);
  const totalWords = fullText.split(/\s+/).filter(Boolean).length;
  const wpm = Math.round(totalWords / durationMin);
  const sceneLevel = wpm > 145 ? 'B2' : (wpm > 110 ? 'B1' : 'A2');

  return {
    id: `scene_${sceneNum}`,
    sceneNumber: sceneNum,
    title: `${sceneNum}-sahna (${ fmtSec(startTime) } – ${ fmtSec(endTime) })`,
    startTime,
    endTime,
    cueCount: sceneCues.length,
    wpm,
    level: sceneLevel,
    beforeWatching: {
      objective: `Ushbu ${Math.round((endTime - startTime))} soniyalik sahnada qahramonlarning asosiy fikrini va ${preWatchVocab.length} ta muhim so‘zni tinglab tushunishga e’tibor bering.`,
      vocabulary: preWatchVocab,
      expressions: phrases
    },
    exercises: {
      listenChoose: {
        startTime: cListen.startTime,
        endTime: Math.max(cListen.endTime, cListen.startTime + 4),
        prompt: 'Audio parchani tinglang va eshitilgan aniq jumlani tanlang:',
        options: listenOptions,
        correctAnswer: cListen.text
      },
      fillBlank: {
        startTime: cFill.startTime,
        endTime: Math.max(cFill.endTime, cFill.startTime + 4),
        prompt: 'Sahnani tinglang va tushirib qoldirilgan so‘zni toping:',
        sentenceWithBlank: blankedWords.join(' '),
        fullSentence: cFill.text,
        options: fillOptions,
        correctAnswer: missingClean
      },
      dictation: {
        startTime: cDict.startTime,
        endTime: Math.max(cDict.endTime, cDict.startTime + 4.5),
        prompt: 'Qisqa dialogni tinglang va eshitgan jumlangizni ingliz tilida yozing:',
        targetSentence: cDict.text
      },
      sentenceOrder: {
        startTime: cOrder.startTime,
        endTime: Math.max(cOrder.endTime, cOrder.startTime + 4.5),
        prompt: 'So‘zlarni to‘g‘ri tartibda joylashtirib, sahnadagi gapni hosil qiling:',
        shuffledWords: shuffledTokens,
        correctTokens: orderTokens,
        targetSentence: cOrder.text
      },
      shadowing: {
        startTime: cShadow.startTime,
        endTime: Math.max(cShadow.endTime, cShadow.startTime + 4.5),
        targetSentence: cShadow.text,
        tip: 'Avval aktyorning ohangiga va urg‘usiga quloq soling, so‘ngra ovoz chiqarib takrorlang.'
      },
      grammar: grammarItem
    }
  };
}

function fmtSec(s) {
  const m = Math.floor((s || 0) / 60);
  const sec = Math.floor((s || 0) % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Evaluate Dictation input with intelligent feedback distinguishing spelling mistakes from missing words
 */
function evaluateDictation(targetSentence, userInput) {
  const clean = s => String(s || '').toLowerCase().replace(/[^a-z0-9'\s]/g, '').trim().split(/\s+/).filter(Boolean);
  const targetWords = clean(targetSentence);
  const userWords = clean(userInput);

  if (!userWords.length) {
    return { score: 0, status: 'empty', feedbackUz: 'Iltimos, eshitgan jumlangizni kiriting.' };
  }

  let exactMatches = 0;
  let spellingNear = 0;
  const wordDiffs = targetWords.map((tw, idx) => {
    const uw = userWords[idx] || '';
    if (uw === tw || userWords.includes(tw)) {
      exactMatches++;
      return { word: tw, state: 'correct' };
    }
    if (uw && levenshtein(tw, uw) <= 2) {
      spellingNear++;
      return { word: tw, typed: uw, state: 'spelling' };
    }
    return { word: tw, typed: uw, state: 'missing' };
  });

  const accuracy = Math.round(((exactMatches + spellingNear * 0.6) / Math.max(1, targetWords.length)) * 100);
  let feedbackUz = '';
  if (accuracy >= 92) {
    feedbackUz = 'Ajoyib! Siz dialogni to‘liq va aniq eshitdingiz.';
  } else if (spellingNear > 0 && exactMatches + spellingNear >= targetWords.length * 0.7) {
    feedbackUz = 'Ma’noni to‘g‘ri ilg‘adingiz, faqat ayrim so‘zlarning imlosida (spelling) kichik farq bor.';
  } else if (accuracy >= 50) {
    feedbackUz = 'Gapning asosiy qismini topdingiz. Tez aytilgan bog‘lovchi so‘zlarga e’tibor berib qayta tinglang.';
  } else {
    feedbackUz = 'Bu jumla tez talaffuz qilingan. Tezlikni 0.75x ga tushirib yana bir bor tinglab ko‘ring.';
  }

  return {
    score: Math.min(100, accuracy),
    exactMatches,
    spellingNear,
    totalWords: targetWords.length,
    wordDiffs,
    targetSentence,
    feedbackUz
  };
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ============================================================
// 7. EDUCATIONAL MOVIE DISCOVERY METADATA
// ============================================================
function computeCatalogEduMeta(item = {}, cues = []) {
  const genres = (item.genres || []).map(g => g.toLowerCase());
  const title = String(item.title || '');
  let cefr = 'B1';
  let speechSpeed = 'O‘rtacha (125 so‘z/daq)';
  let vocabDifficulty = 'O‘rta (Kundalik + Syujet)';
  let categoryTag = 'everyday';

  if (cues && cues.length > 20) {
    const durMin = Math.max(1, (cues[cues.length - 1].endTime - cues[0].startTime) / 60);
    const words = cues.reduce((s, c) => s + c.text.split(/\s+/).length, 0);
    const wpm = Math.round(words / durMin);
    if (wpm < 105) { cefr = 'A2'; speechSpeed = `Sekin va aniq (${wpm} so‘z/daq)`; }
    else if (wpm < 138) { cefr = 'B1'; speechSpeed = `O‘rtacha (${wpm} so‘z/daq)`; }
    else { cefr = 'B2'; speechSpeed = `Tez / Tabiiy (${wpm} so‘z/daq)`; }
  } else {
    if (genres.some(g => g.includes('animation') || g.includes('family'))) {
      cefr = 'A2';
      speechSpeed = 'Aniq va ravon (105 so‘z/daq)';
      vocabDifficulty = 'Oson (Boshlovchilar uchun)';
      categoryTag = 'beginner';
    } else if (genres.some(g => g.includes('comedy') || g.includes('romance'))) {
      cefr = 'B1';
      speechSpeed = 'Tabiiy suhbat (125 so‘z/daq)';
      vocabDifficulty = 'Kundalik jonli iboralar';
      categoryTag = 'everyday';
    } else if (genres.some(g => g.includes('sci-fi') || g.includes('crime') || g.includes('mystery') || g.includes('thriller'))) {
      cefr = (item.rating || 0) >= 8.2 ? 'C1' : 'B2';
      speechSpeed = 'Tez va boy nutq (145 so‘z/daq)';
      vocabDifficulty = 'Yuqori (Maxsus atamalar va idiomalar)';
      categoryTag = 'advanced';
    }
  }

  const estScenes = Math.max(6, Math.min(24, Math.round((item.duration_min || 90) / 8)));
  return {
    cefr,
    speechSpeed,
    vocabDifficulty,
    categoryTag,
    hasEnSub: true,
    hasUzSub: true, // Supported via contextual translation pipeline
    scenesCount: cues.length ? Math.max(1, Math.ceil(cues.length / 35)) : estScenes,
    listeningSuitability: cefr === 'A2' || cefr === 'B1' ? 'Listening uchun juda qulay' : 'Faol tinglash (Active Listening)'
  };
}

// ============================================================
// 8. ADAPTIVE LEARNING ENGINE & DASHBOARD ANALYTICS
// ============================================================
function recordExerciseAttempt(userId, payload) {
  const uid = String(userId || 'default').trim() || 'default';
  const rec = {
    id: 'ex_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    userId: uid,
    mediaId: payload.mediaId || null,
    mediaTitle: payload.mediaTitle || '',
    sceneId: payload.sceneId || null,
    type: payload.type || 'listening', // 'listening' | 'dictation' | 'grammar' | 'speaking' | 'quiz'
    score: Number(payload.score) || 0,
    maxScore: Number(payload.maxScore) || 100,
    topicId: payload.topicId || null,
    details: payload.details || '',
    createdAt: new Date().toISOString()
  };
  db.exerciseAttempts.unshift(rec);

  if (payload.type === 'grammar' && payload.topicId) {
    const gk = `${uid}_${payload.topicId}`;
    const gp = db.grammarProgress[gk] || { userId: uid, topicId: payload.topicId, attempts: 0, correct: 0 };
    gp.attempts++;
    if (rec.score >= 70) gp.correct++;
    gp.lastPracticedAt = rec.createdAt;
    db.grammarProgress[gk] = gp;
  }

  if (payload.sceneId && payload.mediaId) {
    const existing = db.sceneProgress.find(s => s.userId === uid && s.mediaId === payload.mediaId && s.sceneId === payload.sceneId);
    if (existing) {
      existing.lastScore = rec.score;
      existing.completedAt = rec.createdAt;
    } else {
      db.sceneProgress.push({
        userId: uid,
        mediaId: payload.mediaId,
        mediaTitle: payload.mediaTitle || '',
        sceneId: payload.sceneId,
        lastScore: rec.score,
        completedAt: rec.createdAt
      });
    }
  }

  saveLearningDb(true);
  return rec;
}

function getDashboardSummary(userId, catalogItems = []) {
  const uid = String(userId || 'default').trim() || 'default';
  const profile = getOrCreateProfile(uid);
  const vocab = getUserVocabList(uid);
  const now = Date.now();

  const redWords = vocab.filter(v => v.status === 'red');
  const yellowWords = vocab.filter(v => v.status === 'yellow');
  const greenWords = vocab.filter(v => v.status === 'green');
  const dueWords = vocab.filter(v => !v.nextReviewAt || new Date(v.nextReviewAt).getTime() <= now + 3600000);

  const attempts = db.exerciseAttempts.filter(a => a.userId === uid);
  const listeningAttempts = attempts.filter(a => a.type === 'listening' || a.type === 'dictation');
  const grammarAttempts = attempts.filter(a => a.type === 'grammar');
  const speakingAttempts = attempts.filter(a => a.type === 'speaking');

  const avgScore = arr => arr.length ? Math.round(arr.reduce((s, x) => s + (x.score / (x.maxScore || 100)) * 100, 0) / arr.length) : null;
  const listeningAvg = avgScore(listeningAttempts);
  const grammarAvg = avgScore(grammarAttempts);
  const speakingAvg = avgScore(speakingAttempts);

  const completedScenes = db.sceneProgress.filter(s => s.userId === uid);

  // Adaptive weakness detection & transparent recommendation
  const recommendations = [];
  if (dueWords.length > 0) {
    recommendations.push({
      type: 'review',
      priority: 'high',
      title: `${dueWords.length} ta so‘zni takrorlash vaqti keldi`,
      reason: 'Spaced Repetition algoritmiga ko‘ra, bugun takrorlangan so‘zlar uzoq muddatli xotiraga o‘tadi.',
      actionLabel: 'Takrorlashni boshlash',
      route: 'learn?tab=review'
    });
  }
  if (listeningAvg !== null && listeningAvg < 70) {
    recommendations.push({
      type: 'listening',
      priority: 'high',
      title: 'Listening mashqlarida aniqlikni oshirish (${listeningAvg}%)',
      reason: 'Tez dialoglarda ayrim so‘zlar tushib qolmoqda. Sahnalarni 0.75x tezlikda va ikki tilli subtitr bilan qayta tinglab ko‘ring.',
      actionLabel: 'Listening mashqiga o‘tish',
      route: 'learn?tab=practice'
    });
  }
  if (grammarAvg !== null && grammarAvg < 75) {
    recommendations.push({
      type: 'grammar',
      priority: 'medium',
      title: 'Zamonlar va gap qurilishini mustahkamlash',
      reason: 'Grammatik savollarda xatoliklar kuzatildi. Kino dialoglaridagi Present Perfect va Modal fe’llarni ko‘rib chiqing.',
      actionLabel: 'Grammatikani o‘rganish',
      route: 'learn?tab=grammar'
    });
  }
  if (vocab.length < 5) {
    recommendations.push({
      type: 'watch',
      priority: 'medium',
      title: 'Filmdan kamida 5 ta yangi so‘z saqlang',
      reason: 'Shaxsiy lug‘atingizni boyitish uchun istalgan filmni "Learn English" rejimida ochib, notanish so‘zlarni bosing.',
      actionLabel: 'O‘quv filmlarini ko‘rish',
      route: 'learn?tab=movies'
    });
  }

  // Daily routine adapted to profile.dailyMinutes (5, 10, 15, 30 min)
  const mins = profile.dailyMinutes || 15;
  const targetWords = mins <= 5 ? 3 : (mins <= 15 ? 5 : 10);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const reviewsToday = db.reviewHistory.filter(r => r.userId === uid && new Date(r.reviewedAt) >= todayStart).length;
  const listeningToday = listeningAttempts.filter(a => new Date(a.createdAt) >= todayStart).length;
  const grammarToday = grammarAttempts.filter(a => new Date(a.createdAt) >= todayStart).length;
  const scenesToday = completedScenes.filter(s => new Date(s.completedAt) >= todayStart).length;

  const dailyPlan = {
    studyMinutes: mins,
    tasks: [
      { id: 'vocab_rev', title: `${targetWords} ta so‘zni takrorlash yoki saqlash`, done: reviewsToday >= targetWords || vocab.filter(v => new Date(v.createdAt) >= todayStart).length >= targetWords, current: reviewsToday, target: targetWords, tab: 'review' },
      { id: 'watch_scene', title: '1 ta qisqa kino sahnasini interaktiv subtitr bilan ko‘rish', done: scenesToday >= 1, current: scenesToday, target: 1, tab: 'movies' },
      { id: 'listen_ex', title: '1 ta Listening / Dictation mashqini bajarish', done: listeningToday >= 1, current: listeningToday, target: 1, tab: 'practice' },
      { id: 'grammar_ex', title: '1 ta Grammatik qoidani tahlil qilish', done: grammarToday >= 1, current: grammarToday, target: 1, tab: 'grammar' }
    ]
  };

  return {
    profile,
    stats: {
      totalVocab: vocab.length,
      redCount: redWords.length,
      yellowCount: yellowWords.length,
      greenCount: greenWords.length,
      dueCount: dueWords.length,
      listeningAvg,
      grammarAvg,
      speakingAvg,
      completedScenesCount: completedScenes.length,
      totalExercises: attempts.length
    },
    dailyPlan,
    recommendations,
    recentAttempts: attempts.slice(0, 10),
    recentScenes: completedScenes.slice(-6).reverse()
  };
}

// ============================================================
// 9. CONTEXT-AWARE AI ENGLISH TUTOR (Server-side + Safe Fallback)
// ============================================================
const tutorRateMap = new Map();

async function askAiTutor({ userId = 'default', question = '', currentCue = '', nearbyCues = [], mediaTitle = '', timestamp = 0 }) {
  const q = String(question || '').trim();
  if (!q) throw new Error('Savol kiritilmadi');

  // Simple rate limit: max 20 requests per minute per user
  const now = Date.now();
  const bucket = (tutorRateMap.get(userId) || []).filter(t => now - t < 60000);
  if (bucket.length >= 20) {
    throw new Error('So‘rovlar soni ko‘payib ketdi. Iltimos, birozdan so‘ng qayta urinib ko‘ring.');
  }
  bucket.push(now);
  tutorRateMap.set(userId, bucket);

  const prof = getOrCreateProfile(userId);
  const line = String(currentCue || (nearbyCues[0] || '')).trim();
  const contextLines = (nearbyCues || []).slice(0, 5).join(' / ');

  // 1. If GEMINI_API_KEY is configured in environment, call Gemini API securely server-side
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const sysPrompt = `Siz "Scene English" kino orqali ingliz tilini o'rgatuvchi AI ustozsiz. Foydalanuvchi darajasi: ${prof.cefrLevel}. Film: "${mediaTitle || 'Movie'}". Joriy sahna jumlasi: "${line}". Qo'shni dialoglar: "${contextLines}". Barcha tushuntirishlarni O'ZBEK tilida, aniq, samimiy va spoylersiz bering.`;
      const bodyData = JSON.stringify({
        contents: [{ parts: [{ text: `${sysPrompt}\n\nFoydalanuvchi savoli: ${q}` }] }]
      });
      const aiReply = await new Promise((resolve, reject) => {
        const req = https.request(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyData) } },
          res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
              try {
                const j = JSON.parse(d);
                resolve(j.candidates?.[0]?.content?.parts?.[0]?.text || '');
              } catch (e) { reject(e); }
            });
          }
        );
        req.on('error', reject);
        req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
        req.write(bodyData);
        req.end();
      });
      if (aiReply) {
        return { answer: aiReply, source: 'gemini_ai', cefrLevel: prof.cefrLevel, contextLine: line };
      }
    } catch (e) {}
  }

  // 2. Deterministic Contextual Linguistic Tutor (always works using real subtitle translation, grammar & idioms!)
  const uzLine = line ? await translateEnToUz(line) : '';
  const grammarList = line ? analyzeSentenceGrammar(line, prof.cefrLevel) : [];
  const idioms = detectPhrasesInSentence(line);
  const lowQ = q.toLowerCase();

  let reply = '';
  if (/savol|test|quiz|tekshir/i.test(lowQ) && line) {
    const words = line.split(/\s+/).filter(w => w.replace(/[^a-zA-Z]/g, '').length >= 4);
    const keyW = words[Math.floor(words.length / 2)] || words[0] || 'this';
    reply = `🎯 **Shu sahna bo‘yicha savol (${prof.cefrLevel} daraja):**\n\n` +
      `Sahnada qahramon shunday dedi:\n> *"${line}"*\n\n` +
      `1. Ushbu gapdagi **"${keyW.replace(/[^a-zA-Z']/g, '')}"** so‘zi qanday ma’noni bermoqda?\n` +
      `2. Gapning umumiy mazmuni: *"${uzLine || 'Mazmunni o‘z so‘zingiz bilan aytib ko‘ring'}"*.\n` +
      `3. ${grammarList[0] ? `Grammatik e’tibor: **${grammarList[0].title}** — ${grammarList[0].explanation}` : ''}`;
  } else if (/grammatika|zamon|tense|nega|perfect|modal|qoida/i.test(lowQ) && line) {
    const g = grammarList[0];
    reply = `📐 **Grammatik tahlil (${prof.cefrLevel} daraja uchun):**\n\n` +
      `Joriy jumla: *"${line}"*\n` +
      `O‘zbekcha ma’nosi: **"${uzLine}"**\n\n` +
      `• **Qoida (${g.title}):** ${g.explanation}\n` +
      `• **Misol:** *${g.example}*\n` +
      (idioms.length ? `• **Maxsus birikma:** "${idioms[0].phrase}" — ${idioms[0].uz} (${idioms[0].explain})` : '');
  } else if (/oddiy|sodda|oson|tushuntir|nima degani|nimani anglatadi|ma'nosi|manosi/i.test(lowQ) && line) {
    reply = `💡 **Sahna dialogining sodda tushuntirishi (${prof.cefrLevel}):**\n\n` +
      `🎬 **Inglizcha:** *"${line}"*\n` +
      `🇺🇿 **O‘zbekcha tarjimasi:** **"${uzLine || 'Tarjima yuklanmoqda'}"**\n\n` +
      (idioms.length
        ? `✨ **Muhim ibora:** **"${idioms[0].phrase}"** — *${idioms[0].uz}*. ${idioms[0].explain}\n\n`
        : '') +
      (grammarList[0]
        ? `📐 **Gap qurilishi (${grammarList[0].title}):** ${grammarList[0].explanation}`
        : '');
  } else {
    // Check if the user asked about a specific English word or phrase
    const cleanQ = q.replace(/\?/g, '').trim();
    const uzOfQ = await translateEnToUz(cleanQ);
    reply = `🎓 **Scene English Tutor (${prof.cefrLevel}):**\n\n` +
      (line
        ? `Joriy sahna gapi: *"${line}"*\nO‘zbekcha ma’nosi: **"${uzLine}"**\n\n`
        : '') +
      (uzOfQ && uzOfQ.toLowerCase() !== cleanQ.toLowerCase()
        ? `Siz so‘ragan ifoda ma’nosi: **"${uzOfQ}"**\n\n`
        : '') +
      (grammarList[0]
        ? `📌 **Grammatik izoh (${grammarList[0].title}):** ${grammarList[0].explanation}`
        : `Sahna dialogidagi istalgan so‘z ustiga bosib lug‘atga saqlashingiz yoki "Shu sahna bo‘yicha savol ber" tugmasini bosishingiz mumkin.`);
  }

  return {
    answer: reply,
    source: 'contextual_analyzer',
    cefrLevel: prof.cefrLevel,
    contextLine: line,
    uzTranslation: uzLine
  };
}

module.exports = {
  getOrCreateProfile,
  updateProfile,
  PLACEMENT_QUESTIONS,
  evaluatePlacement,
  lemmatize,
  lookupContextualWord,
  translateEnToUz,
  translateBatchCues,
  saveUserVocab,
  updateVocabStatus,
  deleteUserVocab,
  getUserVocabList,
  submitVocabReview,
  getReviewQueue,
  analyzeSentenceGrammar,
  GRAMMAR_RULES,
  parseVttOrSrtToCues,
  buildSceneLearningPack,
  evaluateDictation,
  computeCatalogEduMeta,
  recordExerciseAttempt,
  getDashboardSummary,
  askAiTutor
};
