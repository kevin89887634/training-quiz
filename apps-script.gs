/**
 * 恒盛培训考试 — 答卷收集 (Google Apps Script 后端)
 *
 * 部署步骤:
 * 1. 打开 https://script.google.com → 新项目 (用 pfa.kefan@gmail.com 登录)
 * 2. 粘贴这整个文件
 * 3. 改下面 SHEET_ID (留空则脚本自动新建 spreadsheet 并 log 出 ID)
 * 4. "部署" → "新增部署" → 类型选"网页应用"
 *    - 执行身份: 我 (pfa.kefan)
 *    - 谁可以访问: **任何人** (无需登录, 学员答题用)
 * 5. 复制部署出来的 "Web 应用 URL" 填到 config.js 的 APPS_SCRIPT_URL
 *
 * 数据结构: Sheet 列
 *   timestamp | course_id | course_title | student_name | student_team |
 *   score | passed | correct/total | started_at | submitted_at | answers_json
 */

// 留空则首次跑会自动新建并 log SHEET ID, 第二次再粘贴回这里
const SHEET_ID = '';
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
  // 给浏览器手动访问留个 health 提示
  return ContentService
    .createTextOutput('恒盛培训考试 — Apps Script 端点正常运行\n请通过 POST 提交答卷')
    .setMimeType(ContentService.MimeType.TEXT);
}

function getOrCreateSheet() {
  let ss;
  if (SHEET_ID) {
    ss = SpreadsheetApp.openById(SHEET_ID);
  } else {
    ss = SpreadsheetApp.create('恒盛培训考试_答卷收集');
    Logger.log('==== 新建 Spreadsheet, 把这个 ID 填回脚本顶部 SHEET_ID ====');
    Logger.log(ss.getId());
    Logger.log('链接: ' + ss.getUrl());
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

// 测试用: 在 Apps Script 编辑器里点"运行" → testSubmit 看链路是否通
function testSubmit() {
  const fake = {
    postData: {
      contents: JSON.stringify({
        course_id: 'test',
        course_title: '测试课程',
        student_name: '测试用户',
        student_team: '测试组',
        score: 80,
        passed: true,
        correct_count: 8,
        total_questions: 10,
        started_at: new Date().toISOString(),
        submitted_at: new Date().toISOString(),
        answers: [{ id: 1, is_correct: true }]
      })
    }
  };
  const r = doPost(fake);
  Logger.log(r.getContent());
}
