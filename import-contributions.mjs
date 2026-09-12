#!/usr/bin/env node
// A review queue generator, never an automatic publisher. No network requests.
import {writeFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DATA_DIR, readJson, loadDataset, validateDataset, isRecord, isText, safeUrl, sourceIdentity, normalizeExcerpt} from './validate-data.mjs';

const FORMAT = 'sentence-beyond.contribution.v1';
const CASE_KEYS = new Set(['id', 'stock', 'title', 'excerpt', 'sourceUrl', 'sourceLabel', 'publishedAt', 'collectedAt', 'terms', 'category', 'explanation', 'claimType', 'reason', 'checks', 'caution', 'custom', 'sourceNote', 'editorialTitle']);
function requireValue(condition, message) {if (!condition) throw new Error(message);}
function onlyKeys(value, keys, path) {
  requireValue(isRecord(value), `${path}: 객체가 필요합니다.`);
  requireValue(Object.keys(value).every(key => keys.has(key)), `${path}: 허용되지 않은 필드가 있습니다. 개인 백업 대신 자료 제안 내보내기를 사용해 주세요.`);
}
function termAppears(text, name) {
  const haystack = text.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
  const needle = name.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
  if (!/[a-z0-9]/i.test(needle)) return normalizeExcerpt(text).includes(normalizeExcerpt(name));
  let pos = haystack.indexOf(needle);
  while (pos !== -1) {
    const before = haystack[pos - 1] || '', after = haystack[pos + needle.length] || '';
    if (!(/^[a-z0-9]/.test(needle) && /[a-z0-9]/.test(before)) && !(/[a-z0-9]$/.test(needle) && /[a-z0-9]/.test(after))) return true;
    pos = haystack.indexOf(needle, pos + 1);
  }
  return false;
}

