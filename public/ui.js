import { icon } from './icons.js';

// ─── STATE ────────────────────────────────────────────────────────────────────
let currentUser = null;
let activeStep = 1;
let selectedGender = null;
let photoFile = null, photoIdFile = null;
let authMode = 'register'; // 'register' | 'login'
let activePlaceTab = 'info';
let openPlaceData = null;
let privateChatUserId = null;
let notifCount = 0;
let worldInited = false;
let onlinePollTimer = null;

// ─── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
  const { user } = await fetch('/auth/me').then(r => r.json());
  if (user) {
    currentUser = user;
    enterHome();
  } else {
    showAuth();
  }
}

// ─── SHARED SOCKET ──────────────────────────────────────────────────────────
// Подключаемся сразу после входа (с главной), чтобы уведомления, онлайн-статус
// и личные сообщения работали ещё до входа на карту. Игра (main.js) переиспользует
// этот же сокет.
function ensureSocket() {
  if (window._skverSocket || !currentUser) return window._skverSocket;
  const socket = io({ transports: ['polling', 'websocket'], reconnection: true });
  window._skverSocket = socket;
  socket.on('connect', () => socket.emit('identify', currentUser.id));
  socket.on('notification', d => window.handleNotification && window.handleNotification(d));
  socket.on('notifCount', n => window.setNotifCount && window.setNotifCount(n));
  socket.on('privateMessage', m => window.handlePrivateMessage && window.handlePrivateMessage(m));
  return socket;
}

// ─── HOME PAGE ───────────────────────────────────────────────────────────────
function enterHome() {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('game-ui').style.display = 'none';
  document.getElementById('home-page').style.display = '';
  ensureSocket();
  loadHomeData();
  startOnlinePolling();
}

