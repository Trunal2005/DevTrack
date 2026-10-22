import React from 'react';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { useResumeScan } from './useResumeScan';

const SCAN_STAGES = [
  'Uploading Document...',
  'Parsing Document Structure...',
  'Extracting Engineering Signals...',
  'Running ATS Simulation...',
  'Analyzing Recruiter Readability...',
  'Generating Semantic Alignment...',
  'Building Credibility Graph...',
  'Finalizing Intelligence Report...'
];

interface ATSScanTransitionProps {
  sessionId: string;
  onComplete: () => void;
}

export const ATSScanTransition: React.FC<ATSScanTransitionProps> = ({ sessionId, onComplete }) => {
  const { currentStageIdx, errorMsg, retry } = useResumeScan(sessionId, onComplete);

  if (errorMsg) {
    return (
      <div className="w-full max-w-lg mx-auto flex flex-col gap-6">
        <div className="text-center animate-fade-in">
          <h1 className="text-2xl font-black text-rose-500 tracking-tight">Intelligence Failure</h1>
          <p className="text-slate-400 mt-2 font-medium">The analysis could not be completed.</p>
        </div>
        <div role="alert" className="bg-slate-900 border border-rose-950/50 rounded-2xl p-6 font-mono text-rose-200 text-sm shadow-2xl shadow-rose-950/20">
          <p className="font-bold text-rose-400 uppercase tracking-widest text-[10px]">Error Trace</p>
          <p className="mt-2 text-slate-300 font-medium leading-relaxed">{errorMsg}</p>
        </div>
        <button type="button" onClick={retry} className="dt-btn dt-btn-primary dt-btn-md self-center">
          Check status again
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-black text-slate-100 tracking-tight">Processing Intelligence</h1>
        <p className="text-slate-400 mt-2 font-medium">Running deep pipeline extraction.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 font-mono shadow-2xl">
        <div className="flex flex-col gap-3">
          {SCAN_STAGES.map((stage, idx) => {
            const isCompleted = idx < currentStageIdx;
            const isCurrent = idx === currentStageIdx;
            const isUpcoming = idx > currentStageIdx;

            return (
              <motion.div
                key={stage}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: isUpcoming ? 0.3 : 1, x: 0 }}
                className={`flex items-center gap-3 text-[12px] uppercase tracking-wider ${
                  isCurrent ? 'text-[#8B5CF6] font-bold' : isCompleted ? 'text-emerald-500' : 'text-slate-600'
                }`}
              >
                {isCompleted ? (
                  <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                ) : isCurrent ? (
                  <Loader2 size={16} className="animate-spin shrink-0 text-[#8B5CF6]" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-slate-700 shrink-0" />
                )}
                <span>{stage}</span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
