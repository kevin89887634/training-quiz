// 恒盛培训考试 — 题目渲染 + 提交逻辑
'use strict';

const cfg = window.QUIZ_CONFIG || {};
const $ = (sel) => document.querySelector(sel);

// 支持 ?course=<id> URL 参数, 默认用 config.js 里的 COURSE_FILE
const urlParams = new URLSearchParams(location.search);
const courseParam = urlParams.get('course');
const courseFile = courseParam
  ? `courses/${courseParam.replace(/[^a-zA-Z0-9_-]/g, '')}.json`
  : (cfg.COURSE_FILE || 'courses/iul-coverage.json');

const state = {
  course: null,
  student: { name: '', team: '' },
  answers: {},   // { questionId: answer }  answer: number (single) | number[] (multi)
  startedAt: null
};

// ---------- Load course ----------
async function loadCourse() {
  try {
    const resp = await fetch(courseFile + '?t=' + Date.now(), { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} — 课程文件 ${courseFile} 找不到`);
    state.course = await resp.json();
    renderIntro();
  } catch (err) {
    showError('课程加载失败：' + err.message);
  }
}

function renderIntro() {
  const c = state.course;
  $('#course-title').textContent = c.title;
  $('#intro-course-title').textContent = c.title;
  $('#intro-desc').textContent = c.description || '';
  $('#intro-qcount').textContent = c.questions.length;
  $('#intro-min').textContent = c.estimated_minutes || 10;
  $('#intro-pass').textContent = c.passing_score || 70;
}

// ---------- Intro screen ----------
const nameInput = $('#student-name');
const teamInput = $('#student-team');
const btnStart = $('#btn-start');

function validateIntro() {
  btnStart.disabled = nameInput.value.trim().length < 2;
}
nameInput.addEventListener('input', validateIntro);
btnStart.addEventListener('click', () => {
  state.student.name = nameInput.value.trim();
  state.student.team = teamInput.value.trim();
  state.startedAt = new Date().toISOString();
  showScreen('quiz');
  renderQuestions();
});

// ---------- Render questions ----------
function renderQuestions() {
  $('#quiz-student').textContent = state.student.name +
    (state.student.team ? ' · ' + state.student.team : '');
  const wrap = $('#quiz-questions');
  wrap.innerHTML = '';
  state.course.questions.forEach((q, idx) => {
    const isMulti = q.type === 'multi';
    const card = document.createElement('div');
    card.className = 'question';
    card.dataset.qid = q.id;
    card.innerHTML = `
      <h3>第 ${idx + 1} 题. ${escapeHtml(q.stem)}
        <span class="qtype">${isMulti ? '(多选)' : '(单选)'}</span>
      </h3>
      <div class="options">
        ${q.options.map((opt, i) => `
          <label class="option" data-i="${i}">
            <input type="${isMulti ? 'checkbox' : 'radio'}" name="q${q.id}" value="${i}">
            <span>${escapeHtml(opt)}</span>
          </label>
        `).join('')}
      </div>
    `;
    wrap.appendChild(card);

    // 点击高亮 + 收集
    card.querySelectorAll('.option').forEach(opt => {
      opt.addEventListener('click', () => {
        const input = opt.querySelector('input');
        if (isMulti) {
          // checkbox toggle handled by browser, 同步高亮
          setTimeout(() => updateOptionHighlight(card, isMulti), 0);
          setTimeout(() => collectAnswer(q.id, isMulti, card), 0);
        } else {
          input.checked = true;
          updateOptionHighlight(card, isMulti);
          collectAnswer(q.id, isMulti, card);
        }
      });
    });
  });
  updateProgress();
}

function updateOptionHighlight(card, isMulti) {
  card.querySelectorAll('.option').forEach(opt => {
    const input = opt.querySelector('input');
    opt.classList.toggle('selected', input.checked);
  });
}
function collectAnswer(qid, isMulti, card) {
  if (isMulti) {
    const chosen = [...card.querySelectorAll('input:checked')].map(i => parseInt(i.value));
    state.answers[qid] = chosen.sort((a, b) => a - b);
  } else {
    const chosen = card.querySelector('input:checked');
    state.answers[qid] = chosen ? parseInt(chosen.value) : null;
  }
  updateProgress();
}
function updateProgress() {
  const answered = Object.values(state.answers).filter(v =>
    v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)
  ).length;
  $('#quiz-progress').textContent = `${answered} / ${state.course.questions.length}`;
}

// ---------- Submit ----------
$('#btn-submit').addEventListener('click', async () => {
  const total = state.course.questions.length;
  const answered = Object.values(state.answers).filter(v =>
    v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)
  ).length;
  if (answered < total) {
    if (!confirm(`还有 ${total - answered} 题未答，确定提交吗？`)) return;
  }
  await submitAnswers();
});

async function submitAnswers() {
  $('#btn-submit').disabled = true;
  $('#btn-submit').textContent = '提交中...';

  // Grade locally for instant feedback (题库在前端就摆着, 防作弊不是核心诉求)
  const graded = gradeAnswers();

  const payload = {
    course_id: state.course.course_id,
    course_title: state.course.title,
    course_version: state.course.version,
    student_name: state.student.name,
    student_team: state.student.team,
    started_at: state.startedAt,
    submitted_at: new Date().toISOString(),
    total_questions: state.course.questions.length,
    correct_count: graded.correct,
    score: graded.score,
    passed: graded.score >= (state.course.passing_score || 70),
    answers: state.course.questions.map(q => ({
      id: q.id,
      stem: q.stem,
      user_answer: state.answers[q.id] ?? null,
      correct_answer: q.answer,
      is_correct: graded.detail[q.id]
    }))
  };

  try {
    if (!cfg.APPS_SCRIPT_URL || cfg.APPS_SCRIPT_URL.startsWith('REPLACE_ME')) {
      throw new Error('Apps Script URL 未配置 (config.js)');
    }
    const resp = await fetch(cfg.APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',  // Apps Script web app 默认不带 CORS 头
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
    // no-cors 模式下 resp.ok 永远 false, 但实际请求成功了, 直接显示成绩
    showResult(graded);
  } catch (err) {
    showError('提交失败：' + err.message);
    $('#btn-submit').disabled = false;
    $('#btn-submit').textContent = '提交答卷';
  }
}

function gradeAnswers() {
  let correct = 0;
  const detail = {};
  state.course.questions.forEach(q => {
    const ua = state.answers[q.id];
    let isCorrect = false;
    if (q.type === 'multi') {
      const ca = (q.answer || []).slice().sort();
      const u = Array.isArray(ua) ? ua.slice().sort() : [];
      isCorrect = u.length === ca.length && u.every((v, i) => v === ca[i]);
    } else {
      isCorrect = ua === q.answer;
    }
    if (isCorrect) correct++;
    detail[q.id] = isCorrect;
  });
  const total = state.course.questions.length;
  const score = Math.round((correct / total) * 100);
  return { correct, total, score, detail };
}

function showResult(g) {
  showScreen('result');
  const passed = g.score >= (state.course.passing_score || 70);
  const badge = $('#result-badge');
  badge.textContent = g.score;
  badge.className = 'score-badge ' + (passed ? 'pass' : 'fail');
  $('#result-title').textContent = passed
    ? '🎉 恭喜，已通过！'
    : '💪 再接再厉，下次会更好';
  $('#result-detail').textContent =
    `答对 ${g.correct} / ${g.total} 题，得分 ${g.score} (通过线 ${state.course.passing_score || 70})`;

  const bd = $('#result-breakdown');
  bd.innerHTML = state.course.questions.map((q, i) => `
    <div class="item">
      <span>第 ${i + 1} 题</span>
      <span>${g.detail[q.id] ? '✅' : '❌'}</span>
    </div>
  `).join('');
}

// ---------- UI helpers ----------
function showScreen(name) {
  ['intro', 'quiz', 'result', 'error'].forEach(s => {
    $('#screen-' + s).classList.toggle('hidden', s !== name);
  });
}
function showError(msg) {
  showScreen('error');
  $('#error-msg').textContent = msg;
}
$('#btn-retry').addEventListener('click', () => location.reload());

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---------- Boot ----------
loadCourse();
