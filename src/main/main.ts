import { app, BrowserWindow, ipcMain } from 'electron';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { generateRecommendations, type RecommendationResult } from './recommendation';

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

type LlmSection = Partial<LlmProfile> & {
  provider?: LlmProvider;
};

type ExternalFileConfig = Partial<AppConfig> & {
  zotero?: {
    id?: string;
    key?: string;
    includePath?: string;
    arxivCategories?: string[] | string;
    maxResults?: number;
  };
  feishu?: {
    webhook?: string;
    secret?: string;
    dailyEnabled?: boolean;
    dailyTime?: string;
  };
  llm?: LlmSection;
  llmProfiles?: Partial<Record<LlmProvider, Partial<LlmProfile>>>;
  chatgpt?: LlmSection;
  claude?: LlmSection;
  kimi?: LlmSection;
  deepseek?: LlmSection;
  glm?: LlmSection;
  gemini?: LlmSection;
};

const PROVIDERS: LlmProvider[] = ['chatgpt', 'claude', 'kimi', 'deepseek', 'glm', 'gemini'];

const LLM_PROVIDER_DEFAULTS: Record<LlmProvider, Omit<LlmProfile, 'apiKey'>> = {
  chatgpt: { baseUrl: 'https://api.openai.com/v1', model: '' },
  claude: { baseUrl: 'https://api.anthropic.com', model: '' },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1', model: '' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: '' },
  glm: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: '' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: '' }
};

function createDefaultLlmProfiles(): LlmProfiles {
  return {
    chatgpt: { apiKey: '', ...LLM_PROVIDER_DEFAULTS.chatgpt },
    claude: { apiKey: '', ...LLM_PROVIDER_DEFAULTS.claude },
    kimi: { apiKey: '', ...LLM_PROVIDER_DEFAULTS.kimi },
    deepseek: { apiKey: '', ...LLM_PROVIDER_DEFAULTS.deepseek },
    glm: { apiKey: '', ...LLM_PROVIDER_DEFAULTS.glm },
    gemini: { apiKey: '', ...LLM_PROVIDER_DEFAULTS.gemini }
  };
}

const DEFAULT_CONFIG: AppConfig = {
  zoteroId: '',
  zoteroKey: '',
  includePath: '',
  arxivCategories: 'cs.AI,cs.CL,cs.LG',
  maxResults: 8,
  feishuWebhook: '',
  feishuSecret: '',
  dailyEnabled: false,
  dailyTime: '09:00',
  llmProvider: 'chatgpt',
  llmApiKey: '',
  llmBaseUrl: LLM_PROVIDER_DEFAULTS.chatgpt.baseUrl,
  llmModel: '',
  llmProfiles: createDefaultLlmProfiles()
};

const OPENAI_COMPATIBLE_PROVIDERS = new Set<LlmProvider>(['chatgpt', 'kimi', 'deepseek', 'glm']);

let mainWindow: BrowserWindow | null = null;
let configCache: AppConfig = { ...DEFAULT_CONFIG, llmProfiles: createDefaultLlmProfiles() };
let dailyTimer: NodeJS.Timeout | null = null;
let latestRecommendation: RecommendationResult | null = null;

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'user-config.json');
}

function getDefaultExternalConfigPath(): string {
  if (process.env.ARXIV_STUDIO_CONFIG?.trim()) {
    return path.resolve(process.env.ARXIV_STUDIO_CONFIG.trim());
  }
  return path.join(app.getAppPath(), 'config', 'app-config.json');
}

function normalizeCategories(value: string[] | string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean).join(',') : value.trim();
}

function isProvider(value: string | undefined): value is LlmProvider {
  return PROVIDERS.includes(value as LlmProvider);
}

function normalizeProvider(value: string | undefined): LlmProvider {
  return isProvider(value) ? value : DEFAULT_CONFIG.llmProvider;
}

function mergeProfile(provider: LlmProvider, profile?: Partial<LlmProfile>): LlmProfile {
  return {
    apiKey: profile?.apiKey ?? '',
    baseUrl: profile?.baseUrl?.trim() || LLM_PROVIDER_DEFAULTS[provider].baseUrl,
    model: profile?.model ?? ''
  };
}

