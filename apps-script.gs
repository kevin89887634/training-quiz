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
  'started_at', 'submitted_at', 'answers_json'
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getOrCreateSheet();
    sheet.appendRow([
      new Date(),
      data.course_id || '',
      data.course_title || '',
      data.course_version || '',
      data.student_name || '',
      data.student_team || '',
      data.score || 0,
      data.passed ? 'PASS' : 'FAIL',
      data.correct_count || 0,
      data.total_questions || 0,
      data.started_at || '',
      data.submitted_at || '',
      JSON.stringify(data.answers || [])
    ]);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('Error: ' + err.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  // 健康检查 / 浏览器手动访问留个提示
  const props = PropertiesService.getScriptProperties();
  const sid = props.getProperty('SHEET_ID');
  const msg = '恒盛培训考试 — Apps Script 端点运行中\n' +
              (sid ? 'Sheet: https://docs.google.com/spreadsheets/d/' + sid : '尚未收到答卷,Sheet 待首次提交时自动建') +
              '\n通过 POST JSON 提交答卷';
  return ContentService.createTextOutput(msg).setMimeType(ContentService.MimeType.TEXT);
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
