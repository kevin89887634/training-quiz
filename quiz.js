// 恒晟培训考试 — 题目渲染 + 提交逻辑
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
  answers: {},    // { questionId: answer }  answer: number (single) | number[] (multi)
  startedAt: null,
  wrongIds: [],   // 本次错题 ID 列表
  retakeMode: false,   // 是否是错题重考模式
  retakeFirstAnswers: {} // 错题重考前的原始答案（用于比较进步）
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
  state.wrongIds = [];
  state.retakeMode = false;
  showScreen('quiz');
  renderQuestions();
});

// ---------- Render questions ----------
function renderQuestions() {
  $('#quiz-student').textContent = state.student.name +
    (state.student.team ? ' · ' + state.student.team : '');

  const wrap = $('#quiz-questions');
  wrap.innerHTML = '';

  // 错题重考模式：只显示错题，并加上提示
  let displayQuestions = state.course.questions;
  let retakeNotice = '';
  if (state.retakeMode && state.wrongIds.length > 0) {
    displayQuestions = state.course.questions.filter(q => state.wrongIds.includes(q.id));
    retakeNotice = `
      <div class="retake-notice">
        🎯 错题重考模式 · 共 <span>${displayQuestions.length}</span> 道错题（答对即移除）
      </div>`;
    wrap.innerHTML += retakeNotice;
  }

  displayQuestions.forEach((q, idx) => {
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
  // 重考模式下进度条显示实际显示的题数
  let displayCount = state.course.questions.length;
  if (state.retakeMode) {
    displayCount = state.course.questions.filter(q => state.wrongIds.includes(q.id)).length;
  }
  const answered = Object.values(state.answers).filter(v =>
    v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)
  ).length;
  $('#quiz-progress').textContent = `${answered} / ${displayCount}`;
}

// ---------- Submit ----------
$('#btn-submit').addEventListener('click', async () => {
  // 重考模式：验证只针对当前显示的题
  let displayQuestions = state.course.questions;
  if (state.retakeMode) {
    displayQuestions = state.course.questions.filter(q => state.wrongIds.includes(q.id));
  }
  const total = displayQuestions.length;
  const answered = displayQuestions
    .map(q => state.answers[q.id])
    .filter(v => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)).length;
  if (answered < total) {
    if (!confirm(`还有 ${total - answered} 题未答，确定提交吗？`)) return;
  }
  await submitAnswers();
});