function mergeProfiles(rawProfiles?: Partial<Record<LlmProvider, Partial<LlmProfile>>>): LlmProfiles {
  const profiles = createDefaultLlmProfiles();
  for (const provider of PROVIDERS) {
    profiles[provider] = mergeProfile(provider, rawProfiles?.[provider]);
  }
  return profiles;
}

function normalizeConfig(raw: Partial<AppConfig>): AppConfig {
  const llmProvider = normalizeProvider(raw.llmProvider);
  const llmProfiles = mergeProfiles(raw.llmProfiles);

  if (raw.llmApiKey !== undefined || raw.llmBaseUrl !== undefined || raw.llmModel !== undefined) {
    llmProfiles[llmProvider] = mergeProfile(llmProvider, {
      apiKey: raw.llmApiKey ?? llmProfiles[llmProvider].apiKey,
      baseUrl: raw.llmBaseUrl ?? llmProfiles[llmProvider].baseUrl,
      model: raw.llmModel ?? llmProfiles[llmProvider].model
    });
  }

  const activeProfile = llmProfiles[llmProvider];

  return {
    ...DEFAULT_CONFIG,
    ...raw,
    llmProvider,
    llmApiKey: activeProfile.apiKey,
    llmBaseUrl: activeProfile.baseUrl,
    llmModel: activeProfile.model,
    llmProfiles
  };
}

function extractNamedProviderProfiles(data: ExternalFileConfig): Partial<Record<LlmProvider, Partial<LlmProfile>>> {
  const profiles: Partial<Record<LlmProvider, Partial<LlmProfile>>> = {};
  for (const provider of PROVIDERS) {
    const section = data[provider] as LlmSection | undefined;
    if (!section) {
      continue;
    }
    profiles[provider] = {
      apiKey: section.apiKey,
      baseUrl: section.baseUrl,
      model: section.model
    };
  }
  return profiles;
}

function getFirstConfiguredProvider(data: ExternalFileConfig): LlmProvider | undefined {
  for (const provider of PROVIDERS) {
    const section = data[provider] as LlmSection | undefined;
    if (section && (section.apiKey || section.baseUrl || section.model)) {
      return provider;
    }
  }
  return undefined;
}

function mapExternalFileConfig(data: ExternalFileConfig): Partial<AppConfig> {
  const providerFromFile = normalizeProvider(data.llm?.provider ?? data.llmProvider ?? getFirstConfiguredProvider(data));
  const profiles = mergeProfiles({
    ...data.llmProfiles,
    ...extractNamedProviderProfiles(data)
  });

  if (data.llm) {
    profiles[providerFromFile] = mergeProfile(providerFromFile, {
      apiKey: data.llm.apiKey ?? profiles[providerFromFile].apiKey,
      baseUrl: data.llm.baseUrl ?? profiles[providerFromFile].baseUrl,
      model: data.llm.model ?? profiles[providerFromFile].model
    });
  }

  const nested: Partial<AppConfig> = {
    zoteroId: data.zotero?.id,
    zoteroKey: data.zotero?.key,
    includePath: data.zotero?.includePath,
    arxivCategories: normalizeCategories(data.zotero?.arxivCategories),
    maxResults: data.zotero?.maxResults,
    feishuWebhook: data.feishu?.webhook,
    feishuSecret: data.feishu?.secret,
    dailyEnabled: data.feishu?.dailyEnabled,
    dailyTime: data.feishu?.dailyTime,
    llmProvider: providerFromFile,
    llmProfiles: profiles
  };

  const flat: Partial<AppConfig> = {
    zoteroId: data.zoteroId,
    zoteroKey: data.zoteroKey,
    includePath: data.includePath,
    arxivCategories: normalizeCategories(data.arxivCategories),
    maxResults: data.maxResults,
    feishuWebhook: data.feishuWebhook,
    feishuSecret: data.feishuSecret,
    dailyEnabled: data.dailyEnabled,
    dailyTime: data.dailyTime,
    llmProvider: data.llmProvider,
    llmApiKey: data.llmApiKey,
    llmBaseUrl: data.llmBaseUrl,
    llmModel: data.llmModel,
    llmProfiles: data.llmProfiles ? mergeProfiles(data.llmProfiles) : profiles
  };

  return {
    ...nested,
    ...flat
  };
}

