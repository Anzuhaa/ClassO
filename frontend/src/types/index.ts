// Shared API types, mirroring the Go models' JSON surface (camelCase).

export interface Profile {
  id: string
  fullName: string
  email: string
  avatarUrl?: string
  skills: string[]
  createdAt: string
}

export interface Course {
  id: string
  name: string
  code?: string
  ownerId: string
  groupSize: number
  createdAt: string
  updatedAt: string
}

export interface Group {
  id: string
  courseId: string
  name: string
  createdAt: string
}

export interface Message {
  id: string
  groupId: string
  senderId: string
  content: string
  createdAt: string
  senderName?: string
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

export interface AISummary {
  id: string
  groupId: string
  fromMessageId?: string
  summary: string
  createdAt: string
}

export interface FormationResult {
  courseId: string
  groups: Group[]
  usedAi: boolean
}