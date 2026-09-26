const PAGE_STYLE = `
:root {
  color: #eceef2;
  background: #17191e;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; }
button { font: inherit; }
.qualification-shell {
  --ink: #eceef2;
  --muted: #969da9;
  --faint: #858d99;
  --panel: #202329;
  --panel-deep: #1b1e24;
  --line: #333740;
  --lime: #a6c5b6;
  --amber: #e3b693;
  background:
    linear-gradient(90deg, rgb(201 237 130 / .035) 1px, transparent 1px) 0 0 / 3.5rem 3.5rem,
    radial-gradient(circle at 88% 0%, rgb(242 189 112 / .13), transparent 28rem),
    #17191e;
  color: var(--ink);
  display: grid;
  gap: 2rem;
  min-height: 100vh;
  padding: clamp(1.25rem, 5vw, 5rem) clamp(1rem, 6vw, 6rem);
}
.qualification-header { display: grid; gap: 1.5rem; max-width: 58rem; }
.qualification-kicker {
  color: var(--lime);
  font-family: "SF Mono", "Cascadia Mono", ui-monospace, monospace;
  font-size: .7rem;
  letter-spacing: .14em;
  margin: 0;
  text-transform: uppercase;
}
.qualification-header h1 {
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(2.6rem, 8vw, 6.5rem);
  font-weight: 500;
  letter-spacing: -.075em;
  line-height: .88;
  margin: 0;
  max-width: 8ch;
}
.qualification-header p:last-child { color: var(--muted); line-height: 1.6; margin: 0; max-width: 42rem; }
.qualification-signal {
  align-items: center;
  border: 1px solid var(--line);
  display: flex;
  gap: .8rem;
  justify-content: space-between;
  max-width: 58rem;
  padding: .9rem 1rem;
}
.qualification-signal__dot { background: var(--amber); border-radius: 999px; height: .65rem; width: .65rem; }
.qualification-signal[data-tone="good"] .qualification-signal__dot { background: var(--lime); }
.qualification-signal__label { color: var(--muted); font-size: .95rem; }
.qualification-signal__state { color: var(--ink); font-family: "SF Mono", "Cascadia Mono", ui-monospace, monospace; font-size: .75rem; letter-spacing: .06em; text-transform: uppercase; }
.qualification-flow { display: grid; gap: .8rem; grid-template-columns: repeat(4, minmax(0, 1fr)); max-width: 78rem; }
.qualification-step { background: var(--panel); border-top: 2px solid var(--line); display: grid; gap: .75rem; min-height: 10rem; padding: 1rem; }
.qualification-step[data-status="active"] { border-top-color: var(--amber); }
.qualification-step[data-status="complete"] { border-top-color: var(--lime); }
.qualification-step__index { color: var(--faint); font-family: "SF Mono", "Cascadia Mono", ui-monospace, monospace; font-size: .68rem; letter-spacing: .12em; }
.qualification-step h2 { font-size: 1.05rem; font-weight: 600; margin: 0; }
.qualification-step p { color: var(--muted); font-size: .9rem; line-height: 1.5; margin: 0; }
.qualification-step__status { align-self: end; color: var(--faint); font-family: "SF Mono", "Cascadia Mono", ui-monospace, monospace; font-size: .7rem; text-transform: uppercase; }
.qualification-grid { display: grid; gap: .8rem; grid-template-columns: minmax(0, 1.15fr) minmax(18rem, .85fr); max-width: 78rem; }
.qualification-panel { background: var(--panel-deep); border: 1px solid var(--line); padding: clamp(1rem, 2vw, 1.5rem); }
.qualification-panel h2 { font-size: 1.05rem; margin: 0 0 1rem; }
.qualification-checks { display: grid; gap: .65rem; margin: 0; }
.qualification-check { align-items: center; border-bottom: 1px solid var(--line); display: grid; gap: .7rem; grid-template-columns: 1fr auto; padding: .7rem 0; }
.qualification-check:last-child { border-bottom: 0; }
.qualification-check dt { color: var(--muted); font-size: .9rem; }
.qualification-check dd { color: var(--faint); font-family: "SF Mono", "Cascadia Mono", ui-monospace, monospace; font-size: .7rem; margin: 0; text-transform: uppercase; }
.qualification-check[data-status="PASS"] dd { color: var(--lime); }
.qualification-check[data-status="FAIL"] dd { color: var(--amber); }
.qualification-actions { display: flex; flex-wrap: wrap; gap: .7rem; }
.qualification-actions button { background: transparent; border: 1px solid var(--line); color: var(--ink); cursor: pointer; min-height: 2.75rem; padding: .65rem 1rem; }
.qualification-actions button[data-primary="true"] { background: var(--lime); border-color: var(--lime); color: #142018; }
.qualification-actions button:disabled { cursor: not-allowed; opacity: .38; }
.qualification-actions button:focus-visible { outline: 3px solid var(--amber); outline-offset: 3px; }
.qualification-message { color: var(--muted); line-height: 1.55; margin: 1rem 0 0; min-height: 1.6em; }
.qualification-footer { color: var(--faint); font-family: "SF Mono", "Cascadia Mono", ui-monospace, monospace; font-size: .68rem; line-height: 1.6; max-width: 78rem; }
@media (max-width: 800px) {
  .qualification-flow, .qualification-grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 560px) {
  .qualification-flow, .qualification-grid { grid-template-columns: 1fr; }
  .qualification-header h1 { font-size: clamp(2.8rem, 17vw, 5rem); }
}
.qualification-nav { min-height:76px; display:flex; flex-wrap:wrap; align-items:center; gap:24px; padding:20px 32px; border-bottom:1px solid #333740; background:#1c1e24; font-size:14px; }
.qualification-nav strong { margin-right:24px; }
.qualification-nav a { color:#969da9; text-decoration:none; }
.qualification-nav a[aria-current] { color:#e3b693; }
.qualification-shell { background:#17191e; gap:24px; padding:36px 44px; max-width:1440px; margin:auto; min-height:calc(100vh - 76px); align-content:start; }
.qualification-header { gap:12px; }
.qualification-header h1 { font-family:inherit; font-size:28px; letter-spacing:-.03em; line-height:1.3; max-width:none; }
.qualification-signal { max-width:78rem; }
.qualification-header p { font-size:14px; }
.qualification-step { min-height:9rem; border-radius:6px; }
.qualification-panel { border-radius:8px; }
.qualification-signal { border-radius:6px; background:#202329; }
.qualification-actions button { border-radius:5px; font-size:13px; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
`;

