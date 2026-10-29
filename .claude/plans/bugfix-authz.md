# Bug fixes: authorization, privacy, and role enforcement

Eight reported bugs trace to one root cause: the backend has **no course-membership
authorization layer**. Handlers read `middleware.UserID()` and trust it for every
endpoint, without verifying membership or role. A secondary cause is inconsistent
role handling (global `profiles.role` vs. per-course `course_members.role`).

## Decisions (confirmed by user)

- **Instructor** = the course `owner_id` OR having `course_members.role = 'instructor'`
  for that course (per-course authority, not global role).
- **Join by code** enrolls the user with their global `profiles.role`
  (instructor account → `instructor`, student account → `student`).
- **Create course** requires the global `profiles.role == 'instructor'`.

## Backend changes

### 1. Repository helpers (`course_repository.go`, `profile_repository.go`)

- `IsCourseInstructor(ctx, courseID, userID)` → true when `owner_id == userID` OR
  `GetCourseMemberRole == instructor`. (Composes existing `GetCourse`/`GetCourseMemberRole`.)
- `IsCourseMember(ctx, courseID, userID)` → true when owner OR `GetCourseMemberRole` succeeds.

### 2. `course_handler.go` — add authorization

- **`Get`**: 404 when course missing; **403 "forbidden"** when not owner/member.
- **`Create`**: load `profiles.role`; **403** when not `instructor`.
- **`Delete`**: **403** when `owner_id != userID` (instead of today's 404 "not owned").
- **`ListGroups`, `Members`, `MyGroup`**: **403** for non-members.
- **`RandomAssign`, `RegenerateJoinCode`, `ExpireJoinCode`, `AddMember`,
  `RemoveMember`**: **403** unless `IsCourseInstructor`.
- **`JoinByCode`**: enroll with the joiner's `profiles.role` (default `student`),
  not hardcoded `student`.

### 3. Group handlers (`group_member_handler.go`, `group_handler.go`)

- Guard **`Members`, `Messages`, `SendMessage`, `Tasks`, `CreateTask`,
  `UpdateTaskStatus`** with `IsGroupMember` already in repo (**403** if not).
- **`CreateGroup`** (via `CreateGroups`) and **`DeleteGroup`**, **`RemoveMember`**
  require `IsCourseInstructor`.
- **`Join`** already checks membership/capacity; leave as-is (adds no new gap).

### 4. File handler (`file_handler.go`)

- Guard **`Upload`, `List`, `URL`** with `IsGroupMember` (**403** if not).

## Frontend changes

### 5. `CourseList.tsx`

- Fetch `/profiles/me`; store `profile.role`.
- Only render **"New Course"** button when `profile.role === 'instructor'`.
- Only render the per-course **delete `Trash2`** button when the course is owned
  by the current user (`course.ownerId === userId`).

### 6. `RosterPanel.tsx` (bug #1 — icon confusion)

- Change member-remove icon from `LogOut` to `UserMinus` (distinct from course
  delete's `Trash2`), keep the red hover.

### 7. `CourseDetail.tsx` (bug #3 — "course not found" crash)

- `load()` already handles 403/404 via `getCourse` error with a clear message;
  render a friendly "You don't have access to this course (or it no longer exists)"
  state instead of a bare error when the course is null + error is set. No fatal
  navigation for a user with no courses.

## Verification

- `go build ./...` in `backend/` (handlers + repo changes compile).
- `npx tsc --noEmit` in `frontend/`.
- Manual flows can't run in this session (Bash classifier), so list them out for the
  user to smoke-test after applying: student can't create/delete; non-member 403s;
  instructor joins by code as instructor; delete icon vs. remove icon distinct.