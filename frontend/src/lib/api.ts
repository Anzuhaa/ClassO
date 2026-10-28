// Thin typed fetch wrapper for the ClassO Go backend. All calls go through the
// Vite dev proxy (/v1 -> localhost:8080) so no CORS or base URL is needed.
import type {
  AISummary,
  Course,
  FormationResult,
  Group,
  Message,
  Profile,
  Task,
  TaskStatus,
  VaultFile,
} from '../types'

const BASE = '/v1'

// demoUserId is sent as the X-User-Id header when ALLOW_NO_AUTH is enabled so
// the backend can resolve identity without Supabase Auth wired up.
export const demoUserId = '00000000-0000-0000-0000-000000000001'

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
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': demoUserId,
      ...(init?.headers ?? {}),
    },
  })

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
  // Courses
  listCourses: () => request<Course[]>('/courses'),
  createCourse: (body: { name: string; code?: string; groupSize: number }) =>
    request<Course>('/courses', { method: 'POST', body: JSON.stringify(body) }),
  formGroups: (courseId: string) =>
    request<FormationResult>(`/courses/${courseId}/form`, { method: 'POST' }),
  listGroups: (courseId: string) => request<Group[]>(`/courses/${courseId}/groups`),
  addMember: (courseId: string, userId: string, role: string) =>
    request(`/courses/${courseId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId, role }),
    }),

  // Group workspace
  listMembers: (groupId: string) => request<Profile[]>(`/groups/${groupId}/members`),
  listMessages: (groupId: string) => request<Message[]>(`/groups/${groupId}/messages`),
  sendMessage: (groupId: string, content: string) =>
    request<Message>(`/groups/${groupId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  listTasks: (groupId: string) => request<Task[]>(`/groups/${groupId}/tasks`),
  createTask: (
    groupId: string,
    body: { title: string; description?: string; assigneeId?: string; dueDate?: string },
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
  listFiles: (groupId: string) => request<VaultFile[]>(`/groups/${groupId}/files`),
  // Multipart upload (not JSON, so it bypasses the JSON request helper).
  uploadFile: async (groupId: string, file: File): Promise<VaultFile> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/groups/${groupId}/files`, {
      method: 'POST',
      headers: { 'X-User-Id': demoUserId },
      body: form,
    })
    if (!res.ok) throw new ApiError(res.status, `Upload failed (${res.status})`)
    return res.json()
  },
  summarize: (groupId: string) =>
    request<AISummary>(`/groups/${groupId}/summary`, { method: 'POST' }),
  latestSummary: (groupId: string) => request<AISummary | null>(`/groups/${groupId}/summary`),
}