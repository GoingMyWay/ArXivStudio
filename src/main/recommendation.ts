type CorpusPaper = {
  title: string;
  abstract: string;
  addedDate: Date;
  paths: string[];
};

type CandidatePaper = {
  title: string;
  abstract: string;
  authors: string[];
  url: string;
  pdf_url: string;
  published: string;
  updated: string;
  score: number;
};

type ZoteroDebugItem = {
  title: string;
  has_abstract: boolean;
  added_date: string;
  paths: string[];
};

export type RecommendationPaper = {
  title: string;
  abstract: string;
  authors: string[];
  url: string;
  pdf_url: string;
  score: number;
  published: string;
};

export type RecommendationResult = {
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
  zotero_items_raw?: ZoteroDebugItem[];
  arxiv_candidates_raw?: Array<{
    title: string;
    published: string;
    url: string;
  }>;
};

export type RecommendationConfig = {
  zoteroId: string;
  zoteroKey: string;
  includePath: string;
  arxivCategories: string;
  maxResults: number;
};

const ARXIV_ABS_ID_RE = /\/abs\/([^?#]+)/i;
const HTTP_TIMEOUT_MS = 15000;
const HTTP_MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTransientFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined;
  const causeCode =
    cause && typeof cause === 'object' && 'code' in cause && typeof (cause as { code?: unknown }).code === 'string'
      ? (cause as { code: string }).code
      : '';

  return /timed out|timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket disconnected/i.test(message) ||
    ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'].includes(causeCode);
}

function describeFetchError(url: string, error: unknown): Error {
  const endpoint = new URL(url).host;
  const cause = error instanceof Error && 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined;
  const causeCode =
    cause && typeof cause === 'object' && 'code' in cause && typeof (cause as { code?: unknown }).code === 'string'
      ? (cause as { code: string }).code
      : '';

  if (isTransientFetchError(error)) {
    const suffix = causeCode ? `（${causeCode}）` : '';
    return new Error(`连接 ${endpoint} 失败${suffix}。请检查网络或稍后重试。`);
  }

  if (error instanceof Error) {
    return new Error(`请求 ${endpoint} 失败: ${error.message}`);
  }

  return new Error(`请求 ${endpoint} 失败。`);
}

async function requestText(url: string, headers: Record<string, string> = {}): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= HTTP_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`HTTP ${response.status} for ${url}. ${detail}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt === HTTP_MAX_RETRIES || !isTransientFetchError(error)) {
        throw describeFetchError(url, error);
      }
      await sleep(500 * (attempt + 1));
    }
  }

  throw describeFetchError(url, lastError);
}

async function httpGetJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const text = await requestText(url, headers);
  return JSON.parse(text) as T;
}

async function httpGetText(url: string, headers: Record<string, string> = {}): Promise<string> {
  return await requestText(url, headers);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripMarkup(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractTag(block: string, tag: string): string {
  const pattern = new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i');
  const match = block.match(pattern);
  return match ? stripMarkup(match[1]) : '';
}

function extractAuthors(block: string): string[] {
  const authors: string[] = [];
  const authorMatches = block.matchAll(/<(?:\w+:)?author\b[^>]*>([\s\S]*?)<\/(?:\w+:)?author>/gi);
  for (const author of authorMatches) {
    const name = extractTag(author[1], 'name');
    if (name) {
      authors.push(name);
    }
  }
  return authors;
}

function extractPdfUrl(block: string): string {
  const linkMatches = block.matchAll(/<(?:\w+:)?link\b([^>]*)\/?>/gi);
  for (const link of linkMatches) {
    const attrs = link[1];
    const title = attrs.match(/\btitle="([^"]+)"/i)?.[1] ?? '';
    if (title !== 'pdf') {
      continue;
    }
    return decodeEntities(attrs.match(/\bhref="([^"]+)"/i)?.[1] ?? '');
  }
  return '';
}

function normalizeArxivId(value: string): string {
  const token = value.trim();
  if (!token) {
    return '';
  }
  return token.replace(/v\d+$/i, '');
}

function arxivIdFromUrl(url: string): string {
  const match = url.match(ARXIV_ABS_ID_RE);
  return match ? normalizeArxivId(match[1]) : '';
}

function parseArxivEntries(xmlText: string): CandidatePaper[] {
  const papers: CandidatePaper[] = [];
  const entryMatches = xmlText.matchAll(/<(?:\w+:)?entry\b[^>]*>([\s\S]*?)<\/(?:\w+:)?entry>/gi);

  for (const entry of entryMatches) {
    const block = entry[1];
    papers.push({
      title: extractTag(block, 'title'),
      abstract: extractTag(block, 'summary'),
      authors: extractAuthors(block),
      url: extractTag(block, 'id'),
      pdf_url: extractPdfUrl(block),
      published: extractTag(block, 'published'),
      updated: extractTag(block, 'updated'),
      score: 0
    });
  }

  return papers;
}

function parseArxivTime(value: string): Date | null {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp);
}

function localDateStamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function fetchLatestRecentIds(categories: string[]): Promise<{ ids: Set<string>; datesByCategory: Record<string, string> }> {
  const pages = await Promise.all(
    categories
      .map((category) => category.trim())
      .filter(Boolean)
      .map(async (category) => {
        const page = await httpGetText(`https://arxiv.org/list/${encodeURIComponent(category)}/recent?show=2000`);
        return { category, page };
      })
  );

  const ids = new Set<string>();
  const datesByCategory: Record<string, string> = {};

  for (const { category, page } of pages) {
    const headingMatch = page.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (headingMatch) {
      datesByCategory[category] = stripMarkup(headingMatch[1]);
    }

    if (!headingMatch) {
      continue;
    }

    const startIndex = headingMatch.index ?? 0;
    const sectionStart = startIndex + headingMatch[0].length;
    const nextHeadingOffset = page.slice(sectionStart).search(/<h3/i);
    const sectionEnd = nextHeadingOffset === -1 ? page.length : sectionStart + nextHeadingOffset;
    const section = page.slice(sectionStart, sectionEnd);

    const rawIds = section.matchAll(/href\s*=\s*"\/abs\/([^"#?]+)"/gi);
    for (const rawId of rawIds) {
      const normalized = normalizeArxivId(rawId[1]);
      if (normalized) {
        ids.add(normalized);
      }
    }
  }

  return { ids, datesByCategory };
}

