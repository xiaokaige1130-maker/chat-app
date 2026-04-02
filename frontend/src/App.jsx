import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE || '';

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

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(normalizeUser(readStoredUser()));
  const [view, setView] = useState(localStorage.getItem('token') ? 'main' : 'login');
  const [socket, setSocket] = useState(null);

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

  return <MainView user={user} socket={socket} onLogout={handleLogout} onUserChange={persistUser} />;
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
          <h1>轻聊</h1>
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
              <strong>资料可自定义</strong>
              <span>昵称、头像和手机号都可以在登录后修改。</span>
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
              {submitting ? '提交中...' : isRegister ? '立即注册' : '进入轻聊'}
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

function MainView({ user, socket, onLogout, onUserChange }) {
  const [contacts, setContacts] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [selectedContact, setSelectedContact] = useState(null);
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
  const [profileForm, setProfileForm] = useState({
    nickname: user?.nickname || '',
    avatarUrl: user?.avatarUrl || '',
    phone: user?.phone || ''
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState('');
  const messageListRef = useRef(null);
  const messageEndRef = useRef(null);

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
    fetchOnlineUsers();
  }, []);

  useEffect(() => {
    if (!selectedContact) {
      return;
    }

    const nextSelected = contacts.find((entry) => entry.id === selectedContact.id);
    if (nextSelected) {
      setSelectedContact(nextSelected);
    }
  }, [contacts, selectedContact]);

  useEffect(() => {
    if (!socket) {
      return undefined;
    }

    const handleIncomingMessage = (message) => {
      if (
        selectedContact &&
        (message.sender_id === selectedContact.id || message.receiver_id === selectedContact.id)
      ) {
        setMessages((current) => [...current, message]);
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

    socket.on('message', handleIncomingMessage);
    socket.on('user-status', handleUserStatus);

    return () => {
      socket.off('message', handleIncomingMessage);
      socket.off('user-status', handleUserStatus);
    };
  }, [socket, selectedContact]);

  useEffect(() => {
    if (!messageListRef.current) {
      return;
    }

    const viewport = messageListRef.current;
    const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 140;
    if (nearBottom || messages.length <= 1) {
      messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages]);

  const activeContactMessages = useMemo(() => messages, [messages]);
  const filteredContacts = useMemo(() => {
    const query = conversationFilter.trim().toLowerCase();
    let nextContacts = contacts;

    if (tabFilter === 'online') {
      nextContacts = nextContacts.filter((contact) => onlineUsers.has(contact.id));
    } else if (tabFilter === 'unread') {
      nextContacts = nextContacts.filter((contact) => contact.unreadCount > 0);
    }

    if (!query) {
      return nextContacts;
    }

    return nextContacts.filter((contact) => {
      const haystack = [
        displayName(contact),
        contact.username,
        contact.phone,
        contact.lastMessage
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [contacts, conversationFilter, tabFilter, onlineUsers]);

  const filteredMessages = useMemo(() => {
    const query = messageSearch.trim().toLowerCase();
    if (!query) {
      return activeContactMessages;
    }

    return activeContactMessages.filter((message) =>
      String(message.content || '').toLowerCase().includes(query)
    );
  }, [activeContactMessages, messageSearch]);

  async function fetchOnlineUsers() {
    try {
      const response = await fetch(apiUrl('/api/users/online'), {
        headers: authHeaders()
      });
      const data = await response.json();
      const onlineIds = new Set(data.map((u) => u.id));
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

  async function selectContact(contact) {
    setSelectedContact(contact);
    setLoadingMessages(true);

    try {
      const response = await fetch(apiUrl(`/api/messages/${contact.id}`), {
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
      await fetchContacts();
    } catch (error) {
      setProfileFeedback(error.message || '保存资料失败');
    } finally {
      setProfileSaving(false);
    }
  }

  function sendMessage() {
    const content = messageInput.trim();
    if (!content || !selectedContact || !socket || sending) {
      return;
    }

    setSending(true);
    socket.emit('message', {
      receiverId: selectedContact.id,
      content
    });
    setMessageInput('');
    setTimeout(() => setSending(false), 200);
  }

  function insertQuickEmoji(emoji) {
    setMessageInput((current) => `${current}${emoji}`);
  }

  const selectedDisplayName = selectedContact ? displayName(selectedContact) : '';

  return (
    <div className="app-shell">
      <aside className="left-rail">
        <div className="profile-card">
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
              <span>会展示给联系人</span>
            </div>

            <div className="profile-grid">
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
            </div>

            {profileFeedback ? <div className="inline-feedback">{profileFeedback}</div> : null}

            <div className="profile-actions">
              <button className="primary-button" onClick={saveProfile} disabled={profileSaving}>
                {profileSaving ? '保存中...' : '保存资料'}
              </button>
              <button className="danger-button" onClick={onLogout}>退出登录</button>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title-row">
            <h3>添加联系人</h3>
            <span>{searching ? '搜索中...' : `找到 ${searchResults.length} 个结果`}</span>
          </div>

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
          ) : (
            <div className="empty-hint">搜索后会在这里显示可添加的联系人。</div>
          )}
        </div>

        <div className="panel contacts-panel">
          <div className="panel-title-row">
            <h3>最近联系人</h3>
            <span>{filteredContacts.length}</span>
          </div>

          <div className="conversation-tabs">
            <button className={`tab-pill ${tabFilter === 'all' ? 'active' : ''}`} onClick={() => setTabFilter('all')}>全部</button>
            <button className={`tab-pill ${tabFilter === 'online' ? 'active' : ''}`} onClick={() => setTabFilter('online')}>在线</button>
            <button className={`tab-pill ${tabFilter === 'unread' ? 'active' : ''}`} onClick={() => setTabFilter('unread')}>未读</button>
          </div>

          <div className="search-row conversation-filter-row">
            <input
              className="search-input"
              type="text"
              placeholder="筛选会话、联系人或最近消息"
              value={conversationFilter}
              onChange={(event) => setConversationFilter(event.target.value)}
            />
          </div>

          <div className="contact-list">
            {filteredContacts.length > 0 ? filteredContacts.map((contact) => {
              const isOnline = onlineUsers.has(contact.id);
              return (
                <button
                  key={contact.id}
                  className={`contact-card ${selectedContact?.id === contact.id ? 'active' : ''}`}
                  onClick={() => selectContact(contact)}
                >
                  <div style={{ position: 'relative' }}>
                    <Avatar user={contact} />
                    <span className={`online-indicator ${isOnline ? 'online' : 'offline'}`} />
                  </div>
                  <div className="contact-meta">
                    <div className="contact-topline">
                      <strong>{displayName(contact)}</strong>
                      <span className="contact-time">{contact.lastMessageAt ? formatMessageTime(contact.lastMessageAt) : ''}</span>
                    </div>
                    <span>@{contact.username}{contact.phone ? ` · ${contact.phone}` : ''}</span>
                    <div className="contact-bottomline">
                      <span className={`status-text ${isOnline ? 'online' : 'offline'}`}>
                        {contact.lastMessage || (isOnline ? '在线' : contact.lastSeen ? `上次在线 ${formatMessageTime(contact.lastSeen)}` : '离线')}
                      </span>
                      {contact.unreadCount > 0 ? <span className="unread-badge">{contact.unreadCount}</span> : null}
                    </div>
                  </div>
                </button>
              );
            }) : (
              <div className="empty-hint">没有匹配的联系人或会话。</div>
            )}
          </div>
        </div>
      </aside>

      <main className="chat-stage">
        {selectedContact ? (
          <>
            <header className="chat-topbar">
              <div className="chat-user">
                <div style={{ position: 'relative' }}>
                  <Avatar user={selectedContact} className="chat-avatar" />
                  <span className={`online-indicator ${onlineUsers.has(selectedContact.id) ? 'online' : 'offline'}`} />
                </div>
                <div>
                  <div className="badge subtle">
                    {onlineUsers.has(selectedContact.id) ? '在线' : '离线'}
                  </div>
                  <h3>{selectedDisplayName}</h3>
                  <p className="topbar-meta">
                    @{selectedContact.username}
                    {selectedContact.phone ? ` · ${selectedContact.phone}` : ''}
                    {!onlineUsers.has(selectedContact.id) && selectedContact.lastSeen && ` · 上次在线 ${formatMessageTime(selectedContact.lastSeen)}`}
                  </p>
                </div>
              </div>
              <div className="chat-topbar-actions">
                <input
                  className="message-search-input"
                  type="text"
                  placeholder="搜索当前会话消息"
                  value={messageSearch}
                  onChange={(event) => setMessageSearch(event.target.value)}
                />
                <button className="secondary-button compact">📎</button>
                <button className="secondary-button compact">🖼️</button>
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
                    <>
                      {shouldShowDayDivider(prev, message) ? (
                        <div key={`divider-${message.id}`} className="day-divider">
                          <span>{formatDayDivider(message.created_at)}</span>
                        </div>
                      ) : null}
                      <div key={message.id} className={`message-row ${own ? 'mine' : 'theirs'}`}>
                        <div className={`message-bubble ${own ? 'mine' : 'theirs'}`}>
                          <div className="message-content">{message.content}</div>
                          <div className="message-meta-row">
                            <span className="message-time">{formatTime(message.created_at)}</span>
                            {own ? <span className="message-read-state">{message.read_at ? '已读' : '已发送'}</span> : null}
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })
              ) : (
                <div className="empty-state">
                  <h3>还没有聊天记录</h3>
                  <p>发出第一条消息后，这里会自动滚动到最新内容。</p>
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
                  placeholder="输入消息，按 Enter 发送，Shift + Enter 换行"
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
            <h2>选择一位联系人开始聊天</h2>
            <p>先在左侧补全资料并添加联系人，再点击联系人进入聊天窗口。</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
