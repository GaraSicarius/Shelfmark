CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS collections_user_name_idx ON collections (user_id, lower(name));

CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_user_name_idx ON tags (user_id, lower(name));

CREATE TABLE IF NOT EXISTS bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id uuid REFERENCES collections(id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (source_type IN ('url', 'text')),
  url text,
  normalized_url text,
  domain text,
  title text NOT NULL,
  note text,
  content_text text,
  content_hash text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  error text,
  attempts int NOT NULL DEFAULT 0,
  processing_started_at timestamptz,
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_user_url_idx
  ON bookmarks (user_id, normalized_url) WHERE normalized_url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_user_text_idx
  ON bookmarks (user_id, content_hash) WHERE source_type = 'text';
CREATE INDEX IF NOT EXISTS bookmarks_user_created_idx ON bookmarks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookmarks_user_status_idx ON bookmarks (user_id, status);

CREATE TABLE IF NOT EXISTS bookmark_tags (
  bookmark_id uuid NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (bookmark_id, tag_id)
);
CREATE INDEX IF NOT EXISTS bookmark_tags_tag_idx ON bookmark_tags (tag_id);

CREATE TABLE IF NOT EXISTS passages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bookmark_id uuid NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  ordinal int NOT NULL,
  text text NOT NULL,
  char_start int NOT NULL,
  char_end int NOT NULL,
  tsv tsvector,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS passages_bookmark_idx ON passages (bookmark_id);
CREATE INDEX IF NOT EXISTS passages_user_idx ON passages (user_id);
CREATE INDEX IF NOT EXISTS passages_tsv_idx ON passages USING gin (tsv);
CREATE INDEX IF NOT EXISTS passages_embedding_idx ON passages USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id uuid REFERENCES collections(id) ON DELETE SET NULL,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at);
