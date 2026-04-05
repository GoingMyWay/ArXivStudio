type LlmProvider = 'chatgpt' | 'claude' | 'kimi' | 'deepseek' | 'glm' | 'gemini';

type LlmProfile = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

type LlmProfiles = Record<LlmProvider, LlmProfile>;

type AppConfig = {
  zoteroId: string;
  zoteroKey: string;
  includePath: string;
  arxivCategories: string;
  maxResults: number;
  feishuWebhook: string;
  feishuSecret: string;
  dailyEnabled: boolean;
  dailyTime: string;
  llmProvider: LlmProvider;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  llmProfiles: LlmProfiles;
};

type RecommendationPaper = {
  title: string;
  abstract: string;
  authors: string[];
  url: string;
  pdf_url: string;
  score: number;
  published: string;
};

type RecommendationResult = {
  date: string;
  corpus_size: number;
  candidate_size: number;
  include_path?: string;
  zotero_total_raw_count?: number;
  zotero_with_abstract_count?: number;
  zotero_after_filter_count?: number;
  arxiv_recent_dates?: Record<string, string>;
  papers: RecommendationPaper[];
  warning?: string;
  zotero_items_raw?: Array<{
    title: string;
    has_abstract: boolean;
    added_date: string;
    paths: string[];
  }>;
  arxiv_candidates_raw?: Array<{
    title: string;
    published: string;
    url: string;
  }>;
};

export {};

declare global {
  interface Window {
    arxivStudio: {
      getConfig: () => Promise<AppConfig>;
      saveConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>;
      loadConfigFromFile: (filePath?: string) => Promise<AppConfig>;
      runRecommendation: () => Promise<RecommendationResult>;
      testFeishu: () => Promise<{ ok: boolean }>;
      chat: (message: string) => Promise<string>;
    };
  }
}

type ConfigPatch = AppConfig;
type ConfigKey = keyof ConfigPatch;
type SetupChecklistItem = {
  badge: string;
  title: string;
  detail: string;
  ready: boolean;
};

type LlmProviderPreset = {
  label: string;
  baseUrl: string;
  modelPlaceholder: string;
  helpText: string;
};

const LLM_PROVIDER_PRESETS: Record<LlmProvider, LlmProviderPreset> = {
  chatgpt: {
    label: 'ChatGPT / OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelPlaceholder: '例如 gpt-4o-mini',
    helpText: 'OpenAI 兼容接口，会请求 /chat/completions。'
  },
  claude: {
    label: 'Claude / Anthropic',
    baseUrl: 'https://api.anthropic.com',
    modelPlaceholder: '填写可用的 Claude 模型名',
    helpText: 'Anthropic 原生接口，会请求 /v1/messages。'
  },
  kimi: {
    label: 'Kimi / Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    modelPlaceholder: '填写可用的 Kimi 模型名',
    helpText: '按 OpenAI 兼容接口调用，通常使用 Moonshot 的 v1 地址。'
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    modelPlaceholder: '填写可用的 DeepSeek 模型名',
    helpText: '按 OpenAI 兼容接口调用，会请求 /chat/completions。'
  },
  glm: {
    label: 'GLM / 智谱',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelPlaceholder: '填写可用的 GLM 模型名',
    helpText: '按 OpenAI 兼容接口调用，建议使用智谱 v4 地址。'
  },
  gemini: {
    label: 'Gemini / Google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelPlaceholder: '填写可用的 Gemini 模型名',
    helpText: 'Gemini 原生接口，会请求 /models/{model}:generateContent。'
  }
};

const PROVIDERS = Object.keys(LLM_PROVIDER_PRESETS) as LlmProvider[];
const SIDEBAR_COLLAPSED_KEY = 'arxiv-studio.sidebar-collapsed';

function createDefaultLlmProfiles(): LlmProfiles {
  return {
    chatgpt: { apiKey: '', baseUrl: LLM_PROVIDER_PRESETS.chatgpt.baseUrl, model: '' },
    claude: { apiKey: '', baseUrl: LLM_PROVIDER_PRESETS.claude.baseUrl, model: '' },
    kimi: { apiKey: '', baseUrl: LLM_PROVIDER_PRESETS.kimi.baseUrl, model: '' },
    deepseek: { apiKey: '', baseUrl: LLM_PROVIDER_PRESETS.deepseek.baseUrl, model: '' },
    glm: { apiKey: '', baseUrl: LLM_PROVIDER_PRESETS.glm.baseUrl, model: '' },
    gemini: { apiKey: '', baseUrl: LLM_PROVIDER_PRESETS.gemini.baseUrl, model: '' }
  };
}

