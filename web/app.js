/* Tom · application logic */
(function () {
  'use strict';

  if (window.TOM_BOOT_ERROR || !window.TomCloud) {
    document.getElementById('loadingMask').classList.remove('hidden');
    document.getElementById('loadingText').textContent = window.TOM_BOOT_ERROR || '云端服务未就绪，请刷新重试';
    return;
  }

  var C = window.TomCloud;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  var initial = function (n) { return (String(n || 'T').trim()[0] || 'T').toUpperCase(); };
  var rid = function () { return (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '' + Math.random()).replace(/-/g, '').slice(0, 18); };

  var EMOJIS = ['😀','😄','😁','😂','🤣','😊','😍','🥰','😘','😉','😎','🤔','😳','😭','😡','🥺','😴','🤗','👍','👏','🙌','🤝','💪','🙏','❤️','💕','✨','🎉','🔥','🌈','☀️','🌙','🍀','🍉','☕','🎵','🐱','🐶','🚀','💡'];
  var STATUS_LABEL = { online: '在线', away: '离开', busy: '忙碌', invisible: '隐身' };

  var state = {
    session: null, uid: '', me: null, profiles: {}, friends: [], conversations: [],
    messages: [], activeConv: null, view: 'messages', loginMode: 'phone',
    pendingOtp: null, lastMsgId: 0, unread: {}, seen: {}, searchTerm: '',
    signedUrlCache: {}, timer: null, convTimer: null, codeTimer: null,
    settings: { notify: true, sound: true }, favorites: []
  };

  /* ---------------- helpers ---------------- */
  function toast(text, type) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (type ? ' ' + type : '');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.add('hidden'); }, 2800);
  }
  function loading(show, text) {
    $('loadingText').textContent = text || '正在连接云端…';
    $('loadingMask').classList.toggle('hidden', !show);
  }
  function openModal(html, onMount) {
    $('modalBox').innerHTML = html;
    $('modalBackdrop').classList.remove('hidden');
    if (onMount) onMount($('modalBox'));
  }
  function closeModal() { $('modalBackdrop').classList.add('hidden'); }
  function modalHead(title) {
    return '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="icon-btn" data-close><svg><use href="#i-close"/></svg></button></div>';
  }
  function confirmDialog(title, desc, okText, danger, onOk) {
    openModal(modalHead(title) + '<p class="modal-desc">' + esc(desc) + '</p>' +
      '<div class="modal-actions"><button class="btn-cancel" data-close>取消</button>' +
      '<button class="' + (danger ? 'btn-danger' : 'btn-ok') + '" data-ok>' + esc(okText) + '</button></div>',
      function (box) {
        box.querySelector('[data-ok]').onclick = function () { closeModal(); onOk(); };
      });
  }
  function fmtTime(iso) {
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtListTime(iso) {
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    var now = new Date();
    if (d.toDateString() === now.toDateString()) return fmtTime(iso);
    var y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天';
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function beep() {
    if (!state.settings.sound) return;
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; o.type = 'sine'; g.gain.value = .045;
      o.start(); o.stop(ctx.currentTime + .09);
    } catch (e) { /* audio unavailable */ }
  }
  function setConn(ok) {
    var el = $('connStatus');
    el.classList.toggle('offline', !ok);
    el.innerHTML = '<i></i>' + (ok ? '已连接' : '连接中…');
  }
  function getSigned(path) {
    var c = state.signedUrlCache[path];
    if (c && c.exp > Date.now()) return Promise.resolve(c.url);
    return C.signUrl(path).then(function (r) {
      if (r.data) state.signedUrlCache[path] = { url: r.data, exp: Date.now() + 45 * 60 * 1000 };
      return r.data || '';
    });
  }
  function fillAvatar(el, name, avatarUrl) {
    el.textContent = initial(name);
    if (!avatarUrl) return;
    if (/^https?:\/\//i.test(avatarUrl)) {
      var img = document.createElement('img'); img.src = avatarUrl; img.alt = '';
      el.innerHTML = ''; el.appendChild(img); return;
    }
    getSigned(avatarUrl).then(function (url) {
      if (!url) return;
      var img2 = document.createElement('img'); img2.src = url; img2.alt = '';
      el.innerHTML = ''; el.appendChild(img2);
    });
  }
  function fillRailAvatar(name, avatarUrl) {
    var ra = $('railAvatar');
    var old = ra.querySelector('img'); if (old) old.remove();
    var txt = $('railAvatarText');
    if (!avatarUrl) { txt.textContent = initial(name); txt.style.display = ''; return; }
    txt.style.display = 'none';
    var apply = function (url) {
      var img = document.createElement('img'); img.src = url; img.alt = '';
      ra.insertBefore(img, ra.firstChild);
    };
    if (/^https?:\/\//i.test(avatarUrl)) apply(avatarUrl);
    else getSigned(avatarUrl).then(function (url) {
      if (url) apply(url);
      else { txt.textContent = initial(name); txt.style.display = ''; }
    });
  }
  function avatarNode(name, avatarUrl, cls) {
    var el = document.createElement('div');
    el.className = 'avatar ' + (cls || '');
    fillAvatar(el, name, avatarUrl);
    return el;
  }
  function profileOf(uid) { return state.profiles[uid] || null; }
  function displayName(uid) { var p = profileOf(uid); return p ? p.nickname : ('用户 ' + String(uid).slice(0, 6)); }
  function displayAvatar(uid) { var p = profileOf(uid); return p ? p.avatar_url : null; }
  function convTitle(conv) {
    if (conv.type === 'group') return conv.name || '群聊';
    var other = (conv.member_ids || []).filter(function (u) { return u !== state.uid; })[0];
    return other ? displayName(other) : '新会话';
  }
  function convAvatar(conv) {
    if (conv.type === 'group') return { name: conv.name || '群', url: conv.avatar_url, group: true };
    var other = (conv.member_ids || []).filter(function (u) { return u !== state.uid; })[0];
    return { name: other ? displayName(other) : '?', url: other ? displayAvatar(other) : null };
  }
  function previewOf(m) {
    if (!m) return '暂无消息';
    if (m.kind === 'image') return '[图片]';
    if (m.kind === 'file') return '[文件] ' + (m.content || '');
    return m.content || '';
  }
  function winAction(action) {
    if (window.tomDesktop && typeof window.tomDesktop[action] === 'function') { window.tomDesktop[action](); return; }
    toast('窗口控制在桌面端可用，网页预览暂不支持');
  }

  /* ---------------- boot & auth ---------------- */
  function showLogin(message) {
    $('mainView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    loading(false);
    if (message) $('loginError').textContent = message;
  }
  function loginError(msg) { $('loginError').textContent = msg || ''; }
  function cleanCallbackUrl() {
    var u = new URL(location.href);
    ['code', 'state', 'provider'].forEach(function (k) { u.searchParams.delete(k); });
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
  async function boot() {
    loading(true, '正在连接云端…');
    var url = new URL(location.href);
    if (url.searchParams.has('code') || url.searchParams.has('error')) {
      var provider = url.searchParams.get('provider');
      if (provider === 'workbuddy') {
        var cb = await C.handleWorkBuddyCallback();
        if (cb.error) { showLogin(cb.error.message); return; }
        if (cb.data) cleanCallbackUrl();
      } else {
        if (url.searchParams.get('error')) { showLogin('授权未完成，请重新登录'); return; }
      }
    }
    var s = await C.getSession();
    if (s.error) { showLogin(s.error.message || '会话恢复失败，请重新登录'); return; }
    if (s.data && s.data.user) await enterApp(s.data);
    else showLogin();
    C.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') { stopPolling(); showLogin('已退出登录'); }
    });
  }

  async function enterApp(session) {
    state.session = session;
    state.uid = C.uidOf(session.user);
    if (!state.uid) { showLogin('无法获取账号信息，请重新登录'); return; }
    loading(true, '正在同步资料…');
    var p = await C.ensureProfile(session);
    if (p.error || !p.data) {
      showLogin('资料初始化失败：' + ((p.error && p.error.message) || '请重试')); return;
    }
    state.me = p.data;
    state.favorites = readFavorites();
    try { state.settings = JSON.parse(localStorage.getItem('tom_settings_' + state.uid)) || state.settings; } catch (e) { }
    $('loginView').classList.add('hidden');
    $('mainView').classList.remove('hidden');
    renderMe();
    if (window.TomAnon) TomAnon.mount(state.uid);
    setConn(true);
    await refreshAll();
    loading(false);
    startPolling();
    if (state.conversations.length) openConversation(state.conversations[0]);
  }

  async function refreshAll() {
    var results = await Promise.all([C.getProfiles(), C.getFriends(), C.getConversations()]);
    setConn(!results.some(function (r) { return r && r.error; }));
    if (results[0].data) {
      state.profiles = {};
      results[0].data.forEach(function (p) { state.profiles[p.owner_id] = p; });
      if (state.me) state.profiles[state.uid] = Object.assign({}, state.profiles[state.uid], state.me);
    }
    if (results[1].data) state.friends = results[1].data;
    if (results[2].data) {
      var old = {};
      state.conversations.forEach(function (c) { old[c.conv_key] = c.last_at; });
      state.conversations = results[2].data;
      state.conversations.forEach(function (c) {
        if (old[c.conv_key] && old[c.conv_key] !== c.last_at && state.activeConv && c.conv_key !== state.activeConv.conv_key) {
          state.unread[c.conv_key] = (state.unread[c.conv_key] || 0) + 1;
        }
      });
    }
    renderSidebar();
    renderMe();
    if (state.activeConv) {
      var fresh = state.conversations.filter(function (c) { return c.conv_key === state.activeConv.conv_key; })[0];
      if (fresh) { state.activeConv = fresh; renderChatHeader(); }
    }
  }

  /* ---------------- login UI ---------------- */
  function bindLogin() {
    document.querySelectorAll('.login-tab').forEach(function (tab) {
      tab.onclick = function () {
        document.querySelectorAll('.login-tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        state.loginMode = tab.dataset.mode;
        state.pendingOtp = null;
        $('accountLabel').textContent = state.loginMode === 'phone' ? '手机号' : '邮箱';
        $('loginAccount').placeholder = state.loginMode === 'phone' ? '请输入 11 位手机号' : '请输入邮箱地址';
        $('loginAccount').value = ''; $('loginCode').value = '';
        loginError('');
      };
    });
    $('loginAccount').oninput = function () { loginError(''); };
    $('sendCodeBtn').onclick = sendCode;
    $('loginBtn').onclick = submitLogin;
    $('loginCode').onkeydown = function (e) { if (e.key === 'Enter') submitLogin(); };
    $('wechatLoginBtn').onclick = async function () {
      loginError('');
      var r = await C.startWorkBuddyLogin();
      if (r.error || !r.data || !r.data.url) { loginError((r.error && r.error.message) || '登录发起失败'); return; }
      location.assign(r.data.url);
    };
  }

  async function sendCode() {
    var acc = $('loginAccount').value.trim();
    loginError('');
    if (state.loginMode === 'phone' && !/^1\d{10}$/.test(acc)) { loginError('请输入正确的 11 位手机号'); return; }
    if (state.loginMode === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acc)) { loginError('请输入正确的邮箱地址'); return; }
    $('sendCodeBtn').disabled = true;
    var r = await C.sendOtp(state.loginMode, acc);
    $('sendCodeBtn').disabled = false;
    if (r.error || !r.data) { loginError((r.error && r.error.message) || '验证码发送失败'); return; }
    state.pendingOtp = {
      account: acc, mode: state.loginMode,
      verificationId: r.data.verificationId,
      isExistingUser: r.data.isExistingUser
    };
    var left = 60;
    clearInterval(state.codeTimer);
    $('sendCodeBtn').disabled = true;
    $('sendCodeBtn').textContent = left + 's 后重发';
    state.codeTimer = setInterval(function () {
      left--;
      if (left <= 0) { clearInterval(state.codeTimer); $('sendCodeBtn').disabled = false; $('sendCodeBtn').textContent = '重新获取'; }
      else $('sendCodeBtn').textContent = left + 's 后重发';
    }, 1000);
    toast('验证码已发送，请查收', 'ok');
  }

  async function submitLogin() {
    var acc = $('loginAccount').value.trim();
    var code = $('loginCode').value.trim();
    loginError('');
    var pending = state.pendingOtp;
    if (!pending || pending.account !== acc || pending.mode !== state.loginMode) {
      loginError('请先为当前账号获取验证码'); return;
    }
    if (!/^\d{4,8}$/.test(code)) { loginError('请输入正确的验证码'); return; }
    $('loginBtn').disabled = true;
    var r = await C.verifyOtp(state.loginMode, pending, code);
    $('loginBtn').disabled = false;
    if (r.error) { loginError(r.error.message || '验证失败，请检查验证码'); return; }
    state.pendingOtp = null;
    clearInterval(state.codeTimer);
    $('sendCodeBtn').disabled = false; $('sendCodeBtn').textContent = '获取验证码';
    var s = await C.getSession();
    if (!s.data || !s.data.user) { loginError('登录状态获取失败，请重试'); return; }
    await enterApp(s.data);
  }

  /* ---------------- render: me / sidebar ---------------- */
  function renderMe() {
    if (!state.me) return;
    fillRailAvatar(state.me.nickname, state.me.avatar_url);
    var dot = $('railStatusDot');
    dot.className = 'status-dot ' + (state.me.status || 'online');
    $('sidebarMe').textContent = state.me.nickname;
    $('sidebarTomId').textContent = 'Tom号 ' + state.me.tom_id;
  }

  function renderSidebar() {
    var isMsg = state.view === 'messages';
    var isAnon = state.view === 'anon';
    $('conversationList').classList.toggle('hidden', !isMsg);
    $('contactList').classList.toggle('hidden', state.view !== 'contacts');
    $('favoriteList').classList.toggle('hidden', state.view !== 'favorites');
    $('settingsPanel').classList.toggle('hidden', state.view !== 'settings');
    if (isAnon) {
      $('listTitle').textContent = '匿名广场';
    } else {
      $('listTitle').innerHTML = ({ messages: '消息', contacts: '通讯录', favorites: '收藏', settings: '设置' })[state.view] +
        (isMsg ? ' <span>' + state.conversations.length + '</span>' : '');
      if (isMsg) renderConversations();
      else if (state.view === 'contacts') renderContacts();
      else if (state.view === 'favorites') renderFavorites();
      else renderSettings();
    }
    var total = Object.keys(state.unread).reduce(function (a, k) { return a + state.unread[k]; }, 0);
    $('railBadge').textContent = total > 99 ? '99+' : total;
    $('railBadge').classList.toggle('hidden', total === 0);
  }

  function makeItem(opts) {
    var el = document.createElement('div');
    el.className = 'list-item' + (opts.active ? ' active' : '');
    el.appendChild(opts.avatar);
    var main = document.createElement('div'); main.className = 'item-main';
    var top = document.createElement('div'); top.className = 'item-top';
    top.innerHTML = '<span class="item-name">' + esc(opts.name) + '</span>' +
      (opts.time ? '<span class="item-time">' + esc(opts.time) + '</span>' : '');
    main.appendChild(top);
    if (opts.sub) { var sub = document.createElement('div'); sub.className = 'item-sub'; sub.innerHTML = opts.subHtml || esc(opts.sub); main.appendChild(sub); }
    el.appendChild(main);
    if (opts.badge) { var b = document.createElement('span'); b.className = 'item-badge'; b.textContent = opts.badge; el.appendChild(b); }
    if (opts.onclick) el.onclick = opts.onclick;
    return el;
  }

  function renderConversations() {
    var box = $('conversationList'); box.innerHTML = '';
    var q = $('sidebarSearch').value.trim().toLowerCase();
    var list = state.conversations.filter(function (c) {
      return !q || convTitle(c).toLowerCase().indexOf(q) >= 0 || (c.last_message || '').toLowerCase().indexOf(q) >= 0;
    });
    if (!list.length) {
      box.innerHTML = '<div class="empty-list"><span class="big">💬</span>还没有会话<br>点右上角 + 添加好友或建群</div>';
      return;
    }
    list.forEach(function (c) {
      var a = convAvatar(c);
      var av = avatarNode(a.name, a.url); if (a.group) av.classList.add('group');
      var sub = (c.last_sender && c.last_sender !== state.me.nickname ? c.last_sender + '：' : '') + (c.last_message || '暂无消息');
      box.appendChild(makeItem({
        avatar: av, name: convTitle(c), time: fmtListTime(c.last_at), sub: sub,
        active: state.activeConv && state.activeConv.conv_key === c.conv_key,
        badge: state.unread[c.conv_key] || 0,
        onclick: function () { openConversation(c); }
      }));
    });
  }

  function renderContacts() {
    var box = $('contactList'); box.innerHTML = '';
    var q = $('sidebarSearch').value.trim().toLowerCase();
    var groups = {};
    state.friends.forEach(function (f) {
      var p = profileOf(f.friend_id);
      var name = p ? p.nickname : (f.friend_name || '好友');
      if (q && name.toLowerCase().indexOf(q) < 0 && (p ? p.tom_id : '').indexOf(q) < 0) return;
      var g = f.group_name || '我的好友';
      (groups[g] = groups[g] || []).push({ f: f, p: p, name: name });
    });
    var groupChats = state.conversations.filter(function (c) { return c.type === 'group' && (!q || (c.name || '').toLowerCase().indexOf(q) >= 0); });
    var t1 = document.createElement('div'); t1.className = 'group-title';
    t1.innerHTML = '<span>好友 · ' + state.friends.length + '</span><button id="addFriendLink">+ 添加</button>';
    box.appendChild(t1);
    t1.querySelector('#addFriendLink').onclick = addFriendDialog;
    Object.keys(groups).forEach(function (g) {
      var gt = document.createElement('div'); gt.className = 'group-title'; gt.textContent = g; box.appendChild(gt);
      groups[g].forEach(function (item) {
        var st = item.p ? (item.p.status || 'online') : 'online';
        box.appendChild(makeItem({
          avatar: avatarNode(item.name, item.p ? item.p.avatar_url : null, 'sm'),
          name: item.name,
          subHtml: '<span class="mini-dot ' + esc(st) + '"></span>' + esc(STATUS_LABEL[st] || '在线') + ' · Tom号 ' + esc(item.p ? item.p.tom_id : '—'),
          onclick: function () { startSingleChat(item.f.friend_id, item.name); }
        }));
      });
    });
    if (!state.friends.length) box.insertAdjacentHTML('beforeend', '<div class="empty-list">还没有好友<br>点「+ 添加」用 Tom 号找人</div>');
    var t2 = document.createElement('div'); t2.className = 'group-title';
    t2.innerHTML = '<span>群聊 · ' + groupChats.length + '</span><button id="createGroupLink">+ 建群</button>';
    box.appendChild(t2);
    t2.querySelector('#createGroupLink').onclick = createGroupDialog;
    groupChats.forEach(function (c) {
      var av = avatarNode(c.name || '群', c.avatar_url, 'sm'); av.classList.add('group');
      box.appendChild(makeItem({ avatar: av, name: c.name || '群聊', sub: (c.member_ids || []).length + ' 位成员', onclick: function () { openConversation(c); } }));
    });
  }

  function readFavorites() {
    try { return JSON.parse(localStorage.getItem('tom_favorites_' + state.uid)) || []; } catch (e) { return []; }
  }
  function saveFavorites() { localStorage.setItem('tom_favorites_' + state.uid, JSON.stringify(state.favorites)); }
  function renderFavorites() {
    var box = $('favoriteList'); box.innerHTML = '';
    box.insertAdjacentHTML('beforeend', '<div class="group-title"><span>本机收藏 · ' + state.favorites.length + '</span></div>');
    if (!state.favorites.length) {
      box.insertAdjacentHTML('beforeend', '<div class="empty-list">还没有收藏<br>把鼠标移到消息上，点 ☆ 收藏<br><small>收藏仅保存在这台电脑</small></div>');
      return;
    }
    state.favorites.forEach(function (f, i) {
      var el = document.createElement('div'); el.className = 'list-item';
      el.innerHTML = '<div class="avatar sm">★</div><div class="item-main"><div class="item-top"><span class="item-name">' +
        esc(f.from) + '</span><span class="item-time">' + esc(fmtTime(f.at)) + '</span></div>' +
        '<div class="item-sub">' + esc(f.text) + '</div></div>';
      el.onclick = function () {
        confirmDialog('删除收藏', '确定移除这条收藏吗？', '删除', true, function () {
          state.favorites.splice(i, 1); saveFavorites(); renderSidebar();
        });
      };
      box.appendChild(el);
    });
  }

  function renderSettings() {
    var box = $('settingsPanel'); box.innerHTML = '';
    box.insertAdjacentHTML('beforeend',
      '<div class="group-title">偏好设置</div>' +
      '<div class="setting-row"><div>消息通知<small>新消息时显示提示</small></div><div class="toggle ' + (state.settings.notify ? 'on' : '') + '" data-toggle="notify"></div></div>' +
      '<div class="setting-row"><div>提示音<small>收到新消息时播放轻提示</small></div><div class="toggle ' + (state.settings.sound ? 'on' : '') + '" data-toggle="sound"></div></div>' +
      '<div class="group-title">账号</div>' +
      '<div class="setting-row"><div>云端同步<small>消息与资料保存在云端</small></div><span style="color:#2ecb7b;font-size:12px">已开启</span></div>' +
      '<div class="setting-row"><div>Tom 号<small>' + esc(state.me ? state.me.tom_id : '') + '</small></div></div>' +
      '<div class="setting-row"><div>关于 Tom<small>桌面聊天客户端 v1.1.0</small></div></div>' +
      '<div style="padding:18px 4px"><button class="btn-cancel" id="logoutBtn" style="width:100%">退出登录</button></div>');
    box.querySelectorAll('[data-toggle]').forEach(function (t) {
      t.onclick = function () {
        var k = t.dataset.toggle; state.settings[k] = !state.settings[k];
        localStorage.setItem('tom_settings_' + state.uid, JSON.stringify(state.settings));
        t.classList.toggle('on', state.settings[k]);
      };
    });
    box.querySelector('#logoutBtn').onclick = function () {
      confirmDialog('退出登录', '退出后需要重新验证身份，聊天记录仍保留在云端。', '退出', false, async function () {
        stopPolling(); await C.signOut(); showLogin('已退出登录');
      });
    };
  }

  /* ---------------- chat ---------------- */
  function renderChatHeader() {
    var c = state.activeConv; if (!c) return;
    var a = convAvatar(c);
    fillAvatar($('chatAvatar'), a.name, a.url);
    $('chatAvatar').classList.toggle('group', c.type === 'group');
    $('chatName').textContent = convTitle(c);
    if (c.type === 'group') {
      $('chatSub').textContent = (c.member_ids || []).length + ' 位成员 · 云端同步';
    } else {
      var other = (c.member_ids || []).filter(function (u) { return u !== state.uid; })[0];
      var p = other ? profileOf(other) : null;
      $('chatSub').textContent = p ? (STATUS_LABEL[p.status] || '在线') + ' · Tom号 ' + p.tom_id : '云端同步';
    }
  }

  async function openConversation(conv) {
    if (window.TomAnon) TomAnon.onHide();
    state.view = 'messages';
    document.querySelectorAll('.rail-btn').forEach(function (x) { x.classList.toggle('active', x.dataset.view === 'messages'); });
    state.activeConv = conv;
    state.unread[conv.conv_key] = 0;
    state.searchTerm = '';
    $('chatSearchBar').classList.add('hidden');
    $('chatSearchInput').value = '';
    $('chatEmpty').classList.add('hidden');
    $('chatPanel').classList.remove('hidden');
    renderChatHeader();
    renderSidebar();
    await loadMessages();
  }

  async function loadMessages() {
    if (!state.activeConv) return;
    var r = await C.getMessages(state.activeConv.conv_key, 0, 300);
    if (r.error) { setConn(false); toast('消息加载失败：' + (r.error.message || ''), 'error'); return; }
    setConn(true);
    state.messages = r.data || [];
    state.lastMsgId = state.messages.reduce(function (m, x) { return Math.max(m, Number(x.id) || 0); }, 0);
    state.seen[state.activeConv.conv_key] = state.lastMsgId;
    renderMessages();
  }

  async function pollMessages() {
    if (!state.activeConv || document.hidden) return;
    var key = state.activeConv.conv_key;
    var r = await C.getMessages(key, state.lastMsgId, 100);
    if (r.error) { setConn(false); return; }
    setConn(true);
    var fresh = (r.data || []).filter(function (m) { return Number(m.id) > state.lastMsgId; });
    if (!fresh.length) return;
    state.messages = state.messages.concat(fresh);
    state.lastMsgId = fresh.reduce(function (m, x) { return Math.max(m, Number(x.id) || 0); }, state.lastMsgId);
    state.seen[key] = state.lastMsgId;
    renderMessages();
    var incoming = fresh.filter(function (m) { return m.sender_id !== state.uid; });
    if (incoming.length) {
      beep();
      if (state.settings.notify) toast(displayName(incoming[0].sender_id) + '：' + previewOf(incoming[0]));
      refreshConversations();
    }
  }

  function highlight(text) {
    var t = esc(text);
    if (!state.searchTerm) return t;
    try {
      var re = new RegExp('(' + state.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      return t.replace(re, '<mark>$1</mark>');
    } catch (e) { return t; }
  }

  function renderMessages() {
    var box = $('messageList'); box.innerHTML = '';
    var list = state.messages;
    if (state.searchTerm) {
      var q = state.searchTerm.toLowerCase();
      list = list.filter(function (m) { return (m.content || '').toLowerCase().indexOf(q) >= 0; });
    }
    $('chatSearchCount').textContent = list.length + ' 条';
    if (!list.length) {
      box.innerHTML = '<div class="empty-list">' + (state.searchTerm ? '没有匹配的消息' : '还没有消息，打个招呼吧 👋') + '</div>';
      return;
    }
    var lastStamp = 0;
    list.forEach(function (m) {
      var d = new Date(m.created_at).getTime();
      if (d - lastStamp > 5 * 60 * 1000) {
        var div = document.createElement('div'); div.className = 'time-divider';
        div.innerHTML = '<span>' + esc(fmtListTime(m.created_at) + ' ' + fmtTime(m.created_at)) + '</span>';
        box.appendChild(div); lastStamp = d;
      }
      var self = m.sender_id === state.uid;
      var row = document.createElement('div'); row.className = 'msg-row' + (self ? ' self' : '');
      row.appendChild(avatarNode(displayName(m.sender_id), displayAvatar(m.sender_id), 'sm'));
      var col = document.createElement('div'); col.className = 'msg-col';
      var meta = document.createElement('div'); meta.className = 'msg-meta';
      meta.innerHTML = '<span>' + esc(m.sender_name || displayName(m.sender_id)) + '</span><span>' + esc(fmtTime(m.created_at)) + '</span>';
      col.appendChild(meta);
      var bubble = document.createElement('div');
      bubble.className = 'bubble';
      if (m.kind === 'image') {
        var img = document.createElement('img'); img.className = 'bubble-img'; img.alt = '图片';
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#efe7d5"/><text x="100" y="65" text-anchor="middle" fill="#9a917d" font-size="14">图片加载中…</text></svg>');
        if (m.file_path) {
          getSigned(m.file_path).then(function (url) {
            if (url) img.src = url; else img.alt = '图片已失效';
          });
          img.onclick = function () { if (img.src && img.src.indexOf('data:') !== 0) showImage(img.src); };
        }
        bubble.appendChild(img);
      } else if (m.kind === 'file') {
        bubble.classList.add('file-card');
        bubble.innerHTML = '<svg><use href="#i-folder"/></svg><div><div class="fname">' + esc(m.content || '文件') + '</div><div class="fsub">点击下载 · 云端文件</div></div>';
        bubble.style.cursor = 'pointer';
        bubble.onclick = async function () {
          if (!m.file_path) return;
          var url = await getSigned(m.file_path);
          if (url) window.open(url, '_blank'); else toast('文件链接已失效', 'error');
        };
      } else {
        bubble.innerHTML = highlight(m.content || '');
        if (/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\s]{1,8}$/u.test(m.content || '')) bubble.classList.add('emoji-only');
      }
      var fav = document.createElement('button');
      fav.className = 'fav-btn'; fav.title = '收藏'; fav.textContent = '☆';
      fav.onclick = function () {
        state.favorites.unshift({ from: m.sender_name || displayName(m.sender_id), text: previewOf(m), at: m.created_at });
        if (state.favorites.length > 100) state.favorites.pop();
        saveFavorites(); toast('已收藏到本机', 'ok');
      };
      col.appendChild(bubble);
      col.appendChild(fav);
      row.appendChild(col);
      box.appendChild(row);
    });
    box.scrollTop = box.scrollHeight;
  }

  function showImage(src) { $('viewerImg').src = src; $('imageViewer').classList.remove('hidden'); }

  async function sendMessage(kind, content, filePath) {
    if (!state.activeConv) { toast('请先选择一个会话'); return; }
    var r = await C.sendMessage({
      convKey: state.activeConv.conv_key, senderId: state.uid,
      senderName: state.me.nickname, senderAvatar: state.me.avatar_url,
      kind: kind, content: content, filePath: filePath
    });
    if (r.error) { toast('发送失败：' + (r.error.message || ''), 'error'); return false; }
    await C.touchConversation(state.activeConv.conv_key, previewOf({ kind: kind, content: content }), state.me.nickname);
    await loadMessages();
    refreshConversations();
    return true;
  }

  async function doSend() {
    var input = $('messageInput');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    var ok = await sendMessage('text', text, null);
    if (!ok) input.value = text;
  }

  async function handleFile(file, kind) {
    if (!file || !state.activeConv) return;
    if (file.size > 8 * 1024 * 1024) { toast('文件最大 8MB', 'error'); return; }
    if (kind === 'image' && !/^image\//.test(file.type)) { toast('请选择图片文件', 'error'); return; }
    $('uploadProgress').textContent = '正在上传 ' + file.name + ' …';
    $('sendBtn').disabled = true;
    var up = await C.uploadShared(file, state.uid, kind === 'image' ? 'images' : 'files');
    $('sendBtn').disabled = false;
    $('uploadProgress').textContent = '';
    if (up.error || !up.data) { toast('上传失败：' + ((up.error && up.error.message) || ''), 'error'); return; }
    var ok = await sendMessage(kind, kind === 'image' ? '[图片]' : file.name, up.data.path);
    if (!ok) toast('文件已上传，但消息发送失败', 'error');
  }

  /* ---------------- dialogs ---------------- */
  function addMenu() {
    openModal(modalHead('发起会话') +
      '<p class="modal-desc">用 Tom 号找到朋友，或者拉上好友建个群。</p>' +
      '<div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap">' +
      '<button class="btn-ok" data-act="friend">+ 添加好友</button>' +
      '<button class="btn-cancel" data-act="group">+ 创建群聊</button></div>',
      function (box) {
        box.querySelector('[data-act="friend"]').onclick = function () { closeModal(); addFriendDialog(); };
        box.querySelector('[data-act="group"]').onclick = function () { closeModal(); createGroupDialog(); };
      });
  }

  function addFriendDialog() {
    openModal(modalHead('添加好友') +
      '<p class="modal-desc">输入对方的 Tom 号（个人资料里可以看到），找到后即可发起单聊。</p>' +
      '<div class="modal-field"><label>Tom 号</label><input id="findTomId" placeholder="8 位数字" inputmode="numeric"></div>' +
      '<div id="findResult"></div>' +
      '<div class="modal-actions"><button class="btn-cancel" data-close>取消</button><button class="btn-ok" id="findBtn">查找</button></div>',
      function (box) {
        box.querySelector('#findBtn').onclick = async function () {
          var id = box.querySelector('#findTomId').value.trim();
          var out = box.querySelector('#findResult');
          out.innerHTML = '';
          if (!/^\d{6,10}$/.test(id)) { out.innerHTML = '<p class="form-error">请输入正确的 Tom 号</p>'; return; }
          var r = await C.findByTomId(id);
          if (r.error || !r.data) { out.innerHTML = '<p class="form-error">没有找到这个 Tom 号</p>'; return; }
          var p = r.data;
          out.innerHTML = '<div class="search-result"><div class="avatar sm" id="foundAvatar">' + esc(initial(p.nickname)) + '</div>' +
            '<div style="flex:1"><div style="font-weight:600">' + esc(p.nickname) + '</div><div style="font-size:12px;color:#98a2b3">' + esc(p.signature || '') + '</div></div>' +
            '<button class="btn-ok" id="addFoundBtn">添加</button></div>';
          fillAvatar(out.querySelector('#foundAvatar'), p.nickname, p.avatar_url);
          out.querySelector('#addFoundBtn').onclick = async function () {
            if (p.owner_id === state.uid) { toast('这是你自己呀 ~', 'error'); return; }
            var a = await C.addFriend(p);
            if (a.error && a.error.code !== '23505') { toast('添加失败：' + a.error.message, 'error'); return; }
            closeModal();
            await refreshAll();
            toast('已添加 ' + p.nickname, 'ok');
            await startSingleChat(p.owner_id, p.nickname);
          };
        };
      });
  }

  function createGroupDialog() {
    if (!state.friends.length) { toast('先添加几个好友吧 ~'); return; }
    var opts = state.friends.map(function (f) {
      var p = profileOf(f.friend_id);
      return '<label class="check-item"><input type="checkbox" value="' + esc(f.friend_id) + '">' +
        '<span>' + esc(p ? p.nickname : (f.friend_name || '好友')) + '</span></label>';
    }).join('');
    openModal(modalHead('创建群聊') +
      '<p class="modal-desc">选择成员，大家的消息会实时同步到云端。</p>' +
      '<div class="modal-field"><label>群名称</label><input id="groupName" placeholder="给群起个名字" maxlength="30"></div>' +
      '<div class="modal-field"><label>选择成员（至少 1 位）</label><div class="check-list">' + opts + '</div></div>' +
      '<div class="modal-actions"><button class="btn-cancel" data-close>取消</button><button class="btn-ok" id="groupOk">创建</button></div>',
      function (box) {
        box.querySelector('#groupOk').onclick = async function () {
          var name = box.querySelector('#groupName').value.trim() || 'Tom 群聊';
          var ids = Array.prototype.slice.call(box.querySelectorAll('input:checked')).map(function (i) { return i.value; });
          if (!ids.length) { toast('至少选一位成员', 'error'); return; }
          var key = 'g:' + rid();
          var r = await C.ensureConversation({
            convKey: key, type: 'group', name: name,
            memberIds: [state.uid].concat(ids)
          });
          if (r.error || !r.data) { toast('建群失败：' + ((r.error && r.error.message) || ''), 'error'); return; }
          closeModal(); await refreshAll();
          state.view = 'messages';
          document.querySelectorAll('.rail-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === 'messages'); });
          openConversation(r.data);
          toast('群聊创建成功', 'ok');
        };
      });
  }

  function startSingleChat(friendId, name) {
    var key = 's:' + [state.uid, friendId].sort().join('_');
    return C.ensureConversation({
      convKey: key, type: 'single', name: name || '',
      memberIds: [state.uid, friendId]
    }).then(async function (r) {
      if (r.error || !r.data) { toast('发起会话失败：' + ((r.error && r.error.message) || ''), 'error'); return; }
      await refreshAll();
      state.view = 'messages';
      document.querySelectorAll('.rail-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === 'messages'); });
      openConversation(r.data);
    });
  }

  function profileDialog() {
    var m = state.me;
    openModal(modalHead('我的资料') +
      '<div class="profile-hero"><div class="avatar" id="profileAvatar">' + esc(initial(m.nickname)) + '</div>' +
      '<div><h3>' + esc(m.nickname) + '</h3><p>Tom 号 ' + esc(m.tom_id) + ' · 点击头像更换</p></div></div>' +
      '<div class="modal-field"><label>昵称</label><input id="editNickname" maxlength="24" value="' + esc(m.nickname) + '"></div>' +
      '<div class="modal-field"><label>个性签名</label><textarea id="editSignature" rows="2" maxlength="80">' + esc(m.signature || '') + '</textarea></div>' +
      '<div class="modal-field"><label>在线状态</label><div class="status-options" id="statusOptions">' +
      Object.keys(STATUS_LABEL).map(function (k) {
        return '<button class="status-chip ' + (m.status === k ? 'active' : '') + '" data-status="' + k + '">' + STATUS_LABEL[k] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="profile-row"><span>加入时间</span><span>' + esc(new Date(m.created_at).toLocaleDateString('zh-CN')) + '</span></div>' +
      '<div class="profile-row"><span>数据存储</span><span>云端同步</span></div>' +
      '<div class="modal-actions"><button class="btn-cancel" id="profileLogout">退出登录</button><button class="btn-ok" id="profileSave">保存资料</button></div>',
      function (box) {
        fillAvatar(box.querySelector('#profileAvatar'), m.nickname, m.avatar_url);
        var picked = m.status || 'online';
        var avatarPath = m.avatar_url;
        box.querySelector('#profileAvatar').onclick = function () { $('avatarInput').click(); };
        $('avatarInput').onchange = async function () {
          var file = $('avatarInput').files[0]; $('avatarInput').value = '';
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) { toast('头像最大 5MB', 'error'); return; }
          toast('正在上传头像…');
          var up = await C.uploadShared(file, state.uid, 'avatars');
          if (up.error || !up.data) { toast('上传失败', 'error'); return; }
          avatarPath = up.data.path;
          await getSigned(avatarPath);
          fillAvatar(box.querySelector('#profileAvatar'), m.nickname, avatarPath);
          fillRailAvatar(m.nickname, avatarPath);
          toast('头像已更新，记得点保存', 'ok');
        };
        box.querySelectorAll('[data-status]').forEach(function (b) {
          b.onclick = function () {
            picked = b.dataset.status;
            box.querySelectorAll('[data-status]').forEach(function (x) { x.classList.remove('active'); });
            b.classList.add('active');
          };
        });
        box.querySelector('#profileSave').onclick = async function () {
          var nick = box.querySelector('#editNickname').value.trim();
          if (!nick) { toast('昵称不能为空', 'error'); return; }
          var r = await C.updateProfile(state.uid, {
            nickname: nick, signature: box.querySelector('#editSignature').value.trim(),
            status: picked, avatar_url: avatarPath
          });
          if (r.error || !r.data || !r.data.length) { toast('保存失败：' + ((r.error && r.error.message) || '权限不足'), 'error'); return; }
          state.me = Object.assign({}, state.me, { nickname: nick, signature: box.querySelector('#editSignature').value.trim(), status: picked, avatar_url: avatarPath });
          state.profiles[state.uid] = state.me;
          renderMe(); renderChatHeader(); closeModal(); toast('资料已保存', 'ok');
        };
        box.querySelector('#profileLogout').onclick = async function () {
          closeModal(); stopPolling(); await C.signOut(); showLogin('已退出登录');
        };
      });
  }

  function chatInfoDialog() {
    var c = state.activeConv; if (!c) return;
    var members = (c.member_ids || []).map(function (u) { return displayName(u); });
    openModal(modalHead('会话信息') +
      '<div class="profile-row"><span>会话名称</span><span>' + esc(convTitle(c)) + '</span></div>' +
      '<div class="profile-row"><span>类型</span><span>' + (c.type === 'group' ? '群聊' : '单聊') + '</span></div>' +
      '<div class="profile-row"><span>成员（' + members.length + '）</span><span>' + esc(members.join('、')) + '</span></div>' +
      '<div class="profile-row"><span>会话 ID</span><span style="font-size:11px;color:#98a2b3">' + esc(c.conv_key) + '</span></div>' +
      (c.type === 'group' ? '<div class="modal-field" style="margin-top:16px"><label>修改群名称</label><input id="renameGroup" value="' + esc(c.name || '') + '"></div>' : '') +
      '<div class="modal-actions"><button class="btn-cancel" data-close>关闭</button>' +
      (c.type === 'group' ? '<button class="btn-ok" id="renameOk">保存名称</button>' : '') + '</div>',
      function (box) {
        var btn = box.querySelector('#renameOk');
        if (btn) btn.onclick = async function () {
          var name = box.querySelector('#renameGroup').value.trim() || '群聊';
          var r = await C.renameConversation(c.conv_key, name);
          if (r.error) { toast('修改失败', 'error'); return; }
          c.name = name; closeModal(); renderChatHeader(); renderSidebar(); toast('已更新', 'ok');
        };
      });
  }

  function moreMenu() {
    openModal(modalHead('更多操作') +
      '<div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap">' +
      '<button class="btn-cancel" data-act="info">会话信息</button>' +
      '<button class="btn-cancel" data-act="search">搜索记录</button>' +
      '<button class="btn-danger" data-act="clear">清空记录</button></div>',
      function (box) {
        box.querySelector('[data-act="info"]').onclick = function () { closeModal(); chatInfoDialog(); };
        box.querySelector('[data-act="search"]').onclick = function () { closeModal(); toggleChatSearch(true); };
        box.querySelector('[data-act="clear"]').onclick = function () { closeModal(); clearChat(); };
      });
  }

  function clearChat() {
    if (!state.activeConv) return;
    confirmDialog('清空聊天记录',
      '将删除你在这个会话中发送的全部消息（云端数据，不可恢复），其他成员发送的消息仍会保留。',
      '确认清空', true, async function () {
        var r = await C.clearMyMessages(state.activeConv.conv_key, state.uid);
        if (r.error) { toast('清空失败：' + r.error.message, 'error'); return; }
        await loadMessages(); toast('已清空我发送的消息', 'ok');
      });
  }

  function toggleChatSearch(show) {
    $('chatSearchBar').classList.toggle('hidden', !show);
    if (show) $('chatSearchInput').focus();
    else { $('chatSearchInput').value = ''; state.searchTerm = ''; renderMessages(); }
  }

  /* ---------------- polling ---------------- */
  async function refreshConversations() {
    var r = await C.getConversations();
    if (r.error) { setConn(false); return; }
    setConn(true);
    var old = {};
    state.conversations.forEach(function (c) { old[c.conv_key] = c.last_at; });
    state.conversations = r.data || [];
    state.conversations.forEach(function (c) {
      if (old[c.conv_key] && old[c.conv_key] !== c.last_at && (!state.activeConv || c.conv_key !== state.activeConv.conv_key)) {
        state.unread[c.conv_key] = (state.unread[c.conv_key] || 0) + 1;
      }
    });
    if (state.view === 'messages') renderConversations();
    var total = Object.keys(state.unread).reduce(function (a, k) { return a + state.unread[k]; }, 0);
    $('railBadge').textContent = total > 99 ? '99+' : total;
    $('railBadge').classList.toggle('hidden', total === 0);
  }
  function startPolling() {
    stopPolling();
    state.timer = setInterval(pollMessages, 2500);
    state.convTimer = setInterval(refreshConversations, 6000);
  }
  function stopPolling() {
    clearInterval(state.timer); clearInterval(state.convTimer);
    if (window.TomAnon) TomAnon.onHide();
  }

  /* ---------------- events ---------------- */
  function bindUI() {
    document.querySelectorAll('.rail-btn').forEach(function (b) {
      b.onclick = function () {
        state.view = b.dataset.view;
        document.querySelectorAll('.rail-btn').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        $('sidebarSearch').value = '';
        if (state.view === 'anon') {
          $('chatEmpty').classList.add('hidden');
          $('chatPanel').classList.add('hidden');
          if (window.TomAnon) TomAnon.onShow();
        } else {
          if (window.TomAnon) TomAnon.onHide();
          $('chatEmpty').classList.toggle('hidden', !!state.activeConv);
          $('chatPanel').classList.toggle('hidden', !state.activeConv);
        }
        renderSidebar();
      };
    });
    $('railAvatar').onclick = profileDialog;
    $('sidebarSearch').oninput = renderSidebar;
    $('addBtn').onclick = addMenu;
    $('globalSearch').onkeydown = function (e) {
      if (e.key !== 'Enter') return;
      var q = e.target.value.trim().toLowerCase(); if (!q) return;
      var hit = state.conversations.filter(function (c) { return convTitle(c).toLowerCase().indexOf(q) >= 0; })[0];
      if (hit) { state.view = 'messages'; openConversation(hit); return; }
      var f = state.friends.filter(function (x) {
        var p = profileOf(x.friend_id);
        return p && (p.nickname.toLowerCase().indexOf(q) >= 0 || p.tom_id.indexOf(q) >= 0);
      })[0];
      if (f) { startSingleChat(f.friend_id, displayName(f.friend_id)); return; }
      toast('没有找到匹配的会话或好友');
    };
    $('sendBtn').onclick = doSend;
    $('messageInput').onkeydown = function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    };
    $('emojiBtn').onclick = function (e) {
      e.stopPropagation();
      var panel = $('emojiPanel');
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden') && !panel.innerHTML) {
        panel.innerHTML = '<h4>常用表情</h4><div class="emoji-grid">' +
          EMOJIS.map(function (x) { return '<button data-e="' + x + '">' + x + '</button>'; }).join('') + '</div>';
        panel.querySelectorAll('[data-e]').forEach(function (b) {
          b.onclick = function () {
            var input = $('messageInput');
            input.value += b.dataset.e; input.focus(); panel.classList.add('hidden');
          };
        });
      }
    };
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#emojiPanel') && !e.target.closest('#emojiBtn')) $('emojiPanel').classList.add('hidden');
    });
    $('imageBtn').onclick = function () { $('imageInput').click(); };
    $('fileBtn').onclick = function () { $('fileInput').click(); };
    $('imageInput').onchange = function () { var f = this.files[0]; this.value = ''; handleFile(f, 'image'); };
    $('fileInput').onchange = function () { var f = this.files[0]; this.value = ''; handleFile(f, 'file'); };
    $('clearBtn').onclick = clearChat;
    $('chatSearchBtn').onclick = function () { toggleChatSearch($('chatSearchBar').classList.contains('hidden')); };
    $('chatSearchClose').onclick = function () { toggleChatSearch(false); };
    $('chatSearchInput').oninput = function () { state.searchTerm = this.value.trim(); renderMessages(); };
    $('chatInfoBtn').onclick = chatInfoDialog;
    $('chatMoreBtn').onclick = moreMenu;
    $('viewerClose').onclick = function () { $('imageViewer').classList.add('hidden'); };
    $('imageViewer').onclick = function (e) { if (e.target === this) this.classList.add('hidden'); };
    $('modalBackdrop').addEventListener('click', function (e) {
      if (e.target === this || e.target.closest('[data-close]')) closeModal();
    });
    document.querySelectorAll('.win-btn').forEach(function (b) {
      b.onclick = function () { winAction(b.dataset.win); };
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); $('imageViewer').classList.add('hidden'); } });
  }

  bindLogin();
  bindUI();
  boot();
})();
