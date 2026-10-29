// Package models defines the Go structs that mirror ClassO database rows.
//
// Struct fields use camelCase JSON tags (the API surface) while the database
// columns remain snake_case; the repository layer maps between the two.
package models

import "time"

// Profile mirrors the profiles table (Supabase Auth user mirror).
type Profile struct {
	ID        string    `json:"id"`
	FullName  string    `json:"fullName"`
	Email     string    `json:"email"`
	AvatarURL string    `json:"avatarUrl,omitempty"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"createdAt"`
}

// Course mirrors the courses table.
type Course struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	Code             string     `json:"code,omitempty"`
	JoinCode         string     `json:"joinCode"`
	JoinCodeExpiresAt *time.Time `json:"joinCodeExpiresAt,omitempty"`
	OwnerID          string     `json:"ownerId"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

// CourseMember mirrors course_members; Role is "instructor" or "student".
type CourseMember struct {
	ID       string `json:"id"`
	CourseID string `json:"courseId"`
	UserID   string `json:"userId"`
	Role     string `json:"role"`
}

// Group mirrors the groups table.
type Group struct {
	ID        string    `json:"id"`
	CourseID  string    `json:"courseId"`
	Name      string    `json:"name"`
	Capacity  int       `json:"capacity"`
	CreatedAt time.Time `json:"createdAt"`

	// MemberCount is the number of current members, populated for list views
	// so the UI can disable "Join Group" when the group is full. It is not a
	// column; it's computed with a COUNT/JOIN.
	MemberCount int `json:"memberCount,omitempty"`
}

// GroupMember mirrors group_members; Role is "lead" or "member".
type GroupMember struct {
	ID       string `json:"id"`
	GroupID  string `json:"groupId"`
	CourseID string `json:"courseId"`
	UserID   string `json:"userId"`
	Role     string `json:"role"`
}

// Message mirrors the messages table.
type Message struct {
	ID        string    `json:"id"`
	GroupID   string    `json:"groupId"`
	SenderID  string    `json:"senderId"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`

	// SenderName is a denormalized join field for display, not a column.
	SenderName string `json:"senderName,omitempty"`
}

// File mirrors the files (vault) table.
type File struct {
	ID          string    `json:"id"`
	GroupID     string    `json:"groupId"`
	UploaderID  string    `json:"uploaderId"`
	Name        string    `json:"name"`
	StoragePath string    `json:"storagePath"`
	Size        int64     `json:"size"`
	MimeType    string    `json:"mimeType,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`

	// UploaderName is a denormalized join field for display, not a column.
	UploaderName string `json:"uploaderName,omitempty"`
}

// Task mirrors the tasks table; Status is "todo", "in_progress", or "done".
type Task struct {
	ID          string     `json:"id"`
	GroupID     string     `json:"groupId"`
	Title       string     `json:"title"`
	Description string     `json:"description,omitempty"`
	AssigneeID  *string    `json:"assigneeId,omitempty"`
	Status      string     `json:"status"`
	DueDate     *time.Time `json:"dueDate,omitempty"`
	CreatedBy   *string    `json:"createdBy,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`

	AssigneeName string `json:"assigneeName,omitempty"`
}

// Task status constants.
const (
	TaskStatusTodo       = "todo"
	TaskStatusInProgress = "in_progress"
	TaskStatusDone       = "done"
)

// Member role constants.
const (
	RoleInstructor = "instructor"
	RoleStudent    = "student"
	RoleLead       = "lead"
	RoleMember     = "member"
)