// плавный счётчик чисел (wow-эффект)
function animateCount(el, to) {
  if (!el) return;
  to = Math.max(0, to | 0);
  const from = parseInt(el.textContent, 10) || 0;
  if (from === to) { el.textContent = to; return; }
  const dur = 650, start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function loadHomeData() {
  // профиль
  try {
    const data = await fetch('/api/profile/me').then(r => r.json());
    if (data && data.id) {
      currentUser = data;
      renderHomeProfile(data);
    }
  } catch {}
  // друзья + онлайн + уведомления параллельно
  loadHomeFriends();
  refreshOnlineCount();
  refreshNotifCount();
}

function renderHomeProfile(data) {
  const av = document.getElementById('home-avatar');
  av.innerHTML = data.photo
    ? `<img src="/uploads/${data.photo}" alt="">`
    : `<span>${(data.fullname || '?')[0].toUpperCase()}</span>`;
  const hour = new Date().getHours();
  const greet = hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
  const firstName = (data.fullname || '').split(' ')[0] || '';
  document.getElementById('home-greeting').textContent = `${greet}, ${firstName} 👋`;
  document.getElementById('home-name').textContent = data.fullname || '';
  const age = data.birthyear ? (new Date().getFullYear() - data.birthyear) + ' лет' : '';
  document.getElementById('home-sub').innerHTML = `${data.gender === 'female' ? 'Женский' : 'Мужской'}${age ? ' · ' + age : ''}`;
}

async function loadHomeFriends() {
  const list = document.getElementById('home-friends-list');
  list.innerHTML = '<div class="home-friends-loading">Загрузка...</div>';
  try {
    const friends = await fetch('/api/friends').then(r => r.json());
    animateCount(document.getElementById('home-friends-count'), friends.length);
    animateCount(document.getElementById('home-friends-online'), friends.filter(f => f.online).length);
    if (!friends.length) {
      list.innerHTML = `<div class="home-friends-empty">${icon('users', 30)}<p>Пока нет друзей</p><span>Знакомьтесь с людьми на карте и добавляйте в друзья</span></div>`;
      return;
    }
    // онлайн сначала
    friends.sort((a, b) => (b.online - a.online));
    list.innerHTML = friends.map(f => `
      <div class="home-friend ${f.online ? 'online' : ''}" onclick="openFriendFromHome('${f.id}', '${escapeHtml(f.fullname).replace(/'/g, "\\'")}')">
        <div class="home-friend-avatar">
          ${f.photo ? `<img src="/uploads/${f.photo}" alt="">` : `<span>${(f.fullname || '?')[0].toUpperCase()}</span>`}
          ${f.online ? '<i class="home-friend-dot"></i>' : ''}
        </div>
        <div class="home-friend-name">${escapeHtml((f.fullname || '').split(' ')[0])}</div>
        <div class="home-friend-status">${f.online ? 'в сети' : 'не в сети'}</div>
      </div>`).join('');
  } catch {
    list.innerHTML = '<div class="home-friends-loading" style="color:#f88">Ошибка загрузки</div>';
  }
}

window.openFriendFromHome = function (userId, name) {
  openProfileModal(userId);
};

// ─── PEOPLE LIST MODAL (online / friends) ──────────────────────────────────────
function peopleAvatar(p, big) {
  const s = big ? 48 : 48;
  return p.photo
    ? `<img src="/uploads/${p.photo}" class="people-avatar" alt="">`
    : `<div class="people-avatar people-avatar-ph">${(p.fullname || '?')[0].toUpperCase()}</div>`;
}

function renderPeopleRows(people, opts = {}) {
  return people.map(p => {
    const me = p.id === currentUser?.id;
    const age = p.birthyear ? (new Date().getFullYear() - p.birthyear) + ' лет' : '';
    const sub = me ? 'это вы' : [p.gender === 'female' ? 'Женский' : 'Мужской', age].filter(Boolean).join(' · ');
    const online = opts.allOnline || p.online;
    return `
      <div class="people-row${me ? ' me' : ''}" ${me ? '' : `onclick="closePeopleModal();openProfileModal('${p.id}')"`}>
        <div class="people-av-wrap">
          ${peopleAvatar(p)}
          ${online ? '<i class="people-dot"></i>' : ''}
        </div>
        <div class="people-info">
          <div class="people-name">${escapeHtml(p.fullname || '')}${me ? '' : ''}</div>
          <div class="people-sub ${online ? 'on' : ''}">${online ? ('🟢 в сквере' + (me ? ' · это вы' : '')) : sub}</div>
        </div>
        ${me ? '' : `<svg class="people-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`}
      </div>`;
  }).join('');
}

window.closePeopleModal = function () { document.getElementById('people-modal').classList.add('hidden'); };

window.openOnlineList = async function () {
  const modal = document.getElementById('people-modal');
  modal.classList.remove('hidden');
  document.getElementById('people-title-text').textContent = 'Сейчас в сквере';
  const listEl = document.getElementById('people-list');
  document.getElementById('people-count').textContent = '';
  listEl.innerHTML = '<div class="people-loading">Загрузка...</div>';
  try {
    const { users, guests, total } = await fetch('/api/online/list').then(r => r.json());
    document.getElementById('people-count').textContent = total || 0;
    let html = '';
    if (users.length) html += renderPeopleRows(users, { allOnline: true });
    if (guests > 0) {
      html += `<div class="people-guests">${icon('users', 16)} +${guests} ${guests === 1 ? 'гость' : 'гостей'} (без профиля)</div>`;
    }
    if (!html) html = `<div class="people-empty">${icon('users', 32)}<p>Пока никого нет</p><span>Будьте первым на карте!</span></div>`;
    listEl.innerHTML = html;
  } catch { listEl.innerHTML = '<div class="people-loading" style="color:#e74c3c">Ошибка загрузки</div>'; }
};

window.openFriendsList = async function (onlyOnline = false) {
  const modal = document.getElementById('people-modal');
  modal.classList.remove('hidden');
  document.getElementById('people-title-text').textContent = onlyOnline ? 'Друзья онлайн' : 'Мои друзья';
  const listEl = document.getElementById('people-list');
  document.getElementById('people-count').textContent = '';
  listEl.innerHTML = '<div class="people-loading">Загрузка...</div>';
  try {
    let friends = await fetch('/api/friends').then(r => r.json());
    if (onlyOnline) friends = friends.filter(f => f.online);
    friends.sort((a, b) => (b.online - a.online) || a.fullname.localeCompare(b.fullname));
    document.getElementById('people-count').textContent = friends.length;
    if (!friends.length) {
      listEl.innerHTML = `<div class="people-empty">${icon('users', 32)}<p>${onlyOnline ? 'Нет друзей онлайн' : 'Пока нет друзей'}</p><span>${onlyOnline ? 'Загляните позже' : 'Знакомьтесь на карте и добавляйте в друзья'}</span></div>`;
      return;
    }
    listEl.innerHTML = renderPeopleRows(friends);
  } catch { listEl.innerHTML = '<div class="people-loading" style="color:#e74c3c">Ошибка загрузки</div>'; }
};

async function refreshOnlineCount() {
  try {
    const { total } = await fetch('/api/online').then(r => r.json());
    animateCount(document.getElementById('home-online-count'), total || 0);
  } catch {}
}

async function refreshNotifCount() {
  try {
    const { count } = await fetch('/api/notifications/count').then(r => r.json());
    window.setNotifCount(count || 0);
  } catch {}
}

function startOnlinePolling() {
  stopOnlinePolling();
  onlinePollTimer = setInterval(() => {
    if (document.getElementById('home-page').style.display === 'none') return;
    refreshOnlineCount();
    loadHomeFriends();
  }, 12000);
}
function stopOnlinePolling() { if (onlinePollTimer) { clearInterval(onlinePollTimer); onlinePollTimer = null; } }

window.enterGameFromHome = function () {
  document.getElementById('home-page').style.display = 'none';
  enterGame();
};

window.goHome = function () {
  document.getElementById('game-ui').style.display = 'none';
  document.getElementById('notif-panel').classList.add('hidden');
  enterHome();
};

window.logout = async function () {
  try { await fetch('/auth/logout', { method: 'POST' }); } catch {}
  location.reload();
};

async function enterGame() {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('home-page').style.display = 'none';
  document.getElementById('game-ui').style.display = '';
  stopOnlinePolling();
  if (worldInited) return;      // мир инициализируется только один раз
  worldInited = true;
  const { initWorld } = await import('./main.js');
  initWorld(currentUser);
  bindGameUI();
}

// ─── AUTH ──────────────────────────────────────────────────────────────────────
function showAuth() {
  document.getElementById('auth-overlay').style.display = '';
  document.getElementById('game-ui').style.display = 'none';
  renderAuthStep();
}

window.toggleAuthMode = function () {
  authMode = authMode === 'register' ? 'login' : 'register';
  activeStep = 1; selectedGender = null; photoFile = null; photoIdFile = null;
  renderAuthStep();
  document.getElementById('auth-toggle-text').textContent = authMode === 'register' ? 'Уже есть аккаунт?' : 'Нет аккаунта?';
  document.getElementById('auth-toggle-link').textContent = authMode === 'register' ? 'Войти' : 'Регистрация';
};

function renderAuthStep() {
  document.querySelectorAll('.auth-step').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.step-dot').forEach((el, i) => {
    el.classList.toggle('active', i + 1 === activeStep);
    el.classList.toggle('done', i + 1 < activeStep);
  });
  if (authMode === 'login') {
    document.getElementById('step-login').classList.remove('hidden');
    document.getElementById('steps-indicator').style.display = 'none';
    document.getElementById('auth-title').textContent = 'Войти';
  } else {
    document.getElementById('steps-indicator').style.display = '';
    document.getElementById('auth-title').textContent = 'Регистрация';
    document.getElementById(`step-${activeStep}`).classList.remove('hidden');
  }
}

window.authNext = function () {
  if (authMode === 'login') return;
  if (activeStep === 1) {
    if (!selectedGender) { showToast('Выберите пол', 'error'); return; }
  }
  if (activeStep === 2) {
    const fn = document.getElementById('reg-fullname').value.trim();
    const ph = document.getElementById('reg-phone').value.trim();
    const pw = document.getElementById('reg-password').value;
    const by = document.getElementById('reg-birthyear').value;
    if (!fn) { showToast('Введите ФИО', 'error'); return; }
    if (ph.replace(/\D/g, '').length < 12) { showToast('Введите полный номер телефона', 'error'); return; }
    if (!pw) { showToast('Введите пароль', 'error'); return; }
    if (pw.length < 6) { showToast('Пароль минимум 6 символов', 'error'); return; }
    if (!by) { showToast('Выберите год рождения', 'error'); return; }
  }
  activeStep++; renderAuthStep();
};

window.authBack = function () { if (activeStep > 1) { activeStep--; renderAuthStep(); } };

window.selectGender = function (g) {
  selectedGender = g;
  document.querySelectorAll('.gender-card').forEach(c => c.classList.toggle('selected', c.dataset.gender === g));
};

window.setupPhotoUpload = function (inputId, previewId, type) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  document.getElementById(previewId + '-area').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files[0]; if (!file) return;
    if (type === 'photo') photoFile = file;
    else photoIdFile = file;
    const reader = new FileReader();
    reader.onload = e => {
      preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">`;
    };
    reader.readAsDataURL(file);
  });
};

