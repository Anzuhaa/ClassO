// App shell: sidebar navigation, theme toggle, and the active workspace view.
// Routing is a lightweight in-memory view switch (no router dependency).
import { useCallback, useEffect, useState } from 'react'
import { GraduationCap, Moon, Sun, BookOpen, Users } from 'lucide-react'
import { useTheme } from './lib/theme'
import { api } from './lib/api'
import type { Course } from './types'
import { CourseList } from './features/courses/CourseList'
import { CourseDetail } from './features/courses/CourseDetail'
import { GroupWorkspace } from './features/groups/GroupWorkspace'

type View =
  | { name: 'courses' }
  | { name: 'course'; courseId: string }
  | { name: 'group'; groupId: string; courseId: string }

export default function App() {
  const { theme, toggle } = useTheme()
  const [view, setView] = useState<View>({ name: 'courses' })
  const [courses, setCourses] = useState<Course[]>([])

  // Load courses on mount for the sidebar.
  const refreshCourses = useCallback(async () => {
    try {
      setCourses(await api.listCourses())
    } catch {
      /* backend may be down during local dev; keep UI usable */
    }
  }, [])

  useEffect(() => {
    void refreshCourses()
  }, [refreshCourses])

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
            active={view.name === 'courses'}
            onClick={() => setView({ name: 'courses' })}
          />
          {courses.map((c) => (
            <SidebarItem
              key={c.id}
              icon={<Users size={18} />}
              label={c.name}
              active={view.name === 'course' && view.courseId === c.id}
              onClick={() => setView({ name: 'course', courseId: c.id })}
            />
          ))}
        </nav>

        <div className="mt-auto">
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
          {view.name === 'courses' && (
            <CourseList onOpen={(courseId) => setView({ name: 'course', courseId })} onCreated={refreshCourses} />
          )}
          {view.name === 'course' && (
            <CourseDetail
              courseId={view.courseId}
              onBack={() => setView({ name: 'courses' })}
              onOpenGroup={(groupId) => setView({ name: 'group', groupId, courseId: view.courseId })}
            />
          )}
          {view.name === 'group' && (
            <GroupWorkspace groupId={view.groupId} onBack={() => setView({ name: 'course', courseId: view.courseId })} />
          )}
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