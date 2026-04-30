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
    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      responded_at TEXT,
      UNIQUE(requester_id, receiver_id),
      FOREIGN KEY(requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_prefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      conversation_type TEXT NOT NULL,
      conversation_id INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, conversation_type, conversation_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT,
      deleted_by INTEGER,
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
      deleted_at TEXT,
      deleted_by INTEGER,
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_clears (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      conversation_type TEXT NOT NULL,
      conversation_id INTEGER NOT NULL,
      clear_before_id INTEGER NOT NULL DEFAULT 0,
      cleared_at TEXT NOT NULL,
      UNIQUE(user_id, conversation_type, conversation_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
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
  ensureColumn(db, 'messages', 'deleted_at', 'TEXT');
  ensureColumn(db, 'messages', 'deleted_by', 'INTEGER');
  ensureColumn(db, 'group_messages', 'deleted_at', 'TEXT');
  ensureColumn(db, 'group_messages', 'deleted_by', 'INTEGER');

  db.exec('CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver ON friend_requests(receiver_id, status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_friend_requests_requester ON friend_requests(requester_id, status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversation_prefs_user ON conversation_prefs(user_id, conversation_type, conversation_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversation_clears_user ON conversation_clears(user_id, conversation_type, conversation_id)');
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
          SELECT CASE WHEN m.deleted_at IS NULL THEN m.content ELSE '消息已撤回' END
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
        ) AS unread_count,
        COALESCE(cp.pinned, 0) AS pinned,
        COALESCE(cp.hidden, 0) AS hidden
      FROM contacts c
      JOIN users u ON u.id = c.contact_id
      LEFT JOIN conversation_prefs cp
        ON cp.user_id = c.user_id
        AND cp.conversation_type = 'direct'
        AND cp.conversation_id = c.contact_id
      WHERE c.user_id = ?
      ORDER BY COALESCE(cp.pinned, 0) DESC, COALESCE(last_message_at, u.created_at) DESC, u.id DESC
    `),
    listOnlineUsers: db.prepare('SELECT * FROM users WHERE online = 1 AND id != ? ORDER BY id DESC'),
    hasContact: db.prepare('SELECT id FROM contacts WHERE user_id = ? AND contact_id = ?'),
    createContact: db.prepare(`
      INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at)
      VALUES (?, ?, ?)
    `),
    deleteContact: db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?'),
    deleteConversationPref: db.prepare('DELETE FROM conversation_prefs WHERE user_id = ? AND conversation_type = ? AND conversation_id = ?'),
    upsertConversationPref: db.prepare(`
      INSERT INTO conversation_prefs (user_id, conversation_type, conversation_id, pinned, hidden, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, conversation_type, conversation_id)
      DO UPDATE SET pinned = excluded.pinned, hidden = excluded.hidden, updated_at = excluded.updated_at
    `),
    getPendingFriendRequest: db.prepare(`
      SELECT *
      FROM friend_requests
      WHERE requester_id = ? AND receiver_id = ? AND status = 'pending'
      LIMIT 1
    `),
    getFriendRequestById: db.prepare('SELECT * FROM friend_requests WHERE id = ?'),
    createFriendRequest: db.prepare(`
      INSERT INTO friend_requests (requester_id, receiver_id, message, status, created_at, responded_at)
      VALUES (?, ?, ?, 'pending', ?, NULL)
      ON CONFLICT(requester_id, receiver_id)
      DO UPDATE SET message = excluded.message, status = 'pending', created_at = excluded.created_at, responded_at = NULL
    `),
    updateFriendRequestStatus: db.prepare(`
      UPDATE friend_requests
      SET status = ?, responded_at = ?
      WHERE id = ?
    `),
    listIncomingFriendRequests: db.prepare(`
      SELECT
        fr.*,
        u.username AS requester_username,
        u.nickname AS requester_nickname,
        u.avatar_url AS requester_avatar_url,
        u.phone AS requester_phone,
        u.created_at AS requester_created_at,
        u.online AS requester_online,
        u.last_seen AS requester_last_seen
      FROM friend_requests fr
      JOIN users u ON u.id = fr.requester_id
      WHERE fr.receiver_id = ?
      ORDER BY fr.status = 'pending' DESC, fr.created_at DESC
    `),
    listOutgoingFriendRequests: db.prepare(`
      SELECT
        fr.*,
        u.username AS receiver_username,
        u.nickname AS receiver_nickname,
        u.avatar_url AS receiver_avatar_url,
        u.phone AS receiver_phone,
        u.created_at AS receiver_created_at,
        u.online AS receiver_online,
        u.last_seen AS receiver_last_seen
      FROM friend_requests fr
      JOIN users u ON u.id = fr.receiver_id
      WHERE fr.requester_id = ?
      ORDER BY fr.status = 'pending' DESC, fr.created_at DESC
    `),
    listMessages: db.prepare(`
      SELECT *
      FROM messages
      WHERE
        (sender_id = ? AND receiver_id = ?) OR
        (sender_id = ? AND receiver_id = ?)
      ORDER BY id ASC
    `),
    getConversationClear: db.prepare(`
      SELECT clear_before_id
      FROM conversation_clears
      WHERE user_id = ? AND conversation_type = ? AND conversation_id = ?
      LIMIT 1
    `),
    upsertConversationClear: db.prepare(`
      INSERT INTO conversation_clears (user_id, conversation_type, conversation_id, clear_before_id, cleared_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, conversation_type, conversation_id)
      DO UPDATE SET clear_before_id = excluded.clear_before_id, cleared_at = excluded.cleared_at
    `),
    getMaxDirectMessageId: db.prepare(`
      SELECT COALESCE(MAX(id), 0) AS max_id
      FROM messages
      WHERE
        (sender_id = ? AND receiver_id = ?) OR
        (sender_id = ? AND receiver_id = ?)
    `),
    getMaxGroupMessageId: db.prepare(`
      SELECT COALESCE(MAX(id), 0) AS max_id
      FROM group_messages
      WHERE group_id = ?
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
    recallMessage: db.prepare(`
      UPDATE messages
      SET deleted_at = ?, deleted_by = ?, content = ''
      WHERE id = ? AND sender_id = ? AND deleted_at IS NULL
    `),
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
          SELECT CASE WHEN gm.deleted_at IS NULL THEN gm.content ELSE '消息已撤回' END
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
        ) AS last_message_at,
        COALESCE(cp.pinned, 0) AS pinned,
        COALESCE(cp.hidden, 0) AS hidden
      FROM groups g
      JOIN group_members membership ON membership.group_id = g.id
      LEFT JOIN conversation_prefs cp
        ON cp.user_id = membership.user_id
        AND cp.conversation_type = 'group'
        AND cp.conversation_id = g.id
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
          SELECT CASE WHEN gm.deleted_at IS NULL THEN gm.content ELSE '消息已撤回' END
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
        ) AS last_message_at,
        COALESCE(cp.pinned, 0) AS pinned,
        COALESCE(cp.hidden, 0) AS hidden
      FROM groups g
      JOIN group_members membership ON membership.group_id = g.id
      LEFT JOIN conversation_prefs cp
        ON cp.user_id = membership.user_id
        AND cp.conversation_type = 'group'
        AND cp.conversation_id = g.id
      WHERE membership.user_id = ?
      ORDER BY COALESCE(cp.pinned, 0) DESC, COALESCE(last_message_at, g.created_at) DESC, g.id DESC
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
    recallGroupMessage: db.prepare(`
      UPDATE group_messages
      SET deleted_at = ?, deleted_by = ?, content = ''
      WHERE id = ? AND sender_id = ? AND deleted_at IS NULL
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
      pinned: Boolean(group.pinned),
      hidden: Boolean(group.hidden),
      conversationType: 'group'
    };
  }

  function toFriendRequest(row, userPrefix) {
    const target = {
      id: row[`${userPrefix}_id`] || (userPrefix === 'requester' ? row.requester_id : row.receiver_id),
      username: row[`${userPrefix}_username`],
      nickname: row[`${userPrefix}_nickname`] || '',
      avatar_url: row[`${userPrefix}_avatar_url`] || '',
      phone: row[`${userPrefix}_phone`] || '',
      created_at: row[`${userPrefix}_created_at`] || '',
      online: row[`${userPrefix}_online`] || 0,
      last_seen: row[`${userPrefix}_last_seen`] || null
    };

    return {
      id: row.id,
      requesterId: row.requester_id,
      receiverId: row.receiver_id,
      message: row.message || '',
      status: row.status,
      createdAt: row.created_at,
      respondedAt: row.responded_at || null,
      user: toPublicUser(target)
    };
  }

  function toGroupMessage(row) {
    return {
      id: row.id,
      group_id: row.group_id,
      sender_id: row.sender_id,
      content: row.content,
      created_at: row.created_at,
      deleted_at: row.deleted_at || null,
      deleted_by: row.deleted_by || null,
      sender: {
        id: row.sender_id,
        username: row.sender_username,
        nickname: row.sender_nickname || '',
        avatarUrl: row.sender_avatar_url || ''
      }
    };
  }

  function toDirectMessage(row) {
    return {
      id: row.id,
      sender_id: row.sender_id,
      receiver_id: row.receiver_id,
      content: row.content,
      created_at: row.created_at,
      read_at: row.read_at || null,
      deleted_at: row.deleted_at || null,
      deleted_by: row.deleted_by || null
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
        pinned: Boolean(row.pinned),
        hidden: Boolean(row.hidden),
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
    updateConversationPreference(userId, type, conversationId, payload, updatedAt) {
      const pinned = payload.pinned ? 1 : 0;
      const hidden = payload.hidden ? 1 : 0;
      statements.upsertConversationPref.run(userId, type, conversationId, pinned, hidden, updatedAt);
      return { type, id: conversationId, pinned: Boolean(pinned), hidden: Boolean(hidden) };
    },
    clearConversationPreference(userId, type, conversationId) {
      statements.deleteConversationPref.run(userId, type, conversationId);
    },
    createFriendRequest(requesterId, receiverId, message, createdAt) {
      statements.createFriendRequest.run(requesterId, receiverId, message, createdAt);
      return statements.getPendingFriendRequest.get(requesterId, receiverId);
    },
    getFriendRequestById(requestId) {
      return statements.getFriendRequestById.get(requestId) || null;
    },
    listFriendRequests(userId) {
      return {
        incoming: statements.listIncomingFriendRequests.all(userId).map((row) => toFriendRequest(row, 'requester')),
        outgoing: statements.listOutgoingFriendRequests.all(userId).map((row) => toFriendRequest(row, 'receiver'))
      };
    },
    respondToFriendRequest(requestId, status, respondedAt) {
      statements.updateFriendRequestStatus.run(status, respondedAt, requestId);
      return this.getFriendRequestById(requestId);
    },
    listMessagesForPair(userId, contactId) {
      const clear = statements.getConversationClear.get(userId, 'direct', contactId);
      const clearBeforeId = Number(clear?.clear_before_id || 0);
      return statements.listMessages
        .all(userId, contactId, contactId, userId)
        .filter((message) => Number(message.id) > clearBeforeId)
        .map(toDirectMessage);
    },
    markConversationRead(userId, contactId, readAt) {
      statements.markConversationRead.run(readAt, contactId, userId);
    },
    searchUsers(userId, q) {
      return statements.searchUsers.all(userId, `%${q.trim().toLowerCase()}%`).map(toPublicUser);
    },
    createMessage(senderId, receiverId, content, createdAt) {
      const result = statements.createMessage.run(senderId, receiverId, content, createdAt);
      return toDirectMessage(statements.getMessageById.get(Number(result.lastInsertRowid)));
    },
    recallMessage(messageId, userId, deletedAt) {
      const current = statements.getMessageById.get(messageId);
      if (!current || current.sender_id !== userId || current.deleted_at) {
        return null;
      }
      statements.recallMessage.run(deletedAt, userId, messageId, userId);
      return toDirectMessage(statements.getMessageById.get(messageId));
    },
    clearConversationForUser(userId, type, conversationId, clearedAt) {
      const maxId = type === 'group'
        ? Number(statements.getMaxGroupMessageId.get(conversationId)?.max_id || 0)
        : Number(statements.getMaxDirectMessageId.get(userId, conversationId, conversationId, userId)?.max_id || 0);
      statements.upsertConversationClear.run(userId, type, conversationId, maxId, clearedAt);
      return { type, id: conversationId, clearBeforeId: maxId, clearedAt };
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
    listGroupMessagesForUser(groupId, userId) {
      const clear = statements.getConversationClear.get(userId, 'group', groupId);
      const clearBeforeId = Number(clear?.clear_before_id || 0);
      return statements.listGroupMessages
        .all(groupId)
        .filter((message) => Number(message.id) > clearBeforeId)
        .map(toGroupMessage);
    },
    createGroupMessage(groupId, senderId, content, createdAt) {
      const result = statements.createGroupMessage.run(groupId, senderId, content, createdAt);
      return toGroupMessage(statements.getGroupMessageById.get(Number(result.lastInsertRowid)));
    },
    recallGroupMessage(messageId, userId, deletedAt) {
      const current = statements.getGroupMessageById.get(messageId);
      if (!current || current.sender_id !== userId || current.deleted_at) {
        return null;
      }
      statements.recallGroupMessage.run(deletedAt, userId, messageId, userId);
      return toGroupMessage(statements.getGroupMessageById.get(messageId));
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
