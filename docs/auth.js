(() => {
  'use strict';
  if (location.origin === 'https://ju00moon-sketch.github.io' && location.pathname.startsWith('/opentalk-lostark-bot/')) {
    if (location.pathname === '/opentalk-lostark-bot/account.html') {
      location.replace('https://pogeunhaeyong.duckdns.org/account.html');
      return;
    }
    const account = document.querySelector('[data-account-link]');
    const guild = document.querySelector('[data-guild-link]');
    if (account) account.href = 'https://pogeunhaeyong.duckdns.org/account.html';
    if (guild) {
      guild.href = 'https://pogeunhaeyong.duckdns.org/guild.html';
      guild.hidden = false;
    }
    return;
  }
  const isAccountPage = document.body.hasAttribute('data-account-page');
  const status = document.getElementById('auth-status');
  const signedIn = document.getElementById('signed-in');
  const signedOut = document.getElementById('signed-out');
  const retry = document.getElementById('auth-retry');
  const logout = document.getElementById('logout');
  const deleteDialog = document.getElementById('delete-dialog');
  const deleteAccount = document.getElementById('delete-account');
  const confirmDelete = document.getElementById('confirm-delete');
  const reauthentication = document.getElementById('reauthentication');
  const accountLink = document.querySelector('[data-account-link]');
  const guildLink = document.querySelector('[data-guild-link]');
  const accountGuild = document.getElementById('account-guild');
  const application = document.getElementById('guild-application');
  const applyButton = document.getElementById('apply-guild');
  const characterInput = document.getElementById('character-name');
  const applicationStatus = document.getElementById('application-status');
  const verificationPanel = document.getElementById('guild-verification');
  const reissueButton = document.getElementById('reissue-verification');
  const automaticPanel = document.getElementById('guild-automatic');
  const automaticButton = document.getElementById('automatic-approval-start');
  const automaticIntro = document.getElementById('automatic-approval-intro');
  const errorMessages = {
    provider_unavailable: '이 로그인 방법은 아직 준비 중입니다. 다른 방법을 이용해 주세요.',
    invalid_request: '로그인 요청이 만료되었거나 확인되지 않았어요. 다시 로그인해 주세요.',
    access_denied: '로그인을 취소하셨어요. 원하실 때 다시 시작할 수 있습니다.',
    provider_error: '계정 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
    rate_limited: '요청이 잠시 많아졌어요. 조금 기다린 뒤 다시 시도해 주세요.',
    server_error: '지금은 로그인할 수 없어요. 잠시 후 다시 시도해 주세요.',
    deletion_pending: '회원 탈퇴를 처리하고 있어요. 완료될 때까지 잠시 기다려 주세요.',
    storage_unavailable: '지금은 계정 정보를 처리할 수 없어요. 잠시 후 다시 시도해 주세요.',
    automatic_cancelled: '자동 승인 추가 동의를 취소하셨어요. 신청은 유지되며 다시 시도하거나 게임에서 관리자에게 번호를 전달할 수 있습니다.',
    automatic_identity_mismatch: '홈페이지에 로그인한 디스코드 계정과 다른 계정이에요. 같은 디스코드 계정으로 다시 시도해 주세요.',
    automatic_character_mismatch: '신청한 이름이 KOR Lost ARK에서 인증한 대표 캐릭터명과 일치하지 않아요. 해당 서버의 대표 캐릭터를 확인하거나 게임에서 관리자에게 번호를 전달해 주세요.',
    automatic_role_missing: 'KOR Lost ARK의 루페온 인증 역할을 확인하지 못했어요. 해당 서버에서 인증을 마친 뒤 다시 시도해 주세요.',
    automatic_guild_mismatch: '신청 캐릭터의 루페온·포근해 길드 소속이 확인되지 않았어요. 현재 소속을 확인하거나 관리자에게 문의해 주세요.',
    automatic_permission_denied: '추가 동의 권한을 확인하지 못했어요. 다시 동의하거나 게임에서 관리자에게 번호를 전달해 주세요.',
    automatic_membership_missing: '인증 서버 가입 상태 또는 게임 캐릭터를 조회하지 못했어요. 정보를 확인한 뒤 다시 시도해 주세요.',
    automatic_manual_required: '이 계정은 관리자의 확인이 필요해요. 게임에서 관리자에게 번호를 전달해 주세요.',
    automatic_discord_required: '카카오 계정은 게임에서 관리자에게 번호를 전달해 승인받아 주세요. 디스코드 계정과 자동으로 합치지 않습니다.',
    automatic_state_changed: '신청이나 로그인 상태가 변경되었어요. 현재 상태를 확인한 뒤 다시 시도해 주세요.',
    automatic_not_pending: '현재는 자동 승인을 진행할 수 있는 신청 상태가 아니에요. 현재 상태를 확인해 주세요.',
    automatic_rate_limited: '인증 서비스의 요청이 많아요. 잠시 기다린 뒤 다시 시도하거나 게임에서 관리자에게 번호를 전달해 주세요.',
    automatic_unavailable: '자동 승인을 확인하지 못했어요. 잠시 후 다시 시도하거나 게임에서 관리자에게 번호를 전달해 주세요.',
    character_already_verified: '이 캐릭터는 이미 다른 홈페이지 계정에서 승인되었어요. 관리자에게 계정을 확인해 주세요.'
  };
  let session = null;
  let generation = 0;
  let busy = false;
  let membership = null;
  let verification = null;
  let verificationReceivedAt = 0;
  let automaticApproval = null;
  let expiredNotice = '';
  const expirationMessage = '로그인이 만료되었어요. 다시 로그인해 주세요.';
  const query = new URLSearchParams(location.search);
  const initialError = Object.hasOwn(errorMessages, query.get('error')) ? errorMessages[query.get('error')] : '';
  const automaticSuccess = query.get('guild_auto') === 'approved';
  if (isAccountPage && (query.has('error') || query.has('guild_auto'))) history.replaceState(null, '', location.pathname);

  function announce(message, isError = false) {
    if (!status) return;
    if (status.textContent !== message) status.textContent = message;
    status.classList.toggle('error', isError);
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
      const data = response.status !== 204 && response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
      return { response, data };
    } finally { clearTimeout(timer); }
  }

  function clearPrivate() {
    session = null;
    membership = null;
    if (accountLink) accountLink.textContent = '로그인·가입';
    if (guildLink) guildLink.hidden = true;
    if (!isAccountPage) return;
    automaticApproval = null;
    automaticPanel.hidden = automaticIntro.hidden = automaticButton.hidden = true;
    document.getElementById('automatic-approval-description').textContent = '';
    clearVerification();
    signedIn.hidden = true;
    accountGuild.hidden = true;
    application.hidden = true;
    characterInput.value = '';
    for (const id of ['member-name', 'member-provider', 'membership-status', 'membership-character', 'membership-description', 'application-status', 'delete-provider-note']) {
      document.getElementById(id).textContent = '';
    }
    if (deleteDialog.open) deleteDialog.close();
  }

  function clearVerification() {
    verification = null;
    verificationReceivedAt = 0;
    if (!verificationPanel) return;
    verificationPanel.hidden = true;
    for (const id of ['verification-code', 'verification-expiry', 'verification-attempts', 'verification-reissue']) document.getElementById(id).textContent = '';
    reissueButton.disabled = true;
  }

  function verificationNow() {
    return verification ? verification.serverNow + Math.max(0, performance.now() - verificationReceivedAt) : 0;
  }

  function updateVerification() {
    if (!isAccountPage || document.hidden || !session?.authenticated || membership?.status !== 'pending') {
      clearVerification();
      return;
    }
    verificationPanel.hidden = false;
    const now = verificationNow();
    const valid = verification?.code && verification.expiresAt > now && verification.attemptsRemaining > 0;
    if (verification && !valid) verification.code = null;
    const code = valid ? verification.code : '';
    const codeElement = document.getElementById('verification-code');
    if (codeElement.textContent !== code) codeElement.textContent = code;
    const expiry = valid
      ? `유효기간 · ${new Intl.DateTimeFormat('ko-KR', {month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul'}).format(new Date(verification.expiresAt))}까지 (한국 시간)`
      : verification?.attemptsRemaining === 0 ? '번호 입력 오류가 누적되어 잠겼어요. 새 번호를 발급해 다시 전달해 주세요.'
      : '사용할 수 있는 번호가 없어요. 새 번호를 발급해 게임에서 전달해 주세요.';
    const expiryElement = document.getElementById('verification-expiry');
    if (expiryElement.textContent !== expiry) expiryElement.textContent = expiry;
    document.getElementById('verification-attempts').textContent = valid ? `관리자 번호 확인 · 오류 ${verification.attemptsRemaining}회 남음` : '';
    const wait = Math.max(0, Math.ceil(((verification?.reissueAt || 0) - now) / 1000));
    reissueButton.disabled = busy || wait > 0;
    const reissue = wait ? `${wait}초 후 다시 발급할 수 있어요.` : '새 번호를 발급한 뒤 관리자에게 다시 전달해 주세요.';
    const reissueElement = document.getElementById('verification-reissue');
    if (reissueElement.textContent !== reissue) reissueElement.textContent = reissue;
  }

  function renderMembership(data) {
    if (!data || !['member', 'admin', 'owner'].includes(data.role) || typeof data.canViewSheet !== 'boolean' ||
      (data.membership !== null && (!data.membership || !['pending', 'approved', 'rejected', 'revoked'].includes(data.membership.status) || typeof data.membership.characterName !== 'string'))) throw new Error('invalid response');
    const nextVerification = data.verification ?? null;
    if (nextVerification !== null && (!Number.isFinite(nextVerification.serverNow) || !Number.isFinite(nextVerification.expiresAt) || !Number.isFinite(nextVerification.reissueAt) ||
      !Number.isInteger(nextVerification.attemptsRemaining) || nextVerification.attemptsRemaining < 0 || nextVerification.attemptsRemaining > 5 ||
      (nextVerification.code !== null && (typeof nextVerification.code !== 'string' || !/^\d{8}$/.test(nextVerification.code))))) throw new Error('invalid verification');
    membership = data.membership;
    verification = nextVerification ? {...nextVerification} : null;
    verificationReceivedAt = verification ? performance.now() : 0;
    const state = membership?.status;
    const automatic = data.automaticApproval ?? null;
    if (automatic !== null && (typeof automatic.enabled !== 'boolean' || typeof automatic.eligible !== 'boolean' ||
      ![null, 'disabled', 'discord_required', 'manual_required', 'not_pending', 'state_changed'].includes(automatic.reason))) throw new Error('invalid automatic approval');
    automaticApproval = automatic;
    automaticIntro.hidden = !automatic?.enabled || session.user.provider !== 'discord' || data.role !== 'member' || state !== undefined;
    automaticPanel.hidden = !automatic?.enabled || state !== 'pending';
    automaticButton.hidden = !automatic?.eligible || state !== 'pending';
    automaticButton.disabled = busy || !automatic?.eligible;
    document.getElementById('automatic-approval-description').textContent = automaticPanel.hidden ? ''
      : automatic.reason === 'discord_required' ? errorMessages.automatic_discord_required
      : automatic.reason === 'manual_required' ? errorMessages.automatic_manual_required
      : 'KOR Lost ARK에서 인증한 대표 캐릭터명과 신청 이름이 같아야 해요. 디스코드 추가 동의 후 인증 역할과 게임 내 길드 소속을 확인합니다. 확인이 어렵다면 아래 번호를 게임에서 관리자에게 전달해 주세요.';
    const labels = { pending: '심사 중', approved: '가입 승인', rejected: '가입 거절', revoked: '열람 철회' };
    const descriptions = {
      pending: '게임에서 확인번호를 전달해 주세요. 관리자가 발신 캐릭터와 번호를 확인하고 승인하면 길드 일정 시트를 볼 수 있습니다.',
      approved: '길드 가입이 승인되었어요. 길드 페이지에서 일정 시트를 확인해 보세요.',
      rejected: '이번 가입 신청은 승인되지 않았어요. 대표 캐릭터명을 확인한 뒤 다시 신청할 수 있습니다.',
      revoked: '홈페이지에서 일정 시트를 보는 권한이 철회되었어요. 다시 신청하거나 길드 관리자에게 문의해 주세요.'
    };
    accountGuild.hidden = false;
    const membershipLabel = labels[state] || '아직 신청하지 않았어요';
    const roleLabel = { admin: '관리자', owner: '최고관리자' }[data.role];
    const membershipMessage = roleLabel ? `${membershipLabel} · ${roleLabel}` : membershipLabel;
    const membershipStatus = document.getElementById('membership-status');
    if (membershipStatus.textContent !== membershipMessage) membershipStatus.textContent = membershipMessage;
    document.getElementById('membership-character').textContent = membership?.characterName ? `대표 캐릭터 · ${membership.characterName}` : '';
    document.getElementById('membership-description').textContent = roleLabel ? '길드 페이지에서 일정 확인과 가입 신청 관리를 이용할 수 있어요.' : descriptions[state] || '대표 캐릭터명으로 가입을 신청해 주세요. 관리자 승인 후 길드 일정 시트를 볼 수 있어요.';
    if (state === 'pending' && automatic?.eligible) document.getElementById('membership-description').textContent = '디스코드 인증으로 자동 승인을 확인하거나 게임에서 관리자에게 번호를 전달할 수 있어요.';
    application.hidden = data.role !== 'member' || ![undefined, 'rejected', 'revoked'].includes(state);
    applyButton.textContent = state ? '다시 가입 신청' : '길드 가입 신청';
    updateVerification();
    if (automaticSuccess && state === 'approved' && applicationStatus.textContent !== '길드 가입이 승인되어 일정 시트를 볼 수 있어요.') applicationStatus.textContent = '길드 가입이 승인되어 일정 시트를 볼 수 있어요.';
  }

  function render(data, message = '') {
    session = data;
    if (accountLink) accountLink.textContent = data.authenticated ? '내 계정' : '로그인·가입';
    if (guildLink) guildLink.hidden = data.authenticated !== true;
    if (!isAccountPage) return;
    const loggedIn = data.authenticated === true;
    signedIn.hidden = !loggedIn;
    signedOut.hidden = loggedIn;
    retry.hidden = true;
    reauthentication.hidden = true;
    if (!loggedIn && deleteDialog.open) deleteDialog.close();
    if (loggedIn) {
      document.getElementById('account-title').textContent = '내 계정';
      document.getElementById('member-name').textContent = data.user.displayName;
      document.getElementById('member-provider').textContent = `${data.user.provider === 'discord' ? '디스코드' : '카카오'}로 로그인한 계정`;
      announce(message || '포근해용에 오신 것을 환영해요.');
    } else {
      clearPrivate();
      session = data;
      document.getElementById('account-title').textContent = '로그인';
      for (const provider of ['discord', 'kakao']) {
        const button = document.getElementById(`login-${provider}`);
        button.disabled = data.providers[provider] !== true;
        if (provider === 'kakao') document.getElementById('kakao-readiness').hidden = !button.disabled;
        else button.textContent = `디스코드로 로그인${button.disabled ? ' · 준비 중' : ''}`;
      }
      announce(message || '익숙한 계정으로 시작해 보세요.', Boolean(message && message === initialError));
    }
  }

  async function refresh(message = '') {
    if (document.hidden) return;
    const thisGeneration = ++generation;
    try {
      const { response, data } = await request('/api/auth/session');
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('unavailable');
      if (!data || typeof data.authenticated !== 'boolean' || !data.providers ||
        (data.authenticated && (!data.user || typeof data.user.id !== 'string' || typeof data.user.displayName !== 'string' ||
        !['discord', 'kakao'].includes(data.user.provider) || typeof data.csrfToken !== 'string'))) throw new Error('invalid response');
      if (thisGeneration !== generation) return;
      if (data.authenticated) expiredNotice = '';
      else if (session?.authenticated) expiredNotice = expirationMessage;
      if (session?.authenticated && data.authenticated && session.user.id !== data.user.id) clearPrivate();
      render(data, message || expiredNotice);
      if (thisGeneration === generation && isAccountPage && data.authenticated) {
        const result = await request('/api/auth/guild');
        if (thisGeneration !== generation) return;
        if (!result.response.ok) {
          if ([401, 403].includes(result.response.status)) {
            const error = new Error('authentication failed');
            error.status = result.response.status;
            throw error;
          }
          accountGuild.hidden = true;
          clearVerification();
          retry.hidden = false;
          announce('길드 가입 상태를 확인하지 못했어요. 다시 확인해 주세요.', true);
          return;
        }
        renderMembership(result.data);
      }
    } catch (error) {
      if (thisGeneration !== generation) return;
      if (error.status === 401) {
        expiredNotice = expirationMessage;
        const providers = session?.providers || { discord: false, kakao: false };
        clearPrivate();
        if (isAccountPage) {
          render({ authenticated: false, providers }, expiredNotice);
          retry.hidden = false;
          announce(expiredNotice, true);
        }
        return;
      }
      clearPrivate();
      if (isAccountPage) {
        if (deleteDialog.open) deleteDialog.close();
        signedIn.hidden = signedOut.hidden = true;
        retry.hidden = false;
        announce('로그인 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.', true);
      }
    }
  }

  application?.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !session?.authenticated || ![undefined, 'rejected', 'revoked'].includes(membership?.status)) return;
    const characterName = characterInput.value;
    if (!/^[가-힣a-zA-Z0-9]{2,12}$/.test(characterName)) {
      applicationStatus.textContent = '대표 캐릭터명은 공백 없이 한글·영문·숫자 2~12자로 입력해 주세요.';
      applicationStatus.classList.add('error');
      characterInput.focus();
      return;
    }
    busy = true;
    applyButton.disabled = true;
    const current = generation;
    applicationStatus.textContent = '가입 신청을 보내고 있어요.';
    applicationStatus.classList.remove('error');
    try {
      const {response, data} = await request('/api/auth/guild/apply', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken}, body: JSON.stringify({characterName})});
      if (current !== generation) return;
      if (response.ok) {
        renderMembership(data);
        characterInput.value = '';
        applicationStatus.textContent = '가입 신청을 보냈어요.';
        if (automaticApproval?.eligible) await startAutomatic(current);
      } else if (response.status === 409) {
        await refresh('신청 상태가 변경되어 최신 정보를 불러왔어요. 현재 상태를 확인해 주세요.');
        applicationStatus.textContent = '';
      } else if ([401, 403].includes(response.status)) {
        if (response.status === 401) expiredNotice = expirationMessage;
        clearPrivate();
        await refresh(expiredNotice || '로그인과 권한을 다시 확인했어요. 현재 상태를 확인해 주세요.');
      } else {
        applicationStatus.textContent = response.status === 400 ? '캐릭터명을 확인한 뒤 다시 신청해 주세요.' : response.status === 429 ? '요청이 많아 잠시 기다려야 해요. 조금 뒤 다시 신청해 주세요.' : '신청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
        applicationStatus.classList.add('error');
      }
    } catch {
      if (current !== generation) return;
      await refresh('신청 결과를 확인하지 못했어요. 현재 신청 상태를 확인해 주세요.');
    } finally { busy = false; applyButton.disabled = false; automaticButton.disabled = !automaticApproval?.eligible; }
  });

  async function startAutomatic(current) {
    if (!session?.authenticated || membership?.status !== 'pending' || !automaticApproval?.eligible) return;
    automaticButton.disabled = true;
    applicationStatus.textContent = '디스코드 추가 동의 화면을 준비하고 있어요.';
    applicationStatus.classList.remove('error');
    try {
      const {response, data} = await request('/api/auth/guild/automatic', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken}, body: JSON.stringify({revision: membership.revision})});
      if (current !== generation) return;
      if (response.ok) {
        const url = new URL(data?.authorizationUrl);
        if (url.origin !== 'https://discord.com' || url.pathname !== '/oauth2/authorize' || url.username || url.password || url.hash) throw new Error('invalid authorization URL');
        location.assign(url.href);
      } else if ([401, 403].includes(response.status)) {
        if (response.status === 401) expiredNotice = expirationMessage;
        clearPrivate();
        await refresh(expiredNotice || errorMessages[data?.error] || errorMessages.automatic_state_changed);
      } else {
        if (response.status === 409) await refresh(errorMessages.automatic_state_changed);
        if (!document.hidden && session?.authenticated) {
          applicationStatus.textContent = errorMessages[data?.error] || errorMessages.automatic_unavailable;
          applicationStatus.classList.add('error');
        }
      }
    } catch {
      if (current !== generation) return;
      applicationStatus.textContent = errorMessages.automatic_unavailable;
      applicationStatus.classList.add('error');
    }
  }

  automaticButton?.addEventListener('click', async () => {
    if (busy || !automaticApproval?.eligible || membership?.status !== 'pending') return;
    busy = true;
    try { await startAutomatic(generation); }
    finally { busy = false; automaticButton.disabled = !automaticApproval?.eligible; updateVerification(); }
  });

  reissueButton?.addEventListener('click', async () => {
    if (busy || !session?.authenticated || membership?.status !== 'pending' || !Number.isSafeInteger(membership.revision) || (verification?.reissueAt || 0) > verificationNow()) return;
    busy = true;
    updateVerification();
    const current = generation;
    applicationStatus.textContent = '새 확인번호를 발급하고 있어요.';
    applicationStatus.classList.remove('error');
    try {
      const {response, data} = await request('/api/auth/guild/verification', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken}, body: JSON.stringify({revision: membership.revision})});
      if (current !== generation) return;
      if (response.ok) {
        renderMembership(data);
        applicationStatus.textContent = '새 번호를 발급했어요. 게임에서 관리자에게 다시 전달해 주세요.';
      } else if ([401, 403].includes(response.status)) {
        if (response.status === 401) expiredNotice = expirationMessage;
        clearPrivate();
        await refresh(expiredNotice || '로그인과 권한을 다시 확인했어요. 현재 상태를 확인해 주세요.');
      } else {
        const message = data?.error === 'verification_cooldown' ? '아직 새 번호를 발급할 수 없어요. 남은 시간을 확인해 주세요.'
          : response.status === 409 ? '신청 상태가 변경되었어요. 최신 상태를 확인한 뒤 다시 시도해 주세요.'
          : '번호를 발급하지 못했어요. 잠시 후 다시 시도해 주세요.';
        await refresh();
        if (session?.authenticated && !document.hidden) {
          applicationStatus.textContent = message;
          applicationStatus.classList.add('error');
        }
      }
    } catch {
      if (current !== generation) return;
      clearVerification();
      await refresh('번호 발급 결과를 확인하지 못했어요. 현재 번호를 확인한 뒤 다시 시도해 주세요.');
    } finally { busy = false; updateVerification(); }
  });

  for (const provider of ['discord', 'kakao']) {
    document.getElementById(`login-${provider}`)?.addEventListener('click', () => {
      if (busy || session?.providers?.[provider] !== true) return;
      busy = true;
      announce('로그인 화면으로 이동하고 있어요.');
      location.assign(`/auth/${provider}/start`);
    });
  }

  logout?.addEventListener('click', async () => {
    if (busy || !session?.authenticated) return;
    busy = true;
    logout.disabled = true;
    clearVerification();
    try {
      const { response } = await request('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': session.csrfToken } });
      if (response.status !== 204) throw new Error('logout failed');
      await refresh('로그아웃했어요. 다음에 또 만나요.');
    } catch {
      await refresh();
      announce('로그아웃 결과를 확인하지 못했어요. 현재 상태를 확인하고 다시 시도해 주세요.', true);
    } finally { busy = false; logout.disabled = false; }
  });
  deleteAccount?.addEventListener('click', () => {
    if (busy || !session?.authenticated) return;
    document.getElementById('delete-provider-note').textContent = session.user.provider === 'kakao'
      ? '카카오 계정과 포근해용의 연결도 함께 해제합니다.'
      : '디스코드 계정과 디스코드 서버 가입 상태는 그대로 유지됩니다.';
    deleteDialog.showModal();
    document.getElementById('cancel-delete').focus();
  });
  document.getElementById('cancel-delete')?.addEventListener('click', () => { if (!busy) deleteDialog.close(); });
  deleteDialog?.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  confirmDelete?.addEventListener('click', async () => {
    if (busy || !session?.authenticated) return;
    busy = true;
    confirmDelete.disabled = true;
    document.getElementById('cancel-delete').disabled = true;
    confirmDelete.textContent = '삭제 처리 중…';
    try {
      const { response, data } = await request('/api/auth/account', { method: 'DELETE', headers: { 'X-CSRF-Token': session.csrfToken } });
      deleteDialog.close();
      if (response.status === 204) {
        await refresh('회원 탈퇴를 완료했어요. 홈페이지 계정·길드 신청·승인·관리자 권한과 로그인 세션을 삭제했습니다.');
      } else if (response.status === 401 && data?.error === 'reauthentication_required') {
        reauthentication.hidden = false;
        announce('최근 로그인 확인이 필요해요. 다시 로그인한 뒤 탈퇴해 주세요.', true);
        document.getElementById('reauthenticate').focus();
      } else {
        await refresh();
        announce('회원 탈퇴를 완료하지 못했어요. 처리 중인 요청이 있을 수 있으니 잠시 후 상태를 다시 확인해 주세요.', true);
      }
    } catch {
      deleteDialog.close();
      await refresh();
      announce('탈퇴 결과를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.', true);
    } finally {
      busy = false;
      confirmDelete.disabled = false;
      document.getElementById('cancel-delete').disabled = false;
      confirmDelete.textContent = '탈퇴하고 정보 삭제';
    }
  });
  document.getElementById('reauthenticate')?.addEventListener('click', () => {
    if (!busy && session?.authenticated && ['discord', 'kakao'].includes(session.user.provider)) {
      busy = true;
      location.assign(`/auth/${session.user.provider}/start`);
    }
  });
  retry?.addEventListener('click', () => refresh());
  window.addEventListener('pageshow', event => { if (event.persisted) { busy = false; refresh(); } });
  window.addEventListener('pagehide', () => { generation++; clearPrivate(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { generation++; clearPrivate(); }
    else refresh();
  });
  if (isAccountPage) {
    setInterval(() => { if (!document.hidden && !busy && !deleteDialog.open) refresh(); }, 60000);
    setInterval(() => { if (!document.hidden) updateVerification(); }, 1000);
  }
  refresh(initialError);
})();
