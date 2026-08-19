CREATE TABLE notification_events (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    action_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE notification_recipients (
    event_id TEXT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TEXT,
    PRIMARY KEY (event_id, user_id)
);

CREATE INDEX notification_recipients_user_unread
    ON notification_recipients(user_id, read_at, event_id);

