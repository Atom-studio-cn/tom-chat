/* Tom · Anonymous square — real cloud-backed anonymous chat.
   The client only ever selects public columns; no nickname, avatar, Tom id or owner_id. */
(function () {
  'use strict';
  var C = window.TomCloud;
  if (!C) return;

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  var rid = function () { return (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '' + Math.random()).replace(/-/g, '').slice(0, 16); };
  function fmt(iso) {
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function toast(text, type) {
    var t = $('toast'); t.textContent = text;
    t.className = 'toast' + (type ? ' ' + type : '');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.add('hidden'); }, 2600);
  }
  var EMOJIS = ['😀','😂','🥰','😎','🤔','😭','🥺','😴','👍','🙏','❤️','✨','🌙','☕','🍀','🐱','🐶','🎵','👀','🫧'];
  var ADJ = ['沉默的','路过的','不打招呼的','夜行的','慢半拍的','没睡醒的','爱发呆的','借宿的','躲在角落的','忘了名字的','第七只','晚到的'];
  var NOUN = ['夜航船','猫','风','邮差','旧唱片','雨伞','月亮','书页','路灯','纸鹤','窗台','信箱'];
  var MARKS = ['✦','☾','❖','✳','◈','✧','☁','❀','◐','✺'];
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  var st = { uid: '', identity: null, messages: [], lastId: 0, replyTo: null, timer: null, mounted: false, active: false };

  function newIdentity() { return { anonId: rid() + rid(), name: pick(ADJ) + pick(NOUN), mark: pick(MARKS) }; }
  function identityKey() { return 'tom_anon_identity_' + st.uid; }
  function loadIdentity() {
    try {
      var s = JSON.parse(localStorage.getItem(identityKey()));
      if (s && s.anonId && s.name) return s;
    } catch (e) { }
    var n = newIdentity(); saveIdentity(n); return n;
  }
  function saveIdentity(i) { localStorage.setItem(identityKey(), JSON.stringify(i)); }
  function shuffle() {
    st.identity = newIdentity(); saveIdentity(st.identity);
    renderIdentity(); render(); toast('换好啦，现在是 ' + st.identity.name, 'ok');
  }
  function renderIdentity() {
    if (!$('anonMyMark')) return;
    $('anonMyMark').textContent = st.identity.mark;
    $('anonMyName').textContent = st.identity.name;
  }

  function buildDOM() {
    var pane = document.querySelector('.chat-pane');
    var panel = document.createElement('section');
    panel.id = 'anonPanel'; panel.className = 'anon-panel hidden';
    panel.innerHTML =
      '<div class="anon-header">' +
        '<div><h2>匿名广场</h2><p>这里没有人知道你是谁 · 仅文字与表情，不传图片</p></div>' +
        '<div class="anon-id-card"><div id="anonMyMark" class="anon-avatar">✦</div>' +
        '<div><div id="anonMyName" class="anon-id-name">…</div><div class="anon-id-sub">我的匿名身份</div></div>' +
        '<button id="anonShuffleBtn" class="anon-shuffle">换一个</button></div>' +
      '</div>' +
      '<div id="anonMessageList" class="anon-list"></div>' +
      '<div id="anonReplyBar" class="anon-reply-bar hidden"><span id="anonReplyText"></span><button id="anonReplyCancel">取消回复</button></div>' +
      '<div class="anon-composer">' +
        '<button id="anonEmojiBtn" class="tool-btn" title="表情"><svg><use href="#i-emoji"/></svg></button>' +
        '<input id="anonInput" placeholder="说点什么吧，没人知道是你…" maxlength="500" autocomplete="off">' +
        '<button id="anonSendBtn" class="send-btn">发送 <svg><use href="#i-send"/></svg></button>' +
      '</div>' +
      '<div id="anonEmojiPanel" class="emoji-panel anon-emoji hidden"></div>';
    pane.appendChild(panel);

    var side = document.querySelector('.sidebar');
    var sp = document.createElement('div');
    sp.id = 'anonSidePanel'; sp.className = 'scroll-list anon-side hidden';
    sp.innerHTML =
      '<div class="anon-side-card"><h4>关于匿名广场</h4>' +
        '<p>身份随机生成，不显示昵称、头像和 Tom 号。<br>消息保存在云端，所有登录用户都能看到。</p>' +
        '<p>为避免图片信息暴露身份，这里只发文字和表情。</p></div>' +
      '<div class="anon-side-card"><h4>此刻</h4>' +
        '<div class="anon-side-stat"><span>近期活跃身份</span><b id="anonActiveCount">—</b></div>' +
        '<div class="anon-side-stat"><span>广场消息</span><b id="anonTotalCount">—</b></div>' +
        '<button id="anonSideShuffle" class="anon-side-btn ghost">换一个身份</button>' +
        '<button id="anonSideRefresh" class="anon-side-btn">刷新消息</button></div>';
    side.insertBefore(sp, side.querySelector('.sidebar-foot'));
  }

  function findReply(id) {
    for (var i = 0; i < st.messages.length; i++) if (String(st.messages[i].id) === String(id)) return st.messages[i];
    return null;
  }
  function updateStats() {
    if (!$('anonActiveCount')) return;
    var cutoff = Date.now() - 10 * 60 * 1000, seen = {};
    st.messages.forEach(function (m) {
      if (new Date(m.created_at).getTime() >= cutoff) seen[m.anon_id] = 1;
    });
    $('anonActiveCount').textContent = Object.keys(seen).length + ' 位';
    $('anonTotalCount').textContent = st.messages.length + ' 条';
  }
  function render() {
    var box = $('anonMessageList'); if (!box) return;
    if (!st.messages.length) {
      box.innerHTML = '<div class="anon-empty">广场还很安静 ☾<br>来说第一句吧，没人知道是你</div>';
      updateStats(); return;
    }
    box.innerHTML = st.messages.map(function (m) {
      var mine = m.anon_id === st.identity.anonId;
      var q = m.reply_to ? findReply(m.reply_to) : null;
      return '<div class="anon-msg' + (mine ? ' mine' : '') + '" data-id="' + esc(m.id) + '">' +
        '<div class="anon-avatar">' + esc(m.anon_mark || '✦') + '</div>' +
        '<div class="anon-msg-main">' +
          '<div class="anon-msg-top"><span class="anon-msg-name">' + esc(m.anon_name) + '</span>' +
          '<span class="anon-msg-time">' + esc(fmt(m.created_at)) + '</span></div>' +
          (q ? '<div class="anon-reply-quote">↳ ' + esc(q.anon_name) + '：' + esc(String(q.content).slice(0, 40)) + '</div>' : '') +
          '<div class="anon-bubble">' + esc(m.content) + '</div>' +
          '<div class="anon-msg-actions"><button data-act="reply">回复</button>' +
          (mine ? '<button data-act="delete">删除</button>' : '') + '</div>' +
        '</div></div>';
    }).join('');
    box.scrollTop = box.scrollHeight;
    updateStats();
  }
  function renderReplyBar() {
    var bar = $('anonReplyBar');
    if (!st.replyTo) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    $('anonReplyText').textContent = '回复 ' + st.replyTo.name + '：' + String(st.replyTo.content).slice(0, 40);
  }

  async function load() {
    var r = await C.getAnonMessages(0, 200);
    if (r.error) { toast('加载失败：' + (r.error.message || ''), 'error'); return; }
    st.messages = r.data || [];
    st.lastId = st.messages.reduce(function (a, x) { return Math.max(a, Number(x.id) || 0); }, 0);
    render();
  }
  async function poll() {
    if (!st.active || document.hidden) return;
    var r = await C.getAnonMessages(st.lastId, 100);
    if (r.error) return;
    var fresh = (r.data || []).filter(function (x) { return Number(x.id) > st.lastId; });
    if (!fresh.length) return;
    st.messages = st.messages.concat(fresh).slice(-300);
    st.lastId = fresh.reduce(function (a, x) { return Math.max(a, Number(x.id) || 0); }, st.lastId);
    render();
  }
  async function send() {
    var input = $('anonInput'), text = input.value.trim();
    if (!text) return;
    input.value = '';
    var r = await C.sendAnonMessage({
      anonId: st.identity.anonId, anonName: st.identity.name, anonMark: st.identity.mark,
      kind: 'text', content: text, replyTo: st.replyTo ? st.replyTo.id : null
    });
    if (r.error) { input.value = text; toast('发送失败：' + (r.error.message || ''), 'error'); return; }
    st.replyTo = null; renderReplyBar();
    await load();
  }
  async function remove(id) {
    var r = await C.deleteAnonMessage(id, st.identity.anonId);
    if (r.error) { toast('删除失败：' + (r.error.message || ''), 'error'); return; }
    await load(); toast('已删除', 'ok');
  }

  function bind() {
    $('anonShuffleBtn').onclick = shuffle;
    $('anonSideShuffle').onclick = shuffle;
    $('anonSideRefresh').onclick = function () { load(); toast('已刷新', 'ok'); };
    $('anonSendBtn').onclick = send;
    $('anonInput').onkeydown = function (e) { if (e.key === 'Enter') send(); };
    $('anonReplyCancel').onclick = function () { st.replyTo = null; renderReplyBar(); };
    $('anonMessageList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]'); if (!btn) return;
      var row = btn.closest('.anon-msg'); if (!row) return;
      var m = findReply(row.dataset.id); if (!m) return;
      if (btn.dataset.act === 'reply') {
        st.replyTo = { id: m.id, name: m.anon_name, content: m.content };
        renderReplyBar(); $('anonInput').focus();
      } else if (btn.dataset.act === 'delete') {
        remove(m.id);
      }
    });
    $('anonEmojiBtn').onclick = function (e) {
      e.stopPropagation();
      var p = $('anonEmojiPanel'); p.classList.toggle('hidden');
      if (!p.classList.contains('hidden') && !p.innerHTML) {
        p.innerHTML = '<h4>常用表情</h4><div class="emoji-grid">' +
          EMOJIS.map(function (x) { return '<button data-e="' + x + '">' + x + '</button>'; }).join('') + '</div>';
        p.querySelectorAll('[data-e]').forEach(function (b) {
          b.onclick = function () { $('anonInput').value += b.dataset.e; $('anonInput').focus(); p.classList.add('hidden'); };
        });
      }
    };
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#anonEmojiPanel') && !e.target.closest('#anonEmojiBtn')) {
        var p = $('anonEmojiPanel'); if (p) p.classList.add('hidden');
      }
    });
  }

  window.TomAnon = {
    mount: function (uid) {
      if (!st.mounted) {
        st.uid = uid; st.identity = loadIdentity();
        buildDOM(); bind(); renderIdentity(); st.mounted = true;
        load();
      } else if (st.uid !== uid) {
        st.uid = uid; st.identity = loadIdentity(); st.messages = []; st.lastId = 0;
        renderIdentity(); load();
      }
    },
    onShow: function () {
      if (!st.mounted) return;
      st.active = true;
      $('anonPanel').classList.remove('hidden');
      $('anonSidePanel').classList.remove('hidden');
      load();
      clearInterval(st.timer); st.timer = setInterval(poll, 3000);
    },
    onHide: function () {
      st.active = false;
      clearInterval(st.timer); st.timer = null;
      var p = $('anonPanel'), s = $('anonSidePanel');
      if (p) p.classList.add('hidden');
      if (s) s.classList.add('hidden');
    }
  };
})();
