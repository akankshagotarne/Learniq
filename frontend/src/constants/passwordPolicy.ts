/** The ONE password rule (must equal backend/src/services/passwordPolicy.js - a backend test checks this number). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_HELP = `Create a password with at least ${PASSWORD_MIN_LENGTH} characters.`;
export const passwordProblem = (password: string): string => (password.length >= PASSWORD_MIN_LENGTH ? '' : PASSWORD_HELP);
