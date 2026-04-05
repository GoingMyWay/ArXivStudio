import { contextBridge, ipcRenderer } from 'electron';

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

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
  saveConfig: (patch: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke('config:save', patch),
  loadConfigFromFile: (filePath?: string): Promise<AppConfig> => ipcRenderer.invoke('config:loadFromFile', filePath),
  runRecommendation: (): Promise<RecommendationResult> => ipcRenderer.invoke('recommend:run'),
  testFeishu: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('feishu:test'),
  chat: (message: string): Promise<string> => ipcRenderer.invoke('chat:send', message)
};

contextBridge.exposeInMainWorld('arxivStudio', api);

export type ArxivStudioApi = typeof api;