async function loadConfigFromFile(filePath?: string): Promise<Partial<AppConfig>> {
  const rawPath = filePath?.trim() ? filePath.trim() : getDefaultExternalConfigPath();
  const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(app.getAppPath(), rawPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`配置文件不存在: ${resolvedPath}`);
  }

  const raw = await fs.readFile(resolvedPath, 'utf-8');
  let parsed: ExternalFileConfig;
  try {
    parsed = JSON.parse(raw) as ExternalFileConfig;
  } catch (error) {
    throw new Error(`配置文件 JSON 解析失败: ${(error as Error).message}`);
  }

  return mapExternalFileConfig(parsed);
}

async function readConfig(): Promise<AppConfig> {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    await writeConfig(DEFAULT_CONFIG);
    return normalizeConfig(DEFAULT_CONFIG);
  }

  const raw = await fs.readFile(configPath, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return normalizeConfig(parsed);
  } catch {
    return normalizeConfig(DEFAULT_CONFIG);
  }
}

async function writeConfig(config: AppConfig): Promise<void> {
  const normalized = normalizeConfig(config);
  const configPath = getConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(normalized, null, 2), 'utf-8');
}

async function runRecommendation(config: AppConfig): Promise<RecommendationResult> {
  if (!config.zoteroId.trim() || !config.zoteroKey.trim()) {
    throw new Error('请先填写 Zotero ID 和 Zotero API Key。');
  }

  const result = await generateRecommendations({
    zoteroId: config.zoteroId,
    zoteroKey: config.zoteroKey,
    includePath: config.includePath,
    arxivCategories: config.arxivCategories,
    maxResults: config.maxResults
  });

  latestRecommendation = result;
  return result;
}

function buildFeishuText(result: RecommendationResult): string {
  const header = `ArXiv Daily ${result.date}\n候选论文 ${result.candidate_size} 篇 | Zotero 语料 ${result.corpus_size} 篇`;
  const sections = result.papers.map((paper, index) => {
    const shortAbstract = paper.abstract.replace(/\s+/g, ' ').slice(0, 180);
    return [
      `${index + 1}. ${paper.title}`,
      `score=${paper.score.toFixed(3)} | ${paper.published}`,
      paper.url,
      shortAbstract
    ].join('\n');
  });

  return [header, ...sections].join('\n\n');
}

function buildRecommendationContext(result: RecommendationResult | null): string {
  if (!result || result.papers.length === 0) {
    return '当前没有可用的推荐列表上下文。请基于用户问题直接回答，并提醒用户先生成推荐结果。';
  }

  const paperSummaries = result.papers
    .map((paper, index) => {
      const summary = paper.abstract.replace(/\s+/g, ' ').slice(0, 500);
      const authors = paper.authors.length > 0 ? paper.authors.join(', ') : '未知作者';
      return [
        `论文 ${index + 1}`,
        `标题: ${paper.title}`,
        `得分: ${paper.score.toFixed(3)}`,
        `发布时间: ${paper.published}`,
        `作者: ${authors}`,
        `链接: ${paper.url}`,
        `摘要: ${summary}`
      ].join('\n');
    })
    .join('\n\n');

  return [
    `当前推荐生成日期: ${result.date}`,
    `推荐数量: ${result.papers.length}`,
    `候选数量: ${result.candidate_size}`,
    `Zotero 语料数量: ${result.corpus_size}`,
    result.include_path ? `路径过滤: ${result.include_path}` : '路径过滤: 无',
    result.warning ? `警告: ${result.warning}` : '',
    '以下是最近一次推荐列表，请优先基于这些论文回答用户问题：',
    paperSummaries
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function pushToFeishu(webhook: string, secret: string, text: string): Promise<void> {
  if (!webhook.trim()) {
    throw new Error('请先配置飞书 Webhook。');
  }

  const body: Record<string, unknown> = {
    msg_type: 'text',
    content: { text }
  };

  if (secret.trim()) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const content = `${timestamp}\n${secret.trim()}`;
    const sign = crypto.createHmac('sha256', secret.trim()).update(content).digest('base64');
    body.timestamp = timestamp;
    body.sign = sign;
  }

  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`飞书推送失败: HTTP ${response.status} ${detail}`);
  }
}

function parseDailyTime(value: string): { hour: number; minute: number } {
  const match = value.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) {
    return { hour: 9, minute: 0 };
  }

  return {
    hour: Math.min(23, Math.max(0, Number(match[1]))),
    minute: Math.min(59, Math.max(0, Number(match[2])))
  };
}