async function fetchArxivCandidates(categories: string[], maxCandidates = 200): Promise<CandidatePaper[]> {
  const clauses = categories.map((category) => category.trim()).filter(Boolean).map((category) => `cat:${category}`);
  const query = clauses.length > 0 ? clauses.join(' OR ') : 'cat:cs.AI';
  const params = new URLSearchParams({
    search_query: query,
    start: '0',
    max_results: String(maxCandidates),
    sortBy: 'submittedDate',
    sortOrder: 'descending'
  });

  const xmlText = await httpGetText(`http://export.arxiv.org/api/query?${params.toString()}`);
  return parseArxivEntries(xmlText);
}

async function fetchArxivCandidatesFromRecentLists(
  categories: string[],
  maxCandidates = 200
): Promise<{ candidates: CandidatePaper[]; datesByCategory: Record<string, string> }> {
  const { ids, datesByCategory } = await fetchLatestRecentIds(categories);
  if (ids.size === 0) {
    const fallback = await fetchArxivCandidates(categories, maxCandidates);
    return { candidates: fallback, datesByCategory };
  }

  const orderedIds = Array.from(ids);
  const batches: string[][] = [];
  for (let start = 0; start < orderedIds.length; start += 80) {
    batches.push(orderedIds.slice(start, start + 80));
  }

  const responses = await Promise.all(
    batches.map(async (batch) => {
      const params = new URLSearchParams({
        id_list: batch.join(','),
        start: '0',
        max_results: String(batch.length)
      });
      return await httpGetText(`http://export.arxiv.org/api/query?${params.toString()}`);
    })
  );

  const dedup = new Map<string, CandidatePaper>();
  for (const response of responses) {
    for (const paper of parseArxivEntries(response)) {
      const id = arxivIdFromUrl(paper.url);
      if (id) {
        dedup.set(id, paper);
      }
    }
  }

  const candidates = Array.from(dedup.values()).sort((left, right) => {
    const leftTime = parseArxivTime(left.published)?.getTime() ?? 0;
    const rightTime = parseArxivTime(right.published)?.getTime() ?? 0;
    return rightTime - leftTime;
  });

  return { candidates, datesByCategory };
}

function normalizePathLike(value: string): string {
  return value.replace(/\\/g, '/').trim();
}

