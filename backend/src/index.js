import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

const db = new Database('chat.db');
const JWT_SECRET = 'chat-app-secret-key-2026';

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    contact_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (contact_id) REFERENCES users(id)
  );
  
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  );
`);

app.use(cors());
app.use(express.json());

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  
  const passwordHash = await bcrypt.hash(password, 10);
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
  
  const token = jwt.sign({ userId: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, userId: result.lastInsertRowid, username });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, userId: user.id, username: user.username });
});

app.get('/api/contacts', authenticate, (req, res) => {
  const contacts = db.prepare(`
    SELECT u.id, u.username, u.created_at 
    FROM contacts c
    JOIN users u ON c.contact_id = u.id
    WHERE c.user_id = ?
  `).all(req.userId);
  
  res.json(contacts);
});

app.post('/api/contacts', authenticate, (req, res) => {
  const { contactId } = req.body;
  
  if (contactId === req.userId) {
    return res.status(400).json({ error: 'Cannot add yourself' });
  }
  
  const contact = db.prepare('SELECT id FROM users WHERE id = ?').get(contactId);
  if (!contact) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const existing = db.prepare('SELECT id FROM contacts WHERE user_id = ? AND contact_id = ?')
    .get(req.userId, contactId);
  if (existing) {
    return res.status(400).json({ error: 'Contact already exists' });
  }
  
  db.prepare('INSERT INTO contacts (user_id, contact_id) VALUES (?, ?)').run(req.userId, contactId);
  res.json({ success: true });
});

app.delete('/api/contacts/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?')
    .run(req.userId, req.params.id);
  res.json({ success: true });
});

app.get('/api/messages/:contactId', authenticate, (req, res) => {
  const messages = db.prepare(`
    SELECT * FROM messages 
    WHERE (sender_id = ? AND receiver_id = ?) 
       OR (sender_id = ? AND receiver_id = ?)
    ORDER BY created_at ASC
  `).all(req.userId, req.params.contactId, req.params.contactId, req.userId);
  
  res.json(messages);
});

app.get('/api/users/search', authenticate, (req, res) => {
  const { q } = req.query;
  const users = db.prepare(`
    SELECT id, username, created_at FROM users 
    WHERE username LIKE ? AND id != ?
    LIMIT 10
  `).all(`%${q}%`, req.userId);
  
  res.json(users);
});

const userSockets = new Map();

io.on('connection', (socket) => {
  const token = socket.handshake.auth.token;
  if (!token) return;
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;
    userSockets.set(userId, socket.id);
    
    socket.on('message', (data) => {
      const { receiverId, content } = data;
      
      const result = db.prepare('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)')
        .run(userId, receiverId, content);
      
      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
      
      const receiverSocket = userSockets.get(receiverId);
      if (receiverSocket) {
        io.to(receiverSocket).emit('message', message);
      }
      
      socket.emit('message', message);
    });
    
    socket.on('disconnect', () => {
      userSockets.delete(userId);
    });
  } catch {
    socket.disconnect();
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