async function submitAnswers() {
  $('#btn-submit').disabled = true;
  $('#btn-submit').textContent = '提交中...';

  const graded = gradeAnswers();

  // 如果是错题重考模式，先记录进步
  if (state.retakeMode) {
    state.retakeFirstAnswers = { ...state.answers };
  }

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
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
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

  if (state.retakeMode) {
    const improved = g.score >= (state.course.passing_score || 70);
    $('#result-title').textContent = improved
      ? '🎉 恭喜本次全部答对！'
      : `💪 本次答对 ${g.correct}/${g.total} 题，继续加油`;
  } else {
    $('#result-title').textContent = passed
      ? '🎉 恭喜，已通过！'
      : '💪 再接再厉，下次会更好';
  }

  $('#result-detail').textContent =
    `答对 ${g.correct} / ${g.total} 题，得分 ${g.score}（通过线 ${state.course.passing_score || 70}）`;

  // 收集错题 ID（用于重考）
  state.wrongIds = state.course.questions
    .filter(q => !g.detail[q.id])
    .map(q => q.id);

  // ---------- 逐题解析展示 ----------
  const bd = $('#result-breakdown');
  bd.innerHTML = state.course.questions.map((q, i) => {
    const isCorrect = g.detail[q.id];
    const ua = state.answers[q.id] ?? null;
    const isMulti = q.type === 'multi';

    // 判断用户答案
    let userAnswerText = '（未作答）';
    if (ua !== null) {
      if (isMulti) {
        userAnswerText = (ua || []).map(idx => `选项${String.fromCharCode(65+idx)}`).join('、') || '（未作答）';
      } else {
        userAnswerText = `选项${String.fromCharCode(65+ua)}：${q.options[ua] || ''}`;
      }
    }

    // 正确答案文本
    let correctAnswerText = '';
    if (isMulti) {
      correctAnswerText = (q.answer || []).map(idx => `选项${String.fromCharCode(65+idx)}`).join('、');
    } else {
      correctAnswerText = `选项${String.fromCharCode(65+q.answer)}：${q.options[q.answer] || ''}`;
    }

    // 选项渲染
    const optionsHtml = q.options.map((opt, idx) => {
      let cls = '';
      let marker = String.fromCharCode(65+idx);
      if (isCorrect) {
        // 做对了：只标正确的为绿色
        if (isMulti) {
          cls = (q.answer || []).includes(idx) ? 'correct' : '';
        } else {
          cls = idx === q.answer ? 'correct' : '';
        }
      } else {
        // 做错了
        if (isMulti) {
          const qAns = q.answer || [];
          const uAns = ua || [];
          const wasSelected = uAns.includes(idx);
          const isRightOption = qAns.includes(idx);
          if (wasSelected && isRightOption) cls = 'correct-user';
          else if (wasSelected && !isRightOption) cls = 'wrong-user';
          else if (!wasSelected && isRightOption) cls = 'correct';
        } else {
          if (idx === ua && idx === q.answer) cls = 'correct-user';
          else if (idx === ua && idx !== q.answer) cls = 'wrong-user';
          else if (idx === q.answer) cls = 'correct';
        }
      }
      const checkmark = cls === 'correct' || cls === 'correct-user' ? ' ✓' : '';
      const cross = (cls === 'wrong-user') ? ' ✗' : '';
      return `<div class="option ${cls}">
        <span style="margin-right:8px;color:${cls === 'correct' || cls === 'correct-user' ? 'var(--success)' : cls === 'wrong-user' ? 'var(--error)' : 'var(--muted)'}">${marker}</span>
        <span>${escapeHtml(opt)}${checkmark}${cross}</span>
      </div>`;
    }).join('');

    const explainText = q.explain || q.explanation || '（暂无解析）';
    const explainCls = isCorrect ? 'ok' : 'no';
    const explainIcon = isCorrect ? '✅' : '💡';

    return `
      <div class="card" style="margin-bottom:16px; padding: 20px;">
        <div style="margin-bottom:12px;">
          <span style="font-weight:700; font-size:15px; ${isCorrect ? 'color:var(--success)' : 'color:var(--error)'}">
            ${isCorrect ? '✅ 正确' : '❌ 错误'} — 第${i+1}题
          </span>
          <span style="margin-left:12px; color:var(--muted); font-size:13px;">
            ${q.category || ''}
          </span>
        </div>
        <div style="font-size:15px; font-weight:600; margin-bottom:12px; line-height:1.6;">
          ${escapeHtml(q.stem)}
        </div>
        <div class="options">${optionsHtml}</div>
        <div style="margin-top:12px; font-size:13px; color:var(--muted);">
          <div style="margin-bottom:4px;">你的答案：${userAnswerText}</div>
          ${!isCorrect ? `<div style="margin-bottom:4px; color:var(--success);">正确答案：${correctAnswerText}</div>` : ''}
        </div>
        <div class="explain-card ${explainCls}" style="margin-top:12px;">
          <strong>${explainIcon} 解析：</strong>${escapeHtml(explainText)}
        </div>
      </div>`;
  }).join('');

  // ---------- 底部按钮 ----------
  const btnWrap = $('#result-buttons');
  btnWrap.innerHTML = '';

  if (state.wrongIds.length > 0) {
    // 有错题：显示"重新全部"和"只重考错题"
    btnWrap.innerHTML = `
      <div class="retake-bar">
        <button class="btn-retry-all" onclick="retakeAll()">📋 重新全部题目</button>
        <button class="btn-retry-wrong" onclick="retakeWrong()">🔁 只重考错题（${state.wrongIds.length}道）</button>
      </div>`;
  } else {
    // 全对：显示重新全部按钮
    btnWrap.innerHTML = `
      <button class="btn-retry-all" onclick="retakeAll()" style="width:100%;">📋 重新答题</button>`;
  }
}

function retakeAll() {
  state.answers = {};
  state.wrongIds = [];
  state.retakeMode = false;
  state.retakeFirstAnswers = {};
  showScreen('quiz');
  renderQuestions();
  window.scrollTo(0, 0);
}

function retakeWrong() {
  // 记录本次提交的成绩（进步对比用）
  const prevScore = state.retakeMode && Object.keys(state.retakeFirstAnswers).length > 0
    ? null  // 已经是重考模式了
    : null;

  state.answers = {};
  state.retakeMode = true;
  // wrongIds 已经在 showResult 里计算好了
  showScreen('quiz');
  renderQuestions();
  window.scrollTo(0, 0);
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
