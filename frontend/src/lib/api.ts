// Thin typed fetch wrapper for the ClassO Go backend. All calls go through the
// Vite dev proxy (/v1 -> localhost:8080) so no CORS or base URL is needed.
//
// Auth: the Supabase access token is read from localStorage and injected as a
// Bearer token on every request (see auth.ts for how it is set/cleared).
import type {
  Course,
  CourseMember,
  FormationResult,
  Group,
  Message,
  Profile,
  Task,
  TaskStatus,
  VaultFile,
} from '../types'
import { getAccessToken } from './auth'

const BASE = '/v1'

/** ApiError is thrown on a non-2xx response with the server's error message. */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** request performs a JSON request and parses the typed JSON response. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...init, headers })

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new ApiError(res.status, message)
  }

  // 204 No Content has no body.
  if (res.status === 204) return undefined as unknown as T
  return (await res.json()) as T
}

export const api = {
  // Profiles
  getMe: () => request<Profile>('/profiles/me'),
  updateMe: (body: { fullName?: string; role?: 'instructor' | 'student' }) =>
    request<Profile>('/profiles/me', { method: 'PATCH', body: JSON.stringify(body) }),
  promoteMe: () => request<Profile>('/profiles/me/promote', { method: 'POST' }),
  // Multipart avatar upload (not JSON, so it bypasses the JSON request helper).
  uploadAvatar: async (file: File): Promise<Profile> => {
    const form = new FormData()
    form.append('file', file)
    const token = getAccessToken()
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`${BASE}/profiles/me/avatar`, {
      method: 'POST',
      headers,
      body: form,
    })
    if (!res.ok) {
      let message = `Avatar upload failed (${res.status})`
      try {
        const body = await res.json()
        if (body?.error) message = body.error
      } catch {
        /* ignore non-JSON */
      }
      throw new ApiError(res.status, message)
    }
    return res.json()
  },

  // Courses
  listCourses: () => request<Course[]>('/courses'),
  getCourse: (courseId: string) => request<Course>(`/courses/${courseId}`),
  createCourse: (body: { name: string; code?: string }) =>
    request<Course>('/courses', { method: 'POST', body: JSON.stringify(body) }),
  deleteCourse: (courseId: string) =>
    request<{ status: string }>(`/courses/${courseId}`, { method: 'DELETE' }),
  joinCourse: (joinCode: string) =>
    request<Course>('/courses/join', { method: 'POST', body: JSON.stringify({ joinCode }) }),
  regenerateJoinCode: (courseId: string) =>
    request<Course>(`/courses/${courseId}/join-code`, { method: 'POST' }),
  expireJoinCode: (courseId: string) =>
    request<Course>(`/courses/${courseId}/join-code`, { method: 'DELETE' }),
  randomAssign: (courseId: string, capacity: number) =>
    request<FormationResult>(`/courses/${courseId}/random-assign`, {
      method: 'POST',
      body: JSON.stringify({ capacity }),
    }),
  createGroups: (courseId: string, body: { name: string; capacity: number; count: number }) =>
    request<Group[]>(`/courses/${courseId}/groups`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listGroups: (courseId: string) => request<Group[]>(`/courses/${courseId}/groups`),
  listCourseMembers: (courseId: string) => request<CourseMember[]>(`/courses/${courseId}/members`),
  myGroup: (courseId: string) => request<{ groupId: string }>(`/courses/${courseId}/my-group`),
  addMember: (courseId: string, userId: string, role: string) =>
    request(`/courses/${courseId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId, role }),
    }),
  removeCourseMember: (courseId: string, userId: string) =>
    request(`/courses/${courseId}/members`, {
      method: 'DELETE',
      body: JSON.stringify({ userId }),
    }),

  // Group workspace
  listMembers: (groupId: string) => request<Profile[]>(`/groups/${groupId}/members`),
  joinGroup: (groupId: string) =>
    request<{ status: string; groupId: string }>(`/groups/${groupId}/join`, { method: 'POST' }),
  leaveGroup: (groupId: string) =>
    request<{ status: string }>(`/groups/${groupId}/leave`, { method: 'POST' }),
  removeGroupMember: (groupId: string, userId: string) =>
    request<{ status: string }>(`/groups/${groupId}/members`, {
      method: 'DELETE',
      body: JSON.stringify({ userId }),
    }),
  deleteGroup: (groupId: string) =>
    request<{ status: string }>(`/groups/${groupId}`, { method: 'DELETE' }),
  renameGroup: (groupId: string, name: string) =>
    request<Group>(`/groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  getGroup: (groupId: string) => request<Group>(`/groups/${groupId}`),
  listMessages: (groupId: string) => request<Message[]>(`/groups/${groupId}/messages`),
  sendMessage: (groupId: string, content: string) =>
    request<Message>(`/groups/${groupId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  listTasks: (groupId: string) => request<Task[]>(`/groups/${groupId}/tasks`),
  createTask: (
    groupId: string,
    body: { title: string; description?: string; assigneeIds?: string[]; dueDate?: string },
  ) =>
    request<Task>(`/groups/${groupId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateTaskStatus: (groupId: string, taskId: string, status: TaskStatus) =>
    request(`/groups/${groupId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  updateTaskAssignees: (groupId: string, taskId: string, assigneeIds: string[]) =>
    request<Task>(`/groups/${groupId}/tasks/${taskId}/assignees`, {
      method: 'PUT',
      body: JSON.stringify({ assigneeIds }),
    }),
  listFiles: (groupId: string) => request<VaultFile[]>(`/groups/${groupId}/files`),
  fileUrl: (groupId: string, fileId: string) =>
    request<{ url: string; name: string; mimeType: string }>(
      `/groups/${groupId}/files/${fileId}/url`,
    ),
  // Multipart upload (not JSON, so it bypasses the JSON request helper). A
  // custom `name` overrides the chosen file's own filename so the user can
  // rename before upload.
  uploadFile: async (groupId: string, file: File, name?: string): Promise<VaultFile> => {
    const form = new FormData()
    form.append('file', file)
    if (name) form.append('name', name)
    const token = getAccessToken()
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`${BASE}/groups/${groupId}/files`, {
      method: 'POST',
      headers,
      body: form,
    })
    if (!res.ok) {
      let message = `Upload failed (${res.status})`
      try {
        const body = await res.json()
        if (body?.error) message = body.error
      } catch {
        /* ignore non-JSON */
      }
      throw new ApiError(res.status, message)
    }
    return res.json()
  },
  renameFile: (groupId: string, fileId: string, name: string) =>
    request<VaultFile>(`/groups/${groupId}/files/${fileId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteFile: (groupId: string, fileId: string) =>
    request<{ status: string }>(`/groups/${groupId}/files/${fileId}`, { method: 'DELETE' }),
}