function globMatches(text: string, pattern: string): boolean {
  const source = normalizePathLike(text);
  const query = normalizePathLike(pattern);
  const memo = new Map<string, boolean>();

  const visit = (patternIndex: number, textIndex: number): boolean => {
    const key = `${patternIndex}:${textIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }

    let result = false;

    if (patternIndex === query.length) {
      result = textIndex === source.length;
    } else if (query[patternIndex] === '*' && query[patternIndex + 1] === '*') {
      result =
        visit(patternIndex + 2, textIndex) ||
        (textIndex < source.length && visit(patternIndex, textIndex + 1));
    } else if (query[patternIndex] === '*') {
      result =
        visit(patternIndex + 1, textIndex) ||
        (textIndex < source.length && source[textIndex] !== '/' && visit(patternIndex, textIndex + 1));
    } else {
      result = textIndex < source.length && query[patternIndex] === source[textIndex] && visit(patternIndex + 1, textIndex + 1);
    }

    memo.set(key, result);
    return result;
  };

  return visit(0, 0);
}

type ZoteroCollection = {
  key?: string;
  data?: {
    name?: string;
    parentCollection?: string;
  };
};

type ZoteroItem = {
  data?: {
    title?: string;
    abstractNote?: string;
    dateAdded?: string;
    collections?: string[];
  };
};

async function fetchZoteroCorpus(
  zoteroId: string,
  zoteroKey: string,
  includePath?: string
): Promise<{ corpus: CorpusPaper[]; debugItems: ZoteroDebugItem[] }> {
  const base = `https://api.zotero.org/users/${encodeURIComponent(zoteroId)}`;
  const headers = {
    'Zotero-API-Key': zoteroKey,
    Accept: 'application/json'
  };

  const collectionQuery = new URLSearchParams({ limit: '100' });
  const itemQuery = new URLSearchParams({
    limit: '100',
    itemType: 'conferencePaper || journalArticle || preprint'
  });

  const [collections, items] = await Promise.all([
    httpGetJson<ZoteroCollection[]>(`${base}/collections?${collectionQuery.toString()}`, headers),
    httpGetJson<ZoteroItem[]>(`${base}/items?${itemQuery.toString()}`, headers)
  ]);

  const keyToCollection = new Map<string, ZoteroCollection>();
  for (const collection of collections) {
    if (collection.key) {
      keyToCollection.set(collection.key, collection);
    }
  }

  const pathCache = new Map<string, string>();
  const getPath = (collectionKey: string): string => {
    if (pathCache.has(collectionKey)) {
      return pathCache.get(collectionKey) ?? '';
    }

    const collection = keyToCollection.get(collectionKey);
    if (!collection?.data?.name) {
      pathCache.set(collectionKey, '');
      return '';
    }

    const parentKey = collection.data.parentCollection;
    const parentPath = parentKey ? getPath(parentKey) : '';
    const path = parentPath ? `${parentPath}/${collection.data.name}` : collection.data.name;
    pathCache.set(collectionKey, path);
    return path;
  };

  const includePattern = includePath?.trim() || '';
  const corpus: CorpusPaper[] = [];
  const debugItems: ZoteroDebugItem[] = [];

  for (const item of items) {
    const data = item.data ?? {};
    const abstract = (data.abstractNote ?? '').trim();
    const collectionKeys = data.collections ?? [];
    const paths = collectionKeys.map((key) => getPath(key)).filter(Boolean);
    const addedDate = data.dateAdded ?? '';

    debugItems.push({
      title: data.title ?? '',
      has_abstract: abstract.length > 0,
      added_date: addedDate,
      paths
    });

    if (!abstract) {
      continue;
    }

    if (includePattern && !paths.some((value) => globMatches(value, includePattern))) {
      continue;
    }

    const parsedDate = parseArxivTime(addedDate) ?? new Date('1970-01-01T00:00:00Z');
    corpus.push({
      title: data.title ?? '',
      abstract,
      addedDate: parsedDate,
      paths
    });
  }

  return { corpus, debugItems };
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{2,}/g) ?? []).filter(Boolean);
}

