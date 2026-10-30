// Shared API types, mirroring the Go models' JSON surface (camelCase).

export interface Profile {
  id: string
  fullName: string
  email: string
  avatarUrl?: string
  role: 'instructor' | 'student'
  createdAt: string
}

export interface Course {
  id: string
  name: string
  code?: string
  joinCode: string
  joinCodeExpiresAt?: string
  ownerId: string
  createdAt: string
  updatedAt: string
}

// CourseMember is a profile joined with its per-course role, for the roster.
export interface CourseMember {
  id: string
  fullName: string
  email: string
  avatarUrl?: string
  role: 'instructor' | 'student'
  createdAt: string
  courseRole: 'instructor' | 'student'
}

export interface Group {
  id: string
  courseId: string
  name: string
  capacity: number
  createdAt: string
  memberCount?: number
}

export interface Message {
  id: string
  groupId: string
  senderId: string
  content: string
  createdAt: string
  senderName?: string
  senderAvatarUrl?: string
}

export interface VaultFile {
  id: string
  groupId: string
  uploaderId: string
  name: string
  storagePath: string
  size: number
  mimeType?: string
  createdAt: string
  uploaderName?: string
}

export type TaskStatus = 'todo' | 'in_progress' | 'done'

export interface Task {
  id: string
  groupId: string
  title: string
  description?: string
  assigneeId?: string
  status: TaskStatus
  dueDate?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
  assigneeName?: string
}

export interface FormationResult {
  courseId: string
  groups: Group[]
}