window.submitRegister = async function () {
  if (!photoFile) { showToast('Загрузите фото профиля', 'error'); return; }
  const fd = new FormData();
  fd.append('gender', selectedGender);
  fd.append('fullname', document.getElementById('reg-fullname').value.trim());
  fd.append('phone', document.getElementById('reg-phone').value.trim());
  fd.append('password', document.getElementById('reg-password').value);
  fd.append('birthyear', document.getElementById('reg-birthyear').value);
  fd.append('photo', photoFile);
  if (photoIdFile) fd.append('photo_id', photoIdFile);

  const btn = document.getElementById('reg-submit-btn');
  btn.disabled = true; btn.textContent = 'Создание...';
  try {
    const res = await fetch('/auth/register', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Ошибка', 'error'); btn.disabled = false; btn.textContent = 'Создать аккаунт'; return; }
    currentUser = data.user;
    enterHome();
  } catch (e) { showToast('Ошибка сети', 'error'); btn.disabled = false; btn.textContent = 'Создать аккаунт'; }
};

window.submitLogin = async function () {
  const phone = document.getElementById('login-phone').value.trim();
  const password = document.getElementById('login-password').value;
  if (!phone || !password) { document.getElementById('login-error').textContent = 'Заполните все поля'; return; }
  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = 'Вход...';
  try {
    const res = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }) });
    const data = await res.json();
    if (!res.ok) { document.getElementById('login-error').textContent = data.error || 'Ошибка'; btn.disabled = false; btn.textContent = 'Войти'; return; }
    currentUser = data.user;
    enterHome();
  } catch (e) { document.getElementById('login-error').textContent = 'Ошибка сети'; btn.disabled = false; btn.textContent = 'Войти'; }
};

