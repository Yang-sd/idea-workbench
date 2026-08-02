(function () {
  'use strict';

  const STORAGE_KEY = 'idea-desk-v1';
  const ROUTES = ['all', 'inbox', 'try', 'later', 'done', 'weekly'];
  const STATUS_LABELS = { inbox: '收件箱', try: '准备尝试', later: '以后再说', done: '已完成' };
  const EXPERIMENT_LABELS = { not_started: '还没开始', in_progress: '进行中', completed: '已完成' };
  const $ = (selector, parent) => (parent || document).querySelector(selector);
  const $$ = (selector, parent) => Array.from((parent || document).querySelectorAll(selector));

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'idea-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function daysAgo(days) {
    return new Date(Date.now() - days * 86400000).toISOString();
  }

  function seedIdeas() {
    return [
      {
        id: 'idea-1',
        title: '把零散想法变成下一步清单',
        problem: '我能想到很多方向，但经常停在“以后做”，没有一个轻量的地方帮我开始。',
        audience: '像我一样同时有很多念头、但经常被切换打断的人',
        mvp: '做一个本地网页，记录想法，并要求每个想法都有一个 30 分钟动作。',
        nextAction: '画出新增想法表单的第一版',
        finishLine: '让 3 个朋友记录一个想法，并完成它的 30 分钟动作',
        status: 'try',
        tags: ['系统', '效率'],
        interest: 5,
        value: 4,
        ease: 4,
        experimentStatus: 'in_progress',
        experimentGoal: '验证“下一步动作”是否能让我真正开始',
        experimentResult: '',
        createdAt: daysAgo(4),
        updatedAt: daysAgo(0)
      },
      {
        id: 'idea-2',
        title: '给网页收藏夹加一个“以后再说”清理器',
        problem: '收藏夹里堆了很多“有空再看”的链接，最后既没有看，也找不到。',
        audience: '收藏很多资料、但不想维护复杂知识库的人',
        mvp: '支持导入书签，按主题分组，然后每天只推送三条待处理链接。',
        nextAction: '找出浏览器书签导出的数据结构',
        finishLine: '连续使用 7 天，清理掉 30 个积压收藏',
        status: 'inbox',
        tags: ['工具', '浏览器'],
        interest: 4,
        value: 4,
        ease: 3,
        experimentStatus: 'not_started',
        experimentGoal: '先确认自己是否真的愿意每天处理三条',
        experimentResult: '',
        createdAt: daysAgo(2),
        updatedAt: daysAgo(1)
      },
      {
        id: 'idea-3',
        title: '一周一个微型产品实验',
        problem: '我想做很多产品，但总是把第一个版本想得太大，迟迟没有发布。',
        audience: '想练习产品能力、但容易陷入长期项目的人',
        mvp: '每周选一个问题，周一验证，周三做出原型，周日公开复盘。',
        nextAction: '列出下周可以在 48 小时内验证的三个问题',
        finishLine: '完成 4 周，并公开 4 篇实验记录',
        status: 'later',
        tags: ['实验', '输出'],
        interest: 5,
        value: 5,
        ease: 2,
        experimentStatus: 'not_started',
        experimentGoal: '验证固定节奏能不能降低启动成本',
        experimentResult: '',
        createdAt: daysAgo(8),
        updatedAt: daysAgo(5)
      },
      {
        id: 'idea-4',
        title: '把学习笔记变成可回顾的提问卡',
        problem: '记了很多笔记，但回看的时候只是重新阅读，很少真正回忆和使用。',
        audience: '需要长期学习、希望把知识变成能力的人',
        mvp: '每篇笔记只生成 3 个问题，按间隔重复安排下一次回顾。',
        nextAction: '选一篇最近的笔记，手工写出 3 个问题',
        finishLine: '用 10 篇笔记跑通一轮回顾',
        status: 'try',
        tags: ['学习', '方法'],
        interest: 4,
        value: 5,
        ease: 3,
        experimentStatus: 'not_started',
        experimentGoal: '比较提问式回顾和再次阅读的记忆感受',
        experimentResult: '',
        createdAt: daysAgo(10),
        updatedAt: daysAgo(3)
      },
      {
        id: 'idea-5',
        title: '用语音快速收集灵感',
        problem: '走路时想到的东西，等能打字的时候已经忘了一半。',
        audience: '经常在移动中产生灵感的人',
        mvp: '用手机语音备忘录先收集，再集中整理成一句话标题。',
        nextAction: '把最近 5 条语音整理成可以搜索的标题',
        finishLine: '一周内不再丢掉移动中想到的 10 个念头',
        status: 'done',
        tags: ['习惯', '收集'],
        interest: 4,
        value: 3,
        ease: 5,
        experimentStatus: 'completed',
        experimentGoal: '确认先录音再整理，比当场打字更容易坚持',
        experimentResult: '确实更快，关键是给每条语音补一个标题。',
        createdAt: daysAgo(16),
        updatedAt: daysAgo(2)
      }
    ];
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ideas: seedIdeas(), focusId: 'idea-1', review: {} };
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.ideas)) throw new Error('invalid data');
      return {
        ideas: parsed.ideas,
        focusId: parsed.focusId || parsed.ideas.find((idea) => idea.status === 'try')?.id || null,
        review: parsed.review || {}
      };
    } catch (error) {
      return { ideas: seedIdeas(), focusId: 'idea-1', review: {} };
    }
  }

  const stored = loadData();
  const state = {
    ideas: stored.ideas,
    focusId: stored.focusId,
    review: stored.review,
    route: { page: 'all', id: null },
    query: '',
    tag: 'all',
    sort: 'updated'
  };

  function parseRoute() {
    const value = location.hash.replace(/^#\/?/, '');
    const parts = value.split('/').filter(Boolean);
    if (parts[0] === 'idea' && parts[1]) return { page: 'idea', id: decodeURIComponent(parts[1]) };
    return { page: ROUTES.includes(parts[0]) ? parts[0] : 'all', id: null };
  }

  function navigate(path) {
    const target = '#/' + path;
    if (location.hash === target) {
      state.route = parseRoute();
      renderApp();
      return;
    }
    location.hash = target;
  }

  function saveData(message) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ideas: state.ideas,
      focusId: state.focusId,
      review: state.review
    }));
    const status = $('#saveStatus');
    if (status) status.textContent = message || '已自动保存';
    window.clearTimeout(saveData.timer);
    saveData.timer = window.setTimeout(() => {
      if (status) status.textContent = '已自动保存';
    }, 1800);
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatRelative(iso) {
    const timestamp = new Date(iso).getTime();
    if (!Number.isFinite(timestamp)) return '刚刚';
    const hours = Math.max(0, Math.floor((Date.now() - timestamp) / 3600000));
    if (hours < 1) return '刚刚';
    if (hours < 24) return hours + ' 小时前';
    const days = Math.floor(hours / 24);
    if (days < 7) return days + ' 天前';
    return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }

  function parkedDays(iso) {
    return Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  }

  function scoreOf(idea) {
    const interest = Number(idea.interest) || 0;
    const value = Number(idea.value) || 0;
    const ease = Number(idea.ease) || 0;
    return Math.max(0, Math.min(10, Math.round(((interest * 0.45 + value * 0.4 + ease * 0.15) / 5) * 100) / 10));
  }

  function statusCount(status) {
    return state.ideas.filter((idea) => idea.status === status).length;
  }

  function ideaById(id) {
    return state.ideas.find((idea) => idea.id === id) || null;
  }

  function focusIdea() {
    return ideaById(state.focusId) && ideaById(state.focusId).status === 'try'
      ? ideaById(state.focusId)
      : state.ideas.find((idea) => idea.status === 'try') || null;
  }

  function currentWeekCompleted() {
    const cutoff = Date.now() - 7 * 86400000;
    return state.ideas.filter((idea) => idea.status === 'done' && new Date(idea.updatedAt).getTime() >= cutoff);
  }

  function tagsMarkup(tags) {
    if (!tags || !tags.length) return '<span class="tag">未分类</span>';
    return tags.slice(0, 3).map((tag) => '<span class="tag">' + escapeHTML(tag) + '</span>').join('');
  }

  function statusPill(idea) {
    return '<span class="status-pill ' + idea.status + '">' + STATUS_LABELS[idea.status] + '</span>';
  }

  function statusMenuMarkup(idea) {
    const options = Object.entries(STATUS_LABELS).map(([status, label]) =>
      '<button class="status-menu-option ' + (idea.status === status ? 'is-current' : '') + '" data-action="move" data-status="' + status + '" data-id="' + idea.id + '" type="button" role="menuitem"><span class="status-menu-dot ' + status + '"></span>' + label + (idea.status === status ? '<i data-lucide="check"></i>' : '') + '</button>'
    ).join('');
    return '<div class="status-menu-wrap"><button class="quick-status" data-action="status-menu" data-id="' + idea.id + '" type="button" aria-label="快速修改状态：' + escapeHTML(idea.title) + '" aria-expanded="false" data-tooltip="快速改状态"><i data-lucide="arrow-right-left"></i></button><div class="status-menu" role="menu" hidden><span class="status-menu-title">移动到</span>' + options + '</div></div>';
  }

  function emptyState(icon, title, copy, action) {
    return '<div class="empty-list"><div class="empty-list-icon"><i data-lucide="' + icon + '"></i></div><strong>' + title + '</strong><p>' + copy + '</p>' + (action || '') + '</div>';
  }

  function pageHeader(eyebrow, title, copy, action) {
    return '<section class="route-header"><div><p class="eyebrow">' + eyebrow + '</p><h1 class="route-title">' + title + '</h1><p class="route-copy">' + copy + '</p></div>' + (action ? '<div class="route-actions">' + action + '</div>' : '') + '</section>';
  }

  function basicIdeaRow(idea) {
    return '<article class="idea-row" data-action="open-idea" data-id="' + idea.id + '" tabindex="0" aria-label="打开想法：' + escapeHTML(idea.title) + '">' +
      '<span class="row-accent ' + idea.status + '"></span>' +
      '<div class="row-main"><div class="row-title-line"><h3 class="row-title">' + escapeHTML(idea.title) + '</h3>' + statusPill(idea) + '</div>' +
      '<p class="row-description">' + escapeHTML(idea.problem || '还没有补充它想解决的问题') + '</p>' +
      '<div class="row-bottom">' + tagsMarkup(idea.tags) + (idea.nextAction ? '<span class="row-next"><i data-lucide="arrow-right"></i>' + escapeHTML(idea.nextAction) + '</span>' : '') + '</div></div>' +
      '<div class="row-tools">' + statusMenuMarkup(idea) + '<button class="quick-delete" data-action="delete" data-id="' + idea.id + '" type="button" aria-label="快速删除：' + escapeHTML(idea.title) + '" data-tooltip="快速删除"><i data-lucide="trash-2"></i></button><div class="row-score"><span class="score-label">验证优先级</span><span class="score-value">' + scoreOf(idea) + '<small>/10</small></span></div></div></article>';
  }

  function filteredAllIdeas() {
    const query = state.query.trim().toLowerCase();
    const result = state.ideas.filter((idea) => {
      if (state.tag !== 'all' && !idea.tags.includes(state.tag)) return false;
      if (!query) return true;
      return [idea.title, idea.problem, idea.nextAction, idea.audience, ...idea.tags].join(' ').toLowerCase().includes(query);
    });
    result.sort((left, right) => {
      if (state.sort === 'score') return scoreOf(right) - scoreOf(left);
      if (state.sort === 'created') return new Date(right.createdAt) - new Date(left.createdAt);
      if (state.sort === 'title') return left.title.localeCompare(right.title, 'zh-CN');
      return new Date(right.updatedAt) - new Date(left.updatedAt);
    });
    return result;
  }

  function allResultsMarkup() {
    const ideas = filteredAllIdeas();
    const filtered = state.query.trim() || state.tag !== 'all';
    return '<div class="list-meta"><span>' + (ideas.length ? '显示 ' + ideas.length + ' 个想法' : '没有匹配的想法') + '</span>' +
      (filtered ? '<button class="clear-filter" data-action="clear-filter" type="button">清除筛选</button>' : '') + '</div>' +
      '<div class="idea-list">' + (ideas.length ? ideas.map(basicIdeaRow).join('') : emptyState('search-x', '没有找到匹配的想法', '换一个关键词，或者清除当前筛选。')) + '</div>';
  }

  function renderAllPage() {
    const tags = Array.from(new Set(state.ideas.flatMap((idea) => idea.tags))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const focus = focusIdea();
    return pageHeader('IDEA LIBRARY', '全部想法', '完整索引负责查找和比较；真正的处理工作交给其他页面。', '<button class="button primary-button" data-action="capture" type="button"><i data-lucide="plus"></i>新想法</button>') +
      '<section class="summary-strip" aria-label="想法统计">' +
      '<a href="#/inbox"><span>待整理</span><strong>' + statusCount('inbox') + '</strong></a>' +
      '<a href="#/try"><span>实验中</span><strong>' + statusCount('try') + '</strong></a>' +
      '<a href="#/later"><span>暂存</span><strong>' + statusCount('later') + '</strong></a>' +
      '<a href="#/done"><span>已完成</span><strong>' + statusCount('done') + '</strong></a></section>' +
      (focus ? '<section class="focus-ribbon"><div class="focus-ribbon-label"><i data-lucide="target"></i><span>当前专注</span></div><div class="focus-ribbon-main"><strong>' + escapeHTML(focus.title) + '</strong><span>' + escapeHTML(focus.nextAction || '补充下一步动作') + '</span></div><button class="mini-button" data-action="open-idea" data-id="' + focus.id + '" type="button">继续推进<i data-lucide="arrow-right"></i></button></section>' : '') +
      '<section class="route-section"><div class="section-heading"><div><h2>想法索引</h2><p>搜索、筛选并比较所有记录。</p></div><span class="title-count">' + state.ideas.length + '</span></div>' +
      '<div class="toolbar"><label class="search-box" for="searchInput"><i data-lucide="search"></i><input id="searchInput" type="search" value="' + escapeHTML(state.query) + '" placeholder="搜索标题、问题或标签" autocomplete="off" /><kbd>/</kbd></label><div class="toolbar-selects">' +
      '<label class="select-label" for="sortSelect"><span>排序</span><select id="sortSelect"><option value="updated"' + (state.sort === 'updated' ? ' selected' : '') + '>最近更新</option><option value="score"' + (state.sort === 'score' ? ' selected' : '') + '>优先验证</option><option value="created"' + (state.sort === 'created' ? ' selected' : '') + '>最近记录</option><option value="title"' + (state.sort === 'title' ? ' selected' : '') + '>按名称</option></select></label>' +
      '<label class="select-label" for="tagSelect"><span>标签</span><select id="tagSelect"><option value="all">全部</option>' + tags.map((tag) => '<option value="' + escapeHTML(tag) + '"' + (state.tag === tag ? ' selected' : '') + '>' + escapeHTML(tag) + '</option>').join('') + '</select></label></div></div>' +
      '<div id="allResults">' + allResultsMarkup() + '</div></section>';
  }

  function renderInboxPage() {
    const ideas = state.ideas.filter((idea) => idea.status === 'inbox').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const list = ideas.length ? ideas.map((idea) =>
      '<article class="triage-card"><div class="triage-card-top"><div><span class="triage-time">' + formatRelative(idea.createdAt) + '</span><h3>' + escapeHTML(idea.title) + '</h3></div><span class="score-chip">' + scoreOf(idea) + '/10</span></div>' +
      '<p>' + escapeHTML(idea.problem || '还没有补充它想解决的问题。') + '</p><div class="triage-tags">' + tagsMarkup(idea.tags) + '</div>' +
      '<div class="triage-actions"><button class="button compact-button primary-button" data-action="move" data-status="try" data-id="' + idea.id + '" type="button"><i data-lucide="flask-conical"></i>准备尝试</button><button class="button compact-button ghost-button" data-action="move" data-status="later" data-id="' + idea.id + '" type="button"><i data-lucide="archive"></i>以后再说</button><button class="text-button" data-action="open-idea" data-id="' + idea.id + '" type="button">补充详情<i data-lucide="arrow-right"></i></button></div></article>'
    ).join('') : emptyState('inbox', '收件箱已经清空', '新想法仍会先在这里停一下，等你决定下一步。', '<button class="button primary-button" data-action="capture" type="button"><i data-lucide="plus"></i>记录想法</button>');
    return pageHeader('CAPTURE & TRIAGE', '收件箱', '这里只有一个任务：接住新想法，并决定它接下来去哪里。', '<span class="page-count"><strong>' + ideas.length + '</strong> 待整理</span>') +
      '<section class="quick-capture"><form id="quickCaptureForm"><div class="quick-capture-icon"><i data-lucide="lightbulb"></i></div><label for="quickCaptureInput">脑中刚刚冒出了什么？</label><div class="quick-capture-row"><input id="quickCaptureInput" name="title" required maxlength="80" placeholder="先写一句话，不用完整" /><button class="button primary-button" type="submit">记下</button></div></form></section>' +
      '<section class="decision-lane" aria-label="收件箱处理流程"><div><span>01</span><strong>有价值吗</strong><small>问题是否真实</small></div><i data-lucide="arrow-right"></i><div><span>02</span><strong>现在做吗</strong><small>注意力是否允许</small></div><i data-lucide="arrow-right"></i><div><span>03</span><strong>放到哪里</strong><small>尝试或暂存</small></div></section>' +
      '<section class="route-section"><div class="section-heading"><div><h2>待整理</h2><p>每次只判断一条，不在这里展开项目。</p></div></div><div class="triage-list">' + list + '</div></section>';
  }

  function renderTryPage() {
    const ideas = state.ideas.filter((idea) => idea.status === 'try').sort((a, b) => scoreOf(b) - scoreOf(a));
    const focus = focusIdea();
    const candidates = ideas.map((idea) =>
      '<article class="experiment-card ' + (focus && focus.id === idea.id ? 'is-focus' : '') + '"><div class="experiment-card-head"><div>' + statusPill(idea) + '<h3>' + escapeHTML(idea.title) + '</h3></div><span class="score-value">' + scoreOf(idea) + '<small>/10</small></span></div>' +
      '<div class="experiment-facts"><div><span>要验证</span><strong>' + escapeHTML(idea.experimentGoal || '还没有定义验证目标') + '</strong></div><div><span>下一步</span><strong>' + escapeHTML(idea.nextAction || '还没有下一步动作') + '</strong></div><div><span>完成线</span><strong>' + escapeHTML(idea.finishLine || '还没有设定完成线') + '</strong></div></div>' +
      '<div class="experiment-card-footer"><span class="experiment-state"><i data-lucide="activity"></i>' + EXPERIMENT_LABELS[idea.experimentStatus || 'not_started'] + '</span><div><button class="text-button" data-action="focus" data-id="' + idea.id + '" type="button">' + (focus && focus.id === idea.id ? '取消专注' : '设为专注') + '</button><button class="mini-button" data-action="open-idea" data-id="' + idea.id + '" type="button">编辑计划</button><button class="mini-button" data-action="done" data-id="' + idea.id + '" type="button"><i data-lucide="check"></i>完成</button></div></div></article>'
    ).join('');
    return pageHeader('48-HOUR EXPERIMENTS', '准备尝试', '把值得做的方向压缩成小实验，用事实决定是否继续。', '<button class="button primary-button" data-action="capture" type="button"><i data-lucide="plus"></i>添加实验</button>') +
      (focus ? '<section class="focus-stage"><div class="focus-stage-mark"><i data-lucide="target"></i></div><div class="focus-stage-copy"><span>当前专注 · 只保留一个</span><h2>' + escapeHTML(focus.title) + '</h2><p><i data-lucide="arrow-right"></i>' + escapeHTML(focus.nextAction || '补充下一步动作') + '</p></div><div class="focus-stage-actions"><span class="experiment-state">' + EXPERIMENT_LABELS[focus.experimentStatus || 'not_started'] + '</span><button class="button ghost-button" data-action="open-idea" data-id="' + focus.id + '" type="button">打开实验</button></div></section>' : emptyState('target', '还没有当前专注', '从收件箱挑一个值得验证的想法，开始第一个小实验。', '<a class="button primary-button" href="#/inbox">去收件箱挑选</a>')) +
      '<section class="route-section"><div class="section-heading"><div><h2>实验队列</h2><p>按验证优先级排列，当前专注以外的项目保持等待。</p></div><span class="title-count">' + ideas.length + '</span></div><div class="experiment-grid">' + (candidates || emptyState('flask-conical', '实验队列是空的', '先把一个想法移到准备尝试。')) + '</div></section>';
  }

  function renderLaterPage() {
    const ideas = state.ideas.filter((idea) => idea.status === 'later').sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const rows = ideas.map((idea) =>
      '<article class="parking-row"><div class="parking-age"><strong>' + parkedDays(idea.updatedAt) + '</strong><span>天</span></div><div class="parking-main"><div class="row-title-line"><h3>' + escapeHTML(idea.title) + '</h3>' + tagsMarkup(idea.tags) + '</div><p>' + escapeHTML(idea.problem || '还没有补充问题描述') + '</p><span class="parking-next">上次下一步：' + escapeHTML(idea.nextAction || '未填写') + '</span></div><div class="parking-actions"><button class="mini-button" data-action="move" data-status="inbox" data-id="' + idea.id + '" type="button">重新判断</button><button class="button compact-button primary-button" data-action="move" data-status="try" data-id="' + idea.id + '" type="button"><i data-lucide="play"></i>重新启动</button></div></article>'
    ).join('');
    return pageHeader('SOMEDAY, NOT NOW', '以后再说', '暂存不是放弃。这里保护注意力，也保留未来重新启动的入口。', '<span class="page-count"><strong>' + ideas.length + '</strong> 个暂存</span>') +
      '<section class="quiet-band"><i data-lucide="archive"></i><div><strong>只有条件变化时才重启</strong><span>时间、资源或问题的重要性发生变化，再把它带回实验队列。</span></div></section>' +
      '<section class="route-section"><div class="section-heading"><div><h2>暂存清单</h2><p>按最近整理时间排列。</p></div></div><div class="parking-list">' + (rows || emptyState('archive', '这里暂时是空的', '不急着做的想法可以安心放在这里。')) + '</div></section>';
  }

  function renderDonePage() {
    const ideas = state.ideas.filter((idea) => idea.status === 'done').sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const experiments = ideas.filter((idea) => idea.experimentStatus === 'completed').length;
    const records = ideas.map((idea) =>
      '<article class="outcome-card"><div class="outcome-icon"><i data-lucide="check"></i></div><div class="outcome-main"><div class="row-title-line"><h3>' + escapeHTML(idea.title) + '</h3><span class="outcome-date">' + formatRelative(idea.updatedAt) + '</span></div><p class="outcome-line"><span>完成线</span>' + escapeHTML(idea.finishLine || '已完成当前阶段') + '</p>' + (idea.experimentResult ? '<p class="outcome-result"><span>得到的事实</span>' + escapeHTML(idea.experimentResult) + '</p>' : '') + '<div class="row-bottom">' + tagsMarkup(idea.tags) + '</div></div><div class="outcome-actions"><button class="mini-button" data-action="open-idea" data-id="' + idea.id + '" type="button">查看记录</button><button class="text-button" data-action="move" data-status="try" data-id="' + idea.id + '" type="button">重新打开</button></div></article>'
    ).join('');
    return pageHeader('SHIPPED & LEARNED', '已完成', '这里保留结果和事实，让每次尝试都能成为下一次判断的依据。', '') +
      '<section class="completion-summary"><div><span>完成总数</span><strong>' + ideas.length + '</strong></div><div><span>完成实验</span><strong>' + experiments + '</strong></div><div><span>本周完成</span><strong>' + currentWeekCompleted().length + '</strong></div></section>' +
      '<section class="route-section"><div class="section-heading"><div><h2>成果记录</h2><p>完成不代表永远结束，只代表这一阶段已经闭环。</p></div></div><div class="outcome-list">' + (records || emptyState('circle-check', '还没有完成记录', '完成第一个小实验后，它会出现在这里。', '<a class="button primary-button" href="#/try">查看实验队列</a>')) + '</div></section>';
  }

  function weekRange() {
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const format = (date) => date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    return format(monday) + ' - ' + format(sunday);
  }

  function renderWeeklyPage() {
    const done = currentWeekCompleted();
    const active = state.ideas.filter((idea) => idea.status === 'try');
    const focus = focusIdea();
    return pageHeader('WEEKLY REVIEW · ' + weekRange(), '本周复盘', '停下来整理事实，决定下周只把哪一件事带走。', '') +
      '<section class="review-metrics"><div><span>本周完成</span><strong>' + done.length + '</strong></div><div><span>正在尝试</span><strong>' + active.length + '</strong></div><div><span>待整理</span><strong>' + statusCount('inbox') + '</strong></div></section>' +
      '<section class="review-layout"><form class="review-form" id="weeklyReviewForm"><div class="section-heading"><div><h2>写下这一周</h2><p>只记录事实、判断和下一步。</p></div></div>' +
      '<label class="field-label" for="reviewWins">这周真正推进了什么</label><textarea class="text-input" id="reviewWins" name="wins" rows="4" placeholder="完成、发布、验证或放弃了什么">' + escapeHTML(state.review.wins || '') + '</textarea>' +
      '<label class="field-label" for="reviewLearnings">得到的事实</label><textarea class="text-input" id="reviewLearnings" name="learnings" rows="4" placeholder="哪些假设被证明或推翻">' + escapeHTML(state.review.learnings || '') + '</textarea>' +
      '<label class="field-label" for="reviewNext">下周唯一重点</label><textarea class="text-input" id="reviewNext" name="next" rows="3" placeholder="只写一件最重要的事">' + escapeHTML(state.review.next || '') + '</textarea>' +
      '<button class="button primary-button" type="submit"><i data-lucide="save"></i>保存本周复盘</button></form>' +
      '<div class="review-side"><div class="section-heading"><div><h2>下周只带走一个</h2><p>当前专注会显示在所有页面顶部。</p></div></div><div class="focus-options">' + (active.length ? active.map((idea) => '<button class="focus-option ' + (focus && focus.id === idea.id ? 'is-selected' : '') + '" data-action="focus" data-id="' + idea.id + '" type="button"><span><i data-lucide="' + (focus && focus.id === idea.id ? 'circle-dot' : 'circle') + '"></i></span><div><strong>' + escapeHTML(idea.title) + '</strong><small>' + escapeHTML(idea.nextAction || '还没有下一步动作') + '</small></div></button>').join('') : '<p class="muted-copy">还没有准备尝试的想法。</p>') + '</div>' +
      '<div class="week-evidence"><h3>本周完成</h3>' + (done.length ? done.map((idea) => '<button data-action="open-idea" data-id="' + idea.id + '" type="button"><i data-lucide="check"></i><span>' + escapeHTML(idea.title) + '</span></button>').join('') : '<p class="muted-copy">本周还没有完成记录。</p>') + '</div></div></section>';
  }

  function renderDetailPage(idea) {
    const isFocused = state.focusId === idea.id && idea.status === 'try';
    return '<a class="back-link" href="#/' + idea.status + '"><i data-lucide="arrow-left"></i>返回' + STATUS_LABELS[idea.status] + '</a>' +
      '<section class="detail-page-head"><div><div class="detail-page-meta">' + statusPill(idea) + '<span>更新于 ' + formatRelative(idea.updatedAt) + '</span></div><h1>' + escapeHTML(idea.title) + '</h1><p>在一个页面里完成判断、计划和实验记录。</p></div><button class="icon-button danger-icon" data-action="delete" data-id="' + idea.id + '" type="button" aria-label="删除这个想法"><i data-lucide="trash-2"></i></button></section>' +
      '<form class="editor-layout" id="detailForm" data-id="' + idea.id + '"><div class="editor-main">' +
      '<section class="editor-section"><div class="editor-section-head"><span>01</span><div><h2>想法本身</h2><p>先说清楚问题和最小版本。</p></div></div><div class="field-group"><label class="field-label" for="detailTitle">想法标题 <span>*</span></label><input class="text-input input-large" id="detailTitle" name="title" value="' + escapeHTML(idea.title) + '" maxlength="80" required /></div><div class="field-group"><label class="field-label" for="detailProblem">它在解决什么问题</label><textarea class="text-input" id="detailProblem" name="problem" rows="4">' + escapeHTML(idea.problem) + '</textarea></div><div class="form-row"><div><label class="field-label" for="detailAudience">可能会需要的人</label><textarea class="text-input" id="detailAudience" name="audience" rows="3">' + escapeHTML(idea.audience) + '</textarea></div><div><label class="field-label" for="detailMvp">我能做出的最小版本</label><textarea class="text-input" id="detailMvp" name="mvp" rows="3">' + escapeHTML(idea.mvp) + '</textarea></div></div></section>' +
      '<section class="editor-section"><div class="editor-section-head"><span>02</span><div><h2>把它往前推一步</h2><p>下一步应该能在 30 分钟内开始。</p></div></div><div class="field-group"><label class="field-label" for="detailNextAction">下一步动作</label><input class="text-input input-large" id="detailNextAction" name="nextAction" value="' + escapeHTML(idea.nextAction) + '" placeholder="一个具体动作（可选）" /></div><div class="field-group"><label class="field-label" for="detailFinishLine">完成线</label><textarea class="text-input" id="detailFinishLine" name="finishLine" rows="3">' + escapeHTML(idea.finishLine) + '</textarea></div></section></div>' +
      '<aside class="editor-rail"><section class="rail-section"><div class="editor-section-head"><span>03</span><div><h2>投入判断</h2><p>用同一把尺子比较想法。</p></div></div><div class="score-grid"><div class="score-field"><label for="interestRange">兴趣 <output id="interestOutput">' + idea.interest + '</output>/5</label><input id="interestRange" name="interest" type="range" min="1" max="5" value="' + idea.interest + '" /></div><div class="score-field"><label for="valueRange">价值 <output id="valueOutput">' + idea.value + '</output>/5</label><input id="valueRange" name="value" type="range" min="1" max="5" value="' + idea.value + '" /></div><div class="score-field"><label for="easeRange">易验证 <output id="easeOutput">' + idea.ease + '</output>/5</label><input id="easeRange" name="ease" type="range" min="1" max="5" value="' + idea.ease + '" /></div></div><div class="score-total"><span>验证优先级</span><strong id="detailScore">' + scoreOf(idea) + '<small>/10</small></strong></div></section>' +
      '<section class="rail-section experiment-box"><div class="editor-section-head"><span>04</span><div><h2>48 小时实验</h2><p>先证明它值得继续。</p></div></div><div class="field-group"><label class="field-label" for="experimentGoal">我要验证什么</label><textarea class="text-input" id="experimentGoal" name="experimentGoal" rows="3">' + escapeHTML(idea.experimentGoal) + '</textarea></div><div class="field-group"><label class="field-label" for="experimentResult">结果记录</label><textarea class="text-input" id="experimentResult" name="experimentResult" rows="3">' + escapeHTML(idea.experimentResult) + '</textarea></div><label class="field-label" for="experimentStatus">实验状态</label><select class="text-input" id="experimentStatus" name="experimentStatus"><option value="not_started"' + (idea.experimentStatus === 'not_started' ? ' selected' : '') + '>还没开始</option><option value="in_progress"' + (idea.experimentStatus === 'in_progress' ? ' selected' : '') + '>进行中</option><option value="completed"' + (idea.experimentStatus === 'completed' ? ' selected' : '') + '>已完成</option></select></section>' +
      '<section class="rail-section"><div class="form-row"><div><label class="field-label" for="detailStatus">所在页面</label><select class="text-input" id="detailStatus" name="status"><option value="inbox"' + (idea.status === 'inbox' ? ' selected' : '') + '>收件箱</option><option value="try"' + (idea.status === 'try' ? ' selected' : '') + '>准备尝试</option><option value="later"' + (idea.status === 'later' ? ' selected' : '') + '>以后再说</option><option value="done"' + (idea.status === 'done' ? ' selected' : '') + '>已完成</option></select></div><div><label class="field-label" for="detailTags">标签</label><input class="text-input" id="detailTags" name="tags" value="' + escapeHTML(idea.tags.join(', ')) + '" /></div></div><div class="editor-actions"><button class="button primary-button" type="submit"><i data-lucide="save"></i>保存修改</button>' + (idea.status === 'try' ? '<button class="button ghost-button" data-action="focus" data-id="' + idea.id + '" type="button"><i data-lucide="target"></i>' + (isFocused ? '取消专注' : '设为专注') + '</button>' : '') + (idea.status === 'done' ? '<button class="button ghost-button" data-action="move" data-status="try" data-id="' + idea.id + '" type="button">重新打开</button>' : '<button class="button ghost-button" data-action="done" data-id="' + idea.id + '" type="button"><i data-lucide="check"></i>标记完成</button>') + '</div></section></aside></form>';
  }

  function renderNavigation() {
    const route = state.route;
    const detailIdea = route.page === 'idea' ? ideaById(route.id) : null;
    const active = detailIdea ? detailIdea.status : route.page;
    const title = detailIdea ? STATUS_LABELS[detailIdea.status] + ' / 想法详情' : {
      all: '全部想法', inbox: '收件箱', try: '准备尝试', later: '以后再说', done: '已完成', weekly: '本周复盘'
    }[route.page];
    $$('.nav-item[data-view]').forEach((item) => item.classList.toggle('is-active', item.dataset.view === active));
    $$('[data-count]').forEach((count) => {
      count.textContent = count.dataset.count === 'all' ? state.ideas.length : statusCount(count.dataset.count);
    });
    $('#breadcrumbTitle').textContent = title || '全部想法';
    document.title = (title || '全部想法') + ' · 想法台';
  }

  function renderIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
  }

  function renderApp() {
    const container = $('#pageContent');
    const route = state.route;
    let markup = '';
    if (route.page === 'idea') {
      const idea = ideaById(route.id);
      if (!idea) {
        navigate('all');
        return;
      }
      markup = renderDetailPage(idea);
    } else if (route.page === 'inbox') markup = renderInboxPage();
    else if (route.page === 'try') markup = renderTryPage();
    else if (route.page === 'later') markup = renderLaterPage();
    else if (route.page === 'done') markup = renderDonePage();
    else if (route.page === 'weekly') markup = renderWeeklyPage();
    else markup = renderAllPage();
    container.innerHTML = markup;
    renderNavigation();
    renderIcons();
  }

  function openCapture() {
    $('#captureModal').hidden = false;
    $('#captureTitleInput').focus();
  }

  function closeCapture() {
    $('#captureModal').hidden = true;
    $('#captureForm').reset();
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
  }

  function createIdea(form, quick) {
    const formData = new FormData(form);
    const now = new Date().toISOString();
    const idea = {
      id: uid(),
      title: String(formData.get('title') || '').trim(),
      problem: quick ? '' : String(formData.get('problem') || '').trim(),
      audience: '',
      mvp: '',
      nextAction: '',
      finishLine: '',
      status: quick ? 'inbox' : String(formData.get('status') || 'inbox'),
      tags: quick ? [] : String(formData.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
      interest: 3,
      value: 3,
      ease: 3,
      experimentStatus: 'not_started',
      experimentGoal: '',
      experimentResult: '',
      createdAt: now,
      updatedAt: now
    };
    state.ideas.unshift(idea);
    saveData('已保存新想法');
    if (quick) {
      form.reset();
      renderApp();
      showToast('已经放进收件箱');
    } else {
      closeCapture();
      navigate('idea/' + encodeURIComponent(idea.id));
      showToast('想法已放进工作区');
    }
  }

  function updateIdea(form) {
    const idea = ideaById(form.dataset.id);
    if (!idea) return;
    const formData = new FormData(form);
    const oldStatus = idea.status;
    idea.title = String(formData.get('title') || '').trim();
    idea.problem = String(formData.get('problem') || '').trim();
    idea.audience = String(formData.get('audience') || '').trim();
    idea.mvp = String(formData.get('mvp') || '').trim();
    idea.nextAction = String(formData.get('nextAction') || '').trim();
    idea.finishLine = String(formData.get('finishLine') || '').trim();
    idea.status = String(formData.get('status') || 'inbox');
    idea.tags = String(formData.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
    idea.interest = Number(formData.get('interest')) || 1;
    idea.value = Number(formData.get('value')) || 1;
    idea.ease = Number(formData.get('ease')) || 1;
    idea.experimentStatus = String(formData.get('experimentStatus') || 'not_started');
    idea.experimentGoal = String(formData.get('experimentGoal') || '').trim();
    idea.experimentResult = String(formData.get('experimentResult') || '').trim();
    idea.updatedAt = new Date().toISOString();
    if (oldStatus !== 'try' && idea.status === 'try') state.focusId = idea.id;
    if (state.focusId === idea.id && idea.status !== 'try') state.focusId = state.ideas.find((item) => item.status === 'try' && item.id !== idea.id)?.id || null;
    saveData('已保存修改');
    renderApp();
    showToast('这个想法已经更新');
  }

  function moveIdea(id, status) {
    const idea = ideaById(id);
    if (!idea) return;
    idea.status = status;
    idea.updatedAt = new Date().toISOString();
    if (status === 'try' && !state.focusId) state.focusId = id;
    if (state.focusId === id && status !== 'try') state.focusId = state.ideas.find((item) => item.status === 'try' && item.id !== id)?.id || null;
    saveData('已移动到' + STATUS_LABELS[status]);
    renderApp();
    showToast('已移动到' + STATUS_LABELS[status]);
  }

  function markDone(id) {
    const idea = ideaById(id);
    if (!idea) return;
    idea.status = 'done';
    idea.experimentStatus = 'completed';
    idea.updatedAt = new Date().toISOString();
    if (state.focusId === id) state.focusId = state.ideas.find((item) => item.status === 'try' && item.id !== id)?.id || null;
    saveData('已标记完成');
    if (state.route.page === 'idea') navigate('done');
    else renderApp();
    showToast('已完成当前阶段');
  }

  function toggleFocus(id) {
    const idea = ideaById(id);
    if (!idea || idea.status !== 'try') return;
    state.focusId = state.focusId === id ? null : id;
    saveData(state.focusId ? '已设为当前专注' : '已取消当前专注');
    renderApp();
  }

  function deleteIdea(id) {
    const idea = ideaById(id);
    if (!idea || !window.confirm('确定要删除“' + idea.title + '”吗？')) return;
    state.ideas = state.ideas.filter((item) => item.id !== id);
    if (state.focusId === id) state.focusId = state.ideas.find((item) => item.status === 'try')?.id || null;
    saveData('已删除这个想法');
    if (state.route.page === 'idea') navigate(idea.status);
    else renderApp();
    showToast('想法已删除');
  }

  function exportData() {
    const payload = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), ideas: state.ideas, focusId: state.focusId, review: state.review }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'idea-desk-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    link.click();
    URL.revokeObjectURL(url);
    showToast('备份文件已导出');
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.ideas)) throw new Error('invalid');
        state.ideas = parsed.ideas;
        state.focusId = parsed.focusId || state.ideas.find((idea) => idea.status === 'try')?.id || null;
        state.review = parsed.review || {};
        saveData('已导入备份');
        renderApp();
        showToast('已恢复 ' + state.ideas.length + ' 个想法');
      } catch (error) {
        showToast('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file);
  }

  function bindEvents() {
    $('#openCapture').addEventListener('click', openCapture);
    $('#closeCapture').addEventListener('click', closeCapture);
    $('#cancelCapture').addEventListener('click', closeCapture);
    $('#captureModal').addEventListener('click', (event) => {
      if (event.target === $('#captureModal')) closeCapture();
    });
    $('#captureForm').addEventListener('submit', (event) => {
      event.preventDefault();
      createIdea(event.currentTarget, false);
    });

    $('#pageContent').addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      const id = action.dataset.id;
      const type = action.dataset.action;
      if (type === 'capture') openCapture();
      if (type === 'open-idea') navigate('idea/' + encodeURIComponent(id));
      if (type === 'status-menu') {
        const menu = action.parentElement.querySelector('.status-menu');
        const willOpen = menu.hidden;
        $$('.status-menu').forEach((item) => { item.hidden = true; });
        $$('.quick-status').forEach((item) => { item.setAttribute('aria-expanded', 'false'); });
        menu.hidden = !willOpen;
        action.setAttribute('aria-expanded', String(willOpen));
      }
      if (type === 'move') moveIdea(id, action.dataset.status);
      if (type === 'done') markDone(id);
      if (type === 'focus') toggleFocus(id);
      if (type === 'delete') deleteIdea(id);
      if (type === 'clear-filter') {
        state.query = '';
        state.tag = 'all';
        renderApp();
      }
    });

    $('#pageContent').addEventListener('keydown', (event) => {
      const target = event.target.closest('[data-action="open-idea"]');
      if (target && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        navigate('idea/' + encodeURIComponent(target.dataset.id));
      }
    });

    $('#pageContent').addEventListener('submit', (event) => {
      event.preventDefault();
      if (event.target.id === 'quickCaptureForm') createIdea(event.target, true);
      if (event.target.id === 'detailForm') updateIdea(event.target);
      if (event.target.id === 'weeklyReviewForm') {
        const formData = new FormData(event.target);
        state.review = {
          wins: String(formData.get('wins') || '').trim(),
          learnings: String(formData.get('learnings') || '').trim(),
          next: String(formData.get('next') || '').trim()
        };
        saveData('已保存本周复盘');
        showToast('本周复盘已保存');
      }
    });

    $('#pageContent').addEventListener('input', (event) => {
      if (event.target.id === 'searchInput') {
        state.query = event.target.value;
        const results = $('#allResults');
        if (results) {
          results.innerHTML = allResultsMarkup();
          renderIcons();
        }
      }
      if (['interest', 'value', 'ease'].includes(event.target.name)) {
        const output = $('#' + event.target.name + 'Output');
        if (output) output.value = event.target.value;
        const form = event.target.closest('form');
        const formData = new FormData(form);
        const preview = scoreOf({
          interest: formData.get('interest'),
          value: formData.get('value'),
          ease: formData.get('ease')
        });
        const score = $('#detailScore');
        if (score) score.innerHTML = preview + '<small>/10</small>';
      }
    });

    $('#pageContent').addEventListener('change', (event) => {
      if (event.target.id === 'sortSelect') state.sort = event.target.value;
      else if (event.target.id === 'tagSelect') state.tag = event.target.value;
      else return;
      const results = $('#allResults');
      if (results) {
        results.innerHTML = allResultsMarkup();
        renderIcons();
      }
    });

    $('#openSidebar').addEventListener('click', () => $('#sidebar').classList.add('is-open'));
    $('#closeSidebar').addEventListener('click', () => $('#sidebar').classList.remove('is-open'));
    $('.side-nav').addEventListener('click', () => $('#sidebar').classList.remove('is-open'));
    $('#helpButton').addEventListener('click', () => { $('#shortcutsModal').hidden = false; });
    $('#closeShortcuts').addEventListener('click', () => { $('#shortcutsModal').hidden = true; });
    $('#shortcutsModal').addEventListener('click', (event) => {
      if (event.target === $('#shortcutsModal')) $('#shortcutsModal').hidden = true;
    });
    $('#exportData').addEventListener('click', exportData);
    $('#importDataButton').addEventListener('click', () => $('#importData').click());
    $('#importData').addEventListener('change', (event) => importData(event.target.files[0]));

    window.addEventListener('hashchange', () => {
      state.route = parseRoute();
      window.scrollTo(0, 0);
      renderApp();
    });

    document.addEventListener('keydown', (event) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        const form = $('#detailForm');
        if (form) {
          event.preventDefault();
          updateIdea(form);
        }
      }
      if (event.key === 'Escape') {
        if (!$('#captureModal').hidden) closeCapture();
        if (!$('#shortcutsModal').hidden) $('#shortcutsModal').hidden = true;
        $('#sidebar').classList.remove('is-open');
        if (state.route.page === 'idea') {
          const idea = ideaById(state.route.id);
          if (idea) navigate(idea.status);
        }
      }
      if (!typing && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        openCapture();
      }
      if (!typing && event.key === '/') {
        event.preventDefault();
        if (state.route.page !== 'all') {
          navigate('all');
          window.setTimeout(() => $('#searchInput')?.focus(), 80);
        } else {
          $('#searchInput')?.focus();
        }
      }
    });
  }

  bindEvents();
  state.route = parseRoute();
  if (!location.hash) location.hash = '#/all';
  renderApp();
})();
