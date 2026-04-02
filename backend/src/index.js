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

function normalizeStore(store) {
  const normalized = {
    counters: {
      users: Number(store?.counters?.users || 0),
      contacts: Number(store?.counters?.contacts || 0),
      messages: Number(store?.counters?.messages || 0)
    },
    users: Array.isArray(store?.users) ? store.users : [],
    contacts: Array.isArray(store?.contacts) ? store.contacts : [],
    messages: Array.isArray(store?.messages) ? store.messages : []
  };

  normalized.users = normalized.users.map((user) => ({
    ...user,
    nickname: typeof user.nickname === 'string' ? user.nickname : '',
    avatar_url: typeof user.avatar_url === 'string' ? user.avatar_url : '',
    phone: typeof user.phone === 'string' ? user.phone : ''
  }));

  normalized.messages = normalized.messages.map((message) => ({
    ...message,
    read_at: typeof message.read_at === 'string' ? message.read_at : null
  }));

  normalized.counters.users = Math.max(
    normalized.counters.users,
    ...normalized.users.map((user) => Number(user.id) || 0),
    0
  );
  normalized.counters.contacts = Math.max(
    normalized.counters.contacts,
    ...normalized.contacts.map((contact) => Number(contact.id) || 0),
    0
  );
  normalized.counters.messages = Math.max(
    normalized.counters.messages,
    ...normalized.messages.map((message) => Number(message.id) || 0),
    0
  );

  return normalized;
}

function readStore() {
  ensureStore();
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const store = normalizeStore(raw);
  if (JSON.stringify(raw) !== JSON.stringify(store)) {
    writeStore(store);
  }
  return store;
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

function formatMessageTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now - date;
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

function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname || '',
    avatarUrl: user.avatar_url || '',
    phone: user.phone || '',
    created_at: user.created_at,
    online: user.online || false,
    lastSeen: user.last_seen || null
  };
}

function validateProfileInput(payload) {
  const nickname = String(payload.nickname || '').trim();
  const avatarUrl = String(payload.avatarUrl || '').trim();
  const phone = String(payload.phone || '').trim();

  if (nickname.length > 24) {
    return { error: 'Nickname must be at most 24 characters' };
  }

  if (phone && !/^[0-9+\-() ]{6,20}$/.test(phone)) {
    return { error: 'Phone format is invalid' };
  }

  if (avatarUrl) {
    try {
      const url = new URL(avatarUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return { error: 'Avatar URL must start with http or https' };
      }
    } catch {
      return { error: 'Avatar URL is invalid' };
    }
  }

  return { nickname, avatarUrl, phone };
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
    nickname: '',
    avatar_url: '',
    phone: '',
    password_hash: passwordHash,
    created_at: nowIso()
  };

  store.users.push(user);
  writeStore(store);

  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: toPublicUser(user) });
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
  res.json({ token, user: toPublicUser(user) });
});

app.get('/api/me', authenticate, (req, res) => {
  const store = readStore();
  const user = store.users.find((entry) => entry.id === req.userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user: toPublicUser(user) });
});

app.patch('/api/me', authenticate, (req, res) => {
  const validated = validateProfileInput(req.body);
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  const store = readStore();
  const user = store.users.find((entry) => entry.id === req.userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.nickname = validated.nickname;
  user.avatar_url = validated.avatarUrl;
  user.phone = validated.phone;

  writeStore(store);
  res.json({ user: toPublicUser(user) });
});

app.get('/api/contacts', authenticate, (req, res) => {
  const store = readStore();
  const contacts = store.contacts
    .filter((contact) => contact.user_id === req.userId)
    .map((contact) => {
      const user = store.users.find((entry) => entry.id === contact.contact_id);
      if (!user) {
        return null;
      }

      const conversation = store.messages
        .filter((message) => (
          (message.sender_id === req.userId && message.receiver_id === contact.contact_id) ||
          (message.sender_id === contact.contact_id && message.receiver_id === req.userId)
        ))
        .sort((left, right) => left.id - right.id);

      const lastMessage = conversation[conversation.length - 1] || null;
      const unreadCount = conversation.filter(
        (message) => message.sender_id === contact.contact_id && message.receiver_id === req.userId && !message.read_at
      ).length;

      return {
        ...toPublicUser(user),
        lastMessage: lastMessage?.content || '',
        lastMessageAt: lastMessage?.created_at || '',
        unreadCount
      };
    })
    .filter(Boolean);

  res.json(contacts);
});

app.get('/api/users/online', authenticate, (req, res) => {
  const store = readStore();
  const onlineUsers = store.users
    .filter((user) => user.online && user.id !== req.userId)
    .map(toPublicUser);
  res.json(onlineUsers);
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

  const reverseExists = store.contacts.find((contact) => contact.user_id === contactId && contact.contact_id === req.userId);
  if (!reverseExists) {
    store.contacts.push({
      id: nextId(store, 'contacts'),
      user_id: contactId,
      contact_id: req.userId,
      created_at: nowIso()
    });
  }

  writeStore(store);

  const currentUser = store.users.find((user) => user.id === req.userId);
  const receiverSocket = userSockets.get(contactId);
  if (receiverSocket && currentUser) {
    io.to(receiverSocket).emit('contact_added', {
      id: currentUser.id,
      username: currentUser.username,
      created_at: currentUser.created_at
    });
  }

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

  let changed = false;
  for (const message of messages) {
    if (message.sender_id === contactId && message.receiver_id === req.userId && !message.read_at) {
      message.read_at = nowIso();
      changed = true;
    }
  }
  if (changed) {
    writeStore(store);
  }

  res.json(messages);
});

app.get('/api/users/search', authenticate, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) {
    return res.json([]);
  }

  const store = readStore();
  const users = store.users
    .filter((user) => {
      if (user.id === req.userId) {
        return false;
      }

      const haystack = [user.username, user.nickname, user.phone]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    })
    .slice(0, 10)
    .map(toPublicUser);

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
    
    // Mark user as online
    const store = readStore();
    const user = store.users.find((u) => u.id === userId);
    if (user) {
      user.online = true;
      user.last_seen = nowIso();
      writeStore(store);
    }
    
    userSockets.set(userId, socket.id);
    
    // Broadcast online status to all connected users
    io.emit('user-status', { userId, online: true });

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
        created_at: nowIso(),
        read_at: null
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
      
      // Mark user as offline
      const store = readStore();
      const user = store.users.find((u) => u.id === userId);
      if (user) {
        user.online = false;
        user.last_seen = nowIso();
        writeStore(store);
      }
      
      // Broadcast offline status
      io.emit('user-status', { userId, online: false });
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