// ─── GAME UI BINDINGS ─────────────────────────────────────────────────────────
function bindGameUI() {
  const nd = document.getElementById('player-name-display');
  if (nd) nd.textContent = currentUser.fullname || '';
  document.getElementById('close-card').onclick = closePlaceCard;
}

// ─── PLACE CARD ───────────────────────────────────────────────────────────────
window.openPlaceCard = async function (place) {
  openPlaceData = place;
  activePlaceTab = 'info';
  const card = document.getElementById('place-card');
  document.getElementById('place-category').textContent = place.category;
  document.getElementById('place-title').textContent = place.name;
  document.getElementById('place-desc').textContent = place.description;

  // Show/hide tabs
  document.getElementById('tab-btn-menu').style.display = place.hasMenu ? '' : 'none';
  document.getElementById('tab-btn-booking').style.display = place.hasBooking ? '' : 'none';
  document.getElementById('tab-btn-bookings').style.display = place.hasBooking ? '' : 'none';

  // Location
  const locAddr = place.location || 'Ташкент, Сквер им. Амира Темура';
  const webMapUrl = place.lat ? `https://yandex.uz/maps/?ll=${place.lng},${place.lat}&z=17&pt=${place.lng},${place.lat},pm2ntm&text=${encodeURIComponent(place.name)}` : null;
  const appMapUrl = place.lat ? `yandexmaps://maps.yandex.com/?ll=${place.lng},${place.lat}&z=17` : null;
  document.getElementById('place-location-text').innerHTML = `<p>${icon('pin', 15)} ${locAddr}</p>${place.workHours ? `<p>${icon('clock', 15)} ${place.workHours}</p>` : ''}`;
  document.getElementById('place-map-btns').innerHTML = webMapUrl ? `
    <a href="${webMapUrl}" target="_blank" rel="noopener" class="map-btn">
      ${icon('map', 16)} Открыть на Яндекс Картах
    </a>
    <a href="${appMapUrl}" class="map-btn map-btn-app">
      ${icon('phone', 14)} Открыть в приложении
    </a>` : `<div class="map-stub-text">${icon('map', 18)} Ташкент · Сквер им. Амира Темура</div>`;

  switchPlaceTab('info');
  card.classList.remove('hidden');
};

window.closePlaceCard = function () { document.getElementById('place-card').classList.add('hidden'); openPlaceData = null; };

window.switchPlaceTab = async function (tab) {
  activePlaceTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== `tab-${tab}`));

  if (tab === 'menu' && openPlaceData?.hasMenu) await loadMenu();
  if (tab === 'bookings' && openPlaceData?.hasBooking) await loadPlaceBookings();
};

async function loadMenu() {
  const el = document.getElementById('menu-list');
  el.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const items = await fetch(`/api/menu/${encodeURIComponent(openPlaceData.name)}`).then(r => r.json());
    if (!items.length) { el.innerHTML = '<p style="color:#888;text-align:center">Меню не доступно</p>'; return; }
    el.innerHTML = items.map(it => `
      <div class="menu-item">
        <span class="menu-emoji">${it.emoji || '🍽'}</span>
        <span class="menu-name">${it.name}</span>
        <span class="menu-price">${it.price.toLocaleString()} сум</span>
      </div>`).join('');
  } catch { el.innerHTML = '<p style="color:#e74c3c">Ошибка загрузки меню</p>'; }
}

async function loadPlaceBookings() {
  const el = document.getElementById('bookings-list');
  el.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const rows = await fetch(`/api/bookings/place/${encodeURIComponent(openPlaceData.id)}`).then(r => r.json());
    if (!rows.length) { el.innerHTML = '<p style="color:#888;text-align:center;padding:20px">Броней пока нет</p>'; return; }
    el.innerHTML = rows.map(b => `
      <div class="booking-row">
        ${b.photo ? `<img src="/uploads/${b.photo}" class="booking-avatar">` : `<div class="booking-avatar-placeholder">${(b.fullname || '?')[0]}</div>`}
        <div class="booking-info">
          <div class="booking-name">${b.fullname}</div>
          <div class="booking-meta">${icon('calendar',13)} ${b.date} · ${icon('clock',13)} ${b.time} · ${icon('users',13)} ${b.guests} чел.</div>
          ${b.comment ? `<div class="booking-comment">"${b.comment}"</div>` : ''}
        </div>
        <div class="booking-status ${b.status}">${b.status === 'pending' ? 'Ожидает' : b.status === 'confirmed' ? 'Подтверждено' : 'Отменено'}</div>
      </div>`).join('');
  } catch { el.innerHTML = '<p style="color:#e74c3c">Ошибка загрузки</p>'; }
}

