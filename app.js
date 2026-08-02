(function () {
  'use strict';

  const STORAGE_KEY = 'idea-desk-v1';
  const ROUTES = ['all', 'inbox', 'try', 'later', 'done', 'weekly'];
  const STATUS_LABELS = { inbox: '收件箱', try: '准备尝试', later: '以后再说', done: '已完成' };
  const EXPERIMENT_LABELS = { not_started: '还没开始', in_progress: '进行中', completed: '已完成' };
  const NODE_STATUS_LABELS = { not_started: '未开始', in_progress: '进行中', completed: '已完成' };
  const PROJECT_FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md', 'csv', 'json', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip']);
  const MAX_PROJECT_FILE_BYTES = 50 * 1024 * 1024;
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

  function loadLocalData() {
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

  function dataPayload(source) {
    return {
      version: 3,
      ideas: source.ideas,
      focusId: source.focusId,
      review: source.review
    };
  }

  async function writeRemoteData(payload) {
    const response = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('remote write failed');
  }

  async function loadData() {
    const local = loadLocalData();
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (response.ok) {
        const parsed = await response.json();
        if (!parsed || !Array.isArray(parsed.ideas)) throw new Error('invalid remote state');
        const normalized = {
          ideas: parsed.ideas,
          focusId: parsed.focusId || parsed.ideas.find((idea) => idea.status === 'try')?.id || null,
          review: parsed.review || {}
        };
        let renumbered = false;
        normalized.ideas.forEach((idea) => {
          if (renumberProjectNodes(idea)) renumbered = true;
        });
        if (renumbered) await writeRemoteData(dataPayload(normalized));
        return { ...normalized, persistence: 'nas', renumbered };
      }
      if (response.status !== 404) throw new Error('remote read failed');
      local.ideas.forEach((idea) => renumberProjectNodes(idea));
      await writeRemoteData(dataPayload(local));
      return { ...local, persistence: 'nas', migrated: true };
    } catch (error) {
      return { ...local, persistence: 'local' };
    }
  }

  const initial = loadLocalData();
  const state = {
    ideas: initial.ideas,
    focusId: initial.focusId,
    review: initial.review,
    persistence: 'local',
    route: { page: 'all', id: null },
    query: '',
    tag: 'all',
    sort: 'updated'
  };
  const projectUi = {
    expandedNodes: new Set(),
    bulkIdeaId: null
  };
  const nodeDrag = {
    holdTimer: null,
    pointerId: null,
    startX: 0,
    startY: 0,
    offsetY: 0,
    ideaId: null,
    nodeId: null,
    parentNodeId: null,
    handle: null,
    source: null,
    container: null,
    placeholder: null,
    ghost: null,
    active: false
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

  let saveQueue = Promise.resolve();

  function saveData(message) {
    const payload = dataPayload(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    const status = $('#saveStatus');
    if (status) status.textContent = message || (state.persistence === 'nas' ? '已保存到 NAS' : '仅保存在本机');
    window.clearTimeout(saveData.timer);
    saveData.timer = window.setTimeout(() => {
      if (status) status.textContent = state.persistence === 'nas' ? '已保存到 NAS' : '仅保存在本机';
    }, 1800);
    saveQueue = saveQueue.then(async () => {
      try {
        await writeRemoteData(payload);
        state.persistence = 'nas';
      } catch (error) {
        state.persistence = 'local';
        if (status) status.textContent = '仅保存在本机';
        showToast('NAS 暂时不可用，已保存在本机');
      }
    });
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

  function formatTimestamp(iso) {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return '时间未知';
    return date.toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
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

  function projectNodesOf(idea) {
    if (!Array.isArray(idea.nodes)) idea.nodes = [];
    return idea.nodes;
  }

  function projectFilesOf(idea) {
    if (!Array.isArray(idea.files)) idea.files = [];
    return idea.files;
  }

  function formatFileSize(bytes) {
    const size = Number(bytes) || 0;
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return Math.round(size / 1024) + ' KB';
    return Math.round((size / 1024 / 1024) * 10) / 10 + ' MB';
  }

  function projectFileIcon(file) {
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension)) return 'image';
    if (['xls', 'xlsx', 'csv'].includes(extension)) return 'file-spreadsheet';
    if (['ppt', 'pptx'].includes(extension)) return 'presentation';
    if (['json', 'md', 'txt'].includes(extension)) return 'file-code-2';
    if (extension === 'zip') return 'archive';
    return 'file-text';
  }

  function aiProjectUrl(idea) {
    return location.origin + '/api/ideas/' + encodeURIComponent(idea.id) + '/context';
  }

  function projectFileMarkup(idea, file) {
    return '<div class="project-file-row"><div class="project-file-icon"><i data-lucide="' + projectFileIcon(file) + '"></i></div><div class="project-file-copy"><a href="' + escapeHTML(file.url) + '" download="' + escapeHTML(file.name || '项目资料') + '">' + escapeHTML(file.name || '未命名资料') + '</a><span>' + escapeHTML(formatFileSize(file.size)) + ' · ' + escapeHTML(formatTimestamp(file.uploadedAt || idea.updatedAt)) + '</span></div><a class="project-file-action" href="' + escapeHTML(file.url) + '" download="' + escapeHTML(file.name || '项目资料') + '" aria-label="下载' + escapeHTML(file.name || '项目资料') + '" data-tooltip="下载"><i data-lucide="download"></i></a><button class="project-file-action danger" data-action="remove-project-file" data-id="' + idea.id + '" data-file-id="' + file.id + '" type="button" aria-label="删除' + escapeHTML(file.name || '项目资料') + '" data-tooltip="删除"><i data-lucide="trash-2"></i></button></div>';
  }

  function projectMaterialsMarkup(idea) {
    const files = projectFilesOf(idea);
    const totalBytes = files.reduce((total, file) => total + (Number(file.size) || 0), 0);
    const fileRows = files.map((file) => projectFileMarkup(idea, file)).join('');
    return '<section class="editor-section project-materials-section"><div class="project-materials-head"><div class="editor-section-head"><span>02</span><div><h2>项目资料</h2><p>PRD、设计稿和开发资料统一保存在这里。</p></div></div><label class="button compact-button primary-button project-upload-button"><i data-lucide="upload"></i>上传资料<input data-project-files data-id="' + idea.id + '" type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip" multiple hidden /></label></div>' +
      '<div class="ai-project-entry"><div><span>AI 项目地址</span><input id="aiProjectUrl" value="' + escapeHTML(aiProjectUrl(idea)) + '" readonly /></div><button class="icon-button" data-action="copy-ai-project-url" data-id="' + idea.id + '" type="button" aria-label="复制 AI 项目地址" data-tooltip="复制地址"><i data-lucide="copy"></i></button></div>' +
      '<div class="project-files-drop" data-project-drop data-id="' + idea.id + '">' + (files.length ? '<div class="project-files-summary"><strong>' + files.length + ' 个文件</strong><span>' + escapeHTML(formatFileSize(totalBytes)) + '</span></div><div class="project-file-list">' + fileRows + '</div>' : '<div class="project-files-empty"><i data-lucide="files"></i><div><strong>还没有项目资料</strong><span>拖入文件，或使用上传按钮选择多个文件。</span></div></div>') + '<span class="project-upload-status" aria-live="polite"></span></div></section>';
  }

  function walkProjectNodes(nodes, callback) {
    (nodes || []).forEach((node) => {
      callback(node);
      walkProjectNodes(node.children, callback);
    });
  }

  function findProjectNode(idea, nodeId) {
    let match = null;
    walkProjectNodes(projectNodesOf(idea), (node) => {
      if (!match && node.id === nodeId) match = node;
    });
    return match;
  }

  function nextProjectNodeNumber(idea) {
    let highest = 0;
    walkProjectNodes(projectNodesOf(idea), (node) => {
      const match = /^P-(\d+)$/.exec(node.code || '');
      if (match) highest = Math.max(highest, Number(match[1]));
    });
    const nextNumber = Math.max(highest + 1, Number(idea.nodeSequence) || 1);
    idea.nodeSequence = nextNumber + 1;
    return nextNumber;
  }

  function autoNodeAction(node) {
    return node ? '执行 ' + node.code + '：' + node.title : '';
  }

  function renumberProjectNodes(idea, removedCodes) {
    const nodesByOldCode = new Map();
    const previousAction = idea.nextAction || '';
    let changed = false;
    let sequence = 1;
    walkProjectNodes(projectNodesOf(idea), (node) => {
      nodesByOldCode.set(node.code, node);
      const nextCode = 'P-' + String(sequence).padStart(3, '0');
      if (node.code !== nextCode) changed = true;
      node.code = nextCode;
      sequence += 1;
    });
    if (Number(idea.nodeSequence) !== sequence) changed = true;
    idea.nodeSequence = sequence;
    const actionMatch = /^执行 (P-\d+)：/.exec(idea.nextAction || '');
    if (actionMatch) {
      const currentNode = findProjectNode(idea, idea.currentNodeId);
      if (currentNode) idea.nextAction = autoNodeAction(currentNode);
      else if (removedCodes?.has(actionMatch[1])) idea.nextAction = '';
      else {
        const referencedNode = nodesByOldCode.get(actionMatch[1]);
        if (referencedNode) idea.nextAction = autoNodeAction(referencedNode);
      }
    }
    return changed || previousAction !== (idea.nextAction || '');
  }

  function createProjectNode(code, title) {
    const now = new Date().toISOString();
    return {
      id: 'node-' + uid(),
      code,
      title: title || '新节点',
      content: '',
      status: 'not_started',
      attachments: [],
      children: [],
      createdAt: now,
      updatedAt: now
    };
  }

  function projectNodeStats(idea) {
    const stats = { total: 0, completed: 0, inProgress: 0 };
    walkProjectNodes(projectNodesOf(idea), (node) => {
      stats.total += 1;
      if (node.status === 'completed') stats.completed += 1;
      if (node.status === 'in_progress') stats.inProgress += 1;
    });
    return stats;
  }

  function removeProjectNode(nodes, nodeId) {
    for (let index = 0; index < nodes.length; index += 1) {
      if (nodes[index].id === nodeId) return nodes.splice(index, 1)[0];
      const removed = removeProjectNode(nodes[index].children || [], nodeId);
      if (removed) return removed;
    }
    return null;
  }

  function projectNodeAttachmentMarkup(idea, node, attachment) {
    return '<figure class="node-attachment"><a href="' + escapeHTML(attachment.url) + '" target="_blank" rel="noopener"><img src="' + escapeHTML(attachment.url) + '" alt="' + escapeHTML(attachment.name || '节点截图') + '" /></a><figcaption><span>' + escapeHTML(attachment.name || '截图') + '</span><button data-action="remove-node-attachment" data-id="' + idea.id + '" data-node-id="' + node.id + '" data-attachment-id="' + attachment.id + '" type="button" aria-label="删除截图"><i data-lucide="x"></i></button></figcaption></figure>';
  }

  function projectNodeMarkup(idea, node, parentNodeId) {
    if (!Array.isArray(node.children)) node.children = [];
    if (!Array.isArray(node.attachments)) node.attachments = [];
    if (!NODE_STATUS_LABELS[node.status]) node.status = 'not_started';
    const expanded = projectUi.expandedNodes.has(node.id);
    const current = idea.currentNodeId === node.id;
    const statusOptions = Object.entries(NODE_STATUS_LABELS).map(([status, label]) =>
      '<option value="' + status + '"' + (node.status === status ? ' selected' : '') + '>' + label + '</option>'
    ).join('');
    const attachments = node.attachments.map((attachment) => projectNodeAttachmentMarkup(idea, node, attachment)).join('');
    const children = node.children.map((child) => projectNodeMarkup(idea, child, node.id)).join('');
    return '<article class="project-node node-status-' + (node.status || 'not_started') + (current ? ' is-current' : '') + '" data-node-id="' + node.id + '" data-parent-node-id="' + (parentNodeId || '') + '" data-node-code="' + escapeHTML(node.code) + '">' +
      '<div class="project-node-row"><button class="node-drag-handle" data-node-drag data-id="' + idea.id + '" data-node-id="' + node.id + '" data-parent-node-id="' + (parentNodeId || '') + '" type="button" aria-label="按住后上下拖动 ' + escapeHTML(node.code) + '" data-tooltip="按住拖动排序"><i data-lucide="grip-vertical"></i></button><button class="node-toggle" data-action="toggle-node" data-node-id="' + node.id + '" type="button" aria-label="' + (expanded ? '收起' : '展开') + escapeHTML(node.code) + '"><i data-lucide="chevron-' + (expanded ? 'down' : 'right') + '"></i></button><span class="node-code">' + escapeHTML(node.code) + '</span><input class="node-title-input" data-node-field="title" data-id="' + idea.id + '" data-node-id="' + node.id + '" value="' + escapeHTML(node.title || '') + '" maxlength="160" aria-label="' + escapeHTML(node.code) + ' 节点标题" /><select class="node-status-select" data-node-field="status" data-id="' + idea.id + '" data-node-id="' + node.id + '" aria-label="' + escapeHTML(node.code) + ' 节点状态">' + statusOptions + '</select><span class="node-child-count">' + node.children.length + ' 子节点</span><button class="node-icon-button current-node-button' + (current ? ' is-active' : '') + '" data-action="set-current-node" data-id="' + idea.id + '" data-node-id="' + node.id + '" type="button" aria-label="' + (current ? '取消当前执行节点' : '设为当前执行节点') + '" data-tooltip="' + (current ? '取消当前节点' : '设为当前节点') + '"><i data-lucide="' + (current ? 'circle-dot' : 'circle') + '"></i></button><button class="node-icon-button add-child-button" data-action="add-child-node" data-id="' + idea.id + '" data-node-id="' + node.id + '" type="button" aria-label="添加子节点" data-tooltip="添加子节点"><i data-lucide="list-plus"></i></button><button class="node-icon-button danger" data-action="delete-node" data-id="' + idea.id + '" data-node-id="' + node.id + '" type="button" aria-label="删除节点" data-tooltip="删除节点"><i data-lucide="trash-2"></i></button></div>' +
      '<div class="project-node-expanded"' + (expanded ? '' : ' hidden') + '><div class="project-node-body"><label><span>节点记录</span><textarea data-node-field="content" data-id="' + idea.id + '" data-node-id="' + node.id + '" rows="3" placeholder="记录说明、执行结果、AI 处理备注等">' + escapeHTML(node.content || '') + '</textarea></label><div class="node-attachments"><div class="node-attachments-head"><span>截图与图片</span><label class="node-upload-button"><i data-lucide="image-plus"></i>添加截图<input data-node-upload data-id="' + idea.id + '" data-node-id="' + node.id + '" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden /></label></div><div class="node-attachment-grid">' + (attachments || '<span class="node-attachment-empty">还没有截图</span>') + '</div></div></div>' +
      (children ? '<div class="project-node-children">' + children + '</div>' : '') + '</div></article>';
  }

  function projectTreeMarkup(idea) {
    const nodes = projectNodesOf(idea);
    const stats = projectNodeStats(idea);
    const progress = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
    const bulkOpen = projectUi.bulkIdeaId === idea.id;
    return '<section class="project-tree-section"><div class="project-tree-head"><div><p class="eyebrow">PROJECT NODES</p><h2>项目节点</h2><p>用连续编号拆解项目，AI 可以按编号记录进度或标记完成。</p></div><div class="project-tree-actions"><button class="button compact-button ghost-button" data-action="toggle-bulk-nodes" data-id="' + idea.id + '" type="button"><i data-lucide="clipboard-list"></i>批量录入</button><button class="button compact-button primary-button" data-action="add-root-node" data-id="' + idea.id + '" type="button"><i data-lucide="plus"></i>添加根节点</button></div></div>' +
      '<div class="project-node-summary"><div><strong>' + stats.completed + '</strong><span>/ ' + stats.total + ' 已完成</span></div><div class="node-progress-track"><span style="width:' + progress + '%"></span></div><span>' + stats.inProgress + ' 个进行中</span></div>' +
      '<div class="bulk-node-panel"' + (bulkOpen ? '' : ' hidden') + '><label for="bulkNodeInput">批量粘贴节点</label><p>每行一个节点；使用两个空格或 Tab 表示下一级。</p><textarea id="bulkNodeInput" rows="8" placeholder="产品范围\n  个人版页面\n    图片上传\n    图片预览\n  数据管理\n    删除与恢复"></textarea><div><button class="button compact-button ghost-button" data-action="toggle-bulk-nodes" data-id="' + idea.id + '" type="button">取消</button><button class="button compact-button primary-button" data-action="import-bulk-nodes" data-id="' + idea.id + '" type="button"><i data-lucide="import"></i>导入节点</button></div></div>' +
      '<div class="project-tree">' + (nodes.length ? nodes.map((node) => projectNodeMarkup(idea, node, null)).join('') : '<div class="project-tree-empty"><i data-lucide="list-tree"></i><div><strong>还没有项目节点</strong><span>添加一个根节点，或一次粘贴完整的项目清单。</span></div></div>') + '</div></section>';
  }

  function flatProjectNodes(idea) {
    const flattened = [];
    function append(nodes, depth) {
      (nodes || []).forEach((node) => {
        flattened.push({ node, depth });
        append(node.children, depth + 1);
      });
    }
    append(projectNodesOf(idea), 0);
    return flattened;
  }

  function executionWorkspaceMarkup(idea) {
    const nodes = flatProjectNodes(idea);
    const currentNode = findProjectNode(idea, idea.currentNodeId);
    const nodeOptions = nodes.map(({ node, depth }) =>
      '<option value="' + node.id + '"' + (idea.currentNodeId === node.id ? ' selected' : '') + '>' + '　'.repeat(depth) + escapeHTML(node.code + ' · ' + (node.title || '未命名节点')) + '</option>'
    ).join('');
    return '<section class="execution-workspace"><div class="editor-section-head execution-head"><span>05</span><div><h2>把它往前推一步</h2><p>当前行动、完成线和项目节点使用同一套执行结构。</p></div></div><div class="execution-fields"><div><label class="field-label" for="detailCurrentNode">当前执行节点</label><select class="text-input" id="detailCurrentNode" name="currentNodeId"' + (nodes.length ? '' : ' disabled') + '><option value="">' + (nodes.length ? '暂不指定' : '请先添加项目节点') + '</option>' + nodeOptions + '</select></div><div><label class="field-label" for="detailNextAction">下一步动作</label><input class="text-input input-large" id="detailNextAction" name="nextAction" value="' + escapeHTML(idea.nextAction) + '" placeholder="选择节点后自动生成，也可以补充说明" /></div><div><label class="field-label" for="detailFinishLine">完成线</label><textarea class="text-input" id="detailFinishLine" name="finishLine" rows="2">' + escapeHTML(idea.finishLine) + '</textarea></div></div>' +
      (currentNode ? '<div class="current-node-strip"><span class="node-code">' + escapeHTML(currentNode.code) + '</span><strong>' + escapeHTML(currentNode.title) + '</strong><span class="node-status-text ' + currentNode.status + '">' + NODE_STATUS_LABELS[currentNode.status || 'not_started'] + '</span></div>' : '') + projectTreeMarkup(idea) + '</section>';
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
      '<div class="row-bottom">' + tagsMarkup(idea.tags) + (idea.nextAction ? '<span class="row-next"><i data-lucide="arrow-right"></i>' + escapeHTML(idea.nextAction) + '</span>' : '') + '<span class="row-updated"><i data-lucide="clock-3"></i>更新于 ' + formatTimestamp(idea.updatedAt) + '</span></div></div>' +
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
      '<div class="toolbar"><label class="search-box" for="searchInput"><i data-lucide="search"></i><input id="searchInput" type="search" value="' + escapeHTML(state.query) + '" placeholder="搜索标题、问题或标签" autocomplete="off" /></label><div class="toolbar-selects">' +
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
      '<form id="detailForm" data-id="' + idea.id + '"><div class="editor-layout"><div class="editor-main">' +
      '<section class="editor-section"><div class="editor-section-head"><span>01</span><div><h2>想法本身</h2><p>先说清楚问题和最小版本。</p></div></div><div class="field-group"><label class="field-label" for="detailTitle">想法标题 <span>*</span></label><input class="text-input input-large" id="detailTitle" name="title" value="' + escapeHTML(idea.title) + '" maxlength="80" required /></div><div class="field-group"><label class="field-label" for="detailProblem">它在解决什么问题</label><textarea class="text-input" id="detailProblem" name="problem" rows="4">' + escapeHTML(idea.problem) + '</textarea></div><div class="form-row"><div><label class="field-label" for="detailAudience">可能会需要的人</label><textarea class="text-input" id="detailAudience" name="audience" rows="3">' + escapeHTML(idea.audience) + '</textarea></div><div><label class="field-label" for="detailMvp">我能做出的最小版本</label><textarea class="text-input" id="detailMvp" name="mvp" rows="3">' + escapeHTML(idea.mvp) + '</textarea></div></div></section>' + projectMaterialsMarkup(idea) +
      '</div>' +
      '<aside class="editor-rail"><section class="rail-section"><div class="editor-section-head"><span>03</span><div><h2>投入判断</h2><p>用同一把尺子比较想法。</p></div></div><div class="score-grid"><div class="score-field"><label for="interestRange">兴趣 <output id="interestOutput">' + idea.interest + '</output>/5</label><input id="interestRange" name="interest" type="range" min="1" max="5" value="' + idea.interest + '" /></div><div class="score-field"><label for="valueRange">价值 <output id="valueOutput">' + idea.value + '</output>/5</label><input id="valueRange" name="value" type="range" min="1" max="5" value="' + idea.value + '" /></div><div class="score-field"><label for="easeRange">易验证 <output id="easeOutput">' + idea.ease + '</output>/5</label><input id="easeRange" name="ease" type="range" min="1" max="5" value="' + idea.ease + '" /></div></div><div class="score-total"><span>验证优先级</span><strong id="detailScore">' + scoreOf(idea) + '<small>/10</small></strong></div></section>' +
      '<section class="rail-section experiment-box"><div class="editor-section-head"><span>04</span><div><h2>48 小时实验</h2><p>先证明它值得继续。</p></div></div><div class="field-group"><label class="field-label" for="experimentGoal">我要验证什么</label><textarea class="text-input" id="experimentGoal" name="experimentGoal" rows="3">' + escapeHTML(idea.experimentGoal) + '</textarea></div><div class="field-group"><label class="field-label" for="experimentResult">结果记录</label><textarea class="text-input" id="experimentResult" name="experimentResult" rows="3">' + escapeHTML(idea.experimentResult) + '</textarea></div><label class="field-label" for="experimentStatus">实验状态</label><select class="text-input" id="experimentStatus" name="experimentStatus"><option value="not_started"' + (idea.experimentStatus === 'not_started' ? ' selected' : '') + '>还没开始</option><option value="in_progress"' + (idea.experimentStatus === 'in_progress' ? ' selected' : '') + '>进行中</option><option value="completed"' + (idea.experimentStatus === 'completed' ? ' selected' : '') + '>已完成</option></select></section>' +
      '<section class="rail-section"><div class="form-row"><div><label class="field-label" for="detailStatus">所在页面</label><select class="text-input" id="detailStatus" name="status"><option value="inbox"' + (idea.status === 'inbox' ? ' selected' : '') + '>收件箱</option><option value="try"' + (idea.status === 'try' ? ' selected' : '') + '>准备尝试</option><option value="later"' + (idea.status === 'later' ? ' selected' : '') + '>以后再说</option><option value="done"' + (idea.status === 'done' ? ' selected' : '') + '>已完成</option></select></div><div><label class="field-label" for="detailTags">标签</label><input class="text-input" id="detailTags" name="tags" value="' + escapeHTML(idea.tags.join(', ')) + '" /></div></div><div class="editor-actions"><button class="button primary-button" type="submit"><i data-lucide="save"></i>保存修改</button>' + (idea.status === 'try' ? '<button class="button ghost-button" data-action="focus" data-id="' + idea.id + '" type="button"><i data-lucide="target"></i>' + (isFocused ? '取消专注' : '设为专注') + '</button>' : '') + (idea.status === 'done' ? '<button class="button ghost-button" data-action="move" data-status="try" data-id="' + idea.id + '" type="button">重新打开</button>' : '<button class="button ghost-button" data-action="done" data-id="' + idea.id + '" type="button"><i data-lucide="check"></i>标记完成</button>') + '</div></section></aside></div>' + executionWorkspaceMarkup(idea) + '</form>';
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
      files: [],
      nodes: [],
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
    const currentNodeId = String(formData.get('currentNodeId') || '');
    idea.currentNodeId = findProjectNode(idea, currentNodeId) ? currentNodeId : null;
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

  function addProjectNode(ideaId, parentNodeId) {
    const idea = ideaById(ideaId);
    if (!idea) return;
    const number = nextProjectNodeNumber(idea);
    const node = createProjectNode('P-' + String(number).padStart(3, '0'), '新节点');
    if (parentNodeId) {
      const parentNode = findProjectNode(idea, parentNodeId);
      if (!parentNode) return;
      if (!Array.isArray(parentNode.children)) parentNode.children = [];
      parentNode.children.push(node);
      projectUi.expandedNodes.add(parentNode.id);
    } else {
      projectNodesOf(idea).push(node);
    }
    projectUi.expandedNodes.add(node.id);
    idea.updatedAt = new Date().toISOString();
    saveData('已添加项目节点');
    renderApp();
    window.setTimeout(() => $('[data-node-id="' + node.id + '"] .node-title-input')?.focus(), 0);
  }

  function setCurrentProjectNode(ideaId, nodeId) {
    const idea = ideaById(ideaId);
    const node = idea ? findProjectNode(idea, nodeId) : null;
    if (!idea || !node) return;
    const willClear = idea.currentNodeId === node.id;
    idea.currentNodeId = willClear ? null : node.id;
    if (willClear && (idea.nextAction || '').startsWith('执行 ' + node.code + '：')) idea.nextAction = '';
    if (!willClear) idea.nextAction = autoNodeAction(node);
    idea.updatedAt = new Date().toISOString();
    saveData(willClear ? '已取消当前执行节点' : '已设置当前执行节点');
    renderApp();
    showToast(willClear ? '已取消当前执行节点' : node.code + ' 已设为下一步');
  }

  function deleteProjectNode(ideaId, nodeId) {
    const idea = ideaById(ideaId);
    const node = idea ? findProjectNode(idea, nodeId) : null;
    if (!idea || !node) return;
    let nodeCount = 0;
    walkProjectNodes([node], () => { nodeCount += 1; });
    if (!window.confirm('确定删除 ' + node.code + ' 以及它的 ' + (nodeCount - 1) + ' 个子节点吗？')) return;
    const removed = removeProjectNode(projectNodesOf(idea), nodeId);
    if (!removed) return;
    let removedCurrentNode = false;
    const removedCodes = new Set();
    walkProjectNodes([removed], (item) => {
      if (idea.currentNodeId === item.id) removedCurrentNode = true;
      removedCodes.add(item.code);
      (item.attachments || []).forEach((attachment) => deleteUploadedFile(attachment.url));
      projectUi.expandedNodes.delete(item.id);
    });
    if (removedCurrentNode) idea.currentNodeId = null;
    renumberProjectNodes(idea, removedCodes);
    idea.updatedAt = new Date().toISOString();
    saveData('已删除项目节点');
    renderApp();
    showToast('项目节点已删除');
  }

  function parseBulkProjectNodes(idea, input) {
    let nextNumber = nextProjectNodeNumber(idea);
    const roots = [];
    const stack = [];
    input.split(/\r?\n/).forEach((line) => {
      if (!line.trim()) return;
      const leading = line.match(/^[\t ]*/)?.[0] || '';
      const tabDepth = (leading.match(/\t/g) || []).length;
      const spaceDepth = Math.floor(leading.replace(/\t/g, '').length / 2);
      const requestedDepth = tabDepth + spaceDepth;
      const depth = Math.min(requestedDepth, stack.length);
      const title = line.trim().replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '').trim();
      if (!title) return;
      const node = createProjectNode('P-' + String(nextNumber).padStart(3, '0'), title);
      nextNumber += 1;
      if (depth === 0) roots.push(node);
      else stack[depth - 1].children.push(node);
      stack[depth] = node;
      stack.length = depth + 1;
    });
    idea.nodeSequence = nextNumber;
    return roots;
  }

  function importBulkProjectNodes(ideaId) {
    const idea = ideaById(ideaId);
    const input = $('#bulkNodeInput');
    if (!idea || !input || !input.value.trim()) return;
    const nodes = parseBulkProjectNodes(idea, input.value);
    if (!nodes.length) {
      showToast('没有识别到可导入的节点');
      return;
    }
    projectNodesOf(idea).push(...nodes);
    nodes.forEach((node) => projectUi.expandedNodes.add(node.id));
    projectUi.bulkIdeaId = null;
    idea.updatedAt = new Date().toISOString();
    saveData('已批量导入项目节点');
    renderApp();
    showToast('已导入 ' + nodes.reduce((count, node) => {
      let total = 0;
      walkProjectNodes([node], () => { total += 1; });
      return count + total;
    }, 0) + ' 个节点');
  }

  function updateProjectNodeField(input) {
    const idea = ideaById(input.dataset.id);
    const node = idea ? findProjectNode(idea, input.dataset.nodeId) : null;
    if (!idea || !node) return;
    const field = input.dataset.nodeField;
    if (field === 'status' && !NODE_STATUS_LABELS[input.value]) return;
    node[field] = field === 'title' ? input.value.trim() || '未命名节点' : input.value.trim();
    if (field === 'title' && idea.currentNodeId === node.id) {
      idea.nextAction = autoNodeAction(node);
      const nextActionInput = $('#detailNextAction');
      if (nextActionInput) nextActionInput.value = idea.nextAction;
    }
    node.updatedAt = new Date().toISOString();
    idea.updatedAt = node.updatedAt;
    saveData('已保存 ' + node.code);
    if (field === 'status') renderApp();
  }

  function projectNodeSiblings(idea, parentNodeId) {
    if (!parentNodeId) return projectNodesOf(idea);
    const parentNode = findProjectNode(idea, parentNodeId);
    if (!parentNode) return null;
    if (!Array.isArray(parentNode.children)) parentNode.children = [];
    return parentNode.children;
  }

  function moveProjectNode(ideaId, nodeId, parentNodeId, destinationIndex) {
    const idea = ideaById(ideaId);
    const siblings = idea ? projectNodeSiblings(idea, parentNodeId) : null;
    if (!idea || !siblings) return;
    const sourceIndex = siblings.findIndex((node) => node.id === nodeId);
    if (sourceIndex < 0) return;
    const [node] = siblings.splice(sourceIndex, 1);
    const nextIndex = Math.max(0, Math.min(Number(destinationIndex) || 0, siblings.length));
    siblings.splice(nextIndex, 0, node);
    if (sourceIndex === nextIndex) return;
    renumberProjectNodes(idea);
    const now = new Date().toISOString();
    node.updatedAt = now;
    idea.updatedAt = now;
    saveData('已调整节点顺序');
    renderApp();
    showToast(node.code + ' 已移动到新位置');
  }

  function clearNodeDragTimer() {
    if (!nodeDrag.holdTimer) return;
    window.clearTimeout(nodeDrag.holdTimer);
    nodeDrag.holdTimer = null;
  }

  function resetNodeDrag() {
    clearNodeDragTimer();
    nodeDrag.handle?.classList.remove('is-pressing');
    nodeDrag.source?.classList.remove('is-dragging-source');
    nodeDrag.placeholder?.remove();
    nodeDrag.ghost?.remove();
    document.body.classList.remove('is-node-dragging');
    Object.assign(nodeDrag, {
      pointerId: null,
      ideaId: null,
      nodeId: null,
      parentNodeId: null,
      handle: null,
      source: null,
      container: null,
      placeholder: null,
      ghost: null,
      active: false
    });
  }

  function beginNodeDrag() {
    const source = nodeDrag.handle?.closest('.project-node');
    const row = source?.querySelector(':scope > .project-node-row');
    if (!source || !row || !source.parentElement) {
      resetNodeDrag();
      return;
    }
    const rect = row.getBoundingClientRect();
    const placeholder = document.createElement('div');
    placeholder.className = 'project-node-drop-placeholder';
    placeholder.style.height = rect.height + 'px';
    const ghost = row.cloneNode(true);
    ghost.className = 'project-node-row project-node-drag-ghost';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.width = rect.width + 'px';
    ghost.querySelectorAll('input, select, button').forEach((control) => { control.disabled = true; });
    source.before(placeholder);
    source.classList.add('is-dragging-source');
    nodeDrag.handle.classList.remove('is-pressing');
    document.body.append(ghost);
    document.body.classList.add('is-node-dragging');
    Object.assign(nodeDrag, {
      source,
      container: source.parentElement,
      placeholder,
      ghost,
      offsetY: Math.max(0, Math.min(nodeDrag.startY - rect.top, rect.height)),
      active: true
    });
  }

  function startNodeDrag(event, handle) {
    if (event.button !== 0 || nodeDrag.pointerId !== null) return;
    event.preventDefault();
    Object.assign(nodeDrag, {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      ideaId: handle.dataset.id,
      nodeId: handle.dataset.nodeId,
      parentNodeId: handle.dataset.parentNodeId || null,
      handle
    });
    handle.classList.add('is-pressing');
    nodeDrag.holdTimer = window.setTimeout(beginNodeDrag, 280);
  }

  function updateNodeDrag(event) {
    if (event.pointerId !== nodeDrag.pointerId) return;
    if (!nodeDrag.active) {
      if (Math.hypot(event.clientX - nodeDrag.startX, event.clientY - nodeDrag.startY) > 7) resetNodeDrag();
      return;
    }
    event.preventDefault();
    nodeDrag.ghost.style.top = (event.clientY - nodeDrag.offsetY) + 'px';
    if (event.clientY < 72) window.scrollBy(0, -12);
    else if (event.clientY > window.innerHeight - 72) window.scrollBy(0, 12);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.project-node');
    if (!target || target === nodeDrag.source || target.parentElement !== nodeDrag.container) return;
    const row = target.querySelector(':scope > .project-node-row');
    if (!row) return;
    const rect = row.getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) target.before(nodeDrag.placeholder);
    else target.after(nodeDrag.placeholder);
  }

  function finishNodeDrag(event, cancelled) {
    if (event && event.pointerId !== nodeDrag.pointerId) return;
    if (!nodeDrag.active || cancelled) {
      resetNodeDrag();
      return;
    }
    const ideaId = nodeDrag.ideaId;
    const nodeId = nodeDrag.nodeId;
    const parentNodeId = nodeDrag.parentNodeId;
    let destinationIndex = 0;
    Array.from(nodeDrag.container.children).some((element) => {
      if (element === nodeDrag.placeholder) return true;
      if (element.matches('.project-node') && element !== nodeDrag.source) destinationIndex += 1;
      return false;
    });
    resetNodeDrag();
    moveProjectNode(ideaId, nodeId, parentNodeId, destinationIndex);
  }

  function fileExtension(file) {
    return String(file.name || '').split('.').pop().toLowerCase();
  }

  async function uploadFileToNas(file) {
    const response = await fetch('/api/uploads?name=' + encodeURIComponent(file.name), {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    });
    if (!response.ok) throw new Error('upload failed');
    return response.json();
  }

  async function uploadProjectFiles(ideaId, fileList, input) {
    const idea = ideaById(ideaId);
    const files = Array.from(fileList || []);
    if (!idea || !files.length) return;
    const accepted = files.filter((file) => PROJECT_FILE_EXTENSIONS.has(fileExtension(file)) && file.size > 0 && file.size <= MAX_PROJECT_FILE_BYTES);
    const rejected = files.length - accepted.length;
    if (!accepted.length) {
      showToast('文件格式不支持，或单个文件超过 50 MB');
      if (input) input.value = '';
      return;
    }
    const status = $('.project-upload-status');
    let uploaded = 0;
    let failed = rejected;
    for (let index = 0; index < accepted.length; index += 1) {
      if (status) status.textContent = '正在上传 ' + (index + 1) + ' / ' + accepted.length;
      try {
        const file = await uploadFileToNas(accepted[index]);
        projectFilesOf(idea).push({ id: 'file-' + uid(), ...file });
        uploaded += 1;
      } catch (error) {
        failed += 1;
      }
    }
    if (uploaded) {
      idea.updatedAt = new Date().toISOString();
      saveData('项目资料已上传');
      renderApp();
    } else if (status) {
      status.textContent = '';
    }
    if (input) input.value = '';
    showToast(uploaded + ' 个文件已上传' + (failed ? '，' + failed + ' 个失败' : ''));
  }

  function removeProjectFile(ideaId, fileId) {
    const idea = ideaById(ideaId);
    const file = idea ? projectFilesOf(idea).find((item) => item.id === fileId) : null;
    if (!idea || !file || !window.confirm('确定删除“' + file.name + '”吗？')) return;
    idea.files = projectFilesOf(idea).filter((item) => item.id !== fileId);
    deleteUploadedFile(file.url);
    idea.updatedAt = new Date().toISOString();
    saveData('已删除项目资料');
    renderApp();
    showToast('项目资料已删除');
  }

  async function copyAiProjectUrl(ideaId) {
    const idea = ideaById(ideaId);
    if (!idea) return;
    const url = aiProjectUrl(idea);
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch (error) {
      const input = $('#aiProjectUrl');
      if (input) {
        input.focus();
        input.select();
        input.setSelectionRange(0, input.value.length);
        copied = document.execCommand('copy');
      }
    }
    showToast(copied ? 'AI 项目地址已复制' : '地址已选中，请复制');
  }

  async function uploadProjectNodeImage(input) {
    const file = input.files?.[0];
    const idea = ideaById(input.dataset.id);
    const node = idea ? findProjectNode(idea, input.dataset.nodeId) : null;
    if (!file || !idea || !node) return;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      showToast('请选择 PNG、JPG、GIF 或 WebP 图片');
      input.value = '';
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      showToast('单张图片不能超过 12 MB');
      input.value = '';
      return;
    }
    const status = $('#saveStatus');
    if (status) status.textContent = '正在上传截图...';
    try {
      const attachment = await uploadFileToNas(file);
      if (!Array.isArray(node.attachments)) node.attachments = [];
      node.attachments.push({ id: 'attachment-' + uid(), ...attachment });
      node.updatedAt = new Date().toISOString();
      idea.updatedAt = node.updatedAt;
      saveData('截图已上传');
      renderApp();
      showToast('截图已添加到 ' + node.code);
    } catch (error) {
      if (status) status.textContent = state.persistence === 'nas' ? '已保存到 NAS' : '仅保存在本机';
      showToast('截图上传失败');
    } finally {
      input.value = '';
    }
  }

  function deleteUploadedFile(url) {
    if (!url || !url.startsWith('/uploads/')) return;
    fetch('/api/uploads/' + encodeURIComponent(url.split('/').pop()), { method: 'DELETE' }).catch(() => {});
  }

  function removeProjectNodeAttachment(ideaId, nodeId, attachmentId) {
    const idea = ideaById(ideaId);
    const node = idea ? findProjectNode(idea, nodeId) : null;
    if (!idea || !node || !Array.isArray(node.attachments)) return;
    const attachment = node.attachments.find((item) => item.id === attachmentId);
    node.attachments = node.attachments.filter((item) => item.id !== attachmentId);
    deleteUploadedFile(attachment?.url);
    node.updatedAt = new Date().toISOString();
    idea.updatedAt = node.updatedAt;
    saveData('已删除节点截图');
    renderApp();
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
    projectFilesOf(idea).forEach((file) => deleteUploadedFile(file.url));
    walkProjectNodes(projectNodesOf(idea), (node) => {
      (node.attachments || []).forEach((attachment) => deleteUploadedFile(attachment.url));
    });
    state.ideas = state.ideas.filter((item) => item.id !== id);
    if (state.focusId === id) state.focusId = state.ideas.find((item) => item.status === 'try')?.id || null;
    saveData('已删除这个想法');
    if (state.route.page === 'idea') navigate(idea.status);
    else renderApp();
    showToast('想法已删除');
  }

  function exportData() {
    const payload = JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), ideas: state.ideas, focusId: state.focusId, review: state.review }, null, 2);
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

    $('#pageContent').addEventListener('pointerdown', (event) => {
      const handle = event.target.closest('[data-node-drag]');
      if (handle) startNodeDrag(event, handle);
    });

    $('#pageContent').addEventListener('contextmenu', (event) => {
      if (event.target.closest('[data-node-drag]')) event.preventDefault();
    });

    document.addEventListener('pointermove', updateNodeDrag, { passive: false });
    document.addEventListener('pointerup', (event) => finishNodeDrag(event, false));
    document.addEventListener('pointercancel', (event) => finishNodeDrag(event, true));

    $('#pageContent').addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      const id = action.dataset.id;
      const type = action.dataset.action;
      if (type === 'capture') openCapture();
      if (type === 'open-idea') navigate('idea/' + encodeURIComponent(id));
      if (type === 'toggle-node') {
        if (projectUi.expandedNodes.has(action.dataset.nodeId)) projectUi.expandedNodes.delete(action.dataset.nodeId);
        else projectUi.expandedNodes.add(action.dataset.nodeId);
        renderApp();
      }
      if (type === 'add-root-node') addProjectNode(id, null);
      if (type === 'add-child-node') addProjectNode(id, action.dataset.nodeId);
      if (type === 'set-current-node') setCurrentProjectNode(id, action.dataset.nodeId);
      if (type === 'delete-node') deleteProjectNode(id, action.dataset.nodeId);
      if (type === 'toggle-bulk-nodes') {
        projectUi.bulkIdeaId = projectUi.bulkIdeaId === id ? null : id;
        renderApp();
        if (projectUi.bulkIdeaId) window.setTimeout(() => $('#bulkNodeInput')?.focus(), 0);
      }
      if (type === 'import-bulk-nodes') importBulkProjectNodes(id);
      if (type === 'remove-node-attachment') removeProjectNodeAttachment(id, action.dataset.nodeId, action.dataset.attachmentId);
      if (type === 'remove-project-file') removeProjectFile(id, action.dataset.fileId);
      if (type === 'copy-ai-project-url') copyAiProjectUrl(id);
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
      if (event.target.id === 'detailCurrentNode') {
        const idea = ideaById(event.target.closest('form')?.dataset.id);
        const node = idea ? findProjectNode(idea, event.target.value) : null;
        const nextActionInput = $('#detailNextAction');
        if (nextActionInput) nextActionInput.value = autoNodeAction(node);
        return;
      }
      if (event.target.dataset.nodeField) {
        updateProjectNodeField(event.target);
        return;
      }
      if (event.target.matches('[data-node-upload]')) {
        uploadProjectNodeImage(event.target);
        return;
      }
      if (event.target.matches('[data-project-files]')) {
        uploadProjectFiles(event.target.dataset.id, event.target.files, event.target);
        return;
      }
      if (event.target.id === 'sortSelect') state.sort = event.target.value;
      else if (event.target.id === 'tagSelect') state.tag = event.target.value;
      else return;
      const results = $('#allResults');
      if (results) {
        results.innerHTML = allResultsMarkup();
        renderIcons();
      }
    });

    $('#pageContent').addEventListener('dragover', (event) => {
      const dropZone = event.target.closest('[data-project-drop]');
      if (!dropZone) return;
      event.preventDefault();
      dropZone.classList.add('is-dragging');
    });

    $('#pageContent').addEventListener('dragleave', (event) => {
      const dropZone = event.target.closest('[data-project-drop]');
      if (dropZone) dropZone.classList.remove('is-dragging');
    });

    $('#pageContent').addEventListener('drop', (event) => {
      const dropZone = event.target.closest('[data-project-drop]');
      if (!dropZone) return;
      event.preventDefault();
      dropZone.classList.remove('is-dragging');
      uploadProjectFiles(dropZone.dataset.id, event.dataTransfer?.files);
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
        if (nodeDrag.pointerId !== null) finishNodeDrag(null, true);
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

  async function initializeData() {
    const stored = await loadData();
    state.ideas = stored.ideas;
    state.focusId = stored.focusId;
    state.review = stored.review;
    state.persistence = stored.persistence;
    renderApp();
    const status = $('#saveStatus');
    if (status) status.textContent = state.persistence === 'nas' ? '已保存到 NAS' : '仅保存在本机';
    if (stored.migrated) showToast('本机数据已同步到 NAS');
    else if (stored.renumbered) showToast('项目节点编号已自动整理');
  }

  bindEvents();
  state.route = parseRoute();
  if (!location.hash) location.hash = '#/all';
  $('#pageContent').innerHTML = '<div class="page-loading"><i data-lucide="database"></i><span>正在读取 NAS 数据...</span></div>';
  renderIcons();
  initializeData();
})();
