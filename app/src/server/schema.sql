-- 数据库表结构（幂等，启动时执行）
-- 时间统一存 UTC 毫秒整数（INTEGER），展示层转本地时区。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  role            TEXT    NOT NULL CHECK (role IN ('admin','teacher','student')),
  username        TEXT    NOT NULL UNIQUE,
  password_hash   TEXT    NOT NULL,
  display_name    TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  must_change_pwd INTEGER NOT NULL DEFAULT 0,
  points_cached   INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 教师 <-> 学生 归属（多对多；学生账号全局唯一）
CREATE TABLE IF NOT EXISTS teacher_students (
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (teacher_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_ts_student ON teacher_students(student_id);

CREATE TABLE IF NOT EXISTS groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_groups_teacher ON groups(teacher_id);

CREATE TABLE IF NOT EXISTS group_members (
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_gm_student ON group_members(student_id);

CREATE TABLE IF NOT EXISTS folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL CHECK (type IN ('vote','score')),
  title        TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  folder_id    INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  anonymous    INTEGER NOT NULL DEFAULT 1,
  allow_peek_own_result INTEGER NOT NULL DEFAULT 1,
  start_at     INTEGER NOT NULL,
  end_at       INTEGER NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','closed')),
  media_json   TEXT    NOT NULL DEFAULT '[]',
  vote_multiple    INTEGER NOT NULL DEFAULT 0,
  vote_max_choices INTEGER NOT NULL DEFAULT 1,
  version      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_teacher ON activities(teacher_id, status);

CREATE TABLE IF NOT EXISTS activity_groups (
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (activity_id, group_id)
);

CREATE TABLE IF NOT EXISTS vote_options (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  text        TEXT    NOT NULL,
  image       TEXT    NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vote_ballots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id  INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_ids   TEXT    NOT NULL,          -- JSON 数组
  updated_at   INTEGER NOT NULL,
  UNIQUE (activity_id, student_id)        -- 只有修改，没有撤回
);

CREATE TABLE IF NOT EXISTS score_targets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  student_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- 仅教师可见
  anon_label  TEXT    NOT NULL,            -- 作品A / 编号03
  media_json  TEXT    NOT NULL DEFAULT '[]',
  hidden      INTEGER NOT NULL DEFAULT 0,  -- 1 = 不透发给学生
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS score_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  min_score   INTEGER NOT NULL DEFAULT 1,
  max_score   INTEGER NOT NULL DEFAULT 10,
  weight      REAL    NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS score_records (
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  target_id   INTEGER NOT NULL REFERENCES score_targets(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES score_items(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (target_id, item_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_sr_activity ON score_records(activity_id, student_id);

-- 草稿与正式分分离：草稿不参与任何统计
CREATE TABLE IF NOT EXISTS score_drafts (
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload     TEXT    NOT NULL DEFAULT '{}',
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (activity_id, student_id)
);

CREATE TABLE IF NOT EXISTS score_submissions (
  activity_id  INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submitted_at INTEGER NOT NULL,
  PRIMARY KEY (activity_id, student_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id       INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  target_id         INTEGER REFERENCES score_targets(id) ON DELETE CASCADE,
  student_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content           TEXT    NOT NULL,
  moderation_status TEXT    NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','approved','rejected')),
  ai_category       TEXT    NOT NULL DEFAULT '',
  reject_reason     TEXT    NOT NULL DEFAULT '',
  folded            INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_activity ON comments(activity_id, moderation_status);

-- 唯一键故意不含 emoji：同一人对同一内容只能计一次分
CREATE TABLE IF NOT EXISTS reactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  emoji      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, comment_id)
);

CREATE TABLE IF NOT EXISTS point_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,
  reason      TEXT    NOT NULL,
  activity_id INTEGER,
  folder_id   INTEGER,
  group_id    INTEGER,
  operator_id INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_student ON point_ledger(student_id);
-- 参与分只发一次的硬保证
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_participate
  ON point_ledger(student_id, activity_id, reason)
  WHERE reason = 'participate';

CREATE TABLE IF NOT EXISTS ai_config (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id  INTEGER NOT NULL DEFAULT 0,   -- 0 = 超管全局兜底
  api_base    TEXT    NOT NULL DEFAULT '',
  api_key_enc TEXT    NOT NULL DEFAULT '',
  model       TEXT    NOT NULL DEFAULT '',
  updated_at  INTEGER NOT NULL,
  UNIQUE (teacher_id)
);

CREATE TABLE IF NOT EXISTS export_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id       INTEGER NOT NULL,
  activity_id      INTEGER,
  include_identity INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS moderation_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id  INTEGER NOT NULL,
  operator_id INTEGER NOT NULL,
  action      TEXT    NOT NULL,
  note        TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL,               -- ip|username
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempt_key ON login_attempts(key, created_at);

-- AI 审核调用记账（用于每日预算控制）
CREATE TABLE IF NOT EXISTS ai_calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL,
  ok          INTEGER NOT NULL DEFAULT 0,
  note        TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_calls_act ON ai_calls(activity_id, created_at);