window.submitBooking = async function () {
  if (!openPlaceData) return;
  const date = document.getElementById('book-date').value;
  const time = document.getElementById('book-time').value;
  const guests = document.getElementById('book-guests').value;
  const comment = document.getElementById('book-comment').value.trim();
  if (!date || !time) { showToast('Укажите дату и время', 'error'); return; }

  const btn = document.getElementById('book-submit-btn');
  btn.disabled = true; btn.textContent = 'Бронируем...';
  try {
    const res = await fetch('/api/bookings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ place_id: openPlaceData.id, date, time, guests, comment })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Ошибка', 'error'); btn.disabled = false; btn.textContent = 'Забронировать'; return; }
    document.getElementById('booking-msg').innerHTML = `<div class="booking-success">${icon('check', 16)} Бронирование подтверждено!</div>`;
    btn.disabled = false; btn.textContent = 'Забронировать';
    document.getElementById('book-date').value = '';
    document.getElementById('book-comment').value = '';
    setTimeout(() => { document.getElementById('booking-msg').innerHTML = ''; }, 3500);
  } catch { showToast('Ошибка сети', 'error'); btn.disabled = false; btn.textContent = 'Забронировать'; }
};

// ─── PROFILE MODAL ────────────────────────────────────────────────────────────
window.openProfileModal = async function (userId) {
  if (!userId || userId === currentUser?.id) return;
  const modal = document.getElementById('profile-modal');
  modal.classList.remove('hidden');
  document.getElementById('profile-content').innerHTML = '<div class="loading" style="padding:40px">Загрузка...</div>';
  try {
    const data = await fetch(`/api/profile/${userId}`).then(r => r.json());
    const age = new Date().getFullYear() - data.birthyear;
    const genderText = data.gender === 'male'
      ? `${icon('user', 14)} Мужской`
      : `${icon('user', 14)} Женский`;
    let actionsHtml = '';
    if (data.friendStatus === 'none') {
      actionsHtml = `<button class="profile-btn primary" onclick="sendFriendRequest('${userId}', this)">${icon('user_plus', 16)} Добавить в друзья</button>`;
    } else if (data.friendStatus === 'pending_sent') {
      actionsHtml = `<button class="profile-btn" disabled>${icon('hourglass', 16)} Заявка отправлена</button>`;
    } else if (data.friendStatus === 'pending_received') {
      actionsHtml = `
        <button class="profile-btn primary" onclick="respondFriendRequest('${data.requestId}', true)">${icon('check_sm', 16)} Принять</button>
        <button class="profile-btn danger" onclick="respondFriendRequest('${data.requestId}', false)">${icon('x', 16)} Отклонить</button>`;
    } else if (data.friendStatus === 'friends') {
      actionsHtml = `<button class="profile-btn primary" onclick="openPrivateChat('${userId}', '${data.fullname}')">${icon('message', 16)} Написать</button>`;
    }
    document.getElementById('profile-content').innerHTML = `
      <div class="profile-photo-wrap">
        ${data.photo ? `<img src="/uploads/${data.photo}" class="profile-photo">` : `<div class="profile-photo-placeholder">${(data.fullname || '?')[0].toUpperCase()}</div>`}
      </div>
      <h2 class="profile-fullname">${data.fullname}</h2>
      <div class="profile-meta">
        <span>${genderText}</span>
        <span>${icon('calendar', 14)} ${age} лет</span>
      </div>
      <div class="profile-actions" id="profile-actions">${actionsHtml}</div>`;
  } catch { document.getElementById('profile-content').innerHTML = '<p style="color:#e74c3c;text-align:center">Ошибка загрузки профиля</p>'; }
};

window.closeProfileModal = function () { document.getElementById('profile-modal').classList.add('hidden'); };

window.sendFriendRequest = async function (userId, btn) {
  btn.disabled = true; btn.textContent = 'Отправка...';
  try {
    const res = await fetch(`/api/friends/request/${userId}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Ошибка', 'error'); btn.disabled = false; btn.innerHTML = `${icon('user_plus', 16)} Добавить в друзья`; return; }
    btn.innerHTML = `${icon('hourglass', 16)} Заявка отправлена`;
    showToast('Заявка отправлена!', 'success');
  } catch { showToast('Ошибка сети', 'error'); btn.disabled = false; btn.innerHTML = `${icon('user_plus', 16)} Добавить в друзья`; }
};

window.respondFriendRequest = async function (requestId, accept) {
  try {
    const res = await fetch(`/api/friends/respond/${requestId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accept })
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Ошибка', 'error'); return; }
    showToast(accept ? 'Вы стали друзьями!' : 'Заявка отклонена', accept ? 'success' : 'info');
    const actions = document.getElementById('profile-actions');
    if (actions) {
      if (accept) {
        const userId = document.getElementById('profile-modal').dataset.userId;
        actions.innerHTML = `<button class="profile-btn primary" onclick="openPrivateChat('${userId}', '')">${icon('message', 16)} Написать</button>`;
      } else {
        actions.innerHTML = `<button class="profile-btn" disabled>Заявка отклонена</button>`;
      }
    }
  } catch { showToast('Ошибка сети', 'error'); }
};