let currentProvider: LlmProvider = 'chatgpt';
let providerProfiles: LlmProfiles = createDefaultLlmProfiles();
let toastTimer: number | null = null;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element not found: ${id}`);
  }
  return element as T;
}

function setSidebarCollapsed(collapsed: boolean): void {
  const shell = document.querySelector('.app-shell');
  if (!shell) {
    return;
  }

  shell.classList.toggle('sidebar-collapsed', collapsed);

  const button = byId<HTMLButtonElement>('toggleSidebar');
  const icon = byId<HTMLSpanElement>('toggleSidebarIcon');
  const label = byId<HTMLSpanElement>('toggleSidebarLabel');

  button.setAttribute('aria-expanded', String(!collapsed));
  icon.textContent = collapsed ? '›' : '‹';
  label.textContent = collapsed ? '展开配置' : '收起配置';
  window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
}

function bindSidebarToggle(): void {
  const initialCollapsed = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  setSidebarCollapsed(initialCollapsed);

  byId<HTMLButtonElement>('toggleSidebar').addEventListener('click', () => {
    const shell = document.querySelector('.app-shell');
    const collapsed = shell?.classList.contains('sidebar-collapsed') ?? false;
    setSidebarCollapsed(!collapsed);
  });
}

function setStatus(message: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  const element = byId<HTMLDivElement>('status');
  element.textContent = message;
  element.dataset.kind = kind;
}

function showToast(message: string, kind: 'ok' | 'error' = 'ok'): void {
  const element = byId<HTMLDivElement>('toast');
  element.textContent = message;
  element.className = `toast show ${kind}`;

  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
  }

  toastTimer = window.setTimeout(() => {
    element.className = 'toast';
  }, 2400);
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1)}...`;
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value || '未知时间';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: value.includes('T') ? 'short' : undefined
  }).format(new Date(timestamp));
}

function getActiveProfile(config: ConfigPatch): LlmProfile {
  return config.llmProfiles[config.llmProvider];
}

function buildSetupChecklist(config: ConfigPatch): SetupChecklistItem[] {
  const activeProfile = getActiveProfile(config);
  const zoteroMissing = [
    !config.zoteroId.trim() ? 'Zotero ID' : '',
    !config.zoteroKey.trim() ? 'API Key' : '',
    !config.arxivCategories.trim() ? 'arXiv 分类' : ''
  ].filter(Boolean);
  const aiMissing = [
    !activeProfile.apiKey.trim() ? 'API Key' : '',
    !activeProfile.baseUrl.trim() ? 'Base URL' : '',
    !activeProfile.model.trim() ? 'Model' : ''
  ].filter(Boolean);
  const feishuReady = Boolean(config.feishuWebhook.trim());

  return [
    {
      badge: zoteroMissing.length === 0 ? 'OK' : '!' ,
      title: '推荐数据源',
      detail:
        zoteroMissing.length === 0
          ? `已就绪，将按 ${config.arxivCategories.trim()} 抓取候选。`
          : `还缺少 ${zoteroMissing.join(' / ')}。`,
      ready: zoteroMissing.length === 0
    },
    {
      badge: feishuReady ? 'OK' : '!' ,
      title: '飞书推送',
      detail: feishuReady ? '机器人 Webhook 已填写，可以发送测试消息。' : '未填写 Webhook，暂时无法推送到飞书。',
      ready: feishuReady
    },
    {
      badge: aiMissing.length === 0 ? 'OK' : '!' ,
      title: 'AI 助手',
      detail:
        aiMissing.length === 0
          ? `${LLM_PROVIDER_PRESETS[config.llmProvider].label} 已配置完成。`
          : `当前供应商还缺少 ${aiMissing.join(' / ')}。`,
      ready: aiMissing.length === 0
    },
    {
      badge: !config.dailyEnabled || feishuReady ? 'OK' : '!' ,
      title: '每日推送',
      detail: !config.dailyEnabled
        ? '当前未启用，可在飞书联通后再打开。'
        : `已启用，计划在每天 ${config.dailyTime} 触发${feishuReady ? '。' : '，但还缺少 Webhook。'}`,
      ready: !config.dailyEnabled || feishuReady
    }
  ];
}

