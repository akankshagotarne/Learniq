import React, { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { User } from '../../types';
import { avatarSrc } from '../../utils/avatar';
import { resizeToSquareJpeg, validatePickedPhoto } from '../../utils/resizeImage';
import { apiError } from '../../services/profileService';

/**
 * Photo picker shared by the self-service pages and the admin edit dialog.
 * Validates the file, shows a preview, shrinks it in the browser, uploads with a progress bar, and can remove the photo
 * (back to the default initials avatar). `upload` / `remove` return the updated user so the caller can refresh its state.
 */
const PhotoEditor: React.FC<{
  name: string; avatar?: string | null; size?: number;
  upload: (blob: Blob, onProgress: (pct: number) => void) => Promise<User>;
  remove: () => Promise<User>;
  onChanged: (user: User) => void;
}> = ({ name, avatar, size = 96, upload, remove, onChanged }) => {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = async (file?: File) => {
    if (!file) return;
    const problem = validatePickedPhoto(file);
    if (problem) { toast.error(problem); return; }
    setPreview(URL.createObjectURL(file));
    setBusy(true); setProgress(0);
    try {
      const blob = await resizeToSquareJpeg(file);
      const user = await upload(blob, setProgress);
      onChanged(user);
      toast.success('Profile photo updated.');
    } catch (e: any) {
      toast.error(e?.message && !e?.response ? e.message : apiError(e, 'The photo could not be uploaded.').message);
    } finally { setBusy(false); setProgress(null); setPreview(null); if (input.current) input.current.value = ''; }
  };

  const drop = async () => {
    setBusy(true);
    try { const user = await remove(); onChanged(user); toast.success('Profile photo removed.'); }
    catch (e) { toast.error(apiError(e, 'The photo could not be removed.').message); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-4">
      <div className="relative flex-shrink-0">
        <img src={preview || avatarSrc(name, avatar, size)} alt={`${name} profile`} style={{ width: size, height: size }} className={`rounded-full object-cover ${busy ? 'opacity-60' : ''}`} />
        {busy && <Loader2 className="absolute inset-0 m-auto h-6 w-6 animate-spin text-brand-primary" aria-hidden="true" />}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface-alt disabled:opacity-60">
            <Camera className="h-4 w-4" aria-hidden="true" /> {avatar ? 'Change photo' : 'Upload photo'}
          </button>
          {avatar && (
            <button type="button" disabled={busy} onClick={drop} className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-xs font-semibold text-[#E1447A] hover:bg-surface-alt disabled:opacity-60">
              <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
            </button>
          )}
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Choose a profile photo" onChange={(e) => pick(e.target.files?.[0])} />
        {progress !== null ? (
          <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-surface-alt" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-brand-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        ) : <p className="mt-1.5 text-[11px] text-text-muted">JPEG, PNG or WebP. It is resized automatically.</p>}
      </div>
    </div>
  );
};

export default PhotoEditor;
