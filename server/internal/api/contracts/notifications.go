package contracts

import "time"

type Notification struct {
	ID        string     `json:"id"`
	Kind      string     `json:"kind"`
	Title     string     `json:"title"`
	Body      string     `json:"body,omitempty"`
	ActionURL string     `json:"action_url,omitempty"`
	WorkID    string     `json:"work_id,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	ReadAt    *time.Time `json:"read_at,omitempty"`
}

type NotificationList struct {
	Items       []Notification `json:"items"`
	UnreadCount int            `json:"unread_count"`
}

type NotificationUnreadCount struct {
	UnreadCount int `json:"unread_count"`
}
