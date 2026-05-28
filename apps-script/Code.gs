/**
 * 恒盛培训考试 — 答卷收集 (Google Apps Script 后端)
 *
 * v2: 全自动 — 首次 POST 自动建 Spreadsheet, ID 存 PropertiesService 持久化.
 * 不用手动跑 testSubmit, 不用手动填 SHEET_ID.
 *
 * 部署: clasp deploy --description "training-quiz v1" --type webapp
 *   或网页 deploy → 类型"网页应用" / 执行身份 我 / 任何人可访问
 *
 * 数据存:
 *   - Sheet: "恒盛培训考试_答卷收集" (Drive 根目录, pfa.kevinfan@gmail.com)
 *   - Sheet ID 记在 Script Properties (key=SHEET_ID), 自动持久化
 */

const SHEET_NAME = '答卷';
const HEADERS = [
  'timestamp', 'course_id', 'course_title', 'course_version',
  'student_name', 'student_team',
  'score', 'passed', 'correct', 'total',
  'started_at', 'submitted_at', 'answers_json', 'status'
];

// v3: 同 (student_name, course_id) 重复答题 → 只保留最高分, 旧的标 'SUPERSEDED'
// v6 (2026-05-17): 重新整合 Calendar create_event (Google 锁 web app access 在 UI, 拆独立项目走不通)
//                  此项目实际是 "training-quiz-backend + voice-to-crm-calendar-bridge" 混合
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // 路由分发
    if (data.action === 'create_event') {
      return handleCreateEvent(data);
    }

    // 默认: quiz 答卷收集
    const sheet = getOrCreateSheet();
    const newScore = Number(data.score) || 0;
    const key = (data.student_name || '').trim() + '||' + (data.course_id || '');

    // 扫描旧记录, 找同 key 的 active 行
    const rows = sheet.getDataRange().getValues();
    let supersededOld = false;
    let kept_higher = false;
    if (rows.length > 1) {
      // 假定列序: 0 ts | 1 cid | 2 ct | 3 cv | 4 name | 5 team | 6 score | 7 pass | 8 c | 9 t | 10 sa | 11 ea | 12 aj | 13 status
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const k = (String(r[4] || '').trim()) + '||' + String(r[1] || '');
        const status = r[13] || 'ACTIVE';
        if (k === key && status === 'ACTIVE') {
          const oldScore = Number(r[6]) || 0;
          if (newScore > oldScore) {
            // 新分高 → 旧的标 SUPERSEDED, 新的入库 ACTIVE
            sheet.getRange(i + 1, 14).setValue('SUPERSEDED');
            supersededOld = true;
          } else {
            // 新分不高于旧的 → 新的入库 ACTIVE_LOWER (仅记录, 不进 ACTIVE 统计)
            kept_higher = true;
          }
        }
      }
    }
    const status = kept_higher ? 'ACTIVE_LOWER' : 'ACTIVE';

    sheet.appendRow([
      new Date(),
      data.course_id || '',
      data.course_title || '',
      data.course_version || '',
      data.student_name || '',
      data.student_team || '',
      newScore,
      data.passed ? 'PASS' : 'FAIL',
      data.correct_count || 0,
      data.total_questions || 0,
      data.started_at || '',
      data.submitted_at || '',
      JSON.stringify(data.answers || []),
      status
    ]);
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        status: status,
        superseded_old: supersededOld,
        kept_higher_old: kept_higher
      }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('Error: ' + err.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── Voice-to-CRM Calendar 集成 (POST action=create_event) ───
// 重新引入 (v6, 2026-05-17): 独立项目拆出去后发现 Google web app access 锁 UI 走不通, 回归混合
function handleCreateEvent(data) {
  try {
    if (!data.title || !data.start_iso) throw new Error('title 和 start_iso 必填');
    const start = new Date(data.start_iso.replace(' ', 'T'));
    if (isNaN(start.getTime())) throw new Error('start_iso 无效: ' + data.start_iso);
    const durationMin = Number(data.duration_min) || 30;
    const end = new Date(start.getTime() + durationMin * 60 * 1000);
    const cal = CalendarApp.getDefaultCalendar();
    const opts = { description: data.description || '' };
    if (data.attendees && Array.isArray(data.attendees) && data.attendees.length) {
      opts.guests = data.attendees.join(',');
      opts.sendInvites = false;
    }
    const ev = cal.createEvent(data.title, start, end, opts);
    const evId = ev.getId();
    const evUrl = 'https://www.google.com/calendar/event?eid=' +
                  Utilities.base64Encode(evId + ' ' + cal.getId())
                    .replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
    const result = {
      ok: true, event_id: evId, title: ev.getTitle(),
      start: ev.getStartTime().toISOString(), end: ev.getEndTime().toISOString(),
      url: evUrl,
    };
    PropertiesService.getScriptProperties().setProperty('LAST_EVENT', JSON.stringify(result));
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('Calendar Error: ' + err.toString());
    return ContentService.createTextOutput(JSON.stringify({ok:false, error: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

// 在 Apps Script 编辑器手动 Run 一次, 弹 Calendar scope 授权
function testCreateCalendarEvent() {
  const r = handleCreateEvent({
    action: 'create_event',
    title: '🤖 Voice-to-CRM Calendar 授权测试 (可删)',
    start_iso: '2026-05-25 10:30',
    duration_min: 15,
    description: '此事件由 testCreateCalendarEvent 创建, 仅为 Calendar scope 授权. 可删.',
  });
  Logger.log(r.getContent());
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'summary') return doGetSummary(e);
  if (action === 'recent') return doGetRecent(e);
  if (action === 'last_event') {
    const v = PropertiesService.getScriptProperties().getProperty('LAST_EVENT') || '{"ok":false,"msg":"无 last_event"}';
    return ContentService.createTextOutput(v).setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'analytics') return doGetAnalytics(e);

  // 健康检查
  const props = PropertiesService.getScriptProperties();
  const sid = props.getProperty('SHEET_ID');
  const msg = '恒盛培训考试 — Apps Script 端点运行中\n' +
              (sid ? 'Sheet: https://docs.google.com/spreadsheets/d/' + sid : '尚未收到答卷,Sheet 待首次提交时自动建') +
              '\n通过 POST JSON 提交答卷\n查询: ?action=summary | ?action=recent&limit=N | ?action=analytics[&course_id=X]';
  return ContentService.createTextOutput(msg).setMimeType(ContentService.MimeType.TEXT);
}

// 判断 row 是否 ACTIVE (兼容老行无 status 列的情况)
function isActiveRow(r) {
  const status = r[13];  // 第 14 列 (index 13) 是 status
  return !status || status === 'ACTIVE';  // 空或 ACTIVE 算
}

// ?action=summary[&since=today|YYYY-MM-DD]
// 返回今日 (默认) 或指定日起统计 JSON
function doGetSummary(e) {
  const sheet = getOrCreateSheet();
  const rows = sheet.getDataRange().getValues();  // 含 header
  if (rows.length <= 1) {
    return jsonResp({ count: 0, period: 'today', msg: '尚无答卷' });
  }
  const sinceParam = (e.parameter.since || 'today').toLowerCase();
  let since;
  if (sinceParam === 'today') {
    since = new Date(); since.setHours(0,0,0,0);
  } else if (sinceParam === 'yesterday') {
    since = new Date(); since.setDate(since.getDate()-1); since.setHours(0,0,0,0);
  } else if (sinceParam === 'week') {
    since = new Date(); since.setDate(since.getDate()-7); since.setHours(0,0,0,0);
  } else {
    since = new Date(sinceParam);
    if (isNaN(since.getTime())) since = new Date(); since.setHours(0,0,0,0);
  }

  const submissions = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!isActiveRow(r)) continue;  // 跳过 SUPERSEDED / ACTIVE_LOWER
    const ts = r[0] instanceof Date ? r[0] : new Date(r[0]);
    if (ts >= since) {
      submissions.push({
        timestamp: ts.toISOString(),
        course_id: r[1],
        course_title: r[2],
        student_name: r[4],
        student_team: r[5],
        score: Number(r[6]) || 0,
        passed: r[7] === 'PASS',
        correct: Number(r[8]) || 0,
        total: Number(r[9]) || 0
      });
    }
  }

  if (submissions.length === 0) {
    return jsonResp({ count: 0, period: sinceParam, since: since.toISOString(), msg: '该时段无答卷 (已过滤重复/低分)' });
  }

  const passed = submissions.filter(s => s.passed).length;
  const failed = submissions.length - passed;
  const scores = submissions.map(s => s.score);
  const avg = Math.round(scores.reduce((a,b)=>a+b,0) / scores.length);
  const top = scores.reduce((a,b)=>Math.max(a,b), 0);
  const low = scores.reduce((a,b)=>Math.min(a,b), 100);

  const byCourse = {};
  submissions.forEach(s => {
    const k = s.course_title || s.course_id || 'unknown';
    if (!byCourse[k]) byCourse[k] = { count: 0, pass: 0, sum_score: 0 };
    byCourse[k].count++;
    if (s.passed) byCourse[k].pass++;
    byCourse[k].sum_score += s.score;
  });
  const courses = Object.keys(byCourse).map(k => ({
    course: k,
    count: byCourse[k].count,
    pass: byCourse[k].pass,
    avg_score: Math.round(byCourse[k].sum_score / byCourse[k].count)
  }));

  return jsonResp({
    count: submissions.length,
    period: sinceParam,
    since: since.toISOString(),
    passed: passed,
    failed: failed,
    pass_rate: Math.round(passed / submissions.length * 100),
    avg_score: avg,
    top_score: top,
    low_score: low,
    courses: courses,
    submissions: submissions  // 完整列表给 LLM 作进一步分析
  });
}

// ?action=recent&limit=N (默认含所有 status, 给老师查问题用)
function doGetRecent(e) {
  const limit = Math.min(parseInt(e.parameter.limit) || 20, 100);
  const sheet = getOrCreateSheet();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return jsonResp({ count: 0, recent: [] });
  const recent = rows.slice(-limit).reverse().map(r => ({
    timestamp: (r[0] instanceof Date ? r[0] : new Date(r[0])).toISOString(),
    student_name: r[4],
    student_team: r[5],
    course_title: r[2],
    score: Number(r[6]) || 0,
    passed: r[7] === 'PASS',
    status: r[13] || 'ACTIVE'
  }));
  return jsonResp({ count: recent.length, recent: recent });
}

// ?action=analytics[&course_id=X]
// 返回 per-question / per-student / per-team 深度统计
// 仅含 ACTIVE 行 (重复答题只取最高分)
function doGetAnalytics(e) {
  const courseFilter = (e.parameter.course_id || '').trim();
  const sheet = getOrCreateSheet();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return jsonResp({ msg: '尚无答卷' });

  // 收集 ACTIVE 行 + 解析 answers_json
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!isActiveRow(r)) continue;
    if (courseFilter && String(r[1]) !== courseFilter) continue;
    let answers = [];
    try { answers = JSON.parse(r[12] || '[]'); } catch (e) {}
    records.push({
      timestamp: (r[0] instanceof Date ? r[0] : new Date(r[0])).toISOString(),
      course_id: String(r[1] || ''),
      course_title: String(r[2] || ''),
      student_name: String(r[4] || '').trim(),
      student_team: String(r[5] || '').trim(),
      score: Number(r[6]) || 0,
      passed: r[7] === 'PASS',
      correct: Number(r[8]) || 0,
      total: Number(r[9]) || 0,
      answers: answers
    });
  }

  if (records.length === 0) {
    return jsonResp({ count: 0, msg: courseFilter ? '该课程无答卷' : '尚无答卷' });
  }

  // 1. per-question 正答率 (从 answers_json 聚合)
  const qStats = {};  // qid -> { stem, correct_count, total_attempts }
  records.forEach(rec => {
    rec.answers.forEach(a => {
      const qid = a.id;
      if (!qStats[qid]) {
        qStats[qid] = {
          q_id: qid,
          stem: (a.stem || '').substring(0, 80),
          correct_answer: a.correct_answer,
          attempts: 0,
          correct: 0,
          wrong_answers: {}  // user_answer -> count
        };
      }
      qStats[qid].attempts++;
      if (a.is_correct) {
        qStats[qid].correct++;
      } else {
        const ua = JSON.stringify(a.user_answer);
        qStats[qid].wrong_answers[ua] = (qStats[qid].wrong_answers[ua] || 0) + 1;
      }
    });
  });
  const per_question = Object.values(qStats).map(q => ({
    q_id: q.q_id,
    stem: q.stem,
    attempts: q.attempts,
    correct: q.correct,
    correct_rate: q.attempts > 0 ? Math.round(q.correct / q.attempts * 100) : 0,
    top_wrong: Object.keys(q.wrong_answers).sort((a,b)=>q.wrong_answers[b]-q.wrong_answers[a])
      .slice(0,2).map(k => ({ user_answer: k, count: q.wrong_answers[k] }))
  })).sort((a,b) => a.correct_rate - b.correct_rate);  // 错最多的在前

  // 2. per-student 排名
  const sStats = {};
  records.forEach(rec => {
    const name = rec.student_name || '(匿名)';
    if (!sStats[name]) sStats[name] = { name, team: rec.student_team, attempts: 0, top_score: 0, courses_taken: new Set() };
    sStats[name].attempts++;
    if (rec.score > sStats[name].top_score) sStats[name].top_score = rec.score;
    sStats[name].courses_taken.add(rec.course_title);
  });
  const per_student = Object.values(sStats).map(s => ({
    name: s.name,
    team: s.team,
    attempts: s.attempts,
    top_score: s.top_score,
    courses: [...s.courses_taken]
  })).sort((a,b) => b.top_score - a.top_score);

  // 3. per-team 对比
  const tStats = {};
  records.forEach(rec => {
    const team = rec.student_team || '(未填)';
    if (!tStats[team]) tStats[team] = { team, count: 0, pass: 0, sum_score: 0, members: new Set() };
    tStats[team].count++;
    if (rec.passed) tStats[team].pass++;
    tStats[team].sum_score += rec.score;
    tStats[team].members.add(rec.student_name);
  });
  const per_team = Object.values(tStats).map(t => ({
    team: t.team,
    submissions: t.count,
    unique_members: t.members.size,
    pass_rate: Math.round(t.pass / t.count * 100),
    avg_score: Math.round(t.sum_score / t.count)
  })).sort((a,b) => b.avg_score - a.avg_score);

  // 4. 课程 metadata
  const courses = {};
  records.forEach(rec => {
    if (!courses[rec.course_id]) {
      courses[rec.course_id] = { course_id: rec.course_id, course_title: rec.course_title, submissions: 0 };
    }
    courses[rec.course_id].submissions++;
  });

  return jsonResp({
    course_filter: courseFilter || null,
    total_records: records.length,
    unique_students: per_student.length,
    courses: Object.values(courses),
    per_question: per_question,  // 错最多的在前 → 培训改进重点
    per_student: per_student,    // 分高在前 → 表现追踪
    per_team: per_team           // 团队对比
  });
}

function jsonResp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet() {
  const props = PropertiesService.getScriptProperties();
  let sid = props.getProperty('SHEET_ID');
  let ss = null;
  if (sid) {
    try { ss = SpreadsheetApp.openById(sid); }
    catch (e) { sid = null; ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('恒盛培训考试_答卷收集');
    sid = ss.getId();
    props.setProperty('SHEET_ID', sid);
    Logger.log('Created new spreadsheet: ' + sid);
  }
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

// v4: 在 Apps Script 编辑器手动 Run 这个一次, 会弹 CalendarApp 授权
function testCreateEvent() {
  const fake = {
    postData: {
      contents: JSON.stringify({
        action: 'create_event',
        title: '🤖 Voice-to-CRM 授权测试 (可删)',
        start_iso: '2026-05-25 10:00',
        duration_min: 15,
        description: '此事件由 testCreateEvent 函数创建, 仅为授权 CalendarApp scope. 可手动删除.',
      })
    }
  };
  const r = handleCreateEvent(JSON.parse(fake.postData.contents));
  Logger.log(r.getContent());
}

// 可选测试: 在 Apps Script 编辑器里运行确认链路
function testSubmit() {
  const fake = {
    postData: {
      contents: JSON.stringify({
        course_id: 'test', course_title: '测试课程', course_version: '0',
        student_name: '测试用户', student_team: '测试组',
        score: 80, passed: true, correct_count: 8, total_questions: 10,
        started_at: new Date().toISOString(),
        submitted_at: new Date().toISOString(),
        answers: [{ id: 1, is_correct: true }]
      })
    }
  };
  Logger.log(doPost(fake).getContent());
  Logger.log('Sheet ID: ' + PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
}
