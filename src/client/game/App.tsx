import { useEffect, useRef, useState, type RefObject } from 'react';

type Shape = 'circle' | 'square' | 'triangle';
type Band = 'bass' | 'mid' | 'treble';

const getShapeFromBand = (band: Band): Shape => {
  if (band === 'bass') return 'circle';
  if (band === 'treble') return 'triangle';
  return 'square';
};

interface Note {
  id: number;
  shape: Shape;
  spawnTime: number;
  hitTime: number;
  travelTime: number;
  hit: boolean;
  missed: boolean;
  element?: HTMLElement | SVGElement | undefined;
}

interface GameState {
  notes: Note[];
  score: number;
  combo: number;
  activeShape: Shape;
  lastNoteId: number;
  lastSpawnTime: number;
  lastShapeChangeTime: number;
}

const HIT_WINDOW_MS = 250; // More lenient timing
const NOTE_SIZE = 60;
const EXPECTED_SHAPE_SIZE = 100; // Much larger hitbox area
const TRACK_WIDTH = 100;
const HIT_ZONE_OFFSET = 100;
const MIN_NOTE_SPACING = 40;
const TRAVEL_TIME = 2000;
const BPM = 120;
const TICK_INTERVAL = 60000 / BPM / 4; // 16th note intervals for more rhythmic spawning
const MIN_SILENCE_GAP = 250; // Minimum ms between notes
const ENERGY_THRESHOLD = 90; // Minimum energy to spawn
const SHAPE_LOCK_DURATION = 10_000; // Lock shape for 3 seconds
const AVAILABLE_BANDS: Band[] = ['bass', 'mid', 'treble'];
const CLEAR_ANIMATION_MS = 130;
const CLEAR_ANIMATION_JITTER_MS = 50;
const PEAK_MULTIPLIER = 1.05;
const PEAK_DELTA = 2;
const BAND_COOLDOWN_MS = 80;
const MAX_IDLE_MS = 500;

const getTravelTimeForBand = (band: Band): number => {
  if (band === 'bass') return TRAVEL_TIME * 1.15;
  if (band === 'treble') return TRAVEL_TIME * 0.85;
  return TRAVEL_TIME;
};

