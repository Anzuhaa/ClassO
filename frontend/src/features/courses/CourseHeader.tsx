// CourseHeader: the course detail header — back button, title/meta, live
// join-code badge, and (for instructors) the controls incl. the group lock.
import { ArrowLeft } from 'lucide-react'
import type { Course } from '../../types'
import { InstructorControls, joinCodeActive } from './InstructorControls'

export function CourseHeader({
  course,
  groupCount,
  memberCount,
  isInstructor,
  assigning,
  assignCapacity,
  onBack,
  onAssignCapacity,
  onRandomAssign,
  onRegenerate,
  onExpire,
  onCreateGroups,
  onToggleLock,
}: {
  course: Course | null
  groupCount: number
  memberCount: number
  isInstructor: boolean
  assigning: boolean
  assignCapacity: number
  onBack: () => void
  onAssignCapacity: (n: number) => void
  onRandomAssign: () => void
  onRegenerate: () => void
  onExpire: () => void
  onCreateGroups: (name: string, capacity: number, count: number) => void
  onToggleLock: () => void
}) {
  return (
    <header className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="btn-ghost p-2" aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="text-2xl font-bold">{course?.name ?? 'Course'}</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            {course
              ? `${course.code ? course.code + ' · ' : ''}${groupCount} groups · ${memberCount} members`
              : 'Loading…'}
          </p>
          {course && (
            <span
              className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                joinCodeActive(course)
                  ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                  : 'bg-red-500/15 text-red-600 dark:text-red-400'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${joinCodeActive(course) ? 'bg-green-500' : 'bg-red-500'}`} />
              Join code {joinCodeActive(course) ? 'Active' : 'Expired'}
            </span>
          )}
        </div>
      </div>

      {course && isInstructor && (
        <InstructorControls
          course={course}
          assigning={assigning}
          assignCapacity={assignCapacity}
          onAssignCapacity={onAssignCapacity}
          onRandomAssign={onRandomAssign}
          onRegenerate={onRegenerate}
          onExpire={onExpire}
          onCreateGroups={onCreateGroups}
          onToggleLock={onToggleLock}
        />
      )}
    </header>
  )
}