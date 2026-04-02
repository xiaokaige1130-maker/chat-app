import express from 'express';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = createServer(app);
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_PATH = process.env.DATA_PATH || path.resolve(__dirname, '../data.json');
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-before-production';
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  }
});

function ensureStore() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify({
      counters: {
        users: 0,
        contacts: 0,
        messages: 0
      },
      users: [],
      contacts: [],
      messages: []
    }, null, 2));
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2));
}

function nextId(store, key) {
  store.counters[key] += 1;
  return store.counters[key];
}

function nowIso() {
  return new Date().toISOString();
}

app.use(cors({ origin: true }));
app.use(express.json());

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const store = readStore();
  const existing = store.users.find((user) => user.username === username);
  if (existing) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = nextId(store, 'users');
  const user = {
    id: userId,
    username,
    password_hash: passwordHash,
    created_at: nowIso()
  };

  store.users.push(user);
  writeStore(store);

  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, userId, username });
});

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const store = readStore();
  const user = store.users.find((entry) => entry.username === username);

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
  const store = readStore();
  const contacts = store.contacts
    .filter((contact) => contact.user_id === req.userId)
    .map((contact) => store.users.find((user) => user.id === contact.contact_id))
    .filter(Boolean)
    .map((user) => ({
      id: user.id,
      username: user.username,
      created_at: user.created_at
    }));

  res.json(contacts);
});

app.post('/api/contacts', authenticate, (req, res) => {
  const contactId = Number(req.body.contactId);

  if (!contactId) {
    return res.status(400).json({ error: 'Contact ID required' });
  }

  if (contactId === req.userId) {
    return res.status(400).json({ error: 'Cannot add yourself' });
  }

  const store = readStore();
  const contactUser = store.users.find((user) => user.id === contactId);
  if (!contactUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  const existing = store.contacts.find((contact) => contact.user_id === req.userId && contact.contact_id === contactId);
  if (existing) {
    return res.status(400).json({ error: 'Contact already exists' });
  }

  store.contacts.push({
    id: nextId(store, 'contacts'),
    user_id: req.userId,
    contact_id: contactId,
    created_at: nowIso()
  });
  writeStore(store);

  res.json({ success: true });
});

app.delete('/api/contacts/:id', authenticate, (req, res) => {
  const contactId = Number(req.params.id);
  const store = readStore();
  store.contacts = store.contacts.filter((contact) => !(contact.user_id === req.userId && contact.contact_id === contactId));
  writeStore(store);
  res.json({ success: true });
});

app.get('/api/messages/:contactId', authenticate, (req, res) => {
  const contactId = Number(req.params.contactId);
  const store = readStore();
  const messages = store.messages
    .filter((message) => (
      (message.sender_id === req.userId && message.receiver_id === contactId) ||
      (message.sender_id === contactId && message.receiver_id === req.userId)
    ))
    .sort((left, right) => left.id - right.id);

  res.json(messages);
});

app.get('/api/users/search', authenticate, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) {
    return res.json([]);
  }

  const store = readStore();
  const users = store.users
    .filter((user) => user.id !== req.userId && user.username.toLowerCase().includes(q))
    .slice(0, 10)
    .map((user) => ({
      id: user.id,
      username: user.username,
      created_at: user.created_at
    }));

  res.json(users);
});

const userSockets = new Map();

io.on('connection', (socket) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    socket.disconnect();
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;
    userSockets.set(userId, socket.id);

    socket.on('message', (data) => {
      const receiverId = Number(data.receiverId);
      const content = String(data.content || '').trim();

      if (!receiverId || !content) {
        return;
      }

      const store = readStore();
      const message = {
        id: nextId(store, 'messages'),
        sender_id: userId,
        receiver_id: receiverId,
        content,
        created_at: nowIso()
      };

      store.messages.push(message);
      writeStore(store);

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

app.use(express.static(FRONTEND_DIST));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    next();
    return;
  }

  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

server.listen(PORT, HOST, () => {
  ensureStore();
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`Data file: ${DATA_PATH}`);
  console.log(`Frontend dist: ${FRONTEND_DIST}`);
});
