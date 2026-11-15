/* Tom · cloud data layer. One SDK client, shared by Auth / Database / Storage. */
(function () {
  'use strict';

  var cfg = window.TOM_PUBLIC_CONFIG;
  if (!cfg || !cfg.endpoint || /^REPLACE_WITH_/.test(cfg.endpoint) ||
      !cfg.publishableKey || /^REPLACE_WITH_/.test(cfg.publishableKey)) {
    window.TOM_BOOT_ERROR = '请先在 web/config.js 填入你自己的云端配置（见 README.md）';
    return;
  }
  if (!window.WorkBuddyCloud || typeof window.WorkBuddyCloud.createWorkBuddyCloud !== 'function') {
    window.TOM_BOOT_ERROR = '云端 SDK 加载失败，请检查网络连接后刷新重试';
    return;
  }

  var cloud = WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: cfg.endpoint,
    oauthRelayBaseUrl: cfg.oauthRelayBaseUrl,
    publishableKey: cfg.publishableKey
  });
  window.tomClient = cloud;

  function errOf(r) { return r && r.error ? r.error : null; }
  function uidOf(u) { return (u && (u.id || u.uid || u.userId || u.sub)) || ''; }
  function nameOf(u) { return (u && (u.name || u.nickname)) || ''; }
  function ext(f) { var m = /\.([a-zA-Z0-9]+)$/.exec(f.name || ''); return m ? m[1].toLowerCase() : 'bin'; }
  function rid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 20); }

  var TomCloud = {
    cloud: cloud,
    uidOf: uidOf,
    nameOf: nameOf,

    /* ---------- Auth ---------- */
    getSession: function () {
      return cloud.auth.getSession().then(function (r) {
        return { data: r && r.data ? r.data : null, error: errOf(r) };
      });
    },
    sendOtp: function (mode, account) {
      var payload = mode === 'phone' ? { phone: account } : { email: account };
      return cloud.auth.sendOtp(payload).then(function (r) {
        return { data: r && r.data ? r.data : null, error: errOf(r) };
      });
    },
    verifyOtp: function (mode, pending, token) {
      var body = {
        verificationId: pending.verificationId,
        isExistingUser: pending.isExistingUser,
        token: token
      };
      if (mode === 'phone') body.phone = pending.account; else body.email = pending.account;
      return cloud.auth.verifyOtp(body).then(function (r) {
        return { data: r && r.data ? r.data : null, error: errOf(r) };
      });
    },
    startWorkBuddyLogin: function () {
      var back = new URL(location.href);
      back.pathname = '/';
      ['code', 'state', 'provider'].forEach(function (k) { back.searchParams.delete(k); });
      return cloud.auth.signInWithOAuth({ provider: 'workbuddy', redirectTo: back.toString() })
        .then(function (r) { return { data: r && r.data ? r.data : null, error: errOf(r) }; });
    },
    handleWorkBuddyCallback: function () {
      if (typeof cloud.auth.handleWorkBuddyCallback !== 'function') {
        return Promise.resolve({ data: null, error: { message: '当前 SDK 不支持该登录方式' } });
      }
      return cloud.auth.handleWorkBuddyCallback().then(function (r) {
        return { data: r && r.data ? r.data : null, error: errOf(r) };
      });
    },
    onAuthStateChange: function (cb) { return cloud.auth.onAuthStateChange(cb); },
    signOut: function () { return cloud.auth.signOut(); },

    /* ---------- Profiles ---------- */
    ensureProfile: function (session) {
      var user = session.user || {};
      var uid = uidOf(user);
      return cloud.database.from('tom_profiles').select('*').eq('owner_id', uid).maybeSingle()
        .then(function (found) {
          if (errOf(found) && found.error.code !== 'PGRST116') return { data: null, error: errOf(found) };
          if (found.data) return { data: found.data, error: null };
          var attempt = 0;
          function create() {
            attempt++;
            var tomId = String(10000000 + Math.floor(Math.random() * 89999999));
            return cloud.database.from('tom_profiles').insert({
              nickname: nameOf(user) || ('Tom 用户' + tomId.slice(-4)),
              tom_id: tomId,
              avatar_url: user.avatarUrl || null,
              signature: '今天也要开开心心~',
              status: 'online'
            }).select().then(function (ins) {
              if (!errOf(ins) && ins.data && ins.data[0]) return { data: ins.data[0], error: null };
              if (errOf(ins) && errOf(ins).code === '23505' && attempt < 5) return create();
              return { data: null, error: errOf(ins) || { message: '创建资料失败，请重试' } };
            });
          }
          return create();
        });
    },
    getProfiles: function () {
      return cloud.database.from('tom_profiles').select('*').limit(500);
    },
    findByTomId: function (tomId) {
      return cloud.database.from('tom_profiles').select('*').eq('tom_id', tomId).maybeSingle();
    },
    updateProfile: function (uid, patch) {
      return cloud.database.from('tom_profiles').update(patch).eq('owner_id', uid).select();
    },

    /* ---------- Friends ---------- */
    getFriends: function () {
      return cloud.database.from('tom_friendships').select('*').order('created_at', { ascending: true });
    },
    addFriend: function (profile, groupName) {
      return cloud.database.from('tom_friendships').insert({
        friend_id: profile.owner_id,
        friend_name: profile.nickname,
        friend_avatar: profile.avatar_url || null,
        group_name: groupName || '我的好友'
      }).select();
    },
    removeFriend: function (friendId) {
      return cloud.database.from('tom_friendships').delete().eq('friend_id', friendId).select();
    },

    /* ---------- Conversations ---------- */
    getConversations: function () {
      return cloud.database.from('tom_conversations').select('*')
        .order('last_at', { ascending: false }).limit(100);
    },
    ensureConversation: function (args) {
      var table = function () { return cloud.database.from('tom_conversations'); };
      return table().select('*').eq('conv_key', args.convKey).maybeSingle().then(function (found) {
        if (found.data) return { data: found.data, error: null };
        return table().insert({
          conv_key: args.convKey,
          type: args.type,
          name: args.name || null,
          avatar_url: args.avatarUrl || null,
          member_ids: args.memberIds
        }).select().then(function (ins) {
          if (errOf(ins) && errOf(ins).code === '23505') {
            return table().select('*').eq('conv_key', args.convKey).maybeSingle();
          }
          return { data: ins.data && ins.data[0], error: errOf(ins) };
        });
      });
    },
    touchConversation: function (convKey, preview, senderName) {
      return cloud.database.from('tom_conversations').update({
        last_message: preview,
        last_sender: senderName || '',
        last_at: new Date().toISOString()
      }).eq('conv_key', convKey).select();
    },
    renameConversation: function (convKey, name) {
      return cloud.database.from('tom_conversations').update({ name: name }).eq('conv_key', convKey).select();
    },

    /* ---------- Messages ---------- */
    getMessages: function (convKey, sinceId, limit) {
      var q = cloud.database.from('tom_messages').select('*').eq('conv_key', convKey);
      if (sinceId) q = q.gt('id', sinceId);
      return q.order('created_at', { ascending: true }).order('id', { ascending: true }).limit(limit || 300);
    },
    sendMessage: function (args) {
      return cloud.database.from('tom_messages').insert({
        conv_key: args.convKey,
        sender_id: args.senderId,
        sender_name: args.senderName || '',
        sender_avatar: args.senderAvatar || null,
        kind: args.kind || 'text',
        content: args.content || '',
        file_path: args.filePath || null
      }).select();
    },
    clearMyMessages: function (convKey, uid) {
      return cloud.database.from('tom_messages').delete()
        .eq('conv_key', convKey).eq('owner_id', uid).select();
    },

    /* ---------- Anonymous square ----------
       Public columns only: owner_id is never selected by the client. */
    getAnonMessages: function (sinceId, limit) {
      var q = cloud.database.from('tom_anon_public')
        .select('id,anon_id,anon_name,anon_mark,kind,content,reply_to,created_at')
        .order('created_at', { ascending: true }).order('id', { ascending: true });
      if (sinceId) q = q.gt('id', sinceId);
      return q.limit(limit || 200);
    },
    sendAnonMessage: function (args) {
      var payload = {
        anon_id: args.anonId,
        anon_name: args.anonName,
        anon_mark: args.anonMark,
        kind: args.kind || 'text',
        content: args.content
      };
      if (args.replyTo) payload.reply_to = args.replyTo;
      return cloud.database.from('tom_anon_messages').insert(payload);
    },
    deleteAnonMessage: function (id, anonId) {
      return cloud.database.from('tom_anon_messages').delete().eq('id', id).eq('anon_id', anonId);
    },

    /* ---------- Storage ---------- */
    uploadShared: function (file, uid, folder) {
      var path = cloud.storage.sharedPath(uid, folder + '/' + rid() + '.' + ext(file));
      return cloud.storage.upload(path, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false
      }).then(function (r) {
        if (errOf(r)) return { data: null, error: errOf(r) };
        return { data: { path: path }, error: null };
      });
    },
    signUrl: function (path, ttl) {
      return cloud.storage.createSignedUrl(path, ttl || 3600).then(function (r) {
        if (errOf(r)) return { data: null, error: errOf(r) };
        var d = r && r.data;
        var url = typeof d === 'string' ? d
          : (d && (d.signedUrl || d.url || d.signed_url || d.downloadUrl)) || '';
        return { data: url, error: url ? null : { message: '图片链接获取失败' } };
      });
    }
  };

  window.TomCloud = TomCloud;
})();
