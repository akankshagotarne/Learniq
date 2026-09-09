/**
 * Course and Teacher Image Utilities
 * Maps courses and subjects directly to official teacher portrait photos.
 */

export const TEACHER_PHOTOS: Record<string, string> = {
  'sunita sharma': '/assets/teachers/sunita-sharma.jpg',
  'rohit gupta': '/assets/teachers/rohit-gupta.jpg',
  'aisha khan': '/assets/teachers/aisha-khan.jpg',
  'priya patel': '/assets/teachers/priya-patel.jpg',
  'ravi singh': '/assets/teachers/ravi-singh.jpg',
  'fatima shaikh': '/assets/teachers/fatima-shaikh.jpg',
  'michael desilva': '/assets/teachers/michael-desilva.jpg',
};

export const DEFAULT_TEACHER_PHOTO = '/assets/teachers/rohit-gupta.jpg';

/**
 * Returns the assigned teacher photo based on subject or title keywords.
 */
export function getTeacherPhotoBySubject(subject?: string): string {
  if (!subject) return DEFAULT_TEACHER_PHOTO;
  const s = subject.toLowerCase().trim();

  // Mathematics / Algebra / Geometry -> Rohit Gupta
  if (s.includes('math') || s.includes('algebra') || s.includes('geometry') || s.includes('arithmetic') || s.includes('number')) {
    return '/assets/teachers/rohit-gupta.jpg';
  }

  // English -> Aisha Khan
  if (s.includes('english') || s.includes('literature') || s.includes('grammar')) {
    return '/assets/teachers/aisha-khan.jpg';
  }

  // Science / EVS / Physics / Chemistry / Biology -> Priya Patel
  if (
    s.includes('science') ||
    s.includes('environmental') ||
    s.includes('evs') ||
    s.includes('physics') ||
    s.includes('chemistry') ||
    s.includes('biology')
  ) {
    return '/assets/teachers/priya-patel.jpg';
  }

  // Marathi -> Sunita Sharma
  if (s.includes('marathi') || s.includes('balbharati') || s.includes('sulabhbharati')) {
    return '/assets/teachers/sunita-sharma.jpg';
  }

  // Hindi -> Ravi Singh
  if (s.includes('hindi') || s.includes('lokbharati')) {
    return '/assets/teachers/ravi-singh.jpg';
  }

  // Geography -> Michael Desilva
  if (s.includes('geography')) {
    return '/assets/teachers/michael-desilva.jpg';
  }

  // History / Civics / Social Sciences / Political Science -> Fatima Shaikh
  if (
    s.includes('history') ||
    s.includes('civic') ||
    s.includes('social') ||
    s.includes('political')
  ) {
    return '/assets/teachers/fatima-shaikh.jpg';
  }

  return DEFAULT_TEACHER_PHOTO;
}

/**
 * Returns teacher photo based on teacher name or teacher object.
 */
export function getTeacherPhoto(teacher?: any, subject?: string): string {
  if (!teacher) return getTeacherPhotoBySubject(subject);

  if (typeof teacher === 'object') {
    if (teacher.avatar && typeof teacher.avatar === 'string' && teacher.avatar.startsWith('/assets/teachers/')) {
      return teacher.avatar;
    }
    if (teacher.name) {
      const nameKey = teacher.name.toLowerCase().trim();
      for (const [tName, photo] of Object.entries(TEACHER_PHOTOS)) {
        if (nameKey.includes(tName)) return photo;
      }
    }
  } else if (typeof teacher === 'string') {
    const nameKey = teacher.toLowerCase().trim();
    for (const [tName, photo] of Object.entries(TEACHER_PHOTOS)) {
      if (nameKey.includes(tName)) return photo;
    }
  }

  return getTeacherPhotoBySubject(subject);
}

/**
 * Returns the proper thumbnail for a course.
 * Ensures that teacher photo is displayed rather than any placeholder or fake images.
 */
export function getCourseThumbnail(course?: any): string {
  if (!course) return DEFAULT_TEACHER_PHOTO;

  // If course has a valid teacher thumbnail, return it
  if (course.thumbnail && typeof course.thumbnail === 'string') {
    if (course.thumbnail.startsWith('/assets/teachers/')) {
      return course.thumbnail;
    }
    // Reject picsum or generic placeholders
    if (!course.thumbnail.includes('picsum.photos') && !course.thumbnail.includes('placeholder')) {
      return course.thumbnail;
    }
  }

  // Check teacher object
  if (course.teacher) {
    const photo = getTeacherPhoto(course.teacher, course.subject);
    if (photo && photo !== DEFAULT_TEACHER_PHOTO) return photo;
  }

  // Derive by subject
  if (course.subject) {
    return getTeacherPhotoBySubject(course.subject);
  }

  // Derive by title
  if (course.title) {
    return getTeacherPhotoBySubject(course.title);
  }

  return DEFAULT_TEACHER_PHOTO;
}
