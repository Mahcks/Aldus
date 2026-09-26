CREATE TABLE reading_devices (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    label TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('web', 'ios', 'android', 'other')),
    PRIMARY KEY (user_id, id)
);

CREATE TABLE reading_owners (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    epoch INTEGER NOT NULL CHECK (epoch > 0),
    claim_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, work_id),
    FOREIGN KEY (user_id, device_id) REFERENCES reading_devices(user_id, id)
);