// ─── MUSIC TOGGLE ────────────────────────────────────────────────────────────
window.uiToggleMusic = function () {
  const muted = window._toggleMusic ? window._toggleMusic() : true;
  const btn = document.getElementById('music-btn');
  if (!btn) return;
  btn.classList.toggle('muted', muted);
  btn.title = muted ? 'Включить музыку' : 'Выключить музыку';
};

// ─── MY PROFILE ───────────────────────────────────────────────────────────────
let myProfilePhoto = null;
let _myProfileData = null;

window.openMyProfile = async function () {
  const modal = document.getElementById('my-profile-modal');
  modal.classList.remove('hidden');
  document.getElementById('my-profile-content').innerHTML = '<div class="loading" style="padding:40px">Загрузка...</div>';
  try {
    const data = await fetch('/api/profile/me').then(r => r.json());
    currentUser = data; _myProfileData = data;
    renderMyProfile(data, false);
  } catch { document.getElementById('my-profile-content').innerHTML = '<p style="color:#e74c3c;text-align:center">Ошибка загрузки</p>'; }
};

window._myProfileEdit = () => { if (_myProfileData) renderMyProfile(_myProfileData, true); };
window._myProfileView = () => { if (_myProfileData) renderMyProfile(_myProfileData, false); };

window.closeMyProfile = function () {
  document.getElementById('my-profile-modal').classList.add('hidden');
  myProfilePhoto = null;
};

