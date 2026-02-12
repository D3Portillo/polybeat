import '../index.css';

import { requestExpandedMode, context, navigateTo } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

export const Splash = () => {
  return (
    <div className="p-6 flex min-h-screen items-center justify-center bg-black text-white">
      <div className="w-full max-w-md">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center justify-start gap-2">
            <button className="size-8 pt-1 rounded-full overflow-hidden bg-white grid place-items-center">
              <img
                className="w-full scale-110"
                src={
                  context?.snoovatar ||
                  'https://i.redd.it/snoovatar/avatars/977f6ca7-59e7-408c-a52c-d87a1f9faada.png'
                }
                alt=""
              />
            </button>

            <div className="text-xl font-bold tracking-tight">
              Can you beat my run?{' '}
              <button
                onClick={() =>
                  navigateTo(`https://www.reddit.com/user/${context?.username || 'me'}`)
                }
                className="text-pink-500 hover:underline underline-offset-4 cursor-pointer"
              >
                @{context?.username || 'snoo'}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-linear-to-tl inset-shadow-2xs inset-shadow-white/10 from-white/7 to-white/3 p-4">
              <div className="text-xs uppercase tracking-widest text-white/60">SCORE</div>
              <div className="mt-1 text-xl font-black">2420XP</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-linear-to-tl inset-shadow-2xs inset-shadow-white/10 from-white/7 to-white/3 p-4">
              <div className="text-xs uppercase tracking-widest text-white/60">DURATION</div>
              <div className="mt-1 text-xl font-black">30s</div>
            </div>
          </div>

          <section className="p-4">
            <div className="text-sm text-white/60">RUN SUMMARY</div>
            <div className="mt-2 grid grid-cols-3 gap-3 text-base font-semibold">
              <div data-item="square" className="rounded-xl flex justify-start items-center gap-2">
                <div className="size-4 bg-white rounded" />
                <span>2,242</span>
              </div>

              <div data-item="circle" className="rounded-xl flex justify-center items-center gap-2">
                <div className="size-4 bg-white rounded-full" />
                <span>32,422</span>
              </div>

              <div data-item="triangle" className="rounded-xl flex justify-end items-center gap-2">
                <div
                  className="size-4 bg-white"
                  style={{ clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }}
                />
                <span>245</span>
              </div>
            </div>
          </section>
        </div>

        <div className="mt-8 flex w-full flex-col gap-3">
          <button
            className="w-full cursor-pointer rounded-full bg-[#d93900] py-3 text-sm font-bold uppercase tracking-widest text-white transition-colors hover:bg-[#ff4f10]"
            onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
          >
            PLAY NOW
          </button>

          <button
            className="w-full cursor-pointer rounded-full bg-white py-3 text-sm font-bold uppercase tracking-widest text-black hover:underline underline-offset-4"
            onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
          >
            TOP SCORES
          </button>
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