function renderSetupItem(item: SetupChecklistItem): string {
  return `
    <article class="setup-item" data-ready="${item.ready}">
      <span class="setup-item__badge">${item.badge}</span>
      <div>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.detail)}</p>
      </div>
    </article>
  `;
}

function summarizeCommandState(config: ConfigPatch): string {
  const activeProfile = getActiveProfile(config);
  const zoteroReady = Boolean(config.zoteroId.trim() && config.zoteroKey.trim() && config.arxivCategories.trim());
  const feishuReady = Boolean(config.feishuWebhook.trim());
  const aiReady = Boolean(activeProfile.apiKey.trim() && activeProfile.baseUrl.trim() && activeProfile.model.trim());

  if (!zoteroReady) {
    return '先补齐 Zotero ID、API Key 和 arXiv 分类，再执行“生成今日推荐”。';
  }

  if (config.dailyEnabled && !feishuReady) {
    return '当前可以生成推荐，但每日推送还不会生效，因为飞书 Webhook 还没有配置。';
  }

  if (!feishuReady && !aiReady) {
    return '当前已经可以生成推荐。建议下一步先接通飞书，再补当前模型供应商配置。';
  }

  if (!feishuReady) {
    return `当前已经可以生成推荐并使用 ${LLM_PROVIDER_PRESETS[config.llmProvider].label} 问答；如需通知，再补飞书 Webhook。`;
  }

  if (!aiReady) {
    return '当前已经可以生成推荐并推送飞书；如需继续问答，再补当前模型供应商的 API Key、Base URL 和 Model。';
  }

  return '当前配置已经齐全，可以直接生成推荐、测试飞书推送，并继续基于推荐结果做问答。';
}

function metricCard(label: string, value: string, accent: string): string {
  return `
    <article class="metric-card">
      <div class="metric-card__label">${label}</div>
      <div class="metric-card__value">${value}</div>
      <div class="metric-card__accent ${accent}"></div>
    </article>
  `;
}

function renderRecentDates(recentDates: Record<string, string> | undefined): string {
  const entries = Object.entries(recentDates ?? {});
  if (entries.length === 0) {
    return '';
  }

  return `
    <div class="chip-row">
      ${entries
        .map(
          ([category, label]) => `
            <span class="chip">
              <strong>${escapeHtml(category)}</strong>
              ${escapeHtml(label)}
            </span>
          `
        )
        .join('')}
    </div>
  `;
}

function renderPaperCard(paper: RecommendationPaper, index: number): string {
  const authorText = paper.authors.length > 0 ? paper.authors.join(', ') : '作者信息缺失';
  const pdfAction = paper.pdf_url
    ? `<a class="paper-link alt" href="${paper.pdf_url}" target="_blank" rel="noreferrer">PDF</a>`
    : '';

  return `
    <article class="paper-card">
      <div class="paper-card__head">
        <div>
          <div class="paper-card__index">#${index + 1}</div>
          <h3>${escapeHtml(paper.title)}</h3>
        </div>
        <div class="score-pill">${paper.score.toFixed(3)}</div>
      </div>
      <div class="paper-card__meta">
        <span>${escapeHtml(formatDate(paper.published))}</span>
        <span>${escapeHtml(authorText)}</span>
      </div>
      <p>${escapeHtml(truncate(paper.abstract, 380))}</p>
      <div class="paper-card__actions">
        <a class="paper-link" href="${paper.url}" target="_blank" rel="noreferrer">arXiv 页面</a>
        ${pdfAction}
      </div>
    </article>
  `;
}

