import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const THEME_STORAGE_KEY = 'chat-theme-mode';
const SOUND_STORAGE_KEY = 'chat-sound-enabled';
const NOTIFICATION_STORAGE_KEY = 'chat-notification-enabled';

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${localStorage.getItem('token')}`
  };
}

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

function readThemeMode() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

function readBooleanSetting(key, fallback = true) {
  const stored = localStorage.getItem(key);
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return fallback;
}

function resolveTheme(mode) {
  if (mode === 'light' || mode === 'dark') {
    return mode;
  }

  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  return 'light';
}

function normalizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username || '',
    nickname: user.nickname || '',
    avatarUrl: user.avatarUrl || '',
    phone: user.phone || '',
    created_at: user.created_at || ''
  };
}

function displayName(user) {
  if (!user) {
    return '';
  }

  return (user.nickname || '').trim() || user.username || '';
}

function avatarLetter(user) {
  const text = displayName(user);
  return text ? text[0].toUpperCase() : '?';
}

function formatTime(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatMessageTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  if (isToday) {
    return time;
  } else if (isYesterday) {
    return `昨天 ${time}`;
  } else {
    return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
  }
}

function formatDayDivider(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return '今天';
  if (isYesterday) return '昨天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function shouldShowDayDivider(prev, current) {
  if (!current?.created_at) return false;
  if (!prev?.created_at) return true;
  return new Date(prev.created_at).toDateString() !== new Date(current.created_at).toDateString();
}

function Avatar({ user, className = 'avatar' }) {
  if (user?.avatarUrl) {
    return <img className={`${className} image-avatar`} src={user.avatarUrl} alt={displayName(user)} />;
  }

  return <div className={className}>{avatarLetter(user)}</div>;
}

function GroupAvatar({ name, className = 'avatar' }) {
  const letter = String(name || '群').trim()[0] || '群';
  return <div className={`${className} group-avatar`}>{letter}</div>;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(normalizeUser(readStoredUser()));
  const [view, setView] = useState(localStorage.getItem('token') ? 'main' : 'login');
  const [socket, setSocket] = useState(null);
  const [themeMode, setThemeMode] = useState(readThemeMode());
  const [soundEnabled, setSoundEnabled] = useState(readBooleanSetting(SOUND_STORAGE_KEY, true));
  const [notificationsEnabled, setNotificationsEnabled] = useState(readBooleanSetting(NOTIFICATION_STORAGE_KEY, true));

  useEffect(() => {
    if (!token) {
      setView('login');
      return undefined;
    }

    const nextSocket = io({
      auth: { token }
    });

    setSocket(nextSocket);
    setView('main');

    return () => {
      nextSocket.disconnect();
    };
  }, [token]);

  useEffect(() => {
    const applyTheme = () => {
      document.documentElement.dataset.theme = resolveTheme(themeMode);
    };

    applyTheme();
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);

    if (!window.matchMedia || themeMode !== 'system') {
      return undefined;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyTheme();
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem(SOUND_STORAGE_KEY, String(soundEnabled));
  }, [soundEnabled]);

  useEffect(() => {
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, String(notificationsEnabled));
  }, [notificationsEnabled]);

  const persistUser = (nextUser) => {
    const normalized = normalizeUser(nextUser);
    if (normalized) {
      localStorage.setItem('user', JSON.stringify(normalized));
    } else {
      localStorage.removeItem('user');
    }
    setUser(normalized);
  };

  const handleLogin = (nextToken, nextUser) => {
    localStorage.setItem('token', nextToken);
    setToken(nextToken);
    persistUser(nextUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    socket?.disconnect();
    setSocket(null);
    setView('login');
  };

  if (view === 'login') {
    return <LoginView onLogin={handleLogin} />;
  }

  return (
    <MainView
      user={user}
      socket={socket}
      onLogout={handleLogout}
      onUserChange={persistUser}
      themeMode={themeMode}
      onThemeModeChange={setThemeMode}
      soundEnabled={soundEnabled}
      onSoundEnabledChange={setSoundEnabled}
      notificationsEnabled={notificationsEnabled}
      onNotificationsEnabledChange={setNotificationsEnabled}
    />
  );
}

function LoginView({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const response = await fetch(apiUrl(`/api/auth/${isRegister ? 'register' : 'login'}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '请求失败');
      }

      const nextUser = data.user || {
        id: data.userId,
        username: data.username,
        nickname: '',
        avatarUrl: '',
        phone: ''
      };

      onLogin(data.token, nextUser);
    } catch (error) {
      setError(error.message || '请求失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-panel">
        <div className="login-copy">
          <span className="badge">团队即时沟通</span>
          <h1>虾聊</h1>
          <p>
            一个更接近桌面聊天客户端的轻量协作应用，先把注册、联系人管理和实时消息打磨顺手，
            后面再继续扩展群聊、图片和移动端。
          </p>
          <div className="feature-list">
            <div>
              <strong>实时消息</strong>
              <span>基于 Socket.IO，即发即达。</span>
            </div>
            <div>
              <strong>联系人会话</strong>
              <span>搜索、添加、进入会话一步完成。</span>
            </div>
            <div>
              <strong>小凯哥</strong>
              <span>email: xiaokaige1130@gmail.com · wechat: xking5898</span>
            </div>
          </div>
        </div>

        <div className="login-card">
          <div className="login-header">
            <h2>{isRegister ? '创建账号' : '账号登录'}</h2>
            <p>
              {isRegister
                ? '先注册一个账号，再进入你的聊天工作台。'
                : '输入账号后即可进入会话列表。'}
            </p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>用户名</span>
              <input
                type="text"
                placeholder="例如：xiaokaige"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={submitting}
              />
            </label>

            <label className="field">
              <span>密码</span>
              <input
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
              />
            </label>

            {error ? <div className="form-error">{error}</div> : null}

            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? '提交中...' : isRegister ? '立即注册' : '进入虾聊'}
            </button>
          </form>

          <button
            type="button"
            className="text-button"
            onClick={() => setIsRegister((value) => !value)}
            disabled={submitting}
          >
            {isRegister ? '已有账号，去登录' : '还没有账号，先注册'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MainView({
  user,
  socket,
  onLogout,
  onUserChange,
  themeMode,
  onThemeModeChange,
  soundEnabled,
  onSoundEnabledChange,
  notificationsEnabled,
  onNotificationsEnabledChange
}) {
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [conversationFilter, setConversationFilter] = useState('');
  const [tabFilter, setTabFilter] = useState('all');
  const [messageSearch, setMessageSearch] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searching, setSearching] = useState(false);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [groupCreatorOpen, setGroupCreatorOpen] = useState(false);
  const [groupSubmitting, setGroupSubmitting] = useState(false);
  const [groupFeedback, setGroupFeedback] = useState('');
  const [groupForm, setGroupForm] = useState({
    name: '',
    memberIds: []
  });
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantSaving, setAssistantSaving] = useState(false);
  const [assistantRunning, setAssistantRunning] = useState(false);
  const [assistantFeedback, setAssistantFeedback] = useState('');
  const [assistantQuery, setAssistantQuery] = useState('');
  const [assistantReply, setAssistantReply] = useState('');
  const [assistantForm, setAssistantForm] = useState({
    displayName: '我的群助理',
    systemPrompt: '',
    responseVisibility: 'private'
  });
  const [profileForm, setProfileForm] = useState({
    nickname: user?.nickname || '',
    avatarUrl: user?.avatarUrl || '',
    phone: user?.phone || ''
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    nextPassword: '',
    confirmPassword: ''
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState('');
  const [notice, setNotice] = useState('');
  const [isWindowFocused, setIsWindowFocused] = useState(typeof document !== 'undefined' ? document.visibilityState === 'visible' : true);
  const messageListRef = useRef(null);
  const messageEndRef = useRef(null);
  const shouldScrollToBottomRef = useRef(false);
  const audioContextRef = useRef(null);

  useEffect(() => {
    setProfileForm({
      nickname: user?.nickname || '',
      avatarUrl: user?.avatarUrl || '',
      phone: user?.phone || ''
    });
  }, [user]);

  useEffect(() => {
    hydrateCurrentUser();
    fetchContacts();
    fetchGroups();
    fetchOnlineUsers();
  }, []);

  useEffect(() => {
    if (!selectedConversation) {
      return;
    }

    if (selectedConversation.type === 'direct') {
      const nextSelected = contacts.find((entry) => entry.id === selectedConversation.id);
      if (nextSelected) {
        setSelectedConversation({ ...nextSelected, type: 'direct' });
      }
      return;
    }

    const nextGroup = groups.find((entry) => entry.id === selectedConversation.id);
    if (nextGroup) {
      setSelectedConversation({ ...nextGroup, type: 'group' });
    }
  }, [contacts, groups, selectedConversation]);

  useEffect(() => {
    if (!socket) {
      return undefined;
    }

    const handleIncomingMessage = (message) => {
      fetchContacts();

      if (
        selectedConversation?.type === 'direct' &&
        (message.sender_id === selectedConversation.id || message.receiver_id === selectedConversation.id)
      ) {
        setMessages((current) => [...current, message]);
      } else if (message.sender_id !== user.id) {
        setNotice('收到一条新消息。');
        maybeNotify(displayName(message.sender) || '新消息', String(message.content || '').slice(0, 88));
      }
    };

    const handleIncomingGroupMessage = (message) => {
      fetchGroups();

      if (selectedConversation?.type === 'group' && message.group_id === selectedConversation.id) {
        setMessages((current) => [...current, message]);
      } else if (message.sender_id !== user.id) {
        setNotice('群里有一条新消息。');
        maybeNotify(message.group?.name || '群聊新消息', String(message.content || '').slice(0, 88));
      }
    };

    const handleUserStatus = (payload) => {
      if (payload.online) {
        setOnlineUsers((prev) => new Set(prev).add(payload.userId));
      } else {
        setOnlineUsers((prev) => {
          const next = new Set(prev);
          next.delete(payload.userId);
          return next;
        });
      }
    };

    const handleContactAdded = (contact) => {
      fetchContacts();
      setNotice(`${contact.username} 已将你添加为联系人。`);
    };

    const handleGroupCreated = () => {
      fetchGroups();
      setNotice('你已加入一个新的群聊。');
    };

    socket.on('message', handleIncomingMessage);
    socket.on('group-message', handleIncomingGroupMessage);
    socket.on('user-status', handleUserStatus);
    socket.on('contact_added', handleContactAdded);
    socket.on('group_created', handleGroupCreated);

    return () => {
      socket.off('message', handleIncomingMessage);
      socket.off('group-message', handleIncomingGroupMessage);
      socket.off('user-status', handleUserStatus);
      socket.off('contact_added', handleContactAdded);
      socket.off('group_created', handleGroupCreated);
    };
  }, [socket, selectedConversation, user.id, soundEnabled, notificationsEnabled, isWindowFocused]);

  useEffect(() => {
    if (!messageListRef.current) {
      return;
    }

    if (shouldScrollToBottomRef.current) {
      messageEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
      shouldScrollToBottomRef.current = false;
      return;
    }

    const viewport = messageListRef.current;
    const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 140;
    if (nearBottom || messages.length <= 1) {
      messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages]);

  useEffect(() => {
    if (!assistantOpen || selectedConversation?.type !== 'group') {
      return;
    }

    fetchAssistantSettings(selectedConversation.id);
  }, [assistantOpen, selectedConversation]);

  useEffect(() => {
    const handleVisibility = () => {
      setIsWindowFocused(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    window.addEventListener('blur', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      window.removeEventListener('blur', handleVisibility);
    };
  }, []);

  const filteredMessages = useMemo(() => {
    const query = messageSearch.trim().toLowerCase();
    if (!query) {
      return messages;
    }

    return messages.filter((message) =>
      String(message.content || '').toLowerCase().includes(query)
    );
  }, [messages, messageSearch]);

  const conversations = useMemo(() => {
    const directItems = contacts.map((contact) => ({
      ...contact,
      type: 'direct',
      title: displayName(contact),
      subline: `@${contact.username}${contact.phone ? ` · ${contact.phone}` : ''}`,
      summary: contact.lastMessage || (onlineUsers.has(contact.id) ? '在线' : contact.lastSeen ? `上次在线 ${formatMessageTime(contact.lastSeen)}` : '离线'),
      sortableAt: contact.lastMessageAt || contact.created_at || '',
      unreadCount: contact.unreadCount || 0
    }));

    const groupItems = groups.map((group) => ({
      ...group,
      type: 'group',
      title: group.name,
      subline: `${group.memberCount} 位成员 · 群聊`,
      summary: group.lastMessage || '群里还没有消息',
      sortableAt: group.lastMessageAt || group.created_at || '',
      unreadCount: 0
    }));

    return [...directItems, ...groupItems].sort((left, right) => {
      return String(right.sortableAt || '').localeCompare(String(left.sortableAt || ''));
    });
  }, [contacts, groups, onlineUsers]);

  const filteredConversations = useMemo(() => {
    const query = conversationFilter.trim().toLowerCase();
    let nextItems = conversations;

    if (tabFilter === 'online') {
      nextItems = nextItems.filter((item) => item.type === 'direct' && onlineUsers.has(item.id));
    } else if (tabFilter === 'unread') {
      nextItems = nextItems.filter((item) => item.type === 'direct' && item.unreadCount > 0);
    } else if (tabFilter === 'direct') {
      nextItems = nextItems.filter((item) => item.type === 'direct');
    } else if (tabFilter === 'groups') {
      nextItems = nextItems.filter((item) => item.type === 'group');
    }

    if (!query) {
      return nextItems;
    }

    return nextItems.filter((item) => {
      const haystack = [item.title, item.subline, item.summary]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [conversations, conversationFilter, tabFilter, onlineUsers]);

  const selectedIsGroup = selectedConversation?.type === 'group';
  const selectedDisplayName = selectedIsGroup ? selectedConversation?.name || '' : displayName(selectedConversation);

  function playNotificationTone() {
    if (!soundEnabled || typeof window === 'undefined') {
      return;
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    const context = audioContextRef.current || new AudioContextCtor();
    audioContextRef.current = context;

    if (context.state === 'suspended') {
      context.resume().catch(() => {});
    }

    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const start = context.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(740, start);
    oscillator.frequency.exponentialRampToValueAtTime(554.37, start + 0.18);
    gainNode.gain.setValueAtTime(0.0001, start);
    gainNode.gain.exponentialRampToValueAtTime(0.045, start + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.24);
  }

  async function maybeNotify(title, body) {
    playNotificationTone();

    if (!notificationsEnabled || typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }

    if (Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        return;
      }
    }

    if (Notification.permission === 'granted' && !isWindowFocused) {
      new Notification(title, { body });
    }
  }

  async function fetchOnlineUsers() {
    try {
      const response = await fetch(apiUrl('/api/users/online'), {
        headers: authHeaders()
      });
      const data = await response.json();
      const onlineIds = new Set(data.map((entry) => entry.id));
      setOnlineUsers(onlineIds);
    } catch {
      // Ignore errors
    }
  }

  async function hydrateCurrentUser() {
    try {
      const response = await fetch(apiUrl('/api/me'), {
        headers: authHeaders()
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      if (data.user) {
        onUserChange(data.user);
      }
    } catch {
      // Ignore initial profile hydration failures and keep local state.
    }
  }

  async function fetchContacts() {
    const response = await fetch(apiUrl('/api/contacts'), {
      headers: authHeaders()
    });
    const data = await response.json();
    setContacts(Array.isArray(data) ? data : []);
  }

  async function fetchGroups() {
    const response = await fetch(apiUrl('/api/groups'), {
      headers: authHeaders()
    });
    const data = await response.json();
    setGroups(Array.isArray(data) ? data : []);
  }

  async function fetchAssistantSettings(groupId) {
    setAssistantLoading(true);
    setAssistantFeedback('');
    setAssistantReply('');

    try {
      const response = await fetch(apiUrl(`/api/groups/${groupId}/my-assistant`), {
        headers: authHeaders()
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '加载群助理失败');
      }

      setAssistantForm({
        displayName: data.assistant?.displayName || '我的群助理',
        systemPrompt: data.assistant?.systemPrompt || '',
        responseVisibility: data.assistant?.responseVisibility || 'private'
      });
    } catch (error) {
      setAssistantFeedback(error.message || '加载群助理失败');
    } finally {
      setAssistantLoading(false);
    }
  }

  async function selectConversation(conversation) {
    setSelectedConversation(conversation);
    setLoadingMessages(true);
    shouldScrollToBottomRef.current = true;

    try {
      const endpoint = conversation.type === 'group'
        ? `/api/groups/${conversation.id}/messages`
        : `/api/messages/${conversation.id}`;
      const response = await fetch(apiUrl(endpoint), {
        headers: authHeaders()
      });
      const data = await response.json();
      setMessages(Array.isArray(data) ? data : []);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function searchUsers() {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);

    try {
      const response = await fetch(apiUrl(`/api/users/search?q=${encodeURIComponent(searchQuery)}`), {
        headers: authHeaders()
      });
      const data = await response.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } finally {
      setSearching(false);
    }
  }

  async function addContact(contactId) {
    const response = await fetch(apiUrl('/api/contacts'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders()
      },
      body: JSON.stringify({ contactId })
    });

    const data = await response.json();
    if (!response.ok) {
      setProfileFeedback(data.error || '添加联系人失败');
      return;
    }

    setSearchQuery('');
    setSearchResults([]);
    setProfileFeedback('');
    await fetchContacts();
  }

  async function createGroup() {
    if (!groupForm.name.trim()) {
      setGroupFeedback('请输入群名称');
      return;
    }

    if (groupForm.memberIds.length < 1) {
      setGroupFeedback('至少选择一位联系人');
      return;
    }

    setGroupSubmitting(true);
    setGroupFeedback('');

    try {
      const response = await fetch(apiUrl('/api/groups'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders()
        },
        body: JSON.stringify(groupForm)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '创建群聊失败');
      }

      const nextGroup = { ...data.group, type: 'group' };
      setGroupForm({ name: '', memberIds: [] });
      setGroupCreatorOpen(false);
      await fetchGroups();
      await selectConversation(nextGroup);
    } catch (error) {
      setGroupFeedback(error.message || '创建群聊失败');
    } finally {
      setGroupSubmitting(false);
    }
  }

  async function saveProfile() {
    setProfileSaving(true);
    setProfileFeedback('');

    try {
      const response = await fetch(apiUrl('/api/me'), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders()
        },
        body: JSON.stringify(profileForm)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '保存资料失败');
      }

      onUserChange(data.user);
      setProfileFeedback('资料已保存');
      setProfileDrawerOpen(false);
      await fetchContacts();
    } catch (error) {
      setProfileFeedback(error.message || '保存资料失败');
    } finally {
      setProfileSaving(false);
    }
  }

  async function savePassword() {
    setPasswordSaving(true);
    setProfileFeedback('');

    try {
      const response = await fetch(apiUrl('/api/me/password'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders()
        },
        body: JSON.stringify(passwordForm)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '修改密码失败');
      }

      setPasswordForm({
        currentPassword: '',
        nextPassword: '',
        confirmPassword: ''
      });
      setProfileFeedback('密码已更新');
    } catch (error) {
      setProfileFeedback(error.message || '修改密码失败');
    } finally {
      setPasswordSaving(false);
    }
  }

  async function saveAssistant() {
    if (!selectedConversation || selectedConversation.type !== 'group') {
      return;
    }

    setAssistantSaving(true);
    setAssistantFeedback('');

    try {
      const response = await fetch(apiUrl(`/api/groups/${selectedConversation.id}/my-assistant`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders()
        },
        body: JSON.stringify(assistantForm)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '保存群助理失败');
      }

      setAssistantForm({
        displayName: data.assistant?.displayName || '我的群助理',
        systemPrompt: data.assistant?.systemPrompt || '',
        responseVisibility: data.assistant?.responseVisibility || 'private'
      });
      setAssistantFeedback('群助理设置已保存');
      setAssistantOpen(false);
    } catch (error) {
      setAssistantFeedback(error.message || '保存群助理失败');
    } finally {
      setAssistantSaving(false);
    }
  }

  async function askAssistant() {
    if (!selectedConversation || selectedConversation.type !== 'group') {
      return;
    }

    const prompt = assistantQuery.trim();
    if (!prompt) {
      setAssistantFeedback('先输入你要问群助理的问题');
      return;
    }

    setAssistantRunning(true);
    setAssistantFeedback('');

    try {
      const response = await fetch(apiUrl(`/api/groups/${selectedConversation.id}/my-assistant/chat`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders()
        },
        body: JSON.stringify({ prompt })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '群助理调用失败');
      }

      setAssistantReply(data.reply || '');
      setAssistantFeedback(data.visibility === 'group' ? '这条回复当前先仅在你这里展示。' : '这条回复仅你可见。');
    } catch (error) {
      setAssistantFeedback(error.message || '群助理调用失败');
    } finally {
      setAssistantRunning(false);
    }
  }

  function sendMessage() {
    const content = messageInput.trim();
    if (!content || !selectedConversation || !socket || sending) {
      return;
    }

    setSending(true);

    if (selectedConversation.type === 'group') {
      socket.emit('group-message', {
        groupId: selectedConversation.id,
        content
      });
    } else {
      socket.emit('message', {
        receiverId: selectedConversation.id,
        content
      });
    }

    setMessageInput('');
    setTimeout(() => setSending(false), 200);
  }

  function insertQuickEmoji(emoji) {
    setMessageInput((current) => `${current}${emoji}`);
  }

  return (
    <div className={`app-shell ${selectedConversation ? 'conversation-open' : ''}`}>
      <aside className={`left-rail ${selectedConversation ? 'mobile-hidden-when-active' : ''}`}>
        <div className="rail-header panel compact-panel">
          <div className="rail-user-summary">
            <Avatar user={user} className="profile-avatar compact-avatar" />
            <div className="profile-summary compact-summary">
              <h2>{displayName(user)}</h2>
              <p>@{user.username}</p>
            </div>
          </div>
          <button className="rail-menu-button" onClick={() => setProfileDrawerOpen((value) => !value)}>
            个人中心
          </button>
        </div>

        <div className={`profile-popover-shell ${profileDrawerOpen ? 'open' : ''}`}>
          <button className="profile-popover-backdrop" onClick={() => setProfileDrawerOpen(false)} aria-label="关闭个人中心" />
          <div className="profile-card profile-popover-card">
            <div className="profile-top">
              <Avatar user={user} className="profile-avatar" />
              <div className="profile-summary">
                <div className="badge subtle">在线</div>
                <h2>{displayName(user)}</h2>
                <p>@{user.username}</p>
                <div className="profile-meta">
                  <span>{user.phone ? `手机号 ${user.phone}` : '未设置手机号'}</span>
                </div>
              </div>
            </div>

            <div className="profile-editor">
              <div className="panel-title-row">
                <h3>个人资料</h3>
                <button className="text-button" onClick={() => setProfileDrawerOpen(false)}>关闭</button>
              </div>

              <div className="profile-grid">
                <label className="field">
                  <span>外观主题</span>
                  <select
                    className="search-input"
                    value={themeMode}
                    onChange={(event) => onThemeModeChange(event.target.value)}
                  >
                    <option value="system">跟随系统</option>
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </select>
                </label>

                <label className="field field-switch">
                  <span>新消息提示音</span>
                  <button
                    type="button"
                    className={`toggle-button ${soundEnabled ? 'active' : ''}`}
                    onClick={() => onSoundEnabledChange(!soundEnabled)}
                  >
                    {soundEnabled ? '已开启' : '已关闭'}
                  </button>
                </label>

                <label className="field field-switch">
                  <span>系统通知</span>
                  <button
                    type="button"
                    className={`toggle-button ${notificationsEnabled ? 'active' : ''}`}
                    onClick={() => onNotificationsEnabledChange(!notificationsEnabled)}
                  >
                    {notificationsEnabled ? '已开启' : '已关闭'}
                  </button>
                </label>

                <label className="field">
                  <span>昵称</span>
                  <input
                    type="text"
                    placeholder="例如：小凯"
                    value={profileForm.nickname}
                    onChange={(event) => setProfileForm((current) => ({ ...current, nickname: event.target.value }))}
                    disabled={profileSaving}
                  />
                </label>

                <label className="field">
                  <span>头像地址</span>
                  <input
                    type="text"
                    placeholder="https://example.com/avatar.jpg"
                    value={profileForm.avatarUrl}
                    onChange={(event) => setProfileForm((current) => ({ ...current, avatarUrl: event.target.value }))}
                    disabled={profileSaving}
                  />
                </label>

                <label className="field">
                  <span>手机号</span>
                  <input
                    type="text"
                    placeholder="请输入手机号"
                    value={profileForm.phone}
                    onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))}
                    disabled={profileSaving}
                  />
                </label>

                <label className="field">
                  <span>当前密码</span>
                  <input
                    type="password"
                    placeholder="请输入当前密码"
                    value={passwordForm.currentPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                    disabled={passwordSaving}
                  />
                </label>

                <label className="field">
                  <span>新密码</span>
                  <input
                    type="password"
                    placeholder="至少 6 位"
                    value={passwordForm.nextPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, nextPassword: event.target.value }))}
                    disabled={passwordSaving}
                  />
                </label>

                <label className="field">
                  <span>确认新密码</span>
                  <input
                    type="password"
                    placeholder="再次输入新密码"
                    value={passwordForm.confirmPassword}
                    onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                    disabled={passwordSaving}
                  />
                </label>
              </div>

              {profileFeedback ? <div className="inline-feedback">{profileFeedback}</div> : null}

              <div className="profile-actions">
                <button className="primary-button" onClick={saveProfile} disabled={profileSaving}>
                  {profileSaving ? '保存中...' : '保存资料'}
                </button>
                <button className="secondary-button" onClick={savePassword} disabled={passwordSaving}>
                  {passwordSaving ? '修改中...' : '修改密码'}
                </button>
                <button className="danger-button" onClick={onLogout}>退出登录</button>
              </div>
            </div>
          </div>
        </div>

        <div className={`profile-popover-shell group-builder-shell ${groupCreatorOpen ? 'open' : ''}`}>
          <button className="profile-popover-backdrop" onClick={() => setGroupCreatorOpen(false)} aria-label="关闭建群" />
          <div className="profile-card profile-popover-card">
            <div className="panel-title-row">
              <h3>创建群聊</h3>
              <button className="text-button" onClick={() => setGroupCreatorOpen(false)}>关闭</button>
            </div>

            <div className="profile-grid">
              <label className="field">
                <span>群名称</span>
                <input
                  type="text"
                  placeholder="例如：产品小群"
                  value={groupForm.name}
                  onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
                  disabled={groupSubmitting}
                />
              </label>
            </div>

            <div className="group-member-picker">
              {contacts.length > 0 ? contacts.map((contact) => {
                const checked = groupForm.memberIds.includes(contact.id);
                return (
                  <label key={contact.id} className="group-member-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setGroupForm((current) => ({
                          ...current,
                          memberIds: event.target.checked
                            ? [...current.memberIds, contact.id]
                            : current.memberIds.filter((id) => id !== contact.id)
                        }));
                      }}
                    />
                    <span>{displayName(contact)} · @{contact.username}</span>
                  </label>
                );
              }) : (
                <div className="empty-hint">先添加联系人后再建群。</div>
              )}
            </div>

            {groupFeedback ? <div className="inline-feedback">{groupFeedback}</div> : null}

            <div className="profile-actions">
              <button className="primary-button" onClick={createGroup} disabled={groupSubmitting}>
                {groupSubmitting ? '创建中...' : '创建群聊'}
              </button>
            </div>
          </div>
        </div>

        <div className={`profile-popover-shell assistant-shell ${assistantOpen ? 'open' : ''}`}>
          <button className="profile-popover-backdrop" onClick={() => setAssistantOpen(false)} aria-label="关闭群助理" />
          <div className="profile-card profile-popover-card">
            <div className="panel-title-row">
              <h3>我的群助理</h3>
              <button className="text-button" onClick={() => setAssistantOpen(false)}>关闭</button>
            </div>

            <div className="profile-grid">
              <label className="field">
                <span>助理名称</span>
                <input
                  type="text"
                  placeholder="例如：小凯助理"
                  value={assistantForm.displayName}
                  onChange={(event) => setAssistantForm((current) => ({ ...current, displayName: event.target.value }))}
                  disabled={assistantSaving || assistantLoading}
                />
              </label>

              <label className="field">
                <span>群内设定</span>
                <textarea
                  className="assistant-prompt-input"
                  placeholder="写下你的群助理风格、语气和边界。后面真正接入 AI 时就按这里的设定服务你自己。"
                  value={assistantForm.systemPrompt}
                  onChange={(event) => setAssistantForm((current) => ({ ...current, systemPrompt: event.target.value }))}
                  disabled={assistantSaving || assistantLoading}
                />
              </label>

              <label className="field">
                <span>回复可见范围</span>
                <select
                  className="search-input"
                  value={assistantForm.responseVisibility}
                  onChange={(event) => setAssistantForm((current) => ({ ...current, responseVisibility: event.target.value }))}
                  disabled={assistantSaving || assistantLoading}
                >
                  <option value="private">仅自己可见</option>
                  <option value="group">可选择发到群里</option>
                </select>
              </label>
            </div>

            <div className="assistant-query-box">
              <label className="field">
                <span>问群助理</span>
                <textarea
                  className="assistant-prompt-input"
                  placeholder="例如：帮我总结这个群最近在聊什么，或者帮我把接下来要做的事整理成清单。"
                  value={assistantQuery}
                  onChange={(event) => setAssistantQuery(event.target.value)}
                  disabled={assistantRunning || assistantLoading}
                />
              </label>
              <div className="profile-actions">
                <button className="secondary-button" onClick={askAssistant} disabled={assistantRunning || assistantLoading}>
                  {assistantRunning ? '思考中...' : '问助理'}
                </button>
              </div>
              {assistantReply ? <div className="assistant-reply-card">{assistantReply}</div> : null}
            </div>

            {assistantFeedback ? <div className="inline-feedback">{assistantFeedback}</div> : null}

            <div className="profile-actions">
              <button className="primary-button" onClick={saveAssistant} disabled={assistantSaving || assistantLoading}>
                {assistantSaving ? '保存中...' : assistantLoading ? '加载中...' : '保存群助理'}
              </button>
            </div>
          </div>
        </div>

        <div className="panel search-panel">
          <div className="search-row">
            <input
              className="search-input"
              type="text"
              placeholder="输入用户名、昵称或手机号"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  searchUsers();
                }
              }}
            />
            <button className="primary-button compact" onClick={searchUsers}>搜索</button>
          </div>

          {searchResults.length > 0 ? (
            <div className="result-list">
              {searchResults.map((entry) => (
                <div key={entry.id} className="result-item">
                  <div>
                    <strong>{displayName(entry)}</strong>
                    <span>@{entry.username}{entry.phone ? ` · ${entry.phone}` : ''}</span>
                  </div>
                  <button className="secondary-button compact" onClick={() => addContact(entry.id)}>
                    添加
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="panel contacts-panel">
          <div className="conversation-layout">
            <div className="conversation-side-nav">
              <button className={`side-nav-item ${tabFilter === 'all' ? 'active' : ''}`} onClick={() => setTabFilter('all')}>
                <span className="side-nav-text"><span>会</span><span>话</span></span>
              </button>
              <button className={`side-nav-item ${tabFilter === 'direct' ? 'active' : ''}`} onClick={() => setTabFilter('direct')}>
                <span className="side-nav-text"><span>私</span><span>聊</span></span>
              </button>
              <button className={`side-nav-item ${tabFilter === 'groups' ? 'active' : ''}`} onClick={() => setTabFilter('groups')}>
                <span className="side-nav-text"><span>群</span><span>聊</span></span>
              </button>
              <button className={`side-nav-item ${tabFilter === 'online' ? 'active' : ''}`} onClick={() => setTabFilter('online')}>
                <span className="side-nav-text"><span>在</span><span>线</span></span>
              </button>
              <button className={`side-nav-item ${tabFilter === 'unread' ? 'active' : ''}`} onClick={() => setTabFilter('unread')}>
                <span className="side-nav-text"><span>未</span><span>读</span></span>
              </button>
              <button className="side-nav-item accent" onClick={() => setGroupCreatorOpen(true)}>
                <span className="side-nav-text"><span>建</span><span>群</span></span>
              </button>
            </div>

            <div className="conversation-main">
              <div className="panel-title-row">
                <h3>{tabFilter === 'groups' ? '群聊列表' : tabFilter === 'direct' ? '联系人会话' : '最近会话'}</h3>
                <div className="panel-inline-actions">
                  <span>{filteredConversations.length}</span>
                </div>
              </div>

              <div className="search-row conversation-filter-row">
                <input
                  className="search-input"
                  type="text"
                  placeholder="筛选会话、联系人、群聊或最近消息"
                  value={conversationFilter}
                  onChange={(event) => setConversationFilter(event.target.value)}
                />
              </div>

              <div className="contact-list compact-contact-list">
                {filteredConversations.length > 0 ? filteredConversations.map((conversation) => {
                  const isDirect = conversation.type === 'direct';
                  const isOnline = isDirect ? onlineUsers.has(conversation.id) : false;
                  const isActive = selectedConversation?.type === conversation.type && selectedConversation?.id === conversation.id;

                  return (
                    <button
                      key={`${conversation.type}-${conversation.id}`}
                      className={`contact-card compact-contact-card ${isActive ? 'active' : ''}`}
                      onClick={() => selectConversation(conversation)}
                    >
                      <div style={{ position: 'relative' }}>
                        {isDirect ? <Avatar user={conversation} /> : <GroupAvatar name={conversation.name} />}
                        {isDirect ? <span className={`online-indicator ${isOnline ? 'online' : 'offline'}`} /> : null}
                      </div>
                      <div className="contact-meta">
                        <div className="contact-topline">
                          <strong>{conversation.title}</strong>
                          <span className="contact-time">{conversation.lastMessageAt ? formatMessageTime(conversation.lastMessageAt) : ''}</span>
                        </div>
                        <span>{conversation.subline}</span>
                        <div className="contact-bottomline">
                          <span className={`status-text ${isDirect ? (isOnline ? 'online' : 'offline') : 'group'}`}>
                            {conversation.summary}
                          </span>
                          {conversation.unreadCount > 0 ? <span className="unread-badge">{conversation.unreadCount}</span> : null}
                        </div>
                      </div>
                    </button>
                  );
                }) : (
                  <div className="empty-hint">没有匹配的联系人、群聊或会话。</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className={`chat-stage ${selectedConversation ? 'mobile-chat-active' : ''}`}>
        {notice ? (
          <div className="notice-banner">
            <span>{notice}</span>
            <button className="text-button" onClick={() => setNotice('')}>知道了</button>
          </div>
        ) : null}

        {selectedConversation ? (
          <>
            <header className="chat-topbar">
              <button className="mobile-back-button" onClick={() => setSelectedConversation(null)}>
                返回
              </button>
              <div className="chat-user">
                <div style={{ position: 'relative' }}>
                  {selectedIsGroup ? (
                    <GroupAvatar name={selectedConversation.name} className="chat-avatar" />
                  ) : (
                    <>
                      <Avatar user={selectedConversation} className="chat-avatar" />
                      <span className={`online-indicator ${onlineUsers.has(selectedConversation.id) ? 'online' : 'offline'}`} />
                    </>
                  )}
                </div>
                <div>
                  <div className="badge subtle">
                    {selectedIsGroup ? '群聊' : onlineUsers.has(selectedConversation.id) ? '在线' : '离线'}
                  </div>
                  <h3>{selectedDisplayName}</h3>
                  <p className="topbar-meta">
                    {selectedIsGroup ? (
                      `${selectedConversation.memberCount} 位成员 · 每个人都只可调用自己的群助理`
                    ) : (
                      <>
                        @{selectedConversation.username}
                        {selectedConversation.phone ? ` · ${selectedConversation.phone}` : ''}
                        {!onlineUsers.has(selectedConversation.id) && selectedConversation.lastSeen ? ` · 上次在线 ${formatMessageTime(selectedConversation.lastSeen)}` : ''}
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="chat-topbar-actions">
                {selectedIsGroup ? (
                  <button className="secondary-button compact" onClick={() => setAssistantOpen(true)}>
                    我的群助理
                  </button>
                ) : null}
                <input
                  className="message-search-input"
                  type="text"
                  placeholder="搜索当前会话消息"
                  value={messageSearch}
                  onChange={(event) => setMessageSearch(event.target.value)}
                />
              </div>
            </header>

            <section className="message-stage" ref={messageListRef}>
              {loadingMessages ? (
                <div className="empty-state">
                  <h3>正在加载消息</h3>
                  <p>稍等一下，会话记录马上就出来。</p>
                </div>
              ) : filteredMessages.length > 0 ? (
                filteredMessages.map((message, index) => {
                  const own = message.sender_id === user.id;
                  const prev = index > 0 ? filteredMessages[index - 1] : null;
                  return (
                    <div key={message.id}>
                      {shouldShowDayDivider(prev, message) ? (
                        <div className="day-divider">
                          <span>{formatDayDivider(message.created_at)}</span>
                        </div>
                      ) : null}
                      <div className={`message-row ${own ? 'mine' : 'theirs'}`}>
                        <div className={`message-bubble ${own ? 'mine' : 'theirs'}`}>
                          {selectedIsGroup && !own ? (
                            <div className="group-message-author">
                              {displayName(message.sender) || message.sender?.username || '成员'}
                            </div>
                          ) : null}
                          <div className="message-content">{message.content}</div>
                          <div className="message-meta-row">
                            <span className="message-time">{formatTime(message.created_at)}</span>
                            {!selectedIsGroup && own ? <span className="message-read-state">{message.read_at ? '已读' : '已发送'}</span> : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="empty-state">
                  <h3>还没有聊天记录</h3>
                  <p>{selectedIsGroup ? '先在群里发出第一条消息。' : '发出第一条消息后，这里会自动滚动到最新内容。'}</p>
                </div>
              )}
              <div ref={messageEndRef} />
            </section>

            <footer className="composer">
              <div className="quick-emoji-row">
                {['😀', '👍', '😂', '🎉', '❤️', '🙏'].map((emoji) => (
                  <button key={emoji} className="emoji-button" onClick={() => insertQuickEmoji(emoji)}>{emoji}</button>
                ))}
              </div>
              <div className="composer-box">
                <textarea
                  value={messageInput}
                  onChange={(event) => setMessageInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder={selectedIsGroup ? '输入群消息，按 Enter 发送，Shift + Enter 换行' : '输入消息，按 Enter 发送，Shift + Enter 换行'}
                  rows={3}
                />
                <button className="primary-button send-button" onClick={sendMessage} disabled={!messageInput.trim() || sending}>
                  {sending ? '发送中...' : '发送'}
                </button>
              </div>
            </footer>
          </>
        ) : (
          <div className="empty-state large">
            <div className="badge">准备就绪</div>
            <h2>选择一个私聊或群聊开始会话</h2>
            <p>左侧现在已经支持联系人和群聊，建群后每个人都能拥有只服务自己的群助理。</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
