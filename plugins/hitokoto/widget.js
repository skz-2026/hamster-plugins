// 一言小组件：演示 fetch 网络能力（hitokoto.cn 公开 API，支持 CORS）。

export default function render(el) {
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;justify-content:center;height:100%;gap:6px">
      <div data-line style="font-size:12px;line-height:1.5;color:rgba(255,255,255,.9)">加载中…</div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span data-from style="font-size:10px;color:rgba(255,255,255,.5)"></span>
        <button data-act
          style="border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:2px 10px;
                 font-size:10px;cursor:pointer;background:transparent;color:rgba(255,255,255,.75)">换一句</button>
      </div>
    </div>`;

  const line = el.querySelector('[data-line]');
  const from = el.querySelector('[data-from]');
  let controller = null;

  const load = () => {
    controller?.abort();
    controller = new AbortController();
    line.textContent = '加载中…';
    from.textContent = '';
    fetch('https://v1.hitokoto.cn/?max_length=24', { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        line.textContent = d.hitokoto ?? '（空）';
        from.textContent = d.from ?? '';
      })
      .catch((e) => {
        if (e.name !== 'AbortError') line.textContent = '网络不可用';
      });
  };

  const onClick = () => load();
  el.querySelector('[data-act]').addEventListener('click', onClick);
  load();

  return () => {
    controller?.abort();
    el.querySelector('[data-act]')?.removeEventListener('click', onClick);
  };
}
