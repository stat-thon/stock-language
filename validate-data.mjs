#!/usr/bin/env node
// Dependency-free validation. This never fetches links or changes source files.
import {open} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const DATA_DIR = dirname(fileURLToPath(import.meta.url));
export const normalizeExcerpt = value => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
export const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
export const isText = (value, max, min = 1) => typeof value === 'string' && value.trim().length >= min && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

export function safeUrl(value) {
  if (!isText(value, 2000) || value !== value.trim() || /\s|\\/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function sourceIdentity(value) {
  const safe = safeUrl(value);
  if (!safe) throw new Error('올바른 http/https 출처 주소가 필요합니다.');
  const url = new URL(safe);
  const toss = /(^|\.)tossinvest\.com$/.test(url.hostname);
  const stockPath = toss && url.pathname.match(/^\/stocks\/([^/]+)\/community\/?$/);
  const directPath = toss && url.pathname.match(/^\/community\/posts\/(\d+)\/?$/);
  if (directPath) return {kind: 'post', key: `toss-post:${directPath[1]}`};
  if (stockPath) {
    if (!url.searchParams.has('post')) return {kind: 'feed', key: null};
    const ids = url.searchParams.getAll('post');
    if (ids.length !== 1 || !/^\d+$/.test(ids[0])) throw new Error('토스 개별 글 주소의 post는 숫자 ID 하나여야 합니다.');
    return {kind: 'post', key: `toss-post:${ids[0]}`};
  }
  url.hash = '';
  for (const name of [...url.searchParams.keys()]) if (/^utm_/i.test(name) || ['fbclid', 'gclid'].includes(name)) url.searchParams.delete(name);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return {kind: 'url', key: url.href};
}

export async function readJson(file, maxBytes = 5 * 1024 * 1024) {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error(`${file}: 일반 JSON 파일이어야 하며 ${maxBytes}바이트를 넘을 수 없습니다.`);
    // Bound the actual read as well as stat, in case the file grows concurrently.
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const {bytesRead} = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new Error(`${file}: JSON 파일 크기 제한을 넘었습니다.`);
    try { return JSON.parse(buffer.subarray(0, length).toString('utf8').replace(/^\uFEFF/, '')); }
    catch { throw new Error(`${file}: JSON 문법을 확인해 주세요.`); }
  } finally { await handle.close(); }
}

export async function loadDataset(directory = DATA_DIR) {
  const [cases, glossary, meta] = await Promise.all(['cases.json', 'glossary.json', 'meta.json'].map(name => readJson(join(directory, name))));
  return {cases, glossary, meta};
}

export function validateDataset({cases, glossary, meta}) {
  const errors = [], warnings = [];
  const fail = (path, message) => errors.push(`${path}: ${message}`);
  const text = (v, path, max = 4000, min = 1) => {if (!isText(v, max, min)) fail(path, `문자열 ${min}~${max}자가 필요합니다.`);};
  const array = (v, path, max, min = 0) => {const ok = Array.isArray(v) && v.length >= min && v.length <= max;if (!ok) fail(path, `배열 ${min}~${max}개가 필요합니다.`);return ok;};
  const record = (v, path) => {if (!isRecord(v)) {fail(path, '객체가 필요합니다.');return false;}return true;};
  const url = (v, path) => {if (!safeUrl(v)) fail(path, '인증정보 없는 http/https URL이 필요합니다.');};
  const sources = (values, path) => {if (array(values, path, 30, 1)) values.forEach((s, i) => {if (record(s, `${path}[${i}]`)) {text(s.label, `${path}[${i}].label`, 300);url(s.url, `${path}[${i}].url`);}});};
  const termIds = new Set(), stockCodes = new Set(), caseIds = new Set(), excerpts = new Set(), postKeys = new Map();
  if (array(glossary, 'glossary', 2000, 1)) glossary.forEach((t, i) => {
    const p = `glossary[${i}]`;if (!record(t, p)) return;
    if (!isText(t.id, 100) || !/^[a-z0-9][a-z0-9-]*$/.test(t.id)) fail(`${p}.id`, '영문 소문자·숫자·하이픈 ID가 필요합니다.');
    if (termIds.has(t.id)) fail(`${p}.id`, '용어 ID 중복');termIds.add(t.id);
    for (const key of ['name', 'category', 'level']) text(t[key], `${p}.${key}`, 100);
    for (const key of ['definition', 'example', 'pitfall', 'check']) text(t[key], `${p}.${key}`);
    if (array(t.aliases, `${p}.aliases`, 100)) t.aliases.forEach((a, j) => text(a, `${p}.aliases[${j}]`, 150));
    sources(t.sources, `${p}.sources`);
  });
  if (record(meta, 'meta')) {
    text(meta.collectedAt, 'meta.collectedAt', 100);
    for (const key of ['method', 'apiStatus', 'selectionNote']) text(meta[key], `meta.${key}`, 10000);
    if (array(meta.limitations, 'meta.limitations', 100, 1)) meta.limitations.forEach((s, i) => text(s, `meta.limitations[${i}]`, 4000));
    sources(meta.sources, 'meta.sources');
    if (array(meta.stocks, 'meta.stocks', 1000, 1)) meta.stocks.forEach((s, i) => {
      const p = `meta.stocks[${i}]`;if (!record(s, p)) return;
      if (typeof s.code !== 'string' || !/^\d{6}$/.test(s.code)) fail(`${p}.code`, '6자리 국내 종목코드가 필요합니다.');
      if (stockCodes.has(s.code)) fail(`${p}.code`, '종목코드 중복');stockCodes.add(s.code);
      text(s.name, `${p}.name`, 100);text(s.sector, `${p}.sector`, 200);
    });
  }
  if (array(cases, 'cases', 10000)) cases.forEach((c, i) => {
    const p = `cases[${i}]`;if (!record(c, p)) return;
    if (!isText(c.id, 100) || !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(c.id)) fail(`${p}.id`, '영문·숫자·하이픈 ID가 필요합니다.');
    if (caseIds.has(c.id)) fail(`${p}.id`, '사례 ID 중복');caseIds.add(c.id);
    if (!stockCodes.has(c.stock)) fail(`${p}.stock`, 'meta.stocks에 없는 종목코드');
    for (const key of ['title', 'category', 'claimType', 'publishedAt', 'collectedAt', 'sourceLabel']) text(c[key], `${p}.${key}`, 300);
    for (const key of ['explanation', 'reason', 'caution', 'sourceNote']) text(c[key], `${p}.${key}`, 10000);
    for (const [key,max] of [['postSummary',2000],['sourceAuthor',200],['sourceVerifiedAt',100],['samePostGroup',100]]) if(c[key]!==undefined)text(c[key],`${p}.${key}`,max);
    if(c.postSummaryScope!==undefined&&!['full','partial'].includes(c.postSummaryScope))fail(`${p}.postSummaryScope`,'full 또는 partial만 사용할 수 있습니다.');
    if(c.sourceShareUrl!==undefined)url(c.sourceShareUrl,`${p}.sourceShareUrl`);
    if(c.postSummary!==undefined&&!isText(c.sourceVerifiedAt,100))fail(`${p}.sourceVerifiedAt`,'맥락 요약에는 비어 있지 않은 원문 확인일이 필요합니다.');
    text(c.excerpt, `${p}.excerpt`, 1000);
    if (isText(c.excerpt, 1000)) {
      const normalized = normalizeExcerpt(c.excerpt);
      if (excerpts.has(normalized)) fail(`${p}.excerpt`, '공백·대소문자·유니코드 정규화 후 발췌 중복');excerpts.add(normalized);
      if (c.excerpt.trim().split(/\s+/).length > 25) fail(`${p}.excerpt`, '학습용 발췌는 공백 기준 25단어 이내로 줄여 주세요.');
    }
    url(c.sourceUrl, `${p}.sourceUrl`);
    if (safeUrl(c.sourceUrl)) try {
      const identity = sourceIdentity(c.sourceUrl);
      if(c.postSummary!==undefined&&identity.kind!=='post')fail(`${p}.postSummary`,'글 전체의 맥락은 개별 게시물 URL을 확인한 사례에만 추가할 수 있습니다.');
      if(identity.key) {
        const previous=postKeys.get(identity.key);
        const words=isText(c.excerpt,1000)?c.excerpt.trim().split(/\s+/).length:0;
        if(previous) {
          if(identity.kind!=='post'||!isText(c.samePostGroup,100)||!isText(previous.group,100)||c.samePostGroup!==previous.group)fail(`${p}.sourceUrl`,'같은 개별 글 URL 중복: 같은 원문의 별도 논점은 모든 사례에 동일한 samePostGroup을 명시해 주세요.');
          previous.words+=words;
        } else postKeys.set(identity.key,{kind:identity.kind,group:c.samePostGroup,words,path:p});
      }
      if (identity.kind === 'feed' && !/피드|개별 글|직접 링크/.test(c.sourceNote || '')) fail(`${p}.sourceNote`, '피드 링크의 한계를 명시해 주세요.');
    } catch (e) {fail(`${p}.sourceUrl`, e.message);}
    if (c.custom === true || c.provenance?.reviewStatus === 'pending') fail(p, '검토 전 개인 제안은 cases.json에 자동 공개할 수 없습니다.');
    if (c.editorialTitle !== undefined && typeof c.editorialTitle !== 'boolean') fail(`${p}.editorialTitle`, '불리언이 필요합니다.');
    if (array(c.terms, `${p}.terms`, 100, 1)) {
      if (new Set(c.terms).size !== c.terms.length) fail(`${p}.terms`, '중복 용어 참조');
      c.terms.forEach((t, j) => {if (!termIds.has(t)) fail(`${p}.terms[${j}]`, 'glossary에 없는 용어 ID');});
    }
    if (array(c.checks, `${p}.checks`, 30, 1)) c.checks.forEach((check, j) => {
      const q = `${p}.checks[${j}]`;if (!record(check, q)) return;
      text(check.question, `${q}.question`, 1000);text(check.detail, `${q}.detail`, 10000);
      if (check.url !== undefined) {url(check.url, `${q}.url`);text(check.label, `${q}.label`, 300);}
    });
  });
  for(const post of postKeys.values())if(post.kind==='post'&&post.words>25)fail(`${post.path}.excerpt`,`동일 원문의 모든 발췌 합계는 25단어 이내여야 합니다. 현재 ${post.words}단어입니다.`);
  return {ok: errors.length === 0, errors, warnings, counts: {cases: Array.isArray(cases) ? cases.length : 0, terms: termIds.size, stocks: stockCodes.size}};
}

async function main() {
  const args = process.argv.slice(2);let directory = DATA_DIR, json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && args[i + 1]) directory = resolve(args[++i]);
    else if (args[i] === '--json') json = true;
    else if (args[i] === '--help') {console.log('node validate-data.mjs [--data-dir DIRECTORY] [--json]\n사례·용어·출처·종목 참조를 검사합니다. 파일 변경이나 네트워크 요청은 없습니다.');return;}
    else throw new Error('사용법: node validate-data.mjs [--data-dir DIRECTORY] [--json]');
  }
  const result = validateDataset(await loadDataset(directory));
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log(`PASS 데이터: ${result.counts.cases}개 사례 · ${result.counts.terms}개 용어 · ${result.counts.stocks}개 종목 · 필수 필드·중복·URL·참조 검사`);
  else console.error(result.errors.join('\n'));
  if (!result.ok) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => {console.error(e.message);process.exitCode = 1;});
