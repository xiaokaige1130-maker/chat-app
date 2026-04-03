import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createStore, initDatabase } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = createServer(app);
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_PATH = process.env.DATA_PATH || path.resolve(__dirname, '../data.json');
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../chat.db');
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-before-production';
const AI_BASE_URL = String(process.env.AI_BASE_URL || '').replace(/\/$/, '');
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'gpt-5.4';
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');

const db = initDatabase({
  dbPath: DB_PATH,
  legacyDataPath: DATA_PATH
});
const store = createStore(db);

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  }
});

function nowIso() {
  return new Date().toISOString();
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

function validatePasswordInput(payload) {
  const currentPassword = String(payload.currentPassword || '');
  const nextPassword = String(payload.nextPassword || '');
  const confirmPassword = String(payload.confirmPassword || '');

  if (!currentPassword || !nextPassword || !confirmPassword) {
    return { error: '请完整填写当前密码和新密码' };
  }

  if (nextPassword.length < 6) {
    return { error: '新密码至少需要 6 位' };
  }

  if (nextPassword !== confirmPassword) {
    return { error: '两次输入的新密码不一致' };
  }

  if (currentPassword === nextPassword) {
    return { error: '新密码不能和当前密码相同' };
  }

  return { currentPassword, nextPassword };
}

function validateGroupInput(payload) {
  const name = String(payload.name || '').trim();
  const memberIds = Array.isArray(payload.memberIds) ? payload.memberIds.map(Number).filter(Boolean) : [];

  if (!name) {
    return { error: 'Group name required' };
  }

  if (name.length > 32) {
    return { error: 'Group name must be at most 32 characters' };
  }

  return { name, memberIds };
}

function validateAssistantInput(payload) {
  const displayName = String(payload.displayName || '').trim() || '我的群助理';
  const systemPrompt = String(payload.systemPrompt || '').trim();
  const responseVisibility = payload.responseVisibility === 'group' ? 'group' : 'private';

  if (displayName.length > 24) {
    return { error: 'Assistant name must be at most 24 characters' };
  }

  if (systemPrompt.length > 2000) {
    return { error: 'Assistant prompt must be at most 2000 characters' };
  }

  return { displayName, systemPrompt, responseVisibility };
}

async function callAssistantModel(messages) {
  if (!AI_BASE_URL || !AI_API_KEY || !AI_MODEL) {
    throw new Error('群助理模型未配置');
  }

  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      temperature: 0.7
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error || '群助理调用失败');
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('群助理没有返回内容');
  }

  return String(content).trim();
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

  const existing = store.getUserByUsername(username);
  if (existing) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = store.createUser({
    username,
    nickname: '',
    avatar_url: '',
    phone: '',
    password_hash: passwordHash,
    created_at: nowIso()
  });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: store.toPublicUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = store.getUserByUsername(username);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: store.toPublicUser(user) });
});

app.get('/api/me', authenticate, (req, res) => {
  const user = store.getUserById(req.userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user: store.toPublicUser(user) });
});

app.patch('/api/me', authenticate, (req, res) => {
  const validated = validateProfileInput(req.body);
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  const user = store.getUserById(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const updated = store.updateUserProfile(req.userId, validated);
  res.json({ user: store.toPublicUser(updated) });
});

app.post('/api/me/password', authenticate, async (req, res) => {
  const validated = validatePasswordInput(req.body);
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  const user = store.getUserById(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const valid = await bcrypt.compare(validated.currentPassword, user.password_hash);
  if (!valid) {
    return res.status(400).json({ error: '当前密码不正确' });
  }

  const passwordHash = await bcrypt.hash(validated.nextPassword, 10);
  store.updateUserPassword(req.userId, passwordHash);
  res.json({ success: true });
});

app.get('/api/contacts', authenticate, (req, res) => {
  res.json(store.listContactsForUser(req.userId));
});

app.get('/api/groups', authenticate, (req, res) => {
  res.json(store.listGroupsForUser(req.userId));
});

app.post('/api/groups', authenticate, (req, res) => {
  const validated = validateGroupInput(req.body);
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  const validMemberIds = validated.memberIds.filter((memberId) => {
    if (memberId === req.userId) {
      return false;
    }

    return Boolean(store.getUserById(memberId));
  });

  const group = store.createGroup(req.userId, validated.name, validMemberIds, nowIso());
  const memberIds = store.listGroupIdsForUser(req.userId); // keep store hot after transaction
  void memberIds;

  for (const memberId of [req.userId, ...validMemberIds]) {
    const targetSocketId = userSockets.get(memberId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('group_created', group);
    }
  }

  res.json({ group });
});

app.get('/api/groups/:groupId/messages', authenticate, (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!store.isGroupMember(groupId, req.userId)) {
    return res.status(403).json({ error: 'Not a group member' });
  }

  res.json(store.listGroupMessages(groupId));
});

app.get('/api/groups/:groupId/my-assistant', authenticate, (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!store.isGroupMember(groupId, req.userId)) {
    return res.status(403).json({ error: 'Not a group member' });
  }

  res.json({ assistant: store.getMyGroupAssistant(groupId, req.userId) });
});

