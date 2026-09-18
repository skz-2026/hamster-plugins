// 整页番茄钟（示例插件，page 入口）。
//
// 与小组件同一契约：`export default (el, ctx) => cleanup?`——
// 区别只在宿主给的是整页视口而不是一张卡片。本示例演示：
//   1. ctx.storage：今日完成数持久化（settings 表 plugin.focus-timer.* 命名空间）
//   2. 整页自绘布局/滚动自理（宿主只给 h-full 容器）
//
// 用任意框架开发整页插件：把框架打包进自包含单文件 ESM 即可，例如
//   esbuild page.tsx --bundle --format=esm --outfile=page.js
// （blob 动态 import 无法解析相对/bare 依赖，入口必须是单文件）
export default function render(el, ctx) {
  const FOCUS = 25 * 60;
  const BREAK = 5 * 60;
  const today = () => new Date().toISOString().slice(0, 10);

  el.innerHTML = `
    <div style="min-height:100%;display:flex;flex-direction:column;align-items:center;
                justify-content:center;gap:28px;padding:32px;font-family:system-ui">
      <div style="font-size:13px;letter-spacing:.2em;color:rgba(255,255,255,.45)">专注计时器</div>
      <div data-mode style="font-size:12px;padding:3px 14px;border-radius:999px;
           border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.75)">专注</div>
      <div data-time style="font-size:96px;font-weight:200;font-variant-numeric:tabular-nums;
           line-height:1;color:#fff">25:00</div>
      <div style="display:flex;gap:14px">
        <button data-toggle style="min-width:112px;padding:10px 0;border-radius:14px;border:none;
                cursor:pointer;font-size:14px;font-weight:600;color:#1b1418;background:#fff">开始</button>
        <button data-reset style="min-width:96px;padding:10px 0;border-radius:14px;cursor:pointer;
                font-size:14px;color:rgba(255,255,255,.8);background:transparent;
                border:1px solid rgba(255,255,255,.22)">重置</button>
      </div>
      <div data-count style="font-size:12px;color:rgba(255,255,255,.45)">今日完成 0 个番茄</div>
      <div style="max-width:520px;text-align:center;font-size:11px;line-height:1.7;
                  color:rgba(255,255,255,.3)">
        这是由插件提供的整页（page.js）——在主屏长按添加“专注计时器”图标后点击进入。<br>
        完成数通过 ctx.storage 持久化，重启保留。
      </div>
    </div>`;

  const time = el.querySelector('[data-time]');
  const mode = el.querySelector('[data-mode]');
  const toggle = el.querySelector('[data-toggle]');
  const reset = el.querySelector('[data-reset]');
  const count = el.querySelector('[data-count]');

  let remaining = FOCUS;
  let running = false;
  let onBreak = false;
  let timer = null;
  let done = 0;
  let doneDate = '';

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const paint = () => {
    time.textContent = fmt(remaining);
    mode.textContent = onBreak ? '休息' : '专注';
    toggle.textContent = running ? '暂停' : '开始';
    count.textContent = `今日完成 ${done} 个番茄`;
  };

  const loadCount = async () => {
    try {
      const raw = await ctx.storage.get('done');
      if (raw) {
        const [d, n] = raw.split('|');
        if (d === today()) done = Number(n) || 0;
      }
      doneDate = today();
      paint();
    } catch { /* 存储不可用时静默降级为会话内计数 */ }
  };
  const saveCount = () => ctx.storage.set('done', `${today()}|${done}`).catch(() => {});

  const finish = () => {
    running = false;
    onBreak = !onBreak;
    remaining = onBreak ? BREAK : FOCUS;
    if (onBreak) { done += 1; saveCount(); } // 专注段结束 → 休息，计入一个番茄
    paint();
  };

  const tick = () => {
    remaining -= 1;
    if (remaining <= 0) { finish(); return; }
    paint();
  };

  const onToggle = () => {
    running = !running;
    if (running) timer = setInterval(tick, 1000);
    else clearInterval(timer);
    paint();
  };
  const onReset = () => {
    clearInterval(timer);
    running = false;
    onBreak = false;
    remaining = FOCUS;
    paint();
  };

  toggle.addEventListener('click', onToggle);
  reset.addEventListener('click', onReset);
  loadCount();
  paint();

  return () => {
    clearInterval(timer);
    toggle.removeEventListener('click', onToggle);
    reset.removeEventListener('click', onReset);
  };
}