function buildTfidfVectors(texts: string[]): Array<Map<string, number>> {
  const docs = texts.map((text) => tokenize(text));
  const documentFrequency = new Map<string, number>();

  for (const tokens of docs) {
    const uniqueTerms = new Set(tokens);
    for (const term of uniqueTerms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const documentCount = Math.max(1, docs.length);
  const idf = new Map<string, number>();
  for (const [term, frequency] of documentFrequency) {
    idf.set(term, Math.log((1 + documentCount) / (1 + frequency)) + 1);
  }

  return docs.map((tokens) => {
    if (tokens.length === 0) {
      return new Map<string, number>();
    }

    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    const total = tokens.length;
    const vector = new Map<string, number>();
    for (const [term, count] of tf) {
      vector.set(term, (count / total) * (idf.get(term) ?? 0));
    }
    return vector;
  });
}

function cosineSparse(left: Map<string, number>, right: Map<string, number>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let smaller = left;
  let larger = right;
  if (left.size > right.size) {
    smaller = right;
    larger = left;
  }

  let dot = 0;
  for (const [term, value] of smaller) {
    dot += value * (larger.get(term) ?? 0);
  }

  let leftNorm = 0;
  for (const value of left.values()) {
    leftNorm += value * value;
  }

  let rightNorm = 0;
  for (const value of right.values()) {
    rightNorm += value * value;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function rerank(candidates: CandidatePaper[], corpus: CorpusPaper[], maxResults: number): CandidatePaper[] {
  const sortedCorpus = [...corpus].sort((left, right) => right.addedDate.getTime() - left.addedDate.getTime());
  if (candidates.length === 0 || sortedCorpus.length === 0) {
    return [];
  }

  const allTexts = [...candidates.map((paper) => paper.abstract), ...sortedCorpus.map((paper) => paper.abstract)];
  const vectors = buildTfidfVectors(allTexts);
  const candidateVectors = vectors.slice(0, candidates.length);
  const corpusVectors = vectors.slice(candidates.length);

  const weights = corpusVectors.map((_vector, index) => 1 / (1 + Math.log10(index + 1)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  const normalizedWeights = weights.map((value) => value / totalWeight);

  const corpusTitles = new Set(sortedCorpus.map((paper) => paper.title.toLowerCase().trim()));

  for (const [index, paper] of candidates.entries()) {
    let score = 0;
    for (const [corpusIndex, corpusVector] of corpusVectors.entries()) {
      score += cosineSparse(candidateVectors[index], corpusVector) * normalizedWeights[corpusIndex];
    }

    const publishedAt = parseArxivTime(paper.published);
    let ageDays = 3650;
    if (publishedAt) {
      ageDays = Math.max(0, (Date.now() - publishedAt.getTime()) / 86400000);
    }
    const freshness = Math.exp(-ageDays / 5);
    paper.score = (0.65 * score + 0.35 * freshness) * 10;
  }

  return candidates
    .filter((paper) => !corpusTitles.has(paper.title.toLowerCase().trim()))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, maxResults));
}

export async function generateRecommendations(config: RecommendationConfig): Promise<RecommendationResult> {
  const categories = config.arxivCategories
    .split(',')
    .map((category) => category.trim())
    .filter(Boolean);
  const includePath = config.includePath.trim();

  const [{ corpus, debugItems }, { candidates, datesByCategory }] = await Promise.all([
    fetchZoteroCorpus(config.zoteroId, config.zoteroKey, includePath || undefined),
    fetchArxivCandidatesFromRecentLists(categories, Math.max(config.maxResults, 200))
  ]);

  const ranked = rerank(candidates, corpus, config.maxResults);
  const zoteroWithAbstractCount = debugItems.filter((item) => item.has_abstract).length;

  const result: RecommendationResult = {
    date: localDateStamp(),
    corpus_size: corpus.length,
    candidate_size: candidates.length,
    include_path: includePath,
    arxiv_recent_dates: datesByCategory,
    zotero_total_raw_count: debugItems.length,
    zotero_with_abstract_count: zoteroWithAbstractCount,
    zotero_after_filter_count: corpus.length,
    papers: ranked.map((paper) => ({
      title: paper.title,
      abstract: paper.abstract,
      authors: paper.authors,
      url: paper.url,
      pdf_url: paper.pdf_url,
      published: paper.published,
      score: paper.score
    })),
    zotero_items_raw: debugItems,
    arxiv_candidates_raw: candidates.map((candidate) => ({
      title: candidate.title,
      published: candidate.published,
      url: candidate.url
    }))
  };

  if (corpus.length === 0) {
    if (zoteroWithAbstractCount === 0) {
      result.warning = '没有找到带摘要的 Zotero 条目。';
    } else if (includePath) {
      result.warning = `Zotero 中有 ${zoteroWithAbstractCount} 条带摘要条目，但没有任何条目匹配 includePath="${includePath}"。`;
    } else {
      result.warning = `Zotero 中有 ${zoteroWithAbstractCount} 条带摘要条目，但过滤后结果为空。`;
    }
  }

  return result;
}