function renderZoteroDebugRows(items: RecommendationResult['zotero_items_raw']): string {
  if (!items || items.length === 0) {
    return '<tr><td colspan="5">没有调试数据。</td></tr>';
  }

  return items
    .slice(0, 80)
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.title || '(无标题)')}</td>
          <td>${item.has_abstract ? '是' : '否'}</td>
          <td>${escapeHtml(item.paths.join(' / ') || '-')}</td>
          <td>${escapeHtml(item.added_date || '-')}</td>
        </tr>
      `
    )
    .join('');
}

function renderArxivDebugRows(items: RecommendationResult['arxiv_candidates_raw']): string {
  if (!items || items.length === 0) {
    return '<tr><td colspan="4">没有候选数据。</td></tr>';
  }

  return items
    .slice(0, 80)
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.title || '(无标题)')}</td>
          <td>${escapeHtml(formatDate(item.published || '-'))}</td>
          <td><a href="${item.url}" target="_blank" rel="noreferrer">查看</a></td>
        </tr>
      `
    )
    .join('');
}

function renderRecommendations(result: RecommendationResult): void {
  const container = byId<HTMLDivElement>('recommendationList');
  const resultStamp = byId<HTMLDivElement>('resultStamp');
  resultStamp.textContent = `最近生成: ${result.date}`;

  const metrics = [
    metricCard('Zotero 语料', `${result.corpus_size}`, 'accent-aqua'),
    metricCard('候选论文', `${result.candidate_size}`, 'accent-coral'),
    metricCard('最终推荐', `${result.papers.length}`, 'accent-ink'),
    metricCard('匹配路径', result.include_path?.trim() ? escapeHtml(result.include_path) : '全部', 'accent-gold')
  ].join('');

  const warning = result.warning ? `<div class="notice notice--warn">${escapeHtml(result.warning)}</div>` : '';
  const recentDates = renderRecentDates(result.arxiv_recent_dates);
  const papers = result.papers.length
    ? result.papers.map((paper, index) => renderPaperCard(paper, index)).join('')
    : '<div class="empty-state"><h3>本次没有生成推荐</h3><p>请检查 Zotero 摘要、includePath 过滤条件或 arXiv 分类设置。</p></div>';

  const diagnostics = `
    <details class="diagnostics">
      <summary>查看诊断信息</summary>
      <div class="diagnostics__metrics">
        <span>原始 Zotero 条目: ${result.zotero_total_raw_count ?? 0}</span>
        <span>带摘要条目: ${result.zotero_with_abstract_count ?? 0}</span>
        <span>过滤后语料: ${result.zotero_after_filter_count ?? result.corpus_size}</span>
      </div>
      <div class="debug-grid">
        <section class="debug-panel">
          <h4>Zotero 原始条目</h4>
          <table class="debug-table">
            <thead>
              <tr>
                <th>#</th>
                <th>标题</th>
                <th>有摘要</th>
                <th>路径</th>
                <th>添加时间</th>
              </tr>
            </thead>
            <tbody>${renderZoteroDebugRows(result.zotero_items_raw)}</tbody>
          </table>
        </section>
        <section class="debug-panel">
          <h4>arXiv 候选池</h4>
          <table class="debug-table">
            <thead>
              <tr>
                <th>#</th>
                <th>标题</th>
                <th>发布时间</th>
                <th>链接</th>
              </tr>
            </thead>
            <tbody>${renderArxivDebugRows(result.arxiv_candidates_raw)}</tbody>
          </table>
        </section>
      </div>
    </details>
  `;

  container.classList.remove('recommendation-list--empty');
  container.innerHTML = `
    <section class="result-overview">
      <div>
        <p class="eyebrow">Daily Briefing</p>
        <h2>${result.papers.length > 0 ? '推荐已生成' : '推荐结果为空'}</h2>
        <p class="muted">
          结果基于最近收藏的 Zotero 论文摘要与 arXiv 最新候选进行轻量语义重排。
        </p>
      </div>
      ${warning}
    </section>
    <section class="metrics-grid">${metrics}</section>
    ${recentDates}
    <section class="paper-grid">${papers}</section>
    ${diagnostics}
  `;
}

function cloneProfiles(profiles: LlmProfiles): LlmProfiles {
  return {
    chatgpt: { ...profiles.chatgpt },
    claude: { ...profiles.claude },
    kimi: { ...profiles.kimi },
    deepseek: { ...profiles.deepseek },
    glm: { ...profiles.glm },
    gemini: { ...profiles.gemini }
  };
}