function msUntilNextRun(dailyTime: string): number {
  const now = new Date();
  const { hour, minute } = parseDailyTime(dailyTime);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

async function runAndPushDaily(): Promise<void> {
  if (!configCache.dailyEnabled || !configCache.feishuWebhook.trim()) {
    return;
  }

  const result = await runRecommendation(configCache);
  await pushToFeishu(configCache.feishuWebhook, configCache.feishuSecret, buildFeishuText(result));
}

function armDailySchedule(): void {
  if (dailyTimer) {
    clearTimeout(dailyTimer);
    dailyTimer = null;
  }

  if (!configCache.dailyEnabled) {
    return;
  }

  const delay = msUntilNextRun(configCache.dailyTime);
  dailyTimer = setTimeout(async () => {
    try {
      await runAndPushDaily();
    } catch (error) {
      console.error('daily push failed', error);
    } finally {
      armDailySchedule();
    }
  }, delay);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function buildEndpoint(baseUrl: string, pathSuffix: string): string {
  const cleanBase = normalizeBaseUrl(baseUrl);
  const cleanSuffix = pathSuffix.replace(/^\/+/, '');
  return `${cleanBase}/${cleanSuffix}`;
}

async function readResponseText(response: Response): Promise<string> {
  return await response.text();
}

function parseJsonLike(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function throwProviderError(provider: LlmProvider, response: Response): Promise<never> {
  const detail = await readResponseText(response);
  const payload = parseJsonLike(detail);
  const errorPayload = (payload?.error ?? payload) as Record<string, unknown> | undefined;
  const message = typeof errorPayload?.message === 'string' ? errorPayload.message : detail;
  const code = typeof errorPayload?.code === 'string' ? errorPayload.code : '';

  if (response.status === 429 && code === 'insufficient_quota') {
    throw new Error(`${provider} 配额不足，请检查 API Key 所属项目的额度或 billing。`);
  }

  throw new Error(`${provider} 请求失败: HTTP ${response.status} ${message}`);
}

function getActiveLlmConfig(config: AppConfig): AppConfig {
  return normalizeConfig(config);
}

function buildSystemPrompt(contextText: string): string {
  return [
    '你是一名帮助用户理解论文、梳理研究方向并分析推荐列表的学术助手。',
    '如果上下文里已经包含推荐论文列表，请优先基于这些论文回答，不要忽略它们。',
    '当用户问“哪个最匹配我”“该读哪个”“有什么共同趋势”这类问题时，请明确引用推荐列表中的论文标题、分数、方法和摘要要点。',
    '如果上下文不足以判断，也要先说明你已知的推荐列表信息，再指出还缺什么背景。',
    '',
    contextText
  ].join('\n');
}

async function requestOpenAiCompatible(config: AppConfig, message: string, temperature: number): Promise<Response> {
  const contextText = buildRecommendationContext(latestRecommendation);

  return await fetch(buildEndpoint(config.llmBaseUrl, 'chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.llmApiKey}`
    },
    body: JSON.stringify({
      model: config.llmModel,
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(contextText)
        },
        { role: 'user', content: message }
      ],
      temperature
    })
  });
}

async function callOpenAiCompatible(config: AppConfig, message: string): Promise<string> {
  const activeConfig = getActiveLlmConfig(config);
  let response = await requestOpenAiCompatible(activeConfig, message, 0.4);

  if (!response.ok && activeConfig.llmProvider === 'kimi') {
    const detail = await readResponseText(response);
    const isTemperatureRestricted =
      response.status === 400 && /invalid temperature/i.test(detail) && /\bonly 1 is allowed\b/i.test(detail);

    if (isTemperatureRestricted) {
      response = await requestOpenAiCompatible(activeConfig, message, 1);
    } else {
      const payload = parseJsonLike(detail);
      const errorPayload = (payload?.error ?? payload) as Record<string, unknown> | undefined;
      const errorMessage = typeof errorPayload?.message === 'string' ? errorPayload.message : detail;
      throw new Error(`${activeConfig.llmProvider} 请求失败: HTTP ${response.status} ${errorMessage}`);
    }
  }

  if (!response.ok) {
    await throwProviderError(activeConfig.llmProvider, response);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`${activeConfig.llmProvider} 返回内容为空。`);
  }

  return content;
}