export function qualificationRequestOptions(
  controlToken: string,
  method: string,
  body?: unknown,
): { method: string; headers: Record<string, string>; body?: string } {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-qualification-token': controlToken,
  };
  if (body === undefined) return { method, headers };
  return {
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const PAGE_SCRIPT = (
  controlToken: string,
  qualificationProfile: 'base' | 'objective-timing',
): string => `
const controlToken = ${JSON.stringify(controlToken).replaceAll('<', '\\u003c')};
const qualificationProfile = ${JSON.stringify(qualificationProfile)};
const requestOptions = ${qualificationRequestOptions.toString()};
const stateLabels = {
  waiting: '等待 CS2',
  receiving: '正在接收比赛数据',
  stale: '比赛数据已过期',
  ready: '可以导出结果',
};
const checkLabels = {
  productionChain: '第一场数据已进入正式处理链路',
  realSilenceToStale: '数据过期与退出 CS2 已分别确认',
  explicitNextExecution: '下一场从新的地图执行开始',
  demoBRecovery: '第二场已恢复且无上一场残留',
  captureIntegrity: '采集记录完整且可验证',
};
const flow = [
  { id: 'a', markers: ['demo-a-live'] },
  { id: 'stop', markers: ['runtime-stale', 'cs2-closed'] },
  { id: 'next', markers: ['next-execution'] },
  { id: 'b', markers: ['cs2-reopened', 'demo-b-live'] },
];
const byId = (id) => document.getElementById(id);
const stateText = byId('qualification-state');
const signal = document.querySelector('.qualification-signal');
const message = byId('qualification-message');
const result = byId('qualification-result');
const checks = byId('qualification-checks');
const buttons = [...document.querySelectorAll('button[data-action]')];
let finalizationComplete = false;
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

async function call(path, method = 'GET', body) {
  const response = await fetch(path, requestOptions(method, body));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('本地制播服务请求失败，请检查服务后重试');
  return data;
}

function checkStatus(status) {
  return status === 'PASS' ? '已通过' : status === 'FAIL' ? '失败' : '待确认';
}

function resultLabel(value) {
  return value === 'PASS' ? '通过' : value === 'FAIL' ? '失败' : '证据不足';
}

function render(data) {
  if (finalizationComplete) return;
  const objectiveMode = qualificationProfile === 'objective-timing';
  stateText.textContent = stateLabels[data.state] || '正在读取状态';
  signal.dataset.tone = data.state === 'receiving' || data.state === 'ready' ? 'good' : 'neutral';
  result.textContent = resultLabel(data.result);
  result.dataset.tone = data.result.toLowerCase();
  checks.innerHTML = objectiveMode
    ? [
        '<div class="qualification-check" data-status="' + (data.objectiveScenarioProgress?.complete ? 'PASS' : 'INCONCLUSIVE') + '"><dt>目标时钟场景窗口</dt><dd>' + escapeHtml(String(data.objectiveScenarioProgress?.completed ?? 0) + '/' + String(data.objectiveScenarioProgress?.required ?? 8)) + '</dd></div>',
        '<div class="qualification-check" data-status="' + escapeHtml(data.checks.captureIntegrity.status) + '"><dt>采集记录状态</dt><dd>' + escapeHtml(checkStatus(data.checks.captureIntegrity.status)) + '</dd></div>',
      ].join('')
    : Object.entries(data.checks).map(([key, check]) =>
        '<div class="qualification-check" data-status="' + escapeHtml(check.status) + '"><dt>' + escapeHtml(checkLabels[key] || check.label) + '</dt><dd>' + escapeHtml(checkStatus(check.status)) + '</dd></div>'
      ).join('');
  for (const step of flow) {
    const card = document.querySelector('[data-step="' + step.id + '"]');
    const completed = step.markers.every((marker) => data.markers.includes(marker));
    const active = !completed && step.markers.some((marker) => data.markers.includes(marker));
    card.dataset.status = completed ? 'complete' : active ? 'active' : 'pending';
    card.querySelector('[data-step-status]').textContent = completed ? '已完成' : active ? '进行中' : '等待操作';
  }
  const receiving = data.state === 'receiving';
  const baseActionIds = ['confirm-a', 'confirm-stop', 'next-execution', 'confirm-reopen', 'confirm-b'];
  for (const id of baseActionIds) byId(id).hidden = objectiveMode;
  document.querySelector('.qualification-flow').hidden = objectiveMode;
  byId('confirm-a').disabled = objectiveMode || !receiving || data.markers.includes('demo-a-live');
  byId('confirm-stop').disabled = objectiveMode || !data.markers.includes('demo-a-live') || data.markers.includes('cs2-closed');
  byId('next-execution').disabled = objectiveMode || data.result === 'FAIL' || !data.markers.includes('runtime-stale') || !data.markers.includes('cs2-closed') || data.markers.includes('next-execution');
  byId('confirm-reopen').disabled = objectiveMode || !data.markers.includes('next-execution') || data.markers.includes('cs2-reopened');
  byId('confirm-b').disabled = objectiveMode || !data.markers.includes('cs2-reopened') || !receiving || data.markers.includes('demo-b-live');
  byId('finish').disabled = data.result === 'FAIL' || (objectiveMode ? !data.objectiveScenarioProgress?.complete : !data.markers.includes('demo-b-live'));
  if (objectiveMode) {
    message.textContent = data.objectiveScenarioProgress?.complete
      ? '八类目标时钟场景窗口已记录；可结束测试并生成离线验收结论。'
      : '目标时钟专项验收进行中；使用 mark.ps1 为八类场景记录开始/结束窗口。';
  }
}

async function refresh() {
  if (finalizationComplete) return;
  try {
    render(await call('/qualification/status'));
  } catch {
    stateText.textContent = '无法连接本地制播服务';
    message.textContent = '操作或连接未完成，请检查本地制播服务后重试。';
    signal.dataset.tone = 'neutral';
  }
}

function renderFinalization(data) {
  finalizationComplete = true;
  stateText.textContent = '测试已完成';
  signal.dataset.tone =
    data.result === 'PASS' && data.verification === 'passed' && data.cleanup !== 'failed'
      ? 'good'
      : 'neutral';
  result.textContent = resultLabel(data.result);
  result.dataset.tone = String(data.result || 'INCONCLUSIVE').toLowerCase();
  buttons.forEach((button) => { button.disabled = true; });
  const reportPath = data.reportPath || 'evidence/<runId>/REPORT.md';
  const verification = data.verification === 'passed' ? '核心验收已验证' : '核心验收验证未通过';
  const cleanup = data.cleanup === 'failed'
    ? '环境恢复失败，请人工检查 GSI 配置'
    : data.cleanup === 'passed'
      ? '环境已恢复'
      : '环境恢复状态待确认';
  const diagnostics = data.verification === 'passed' || !data.diagnosticsPath
    ? ''
    : '诊断日志：' + data.diagnosticsPath;
  message.textContent = '核心验收：' + resultLabel(data.result) + ' · ' + verification + ' · ' + cleanup + ' · 报告：' + reportPath + (diagnostics ? ' · ' + diagnostics : '');
}

async function waitForFinalization() {
  const deadline = Date.now() + 60000;
  message.textContent = '正在整理采集记录并生成最终验收结果。';
  while (Date.now() < deadline) {
    try {
      const data = await call('/qualification/finalization');
      if (data.status === 'complete') {
        renderFinalization(data);
        void call('/qualification/finalization/ack', 'POST').catch(() => {});
        return;
      }
      message.textContent = '正在生成验收证据，请稍候。';
    } catch {}
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  message.textContent = '等待最终验收证据超时；请在验收包的 evidence 目录检查日志。';
}

async function act(path, method = 'POST', body) {
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const data = await call(path, method, body);
    message.textContent = data.message || '操作已记录';
    if (data.status === 'stopping') {
      await waitForFinalization();
      return;
    }
    await refresh();
  } catch {
    message.textContent = '操作或连接未完成，请检查本地制播服务后重试。';
    await refresh();
  }
}

byId('confirm-a').onclick = () => void act('/qualification/marker', 'POST', { kind: 'demo-a-live' });
byId('confirm-stop').onclick = () => void act('/qualification/stop');
byId('next-execution').onclick = () => void act('/qualification/next-map-execution');
byId('confirm-reopen').onclick = () => void act('/qualification/marker', 'POST', { kind: 'cs2-reopened' });
byId('confirm-b').onclick = () => void act('/qualification/marker', 'POST', { kind: 'demo-b-live' });
byId('finish').onclick = () => void act('/qualification/finish');
void refresh();
window.setInterval(() => { if (!finalizationComplete) void refresh(); }, 1000);
`;

export function qualificationPageHtml(
  controlToken: string,
  qualificationProfile: 'base' | 'objective-timing' = 'base',
): string {
  const objectiveMode = qualificationProfile === 'objective-timing';
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>现场验收 · RivalHub Broadcast</title>
    <style>${PAGE_STYLE}</style>
  </head>
  <body>
    <nav class="qualification-nav" aria-label="制作导航"><strong>RivalHub Broadcast</strong><a href="/operator">制作控制</a><a href="/operator/hud">HUD 编辑器</a><a href="/debug">运行诊断</a><a href="/qualification" aria-current="page">现场验收</a><a href="/program" target="_blank" rel="noreferrer">打开播出画面 ↗</a></nav>
    <main class="qualification-shell">
      <section class="qualification-signal" aria-live="polite">
        <span class="qualification-signal__dot" aria-hidden="true"></span>
        <span class="qualification-signal__label">比赛数据</span>
        <strong class="qualification-signal__state" id="qualification-state">正在读取状态</strong>
      </section>

      <header class="qualification-header">
        <p class="qualification-kicker">RivalHub Broadcast / 现场验收</p>
        <h1>现场验收</h1>
        <p>${objectiveMode ? '这个页面用于目标时钟专项验收：八类场景由 PowerShell 标记明确圈定，页面只显示采集状态与场景窗口进度；最终语义与数值结论由离线证据验证器计算。' : '这个页面用于连续两场 Demo 的真实环境验收：确认第一场数据正常，退出 CS2 并等待比赛数据过期，再开始下一场，验证第二场从干净状态恢复。'}</p>
      </header>

      <section class="qualification-flow" aria-label="现场验收流程">
        <article class="qualification-step" data-step="a"><span class="qualification-step__index">01 / 第一场</span><h2>播放 Demo A</h2><p>等页面显示正在接收比赛数据后，确认第一场正常。</p><span class="qualification-step__status" data-step-status>等待操作</span></article>
        <article class="qualification-step" data-step="stop"><span class="qualification-step__index">02 / 停止</span><h2>退出 CS2</h2><p>在 CS2 中执行 quit；页面会自动识别一段时间未收到新数据，随后由你确认已经退出 CS2。</p><span class="qualification-step__status" data-step-status>等待操作</span></article>
        <article class="qualification-step" data-step="next"><span class="qualification-step__index">03 / 下一场</span><h2>准备下一场</h2><p>点击一次，准备接收下一场比赛。</p><span class="qualification-step__status" data-step-status>等待操作</span></article>
        <article class="qualification-step" data-step="b"><span class="qualification-step__index">04 / 第二场</span><h2>播放 Demo B</h2><p>重新打开 CS2，确认第二场没有上一场残留。</p><span class="qualification-step__status" data-step-status>等待操作</span></article>
      </section>

      <section class="qualification-grid">
        <article class="qualification-panel">
          <h2>现场操作</h2>
          <div class="qualification-actions">
            <button id="confirm-a" data-action="demo-a-live" data-primary="true">确认第一场数据正常</button>
            <button id="confirm-stop" data-action="cs2-closed">我已退出 CS2</button>
            <button id="next-execution" data-action="next-execution" data-primary="true">开始下一场</button>
            <button id="confirm-reopen" data-action="cs2-reopened">确认 CS2 已重新打开</button>
            <button id="confirm-b" data-action="demo-b-live" data-primary="true">确认第二场数据正常</button>
            <button id="finish" data-action="finish">结束测试并导出结果</button>
          </div>
          <p class="qualification-message" id="qualification-message" aria-live="polite">页面会自动记录验收所需信息并生成报告。</p>
        </article>
        <article class="qualification-panel">
          <h2>本次结果 <span id="qualification-result">证据不足</span></h2>
          <dl class="qualification-checks" id="qualification-checks"></dl>
        </article>
      </section>

      <footer class="qualification-footer">本地现场验收页面 · 验收证据与播出画面独立 · 机器结果保存在 evidence/REPORT.md 与 qualification.json</footer>
    </main>
    <script>${PAGE_SCRIPT(controlToken, qualificationProfile)}</script>
  </body>
</html>`;
}
