//! 原生持久化（SQLite / SQLCipher）。需 `persistence` feature。
//!
//! 對應前端 `apps/desktop/src/storage/types.ts` 的 `AppStorage`：身分、聯絡人、
//! 訊息、回應、已收回、封鎖名單。取代 A2 的 localStorage 資料層。
//!
//! **加密（SQLCipher）**：`Store::open` 在提供金鑰時發出 `PRAGMA key`——以
//! `bundled` 純 SQLite 建置時該 pragma 會被忽略（明碼，供測試/開發）；以
//! `bundled-sqlcipher` 建置時則整庫加密（正式版）。詳見 crate README。

use rusqlite::{params, Connection, OptionalExtension};

/// 身分（私鑰以 nsec 表示；Tauri 版可再交由 OS 金鑰庫託管，見 B5）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub nsec: String,
    pub name: String,
}

/// 聯絡人（亦用於封鎖名單項目）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Contact {
    pub pubkey: String,
    pub name: String,
}

/// 一則訊息（`expires_at` 僅限時訊息才有，毫秒）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub id: String,
    pub contact: String,
    pub outgoing: bool,
    pub text: String,
    pub at: i64,
    pub expires_at: Option<i64>,
}

/// 一則回應（去重以事件 id 為準）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reaction {
    pub id: String,
    pub message_id: String,
    pub emoji: String,
    pub mine: bool,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS identity (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    nsec     TEXT NOT NULL,
    name     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
    pubkey   TEXT PRIMARY KEY,
    name     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    contact    TEXT NOT NULL,
    outgoing   INTEGER NOT NULL,
    text       TEXT NOT NULL,
    at         INTEGER NOT NULL,
    expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages (contact);
CREATE TABLE IF NOT EXISTS reactions (
    id         TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    emoji      TEXT NOT NULL,
    mine       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deleted (
    message_id TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS blocked (
    pubkey     TEXT PRIMARY KEY,
    name       TEXT NOT NULL
);
"#;

/// 本機加密資料庫。
pub struct Store {
    conn: Connection,
}

impl Store {
    /// 開啟（或建立）資料庫。`key` 非 None 時發出 `PRAGMA key`（SQLCipher 加密）。
    pub fn open(path: &str, key: Option<&str>) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn, key)
    }

    /// 記憶體資料庫（測試用）。
    pub fn open_in_memory(key: Option<&str>) -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::init(conn, key)
    }

    fn init(conn: Connection, key: Option<&str>) -> rusqlite::Result<Self> {
        if let Some(key) = key {
            // SQLCipher：必須在任何存取前設定金鑰。純 SQLite 會忽略此 pragma。
            conn.pragma_update(None, "key", key)?;
        }
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    // ── 身分 ───────────────────────────────────────────────────────────────

    pub fn load_identity(&self) -> rusqlite::Result<Option<Identity>> {
        self.conn
            .query_row("SELECT nsec, name FROM identity WHERE id = 1", [], |r| {
                Ok(Identity { nsec: r.get(0)?, name: r.get(1)? })
            })
            .optional()
    }

    pub fn save_identity(&self, identity: &Identity) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO identity (id, nsec, name) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET nsec = excluded.nsec, name = excluded.name",
            params![identity.nsec, identity.name],
        )?;
        Ok(())
    }

    // ── 聯絡人 ─────────────────────────────────────────────────────────────

    pub fn load_contacts(&self) -> rusqlite::Result<Vec<Contact>> {
        let mut stmt = self.conn.prepare("SELECT pubkey, name FROM contacts ORDER BY rowid")?;
        let rows = stmt.query_map([], |r| Ok(Contact { pubkey: r.get(0)?, name: r.get(1)? }))?;
        rows.collect()
    }

    pub fn add_contact(&self, contact: &Contact) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO contacts (pubkey, name) VALUES (?1, ?2)",
            params![contact.pubkey, contact.name],
        )?;
        Ok(())
    }

    /// 移除聯絡人並一併清除其對話訊息。
    pub fn remove_contact(&self, pubkey: &str) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM contacts WHERE pubkey = ?1", params![pubkey])?;
        self.conn.execute("DELETE FROM messages WHERE contact = ?1", params![pubkey])?;
        Ok(())
    }

    // ── 封鎖 ───────────────────────────────────────────────────────────────

    pub fn block_contact(&self, contact: &Contact) -> rusqlite::Result<()> {
        self.remove_contact(&contact.pubkey)?;
        self.conn.execute(
            "INSERT OR IGNORE INTO blocked (pubkey, name) VALUES (?1, ?2)",
            params![contact.pubkey, contact.name],
        )?;
        Ok(())
    }

    pub fn unblock_contact(&self, pubkey: &str) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM blocked WHERE pubkey = ?1", params![pubkey])?;
        Ok(())
    }

    pub fn load_blocked(&self) -> rusqlite::Result<Vec<Contact>> {
        let mut stmt = self.conn.prepare("SELECT pubkey, name FROM blocked ORDER BY rowid")?;
        let rows = stmt.query_map([], |r| Ok(Contact { pubkey: r.get(0)?, name: r.get(1)? }))?;
        rows.collect()
    }

    // ── 訊息 ───────────────────────────────────────────────────────────────

    pub fn load_messages(&self, contact: &str) -> rusqlite::Result<Vec<Message>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, contact, outgoing, text, at, expires_at
             FROM messages WHERE contact = ?1 ORDER BY rowid",
        )?;
        let rows = stmt.query_map(params![contact], |r| {
            Ok(Message {
                id: r.get(0)?,
                contact: r.get(1)?,
                outgoing: r.get(2)?,
                text: r.get(3)?,
                at: r.get(4)?,
                expires_at: r.get(5)?,
            })
        })?;
        rows.collect()
    }

    /// 追加訊息（以 id 去重）。
    pub fn append_message(&self, message: &Message) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO messages (id, contact, outgoing, text, at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                message.id,
                message.contact,
                message.outgoing,
                message.text,
                message.at,
                message.expires_at,
            ],
        )?;
        Ok(())
    }

    // ── 回應 ───────────────────────────────────────────────────────────────

    pub fn load_reactions(&self) -> rusqlite::Result<Vec<Reaction>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, message_id, emoji, mine FROM reactions ORDER BY rowid")?;
        let rows = stmt.query_map([], |r| {
            Ok(Reaction {
                id: r.get(0)?,
                message_id: r.get(1)?,
                emoji: r.get(2)?,
                mine: r.get(3)?,
            })
        })?;
        rows.collect()
    }

    pub fn add_reaction(&self, reaction: &Reaction) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO reactions (id, message_id, emoji, mine) VALUES (?1, ?2, ?3, ?4)",
            params![reaction.id, reaction.message_id, reaction.emoji, reaction.mine],
        )?;
        Ok(())
    }

    // ── 已收回 ─────────────────────────────────────────────────────────────

    pub fn mark_deleted(&self, message_id: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO deleted (message_id) VALUES (?1)",
            params![message_id],
        )?;
        Ok(())
    }

    pub fn load_deleted(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT message_id FROM deleted ORDER BY rowid")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        Store::open_in_memory(None).unwrap()
    }

    fn msg(id: &str, contact: &str, at: i64) -> Message {
        Message {
            id: id.into(),
            contact: contact.into(),
            outgoing: true,
            text: "hi".into(),
            at,
            expires_at: None,
        }
    }

    #[test]
    fn identity_round_trip_and_upsert() {
        let s = store();
        assert_eq!(s.load_identity().unwrap(), None);
        s.save_identity(&Identity { nsec: "nsec1a".into(), name: "Alice".into() }).unwrap();
        assert_eq!(
            s.load_identity().unwrap(),
            Some(Identity { nsec: "nsec1a".into(), name: "Alice".into() })
        );
        // 覆寫（單列）
        s.save_identity(&Identity { nsec: "nsec1a".into(), name: "Alice2".into() }).unwrap();
        assert_eq!(s.load_identity().unwrap().unwrap().name, "Alice2");
    }

    #[test]
    fn contacts_dedup_and_order() {
        let s = store();
        s.add_contact(&Contact { pubkey: "aa".into(), name: "A".into() }).unwrap();
        s.add_contact(&Contact { pubkey: "aa".into(), name: "A2".into() }).unwrap(); // 去重
        s.add_contact(&Contact { pubkey: "bb".into(), name: "B".into() }).unwrap();
        let pks: Vec<_> = s.load_contacts().unwrap().into_iter().map(|c| c.pubkey).collect();
        assert_eq!(pks, vec!["aa", "bb"]);
    }

    #[test]
    fn messages_partitioned_by_contact_dedup_and_ordered() {
        let s = store();
        s.append_message(&msg("m1", "aa", 1)).unwrap();
        s.append_message(&msg("m1", "aa", 1)).unwrap(); // 去重
        s.append_message(&msg("m2", "aa", 2)).unwrap();
        s.append_message(&msg("m3", "bb", 3)).unwrap();
        let aa: Vec<_> = s.load_messages("aa").unwrap().into_iter().map(|m| m.id).collect();
        assert_eq!(aa, vec!["m1", "m2"]);
        let bb: Vec<_> = s.load_messages("bb").unwrap().into_iter().map(|m| m.id).collect();
        assert_eq!(bb, vec!["m3"]);
    }

    #[test]
    fn expiring_message_round_trips_expiry() {
        let s = store();
        let mut m = msg("m1", "aa", 1);
        m.expires_at = Some(9999);
        s.append_message(&m).unwrap();
        assert_eq!(s.load_messages("aa").unwrap()[0].expires_at, Some(9999));
    }

    #[test]
    fn remove_contact_clears_conversation() {
        let s = store();
        s.add_contact(&Contact { pubkey: "aa".into(), name: "A".into() }).unwrap();
        s.append_message(&msg("m1", "aa", 1)).unwrap();
        s.remove_contact("aa").unwrap();
        assert!(s.load_contacts().unwrap().is_empty());
        assert!(s.load_messages("aa").unwrap().is_empty());
    }

    #[test]
    fn block_moves_out_of_contacts_and_can_unblock() {
        let s = store();
        s.add_contact(&Contact { pubkey: "aa".into(), name: "A".into() }).unwrap();
        s.block_contact(&Contact { pubkey: "aa".into(), name: "A".into() }).unwrap();
        assert!(s.load_contacts().unwrap().is_empty());
        assert_eq!(
            s.load_blocked().unwrap().into_iter().map(|c| c.pubkey).collect::<Vec<_>>(),
            vec!["aa"]
        );
        s.unblock_contact("aa").unwrap();
        assert!(s.load_blocked().unwrap().is_empty());
    }

    #[test]
    fn reactions_dedup_by_id() {
        let s = store();
        let r = Reaction { id: "r1".into(), message_id: "m1".into(), emoji: "👍".into(), mine: false };
        s.add_reaction(&r).unwrap();
        s.add_reaction(&r).unwrap();
        assert_eq!(s.load_reactions().unwrap().len(), 1);
        assert_eq!(s.load_reactions().unwrap()[0].emoji, "👍");
    }

    #[test]
    fn deleted_set_dedups() {
        let s = store();
        s.mark_deleted("m1").unwrap();
        s.mark_deleted("m1").unwrap();
        s.mark_deleted("m2").unwrap();
        assert_eq!(s.load_deleted().unwrap(), vec!["m1", "m2"]);
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn sqlcipher_wrong_key_cannot_read() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("nb_enc_test_{}.sqlite", std::process::id()));
        let p = path.to_str().unwrap();
        let _ = std::fs::remove_file(p);

        {
            let s = Store::open(p, Some("correct-key")).unwrap();
            s.save_identity(&Identity { nsec: "nsec1secret".into(), name: "Secret".into() }).unwrap();
        }
        // 錯誤金鑰：連結構讀取都無法解密 → 開啟即失敗。
        assert!(Store::open(p, Some("wrong-key")).is_err(), "錯誤金鑰不應能開啟加密庫");
        // 完全不給金鑰亦然。
        assert!(Store::open(p, None).is_err(), "無金鑰不應能讀取加密庫");
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn open_with_key_succeeds_and_persists_across_reopen() {
        // 純 SQLite 會忽略 PRAGMA key；此處驗證帶金鑰的開啟路徑可用且能重開。
        let dir = std::env::temp_dir();
        let path = dir.join(format!("nb_store_test_{}.sqlite", std::process::id()));
        let p = path.to_str().unwrap();
        let _ = std::fs::remove_file(p);

        {
            let s = Store::open(p, Some("test-key")).unwrap();
            s.save_identity(&Identity { nsec: "nsec1x".into(), name: "Zoe".into() }).unwrap();
        }
        {
            let s = Store::open(p, Some("test-key")).unwrap();
            assert_eq!(s.load_identity().unwrap().unwrap().name, "Zoe");
        }
        let _ = std::fs::remove_file(p);
    }
}