async function callClaude(config: AppConfig, message: string): Promise<string> {
  const activeConfig = getActiveLlmConfig(config);
  const contextText = buildRecommendationContext(latestRecommendation);

  const response = await fetch(buildEndpoint(activeConfig.llmBaseUrl, 'v1/messages'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': activeConfig.llmApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: activeConfig.llmModel,
      max_tokens: 1024,
      temperature: 0.4,
      system: buildSystemPrompt(contextText),
      messages: [{ role: 'user', content: message }]
    })
  });

  if (!response.ok) {
    await throwProviderError(activeConfig.llmProvider, response);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const content = payload.content
    ?.filter((item) => item.type === 'text' && item.text)
    .map((item) => item.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n');

  if (!content) {
    throw new Error('claude 返回内容为空。');
  }

  return content;
}

async function callGemini(config: AppConfig, message: string): Promise<string> {
  const activeConfig = getActiveLlmConfig(config);
  const contextText = buildRecommendationContext(latestRecommendation);
  const endpoint = `${buildEndpoint(activeConfig.llmBaseUrl, `models/${activeConfig.llmModel}:generateContent`)}?key=${encodeURIComponent(activeConfig.llmApiKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: buildSystemPrompt(contextText) }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: message }]
        }
      ],
      generationConfig: {
        temperature: 0.4
      }
    })
  });

  if (!response.ok) {
    await throwProviderError(activeConfig.llmProvider, response);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };
  const content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text?.trim() ?? '').filter(Boolean).join('\n\n');
  if (!content) {
    throw new Error('gemini 返回内容为空。');
  }

  return content;
}

async function callChat(config: AppConfig, message: string): Promise<string> {
  const activeConfig = getActiveLlmConfig(config);

  if (!activeConfig.llmApiKey.trim()) {
    throw new Error(`请先填写 ${activeConfig.llmProvider} 的 API Key。`);
  }
  if (!activeConfig.llmBaseUrl.trim()) {
    throw new Error(`请先填写 ${activeConfig.llmProvider} 的 Base URL。`);
  }
  if (!activeConfig.llmModel.trim()) {
    throw new Error(`请先填写 ${activeConfig.llmProvider} 的模型名称。`);
  }

  if (OPENAI_COMPATIBLE_PROVIDERS.has(activeConfig.llmProvider)) {
    return await callOpenAiCompatible(activeConfig, message);
  }

  if (activeConfig.llmProvider === 'claude') {
    return await callClaude(activeConfig, message);
  }

  if (activeConfig.llmProvider === 'gemini') {
    return await callGemini(activeConfig, message);
  }

  throw new Error(`暂不支持的 AI 提供商: ${activeConfig.llmProvider}`);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1200,
    minHeight: 820,
    backgroundColor: '#d7e3ef',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const htmlPath = path.join(app.getAppPath(), 'src', 'renderer', 'index.html');
  void mainWindow.loadFile(htmlPath);
}

app.whenReady().then(async () => {
  configCache = await readConfig();

  const defaultExternalConfigPath = getDefaultExternalConfigPath();
  if (existsSync(defaultExternalConfigPath)) {
    try {
      const loaded = await loadConfigFromFile(defaultExternalConfigPath);
      configCache = normalizeConfig({ ...configCache, ...loaded });
      await writeConfig(configCache);
    } catch (error) {
      console.error('external config load failed', error);
    }
  }

  armDailySchedule();
  createWindow();

  ipcMain.handle('config:get', async () => {
    configCache = await readConfig();
    return configCache;
  });

  ipcMain.handle('config:save', async (_event, patch: Partial<AppConfig>) => {
    configCache = normalizeConfig({ ...configCache, ...patch });
    await writeConfig(configCache);
    armDailySchedule();
    return configCache;
  });

  ipcMain.handle('config:loadFromFile', async (_event, filePath?: string) => {
    const loaded = await loadConfigFromFile(filePath);
    configCache = normalizeConfig({ ...configCache, ...loaded });
    await writeConfig(configCache);
    armDailySchedule();
    return configCache;
  });

  ipcMain.handle('recommend:run', async () => {
    return await runRecommendation(configCache);
  });

  ipcMain.handle('feishu:test', async () => {
    const result = await runRecommendation(configCache);
    await pushToFeishu(configCache.feishuWebhook, configCache.feishuSecret, buildFeishuText(result));
    return { ok: true };
  });

  ipcMain.handle('chat:send', async (_event, message: string) => {
    return await callChat(configCache, message);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
