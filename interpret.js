/* 글 해석하기: explicit local connection, ephemeral input, safe streamed text. */
(() => {
  'use strict';
  const DEFAULT_BRIDGE = 'http://127.0.0.1:8767';
  const LOCAL = location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname) && location.port === '8767';
  const BRIDGE = LOCAL ? location.origin : DEFAULT_BRIDGE;
  const SESSION_KEY = 'sentence-beyond.interpret.session.v1';
  const LIMIT = 12000;
  const EXAMPLE = '학습용 가상 문장입니다. 가상정밀의 PER는 16.7배이고 EPS는 전년보다 50% 늘었다. 그런데 순이익은 90억 원, 영업활동현금흐름은 130억 원이며 설비투자 60억 원을 뺀 FCF는 70억 원이다. PER가 낮아 보이면 저평가라고 판단해도 될까?';
  let root, ui, token = '', initialized = false, connecting = false, ready = false, remoteBusy = false;
  let popup = null, popupTimer = null, pairingTimeout = null, connectionController = null;
  let running = false, controller = null, stopped = false, result = '', outcome = 'empty', submittedSource = '';

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (action, label, primary = false) => {
    const node = el('button', `button${primary ? ' primary' : ''}`, label);
    node.type = 'button'; node.dataset.interpretAction = action;
    return node;
  };
  const link = (text, url) => {
    const node = el('a', '', text); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
  };
  function safeURL(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; }
    catch { return ''; }
  }
  function validToken(value) { return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(value); }
  function rememberToken(value) {
    token = validToken(value) ? value : '';
    try {
      if (token) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ bridge: BRIDGE, token }));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* The current tab can still connect when browser storage is unavailable. */ }
  }
  function restoreToken() {
    try { const data = JSON.parse(sessionStorage.getItem(SESSION_KEY)); if (data?.bridge === BRIDGE && validToken(data.token)) token = data.token; }
    catch { /* Treat unavailable or malformed storage as disconnected. */ }
  }
  function setMessage(text = '', error = false) {
    ui.message.textContent = text; ui.message.hidden = !text; ui.message.classList.toggle('is-error', error);
  }
  function connection(text, state = 'idle') {
    ui.connectionStatus.textContent = text; ui.connection.dataset.state = state; updateControls();
  }
  function status(text, state = outcome) {
    ui.status.textContent = text; ui.resultPanel.dataset.state = state;
  }
  function updateControls() {
    if (!ui) return;
    ui.connect.disabled = connecting || running;
    ui.connect.textContent = connecting ? '연결 확인 중…' : token ? '연결 확인' : '이 Mac 연결';
    ui.disconnect.hidden = !token; ui.disconnect.disabled = connecting || running;
    ui.analyze.disabled = running || connecting;
    ui.analyze.textContent = running ? '해석 중…' : '글 해석하기';
    ui.stop.hidden = !running; ui.stop.disabled = !running || stopped;
    ui.example.disabled = running;
    ui.copy.disabled = !result || running;
    ui.form.setAttribute('aria-busy', String(running));
    ui.resultPanel.setAttribute('aria-busy', String(running));
  }
  function clearPairing() {
    clearInterval(popupTimer); clearTimeout(pairingTimeout); popupTimer = pairingTimeout = null; popup = null;
  }
  class BridgeError extends Error {
    constructor(message, code = '', httpStatus = 0) { super(message); this.code = code; this.httpStatus = httpStatus; }
  }
  async function responseError(response) {
    let body;
    try { body = await response.json(); } catch { body = {}; }
    const defaults = {
      400: '입력한 본문과 출처 주소를 확인해 주세요.',
      401: '연결 승인이 만료되었어요. 이 Mac을 다시 연결해 주세요.',
      403: '이 사이트의 연결이 허용되지 않았어요. Mac에서 직접 열거나 연결을 다시 승인해 주세요.',
      409: '이 Mac에서 다른 해석을 진행 중이에요. 끝난 뒤 연결 확인을 눌러 다시 시도해 주세요.',
      429: '요청이 잠시 제한되었어요. 아래 안내를 확인한 뒤 다시 시도해 주세요.',
      503: 'Mac의 분석 도구를 사용할 수 없어요. 실행 상태와 Codex 로그인을 확인해 주세요.',
    };
    const code = typeof body?.code === 'string' ? body.code : typeof body?.error?.code === 'string' ? body.error.code : '';
    const detail = typeof body?.message === 'string' ? body.message : typeof body?.error?.message === 'string' ? body.error.message : '';
    return new BridgeError([defaults[response.status] || `요청을 완료하지 못했어요 (HTTP ${response.status}).`, detail.slice(0, 1500)].filter(Boolean).join(' '), code, response.status);
  }
  async function jsonRequest(path, authenticated = false) {
    const control = new AbortController(); connectionController = control;
    const timeout = setTimeout(() => control.abort(), 10000);
    try {
      const response = await fetch(BRIDGE + path, { headers: authenticated ? { Authorization: `Bearer ${token}` } : {}, signal: control.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw await responseError(response);
      return await response.json();
    } finally { clearTimeout(timeout); if (connectionController === control) connectionController = null; }
  }
  function connectionFailure(error) {
    ready = false; remoteBusy = false;
    if (error.httpStatus === 401 || error.httpStatus === 403) rememberToken('');
    const message = error instanceof BridgeError ? error.message : '이 Mac의 분석 도구에 연결하지 못했어요. Mac 연결 프로그램을 켜 주세요. 브라우저가 연결을 막으면 아래 ‘Mac에서 열기’를 이용해 주세요.';
    connection('연결을 확인해 주세요', 'error'); setMessage(message, true);
  }
  async function checkConnection(getLocalSession = false) {
    if (connecting || running) return;
    connecting = true; ready = false; remoteBusy = false; setMessage(); connection('Mac과 연결을 확인하고 있어요', 'pending');
    try {
      const health = await jsonRequest('/health');
      if (health?.ok !== true || health.version !== 1) throw new BridgeError('분석 도구의 버전이 맞지 않아요. 저장소의 최신 버전으로 다시 실행해 주세요.');
      if (getLocalSession && LOCAL) {
        const session = await jsonRequest('/api/session');
        if (!validToken(session?.token)) throw new BridgeError('Mac의 연결 승인을 받지 못했어요. 분석 도구를 다시 실행해 주세요.');
        rememberToken(session.token);
      }
      if (!token) throw new BridgeError('이 Mac 연결을 눌러 연결을 승인해 주세요.');
      const state = await jsonRequest('/api/status', true);
      if (typeof state?.authenticated !== 'boolean' || typeof state?.busy !== 'boolean') throw new BridgeError('연결 상태 응답을 읽지 못했어요. 분석 도구를 업데이트해 주세요.');
      ready = state.authenticated; remoteBusy = state.busy;
      if (!ready) {
        connection('Mac 연결됨 · Codex 로그인 필요', 'error');
        setMessage('Mac에서 Codex 로그인을 마친 뒤 ‘연결 확인’을 눌러 주세요.', true);
      } else if (remoteBusy) {
        connection('Mac 연결됨 · 다른 해석 진행 중', 'pending');
        setMessage('진행 중인 해석이 끝난 뒤 ‘연결 확인’을 눌러 주세요.');
      } else connection('이 Mac의 Codex와 연결됨', 'ready');
    } catch (error) { connectionFailure(error); }
    finally { connecting = false; updateControls(); }
  }
  function connect() {
    if (connecting || running) return;
    if (LOCAL) { void checkConnection(!token); return; }
    if (token) { void checkConnection(); return; }
    if (!['http:', 'https:'].includes(location.protocol) || location.origin === 'null') {
      setMessage('파일로 연 화면에서는 연결을 승인할 수 없어요. ‘Mac에서 열기’로 분석 도구의 사이트를 이용해 주세요.', true); return;
    }
    clearPairing(); setMessage();
    popup = window.open(`${BRIDGE}/pair?origin=${encodeURIComponent(location.origin)}`, 'sentence-beyond-pair', 'popup,width=560,height=680');
    if (!popup) { connection('연결 승인 창을 열어 주세요', 'error'); setMessage('팝업이 차단되었어요. 이 사이트의 팝업을 허용하고 다시 연결해 주세요. ‘Mac에서 열기’도 이용할 수 있어요.', true); return; }
    connecting = true; connection('새 창에서 이 사이트의 연결을 승인해 주세요', 'pending');
    popupTimer = setInterval(() => {
      if (popup?.closed) { clearPairing(); connecting = false; connection('연결 승인을 기다리고 있어요'); setMessage('연결 승인이 완료되지 않았어요. 이 Mac 연결을 다시 눌러 주세요.'); }
    }, 500);
    pairingTimeout = setTimeout(() => {
      clearPairing(); connecting = false; connection('연결 승인이 완료되지 않았어요', 'error'); setMessage('Mac 연결 프로그램을 켠 뒤 다시 연결해 주세요. 연결이 차단되면 ‘Mac에서 열기’를 이용해 주세요.', true);
    }, 120000);
  }
  async function paired(event) {
    if (event.origin !== BRIDGE || !popup || event.source !== popup || event.data?.type !== 'stock-language-paired' || !validToken(event.data.token)) return;
    rememberToken(event.data.token); clearPairing(); connecting = false; await checkConnection();
  }
  function disconnect() {
    if (running || connecting) return;
    clearPairing(); rememberToken(''); ready = false; remoteBusy = false;
    connection('이 Mac에 연결되지 않았어요'); setMessage('이 탭의 연결 승인을 지웠어요. 입력한 글과 현재 결과는 화면에 남아 있습니다.');
  }
  function validate() {
    ui.text.removeAttribute('aria-invalid'); ui.source.removeAttribute('aria-invalid');
    const text = ui.text.value.trim(), source = ui.source.value.trim();
    if (!text || safeURL(text)) {
      ui.text.setAttribute('aria-invalid', 'true'); ui.text.focus();
      setMessage('본문을 붙여넣어 주세요. 링크는 출처로 표시하며 본문을 자동 조회하지 않습니다.', true); return null;
    }
    if (ui.text.value.length > LIMIT) {
      ui.text.setAttribute('aria-invalid', 'true'); ui.text.focus(); setMessage('본문은 12,000자까지 해석할 수 있어요. 필요한 문단을 나눠 붙여넣어 주세요.', true); return null;
    }
    if (source && (source.length > 2048 || !safeURL(source))) {
      ui.source.setAttribute('aria-invalid', 'true'); ui.source.focus(); setMessage('출처는 http 또는 https로 시작하는 주소를 입력해 주세요. 로그인 정보가 포함된 주소는 사용할 수 없어요.', true); return null;
    }
    return { text, sourceUrl: source ? safeURL(source) : '' };
  }
  async function readEvents(response, signal) {
    if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) throw new BridgeError('해석 결과의 응답 형식을 읽지 못했어요. 다시 시도해 주세요.');
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8');
    let buffer = '', lines = [], done = false;
    function dispatch() {
      if (!lines.length) return;
      const payload = lines.join('\n'); lines = [];
      let event; try { event = JSON.parse(payload); } catch { throw new BridgeError('해석 결과의 일부를 읽지 못했어요. 완성되지 않은 결과입니다.'); }
      if (!event || typeof event.type !== 'string') throw new BridgeError('해석 결과의 형식을 확인하지 못했어요.');
      if (event.type === 'error') throw new BridgeError(typeof event.message === 'string' ? event.message.slice(0, 2000) : '해석을 완료하지 못했어요. 다시 시도해 주세요.', typeof event.code === 'string' ? event.code : '');
      if (event.type === 'done') { done = true; return; }
      if (event.type === 'status' && typeof event.text === 'string') status(event.text.slice(0, 1000), 'running');
      if (event.type === 'delta' && typeof event.text === 'string') {
        if (result.length + event.text.length > 500000) throw new BridgeError('결과가 너무 길어 해석을 멈췄어요. 본문을 나눠 다시 시도해 주세요.');
        result += event.text; ui.result.textContent = result; ui.empty.hidden = Boolean(result);
      }
    }
    function line(value) {
      if (value === '') dispatch();
      else if (value === 'data') lines.push('');
      else if (value.startsWith('data:')) lines.push(value.slice(5).replace(/^ /, ''));
    }
    function consume(final = false) {
      let at = 0;
      for (let i = 0; i < buffer.length && !done; i++) {
        if (buffer[i] !== '\n' && buffer[i] !== '\r') continue;
        if (buffer[i] === '\r' && i === buffer.length - 1 && !final) break;
        const value = buffer.slice(at, i);
        if (buffer[i] === '\r' && buffer[i + 1] === '\n') i++;
        at = i + 1; line(value);
      }
      buffer = buffer.slice(at);
      if (buffer.length > 1000000) throw new BridgeError('해석 응답을 읽을 수 없어요. 다시 시도해 주세요.');
      if (final && !done) { if (buffer) line(buffer); buffer = ''; dispatch(); }
    }
    try {
      while (!done) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done }); consume(chunk.done);
        if (chunk.done) break;
      }
      if (!done) throw new BridgeError('완료 신호를 받기 전에 연결이 끝났어요. 아래 내용은 일부 결과이며 다시 해석할 수 있습니다.');
      if (!result.trim()) throw new BridgeError('완료 신호는 받았지만 해석 내용이 없어요. 다시 시도해 주세요.');
    } finally { try { await reader.cancel(); } catch { /* Abort closes the stream. */ } reader.releaseLock(); }
  }
  async function analyze(event) {
    event?.preventDefault(); if (running || connecting) return;
    const input = validate(); if (!input) return;
    if (!ready || !token) { setMessage('먼저 ‘이 Mac 연결’ 또는 ‘연결 확인’을 눌러 Codex 연결을 확인해 주세요.', true); ui.connect.focus(); return; }
    if (remoteBusy) { setMessage('다른 해석이 끝난 뒤 ‘연결 확인’을 눌러 다시 시도해 주세요.', true); return; }
    running = true; stopped = false; result = ''; outcome = 'running'; submittedSource = input.sourceUrl;
    controller = new AbortController(); const active = controller;
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; active.abort(); }, 120000);
    ui.result.textContent = ''; ui.empty.hidden = false; ui.empty.textContent = '문장의 뜻과 확인할 근거를 읽고 있어요.';
    ui.copyFallback.hidden = true; ui.copyFeedback.textContent = ''; ui.provenance.replaceChildren();
    if (submittedSource) ui.provenance.append(link('입력한 출처 열기', submittedSource), el('span', '', '본문 자동 조회 없이 입력한 문장을 해석합니다.'));
    setMessage(); status('해석을 요청하고 있어요', 'running'); updateControls();
    try {
      const response = await fetch(BRIDGE + '/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(input), signal: active.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
      if (!response.ok) throw await responseError(response);
      await readEvents(response, active.signal);
      if (active.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      outcome = 'done'; status('해석 완료 · 근거는 원자료와 대조해 주세요', outcome);
    } catch (error) {
      if (timedOut) {
        outcome = 'error'; status(result ? '시간 초과 · 완료되지 않은 일부 결과' : '해석 시간이 초과되었어요', outcome);
        setMessage('2분 동안 해석이 완료되지 않아 연결을 중지했어요. 본문을 나누거나 Mac의 연결 상태를 확인한 뒤 다시 시도해 주세요.', true);
      } else if (stopped || active.signal.aborted) {
        outcome = 'stopped'; status(result ? '중지됨 · 여기까지는 일부 결과입니다' : '해석을 중지했어요', outcome);
      } else {
        outcome = 'error'; status(result ? '완료되지 않음 · 일부 결과' : '해석을 완료하지 못했어요', outcome);
        if (error.httpStatus === 401 || error.httpStatus === 403) { rememberToken(''); ready = false; connection('이 Mac을 다시 연결해 주세요', 'error'); }
        if (error.httpStatus === 409) remoteBusy = true;
        const limitError = error.code === 'usage_limit';
        const detail = error instanceof BridgeError ? error.message : 'Mac과의 연결이 끊겼어요. 분석 도구가 실행 중인지 확인한 뒤 다시 시도해 주세요.';
        setMessage(`${limitError ? 'Codex 사용 한도를 확인해 주세요. ' : ''}${detail}`, true);
      }
      if (!result) ui.empty.textContent = '본문을 확인한 뒤 다시 해석할 수 있어요.';
    } finally { clearTimeout(deadline); running = false; if (controller === active) controller = null; updateControls(); }
  }
  function stop() {
    if (!running || !controller) return;
    stopped = true; controller.abort(); status('중지 요청 중… · 받은 내용은 화면에 남습니다', 'stopped'); updateControls();
  }
  function copyText() {
    return ['문장 너머 · 글 해석', outcome === 'done' ? 'AI 해석 초안 · 원자료 확인 필요' : '완료되지 않은 일부 결과', submittedSource ? `입력한 출처: ${submittedSource}` : '', '', result].filter((item, index) => item || index === 3).join('\n');
  }
  async function copy() {
    if (!result || running) return;
    try { await navigator.clipboard.writeText(copyText()); ui.copyFeedback.textContent = '결과를 복사했어요.'; ui.copyFallback.hidden = true; }
    catch { ui.copyFallback.hidden = false; ui.copyArea.value = copyText(); ui.copyArea.focus(); ui.copyArea.select(); ui.copyFeedback.textContent = '자동 복사가 차단되었어요. 아래 선택된 내용을 복사해 주세요.'; }
  }
  function init() {
    root = document.getElementById('interpret-page'); if (!root) return;
    initialized = true; restoreToken(); root.classList.add('interpret-lab');
    const heading = el('header', 'page-heading interpret-heading');
    const headingCopy = el('div'); headingCopy.append(el('p', 'quiet-label', '내가 가져온 문장으로 연습하기'), el('h1', '', '어려운 글,\n뜻부터 풀어 읽기'), el('p', '', '주식 글을 붙여넣으면 용어와 주장, 확인할 근거를 나눠 읽습니다.'));
    heading.append(headingCopy, el('p', 'interpret-heading-note', '맞는 말처럼 들리는 문장도\n뜻과 근거를 따로 살펴보세요.'));
    const connectionBox = el('section', 'interpret-connection'); connectionBox.setAttribute('aria-label', 'Mac 연결');
    const connectionCopy = el('div');
    const connectionStatus = el('p', 'interpret-connection-status', '이 Mac에 연결되지 않았어요'); connectionStatus.id = 'interpret-connection-status'; connectionStatus.setAttribute('role', 'status');
    connectionCopy.append(connectionStatus, el('p', 'interpret-connection-help', 'Mac 연결 프로그램을 켠 뒤 연결해 주세요. 공개 사이트는 분석 도구에 자동 연결하지 않습니다.'));
    const connectionActions = el('div', 'interpret-connection-actions'), connectButton = button('connect', '이 Mac 연결'), disconnectButton = button('disconnect', '연결 해제'); disconnectButton.hidden = true;
    connectionActions.append(connectButton, disconnectButton, link('Mac에서 열기 ↗', BRIDGE + '/#interpret'));
    const publication = window.STUDY_DATA?.meta?.publication;
    const repository = safeURL(publication?.repositoryUrl || '') || 'https://github.com/stat-thon/stock-language';
    const docs = link('연결 도움말 ↗', repository.replace(/\/$/, '') + '/blob/main/BRIDGE.md');
    connectionActions.append(docs); connectionBox.append(connectionCopy, connectionActions);
    const workspace = el('div', 'interpret-workspace');
    const form = el('form', 'interpret-input-panel'); form.noValidate = true;
    const inputHeading = el('div', 'interpret-panel-heading'); inputHeading.append(el('h2', '', '01  읽고 싶은 글'), el('span', '', '본문 직접 입력'));
    const textLabel = el('label', 'interpret-label', '본문'), textarea = el('textarea'); textLabel.htmlFor = 'interpret-text'; textarea.id = 'interpret-text'; textarea.maxLength = LIMIT; textarea.rows = 11; textarea.placeholder = '이해하고 싶은 글의 본문을 여기에 붙여넣어 주세요.'; textarea.setAttribute('aria-required', 'true'); textarea.setAttribute('aria-describedby', 'interpret-input-help interpret-message');
    const inputFooter = el('div', 'interpret-input-footer'), example = button('example', '가상 예시 채우기'), count = el('span', 'interpret-count', '0 / 12,000자'); inputFooter.append(example, count);
    const helper = el('p', 'interpret-help', '링크만으로 글을 가져오지 않습니다. 예시는 실제 커뮤니티 인용이 아닌 가상 문장입니다.'); helper.id = 'interpret-input-help';
    const sourceLabel = el('label', 'interpret-label interpret-source-label', '출처 주소 (선택)'), sourceInput = el('input'); sourceLabel.htmlFor = 'interpret-source'; sourceInput.id = 'interpret-source'; sourceInput.type = 'url'; sourceInput.maxLength = 2048; sourceInput.placeholder = 'https://…'; sourceInput.setAttribute('aria-describedby', 'interpret-source-help interpret-message');
    const sourceHelp = el('p', 'interpret-help', '출처는 이번 결과에 표시합니다. 본문과 함께 공개 저장되지 않습니다.'); sourceHelp.id = 'interpret-source-help';
    const message = el('p', 'interpret-message'); message.id = 'interpret-message'; message.hidden = true; message.setAttribute('role', 'alert');
    const actions = el('div', 'interpret-actions'), analyzeButton = button('analyze', '글 해석하기', true), stopButton = button('stop', '중지'); analyzeButton.type = 'submit'; stopButton.hidden = true; actions.append(analyzeButton, stopButton);
    form.append(inputHeading, textLabel, textarea, inputFooter, helper, sourceLabel, sourceInput, sourceHelp, message, actions, el('p', 'interpret-privacy', '입력한 본문은 이 Mac의 Codex를 통해 AI 모델로 전송됩니다. 입력과 결과는 이 사이트에 자동 저장하거나 공개하지 않습니다.'));
    const resultPanel = el('section', 'interpret-result-panel'); resultPanel.setAttribute('aria-labelledby', 'interpret-result-title'); resultPanel.dataset.state = 'empty';
    const resultHeading = el('div', 'interpret-panel-heading'), resultTitle = el('h2', '', '02  문장 너머의 뜻'); resultTitle.id = 'interpret-result-title'; resultHeading.append(resultTitle, el('span', '', 'AI 해석 초안'));
    const resultStatus = el('p', 'interpret-status', '아직 해석한 글이 없어요'); resultStatus.id = 'interpret-status'; resultStatus.setAttribute('role', 'status');
    const empty = el('div', 'interpret-empty', '왼쪽에 글을 붙여넣어 보세요.\n용어의 뜻을 읽고, 주장의 근거를 확인하는 데 활용할 수 있어요.');
    const output = el('div', 'interpret-result'); output.id = 'interpret-result'; output.tabIndex = 0;
    const provenance = el('div', 'interpret-provenance');
    const resultActions = el('div', 'interpret-result-actions'), copyButton = button('copy', '결과 복사'), copyFeedback = el('span', 'interpret-copy-feedback'); copyButton.disabled = true; copyFeedback.setAttribute('role', 'status'); resultActions.append(copyButton, copyFeedback);
    const copyFallback = el('div', 'interpret-copy-fallback'), copyLabel = el('label', '', '직접 복사할 결과'), copyArea = el('textarea'); copyFallback.id = 'interpret-copy-fallback'; copyLabel.htmlFor = 'interpret-copy-text'; copyArea.id = 'interpret-copy-text'; copyArea.readOnly = true; copyFallback.hidden = true; copyFallback.append(copyLabel, copyArea);
    resultPanel.append(resultHeading, resultStatus, empty, output, provenance, resultActions, copyFallback, el('p', 'interpret-result-note', 'AI가 뜻이나 사실을 잘못 읽을 수 있어요. 숫자·시점·출처를 다시 확인한 뒤 판단해 주세요.'));
    workspace.append(form, resultPanel); root.replaceChildren(heading, connectionBox, workspace);
    ui = { form, connection: connectionBox, connectionStatus, connect: connectButton, disconnect: disconnectButton, analyze: analyzeButton, stop: stopButton, copy: copyButton, example, text: textarea, source: sourceInput, message, resultPanel, result: output, status: resultStatus, empty, provenance, copyFallback, copyArea, copyFeedback };
    form.addEventListener('submit', analyze); connectButton.addEventListener('click', connect); disconnectButton.addEventListener('click', disconnect); stopButton.addEventListener('click', stop); copyButton.addEventListener('click', copy);
    example.addEventListener('click', () => { textarea.value = EXAMPLE; textarea.dispatchEvent(new Event('input')); textarea.focus(); setMessage('학습용 가상 예시를 채웠어요. 실제 커뮤니티 글이 아닙니다.'); });
    textarea.addEventListener('input', () => { count.textContent = `${textarea.value.length.toLocaleString('ko-KR')} / 12,000자`; textarea.removeAttribute('aria-invalid'); });
    sourceInput.addEventListener('input', () => sourceInput.removeAttribute('aria-invalid'));
    window.addEventListener('message', paired);
    window.addEventListener('pagehide', () => { controller?.abort(); connectionController?.abort(); clearPairing(); });
    updateControls();
    if (LOCAL) void checkConnection(!token);
    else if (token) connection('이 탭의 승인 정보가 있어요 · 연결 확인을 눌러 주세요');
  }
  window.InterpretLab = Object.freeze({ show() { if (!initialized) init(); } });
})();
