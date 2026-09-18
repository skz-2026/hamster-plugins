// AI 笔记（ai-notes）—— 整页插件：以标签为核心的笔记应用。
//
// 演示能力：
//   1. ctx.storage 持久化（键名只能用小写/数字/-/_：notes_v1、ai_config）
//   2. 标签工作流：输入自动补全、一键建议、多选过滤、全局重命名/删除、颜色指纹
//   3. 可选 AI：配置 OpenAI 兼容接口（GLM / DeepSeek / OpenAI…）后「AI 打标」「AI 摘要」
//      走真实模型；未配置时建议退化为本地启发式（零配置可用）。
//
// 任意框架开发整页插件：单文件自包含 ESM（esbuild --bundle --format=esm），
// 契约 `export default (el, ctx) => cleanup?`。
export default function render(el, ctx) {
  const NOTES_KEY = 'notes_v1';
  const CFG_KEY = 'ai_config';

  // ===== 工具 =====
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hashHue = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 360;
  };
  const fmtDate = (ts) => {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const normTag = (raw) =>
    String(raw ?? '').trim().replace(/^#/, '').replace(/[,，、\s]+/g, '').slice(0, 12);

  // ===== 状态 =====
  /** @type {{id:string,title:string,body:string,tags:string[],created:number,updated:number,pinned:number}[]} */
  let notes = [];
  let cfg = { baseUrl: '', apiKey: '', model: '' }; // OpenAI 兼容接口，空 = 未配置
  const view = { q: '', tags: new Set() };
  let overlay = null; // 当前弹层（编辑器/设置/标签管理），同一时刻只一个

  const save = () => ctx.storage.set(NOTES_KEY, JSON.stringify(notes)).catch(() => {});
  const saveCfg = () => ctx.storage.set(CFG_KEY, JSON.stringify(cfg)).catch(() => {});
  const aiReady = () => !!(cfg.baseUrl && cfg.apiKey && cfg.model);

  // ===== 标签逻辑 =====
  function allTags() {
    const m = new Map();
    for (const n of notes) for (const t of n.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()]
      .map(([name, count]) => ({ name, count, hue: hashHue(name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
  }

  function visibleNotes() {
    const q = view.q.trim().toLowerCase();
    return notes
      .filter((n) => !q || (n.title + '\n' + n.body).toLowerCase().includes(q))
      .filter((n) => view.tags.size === 0 || [...view.tags].some((t) => n.tags.includes(t))) // 多选 = OR
      .sort((a, b) => b.pinned - a.pinned || b.updated - a.updated);
  }

  // ===== 本地启发式打标（零配置）=====
  const VOCAB = {
    工作: ['会议', '日报', '周报', '需求', '项目', '排期', '上线', 'bug', '客户', 'okr', '评审', '联调', '加班'],
    学习: ['笔记', '论文', '课程', '教程', '英语', '读书', '总结', '练习', '考试', '刷题'],
    生活: ['买菜', '健身', '跑步', '旅行', '电影', '水电', '体检', '聚餐', '快递'],
    想法: ['想法', '灵感', 'idea', '创意', '试试', '如果', '也许'],
    待办: ['待办', 'todo', '提醒', '记得', '要买', '要交', '预约', '缴费'],
  };
  const STOP = new Set(['的', '了', '和', '是', '在', '我', '有', '个', '也', '不', '就', '都', '而', '及', '与', '这', '那', '一个', '什么', '怎么', '可以', '因为', '所以', '但是', '还是', '已经', '没有', '我们', '你们', '他们', 'the', 'a', 'to', 'of', 'and', 'is', 'it', 'for']);
  function suggestLocal(text) {
    const s = text.toLowerCase();
    const hits = [];
    for (const [tag, kws] of Object.entries(VOCAB)) {
      if (kws.some((k) => s.includes(k.toLowerCase()))) hits.push(tag);
    }
    // 高频词兜底：≥2 字且出现 ≥2 次的词
    const freq = new Map();
    for (const t of text.match(/[\u4e00-\u9fa5]{2,4}|[a-z][a-z0-9-]{2,}/gi) ?? []) {
      const k = t.toLowerCase();
      if (!STOP.has(k)) freq.set(k, (freq.get(k) ?? 0) + 1);
    }
    for (const [w, c] of [...freq.entries()].sort((a, b) => b[1] - a[1])) {
      if (c >= 2 && !hits.includes(w)) hits.push(w);
      if (hits.length >= 4) break;
    }
    return hits.slice(0, 4);
  }

  // ===== 可选 AI（OpenAI 兼容 chat/completions）=====
  async function chat(prompt) {
    const { baseUrl, apiKey, model } = cfg;
    const res = await fetch(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.3 }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
    const data = await res.json();
    return String(data.choices?.[0]?.message?.content ?? '').trim();
  }
  async function aiTags(title, body) {
    const raw = await chat(
      '为下面的笔记提取 2-4 个简短中文标签（1-4 字，不带 #）。只输出 JSON 字符串数组，例如 ["工作","排期"]。\n\n' + title + '\n' + body,
    );
    const m = raw.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(m ? m[0] : '[]');
    return arr.filter((x) => typeof x === 'string').map((x) => normTag(x)).filter(Boolean).slice(0, 4);
  }
  const aiSummary = (title, body) =>
    chat('用一两句话中文总结下面的笔记，直接输出总结正文：\n\n' + title + '\n' + body);

  // ===== 骨架 =====
  el.innerHTML = `
    <style>
      .an-root{position:relative;height:100%;min-height:0;display:flex;flex-direction:column;color:rgba(255,255,255,.92);font-family:system-ui,'Segoe UI',sans-serif;font-size:13px}
      .an-head{display:flex;align-items:center;gap:10px;padding:0 4px 12px;border-bottom:1px solid rgba(255,255,255,.08)}
      .an-logo{font-size:15px;font-weight:600;white-space:nowrap}
      .an-count{font-size:11px;color:rgba(255,255,255,.4);font-weight:400;margin-left:6px}
      .an-search{flex:1;min-width:120px;height:34px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;padding:0 12px;font-size:12.5px;outline:none}
      .an-search:focus{border-color:rgba(255,255,255,.3)}
      .an-btn{height:34px;padding:0 14px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:transparent;color:rgba(255,255,255,.8);cursor:pointer;font-size:12.5px;white-space:nowrap}
      .an-btn:hover{background:rgba(255,255,255,.08)}
      .an-btn.primary{background:#ff8a3d;border:none;color:#1b1418;font-weight:600}
      .an-btn.primary:hover{background:#ffa05e}
      .an-tagbar{display:flex;flex-wrap:wrap;gap:6px;padding:10px 4px;align-items:center}
      .an-chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 10px;border-radius:999px;font-size:11.5px;cursor:pointer;border:1px solid transparent;user-select:none}
      .an-chip:hover{filter:brightness(1.15)}
      .an-chip .n{opacity:.55;font-size:10px}
      .an-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px 4px 20px}
      .an-list::-webkit-scrollbar{width:6px}
      .an-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:3px}
      .an-card{display:flex;gap:12px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.045);border-radius:14px;padding:12px 14px;cursor:pointer}
      .an-card:hover{background:rgba(255,255,255,.07)}
      .an-card.pin{border-color:rgba(255,178,107,.45)}
      .an-cmain{flex:1;min-width:0}
      .an-ctitle{font-size:13.5px;font-weight:600;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .an-cbody{font-size:12px;color:rgba(255,255,255,.55);line-height:1.5;max-height:3em;overflow:hidden;white-space:pre-wrap;word-break:break-all}
      .an-ctags{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
      .an-cside{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0}
      .an-cdate{font-size:10.5px;color:rgba(255,255,255,.35)}
      .an-cacts{display:flex;gap:2px;opacity:0;transition:opacity .12s}
      .an-card:hover .an-cacts{opacity:1}
      .an-act{width:26px;height:26px;border:none;border-radius:8px;background:transparent;color:rgba(255,255,255,.6);cursor:pointer;font-size:12px}
      .an-act:hover{background:rgba(255,255,255,.12);color:#fff}
      .an-act.danger:hover{color:#ff8f8f}
      .an-empty{margin:auto;text-align:center;color:rgba(255,255,255,.35);font-size:12.5px;line-height:2}
      .an-mask{position:absolute;inset:0;background:rgba(10,8,12,.55);backdrop-filter:blur(6px);display:grid;place-items:center;z-index:10}
      .an-modal{width:min(640px,92%);max-height:86%;overflow-y:auto;background:#221e28;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:18px 20px;display:flex;flex-direction:column;gap:12px}
      .an-modal h3{margin:0;font-size:14px;font-weight:600}
      .an-inp{height:34px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;padding:0 12px;font-size:12.5px;outline:none;width:100%}
      .an-inp:focus{border-color:rgba(255,255,255,.3)}
      textarea.an-inp{height:auto;min-height:120px;padding:10px 12px;line-height:1.6;resize:vertical;font-family:inherit}
      .an-tagedit{display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:7px 9px;background:rgba(255,255,255,.04)}
      .an-tagedit input{flex:1;min-width:90px;border:none;background:transparent;color:#fff;font-size:12px;outline:none;height:24px}
      .an-x{margin-left:4px;opacity:.6;cursor:pointer;font-size:10px}
      .an-x:hover{opacity:1}
      .an-sugrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11px;color:rgba(255,255,255,.45)}
      .an-foot{display:flex;justify-content:flex-end;gap:8px}
      .an-hint{font-size:10.5px;color:rgba(255,255,255,.35);line-height:1.6}
      .an-sum{border-left:3px solid #ff8a3d;background:rgba(255,138,61,.08);border-radius:6px;padding:8px 10px;font-size:12px;line-height:1.6;color:rgba(255,255,255,.8)}
      .an-tgrow{display:flex;align-items:center;gap:8px}
      .an-tgrow .grow{flex:1}
    </style>
    <div class="an-root">
      <div class="an-head">
        <span class="an-logo">📝 AI 笔记<span class="an-count" data-count></span></span>
        <input class="an-search" data-search placeholder="搜索标题与正文…">
        <button class="an-btn" data-tags>标签管理</button>
        <button class="an-btn" data-cfg>AI 设置</button>
        <button class="an-btn primary" data-new>＋ 新笔记</button>
      </div>
      <div class="an-tagbar" data-tagbar></div>
      <div class="an-list" data-list></div>
      <div class="an-overlay-root"></div>
    </div>`;

  const $ = (sel) => el.querySelector(sel);
  const listEl = $('[data-list]');
  const tagbarEl = $('[data-tagbar]');
  const searchEl = $('[data-search]');
  const countEl = $('[data-count]');
  const overlayRoot = $('.an-overlay-root');

  const chipHtml = (name, count, active) => {
    const hue = hashHue(name);
    const bg = active
      ? `background:hsl(${hue} 60% 42%);color:#fff`
      : `background:hsl(${hue} 45% 42% / .28);color:hsl(${hue} 70% 82%)`;
    return `<span class="an-chip" data-tag="${esc(name)}" style="${bg}">${esc(name)}${count != null ? `<span class="n">${count}</span>` : ''}</span>`;
  };

  function paintTagbar() {
    const tags = allTags();
    tagbarEl.innerHTML =
      chipHtml('全部', notes.length, view.tags.size === 0) +
      tags.map((t) => chipHtml(t.name, t.count, view.tags.has(t.name))).join('');
  }

  function paintList() {
    const rows = visibleNotes();
    countEl.textContent = `${notes.length} 条`;
    if (rows.length === 0) {
      listEl.innerHTML = `<div class="an-empty">${
        notes.length === 0 ? '还没有笔记<br>点右上「＋ 新笔记」开始，或在主屏添加 📝 图标' : '没有匹配的笔记<br>换个关键词或清除标签过滤'
      }</div>`;
      return;
    }
    listEl.innerHTML = rows
      .map(
        (n) => `
      <div class="an-card${n.pinned ? ' pin' : ''}" data-id="${n.id}">
        <div class="an-cmain">
          <div class="an-ctitle">${n.pinned ? '📌 ' : ''}${esc(n.title) || '无标题'}</div>
          ${n.body ? `<div class="an-cbody">${esc(n.body)}</div>` : ''}
          <div class="an-ctags">${n.tags.map((t) => chipHtml(t)).join('')}</div>
        </div>
        <div class="an-cside">
          <span class="an-cdate">${fmtDate(n.updated)}</span>
          <div class="an-cacts">
            <button class="an-act" data-act="pin" title="${n.pinned ? '取消置顶' : '置顶'}">${n.pinned ? '📥' : '📌'}</button>
            <button class="an-act" data-act="edit" title="编辑">✎</button>
            <button class="an-act danger" data-act="del" title="删除">✕</button>
          </div>
        </div>
      </div>`,
      )
      .join('');
  }

  const paint = () => {
    paintTagbar();
    paintList();
  };

  // ===== 弹层基座 =====
  function openModal(inner) {
    closeModal();
    const mask = document.createElement('div');
    mask.className = 'an-mask';
    mask.innerHTML = `<div class="an-modal">${inner}</div>`;
    overlayRoot.appendChild(mask);
    overlay = mask;
    mask.addEventListener('pointerdown', (e) => {
      if (e.target === mask) closeModal();
    });
    return mask.querySelector('.an-modal');
  }
  function closeModal() {
    overlay?.remove();
    overlay = null;
  }

  // ===== 笔记编辑器 =====
  /** @param {{id,title,body,tags}|null} init null = 新建 */
  function openEditor(init) {
    const isNew = !init;
    const note = init ?? { title: '', body: '', tags: [] };
    const m = openModal(`
      <h3>${isNew ? '新笔记' : '编辑笔记'}</h3>
      <input class="an-inp" data-f-title placeholder="标题" value="${esc(note.title)}">
      <textarea class="an-inp" data-f-body placeholder="内容…（支持多行）">${esc(note.body)}</textarea>
      <div class="an-tagedit" data-f-tags></div>
      <div class="an-sugrow">
        <span>建议：</span><span data-sug-chips style="display:contents"></span>
        <button class="an-btn" data-ai-tags style="height:24px;padding:0 10px;font-size:11px">AI 打标</button>
        <button class="an-btn" data-ai-sum style="height:24px;padding:0 10px;font-size:11px">AI 摘要</button>
      </div>
      <div data-sum-box></div>
      <div class="an-foot">
        <button class="an-btn" data-cancel>取消</button>
        <button class="an-btn primary" data-save>保存</button>
      </div>`);

    let tags = [...note.tags];

    const tagsBox = m.querySelector('[data-f-tags]');
    const sugBox = m.querySelector('[data-sug-chips]');
    const titleInp = m.querySelector('[data-f-title]');
    const bodyInp = m.querySelector('[data-f-body]');
    const sumBox = m.querySelector('[data-sum-box]');

    const paintTags = () => {
      tagsBox.innerHTML =
        tags.map((t) => chipHtml(t) .replace('data-tag=', 'data-rm=') + '').join('') +
        `<input data-f-taginp placeholder="输入标签，回车添加（自动补全）">`;
      const inp = tagsBox.querySelector('[data-f-taginp]');
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ',' && e.key !== '，' && e.key !== '、') return;
        e.preventDefault();
        const t = normTag(inp.value);
        if (t && !tags.includes(t)) tags.push(t);
        paintTags();
        tagsBox.querySelector('[data-f-taginp]').focus();
      });
      inp.addEventListener('input', () => {
        const prefix = normTag(inp.value);
        const cands = allTags()
          .map((x) => x.name)
          .filter((x) => !tags.includes(x) && prefix && x.startsWith(prefix))
          .slice(0, 3);
        inp.dataset.sug = cands.join('\u0000');
        inp.title = cands.length ? '补全：' + cands.join(' / ') : '';
      });
      inp.addEventListener('blur', () => {
        // 失焦时若有补全候选且未再输入，回车太快容易丢——这里只做无损提交已有文本
        const t = normTag(inp.value);
        if (t && !tags.includes(t)) {
          tags.push(t);
          paintTags();
        }
      });
    };
    tagsBox.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]');
      if (!rm) return;
      tags = tags.filter((t) => t !== rm.dataset.rm);
      paintTags();
    });

    const paintSug = () => {
      const cur = new Set(tags);
      const sugs = suggestLocal(titleInp.value + '\n' + bodyInp.value).filter((t) => !cur.has(t));
      sugBox.innerHTML = sugs.length
        ? sugs.map((t) => chipHtml(t)).join('')
        : '<span style="opacity:.5">暂无（多写一点内容试试）</span>';
    };
    // 边写边出建议（弹层打开与每次输入都重算）
    titleInp.addEventListener('input', paintSug);
    bodyInp.addEventListener('input', paintSug);
    sugBox.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-tag]');
      if (!chip) return;
      if (!tags.includes(chip.dataset.tag)) tags.push(chip.dataset.tag);
      paintTags();
      paintSug();
    });

    const busy = async (btn, fn) => {
      const old = btn.textContent;
      btn.textContent = '…';
      btn.disabled = true;
      try {
        await fn();
      } catch (err) {
        sumBox.innerHTML = `<div class="an-hint" style="color:#ffb199">✗ ${esc(String(err).slice(0, 160))}</div>`;
      } finally {
        btn.textContent = old;
        btn.disabled = false;
      }
    };

    m.querySelector('[data-ai-tags]').addEventListener('click', (e) => {
      if (!aiReady()) {
        sumBox.innerHTML = `<div class="an-hint">未配置 AI 接口：点右上「AI 设置」填入 OpenAI 兼容接口（GLM / DeepSeek / OpenAI…）。当前建议为本地启发式。</div>`;
        return;
      }
      void busy(e.currentTarget, async () => {
        const got = await aiTags(titleInp.value, bodyInp.value);
        for (const t of got) if (!tags.includes(t)) tags.push(t);
        paintTags();
        paintSug();
      });
    });
    m.querySelector('[data-ai-sum]').addEventListener('click', (e) => {
      if (!aiReady()) {
        sumBox.innerHTML = `<div class="an-hint">AI 摘要需要先在「AI 设置」配置接口。</div>`;
        return;
      }
      void busy(e.currentTarget, async () => {
        const s = await aiSummary(titleInp.value, bodyInp.value);
        sumBox.innerHTML = `<div class="an-sum">${esc(s)}<div style="margin-top:6px"><button class="an-btn" data-ins style="height:24px;padding:0 10px;font-size:11px">插入到正文开头</button></div></div>`;
        sumBox.querySelector('[data-ins]').addEventListener('click', () => {
          bodyInp.value = s + '\n———\n' + bodyInp.value;
        });
      });
    });

    m.querySelector('[data-cancel]').addEventListener('click', closeModal);
    m.querySelector('[data-save]').addEventListener('click', () => {
      const title = titleInp.value.trim();
      const body = bodyInp.value.trim();
      if (!title && !body && tags.length === 0) return closeModal();
      const now = Date.now();
      if (isNew) {
        notes.unshift({ id: uid(), title, body, tags, created: now, updated: now, pinned: 0 });
      } else {
        const n = notes.find((x) => x.id === init.id);
        Object.assign(n, { title, body, tags, updated: now });
      }
      save();
      closeModal();
      paint();
    });

    paintTags();
    paintSug();
    titleInp.focus();
  }

  // ===== 标签管理 =====
  function openTagManager() {
    const paint = () => {
      const tags = allTags();
      const m = openModal(`
        <h3>标签管理</h3>
        ${tags.length === 0 ? '<div class="an-hint">还没有任何标签。</div>' : ''}
        ${tags
          .map(
            (t) => `
          <div class="an-tgrow" data-row="${esc(t.name)}">
            ${chipHtml(t.name, t.count)}
            <input class="an-inp grow" data-rename placeholder="重命名…" value="${esc(t.name)}">
            <button class="an-btn" data-apply style="height:30px">改名</button>
            <button class="an-btn" data-del style="height:30px;color:#ff9f9f">删除标签</button>
          </div>`,
          )
          .join('')}
        <div class="an-foot"><button class="an-btn" data-close>关闭</button></div>`);
      m.querySelector('[data-close]').addEventListener('click', closeModal);
      m.addEventListener('click', (e) => {
        const row = e.target.closest('[data-row]');
        if (!row) return;
        const name = row.dataset.row;
        if (e.target.closest('[data-apply]')) {
          const to = normTag(row.querySelector('[data-rename]').value);
          if (!to || to === name) return;
          // 改名即合并：目标标签已存在的笔记去重后只剩新标签
          for (const n of notes) n.tags = [...new Set(n.tags.map((x) => (x === name ? to : x)))];
          if (view.tags.has(name)) {
            view.tags.delete(name);
            view.tags.add(to);
          }
          save();
          paint();
          paintTagbar();
          paintList();
        } else if (e.target.closest('[data-del]')) {
          for (const n of notes) n.tags = n.tags.filter((x) => x !== name);
          view.tags.delete(name);
          save();
          paint();
          paintTagbar();
          paintList();
        }
      });
    };
    paint();
  }

  // ===== AI 设置 =====
  function openSettings() {
    const m = openModal(`
      <h3>AI 设置（可选）</h3>
      <div class="an-hint">配置 OpenAI 兼容接口后启用「AI 打标」与「AI 摘要」；不配置则建议为本地启发式，全部功能离线可用。密钥只存在本机插件私有存储里。</div>
      <input class="an-inp" data-base placeholder="Base URL，如 https://open.bigmodel.cn/api/paas/v4" value="${esc(cfg.baseUrl)}">
      <input class="an-inp" data-model placeholder="模型，如 glm-4-flash" value="${esc(cfg.model)}">
      <input class="an-inp" type="password" data-key placeholder="API Key" value="${esc(cfg.apiKey)}">
      <div class="an-foot">
        <button class="an-btn" data-clear>清空</button>
        <button class="an-btn primary" data-save>保存</button>
      </div>`);
    m.querySelector('[data-save]').addEventListener('click', () => {
      cfg = {
        baseUrl: m.querySelector('[data-base]').value.trim(),
        apiKey: m.querySelector('[data-key]').value.trim(),
        model: m.querySelector('[data-model]').value.trim(),
      };
      saveCfg();
      closeModal();
    });
    m.querySelector('[data-clear]').addEventListener('click', () => {
      cfg = { baseUrl: '', apiKey: '', model: '' };
      saveCfg();
      closeModal();
    });
  }

  // ===== 顶部与列表交互 =====
  searchEl.addEventListener('input', () => {
    view.q = searchEl.value;
    paintList();
  });
  tagbarEl.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tag]');
    if (!chip) return;
    const name = chip.dataset.tag;
    if (name === '全部') view.tags.clear();
    else if (view.tags.has(name)) view.tags.delete(name);
    else view.tags.add(name);
    paintTagbar();
    paintList();
  });
  el.querySelector('[data-new]').addEventListener('click', () => openEditor(null));
  el.querySelector('[data-tags]').addEventListener('click', openTagManager);
  el.querySelector('[data-cfg]').addEventListener('click', openSettings);

  // 列表按钮：两步删除（第一次点变确认，2.5s 后复原）
  let delArmed = null;
  let delTimer = null;
  listEl.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    const card = e.target.closest('[data-id]');
    if (!card) return;
    const id = card.dataset.id;
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    if (act) {
      const a = act.dataset.act;
      if (a === 'pin') {
        n.pinned = n.pinned ? 0 : 1; // 置顶不动 updated 时间戳
        save();
        paintList();
      } else if (a === 'edit') {
        openEditor(n);
      } else if (a === 'del') {
        if (delArmed !== id) {
          delArmed = id;
          act.textContent = '确认?';
          act.style.color = '#ff8f8f';
          clearTimeout(delTimer);
          delTimer = setTimeout(() => {
            delArmed = null;
            paintList();
          }, 2500);
          return;
        }
        notes = notes.filter((x) => x.id !== id);
        delArmed = null;
        save();
        paint();
      }
      return;
    }
    openEditor(n); // 点卡片主体 = 编辑
  });

  // Esc 关弹层
  const onKey = (e) => {
    if (e.key === 'Escape' && overlay) closeModal();
  };
  el.addEventListener('keydown', onKey);

  // ===== 启动：载入数据 =====
  (async () => {
    try {
      const raw = await ctx.storage.get(NOTES_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) {
        notes = arr
          .filter((x) => x && typeof x === 'object')
          .map((x) => ({
            id: String(x.id ?? uid()),
            title: String(x.title ?? ''),
            body: String(x.body ?? ''),
            tags: Array.isArray(x.tags) ? x.tags.map(normTag).filter(Boolean) : [],
            created: Number(x.created) || Date.now(),
            updated: Number(x.updated) || Date.now(),
            pinned: x.pinned ? 1 : 0,
          }));
      }
    } catch {
      notes = []; // 损坏数据降级为空（不覆盖，待下次保存重建）
    }
    try {
      const rawCfg = await ctx.storage.get(CFG_KEY);
      if (rawCfg) {
        const c = JSON.parse(rawCfg);
        cfg = {
          baseUrl: String(c.baseUrl ?? ''),
          apiKey: String(c.apiKey ?? ''),
          model: String(c.model ?? ''),
        };
      }
    } catch {
      /* 配置损坏按未配置处理 */
    }
    paint();
  })();

  return () => {
    el.removeEventListener('keydown', onKey);
    clearTimeout(delTimer);
  };
}
