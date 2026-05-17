# 恒盛培训考试 (training-quiz)

简单、免费、可扩展的内部培训考试系统。学员不用登录，只填名字就能答题；答卷自动入 Google Sheet。

## 架构

```
学员 → GitHub Pages (静态 HTML/JS, 题库前端)
         ↓ fetch POST (no-cors)
       Apps Script Web App (pfa.kevinfan@gmail.com)
         ↓ appendRow
       Google Sheet "恒盛培训考试_答卷收集"
         ↓ (Hermes gdrive MCP 后续读取归档)
       Obsidian Vault: 02_保险知识/培训体系/考试结果/
```

## 第一次部署 (一次性, 约 30 分钟)

### 1. 准备 GitHub 仓库

```bash
gh auth login                          # 登录, 选 GitHub.com → HTTPS → web
cd ~/training-quiz
git add .
git commit -m "init training quiz demo: IUL Coverage course"
gh repo create training-quiz --public --source=. --remote=origin --push
```

### 2. 开启 GitHub Pages

```bash
gh api -X POST /repos/{owner}/training-quiz/pages \
  -f source[branch]=main \
  -f source[path]=/
```

或网页: repo Settings → Pages → Source: main / (root) → Save

部署完地址类似 `https://<your-username>.github.io/training-quiz/`

### 3. Apps Script 后端

1. 打开 https://script.google.com (用 `pfa.kevinfan@gmail.com` 登录)
2. **新建项目** → 把 `apps-script.gs` 内容粘进 `Code.gs`
3. 顶部菜单 **运行** → 选函数 `testSubmit` → 第一次会要授权 → 查看日志 (Ctrl+Enter) 拿到新建 Spreadsheet 的 ID
4. 把 ID 填回脚本顶部 `const SHEET_ID = '...'`
5. **部署** → **新增部署** → 类型 **网页应用**
   - 说明: `training-quiz v1`
   - 执行身份: 我 (pfa.kevinfan@...)
   - 谁可以访问: **任何人** (重要!)
6. 复制 **Web 应用 URL** (形如 `https://script.google.com/macros/s/AKfy.../exec`)

### 4. 联通前后端

编辑 `config.js`:
```javascript
window.QUIZ_CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/<你的部署 ID>/exec",
  COURSE_FILE: "courses/iul-coverage.json"
};
```

提交:
```bash
git commit -am "configure Apps Script endpoint"
git push
```

GitHub Pages 一分钟内自动更新。

### 5. 测试

打开 `https://<your-username>.github.io/training-quiz/`，填写"测试"提交一次，去 Google Sheet 看是否有新行。

## 添加新课程

1. 新建 `courses/<course-id>.json`，照 `iul-coverage.json` 结构填
2. 改 `config.js` 的 `COURSE_FILE`（或加 URL 参数选课程，后续可扩展）
3. `git push` 即生效

题目 JSON schema:
```json
{
  "course_id": "唯一 ID",
  "title": "课程标题",
  "version": "1.0",
  "passing_score": 70,
  "estimated_minutes": 8,
  "questions": [
    {
      "id": 1,
      "type": "single | multi",
      "stem": "题干",
      "options": ["A 选项", "B 选项", "C 选项", "D 选项"],
      "answer": 1,
      "explain": "解析（学员看不到，存档用）"
    }
  ]
}
```

注：`type: multi` 的 `answer` 是 `[0, 2]` 这种数组。

## 与 Hermes 集成 (后续 skill)

- Hermes cron 每天扫 Google Sheet → 推培训部"今日新答卷 X 份，平均分 X"
- Hermes skill `training-quiz-maker` → 喂任意培训 PPT/MD → 自动生成 quiz JSON

## 已知限制

- **前端能看到答案**：F12 查源码可见。培训目的是学习，不是抓人，无所谓
- **Apps Script 配额**：免费 20K/天提交，单调用 6 分钟超时（写一行 Sheet 1 秒内完成，无忧）
- **匿名 Web App**：任何拿到 URL 的人都能提交。如需身份验证，改用 Google Workspace 内部访问

## 维护

- 数据存在 Google Sheet：`恒盛培训考试_答卷收集` (pfa.kevinfan@gmail.com 名下)
- Vault 镜像：由 Hermes 同步 (待实现 skill 后)
- 任何前端变更：改文件 → git push → 一分钟生效
