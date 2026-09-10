import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { getSubjectsForStandard } from '../../constants/olympiadSubjects';

const standards = Array.from({ length: 10 }, (_, i) => i + 1);

const levelLabel = (std: number) => {
  if (std <= 4) return 'Primary';
  if (std <= 7) return 'Middle School';
  return 'Secondary School';
};

const subjects = (std: number) => getSubjectsForStandard(std);

const gradientColors = [
  'from-[#FF8FA3] to-[#FF6B8B]', 'from-[#FFC24B] to-[#F59E0B]', 'from-[#F59E0B] to-[#10B981]',
  'from-[#4ADE9A] to-[#10B981]', 'from-[#5AC8FA] to-[#0284C7]', 'from-[#6C63F2] to-[#5A52E0]',
  'from-[#8B82FF] to-[#6C63F2]', 'from-[#B69CF2] to-[#8B82FF]', 'from-[#FF8FA3] to-[#B69CF2]',
  'from-[#6C63F2] to-[#FF8FA3]',
];

const StandardSelectionPage: React.FC = () => {
  const { user, updateStandard } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) navigate('/login');
    if (user && user.role !== 'student') navigate('/');
  }, [user, navigate]);

  const handleSelect = async (std: number) => {
    try {
      await updateStandard(std);
      toast.success(`Standard ${std} selected!`);
      navigate('/student');
    } catch {
      toast.error('Failed to update standard.');
    }
  };

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-6 relative overflow-hidden transition-colors">
      {/* Soft background pastel blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-20 left-10 w-96 h-96 bg-[#6C63F2]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-[#FF8FA3]/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-4xl">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-surface border border-border-subtle rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-soft">
            <span className="text-3xl">🎓</span>
          </div>
          <h1 className="font-heading font-black text-3xl md:text-4xl text-text-primary mb-3">
            Choose Your <span className="text-gradient">Standard</span>
          </h1>
          <p className="text-text-secondary text-base md:text-lg">
            {user?.currentStandard
              ? `Currently: Standard ${user.currentStandard}. You can change anytime.`
              : 'Select your class to see personalized content.'
            }
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {standards.map((std) => {
            const isSelected = user?.currentStandard === std;
            return (
              <button
                key={std}
                onClick={() => handleSelect(std)}
                className={`relative p-5 rounded-2xl border-2 transition-all duration-300 hover:-translate-y-1 group text-left ${
                  isSelected
                    ? 'border-brand-primary bg-brand-primary/5 shadow-soft'
                    : 'border-border-subtle bg-surface hover:border-brand-primary/40 hover:bg-surface-alt shadow-soft hover:shadow-soft-hover'
                }`}
              >
                {isSelected && (
                  <div className="absolute top-3 right-3 w-5 h-5 bg-brand-primary rounded-full flex items-center justify-center shadow-xs">
                    <span className="text-white text-xs font-bold">✓</span>
                  </div>
                )}

                <div className={`w-14 h-14 bg-gradient-to-br ${gradientColors[std - 1]} rounded-2xl flex items-center justify-center
                  text-white font-heading font-black text-2xl mx-auto mb-3 group-hover:scale-105 transition-transform shadow-md`}>
                  {std}
                </div>

                <p className="text-text-primary font-heading font-semibold text-center text-sm mb-0.5">Standard {std}</p>
                <p className="text-text-muted text-xs text-center mb-3 font-medium">{levelLabel(std)}</p>
                <div className="flex flex-wrap gap-1 justify-center">
                  {subjects(std).slice(0, 2).map(s => (
                    <span key={s} className="text-[11px] bg-surface-alt border border-border-subtle text-text-secondary px-1.5 py-0.5 rounded-md font-medium">
                      {s}
                    </span>
                  ))}
                  {subjects(std).length > 2 && (
                    <span className="text-[11px] bg-surface-alt border border-border-subtle text-text-muted px-1.5 py-0.5 rounded-md font-medium">
                      +{subjects(std).length - 2}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-center text-text-muted text-xs mt-8">
          You can change your standard anytime from your profile settings.
        </p>
      </div>
    </div>
  );
};

export default StandardSelectionPage;

