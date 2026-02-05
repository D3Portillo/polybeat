import { useEffect, useRef, useState } from 'react';

type Shape = 'circle' | 'square' | 'triangle';

interface Note {
  id: number;
  shape: Shape;
  spawnTime: number;
  hitTime: number;
  hit: boolean;
  missed: boolean;
  element?: HTMLDivElement;
}

interface GameState {
  notes: Note[];
  score: number;
  combo: number;
  activeShape: Shape;
  lastNoteId: number;
  lastSpawnTime: number;
  compositionWeights: { bass: number; mid: number; treble: number };
  lastShapeChangeTime: number;
}

const HIT_WINDOW_MS = 250; // More lenient timing
const NOTE_SIZE = 60;
const EXPECTED_SHAPE_SIZE = 100; // Much larger hitbox area
const TRACK_WIDTH = 100;
const HIT_ZONE_OFFSET = 100;
const MIN_NOTE_SPACING = 60;
const TRAVEL_TIME = 2000;
const BPM = 120;
const TICK_INTERVAL = 60000 / BPM / 4; // 1/16th note
const MIN_SILENCE_GAP = 600; // Minimum ms between notes
const ENERGY_THRESHOLD = 100; // Minimum energy to spawn
const SHAPE_LOCK_DURATION = 3000; // Lock shape for 3 seconds
const TAP_LOCK_DURATION = 300; // Lock shape during and after tap

