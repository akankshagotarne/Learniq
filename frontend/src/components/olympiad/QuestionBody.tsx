/**
 * The body of one Olympiad question: English text, the Marathi wording (Standards 1-3 are bilingual), the picture drawn with emoji,
 * and the diagram image. Shared by the exam page and the result review so both show a question the same way.
 * The Marathi line uses a Devanagari-capable font stack and lang="mr"; nothing here ever receives or shows an answer key.
 */
export const DEVANAGARI_FONT = "'Noto Sans Devanagari','Mangal','Nirmala UI','Kohinoor Devanagari',system-ui,sans-serif";

interface Props {
  number: number;
  text: string;
  textMr?: string;
  visual?: string;
  image?: string;
  size?: 'lg' | 'md';
}

export default function QuestionBody({ number, text, textMr, visual, image, size = 'lg' }: Props) {
  const main = size === 'lg' ? 'text-base sm:text-lg' : 'text-sm sm:text-base';
  return (
    <>
      <p className={`${main} text-text-primary font-medium leading-relaxed whitespace-pre-wrap break-words`} data-testid="question-text">{text}</p>
      {textMr && (
        <p lang="mr" style={{ fontFamily: DEVANAGARI_FONT }} className={`${main} mt-1.5 text-text-secondary leading-relaxed whitespace-pre-wrap break-words`} data-testid="question-text-mr">{textMr}</p>
      )}
      {visual && (
        <div
          className="mt-3 self-start max-w-full overflow-x-auto rounded-xl border border-border-subtle bg-surface-alt px-4 py-3 text-2xl sm:text-3xl leading-snug whitespace-pre-wrap break-words"
          role="img" aria-label={`Picture for question ${number}: ${visual.replace(/\s+/g, ' ').trim()}`} data-testid="question-visual"
        >
          {visual}
        </div>
      )}
      {image && (
        <img src={image} alt={`Diagram for question ${number}`} loading="lazy" className="mt-4 max-w-full max-h-72 rounded-xl border border-border-subtle object-contain self-start bg-white" />
      )}
    </>
  );
}
