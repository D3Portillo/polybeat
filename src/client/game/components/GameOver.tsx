type GameOverProps = {
  onRestart?: () => void;
};

export const GameOver = ({ onRestart }: GameOverProps) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur text-white">
      <div className="w-[min(92vw,520px)] text-black rounded-3xl border border-white/10 bg-white p-6 text-center shadow-[0_0_30px_rgba(255,255,255,0.08)] backdrop-blur">
        <div className="text-xs uppercase text-black/60">GAME OVER</div>
        <div className="mt-1 text-3xl font-bold">RUN STATS</div>

        <div className="mt-6 grid grid-cols-2 gap-3 text-left">
          <div className="rounded-2xl border border-black/10 bg-white/5 p-4">
            <div className="text-xs uppercase text-black/60">Score</div>
            <div className="mt-1 text-xl font-black">0 XP</div>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white/5 p-4">
            <div className="text-xs uppercase text-black/60">Duration</div>
            <div className="mt-1 text-xl font-black">0s</div>
          </div>
        </div>

        <button
          className="mt-8 w-full cursor-pointer rounded-full bg-black text-white py-4 text-sm font-bold uppercase"
          onClick={onRestart}
        >
          BACK TO LOBBY
        </button>
      </div>
    </div>
  );
};