function syncCurrentProviderProfileFromForm(): void {
  providerProfiles[currentProvider] = {
    apiKey: byId<HTMLInputElement>('llmApiKey').value.trim(),
    baseUrl: byId<HTMLInputElement>('llmBaseUrl').value.trim() || LLM_PROVIDER_PRESETS[currentProvider].baseUrl,
    model: byId<HTMLInputElement>('llmModel').value.trim()
  };
}

function applyProviderProfileToForm(provider: LlmProvider, forceBaseUrl = false): void {
  const preset = LLM_PROVIDER_PRESETS[provider];
  const profile = providerProfiles[provider];

  byId<HTMLInputElement>('llmApiKey').value = profile.apiKey;
  byId<HTMLInputElement>('llmModel').value = profile.model;
  byId<HTMLInputElement>('llmModel').placeholder = preset.modelPlaceholder;
  byId<HTMLDivElement>('llmProviderHint').textContent = preset.helpText;

  if (forceBaseUrl || profile.baseUrl.trim()) {
    byId<HTMLInputElement>('llmBaseUrl').value = profile.baseUrl.trim() || preset.baseUrl;
  }

  currentProvider = provider;
}

function extractLlmProfiles(config: Record<string, unknown>, provider: LlmProvider): LlmProfiles {
  const profiles = createDefaultLlmProfiles();
  const rawProfiles = config.llmProfiles;

  if (rawProfiles && typeof rawProfiles === 'object') {
    for (const providerKey of PROVIDERS) {
      const rawProfile = (rawProfiles as Record<string, unknown>)[providerKey];
      if (!rawProfile || typeof rawProfile !== 'object') {
        continue;
      }

      profiles[providerKey] = {
        apiKey: String((rawProfile as Record<string, unknown>).apiKey ?? ''),
        baseUrl: String((rawProfile as Record<string, unknown>).baseUrl ?? profiles[providerKey].baseUrl),
        model: String((rawProfile as Record<string, unknown>).model ?? '')
      };
    }
  }

  profiles[provider] = {
    apiKey: String(config.llmApiKey ?? profiles[provider].apiKey),
    baseUrl: String(config.llmBaseUrl ?? profiles[provider].baseUrl),
    model: String(config.llmModel ?? profiles[provider].model)
  };

  return profiles;
}

function readConfigFromForm(): ConfigPatch {
  syncCurrentProviderProfileFromForm();
  const selectedProvider = byId<HTMLSelectElement>('llmProvider').value as LlmProvider;
  const activeProfile = providerProfiles[selectedProvider];

  return {
    zoteroId: byId<HTMLInputElement>('zoteroId').value.trim(),
    zoteroKey: byId<HTMLInputElement>('zoteroKey').value.trim(),
    includePath: byId<HTMLInputElement>('includePath').value.trim(),
    arxivCategories: byId<HTMLInputElement>('arxivCategories').value.trim(),
    maxResults: Number(byId<HTMLInputElement>('maxResults').value || '8'),
    feishuWebhook: byId<HTMLInputElement>('feishuWebhook').value.trim(),
    feishuSecret: byId<HTMLInputElement>('feishuSecret').value.trim(),
    dailyEnabled: byId<HTMLInputElement>('dailyEnabled').checked,
    dailyTime: byId<HTMLInputElement>('dailyTime').value.trim() || '09:00',
    llmProvider: selectedProvider,
    llmApiKey: activeProfile.apiKey,
    llmBaseUrl: activeProfile.baseUrl,
    llmModel: activeProfile.model,
    llmProfiles: cloneProfiles(providerProfiles)
  };
}

function applyConfigToForm(config: Record<string, unknown>): void {
  byId<HTMLInputElement>('zoteroId').value = String(config.zoteroId ?? '');
  byId<HTMLInputElement>('zoteroKey').value = String(config.zoteroKey ?? '');
  byId<HTMLInputElement>('includePath').value = String(config.includePath ?? '');
  byId<HTMLInputElement>('arxivCategories').value = String(config.arxivCategories ?? '');
  byId<HTMLInputElement>('maxResults').value = String(config.maxResults ?? '8');
  byId<HTMLInputElement>('feishuWebhook').value = String(config.feishuWebhook ?? '');
  byId<HTMLInputElement>('feishuSecret').value = String(config.feishuSecret ?? '');
  byId<HTMLInputElement>('dailyEnabled').checked = Boolean(config.dailyEnabled);
  byId<HTMLInputElement>('dailyTime').value = String(config.dailyTime ?? '09:00');

  const provider = String(config.llmProvider ?? 'chatgpt') as LlmProvider;
  providerProfiles = extractLlmProfiles(config, provider);
  byId<HTMLSelectElement>('llmProvider').value = provider;
  applyProviderProfileToForm(provider, true);
}

