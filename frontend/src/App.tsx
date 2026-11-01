// App shell: auth gate + React Router. Real URL paths (/courses/:id,
// /courses/:id/groups/:groupId) keep the view stable across refreshes.
import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useLocation } from 'react-router-dom'
import { GraduationCap, Moon, Sun, BookOpen, Users, PanelLeft } from 'lucide-react'
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
  const location = useLocation()
  const [courses, setCourses] = useState<Course[]>([])
  // Sidebar: `collapsed` is the desktop expanded/collapsed state; `mobileOpen`
  // is the off-canvas drawer state for small screens.
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

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

  // Close the mobile drawer on any route change.
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const closeMobile = () => setMobileOpen(false)

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* ---- Mobile backdrop overlay ---- */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-md transition-opacity md:hidden"
          onClick={closeMobile}
          aria-hidden
        />
      )}

      {/* ---- Sidebar ---- */}
      <aside
        className={`${
          mobileOpen
            ? 'fixed inset-y-0 left-0 z-50 w-72 border-r border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col gap-3'
            : 'hidden md:flex flex-col gap-3 p-4'
        } ${collapsed && !mobileOpen ? 'md:w-16' : ''} ${
          !collapsed && !mobileOpen ? 'md:w-64' : ''
        } shrink-0 transition-[width] duration-200`}
      >
        <div className={`flex items-center gap-2.5 px-2 py-3 ${collapsed && !mobileOpen ? 'md:justify-center' : ''}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
            <GraduationCap size={20} />
          </div>
          <div className={`${collapsed && !mobileOpen ? 'md:hidden' : ''}`}>
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
            collapsed={collapsed && !mobileOpen}
          />
          {courses.map((c) => (
            <SidebarItem
              key={c.id}
              icon={<Users size={18} />}
              label={c.name}
              active={location.pathname === `/courses/${c.id}`}
              onClick={() => navigate(`/courses/${c.id}`)}
              collapsed={collapsed && !mobileOpen}
            />
          ))}
        </nav>

        <div className="mt-auto space-y-2">
          <div className={`${collapsed && !mobileOpen ? 'md:hidden' : ''}`}>
            <UserMenu user={user} onLogout={onLogout} onPromoted={onPromoted} onUserUpdated={onUserUpdated} />
          </div>
          <button
            onClick={toggle}
            className={`btn-ghost inline-flex w-full items-center justify-center gap-2.5 px-3 py-2 text-sm shrink-0 whitespace-nowrap ${
              collapsed && !mobileOpen ? 'md:px-0' : ''
            }`}
            aria-label="Toggle theme"
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <Sun size={20} className="shrink-0" /> : <Moon size={20} className="shrink-0" />}
            <span className={`${collapsed && !mobileOpen ? 'md:hidden' : ''}`}>
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </span>
          </button>
        </div>
      </aside>

      {/* ---- Main column: top bar + content ---- */}
      <div className="flex flex-1 min-w-0 flex-col">
        {/* Top bar with the sidebar toggle */}
        <header className="flex items-center gap-3 px-4 py-3 md:px-8">
          <button
            onClick={() => setMobileOpen(true)}
            className="btn-ghost p-2 md:hidden"
            aria-label="Open navigation"
            title="Open navigation"
          >
            <PanelLeft size={20} />
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="btn-ghost hidden p-2 md:inline-flex"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <PanelLeft size={20} />
          </button>
        </header>

        {/* ---- Main content ---- */}
        <main className="flex-1 overflow-auto p-4 md:p-8 md:pt-0">
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
    </div>
  )
}

/** SidebarItem renders a single navigation entry with an active state. */
function SidebarItem({
  icon,
  label,
  active,
  onClick,
  collapsed,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
  collapsed?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
        collapsed ? 'md:justify-center md:px-0' : ''
      } ${
        active
          ? 'bg-[var(--accent)] text-white font-semibold'
          : 'text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text)]'
      }`}
    >
      {icon}
      <span className={`truncate ${collapsed ? 'md:hidden' : ''}`}>{label}</span>
    </button>
  )
}