function renderMyProfile(data, editMode) {
  const age = new Date().getFullYear() - data.birthyear;
  if (!editMode) {
    document.getElementById('my-profile-content').innerHTML = `
      <div class="profile-photo-wrap">
        ${data.photo ? `<img src="/uploads/${data.photo}" class="profile-photo">` : `<div class="profile-photo-placeholder">${(data.fullname || '?')[0].toUpperCase()}</div>`}
      </div>
      <h2 class="profile-fullname">${escapeHtml(data.fullname)}</h2>
      <div class="profile-meta">
        <span>${data.gender === 'male' ? icon('user', 14) + ' Мужской' : icon('user', 14) + ' Женский'}</span>
        <span>${icon('calendar', 14)} ${age} лет</span>
      </div>
      <div class="profile-meta" style="margin-bottom:18px">
        <span>${icon('phone', 13)} ${data.phone}</span>
      </div>
      <button class="auth-btn" onclick="_myProfileEdit()" style="font-size:13px">
        ${icon('id_card', 15)} Редактировать профиль
      </button>`;
  } else {
    document.getElementById('my-profile-content').innerHTML = `
      <div class="profile-photo-wrap" style="cursor:pointer" onclick="document.getElementById('edit-photo-input').click()" title="Нажмите для смены фото">
        <div id="edit-photo-preview" style="width:90px;height:90px;border-radius:50%;overflow:hidden;margin:0 auto;border:3px solid #e0e7ef;display:flex;align-items:center;justify-content:center;background:#f0f4f8;color:#aaa">
          ${data.photo ? `<img src="/uploads/${data.photo}" style="width:100%;height:100%;object-fit:cover">` : `<span style="font-size:36px;font-weight:700">${(data.fullname||'?')[0].toUpperCase()}</span>`}
        </div>
        <div style="text-align:center;font-size:11px;color:#1a6fc4;margin-top:5px">${icon('camera',12)} Сменить фото</div>
        <input type="file" id="edit-photo-input" accept="image/*" hidden>
      </div>
      <div class="input-group" style="margin-top:14px">
        <svg class="input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <input type="text" id="edit-fullname" class="auth-input with-icon" value="${escapeHtml(data.fullname)}" placeholder="ФИО">
      </div>
      <div class="input-group">
        <svg class="input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <input type="number" id="edit-birthyear" class="auth-input with-icon" value="${data.birthyear}" min="1930" max="2010">
      </div>
      <div id="edit-error" class="error-msg"></div>
      <button class="auth-btn" id="edit-save-btn" onclick="saveMyProfile()" style="font-size:14px">
        ${icon('check', 15)} Сохранить
      </button>
      <button class="auth-btn-ghost" onclick="_myProfileView()" style="font-size:13px">
        ${icon('arrow_left', 14)} Отмена
      </button>`;
    document.getElementById('edit-photo-input').addEventListener('change', function () {
      const file = this.files[0]; if (!file) return;
      myProfilePhoto = file;
      const reader = new FileReader();
      reader.onload = e => { document.getElementById('edit-photo-preview').innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`; };
      reader.readAsDataURL(file);
    });
  }
}

window.saveMyProfile = async function () {
  const btn = document.getElementById('edit-save-btn');
  const fullname = document.getElementById('edit-fullname').value.trim();
  const birthyear = document.getElementById('edit-birthyear').value;
  if (!fullname) { document.getElementById('edit-error').textContent = 'Введите ФИО'; return; }
  btn.disabled = true; btn.innerHTML = `${icon('hourglass', 14)} Сохранение...`;
  try {
    const fd = new FormData();
    fd.append('fullname', fullname);
    fd.append('birthyear', birthyear);
    if (myProfilePhoto) fd.append('photo', myProfilePhoto);
    const res = await fetch('/api/profile/me', { method: 'PUT', body: fd });
    const data = await res.json();
    if (!res.ok) { document.getElementById('edit-error').textContent = data.error || 'Ошибка'; btn.disabled = false; btn.innerHTML = `${icon('check', 15)} Сохранить`; return; }
    currentUser = data.user; _myProfileData = data.user;
    myProfilePhoto = null;
    showToast('Профиль обновлён!', 'success');
    renderMyProfile(data.user, false);
    if (window._skverSocket) window._skverSocket.emit('identify', data.user.id);
  } catch { document.getElementById('edit-error').textContent = 'Ошибка сети'; btn.disabled = false; btn.innerHTML = `${icon('check', 15)} Сохранить`; }
};

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
window.setNotifCount = function (n) {
  notifCount = n;
  for (const id of ['notif-badge', 'home-notif-badge']) {
    const badge = document.getElementById(id);
    if (!badge) continue;
    badge.textContent = n;
    badge.style.display = n > 0 ? '' : 'none';
  }
};

window.handleNotification = function (data) {
  // Счётчик обновляется сервером через событие 'notifCount' — здесь только тосты/UI
  if (data.type === 'friend_request') {
    showToast(`${data.fromName} хочет добавить вас в друзья`, 'info', 5000);
  } else if (data.type === 'friend_accepted') {
    showToast(`${data.fromName} принял(а) вашу заявку!`, 'success');
    if (document.getElementById('home-page').style.display !== 'none') loadHomeFriends();
  } else if (data.type === 'message') {
    // не показываем тост, если открыт чат именно с этим человеком
    const chatOpen = privateChatUserId === data.fromId &&
      !document.getElementById('private-chat').classList.contains('hidden');
    if (!chatOpen) showToast(`💬 ${data.fromName}: ${(data.content || '').slice(0, 40)}`, 'info', 5000);
  }
  // обновим список друзей на главной (статусы/онлайн)
  if (document.getElementById('home-page').style.display !== 'none' && data.type === 'friend_request') loadHomeFriends();
};

window.toggleNotifications = async function () {
  const panel = document.getElementById('notif-panel');
  if (panel.classList.toggle('hidden')) return;
  await loadNotifications();
  try {
    const r = await fetch('/api/notifications/read', { method: 'POST' }).then(r => r.json());
    window.setNotifCount(r.count || 0);   // могут остаться непрочитанные сообщения
  } catch { window.setNotifCount(0); }
};

async function loadNotifications() {
  const list = document.getElementById('notif-list');
  list.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const items = await fetch('/api/notifications').then(r => r.json());
    if (!items.length) { list.innerHTML = '<p style="color:#888;text-align:center;padding:20px">Уведомлений нет</p>'; return; }
    list.innerHTML = items.map(n => {
      const d = n.data;
      if (n.type === 'friend_request') {
        return `<div class="notif-item ${n.read ? '' : 'unread'}">
          ${d.fromPhoto ? `<img src="/uploads/${d.fromPhoto}" class="notif-avatar">` : `<div class="notif-avatar-placeholder">${(d.fromName || '?')[0]}</div>`}
          <div class="notif-body">
            <div class="notif-text"><b>${d.fromName}</b> хочет добавить вас в друзья</div>
            <div class="notif-actions">
              <button class="notif-btn accept" onclick="respondFriendRequest('${d.requestId}', true); this.closest('.notif-item').remove()">Принять</button>
              <button class="notif-btn reject" onclick="respondFriendRequest('${d.requestId}', false); this.closest('.notif-item').remove()">Отклонить</button>
            </div>
          </div>
        </div>`;
      } else if (n.type === 'friend_accepted') {
        return `<div class="notif-item ${n.read ? '' : 'unread'}">
          <div class="notif-avatar-placeholder">${icon('check_sm', 16, '#22c55e')}</div>
          <div class="notif-body"><div class="notif-text"><b>${d.fromName}</b> принял(а) вашу заявку в друзья</div></div>
        </div>`;
      } else if (n.type === 'message') {
        const safeName = escapeHtml(d.fromName || '');
        return `<div class="notif-item ${n.read ? '' : 'unread'}" style="cursor:pointer" onclick="toggleNotifications();openPrivateChat('${d.fromId}','${safeName.replace(/'/g, "\\'")}')">
          ${d.fromPhoto ? `<img src="/uploads/${d.fromPhoto}" class="notif-avatar">` : `<div class="notif-avatar-placeholder">${(d.fromName || '?')[0]}</div>`}
          <div class="notif-body">
            <div class="notif-text"><b>${safeName}</b> ${d.count > 1 ? `· ${d.count} сообщ.` : ''}</div>
            <div class="notif-msg-preview">${escapeHtml((d.content || '').slice(0, 60))}</div>
          </div>
        </div>`;
      }
      return '';
    }).join('');
  } catch { list.innerHTML = '<p style="color:#e74c3c">Ошибка загрузки</p>'; }
}

// ─── PRIVATE CHAT ─────────────────────────────────────────────────────────────
window.openPrivateChat = async function (userId, userName) {
  privateChatUserId = userId;
  document.getElementById('pchat-title').textContent = userName || 'Чат';
  document.getElementById('profile-modal').classList.add('hidden');
  const panel = document.getElementById('private-chat');
  panel.classList.remove('hidden');
  await loadMessages();
};

window.closePrivateChat = function () {
  document.getElementById('private-chat').classList.add('hidden');
  privateChatUserId = null;
};

async function loadMessages() {
  if (!privateChatUserId) return;
  const log = document.getElementById('pchat-log');
  log.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const msgs = await fetch(`/api/messages/${privateChatUserId}`).then(r => r.json());
    log.innerHTML = '';
    msgs.forEach(m => appendPrivateMessage(m));
    log.scrollTop = log.scrollHeight;
  } catch { log.innerHTML = '<p style="color:#e74c3c">Ошибка загрузки</p>'; }
}

function appendPrivateMessage(msg) {
  const log = document.getElementById('pchat-log');
  const mine = msg.fromId === currentUser?.id;
  const div = document.createElement('div');
  div.className = `pchat-msg ${mine ? 'mine' : 'theirs'}`;
  div.innerHTML = `${!mine ? `<div class="pchat-sender">${msg.fullname}</div>` : ''}
    <div class="pchat-bubble">${escapeHtml(msg.content)}</div>`;
  log.appendChild(div);
}

window.sendPrivateMessage = function () {
  const input = document.getElementById('pchat-input');
  const content = input.value.trim();
  if (!content || !privateChatUserId || !window._skverSocket) return;
  window._skverSocket.emit('privateMessage', { toUserId: privateChatUserId, content });
  input.value = '';
};

window.handlePrivateMessage = function (msg) {
  // Показываем в открытом чате; тост о новом сообщении приходит отдельным
  // событием 'notification' (type: message), счётчик ведёт сервер.
  if (msg.fromId === privateChatUserId || (msg.fromId === currentUser?.id && msg.toId === privateChatUserId)) {
    appendPrivateMessage(msg);
    const log = document.getElementById('pchat-log');
    log.scrollTop = log.scrollHeight;
  }
};

document.getElementById('pchat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendPrivateMessage(); }
});

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3000) {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, duration);
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─── PHONE MASK ───────────────────────────────────────────────────────────────
function initPhoneMask(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  function fmt(v) {
    let d = v.replace(/\D/g, '');
    if (d.startsWith('998')) d = d.slice(3);
    d = d.slice(0, 9);
    let o = '+998';
    if (d.length >= 1) o += ' ' + d.slice(0, 2);
    if (d.length >= 3) o += ' ' + d.slice(2, 5);
    if (d.length >= 6) o += ' ' + d.slice(5, 7);
    if (d.length >= 8) o += ' ' + d.slice(7, 9);
    return o;
  }
  el.addEventListener('focus', () => { if (!el.value) el.value = '+998 '; });
  el.addEventListener('input', () => { const v = el.value; el.value = fmt(v); });
  el.addEventListener('keydown', e => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && el.value.length <= 6) e.preventDefault();
  });
  el.addEventListener('blur', () => { if (el.value === '+998 ' || el.value === '+998') el.value = ''; });
}

// ─── YEAR PICKER ──────────────────────────────────────────────────────────────
function initYearPicker() {
  const input = document.getElementById('reg-birthyear');
  const dropdown = document.getElementById('year-picker-dropdown');
  const grid = document.getElementById('year-picker-grid');
  if (!input || !dropdown || !grid) return;
  for (let y = 2008; y >= 1940; y--) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = y; btn.className = 'year-cell'; btn.dataset.year = y;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      input.value = y;
      grid.querySelectorAll('.year-cell').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      dropdown.classList.add('hidden');
    });
    grid.appendChild(btn);
  }
  input.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
    if (!dropdown.classList.contains('hidden')) {
      const sel = grid.querySelector('.year-cell.selected');
      if (sel) setTimeout(() => sel.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
    }
  });
  document.addEventListener('click', () => { if (dropdown) dropdown.classList.add('hidden'); });
}

// ─── PASSWORD TOGGLE ──────────────────────────────────────────────────────────
window.togglePw = function (inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input || !btn) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = show
    ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
    : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
};

// ─── SETUP PHOTO PREVIEWS ON DOM READY ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  window.setupPhotoUpload('reg-photo', 'photo-preview', 'photo');
  window.setupPhotoUpload('reg-photo-id', 'photo-id-preview', 'photo_id');
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('book-date').min = today;
  document.getElementById('book-date').value = today;
  initPhoneMask('reg-phone');
  initPhoneMask('login-phone');
  initYearPicker();
  init();
});
