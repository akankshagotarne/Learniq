/**
 * Site-wide feature switches.
 *
 * COURSES_ENABLED — the Std 1–10 courses were removed from LearnIQ (October 2026). While this is `false`, every course
 * screen is hidden: the public Courses pages and links, the home-page course sections, the course search box, the
 * student "My Courses" / dashboard course cards, the teacher "My Courses" page and the admin "Courses" page.
 * Course URLs redirect to a safe page instead of showing an empty list.
 * Set it back to `true` (and redeploy) to bring the whole feature back — no other code needs to change.
 */
export const COURSES_ENABLED = false;
