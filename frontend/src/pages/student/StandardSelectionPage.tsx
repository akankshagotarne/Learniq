import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

const standards = Array.from({ length: 10 }, (_, i) => i + 1);

const levelLabel = (std: number) => {
  if (std <= 4) return 'Primary';
  if (std <= 7) return 'Middle School';
  return 'Secondary School';
};

const subjects = (std: number) => {
  if (std <= 4) return ['Maths', 'English', 'EVS', 'Marathi'];
  return ['Maths', 'Science', 'English', 'Social Science', 'Marathi'];
};

const gradientColors = [
  'from-pink-500 to-rose-600', 'from-orange-500 to-amber-600', 'from-yellow-500 to-lime-600',
  'from-green-500 to-emerald-600', 'from-teal-500 to-cyan-600', 'from-blue-500 to-sky-600',
  'from-indigo-500 to-violet-600', 'from-purple-500 to-fuchsia-600', 'from-rose-600 to-pink-600',
  'from-primary-500 to-secondary-500',
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
    <div className="min-h-screen bg-hero-gradient flex items-center justify-center p-6">
      <div className="absolute inset-0">
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary-500/15 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-72 h-72 bg-secondary-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-4xl">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-gradient-to-br from-primary-500 to-secondary-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary-500/30">
            <span className="text-3xl">🎓</span>
          </div>
          <h1 className="font-display font-black text-4xl text-white mb-3">
            Choose Your <span className="gradient-text">Standard</span>
          </h1>
          <p className="text-white/50 text-lg">
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
                className={`relative p-5 rounded-2xl border-2 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl group
                  ${isSelected
                    ? 'border-primary-500 bg-primary-500/20 shadow-lg shadow-primary-500/30'
                    : 'border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10'
                  }`}
              >
                {isSelected && (
                  <div className="absolute top-2 right-2 w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-xs">✓</span>
                  </div>
                )}

                <div className={`w-14 h-14 bg-gradient-to-br ${gradientColors[std - 1]} rounded-2xl flex items-center justify-center
                  text-white font-display font-black text-2xl mx-auto mb-3 group-hover:scale-110 transition-transform shadow-lg`}>
                  {std}
                </div>

                <p className="text-white font-semibold text-center mb-1">Standard {std}</p>
                <p className="text-white/40 text-xs text-center mb-2">{levelLabel(std)}</p>
                <div className="flex flex-wrap gap-1 justify-center">
                  {subjects(std).slice(0, 2).map(s => (
                    <span key={s} className="text-xs bg-white/10 text-white/50 px-1.5 py-0.5 rounded">{s}</span>
                  ))}
                  {subjects(std).length > 2 && (
                    <span className="text-xs bg-white/10 text-white/30 px-1.5 py-0.5 rounded">+{subjects(std).length - 2}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <p className="text-center text-white/30 text-sm mt-8">
          You can change your standard anytime from your profile settings.
        </p>
      </div>
    </div>
  );
};

export default StandardSelectionPage;