export const App = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const stateRef = useRef<GameState>({
    notes: [],
    score: 0,
    combo: 0,
    activeShape: 'circle',
    lastNoteId: 0,
    lastSpawnTime: -MIN_SILENCE_GAP,
    compositionWeights: { bass: 0.4, mid: 0.3, treble: 0.3 },
    lastShapeChangeTime: 0,
  });
  const animationRef = useRef<number>(0);
  const lastTickTimeRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [activeShape, setActiveShape] = useState<Shape>('circle');
  const [isSuccessFlash, setIsSuccessFlash] = useState(false);
  const expectedShapeRef = useRef<HTMLDivElement>(null);
  const lastTapTimeRef = useRef(0);

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

    const getBandEnergy = (type: 'bass' | 'mid' | 'treble'): number => {
      analyser.getByteFrequencyData(dataArray);
      let slice: Uint8Array;

      if (type === 'bass') slice = dataArray.slice(0, 5);
      else if (type === 'mid') slice = dataArray.slice(5, 20);
      else slice = dataArray.slice(20, 40);

      return slice.reduce((a, b) => a + b, 0) / slice.length;
    };

    const getShapeFromBand = (band: 'bass' | 'mid' | 'treble'): Shape => {
      if (band === 'bass') return 'circle';
      if (band === 'treble') return 'triangle';
      return 'square';
    };

    const getShapeFromAudio = (): Shape => {
      const bass = getBandEnergy('bass');
      const mid = getBandEnergy('mid');
      const treble = getBandEnergy('treble');

      if (bass > mid && bass > treble) return 'circle';
      if (treble > bass && treble > mid) return 'triangle';
      return 'square';
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
      const totalTravelTime = TRAVEL_TIME / hitProgress;

      if (elapsed <= 0) return startTopY;

      const progress = Math.min(1, elapsed / totalTravelTime);
      const centerY = startCenterY + progress * totalDistance;
      return centerY - NOTE_SIZE / 2;
    };

    const wouldOverlap = (newNoteTime: number, currentTime: number): boolean => {
      const newNoteY = getNotePosition(
        {
          id: 0,
          shape: 'circle',
          spawnTime: newNoteTime,
          hitTime: newNoteTime + TRAVEL_TIME,
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

    // Spawn single note based on weighted band selection
    const trySpawnNote = (currentTime: number) => {
      // Enforce silence gap
      if (currentTime - state.lastSpawnTime < MIN_SILENCE_GAP) return;

      // Evolve composition weights slowly over time
      const evolution = Math.sin(currentTime / 10000) * 0.2;
      const weights = state.compositionWeights;
      weights.bass = 0.4 + evolution;
      weights.mid = 0.3 - evolution * 0.5;
      weights.treble = 0.3 - evolution * 0.5;

      // Randomly select ONE band using weights
      const rand = Math.random();
      let selectedBand: 'bass' | 'mid' | 'treble';

      if (rand < weights.bass) selectedBand = 'bass';
      else if (rand < weights.bass + weights.mid) selectedBand = 'mid';
      else selectedBand = 'treble';

      // Only check selected band's energy
      const energy = getBandEnergy(selectedBand);
      if (energy < ENERGY_THRESHOLD) return;

      // Check if note would overlap
      const spawnTime = currentTime;
      const hitTime = spawnTime + TRAVEL_TIME;

      if (wouldOverlap(spawnTime, currentTime)) return;

      const shape = getShapeFromBand(selectedBand);
      const noteElement = document.createElement('div');
      noteElement.className = 'absolute rounded-full transition-colors duration-150';
      noteElement.style.width = `${NOTE_SIZE}px`;
      noteElement.style.height = `${NOTE_SIZE}px`;
      noteElement.style.left = '50%';
      noteElement.style.top = '0';
      noteElement.style.marginLeft = `-${NOTE_SIZE / 2}px`;
      noteElement.style.willChange = 'transform';
      noteElement.style.backgroundColor = 'currentColor';

      if (shape === 'square') {
        noteElement.style.borderRadius = '0';
      } else if (shape === 'triangle') {
        noteElement.style.borderRadius = '0';
        noteElement.style.clipPath = 'polygon(50% 0%, 0% 100%, 100% 100%)';
      }

      container.appendChild(noteElement);

      const note: Note = {
        id: ++state.lastNoteId,
        shape,
        spawnTime,
        hitTime,
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

          // Trigger success flash on expected shape
          setIsSuccessFlash(true);
          setTimeout(() => setIsSuccessFlash(false), 200);

          // Immediately hide the note
          if (closestNote.element) {
            closestNote.element.style.opacity = '0';
            closestNote.element.style.transform = 'scale(0)';
          }
        } else {
          state.combo = 0;
          setCombo(0);
        }

        // After evaluating a note, optionally change expected shape
        if (currentTime - state.lastShapeChangeTime >= SHAPE_LOCK_DURATION) {
          const nextShapes: Shape[] = ['circle', 'square', 'triangle'].filter(
            (shape) => shape !== state.activeShape
          ) as Shape[];
          const nextShape = nextShapes[Math.floor(Math.random() * nextShapes.length)];
          state.activeShape = nextShape;
          state.lastShapeChangeTime = currentTime;
          setActiveShape(nextShape);

          if (expectedShapeRef.current) {
            expectedShapeRef.current.style.animation = 'none';
            setTimeout(() => {
              if (expectedShapeRef.current) {
                expectedShapeRef.current.style.animation = 'shapePulse 0.3s ease-out';
              }
            }, 10);
          }
        }
      }
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
        <div
          ref={expectedShapeRef}
          style={{
            width: `${EXPECTED_SHAPE_SIZE}px`,
            height: `${EXPECTED_SHAPE_SIZE}px`,
            backgroundColor:
              activeShape === 'triangle'
                ? isSuccessFlash
                  ? 'hsla(var(--h), var(--s), var(--l), 0.2)'
                  : 'rgba(255, 255, 255, 0.08)'
                : 'transparent',
            border: activeShape === 'triangle' ? '0' : '3px solid',
            borderColor: isSuccessFlash
              ? 'hsl(var(--h), var(--s), var(--l))'
              : 'rgba(255, 255, 255, 0.15)',
            filter: isSuccessFlash
              ? 'drop-shadow(0 0 20px hsl(var(--h), var(--s), var(--l)))'
              : 'none',
            clipPath:
              activeShape === 'circle'
                ? 'none'
                : activeShape === 'triangle'
                  ? 'polygon(50% 0%, 0% 100%, 100% 100%)'
                  : 'none',
            borderRadius: activeShape === 'circle' ? '50%' : '0',
            transition: 'all 0.15s ease-out',
          }}
        />
      </div>

      <div className="absolute top-4 left-4 text-white">
        <div className="text-2xl font-bold">Score: {score}</div>
        <div className="text-xl">Combo: {combo}x</div>
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
