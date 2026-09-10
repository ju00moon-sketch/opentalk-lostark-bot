(() => {
  'use strict';
  if (location.origin === 'https://ju00moon-sketch.github.io' && location.pathname === '/opentalk-lostark-bot/guild.html') {
    location.replace('https://pogeunhaeyong.duckdns.org/guild.html');
    return;
  }
  const byId = id => document.getElementById(id);
  const status = byId('guild-status');
  const privateView = byId('guild-private');
  const gate = byId('guild-gate');
  const sheetPanel = byId('sheet-panel');
  const sheetFrame = byId('sheet-frame');
  const sheetOpen = byId('sheet-open');
  const staffPanel = byId('staff-panel');
  const list = byId('member-list');
  const filter = byId('member-filter');
  const previous = byId('members-previous');
  const next = byId('members-next');
  const dialog = byId('review-dialog');
  const confirm = byId('confirm-review');
  const cancel = byId('cancel-review');
  const refreshButton = byId('guild-refresh');
  const verificationFields = byId('review-verification');
  const verificationInput = byId('review-verification-code');
  const verifiedInGame = byId('review-verified-in-game');
  const reviewError = byId('review-error');
  const reviewReload = byId('review-reload');
  const roles = { member: '길드 회원', admin: '관리자', owner: '최고관리자' };
  const states = { pending: '심사 중', approved: '가입 승인', rejected: '가입 거절', revoked: '열람 철회' };
  let session = null;
  let guild = null;
  let generation = 0;
  let loading = false;
  let busy = false;
  let pendingAction = null;
  let cursors = [null];
  let nextCursor = null;

  function announce(message, error = false) {
    if (status.textContent !== message) status.textContent = message;
    status.classList.toggle('error', error);
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(path, {credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal});
      const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
      if (!response.ok) { const error = new Error('request failed'); error.status = response.status; error.code = data?.error; throw error; }
      if (!data) throw new Error('invalid response');
      return data;
    } finally { clearTimeout(timer); }
  }

  function clearSheet() {
    sheetPanel.hidden = true;
    sheetFrame.replaceChildren();
    sheetOpen.removeAttribute('href');
    byId('sheet-title').textContent = '길드 일정';
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
    pendingAction = null;
    verificationInput.value = '';
    verifiedInGame.checked = false;
    verificationFields.hidden = true;
    reviewError.textContent = '';
    reviewReload.hidden = true;
    for (const id of ['review-title', 'review-target', 'review-description']) byId(id).textContent = '';
  }

  function clearStaff() {
    staffPanel.hidden = true;
    list.replaceChildren();
    byId('members-summary').textContent = '';
    byId('members-page').textContent = '';
    byId('staff-role-note').textContent = '';
    nextCursor = null;
    cursors = [null];
    previous.disabled = next.disabled = true;
    closeDialog();
  }

  function clearPrivate() {
    session = null;
    guild = null;
    privateView.hidden = true;
    byId('guild-character').textContent = '';
    byId('guild-role').textContent = '';
    clearSheet();
    clearStaff();
  }

  function showGate(title, description, login = false) {
    gate.hidden = false;
    byId('gate-title').textContent = title;
    byId('gate-description').textContent = description;
    byId('gate-account').textContent = login ? '로그인하고 가입하기' : '내 계정에서 신청 확인';
  }

  function handleError(error) {
    clearPrivate();
    gate.hidden = true;
    if (error.status === 401) {
      showGate('다시 로그인해 주세요.', '로그인이 만료되었어요. 같은 계정으로 로그인한 뒤 다시 방문해 주세요.', true);
      announce('로그인이 필요합니다.', true);
    } else if (error.status === 403) {
      showGate('열람 권한을 다시 확인해 주세요.', '길드 가입 또는 관리 권한이 변경되었어요. 내 계정에서 현재 상태를 확인해 주세요.');
      announce('요청할 수 있는 권한이 없어 화면을 비웠어요.', true);
    } else {
      announce(error.status === 429 ? '요청이 많아 잠시 기다려야 해요. 조금 뒤 다시 확인해 주세요.' : '길드 정보를 확인하지 못했어요. 잠시 후 새로 확인해 주세요.', true);
    }
  }

  function validateGuild(data) {
    if (!data || !Object.hasOwn(roles, data.role) || typeof data.canViewSheet !== 'boolean' ||
      (data.membership !== null && (!data.membership || !Object.hasOwn(states, data.membership.status) || typeof data.membership.characterName !== 'string'))) throw new Error('invalid response');
  }

  function renderGuild(data) {
    validateGuild(data);
    if (guild?.role !== data.role) clearStaff();
    guild = data;
    privateView.hidden = false;
    gate.hidden = true;
    byId('guild-character').textContent = data.membership?.characterName || session.user.displayName;
    byId('guild-role').textContent = roles[data.role];
    if (!data.canViewSheet) {
      clearSheet();
      const state = data.membership?.status;
      const copy = {
        pending: ['게임에서 확인번호를 전달해 주세요.', '내 계정에서 확인번호를 확인한 뒤 신청한 대표 캐릭터로 게임에 접속해 관리자에게 전달해 주세요. 관리자가 발신 캐릭터와 번호를 확인하고 승인하면 일정 시트를 볼 수 있습니다.'],
        rejected: ['가입 신청이 승인되지 않았어요.', '대표 캐릭터명을 확인한 뒤 내 계정에서 다시 신청할 수 있어요.'],
        revoked: ['홈페이지 열람 권한이 철회되었어요.', '내 계정에서 다시 신청하거나 길드 관리자에게 문의해 주세요.']
      };
      if (state === 'pending' && data.automaticApproval?.enabled === true && data.automaticApproval.eligible === true) {
        copy.pending = ['길드 가입 확인을 마쳐 주세요.', '내 계정에서 디스코드 추가 동의로 자동 승인을 확인할 수 있어요. KOR Lost ARK에서 인증한 대표 캐릭터명과 신청 이름이 같아야 합니다. 게임에서 번호를 전달해 관리자 확인을 받는 방법도 이용할 수 있어요.'];
      }
      showGate(...(copy[state] || ['우리 길드에 가입해 주세요.', '내 계정에서 대표 캐릭터명으로 가입을 신청해 주세요. 관리자 승인 후 일정 시트를 볼 수 있습니다.']));
    }
    if (data.role === 'member') clearStaff();
  }

  function previewUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.port || url.username || url.password || !/^\/spreadsheets\/d\/[a-zA-Z0-9_-]+\/preview$/.test(url.pathname)) throw new Error('invalid preview');
    return url.href;
  }

  async function loadSheet(current) {
    const data = await request('/api/auth/guild/sheet');
    if (current !== generation || !guild?.canViewSheet) return;
    if (typeof data.title !== 'string' || typeof data.url !== 'string' || typeof data.embedUrl !== 'string') throw new Error('invalid response');
    const url = previewUrl(data.url);
    const embedUrl = previewUrl(data.embedUrl);
    byId('sheet-title').textContent = data.title;
    sheetOpen.href = url;
    if (sheetFrame.firstElementChild?.src !== embedUrl) {
      const frame = document.createElement('iframe');
      frame.title = `${data.title} — 읽기 전용`;
      frame.referrerPolicy = 'no-referrer';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
      frame.src = embedUrl;
      sheetFrame.replaceChildren(frame);
    }
    sheetPanel.hidden = false;
  }

  function formatDate(value) {
    if (value == null) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul'}).format(date);
  }

  function textElement(tag, text, className = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
  }

  function addAction(container, item, label, endpoint, value, description, className = '') {
    const button = textElement('button', label, `quiet-button ${className}`);
    button.type = 'button';
    button.disabled = busy || loading;
    button.addEventListener('click', () => {
      if (busy || loading || !session || !guild) return;
      closeDialog();
      pendingAction = {endpoint, userId: item.userId, revision: item.revision, ...value};
      verificationFields.hidden = endpoint !== 'review' || value.status !== 'approved';
      byId('review-title').textContent = `${label}하시겠어요?`;
      byId('review-target').textContent = `${item.characterName || item.displayName} · ${item.displayName} (${item.provider === 'discord' ? '디스코드' : '카카오'})`;
      byId('review-description').textContent = description;
      confirm.textContent = label;
      updateControls();
      dialog.showModal();
      cancel.focus();
    });
    container.append(button);
  }

  function renderMember(item) {
    if (!item || typeof item.userId !== 'string' || typeof item.displayName !== 'string' || typeof item.characterName !== 'string' ||
      !Object.hasOwn(roles, item.role) || !Object.hasOwn(states, item.status) || !['discord', 'kakao'].includes(item.provider) || !Number.isSafeInteger(item.revision)) throw new Error('invalid member');
    const row = document.createElement('article');
    row.className = 'guild-member';
    const identity = document.createElement('div');
    identity.append(textElement('h3', item.characterName || item.displayName), textElement('p', `${item.displayName} · ${item.provider === 'discord' ? '디스코드' : '카카오'}`), textElement('p', `${states[item.status]} · ${roles[item.role]}`, 'member-state'));
    const dates = [`신청 ${formatDate(item.appliedAt)}`];
    if (item.reviewedAt != null) dates.push(`처리 ${formatDate(item.reviewedAt)}`);
    identity.append(textElement('p', `${dates.join(' · ')} · 한국 시간`));
    const actions = document.createElement('div');
    actions.className = 'guild-member-actions';
    const canReview = item.userId !== session.user.id && item.role !== 'owner' && (guild.role === 'owner' || item.role === 'member');
    if (canReview && item.status === 'pending') {
      addAction(actions, item, '승인', 'review', {status: 'approved'}, '게임에서 발신 캐릭터와 번호를 직접 확인한 뒤 길드 가입을 승인합니다. 승인 후 홈페이지에서 일정 시트를 볼 수 있습니다.', 'review-approve');
      addAction(actions, item, '거절', 'review', {status: 'rejected'}, '이번 가입 신청을 거절합니다. 회원은 대표 캐릭터명을 확인한 뒤 다시 신청할 수 있습니다.');
    }
    if (canReview && item.status === 'approved') {
      addAction(actions, item, '열람 철회', 'review', {status: 'revoked'}, `${item.role === 'admin' ? '관리자 권한도 함께 회수합니다. ' : ''}홈페이지의 일정 열람 권한을 철회합니다. 원본 Google 링크의 공개 범위는 바뀌지 않습니다.`, 'review-caution');
    }
    if (guild.role === 'owner' && item.userId !== session.user.id && item.role !== 'owner' && item.status === 'approved') {
      const grant = item.role === 'member';
      addAction(actions, item, grant ? '관리자 부여' : '관리자 회수', 'role', {role: grant ? 'admin' : 'member'}, grant ? '이 회원에게 가입 신청 목록 열람, 승인·거절, 회원 열람 철회 권한을 부여합니다. 다른 관리자를 지정할 수는 없습니다.' : '이 회원의 관리자 권한을 회수합니다. 승인된 길드 회원으로서 일정 열람은 계속할 수 있습니다.');
    }
    row.append(identity, actions);
    return row;
  }

  function updateControls() {
    refreshButton.disabled = loading || busy;
    filter.disabled = loading || busy;
    previous.disabled = loading || busy || cursors.length <= 1;
    next.disabled = loading || busy || !nextCursor;
    cancel.disabled = busy;
    confirm.disabled = busy || (!verificationFields.hidden && (!/^\d{8}$/.test(verificationInput.value) || !verifiedInGame.checked));
    verificationInput.disabled = verifiedInGame.disabled = reviewReload.disabled = busy;
    for (const button of list.querySelectorAll('button')) button.disabled = loading || busy;
  }

  async function loadMembers(current) {
    const query = new URLSearchParams();
    if (filter.value) query.set('status', filter.value);
    if (cursors.at(-1)) query.set('cursor', cursors.at(-1));
    const data = await request(`/api/auth/guild/members${query.size ? `?${query}` : ''}`);
    if (current !== generation || !guild || guild.role === 'member') return;
    if (!Array.isArray(data.items) || data.items.length > 25 || (data.nextCursor !== null && typeof data.nextCursor !== 'string')) throw new Error('invalid response');
    const rows = data.items.map(renderMember);
    list.replaceChildren(...rows);
    if (!rows.length) list.append(textElement('p', '이 목록에는 아직 회원이 없어요.', 'guild-empty'));
    nextCursor = data.nextCursor;
    const summary = `${rows.length}명 표시 · 한 번에 최대 25명`;
    if (byId('members-summary').textContent !== summary) byId('members-summary').textContent = summary;
    byId('members-page').textContent = `${cursors.length}페이지`;
    byId('staff-role-note').textContent = guild.role === 'owner' ? '관리자 지정은 최고관리자만 할 수 있어요.' : '가입 신청을 확인하고 열람 권한을 관리해요.';
    staffPanel.hidden = false;
  }

  async function refresh(message = '') {
    if (document.hidden) return;
    const current = ++generation;
    loading = true;
    updateControls();
    try {
      const data = await request('/api/auth/session');
      if (current !== generation) return;
      if (!data || typeof data.authenticated !== 'boolean' || (data.authenticated && (!data.user || typeof data.user.id !== 'string' || typeof data.user.displayName !== 'string' || typeof data.csrfToken !== 'string'))) throw new Error('invalid session');
      if (!data.authenticated) {
        clearPrivate();
        showGate('로그인하고 길드에 가입해 주세요.', '처음 소셜 로그인하면 홈페이지 회원가입이 완료됩니다. 길드 가입은 내 계정에서 따로 신청해 주세요.', true);
        announce('길드 일정은 가입 승인 후 확인할 수 있어요.');
        return;
      }
      if (session && session.user.id !== data.user.id) clearPrivate();
      session = data;
      const own = await request('/api/auth/guild');
      if (current !== generation) return;
      renderGuild(own);
      let sheetUnavailable = false;
      if (own.canViewSheet) {
        try { await loadSheet(current); }
        catch (error) {
          if (current !== generation) return;
          if ([401, 403].includes(error.status)) throw error;
          clearSheet();
          sheetUnavailable = true;
        }
      }
      if (current !== generation) return;
      if (own.role !== 'member') await loadMembers(current);
      if (current === generation) announce(sheetUnavailable ? '일정 시트를 불러오지 못했어요. 잠시 후 새로 확인해 주세요.' : message || '현재 길드 정보를 확인했어요. 이 화면은 1분마다 새로 확인합니다.', sheetUnavailable);
    } catch (error) {
      if (current === generation) handleError(error);
    } finally {
      if (current === generation) { loading = false; updateControls(); }
    }
  }

  async function changePage(cursor, backwards = false) {
    if (loading || busy || !guild || guild.role === 'member') return;
    if (backwards) cursors.pop();
    else cursors.push(cursor);
    loading = true;
    const current = ++generation;
    updateControls();
    try { await loadMembers(current); }
    catch (error) { if (current === generation) handleError(error); }
    finally { if (current === generation) { loading = false; updateControls(); } }
  }

  confirm.addEventListener('click', async () => {
    if (busy || loading || !pendingAction || !session) return;
    const approval = pendingAction.endpoint === 'review' && pendingAction.status === 'approved';
    if (approval && (!/^\d{8}$/.test(verificationInput.value) || !verifiedInGame.checked)) return;
    busy = true;
    updateControls();
    const {endpoint, ...body} = pendingAction;
    if (approval) { body.verificationCode = verificationInput.value; body.verifiedInGame = true; }
    reviewError.textContent = '';
    reviewReload.hidden = true;
    const current = generation;
    try {
      await request(`/api/auth/guild/${endpoint}`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken}, body: JSON.stringify(body)});
      if (current !== generation) return;
      closeDialog();
      await refresh('변경을 반영했어요. 최신 목록을 확인해 주세요.');
      if (!staffPanel.hidden) byId('staff-title').focus();
    } catch (error) {
      if (current !== generation) return;
      if ([401, 403].includes(error.status)) handleError(error);
      else {
        const messages = {
          verification_invalid: '번호가 일치하지 않아요. 게임에서 받은 번호를 확인해 주세요. 5회 틀리면 번호가 잠깁니다.',
          verification_expired: '사용할 수 있는 번호가 없어요. 신청자에게 새 번호를 발급해 게임에서 전달하도록 요청한 뒤 최신 목록에서 다시 확인해 주세요.',
          verification_required: '사용할 수 있는 번호가 없어요. 신청자에게 새 번호를 발급해 게임에서 전달하도록 요청한 뒤 최신 목록에서 다시 확인해 주세요.',
          verification_locked: '번호 입력 오류가 누적되어 잠겼어요. 신청자에게 새 번호 발급을 요청한 뒤 최신 목록에서 다시 확인해 주세요.',
          character_already_verified: '이 캐릭터는 이미 다른 계정에서 가입 승인되었어요. 신청자와 계정을 확인해 주세요.',
          state_changed: '신청 상태나 권한이 변경되었어요. 최신 목록을 확인한 뒤 다시 선택해 주세요.'
        };
        reviewError.textContent = messages[error.code] || (error.status === 409 ? messages.state_changed
          : error.status === 429 ? '요청이 많아 잠시 기다려야 해요. 입력한 내용은 유지되니 조금 뒤 다시 시도해 주세요.'
          : '요청 결과를 확인하지 못했어요. 잠시 후 다시 시도하거나 최신 목록을 확인해 주세요.');
        reviewReload.hidden = false;
      }
    } finally { busy = false; updateControls(); }
  });
  verificationInput.addEventListener('input', updateControls);
  verifiedInGame.addEventListener('change', updateControls);
  reviewReload.addEventListener('click', () => { if (!busy) { closeDialog(); cursors = [null]; refresh('최신 목록을 불러왔어요. 신청을 다시 선택해 주세요.'); } });
  cancel.addEventListener('click', () => { if (!busy) closeDialog(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); else closeDialog(); });
  filter.addEventListener('change', () => { cursors = [null]; refresh(); });
  previous.addEventListener('click', () => changePage(null, true));
  next.addEventListener('click', () => { if (nextCursor) changePage(nextCursor); });
  refreshButton.addEventListener('click', () => { if (!busy) { closeDialog(); refresh(); } });
  function suspend() { generation++; loading = false; clearPrivate(); gate.hidden = true; announce('현재 정보를 다시 확인하고 있어요.'); }
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else refresh(); });
  setInterval(() => { if (!document.hidden && !busy && !loading && !dialog.open) refresh(); }, 60000);
  refresh();
})();
