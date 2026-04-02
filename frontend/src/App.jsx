import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE || '';

function apiUrl(path) {
  return `${API_BASE}${path}`;
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

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));
  const [view, setView] = useState('login');
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!token) {
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

  const handleLogin = (nextToken, nextUser) => {
    localStorage.setItem('token', nextToken);
    localStorage.setItem('user', JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
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

  return <MainView user={user} socket={socket} onLogout={handleLogout} />;
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
        throw new Error(data.error || 'Request failed');
      }

      onLogin(data.token, { id: data.userId, username: data.username });
    } catch (error) {
      setError(error.message || 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-panel">
        <div className="login-copy">
          <span className="badge">Desktop-style Chat</span>
          <h1>Chat App</h1>
          <p>
            一个更像即时通讯客户端的轻量聊天应用，支持注册、联系人管理和实时消息推送。
          </p>
          <div className="feature-list">
            <div>
              <strong>实时消息</strong>
              <span>Socket.IO 即时送达</span>
            </div>
            <div>
              <strong>联系人</strong>
              <span>搜索、添加、快速会话</span>
            </div>
            <div>
              <strong>可桌面化</strong>
              <span>可打包为 Windows EXE</span>
            </div>
          </div>
        </div>

        <div className="login-card">
          <div className="login-header">
            <h2>{isRegister ? '创建账号' : '账号登录'}</h2>
            <p>{isRegister ? '先注册一个账号，再开始聊天。' : '输入账号后进入你的聊天工作台。'}</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <label className="field">
              <span>用户名</span>
              <input
                type="text"
                placeholder="例如 xiaokaige"
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
              {submitting ? '处理中...' : isRegister ? '立即注册' : '进入聊天'}
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

function MainView({ user, socket, onLogout }) {
  const [contacts, setContacts] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searching, setSearching] = useState(false);
  const messageListRef = useRef(null);
  const messageEndRef = useRef(null);

  useEffect(() => {
    fetchContacts();
  }, []);

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

    socket.on('message', handleIncomingMessage);

    return () => {
      socket.off('message', handleIncomingMessage);
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

  async function fetchContacts() {
    const response = await fetch(apiUrl('/api/contacts'), {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await response.json();
    setContacts(Array.isArray(data) ? data : []);
  }

  async function selectContact(contact) {
    setSelectedContact(contact);
    setLoadingMessages(true);

    try {
      const response = await fetch(apiUrl(`/api/messages/${contact.id}`), {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
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
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await response.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } finally {
      setSearching(false);
    }
  }

  async function addContact(contactId) {
    await fetch(apiUrl('/api/contacts'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ contactId })
    });

    setSearchQuery('');
    setSearchResults([]);
    await fetchContacts();
  }

  function sendMessage() {
    const content = messageInput.trim();
    if (!content || !selectedContact || !socket) {
      return;
    }

    socket.emit('message', {
      receiverId: selectedContact.id,
      content
    });
    setMessageInput('');
  }

  return (
    <div className="app-shell">
      <aside className="left-rail">
        <div className="profile-card">
          <div>
            <div className="badge subtle">在线</div>
            <h2>{user.username}</h2>
            <p>欢迎回来，开始新的会话。</p>
          </div>
          <button className="danger-button" onClick={onLogout}>退出</button>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>添加联系人</h3>
            <span>{searching ? '搜索中...' : `${searchResults.length} 个结果`}</span>
          </div>

          <div className="search-row">
            <input
              className="search-input"
              type="text"
              placeholder="输入用户名搜索"
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
                    <strong>{entry.username}</strong>
                    <span>ID {entry.id}</span>
                  </div>
                  <button className="secondary-button compact" onClick={() => addContact(entry.id)}>添加</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-hint">搜索联系人后会显示在这里。</div>
          )}
        </div>

        <div className="panel contacts-panel">
          <div className="panel-header">
            <h3>联系人</h3>
            <span>{contacts.length}</span>
          </div>

          <div className="contact-list">
            {contacts.length > 0 ? contacts.map((contact) => (
              <button
                key={contact.id}
                className={`contact-card ${selectedContact?.id === contact.id ? 'active' : ''}`}
                onClick={() => selectContact(contact)}
              >
                <div className="avatar">{contact.username[0].toUpperCase()}</div>
                <div className="contact-meta">
                  <strong>{contact.username}</strong>
                  <span>点击查看会话</span>
                </div>
              </button>
            )) : (
              <div className="empty-hint">还没有联系人，先搜索并添加一个用户。</div>
            )}
          </div>
        </div>
      </aside>

      <main className="chat-stage">
        {selectedContact ? (
          <>
            <header className="chat-topbar">
              <div>
                <div className="badge subtle">会话中</div>
                <h3>{selectedContact.username}</h3>
              </div>
              <span className="topbar-meta">{activeContactMessages.length} 条消息</span>
            </header>

            <section className="message-stage" ref={messageListRef}>
              {loadingMessages ? (
                <div className="empty-state">
                  <h3>正在加载消息</h3>
                  <p>稍等一下，会话记录马上出来。</p>
                </div>
              ) : activeContactMessages.length > 0 ? (
                activeContactMessages.map((message) => {
                  const own = message.sender_id === user.id;
                  return (
                    <div key={message.id} className={`message-row ${own ? 'mine' : 'theirs'}`}>
                      <div className={`message-bubble ${own ? 'mine' : 'theirs'}`}>
                        <div>{message.content}</div>
                        <span>{formatTime(message.created_at)}</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="empty-state">
                  <h3>还没有聊天记录</h3>
                  <p>发出第一条消息，这里会自动滚到最新内容。</p>
                </div>
              )}
              <div ref={messageEndRef} />
            </section>

            <footer className="composer">
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
                  placeholder="输入消息，Enter 发送，Shift + Enter 换行"
                  rows={3}
                />
                <button className="primary-button" onClick={sendMessage}>发送消息</button>
              </div>
            </footer>
          </>
        ) : (
          <div className="empty-state large">
            <div className="badge">Chat Ready</div>
            <h2>选择一个联系人开始聊天</h2>
            <p>左侧先搜索联系人并添加，然后点击联系人进入聊天窗口。</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
