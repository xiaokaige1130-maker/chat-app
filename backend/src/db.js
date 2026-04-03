import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

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
    phone: typeof user.phone === 'string' ? user.phone : '',
    online: Boolean(user.online),
    last_seen: typeof user.last_seen === 'string' ? user.last_seen : null
  }));

  normalized.messages = normalized.messages.map((message) => ({
    ...message,
    read_at: typeof message.read_at === 'string' ? message.read_at : null
  }));

  return normalized;
}

function readLegacyStore(dataPath) {
  if (!dataPath || !fs.existsSync(dataPath)) {
    return null;
  }

  try {
    return normalizeStore(JSON.parse(fs.readFileSync(dataPath, 'utf8')));
  } catch {
    return null;
  }
}

export function initDatabase({ dbPath, legacyDataPath }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      online INTEGER NOT NULL DEFAULT 0,
      last_seen TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, contact_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(contact_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      member_role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL,
      UNIQUE(group_id, user_id),
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS group_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS group_assistants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      display_name TEXT NOT NULL DEFAULT '我的群助理',
      system_prompt TEXT NOT NULL DEFAULT '',
      response_visibility TEXT NOT NULL DEFAULT 'private',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(group_id, user_id),
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  ensureColumn(db, 'users', 'nickname', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'users', 'avatar_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'users', 'phone', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'users', 'online', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'last_seen', 'TEXT');
  ensureColumn(db, 'messages', 'read_at', 'TEXT');

  db.exec('CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id, id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_receiver_read ON messages(receiver_id, sender_id, read_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_online ON users(online)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_group_messages_group_id ON group_messages(group_id, id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_group_assistants_user_group ON group_assistants(user_id, group_id)');

  migrateLegacyData(db, legacyDataPath);
  db.prepare('UPDATE users SET online = 0').run();

  return db;
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function migrateLegacyData(db, legacyDataPath) {
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) AS usersCount,
      (SELECT COUNT(*) FROM contacts) AS contactsCount,
      (SELECT COUNT(*) FROM messages) AS messagesCount
  `).get();

  if (counts.usersCount || counts.contactsCount || counts.messagesCount) {
    return;
  }

  const legacy = readLegacyStore(legacyDataPath);
  if (!legacy) {
    return;
  }

  const insertUser = db.prepare(`
    INSERT INTO users (id, username, nickname, avatar_url, phone, password_hash, created_at, online, last_seen)
    VALUES (@id, @username, @nickname, @avatar_url, @phone, @password_hash, @created_at, @online, @last_seen)
  `);
  const insertContact = db.prepare(`
    INSERT OR IGNORE INTO contacts (id, user_id, contact_id, created_at)
    VALUES (@id, @user_id, @contact_id, @created_at)
  `);
  const insertMessage = db.prepare(`
    INSERT INTO messages (id, sender_id, receiver_id, content, created_at, read_at)
    VALUES (@id, @sender_id, @receiver_id, @content, @created_at, @read_at)
  `);

  const migrate = db.transaction(() => {
    for (const user of legacy.users) {
      insertUser.run({
        id: Number(user.id),
        username: user.username,
        nickname: user.nickname || '',
        avatar_url: user.avatar_url || '',
        phone: user.phone || '',
        password_hash: user.password_hash,
        created_at: user.created_at,
        online: user.online ? 1 : 0,
        last_seen: user.last_seen || null
      });
    }

    for (const contact of legacy.contacts) {
      insertContact.run({
        id: Number(contact.id),
        user_id: Number(contact.user_id),
        contact_id: Number(contact.contact_id),
        created_at: contact.created_at
      });
    }

    for (const message of legacy.messages) {
      insertMessage.run({
        id: Number(message.id),
        sender_id: Number(message.sender_id),
        receiver_id: Number(message.receiver_id),
        content: String(message.content || ''),
        created_at: message.created_at,
        read_at: message.read_at || null
      });
    }
  });

  migrate();
}

export function createStore(db) {
  const statements = {
    getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    createUser: db.prepare(`
      INSERT INTO users (username, nickname, avatar_url, phone, password_hash, created_at, online, last_seen)
      VALUES (@username, @nickname, @avatar_url, @phone, @password_hash, @created_at, 0, NULL)
    `),
    updateProfile: db.prepare(`
      UPDATE users
      SET nickname = @nickname, avatar_url = @avatar_url, phone = @phone
      WHERE id = @id
    `),
    updatePasswordHash: db.prepare(`
      UPDATE users
      SET password_hash = ?
      WHERE id = ?
    `),
    listContacts: db.prepare(`
      SELECT
        u.id,
        u.username,
        u.nickname,
        u.avatar_url,
        u.phone,
        u.created_at,
        u.online,
        u.last_seen,
        (
          SELECT m.content
          FROM messages m
          WHERE
            (m.sender_id = c.user_id AND m.receiver_id = c.contact_id) OR
            (m.sender_id = c.contact_id AND m.receiver_id = c.user_id)
          ORDER BY m.id DESC
          LIMIT 1
        ) AS last_message,
        (
          SELECT m.created_at
          FROM messages m
          WHERE
            (m.sender_id = c.user_id AND m.receiver_id = c.contact_id) OR
            (m.sender_id = c.contact_id AND m.receiver_id = c.user_id)
          ORDER BY m.id DESC
          LIMIT 1
        ) AS last_message_at,
        (
          SELECT COUNT(*)
          FROM messages m
          WHERE m.sender_id = c.contact_id AND m.receiver_id = c.user_id AND m.read_at IS NULL
        ) AS unread_count
      FROM contacts c
      JOIN users u ON u.id = c.contact_id
      WHERE c.user_id = ?
      ORDER BY COALESCE(last_message_at, u.created_at) DESC, u.id DESC
    `),
    listOnlineUsers: db.prepare('SELECT * FROM users WHERE online = 1 AND id != ? ORDER BY id DESC'),
    hasContact: db.prepare('SELECT id FROM contacts WHERE user_id = ? AND contact_id = ?'),
    createContact: db.prepare(`
      INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at)
      VALUES (?, ?, ?)
    `),
    deleteContact: db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?'),
    listMessages: db.prepare(`
      SELECT *
      FROM messages
      WHERE
        (sender_id = ? AND receiver_id = ?) OR
        (sender_id = ? AND receiver_id = ?)
      ORDER BY id ASC
    `),
    markConversationRead: db.prepare(`
      UPDATE messages
      SET read_at = ?
      WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL
    `),
    searchUsers: db.prepare(`
      SELECT *
      FROM users
      WHERE id != ?
        AND LOWER(TRIM(COALESCE(username, '') || ' ' || COALESCE(nickname, '') || ' ' || COALESCE(phone, ''))) LIKE ?
      ORDER BY id DESC
      LIMIT 10
    `),
    createMessage: db.prepare(`
      INSERT INTO messages (sender_id, receiver_id, content, created_at, read_at)
      VALUES (?, ?, ?, ?, NULL)
    `),
    getMessageById: db.prepare('SELECT * FROM messages WHERE id = ?'),
    updatePresence: db.prepare('UPDATE users SET online = ?, last_seen = ? WHERE id = ?'),
    createGroup: db.prepare(`
      INSERT INTO groups (name, owner_id, created_at)
      VALUES (?, ?, ?)
    `),
    addGroupMember: db.prepare(`
      INSERT OR IGNORE INTO group_members (group_id, user_id, member_role, joined_at)
      VALUES (?, ?, ?, ?)
    `),
    getGroupForUser: db.prepare(`
      SELECT
        g.id,
        g.name,
        g.owner_id,
        g.created_at,
        (
          SELECT COUNT(*)
          FROM group_members gm2
          WHERE gm2.group_id = g.id
        ) AS member_count,
        (
          SELECT gm.content
          FROM group_messages gm
          WHERE gm.group_id = g.id
          ORDER BY gm.id DESC
          LIMIT 1
        ) AS last_message,
        (
          SELECT gm.created_at
          FROM group_messages gm
          WHERE gm.group_id = g.id
          ORDER BY gm.id DESC
          LIMIT 1
        ) AS last_message_at
      FROM groups g
      JOIN group_members membership ON membership.group_id = g.id
      WHERE g.id = ? AND membership.user_id = ?
      LIMIT 1
    `),
    listGroupsForUser: db.prepare(`
      SELECT
        g.id,
        g.name,
        g.owner_id,
        g.created_at,
        (
          SELECT COUNT(*)
          FROM group_members gm2
          WHERE gm2.group_id = g.id
        ) AS member_count,
        (
          SELECT gm.content
          FROM group_messages gm
          WHERE gm.group_id = g.id
          ORDER BY gm.id DESC
          LIMIT 1
        ) AS last_message,
        (
          SELECT gm.created_at
          FROM group_messages gm
          WHERE gm.group_id = g.id
          ORDER BY gm.id DESC
          LIMIT 1
        ) AS last_message_at
      FROM groups g
      JOIN group_members membership ON membership.group_id = g.id
      WHERE membership.user_id = ?
      ORDER BY COALESCE(last_message_at, g.created_at) DESC, g.id DESC
    `),
    isGroupMember: db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'),
    listGroupIdsForUser: db.prepare('SELECT group_id FROM group_members WHERE user_id = ? ORDER BY group_id ASC'),
    listGroupMessages: db.prepare(`
      SELECT
        gm.*,
        u.username AS sender_username,
        u.nickname AS sender_nickname,
        u.avatar_url AS sender_avatar_url
      FROM group_messages gm
      JOIN users u ON u.id = gm.sender_id
      WHERE gm.group_id = ?
      ORDER BY gm.id ASC
    `),
    createGroupMessage: db.prepare(`
      INSERT INTO group_messages (group_id, sender_id, content, created_at)
      VALUES (?, ?, ?, ?)
    `),
    getGroupMessageById: db.prepare(`
      SELECT
        gm.*,
        u.username AS sender_username,
        u.nickname AS sender_nickname,
        u.avatar_url AS sender_avatar_url
      FROM group_messages gm
      JOIN users u ON u.id = gm.sender_id
      WHERE gm.id = ?
      LIMIT 1
    `),
    getGroupAssistant: db.prepare(`
      SELECT *
      FROM group_assistants
      WHERE group_id = ? AND user_id = ?
      LIMIT 1
    `),
    createGroupAssistant: db.prepare(`
      INSERT OR IGNORE INTO group_assistants (group_id, user_id, display_name, system_prompt, response_visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    updateGroupAssistant: db.prepare(`
      UPDATE group_assistants
      SET display_name = ?, system_prompt = ?, response_visibility = ?, updated_at = ?
      WHERE group_id = ? AND user_id = ?
    `)
  };

  function toPublicUser(user) {
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname || '',
      avatarUrl: user.avatar_url || '',
      phone: user.phone || '',
      created_at: user.created_at,
      online: Boolean(user.online),
      lastSeen: user.last_seen || null
    };
  }

  function toGroupConversation(group) {
    return {
      id: group.id,
      name: group.name,
      ownerId: group.owner_id,
      created_at: group.created_at,
      memberCount: Number(group.member_count || 0),
      lastMessage: group.last_message || '',
      lastMessageAt: group.last_message_at || '',
      conversationType: 'group'
    };
  }

  function toGroupMessage(row) {
    return {
      id: row.id,
      group_id: row.group_id,
      sender_id: row.sender_id,
      content: row.content,
      created_at: row.created_at,
      sender: {
        id: row.sender_id,
        username: row.sender_username,
        nickname: row.sender_nickname || '',
        avatarUrl: row.sender_avatar_url || ''
      }
    };
  }

  return {
    toPublicUser,
    getUserById(userId) {
      return statements.getUserById.get(userId) || null;
    },
    getUserByUsername(username) {
      return statements.getUserByUsername.get(username) || null;
    },
    createUser(user) {
      const result = statements.createUser.run(user);
      return this.getUserById(Number(result.lastInsertRowid));
    },
    updateUserProfile(userId, profile) {
      statements.updateProfile.run({
        id: userId,
        nickname: profile.nickname,
        avatar_url: profile.avatarUrl,
        phone: profile.phone
      });
      return this.getUserById(userId);
    },
    updateUserPassword(userId, passwordHash) {
      statements.updatePasswordHash.run(passwordHash, userId);
      return this.getUserById(userId);
    },
    listContactsForUser(userId) {
      return statements.listContacts.all(userId).map((row) => ({
        ...toPublicUser(row),
        lastMessage: row.last_message || '',
        lastMessageAt: row.last_message_at || '',
        unreadCount: Number(row.unread_count || 0),
        conversationType: 'direct'
      }));
    },
    listOnlineUsers(excludeUserId) {
      return statements.listOnlineUsers.all(excludeUserId).map(toPublicUser);
    },
    addContactPair(userId, contactId, createdAt) {
      const insertPair = db.transaction(() => {
        statements.createContact.run(userId, contactId, createdAt);
        statements.createContact.run(contactId, userId, createdAt);
      });
      insertPair();
    },
    contactExists(userId, contactId) {
      return Boolean(statements.hasContact.get(userId, contactId));
    },
    removeContact(userId, contactId) {
      statements.deleteContact.run(userId, contactId);
    },
    listMessagesForPair(userId, contactId) {
      return statements.listMessages.all(userId, contactId, contactId, userId);
    },
    markConversationRead(userId, contactId, readAt) {
      statements.markConversationRead.run(readAt, contactId, userId);
    },
    searchUsers(userId, q) {
      return statements.searchUsers.all(userId, `%${q.trim().toLowerCase()}%`).map(toPublicUser);
    },
    createMessage(senderId, receiverId, content, createdAt) {
      const result = statements.createMessage.run(senderId, receiverId, content, createdAt);
      return statements.getMessageById.get(Number(result.lastInsertRowid));
    },
    updatePresence(userId, online, lastSeen) {
      statements.updatePresence.run(online ? 1 : 0, lastSeen, userId);
      return this.getUserById(userId);
    },
    createGroup(ownerId, name, memberIds, createdAt) {
      const nextMemberIds = Array.from(new Set([ownerId, ...memberIds.map(Number)])).filter(Boolean);

      const insertGroup = db.transaction(() => {
        const result = statements.createGroup.run(name, ownerId, createdAt);
        const groupId = Number(result.lastInsertRowid);

        for (const memberId of nextMemberIds) {
          const role = memberId === ownerId ? 'owner' : 'member';
          statements.addGroupMember.run(groupId, memberId, role, createdAt);
          statements.createGroupAssistant.run(
            groupId,
            memberId,
            '我的群助理',
            '',
            'private',
            createdAt,
            createdAt
          );
        }

        return groupId;
      });

      const groupId = insertGroup();
      return this.getGroupForUser(groupId, ownerId);
    },
    listGroupsForUser(userId) {
      return statements.listGroupsForUser.all(userId).map(toGroupConversation);
    },
    getGroupForUser(groupId, userId) {
      const row = statements.getGroupForUser.get(groupId, userId);
      return row ? toGroupConversation(row) : null;
    },
    listGroupIdsForUser(userId) {
      return statements.listGroupIdsForUser.all(userId).map((row) => Number(row.group_id));
    },
    isGroupMember(groupId, userId) {
      return Boolean(statements.isGroupMember.get(groupId, userId));
    },
    listGroupMessages(groupId) {
      return statements.listGroupMessages.all(groupId).map(toGroupMessage);
    },
    createGroupMessage(groupId, senderId, content, createdAt) {
      const result = statements.createGroupMessage.run(groupId, senderId, content, createdAt);
      return toGroupMessage(statements.getGroupMessageById.get(Number(result.lastInsertRowid)));
    },
    getMyGroupAssistant(groupId, userId) {
      let assistant = statements.getGroupAssistant.get(groupId, userId);
      if (!assistant) {
        const now = new Date().toISOString();
        statements.createGroupAssistant.run(groupId, userId, '我的群助理', '', 'private', now, now);
        assistant = statements.getGroupAssistant.get(groupId, userId);
      }

      if (!assistant) {
        return null;
      }

      return {
        groupId: assistant.group_id,
        userId: assistant.user_id,
        displayName: assistant.display_name,
        systemPrompt: assistant.system_prompt,
        responseVisibility: assistant.response_visibility,
        updatedAt: assistant.updated_at
      };
    },
    updateMyGroupAssistant(groupId, userId, payload) {
      const now = new Date().toISOString();
      statements.updateGroupAssistant.run(
        payload.displayName,
        payload.systemPrompt,
        payload.responseVisibility,
        now,
        groupId,
        userId
      );
      return this.getMyGroupAssistant(groupId, userId);
    }
  };
}
