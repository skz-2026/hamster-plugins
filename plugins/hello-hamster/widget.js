// 插件入口约定：export default (el, ctx) => 可选的清理函数
// el = 小组件容器（约 2 列宽、高 104px 的玻璃卡内部）
// ctx = { storage: { get(key), set(key, value) }, manifest }
// 沙箱内可用：DOM、fetch 网络、ctx.storage 私有存储；不开放原生 IPC。

export default function render(el, ctx) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;justify-content:center;height:100%;gap:6px">
      <div style="font-size:11px;font-weight:500;color:rgba(255,255,255,.9)">
        你好仓鼠 · ${ctx.manifest.name}
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <button data-act="add"
          style="border:0;border-radius:999px;padding:4px 12px;font-size:12px;cursor:pointer;
                 background:rgba(255,138,61,.85);color:#fff">囤一口</button>
        <span data-count style="font-size:22px;font-weight:300;color:#fff;font-variant-numeric:tabular-nums">0</span>
        <span style="font-size:10px;color:rgba(255,255,255,.55)">次（存进私有存储）</span>
      </div>
      <button data-act="todo"
        style="align-self:flex-start;border:1px solid rgba(255,255,255,.18);border-radius:999px;
               padding:2px 10px;font-size:10px;cursor:pointer;background:transparent;color:rgba(255,255,255,.75)">
        记一条「喂仓鼠」到待办
      </button>
    </div>`;

  const countEl = el.querySelector('[data-count]');
  const render2 = (n) => (countEl.textContent = String(n));

  let count = 0;
  let alive = true;
  const timer = setTimeout(() => {
    if (!alive) return;
    // 私有存储是异步的：get 返回 Promise<string | null>
    ctx.storage
      .get('count')
      .then((v) => {
        count = Number(v ?? 0);
        render2(count);
      })
      .catch(() => {});
  }, 0);

  const onClick = () => {
    count += 1;
    render2(count);
    ctx.storage.set('count', String(count)).catch(() => {});
  };
  el.querySelector('[data-act="add"]').addEventListener('click', onClick);

  // 受控 IPC 桥：manifest 声明了 permissions: ["todo.add"]，ctx.api.todoAdd 才存在
  const todoBtn = el.querySelector('[data-act="todo"]');
  const onTodo = async () => {
    todoBtn.textContent = '记录中…';
    try {
      if (ctx.api?.todoAdd) {
        await ctx.api.todoAdd({ content: '喂仓鼠（来自插件）' });
        todoBtn.textContent = '✓ 已记入待办';
      } else {
        todoBtn.textContent = '未声明权限';
      }
    } catch {
      todoBtn.textContent = '失败，重试？';
    }
  };
  todoBtn.addEventListener('click', onTodo);

  // 返回清理函数（组件卸载时调用）
  return () => {
    alive = false;
    clearTimeout(timer);
    el.querySelector('[data-act="add"]')?.removeEventListener('click', onClick);
    todoBtn?.removeEventListener('click', onTodo);
  };
}