app.patch('/api/groups/:groupId/my-assistant', authenticate, (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!store.isGroupMember(groupId, req.userId)) {
    return res.status(403).json({ error: 'Not a group member' });
  }

  const validated = validateAssistantInput(req.body);
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  res.json({
    assistant: store.updateMyGroupAssistant(groupId, req.userId, validated)
  });
});

app.post('/api/groups/:groupId/my-assistant/chat', authenticate, async (req, res) => {
  const groupId = Number(req.params.groupId);
  if (!store.isGroupMember(groupId, req.userId)) {
    return res.status(403).json({ error: 'Not a group member' });
  }

  const prompt = String(req.body.prompt || '').trim();
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt required' });
  }

  const assistant = store.getMyGroupAssistant(groupId, req.userId);
  const group = store.getGroupForUser(groupId, req.userId);
  const recentMessages = store.listGroupMessages(groupId).slice(-30);
  const requester = store.getUserById(req.userId);

  try {
    const reply = await callAssistantModel([
      {
        role: 'system',
        content: [
          '你是群聊里的个人助理，只服务当前提问用户本人。',
          '你可以参考当前群聊公开消息，但不能冒充别人，也不能说你能访问别人的私有助理。',
          `当前群名称：${group?.name || '未命名群聊'}`,
          `当前用户：${requester?.nickname || requester?.username || '用户'}`,
          assistant?.systemPrompt ? `助理设定：${assistant.systemPrompt}` : '助理设定：保持清晰、简洁、务实。'
        ].join('\n')
      },
      {
        role: 'system',
        content: `最近群消息：\n${recentMessages.map((message) => {
          const sender = message.sender?.nickname || message.sender?.username || `用户${message.sender_id}`;
          return `[${message.created_at}] ${sender}: ${message.content}`;
        }).join('\n') || '暂无群消息'}`
      },
      {
        role: 'user',
        content: prompt
      }
    ]);

    res.json({
      reply,
      visibility: assistant?.responseVisibility || 'private',
      assistant
    });
  } catch (error) {
    res.status(502).json({ error: error.message || '群助理调用失败' });
  }
});

app.get('/api/users/online', authenticate, (req, res) => {
  res.json(store.listOnlineUsers(req.userId));
});

app.post('/api/contacts', authenticate, (req, res) => {
  const contactId = Number(req.body.contactId);

  if (!contactId) {
    return res.status(400).json({ error: 'Contact ID required' });
  }

  if (contactId === req.userId) {
    return res.status(400).json({ error: 'Cannot add yourself' });
  }

  const contactUser = store.getUserById(contactId);
  if (!contactUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (store.contactExists(req.userId, contactId)) {
    return res.status(400).json({ error: 'Contact already exists' });
  }

  store.addContactPair(req.userId, contactId, nowIso());

  const currentUser = store.getUserById(req.userId);
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
  store.removeContact(req.userId, contactId);
  res.json({ success: true });
});

app.get('/api/messages/:contactId', authenticate, (req, res) => {
  const contactId = Number(req.params.contactId);
  const readAt = nowIso();
  store.markConversationRead(req.userId, contactId, readAt);
  res.json(store.listMessagesForPair(req.userId, contactId));
});

app.get('/api/users/search', authenticate, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    return res.json([]);
  }

  res.json(store.searchUsers(req.userId, q));
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

    const user = store.updatePresence(userId, true, nowIso());
    if (!user) {
      socket.disconnect();
      return;
    }

    userSockets.set(userId, socket.id);
    socket.join(`user:${userId}`);

    for (const groupId of store.listGroupIdsForUser(userId)) {
      socket.join(`group:${groupId}`);
    }

    io.emit('user-status', { userId, online: true });

    socket.on('message', (data) => {
      const receiverId = Number(data.receiverId);
      const content = String(data.content || '').trim();

      if (!receiverId || !content) {
        return;
      }

      const message = store.createMessage(userId, receiverId, content, nowIso());
      const receiverSocket = userSockets.get(receiverId);
      if (receiverSocket) {
        io.to(receiverSocket).emit('message', message);
      }

      socket.emit('message', message);
    });

    socket.on('group-message', (data) => {
      const groupId = Number(data.groupId);
      const content = String(data.content || '').trim();

      if (!groupId || !content || !store.isGroupMember(groupId, userId)) {
        return;
      }

      const message = store.createGroupMessage(groupId, userId, content, nowIso());
      io.to(`group:${groupId}`).emit('group-message', message);
    });

    socket.on('disconnect', () => {
      userSockets.delete(userId);
      store.updatePresence(userId, false, nowIso());
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
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`Data file: ${DATA_PATH}`);
  console.log(`Database file: ${DB_PATH}`);
  console.log(`Frontend dist: ${FRONTEND_DIST}`);
});
