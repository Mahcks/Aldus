DELETE FROM notification_recipients
WHERE NOT EXISTS (
    SELECT 1
    FROM notification_events
    WHERE notification_events.id = notification_recipients.event_id
);