export function prepareContribution(payload, dataset) {
  const checked = validateDataset(dataset);
  requireValue(checked.ok, `기존 공개 자료 검증 실패:\n${checked.errors.join('\n')}`);
  onlyKeys(payload, new Set(['format', 'exportedAt', 'stocks', 'cases']), 'contribution');
  requireValue(payload.format === FORMAT, `format은 ${FORMAT}이어야 합니다.`);
  requireValue(isText(payload.exportedAt, 40) && /^\d{4}-\d{2}-\d{2}T/.test(payload.exportedAt) && Number.isFinite(Date.parse(payload.exportedAt)), 'exportedAt: ISO 형식의 내보낸 시각이 필요합니다.');
  requireValue(Array.isArray(payload.stocks) && payload.stocks.length <= 100, 'stocks: 최대 100개 종목을 제안할 수 있습니다.');
  requireValue(Array.isArray(payload.cases) && payload.cases.length <= 500, 'cases: 최대 500개 사례를 제안할 수 있습니다.');
  const stockMap = new Map(dataset.meta.stocks.map(s => [s.code, s]));
  const incomingStocks = new Set(), newStocks = [];
  payload.stocks.forEach((s, i) => {
    const p = `stocks[${i}]`;onlyKeys(s, new Set(['code', 'name', 'sector']), p);
    requireValue(typeof s.code === 'string' && /^\d{6}$/.test(s.code) && isText(s.name, 30), `${p}: 6자리 종목코드와 1~30자 이름이 필요합니다.`);
    requireValue(s.sector === undefined || isText(s.sector, 200), `${p}.sector: 올바른 문자열이 필요합니다.`);
    requireValue(!incomingStocks.has(s.code), `${p}: 제안 종목코드 중복`);incomingStocks.add(s.code);
    if (stockMap.has(s.code)) requireValue(normalizeExcerpt(stockMap.get(s.code).name) === normalizeExcerpt(s.name), `${p}: 기존 종목코드와 이름이 다릅니다.`);
    else {const stock = {code: s.code, name: s.name.trim(), sector: s.sector?.trim() || '직접 추가'};stockMap.set(stock.code, stock);newStocks.push(stock);}
  });
  const ids = new Set(dataset.cases.map(c => c.id)), excerpts = new Set(dataset.cases.map(c => normalizeExcerpt(c.excerpt)));
  const urls = new Set(dataset.cases.map(c => sourceIdentity(c.sourceUrl).key).filter(Boolean));
  const termMap = new Map(dataset.glossary.map(t => [t.id, t]));
  const cases = [], duplicates = [], warnings = [];
  payload.cases.forEach((c, i) => {
    const p = `cases[${i}]`;onlyKeys(c, CASE_KEYS, p);
    requireValue(isText(c.id, 100) && /^user-[a-zA-Z0-9-]+$/.test(c.id), `${p}.id: 직접 추가한 user- ID가 필요합니다.`);
    requireValue(typeof c.stock === 'string' && /^\d{6}$/.test(c.stock) && stockMap.has(c.stock), `${p}.stock: 등록된 6자리 종목코드가 필요합니다.`);
    for (const [field, max, min] of [['title', 100, 1], ['excerpt', 300, 1], ['explanation', 2000, 0], ['collectedAt', 40, 1]]) requireValue(isText(c[field], max, min), `${p}.${field}: 문자열 ${min}~${max}자가 필요합니다.`);
    requireValue(safeUrl(c.sourceUrl), `${p}.sourceUrl: 인증정보 없는 http/https 주소가 필요합니다.`);
    requireValue(c.custom === true, `${p}.custom: 직접 추가한 개인 사례만 제안할 수 있습니다.`);
    requireValue(Array.isArray(c.terms) && c.terms.length > 0 && c.terms.length <= 100 && new Set(c.terms).size === c.terms.length, `${p}.terms: 중복 없는 용어 ID 배열이 필요합니다.`);
    c.terms.forEach((id, j) => {
      const term = termMap.get(id);requireValue(term, `${p}.terms[${j}]: 용어집에 없는 ID입니다.`);
      requireValue([term.name, ...term.aliases].some(name => termAppears(c.excerpt, name)), `${p}.terms[${j}]: 원문에서 해당 용어를 찾을 수 없습니다.`);
    });
    for (const field of ['sourceLabel', 'publishedAt', 'category', 'claimType', 'reason', 'caution', 'sourceNote']) requireValue(c[field] === undefined || isText(c[field], 4000, 0), `${p}.${field}: 잘못된 문자열입니다.`);
    requireValue(c.checks === undefined || Array.isArray(c.checks) && c.checks.length === 0, `${p}.checks: 개인 제안의 검증 질문은 비워 두세요.`);
    requireValue(c.editorialTitle === undefined || typeof c.editorialTitle === 'boolean', `${p}.editorialTitle: 불리언이 필요합니다.`);
    const identity = sourceIdentity(c.sourceUrl), excerptKey = normalizeExcerpt(c.excerpt);
    const reason = ids.has(c.id) ? 'id' : excerpts.has(excerptKey) ? 'excerpt' : identity.key && urls.has(identity.key) ? 'postUrl' : null;
    if (reason) {duplicates.push({id: c.id, reason});return;}
    ids.add(c.id);excerpts.add(excerptKey);if (identity.key) urls.add(identity.key);
    const flags = ['원문·해석 미검증', '공개 전 개인정보·인용 범위 검토 필요'];
    if (identity.kind === 'feed') flags.push('개별 글 링크 미확보 · 종목 피드');
    if (!c.explanation.trim()) flags.push('해석 미작성');
    if (c.excerpt.trim().split(/\s+/).length > 25) flags.push('공개용 25단어 발췌 기준 초과');
    warnings.push({id: c.id, flags});
    cases.push({
      id: c.id, stock: c.stock, title: c.title.trim(), excerpt: c.excerpt.trim(), sourceUrl: safeUrl(c.sourceUrl),
      sourceLabel: '개인 학습장에서 제안 · 검토 전', publishedAt: c.publishedAt || '작성일 미확인', collectedAt: c.collectedAt,
      sourceNote: identity.kind === 'feed' ? '개별 글 링크 미확보 · 링크는 종목 피드로 연결됩니다.' : '제안자가 입력한 출처 · 원문 확인 전',
      terms: [...c.terms], category: '직접 추가', explanation: c.explanation.trim(), claimType: '미분류',
      reason: '개인 학습장 제안입니다. 공개 반영 전에 원문과 용어 해석을 검토해 주세요.', checks: [],
      caution: '직접 추가 · 미검증. 원문·해석·주장의 근거를 확인하지 않았습니다.', custom: true,
      provenance: {format: payload.format, exportedAt: payload.exportedAt, originalId: c.id, reviewStatus: 'pending', originalSourceLabel: c.sourceLabel || null, originalClaimType: c.claimType || null, originalSourceNote: c.sourceNote || null}
    });
  });
  const used = new Set(cases.map(c => c.stock));
  return {format: 'sentence-beyond.review.v1', status: 'pending', generatedAt: new Date().toISOString(), source: {format: payload.format, exportedAt: payload.exportedAt, sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex')}, note: '검토 전 제안 파일입니다. 공개 데이터로 자동 반영되지 않습니다. 원문·해석·출처·개인정보·인용 범위를 확인한 뒤 cases.json 및 meta.json에 수동 반영하세요.', stocks: newStocks.filter(s => used.has(s.code)), cases, duplicates, warnings};
}

async function main() {
  const args = process.argv.slice(2);let input, directory = DATA_DIR, output, write = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && args[i + 1]) directory = resolve(args[++i]);
    else if (args[i] === '--out' && args[i + 1]) output = resolve(args[++i]);
    else if (args[i] === '--write') write = true;
    else if (args[i] === '--help') {console.log('node import-contributions.mjs INPUT.json [--data-dir DIRECTORY]\nnode import-contributions.mjs INPUT.json --write --out REVIEW.json\n기본 dry-run은 검사 요약만 출력합니다. --write도 새 검토 JSON만 만들며 공개 자료를 수정하지 않습니다. 기존 파일은 덮어쓰지 않습니다.');return;}
    else if (!args[i].startsWith('-') && !input) input = resolve(args[i]);
    else throw new Error('알 수 없는 인자입니다. --help를 확인해 주세요.');
  }
  requireValue(input, '제안 JSON 파일 경로가 필요합니다. --help를 확인해 주세요.');
  requireValue(write === !!output, '검토 파일 저장은 --write와 --out REVIEW.json을 함께 지정해야 합니다.');
  if (write) requireValue(extname(output).toLowerCase() === '.json', '--out에는 새 .json 파일 경로를 지정해 주세요.');
  const payload = await readJson(input, 2 * 1024 * 1024);
  const review = prepareContribution(payload, await loadDataset(directory));
  if (write) await writeFile(output, JSON.stringify(review, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({mode: write ? 'review-file' : 'dry-run', accepted: review.cases.length, duplicates: review.duplicates.length, newStocks: review.stocks.length, needsReview: review.warnings.length, output: write ? output : null, published: false, note: '검사 통과는 내용 검증이나 공개 승인이 아닙니다. 공개 데이터는 변경하지 않았습니다.'}, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => {console.error(e.code === 'EEXIST' ? '출력 파일이 이미 있습니다. 새 경로를 지정해 주세요.' : e.message);process.exitCode = 1;});
