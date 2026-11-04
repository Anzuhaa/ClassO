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
  GroupJoinRequest,
  GroupMemberView,
  Message,
  Profile,
  Task,
  TaskStatus,
  TypingSignal,
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
  if (token) {
    headers.Authorization = `Bearer ${token}`
    // Custom fallback header: some gateways (e.g. ModelScope) strip or replace
    // Authorization, so also send the token as X-Access-Token for the backend to
    // read as a fallback.
    headers['X-Access-Token'] = token
  }

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
  updateMe: (body: { fullName?: string }) =>
    request<Profile>('/profiles/me', { method: 'PATCH', body: JSON.stringify(body) }),
  promoteMe: () => request<Profile>('/profiles/me/promote', { method: 'POST' }),
  // Username availability (pre-registration; no auth token required). A 409
  // means the username is taken — mapped here to a typed result so callers get
  // a uniform { available } shape rather than an exception.
  checkUsername: async (username: string): Promise<{ available: boolean }> => {
    const res = await fetch(`${BASE}/auth/check-username?username=${encodeURIComponent(username)}`)
    if (res.status === 409) return { available: false }
    if (!res.ok) {
      let message = `Username check failed (${res.status})`
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
  // Multipart avatar upload (not JSON, so it bypasses the JSON request helper).
  uploadAvatar: async (file: File): Promise<Profile> => {
    const form = new FormData()
    form.append('file', file)
    const token = getAccessToken()
    const headers: Record<string, string> = {}
    if (token) {
      headers.Authorization = `Bearer ${token}`
      headers['X-Access-Token'] = token
    }
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
  setCourseLock: (courseId: string, locked: boolean) =>
    request<Course>(`/courses/${courseId}/lock`, {
      method: 'POST',
      body: JSON.stringify({ locked }),
    }),
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
  listMembers: (groupId: string) => request<GroupMemberView[]>(`/groups/${groupId}/members`),
  setGroupLead: (groupId: string, userId: string) =>
    request<{ status: string }>(`/groups/${groupId}/lead`, {
      method: 'PUT',
      body: JSON.stringify({ userId }),
    }),
  joinGroup: (groupId: string) =>
    request<{ status: string; groupId: string }>(`/groups/${groupId}/join`, { method: 'POST' }),
  leaveGroup: (groupId: string) =>
    request<{ status: string }>(`/groups/${groupId}/leave`, { method: 'POST' }),
  listJoinRequests: (courseId: string) =>
    request<GroupJoinRequest[]>(`/courses/${courseId}/join-requests`),
  approveJoinRequest: (courseId: string, requestId: string) =>
    request<GroupJoinRequest>(`/courses/${courseId}/join-requests/${requestId}/approve`, { method: 'POST' }),
  rejectJoinRequest: (courseId: string, requestId: string) =>
    request<GroupJoinRequest>(`/courses/${courseId}/join-requests/${requestId}/reject`, { method: 'POST' }),
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
  // Emit a "typing" presence ping. Callers throttle this (not every keystroke).
  sendTyping: (groupId: string) =>
    request<{ status: string }>(`/groups/${groupId}/typing`, { method: 'POST' }),
  // Subscribe to the group's message stream (server-sent events). Returns an
  // abort function so the caller can cancel on unmount. Each pushed message is
  // delivered to onMessage and each transient typing ping to onTyping; on the
  // stream ending (or erroring) onEnd fires unless it was aborted.
  streamMessages: (
    groupId: string,
    onMessage: (m: Message) => void,
    onTyping: (t: TypingSignal) => void,
    onEnd: () => void,
  ): (() => void) => {
    const controller = new AbortController()
    const token = getAccessToken()
    const headers: Record<string, string> = { Accept: 'text/event-stream' }
    if (token) headers.Authorization = `Bearer ${token}`

    void (async () => {
      try {
        const res = await fetch(`${BASE}/groups/${groupId}/messages/stream`, {
          headers,
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          onEnd()
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        // Parse SSE frames: events are separated by blank lines; each event
        // block carries `event:` and `data:` fields. Route "message" events to
        // onMessage and "typing" events to onTyping.
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let sep: number
          while ((sep = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, sep)
            buffer = buffer.slice(sep + 2)
            let event = 'message'
            let data = ''
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim()
              else if (line.startsWith('data:')) data += line.slice(5).trim()
            }
            if (!data) continue
            try {
              if (event === 'typing') onTyping(JSON.parse(data) as TypingSignal)
              else if (event === 'message') onMessage(JSON.parse(data) as Message)
            } catch {
              /* skip malformed frame */
            }
          }
        }
        onEnd()
      } catch {
        // AbortError on unmount is normal; any other network error ends the
        // stream (the component reconnects by re-running the effect).
        if (!controller.signal.aborted) onEnd()
      }
    })()

    return () => controller.abort()
  },
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
    if (token) {
      headers.Authorization = `Bearer ${token}`
      headers['X-Access-Token'] = token
    }
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