function refreshWorkspaceHints(): void {
  const config = readConfigFromForm();
  const items = buildSetupChecklist(config);
  const readyCount = items.filter((item) => item.ready).length;

  byId<HTMLDivElement>('setupChecklist').innerHTML = items.map((item) => renderSetupItem(item)).join('');
  byId<HTMLDivElement>('readinessBadge').textContent = `配置进度: ${readyCount}/${items.length}`;
  byId<HTMLParagraphElement>('commandSummary').textContent = summarizeCommandState(config);
}

function bindLiveFormHints(): void {
  const ids = [
    'zoteroId',
    'zoteroKey',
    'includePath',
    'arxivCategories',
    'maxResults',
    'feishuWebhook',
    'feishuSecret',
    'dailyEnabled',
    'dailyTime',
    'llmProvider',
    'llmApiKey',
    'llmBaseUrl',
    'llmModel',
    'configFilePath'
  ];

  for (const id of ids) {
    const element = byId<HTMLElement>(id);
    element.addEventListener('input', () => {
      refreshWorkspaceHints();
    });
    element.addEventListener('change', () => {
      refreshWorkspaceHints();
    });
  }
}

function pickPatch<K extends ConfigKey>(keys: K[]): Pick<ConfigPatch, K> {
  const config = readConfigFromForm();
  const patch = {} as Pick<ConfigPatch, K>;
  for (const key of keys) {
    patch[key] = config[key];
  }
  return patch;
}

async function withButtonLock(buttonId: string, task: () => Promise<void>): Promise<void> {
  const button = byId<HTMLButtonElement>(buttonId);
  button.disabled = true;
  button.dataset.loading = 'true';

  try {
    await task();
  } finally {
    button.disabled = false;
    delete button.dataset.loading;
  }
}

async function savePatchWithPrompt(patch: Partial<ConfigPatch>, hint: string): Promise<void> {
  setStatus(`正在保存${hint}...`);
  const saved = await window.arxivStudio.saveConfig(patch);
  providerProfiles = cloneProfiles(saved.llmProfiles);
  setStatus(`${hint}已保存。`, 'ok');
  showToast(`${hint}已保存`, 'ok');
}

