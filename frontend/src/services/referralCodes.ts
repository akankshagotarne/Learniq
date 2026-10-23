import api from './api';

/** The single optional Referral Code field: the server says whether the code is a mentor code or a student code (or neither). Nothing is granted by validating. */
export interface CodeCheck { valid: boolean; type?: 'mentor' | 'student'; message?: string; reason?: string }
export const referralCodeApi = {
  // a failed request REJECTS (network / 5xx) so the form can say "unable to validate" instead of "not found"
  validate: async (code: string): Promise<CodeCheck> => {
    const d = (await api.get('/referral-codes/validate', { params: { code } })).data;
    if (!d || typeof d.valid !== 'boolean') throw new Error('Malformed response');
    return d;
  },
};
