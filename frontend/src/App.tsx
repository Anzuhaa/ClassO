// App shell: auth gate + React Router. Real URL paths (/courses/:id,
// /courses/:id/groups/:groupId) keep the view stable across refreshes.
import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { GraduationCap, Moon, Sun, BookOpen, Users } from 'lucide-react'
import { useTheme } from './lib/theme'
import { api } from './lib/api'
import { getStoredUser, getAccessToken, persistUser, type AuthUser } from './lib/auth'
import type { Course } from './types'
import { CourseList } from './features/courses/CourseList'
import { CourseDetail } from './features/courses/CourseDetail'
import { GroupWorkspace } from './features/groups/GroupWorkspace'
import { AuthScreen } from './features/auth/AuthScreen'
import { UserMenu } from './features/auth/UserMenu'

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const token = getAccessToken()
    const stored = getStoredUser()
    return token ? stored : null
  })

  // On mount, refresh the role and avatar from the backend's authoritative
  // profile (which syncs from Supabase Auth metadata) so an admin's role change
  // and any avatar upload take effect on the user's next load without re-login.
  const refreshRole = () => {
    if (!user?.id) return
    api
      .getMe()
      .then((p) => {
        const role: AuthUser['role'] = p.role === 'instructor' ? 'instructor' : 'student'
        setUser((prev) => {
          if (!prev) return prev
          const updated: AuthUser = {
            ...prev,
            role,
            avatarUrl: p.avatarUrl,
            fullName: p.fullName || prev.fullName,
          }
          if (updated.role === prev.role && updated.avatarUrl === prev.avatarUrl && updated.fullName === prev.fullName) {
            return prev
          }
          persistUser(updated)
          return updated
        })
      })
      .catch(() => {})
  }

  useEffect(() => {
    refreshRole()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  return (
    <BrowserRouter>
      {user ? (
        <AuthenticatedApp
          user={user}
          onLogout={() => setUser(null)}
          onPromoted={refreshRole}
          onUserUpdated={setUser}
        />
      ) : (
        <AuthScreen onAuthed={setUser} />
      )}
    </BrowserRouter>
  )
}

/** AuthenticatedApp renders the sidebar + routed views for a signed-in user. */
function AuthenticatedApp({
  user,
  onLogout,
  onPromoted,
  onUserUpdated,
}: {
  user: AuthUser
  onLogout: () => void
  onPromoted: () => void
  onUserUpdated: (user: AuthUser) => void
}) {
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()
  const [courses, setCourses] = useState<Course[]>([])

  const refreshCourses = async () => {
    try {
      setCourses(await api.listCourses())
    } catch {
      /* backend may be down during local dev */
    }
  }

  useEffect(() => {
    void refreshCourses()
  }, [user.id])

  return (
    <div className="flex h-full">
      {/* ---- Sidebar ---- */}
      <aside className="w-64 shrink-0 p-4 hidden md:flex flex-col gap-3">
        <div className="flex items-center gap-2.5 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
            <GraduationCap size={20} />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">ClassO</h1>
            <p className="text-[11px] text-[var(--text-secondary)]">Academic Collaboration</p>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          <SidebarItem
            icon={<BookOpen size={18} />}
            label="My Courses"
            active={location.pathname === '/courses'}
            onClick={() => navigate('/courses')}
          />
          {courses.map((c) => (
            <SidebarItem
              key={c.id}
              icon={<Users size={18} />}
              label={c.name}
              active={location.pathname === `/courses/${c.id}`}
              onClick={() => navigate(`/courses/${c.id}`)}
            />
          ))}
        </nav>

        <div className="mt-auto space-y-2">
          <UserMenu user={user} onLogout={onLogout} onPromoted={onPromoted} onUserUpdated={onUserUpdated} />
          <button
            onClick={toggle}
            className="btn-ghost inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-sm"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>

      {/* ---- Main content ---- */}
      <main className="flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-6xl">
          <Routes>
            <Route path="/" element={<Navigate to="/courses" replace />} />
            <Route path="/courses" element={<CourseList onCreated={refreshCourses} isInstructor={user.role === 'instructor'} />} />
            <Route path="/courses/:courseId" element={<CourseDetail />} />
            <Route
              path="/courses/:courseId/groups/:groupId"
              element={<GroupWorkspace />}
            />
            <Route path="*" element={<Navigate to="/courses" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

/** SidebarItem renders a single navigation entry with an active state. */
function SidebarItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
        active
          ? 'bg-[var(--accent)] text-white font-semibold'
          : 'text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text)]'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}