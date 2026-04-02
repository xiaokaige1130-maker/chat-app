import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

const API_URL = 'http://localhost:3001';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));
  const [view, setView] = useState('login');
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (token) {
      const newSocket = io('http://localhost:3001', {
        auth: { token }
      });
      setSocket(newSocket);
      setView('main');
    }
  }, [token]);

  const handleLogin = (token, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    setToken(token);
    setUser(user);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const res = await fetch(`${API_URL}/api/auth/${isRegister ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      onLogin(data.token, { id: data.userId, username: data.username });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>{isRegister ? 'Register' : 'Login'}</h2>
        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={styles.input}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
          />
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" style={styles.button}>
            {isRegister ? 'Register' : 'Login'}
          </button>
        </form>
        <button onClick={() => setIsRegister(!isRegister)} style={styles.switchButton}>
          {isRegister ? 'Already have account? Login' : 'No account? Register'}
        </button>
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

  useEffect(() => {
    fetchContacts();
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on('message', (message) => {
      if (selectedContact && 
          (message.sender_id === selectedContact.id || message.receiver_id === selectedContact.id)) {
        setMessages((prev) => [...prev, message]);
      }
    });

    return () => {
      socket.off('message');
    };
  }, [socket, selectedContact]);

  const fetchContacts = async () => {
    const res = await fetch(`${API_URL}/api/contacts`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await res.json();
    setContacts(data);
  };

  const selectContact = async (contact) => {
    setSelectedContact(contact);
    const res = await fetch(`${API_URL}/api/messages/${contact.id}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await res.json();
    setMessages(data);
  };

  const searchUsers = async () => {
    if (!searchQuery.trim()) return;
    const res = await fetch(`${API_URL}/api/users/search?q=${searchQuery}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await res.json();
    setSearchResults(data);
  };

  const addContact = async (contactId) => {
    await fetch(`${API_URL}/api/contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ contactId })
    });
    setSearchQuery('');
    setSearchResults([]);
    fetchContacts();
  };

  const sendMessage = () => {
    if (!messageInput.trim() || !selectedContact) return;

    socket.emit('message', {
      receiverId: selectedContact.id,
      content: messageInput
    });
    setMessageInput('');
  };

  return (
    <div style={styles.mainContainer}>
      <div style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <span style={styles.username}>{user.username}</span>
          <button onClick={onLogout} style={styles.logoutButton}>Logout</button>
        </div>
        <div style={styles.searchContainer}>
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={styles.searchInput}
            onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
          />
          <button onClick={searchUsers} style={styles.searchButton}>Search</button>
        </div>
        {searchResults.length > 0 && (
          <div style={styles.searchResults}>
            {searchResults.map((u) => (
              <div key={u.id} style={styles.searchResultItem}>
                <span>{u.username}</span>
                <button onClick={() => addContact(u.id)} style={styles.addButton}>Add</button>
              </div>
            ))}
          </div>
        )}
        <div style={styles.contactList}>
          {contacts.map((contact) => (
            <div
              key={contact.id}
              onClick={() => selectContact(contact)}
              style={{
                ...styles.contactItem,
                backgroundColor: selectedContact?.id === contact.id ? '#e0e0e0' : 'transparent'
              }}
            >
              <div style={styles.avatar}>{contact.username[0].toUpperCase()}</div>
              <span>{contact.username}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={styles.chatArea}>
        {selectedContact ? (
          <>
            <div style={styles.chatHeader}>
              <span>{selectedContact.username}</span>
            </div>
            <div style={styles.messageList}>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    ...styles.messageBubble,
                    alignSelf: msg.sender_id === user.id ? 'flex-end' : 'flex-start',
                    backgroundColor: msg.sender_id === user.id ? '#007AFF' : '#f0f0f0',
                    color: msg.sender_id === user.id ? '#fff' : '#000'
                  }}
                >
                  {msg.content}
                </div>
              ))}
            </div>
            <div style={styles.inputContainer}>
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                style={styles.messageInput}
                placeholder="Type a message..."
              />
              <button onClick={sendMessage} style={styles.sendButton}>Send</button>
            </div>
          </>
        ) : (
          <div style={styles.welcome}>
            <h2>Welcome to Chat App</h2>
            <p>Select a contact to start chatting</p>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    backgroundColor: '#f5f5f5'
  },
  card: {
    padding: '40px',
    backgroundColor: '#fff',
    borderRadius: '10px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    width: '300px'
  },
  title: {
    margin: '0 0 20px 0',
    textAlign: 'center',
    color: '#333'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px'
  },
  input: {
    padding: '10px 15px',
    borderRadius: '5px',
    border: '1px solid #ddd',
    fontSize: '14px'
  },
  button: {
    padding: '12px',
    backgroundColor: '#007AFF',
    color: '#fff',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '16px'
  },
  switchButton: {
    marginTop: '15px',
    background: 'none',
    border: 'none',
    color: '#007AFF',
    cursor: 'pointer',
    fontSize: '14px'
  },
  error: {
    color: '#ff3b30',
    fontSize: '14px',
    textAlign: 'center'
  },
  mainContainer: {
    display: 'flex',
    height: '100vh'
  },
  sidebar: {
    width: '280px',
    backgroundColor: '#fff',
    borderRight: '1px solid #ddd',
    display: 'flex',
    flexDirection: 'column'
  },
  sidebarHeader: {
    padding: '15px',
    borderBottom: '1px solid #ddd',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  username: {
    fontWeight: 'bold',
    fontSize: '16px'
  },
  logoutButton: {
    padding: '5px 10px',
    backgroundColor: '#ff3b30',
    color: '#fff',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  searchContainer: {
    padding: '10px',
    display: 'flex',
    gap: '5px'
  },
  searchInput: {
    flex: 1,
    padding: '8px',
    borderRadius: '5px',
    border: '1px solid #ddd',
    fontSize: '14px'
  },
  searchButton: {
    padding: '8px 12px',
    backgroundColor: '#007AFF',
    color: '#fff',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  searchResults: {
    borderBottom: '1px solid #ddd',
    maxHeight: '200px',
    overflowY: 'auto'
  },
  searchResultItem: {
    padding: '10px 15px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #f0f0f0'
  },
  addButton: {
    padding: '5px 10px',
    backgroundColor: '#34c759',
    color: '#fff',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  contactList: {
    flex: 1,
    overflowY: 'auto'
  },
  contactItem: {
    padding: '15px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    cursor: 'pointer',
    borderBottom: '1px solid #f0f0f0'
  },
  avatar: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundColor: '#007AFF',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold'
  },
  chatArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#f9f9f9'
  },
  chatHeader: {
    padding: '15px 20px',
    backgroundColor: '#fff',
    borderBottom: '1px solid #ddd',
    fontWeight: 'bold',
    fontSize: '16px'
  },
  messageList: {
    flex: 1,
    padding: '20px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  messageBubble: {
    maxWidth: '70%',
    padding: '10px 15px',
    borderRadius: '15px',
    fontSize: '14px'
  },
  inputContainer: {
    padding: '15px 20px',
    backgroundColor: '#fff',
    borderTop: '1px solid #ddd',
    display: 'flex',
    gap: '10px'
  },
  messageInput: {
    flex: 1,
    padding: '10px 15px',
    borderRadius: '20px',
    border: '1px solid #ddd',
    fontSize: '14px'
  },
  sendButton: {
    padding: '10px 20px',
    backgroundColor: '#007AFF',
    color: '#fff',
    border: 'none',
    borderRadius: '20px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  welcome: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    color: '#888'
  }
};

export default App;
