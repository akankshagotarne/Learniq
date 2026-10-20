/** "Who can join this meeting?" - pure client rules (what the selector shows, validates and summarises). The server re-validates everything. */
export type StudentMode = 'none' | 'all' | 'standard' | 'standards' | 'students';
export type TeacherMode = 'none' | 'all' | 'selected';
export interface Audience {
  students: { mode: StudentMode; standards: number[]; studentIds: string[] };
  teachers: { mode: TeacherMode; teacherIds: string[] };
  updatedAt?: string; updatedBy?: string; createdAt?: string; createdBy?: string;
}
/** the seven choices the host sees (the last one reveals separate student and teacher controls) */
export type AudienceChoice = 'all_students' | 'one_standard' | 'multi_standards' | 'students' | 'all_teachers' | 'selected_teachers' | 'both';

export const STANDARD_OTHERS = 99;
export const DEFAULT_AUDIENCE: Audience = { students: { mode: 'all', standards: [], studentIds: [] }, teachers: { mode: 'none', teacherIds: [] } };

export const CHOICES: { value: AudienceChoice; label: string; hint: string }[] = [
  { value: 'all_students', label: 'All students — all standards', hint: 'Students from every supported standard can join this meeting.' },
  { value: 'one_standard', label: 'One specific standard', hint: 'Only students from the selected standard can join.' },
  { value: 'multi_standards', label: 'Multiple selected standards', hint: 'Choose exactly which standards can participate.' },
  { value: 'students', label: 'Selected individual students', hint: 'Invite individual students regardless of their standard.' },
  { value: 'all_teachers', label: 'All eligible teachers', hint: 'All approved, active teacher accounts can join the meeting.' },
  { value: 'selected_teachers', label: 'Selected teachers', hint: 'Choose which eligible teachers may join this meeting.' },
  { value: 'both', label: 'Students and teachers', hint: 'Choose the student audience and the teacher audience separately.' },
];

export const clone = (a: Audience): Audience => ({ ...a, students: { ...a.students, standards: [...a.students.standards], studentIds: [...a.students.studentIds] }, teachers: { ...a.teachers, teacherIds: [...a.teachers.teacherIds] } });

export const choiceOf = (a: Audience): AudienceChoice => {
  const s = a.students.mode; const t = a.teachers.mode;
  if (s !== 'none' && t !== 'none') return 'both';
  if (t === 'all') return 'all_teachers';
  if (t === 'selected') return 'selected_teachers';
  if (s === 'standard') return 'one_standard';
  if (s === 'standards') return 'multi_standards';
  if (s === 'students') return 'students';
  return 'all_students';
};

/** Selections the host already made are kept while they switch between choices; only the chosen mode is saved. */
export interface Selections { standards: number[]; studentIds: string[]; teacherIds: string[] }
export const audienceFor = (choice: AudienceChoice, sel: Selections, previous?: Audience): Audience => {
  const st = (mode: StudentMode) => ({ mode, standards: mode === 'standard' ? sel.standards.slice(0, 1) : mode === 'standards' ? [...sel.standards] : [], studentIds: mode === 'students' ? [...sel.studentIds] : [] });
  const te = (mode: TeacherMode) => ({ mode, teacherIds: mode === 'selected' ? [...sel.teacherIds] : [] });
  const stamps = previous ? { updatedAt: previous.updatedAt, updatedBy: previous.updatedBy, createdAt: previous.createdAt, createdBy: previous.createdBy } : {};
  switch (choice) {
    case 'all_students': return { students: st('all'), teachers: te('none'), ...stamps };
    case 'one_standard': return { students: st('standard'), teachers: te('none'), ...stamps };
    case 'multi_standards': return { students: st('standards'), teachers: te('none'), ...stamps };
    case 'students': return { students: st('students'), teachers: te('none'), ...stamps };
    case 'all_teachers': return { students: st('none'), teachers: te('all'), ...stamps };
    case 'selected_teachers': return { students: st('none'), teachers: te('selected'), ...stamps };
    default: return { students: st('all'), teachers: te('all'), ...stamps };
  }
};

/** Message for the host when the audience cannot be saved, or null when it is fine. */
export const validateAudience = (a: Audience | undefined | null): string | null => {
  if (!a) return null; // an older class that keeps its original open behaviour
  const s = a.students; const t = a.teachers;
  if (s.mode === 'none' && t.mode === 'none') return 'Choose at least one group that can join this meeting.';
  if (s.mode === 'standard' && s.standards.length !== 1) return 'Select one standard.';
  if (s.mode === 'standards' && s.standards.length < 1) return 'Select at least one standard.';
  if (s.mode === 'students' && s.studentIds.length < 1) return 'Select at least one student.';
  if (t.mode === 'selected' && t.teacherIds.length < 1) return 'Select at least one teacher.';
  return null;
};

const joinList = (n: string[]) => (n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`);
export const describeStandards = (stds: number[]): string => {
  const nums = [...stds].filter((n) => n !== STANDARD_OTHERS).sort((x, y) => x - y).map(String);
  const parts: string[] = [];
  if (nums.length) parts.push(`${nums.length === 1 ? 'Standard' : 'Standards'} ${joinList(nums)}`);
  if (stds.includes(STANDARD_OTHERS)) parts.push('Others');
  return parts.join(' and ');
};
export const standardName = (v: number) => (v === STANDARD_OTHERS ? 'Others' : `Standard ${v}`);

/** The "Meeting access summary" lines, from the audience as it is right now (never hardcoded). */
export const summarizeAudience = (a: Audience | undefined | null): { students: string; teachers: string; access: string } => {
  if (!a) return { students: 'All signed-in students', teachers: 'All approved teachers', access: 'Authenticated eligible accounts only (older class: unchanged)' };
  const s = a.students; const t = a.teachers;
  const students = s.mode === 'none' ? 'No students' : s.mode === 'all' ? 'All students — all standards'
    : s.mode === 'students' ? `${s.studentIds.length} selected student${s.studentIds.length === 1 ? '' : 's'}` : (describeStandards(s.standards) || 'No standard chosen');
  const teachers = t.mode === 'none' ? 'No teachers' : t.mode === 'all' ? 'All eligible teachers' : `${t.teacherIds.length} selected teacher${t.teacherIds.length === 1 ? '' : 's'}`;
  return { students, teachers, access: 'Authenticated eligible accounts only' };
};

/** one short phrase for cards and lists: "Standards 8, 9 and 10 + 2 teachers" */
export const audienceLabel = (a: Audience | undefined | null): string => {
  if (!a) return 'Open to all signed-in students';
  const s = summarizeAudience(a);
  const parts: string[] = [];
  if (a.students.mode !== 'none') parts.push(a.students.mode === 'all' ? 'All students' : s.students);
  if (a.teachers.mode !== 'none') parts.push(a.teachers.mode === 'all' ? 'All teachers' : s.teachers);
  return parts.join(' + ');
};

/** toggle an id / number in a list without duplicates */
export const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