export const App = () => {
  const initialBand = AVAILABLE_BANDS[Math.floor(Math.random() * AVAILABLE_BANDS.length)] ?? 'bass';
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const stateRef = useRef<GameState>({
    notes: [],
    score: 0,
    combo: 0,
    activeShape: getShapeFromBand(initialBand),
    lastNoteId: 0,
    lastSpawnTime: -MIN_SILENCE_GAP,
    lastShapeChangeTime: 0,
  });
  const animationRef = useRef<number>(0);
  const lastTickTimeRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [activeShape, setActiveShape] = useState<Shape>(getShapeFromBand(initialBand));
  const [isSuccessFlash, setIsSuccessFlash] = useState(false);
  const [trackBand, setTrackBand] = useState<Band>(initialBand);
  const trackBandRef = useRef<Band>(initialBand);
  const expectedShapeRef = useRef<SVGSVGElement | HTMLDivElement | null>(null);
  const lastTapTimeRef = useRef(0);
  const [feedback, setFeedback] = useState<{
    id: number;
    type: 'hit' | 'miss';
    text: string;
  } | null>(null);
  const feedbackTimeoutRef = useRef<number | null>(null);
  const bandEnergyRef = useRef({
    bass: { avg: 0, last: 0, lastTrigger: 0 },
    mid: { avg: 0, last: 0, lastTrigger: 0 },
    treble: { avg: 0, last: 0, lastTrigger: 0 },
  });

  const setTrackBandMode = (band: Band) => {
    trackBandRef.current = band;
    setTrackBand(band);

    const nextShape = getShapeFromBand(band);
    const state = stateRef.current;
    state.activeShape = nextShape;
    setActiveShape(nextShape);

    if (expectedShapeRef.current) {
      expectedShapeRef.current.style.animation = 'none';
      setTimeout(() => {
        if (expectedShapeRef.current) {
          expectedShapeRef.current.style.animation = 'shapePulse 0.3s ease-out';
        }
      }, 10);
    }
  };

  const triggerFeedback = (type: 'hit' | 'miss', text: string) => {
    if (feedbackTimeoutRef.current) {
      window.clearTimeout(feedbackTimeoutRef.current);
    }
    setFeedback({
      id: Date.now(),
      type,
      text,
    });
    feedbackTimeoutRef.current = window.setTimeout(() => {
      setFeedback(null);
    }, 450);
  };

  const triggerMiss = () => {
    const missWords = ['Miss', 'Oops', 'Naah', 'Meh'] as const;
    const missWord = missWords[Math.floor(Math.random() * missWords.length)] ?? 'Miss';
    triggerFeedback('miss', missWord);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const setupAudio = async () => {
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaElementSource(audio);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyserRef.current = analyser;

      source.connect(analyser);
      analyser.connect(audioContext.destination);
    };

    const handlePlay = () => {
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
      setIsPlaying(true);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    setupAudio();

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audioContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!isPlaying || !audioRef.current || !analyserRef.current) return;

    const audio = audioRef.current;
    const analyser = analyserRef.current;
    const state = stateRef.current;
    const container = containerRef.current;
    if (!container) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const getBandEnergy = (type: Band): number => {
      analyser.getByteFrequencyData(dataArray);
      let slice: Uint8Array;

      if (type === 'bass') slice = dataArray.slice(0, 5);
      else if (type === 'mid') slice = dataArray.slice(5, 20);
      else slice = dataArray.slice(20, 40);

      return slice.reduce((a, b) => a + b, 0) / slice.length;
    };

    const getColorFromAudio = (): { h: number; s: number; l: number } => {
      analyser.getByteFrequencyData(dataArray);
      const mean = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

      const h = (mean / 255) * 360;
      const s = 70 + (mean / 255) * 30;
      const l = 50 + (mean / 255) * 20;

      return { h, s, l };
    };

    const getNotePosition = (note: Note, currentTime: number): number => {
      const elapsed = currentTime - note.spawnTime;
      const screenHeight = window.innerHeight;
      const hitCenterY = screenHeight - HIT_ZONE_OFFSET - EXPECTED_SHAPE_SIZE / 2;
      const offScreenCenterY = screenHeight + NOTE_SIZE + 100; // Full screen + note size + buffer

      const startTopY = -NOTE_SIZE - 20; // Start slightly above the screen
      const startCenterY = startTopY + NOTE_SIZE / 2;

      const totalDistance = offScreenCenterY - startCenterY;
      const hitDistance = hitCenterY - startCenterY;
      const hitProgress = Math.max(0.01, Math.min(0.99, hitDistance / totalDistance));
      const totalTravelTime = note.travelTime / hitProgress;

      if (elapsed <= 0) return startTopY;

      const progress = Math.min(1, elapsed / totalTravelTime);
      const centerY = startCenterY + progress * totalDistance;
      return centerY - NOTE_SIZE / 2;
    };

    const wouldOverlap = (
      newNoteTime: number,
      currentTime: number,
      travelTime: number
    ): boolean => {
      const newNoteY = getNotePosition(
        {
          id: 0,
          shape: 'circle',
          spawnTime: newNoteTime,
          hitTime: newNoteTime + travelTime,
          travelTime,
          hit: false,
          missed: false,
        },
        currentTime
      );

      for (const note of state.notes) {
        if (note.hit || note.missed) continue;
        const existingY = getNotePosition(note, currentTime);
        if (Math.abs(newNoteY - existingY) < MIN_NOTE_SPACING) {
          return true;
        }
      }
      return false;
    };

    const explodeAndClearActiveNotes = (currentTime: number) => {
      for (let i = state.notes.length - 1; i >= 0; i--) {
        const note = state.notes[i];
        if (!note) continue;
        if (note.hit || note.missed) continue;
        if (note.shape === state.activeShape) continue;
        if (!note.element) continue;

        const y = getNotePosition(note, currentTime);
        note.element.style.setProperty('--note-y', `${y}px`);
        const jitter = Math.floor(Math.random() * CLEAR_ANIMATION_JITTER_MS);
        const duration = CLEAR_ANIMATION_MS + jitter;
        note.element.animate(
          [
            {
              transform: `translateY(${y}px) scale(1) rotate(0deg)`,
              opacity: 1,
              filter: 'drop-shadow(0 0 0 hsl(var(--h), var(--s), var(--l)))',
            },
            {
              transform: `translateY(${y}px) scale(1.9) rotate(140deg)`,
              opacity: 0.25,
              filter: 'drop-shadow(0 0 35px hsl(var(--h), var(--s), var(--l)))',
              offset: 0.55,
            },
            {
              transform: `translateY(${y}px) scale(2.2) rotate(260deg)`,
              opacity: 0,
              filter: 'drop-shadow(0 0 45px hsl(var(--h), var(--s), var(--l)))',
            },
          ],
          {
            duration,
            easing: 'cubic-bezier(0.15, 0.9, 0.2, 1)',
            fill: 'forwards',
          }
        );
        const el = note.element;
        note.element = undefined;
        state.notes.splice(i, 1);

        window.setTimeout(() => {
          if (document.body.contains(el)) {
            el.remove();
          }
        }, duration);
      }
    };

    // Spawn single note based on current mode + energy
    const trySpawnNote = (currentTime: number) => {
      // Enforce silence gap
      if (currentTime - state.lastSpawnTime < MIN_SILENCE_GAP) return;

      const band = trackBandRef.current;
      const energy = getBandEnergy(band);
      const bandState = bandEnergyRef.current[band];
      const avg = bandState.avg * 0.7 + energy * 0.3;
      const delta = energy - bandState.last;
      bandState.avg = avg;
      bandState.last = energy;

      const isPeak =
        energy > ENERGY_THRESHOLD && energy > avg * PEAK_MULTIPLIER && delta > PEAK_DELTA;

      const isIdle = currentTime - state.lastSpawnTime > MAX_IDLE_MS;
      const hasActiveNotes = state.notes.some((note) => !note.hit && !note.missed);
      const allowFallback = isIdle && !hasActiveNotes;
      if (!isPeak && !allowFallback) return;

      if (isPeak) {
        if (currentTime - bandState.lastTrigger < BAND_COOLDOWN_MS) return;
        bandState.lastTrigger = currentTime;
      }

      const selectedBand = band;

      // Check if note would overlap
      const spawnTime = currentTime;
      const travelTime = getTravelTimeForBand(selectedBand);
      const hitTime = spawnTime + travelTime;

      if (wouldOverlap(spawnTime, currentTime, travelTime)) return;

      // Clear any on-screen notes to avoid confusing leftovers
      explodeAndClearActiveNotes(currentTime);

      const shape = getShapeFromBand(selectedBand);
      let noteElement: HTMLElement | SVGElement;

      if (shape === 'triangle') {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', `${NOTE_SIZE}`);
        svg.setAttribute('height', `${NOTE_SIZE}`);
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.style.position = 'absolute';
        svg.style.left = '50%';
        svg.style.top = '0';
        svg.style.marginLeft = `-${NOTE_SIZE / 2}px`;
        svg.style.willChange = 'transform';
        svg.style.overflow = 'visible';

        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', '50,5 5,95 95,95');
        polygon.setAttribute('fill', 'currentColor');
        polygon.setAttribute('stroke', 'none');

        svg.appendChild(polygon);
        noteElement = svg;
      } else {
        const div = document.createElement('div');
        div.className = 'absolute rounded-full transition-colors duration-150';
        div.style.width = `${NOTE_SIZE}px`;
        div.style.height = `${NOTE_SIZE}px`;
        div.style.left = '50%';
        div.style.top = '0';
        div.style.marginLeft = `-${NOTE_SIZE / 2}px`;
        div.style.willChange = 'transform';
        div.style.backgroundColor = 'currentColor';

        if (shape === 'square') {
          div.style.borderRadius = '0';
        }

        noteElement = div;
      }

      container.appendChild(noteElement);

      const note: Note = {
        id: ++state.lastNoteId,
        shape,
        spawnTime,
        hitTime,
        travelTime,
        hit: false,
        missed: false,
        element: noteElement,
      };

      state.notes.push(note);
      state.lastSpawnTime = currentTime;
    };

    const handleTap = () => {
      const currentTime = audio.currentTime * 1000;
      lastTapTimeRef.current = currentTime;
      const activeNotes = state.notes.filter((n) => !n.hit && !n.missed);

      const screenHeight = window.innerHeight;
      const hitCenterY = screenHeight - HIT_ZONE_OFFSET - EXPECTED_SHAPE_SIZE / 2;
      const hitboxRadius = EXPECTED_SHAPE_SIZE / 2;
      const noteRadius = NOTE_SIZE / 2;
      const requiredOverlap = NOTE_SIZE * 0.55;
      const maxCenterDistance = hitboxRadius + noteRadius - requiredOverlap;

      let closestNote: Note | null = null;
      let closestDiff = Infinity;

      for (const note of activeNotes) {
        const timeDiff = Math.abs(currentTime - note.hitTime);
        if (timeDiff > HIT_WINDOW_MS) continue;

        const noteTopY = getNotePosition(note, currentTime);
        const noteCenterY = noteTopY + noteRadius;
        const distanceFromHit = Math.abs(noteCenterY - hitCenterY);
        if (distanceFromHit > maxCenterDistance) continue;

        if (timeDiff < closestDiff) {
          closestNote = note;
          closestDiff = timeDiff;
        }
      }

      if (closestNote) {
        const shapeMatch = closestNote.shape === state.activeShape;

        if (shapeMatch) {
          closestNote.hit = true;
          state.score += 100 * (state.combo + 1);
          state.combo++;
          setScore(state.score);
          setCombo(state.combo);

          const hitWords = ['Woow', 'Gut', 'Nice'] as const;
          const hitWord = hitWords[Math.floor(Math.random() * hitWords.length)] ?? 'Nice';
          triggerFeedback('hit', `${hitWord} x${state.combo}`);

          // Trigger success flash on expected shape
          setIsSuccessFlash(true);
          setTimeout(() => setIsSuccessFlash(false), 200);

          // Immediately hide the note
          if (closestNote.element) {
            closestNote.element.style.opacity = '0';
            closestNote.element.style.transform = 'scale(0)';
          }

          // Instantly clear non-matching notes on successful tap
          explodeAndClearActiveNotes(currentTime);

          // After a successful hit, optionally change band
          if (currentTime - state.lastShapeChangeTime >= SHAPE_LOCK_DURATION) {
            const bands: Band[] = AVAILABLE_BANDS.filter(
              (band) => band !== trackBandRef.current
            ) as Band[];
            const nextBand = bands[Math.floor(Math.random() * bands.length)] ?? 'bass';
            state.lastShapeChangeTime = currentTime;
            setTrackBandMode(nextBand);
          }
        } else {
          state.combo = 0;
          setCombo(0);
          triggerMiss();
        }
      } else {
        if (state.combo > 0) {
          state.combo = 0;
          setCombo(0);
        }
        triggerMiss();
      }

      // Always explode non-matching notes instantly on tap
      explodeAndClearActiveNotes(currentTime);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault();
        handleTap();
      }
    };

    document.addEventListener('click', handleTap);
    document.addEventListener('keydown', handleKeyDown);

    const update = () => {
      const currentTime = audio.currentTime * 1000;

      const { h, s, l } = getColorFromAudio();
      document.documentElement.style.setProperty('--h', h.toString());
      document.documentElement.style.setProperty('--s', `${s}%`);
      document.documentElement.style.setProperty('--l', `${l}%`);

      // Shape changes are handled on tap only

      // Quantized spawning on musical ticks
      if (currentTime - lastTickTimeRef.current >= TICK_INTERVAL) {
        trySpawnNote(currentTime);
        lastTickTimeRef.current = currentTime;
      }

      for (let i = state.notes.length - 1; i >= 0; i--) {
        const note = state.notes[i];
        if (!note) continue;

        // Remove notes only after they go fully off-screen
        const screenHeight = window.innerHeight;
        const offScreenThreshold = screenHeight + NOTE_SIZE + 50; // bottom + note size + buffer
        const y = getNotePosition(note, currentTime);

        if (y > offScreenThreshold) {
          note.element?.remove();
          state.notes.splice(i, 1);
          continue;
        }

        if (note.hit) {
          if (currentTime - note.hitTime > 200) {
            note.element?.remove();
            state.notes.splice(i, 1);
          }
          continue;
        }

        if (note.missed) {
          // Let missed notes keep moving until they leave the screen
          if (note.element) {
            note.element.style.transform = `translateY(${y}px)`;
          }
          continue;
        }

        if (currentTime > note.hitTime + HIT_WINDOW_MS) {
          note.missed = true;
          if (note.shape === state.activeShape) {
            state.combo = 0;
            state.score = Math.max(0, state.score - 50);
            setScore(state.score);
            setCombo(0);
            triggerMiss();
          }
          continue;
        }

        if (note.element) {
          note.element.style.transform = `translateY(${y}px)`;
        }
      }

      animationRef.current = requestAnimationFrame(update);
    };

    update();

    return () => {
      cancelAnimationFrame(animationRef.current);
      document.removeEventListener('click', handleTap);
      document.removeEventListener('keydown', handleKeyDown);
      if (feedbackTimeoutRef.current) {
        window.clearTimeout(feedbackTimeoutRef.current);
      }
      state.notes.forEach((note) => note.element?.remove());
      state.notes = [];
    };
  }, [isPlaying]);

  const handleStart = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      // Ensure audio context is ready
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      await audio.play();
      console.log('Audio started');
    } catch (error) {
      console.error('Failed to start audio:', error);
    }
  };

  return (
    <div role="button" tabIndex={-1} className="fixed group inset-0 bg-black overflow-hidden">
      <audio ref={audioRef} src="/music.mp3" preload="auto" />

      <style>{`
        @keyframes hitPop {
          0% {
            transform: scale(0.85);
            opacity: 0;
          }
          30% {
            transform: scale(1.2);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 0;
          }
        }

        @keyframes missFlash {
          0% {
            transform: scale(0.9);
            opacity: 0;
          }
          25% {
            transform: scale(1.05);
            opacity: 1;
          }
          100% {
            transform: scale(0.95);
            opacity: 0;
          }
        }

        @keyframes shapePulse {
          0% {
            transform: scale(1);
            filter: drop-shadow(0 0 5px hsl(var(--h), var(--s), var(--l)));
          }
          50% {
            transform: scale(1.3);
            filter: drop-shadow(0 0 25px hsl(var(--h), var(--s), var(--l)));
          }
          100% {
            transform: scale(1);
            filter: drop-shadow(0 0 5px hsl(var(--h), var(--s), var(--l)));
          }
        }
      `}</style>

      <div
        ref={containerRef}
        className="absolute pointer-events-none left-1/2 -translate-x-1/2 h-full"
        style={{
          width: `${TRACK_WIDTH}px`,
          color: 'hsl(var(--h), var(--s), var(--l))',
        }}
      />

      {/* Expected shape indicator */}
      <div
        style={{
          bottom: `${HIT_ZONE_OFFSET}px`,
        }}
        className="group-active:scale-110 z-1 absolute left-1/2 -translate-x-1/2"
      >
        {activeShape === 'triangle' ? (
          <svg
            ref={expectedShapeRef as RefObject<SVGSVGElement>}
            width={EXPECTED_SHAPE_SIZE}
            height={EXPECTED_SHAPE_SIZE}
            viewBox="0 0 100 100"
            style={{
              filter: isSuccessFlash
                ? 'drop-shadow(0 0 20px hsl(var(--h), var(--s), var(--l)))'
                : 'none',
              transition: 'all 0.15s ease-out',
            }}
          >
            <polygon
              points="50,5 5,95 95,95"
              fill="none"
              stroke={
                isSuccessFlash ? 'hsl(var(--h), var(--s), var(--l))' : 'rgba(255, 255, 255, 0.15)'
              }
              strokeWidth="3"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <div
            ref={expectedShapeRef as RefObject<HTMLDivElement>}
            style={{
              width: `${EXPECTED_SHAPE_SIZE}px`,
              height: `${EXPECTED_SHAPE_SIZE}px`,
              backgroundColor: 'transparent',
              border: '3px solid',
              borderColor: isSuccessFlash
                ? 'hsl(var(--h), var(--s), var(--l))'
                : 'rgba(255, 255, 255, 0.15)',
              filter: isSuccessFlash
                ? 'drop-shadow(0 0 20px hsl(var(--h), var(--s), var(--l)))'
                : 'none',
              borderRadius: activeShape === 'circle' ? '50%' : '0',
              transition: 'all 0.15s ease-out',
            }}
          />
        )}
      </div>

      <div className="absolute top-4 left-4 text-white">
        <div className="text-2xl font-bold">Score: {score}</div>
        <div className="text-xl">Combo: {combo}x</div>
      </div>

      {feedback && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div
            key={feedback.id}
            className={`px-6 py-3 text-3xl font-black uppercase tracking-wide ${
              feedback.type === 'hit' ? '' : ''
            }`}
            style={(() => {
              const isHit = feedback.type === 'hit';
              const hitStyle = {
                color: '#00ff04',
                textShadow: '0 0 22px #00ff04',
                animation: 'hitPop 0.45s ease-out',
                animationFillMode: 'forwards',
              } as const;
              const missStyle = {
                color: '#ff3030',
                textShadow: '0 0 22px #ff3030',
                animation: 'missFlash 0.45s ease-out',
                animationFillMode: 'forwards',
              } as const;
              if (isHit) return hitStyle;
              return missStyle;
            })()}
          >
            {feedback.text}
          </div>
        </div>
      )}

      <div className="absolute top-4 right-4 text-white text-sm opacity-70">
        Track: {trackBand.toUpperCase()}
      </div>

      {!isPlaying && (
        <button
          onClick={handleStart}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white text-black px-8 py-4 rounded-full text-2xl font-bold"
        >
          START
        </button>
      )}
    </div>
  );
};