function bindEventHandlers(): void {
  byId<HTMLSelectElement>('llmProvider').addEventListener('change', (event) => {
    syncCurrentProviderProfileFromForm();
    const provider = (event.target as HTMLSelectElement).value as LlmProvider;
    applyProviderProfileToForm(provider, true);
    refreshWorkspaceHints();
  });

  byId<HTMLButtonElement>('saveConfig').addEventListener('click', () => {
    void withButtonLock('saveConfig', async () => {
      try {
        await savePatchWithPrompt(readConfigFromForm(), '全部配置');
      } catch (error) {
        setStatus((error as Error).message, 'error');
        showToast('保存失败', 'error');
      }
    });
  });

  byId<HTMLButtonElement>('saveZoteroConfig').addEventListener('click', () => {
    void withButtonLock('saveZoteroConfig', async () => {
      try {
        await savePatchWithPrompt(
          pickPatch(['zoteroId', 'zoteroKey', 'includePath', 'arxivCategories', 'maxResults']),
          'Zotero 配置'
        );
      } catch (error) {
        setStatus((error as Error).message, 'error');
        showToast('保存失败', 'error');
      }
    });
  });

  byId<HTMLButtonElement>('saveFeishuConfig').addEventListener('click', () => {
    void withButtonLock('saveFeishuConfig', async () => {
      try {
        await savePatchWithPrompt(
          pickPatch(['feishuWebhook', 'feishuSecret', 'dailyEnabled', 'dailyTime']),
          '飞书配置'
        );
      } catch (error) {
        setStatus((error as Error).message, 'error');
        showToast('保存失败', 'error');
      }
    });
  });

  byId<HTMLButtonElement>('saveChatConfig').addEventListener('click', () => {
    void withButtonLock('saveChatConfig', async () => {
      try {
        await savePatchWithPrompt(
          pickPatch(['llmProvider', 'llmApiKey', 'llmBaseUrl', 'llmModel', 'llmProfiles']),
          'AI 助手配置'
        );
      } catch (error) {
        setStatus((error as Error).message, 'error');
        showToast('保存失败', 'error');
      }
    });
  });

  byId<HTMLButtonElement>('loadConfigFile').addEventListener('click', () => {
    void withButtonLock('loadConfigFile', async () => {
      try {
        const filePath = byId<HTMLInputElement>('configFilePath').value.trim();
        const config = await window.arxivStudio.loadConfigFromFile(filePath || undefined);
        applyConfigToForm(config as unknown as Record<string, unknown>);
        refreshWorkspaceHints();
        setStatus('配置文件已加载并同步到本地。', 'ok');
        showToast('配置文件已加载', 'ok');
      } catch (error) {
        setStatus((error as Error).message, 'error');
        showToast('加载失败', 'error');
      }
    });
  });

  byId<HTMLButtonElement>('runNow').addEventListener('click', () => {
    void withButtonLock('runNow', async () => {
      try {
        setStatus('正在抓取 Zotero 和 arXiv 数据，请稍候...');
        await window.arxivStudio.saveConfig(readConfigFromForm());
        const result = await window.arxivStudio.runRecommendation();
        renderRecommendations(result);
        setStatus('推荐结果已更新。', 'ok');
        showToast('推荐已生成', 'ok');
        byId<HTMLDivElement>('recommendationList').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (error) {
        setStatus((error as Error).message, 'error');
        showToast('推荐失败', 'error');
      }
    });
  });

  byId<HTMLButtonElement>('testFeishu').addEventListener('click', () => {
    void withButtonLock('testFeishu', async () => {
      try {
        setStatus('正在向飞书发送测试消息...');
        await window.arxivStudio.saveConfig(readConfigFromForm());
        await window.arxivStudio.testFeishu();
        setStatus('飞书推送成功。', 'ok');
        showToast('飞书推送成功', 'ok');
      } catch (error) {
        setStatus((error as Error).message, 'error');
        showToast('飞书推送失败', 'error');
      }
    });
  });

  byId<HTMLButtonElement>('sendChat').addEventListener('click', () => {
    void withButtonLock('sendChat', async () => {
      try {
        const input = byId<HTMLTextAreaElement>('chatInput');
        const question = input.value.trim();
        if (!question) {
          setStatus('请输入问题后再发送。', 'error');
          return;
        }

        setStatus('正在请求 AI 助手...');
        await window.arxivStudio.saveConfig(readConfigFromForm());
        const answer = await window.arxivStudio.chat(question);
        byId<HTMLDivElement>('chatOutput').textContent = answer;
        setStatus('AI 助手已返回结果。', 'ok');
        showToast('对话完成', 'ok');
      } catch (error) {
        setStatus((error as Error).message, 'error');
        showToast('对话失败', 'error');
      }
    });
  });

  byId<HTMLTextAreaElement>('chatInput').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      byId<HTMLButtonElement>('sendChat').click();
    }
  });
}

function renderInitialState(): void {
  byId<HTMLDivElement>('recommendationList').innerHTML = `
    <div class="empty-state">
      <h3>等待首次生成</h3>
      <p>保存配置后点击“生成今日推荐”，右侧会展示推荐卡片、候选统计和调试信息。</p>
    </div>
  `;
}

async function init(): Promise<void> {
  bindEventHandlers();
  bindSidebarToggle();
  bindLiveFormHints();
  renderInitialState();
  providerProfiles = createDefaultLlmProfiles();
  applyProviderProfileToForm('chatgpt', true);
  refreshWorkspaceHints();

  try {
    const config = await window.arxivStudio.getConfig();
    applyConfigToForm(config as unknown as Record<string, unknown>);
    refreshWorkspaceHints();
    setStatus('配置已加载，可以开始生成推荐。', 'ok');
  } catch (error) {
    setStatus(`初始化失败: ${(error as Error).message}`, 'error');
    showToast('初始化失败', 'error');
  }
}

void init();
