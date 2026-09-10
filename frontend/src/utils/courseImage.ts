/**
 * Course and Teacher Image Utilities
 *
 * Uses a teacher's real uploaded photo/avatar when available, and falls
 * back to a generated initials avatar otherwise. There are no fixed
 * demo-teacher photos baked in here anymore — once a real teacher is
 * added with a photo, their card picks it up automatically.
 */

const uiAvatar = (label: string, background = '6C63F2') =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(label || '?')}&background=${background}&color=fff&size=128`;

/**
 * Returns a teacher's photo if they have one, otherwise a generated
 * initials avatar based on their name (or the subject, if no teacher
 * is assigned yet).
 */
export function getTeacherPhoto(teacher?: any, subject?: string): string {
  if (teacher && typeof teacher === 'object' && teacher.avatar) {
    return teacher.avatar;
  }
  if (teacher && typeof teacher === 'object' && teacher.name) {
    return uiAvatar(teacher.name);
  }
  if (typeof teacher === 'string' && teacher.trim()) {
    return uiAvatar(teacher);
  }
  return uiAvatar(subject || 'Teacher', 'B69CF2');
}

/**
 * Returns the thumbnail for a course: its own thumbnail if set, else
 * the assigned teacher's photo, else a subject-based placeholder.
 */
export function getCourseThumbnail(course?: any): string {
  if (!course) return uiAvatar('Course');

  if (course.thumbnail && typeof course.thumbnail === 'string') {
    return course.thumbnail;
  }

  if (course.teacher) {
    return getTeacherPhoto(course.teacher, course.subject);
  }

  return uiAvatar(course.subject || course.title || 'Course', 'B69CF2');
}
