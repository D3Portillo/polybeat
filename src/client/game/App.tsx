import { useEffect, useRef, useState, type RefObject } from 'react';

type Shape = 'circle' | 'square' | 'triangle';
type Band = 'bass' | 'mid' | 'treble';
type FeedbackType = 'hit' | 'miss';

interface Feedback {
  id: number;
  type: FeedbackType;
  text: string;
}

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

const HIT_WINDOW_MS = 420; // More lenient timing
const NOTE_SIZE = 60;
const EXPECTED_SHAPE_SIZE = 100; // Much larger hitbox area
const HIT_CENTER_BIAS = 0;
const TRACK_WIDTH = 100;
const HIT_ZONE_OFFSET = 100;
const MIN_NOTE_SPACING = 40;
const STRING_CHUNK_SIZE = NOTE_SIZE * 2;
const STRING_WIDTH = 3;
const GRID_WIDTH = TRACK_WIDTH * 3;
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
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isHittable, setIsHittable] = useState(false);

  const expectedShapeRef = useRef<HTMLDivElement | SVGSVGElement | null>(null);
  const lastTapTimeRef = useRef(0);
  const trackBandRef = useRef<Band>(initialBand);
  const feedbackTimeoutRef = useRef<number | null>(null);
  const shakeLayerRef = useRef<HTMLDivElement>(null);
  const isHittableRef = useRef(false);
  const bandEnergyRef = useRef<Record<Band, { avg: number; last: number; lastTrigger: number }>>({
    bass: { avg: 0, last: 0, lastTrigger: -BAND_COOLDOWN_MS },
    mid: { avg: 0, last: 0, lastTrigger: -BAND_COOLDOWN_MS },
    treble: { avg: 0, last: 0, lastTrigger: -BAND_COOLDOWN_MS },
  });

  const setTrackBandMode = (band: Band) => {
    trackBandRef.current = band;
    setTrackBand(band);
    const shape = getShapeFromBand(band);
    stateRef.current.activeShape = shape;
    setActiveShape(shape);
  };

  const triggerFeedback = (type: FeedbackType, text: string) => {
    const id = Date.now();
    setFeedback({ id, type, text });
    if (feedbackTimeoutRef.current) {
      window.clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = window.setTimeout(() => {
      setFeedback(null);
    }, 500);
  };

  const triggerMiss = () => {
    const missWords = ['Miss', 'Nope', 'Oops', 'Early'] as const;
    const missWord = missWords[Math.floor(Math.random() * missWords.length)] ?? 'Miss';
    triggerFeedback('miss', missWord);

    if (shakeLayerRef.current) {
      shakeLayerRef.current.animate(
        [
          { transform: 'translateX(0px) rotateZ(0deg)' },
          { transform: 'translateX(-6px) rotateZ(-1deg)' },
          { transform: 'translateX(6px) rotateZ(1deg)' },
          { transform: 'translateX(-4px) rotateZ(-0.6deg)' },
          { transform: 'translateX(4px) rotateZ(0.6deg)' },
          { transform: 'translateX(0px) rotateZ(0deg)' },
        ],
        { duration: 260, easing: 'ease-in-out' }
      );
    }
  };

  const handleStart = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      // Ensure audio context is ready
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      await audio.play();
      setIsPlaying(true);
      console.log('Audio started');
    } catch (error) {
      console.error('Failed to start audio:', error);
    }
  };

  useEffect(() => {
    if (isPlaying) return;

    const handleStartKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault();
        void handleStart();
      }
    };

    document.addEventListener('keydown', handleStartKeyDown);

    return () => {
      document.removeEventListener('keydown', handleStartKeyDown);
    };
  }, [isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    const container = containerRef.current;

    if (!isPlaying || !audio || !container) return;

    const state = stateRef.current;

    if (!audioContextRef.current) {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      const source = context.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(context.destination);
      audioContextRef.current = context;
      analyserRef.current = analyser;
    }

    const getBandEnergy = (band: Band): number => {
      const analyser = analyserRef.current;
      if (!analyser) return 0;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);

      const range = dataArray.length;
      const [startRatio, endRatio] =
        band === 'bass' ? [0.0, 0.15] : band === 'mid' ? [0.15, 0.5] : [0.5, 1.0];

      const start = Math.floor(range * startRatio);
      const end = Math.max(start + 1, Math.floor(range * endRatio));

      let sum = 0;
      for (let i = start; i < end; i++) {
        sum += dataArray[i] ?? 0;
      }

      return sum / (end - start);
    };

    const getColorFromAudio = () => {
      const analyser = analyserRef.current;
      if (!analyser) return { h: 200, s: 70, l: 50 };

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
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
      const hitCenterY = screenHeight - HIT_ZONE_OFFSET - EXPECTED_SHAPE_SIZE / 2 - HIT_CENTER_BIAS;
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
              transform: `translateY(${y}px) scale(1.9) rotate(0deg)`,
              opacity: 0.25,
              filter: 'drop-shadow(0 0 35px hsl(var(--h), var(--s), var(--l)))',
              offset: 0.55,
            },
            {
              transform: `translateY(${y}px) scale(2.2) rotate(0deg)`,
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

    const explodeSingleNote = (note: Note, currentTime: number) => {
      if (!note.element) return;

      const y = getNotePosition(note, currentTime);
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

      window.setTimeout(() => {
        if (document.body.contains(el)) {
          el.remove();
        }
      }, duration);
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
        svg.style.transformOrigin = '50% 50%';
        svg.style.overflow = 'visible';
        svg.style.filter = 'drop-shadow(0 2px 6px rgba(0,0,0,0.45))';

        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', '50,5 5,95 95,95');
        polygon.setAttribute('fill', 'currentColor');
        polygon.setAttribute('stroke', 'none');
        polygon.setAttribute('vector-effect', 'non-scaling-stroke');

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
        div.style.transformOrigin = '50% 50%';
        div.style.backgroundColor = 'currentColor';
        div.style.boxShadow =
          'inset 0 3px 6px rgba(255,255,255,0.25), inset 0 -6px 10px rgba(0,0,0,0.35), 0 4px 10px rgba(0,0,0,0.4)';

        if (shape === 'square') {
          div.style.borderRadius = '8px';
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

    const getHitboxMetrics = () => {
      const rect = expectedShapeRef.current?.getBoundingClientRect();
      if (rect) {
        return {
          hitCenterY: rect.top + rect.height / 2,
          hitboxRadius: rect.height / 2,
          hitTop: rect.top,
          hitBottom: rect.bottom,
        };
      }

      const screenHeight = window.innerHeight;
      const hitCenterY = screenHeight - HIT_ZONE_OFFSET - EXPECTED_SHAPE_SIZE / 2 - HIT_CENTER_BIAS;
      const hitboxRadius = EXPECTED_SHAPE_SIZE / 2;
      return {
        hitCenterY,
        hitboxRadius,
        hitTop: hitCenterY - hitboxRadius,
        hitBottom: hitCenterY + hitboxRadius,
      };
    };

    const handleTap = () => {
      const currentTime = audio.currentTime * 1000;
      lastTapTimeRef.current = currentTime;
      const activeNotes = state.notes.filter((n) => !n.hit && !n.missed);

      const { hitCenterY, hitboxRadius, hitTop, hitBottom } = getHitboxMetrics();
      const noteRadius = NOTE_SIZE / 2;
      const requiredOverlap = NOTE_SIZE * 0.4;
      const maxCenterDistance = hitboxRadius + noteRadius - requiredOverlap;
      const extraBottomAllowance = hitboxRadius * 0.5;
      const entrySlack = NOTE_SIZE * 0.1;
      const topTighten = hitboxRadius * 0.25;

      let closestNote: Note | null = null;
      let closestDiff = Infinity;

      for (const note of activeNotes) {
        const timeDiff = Math.abs(currentTime - note.hitTime);

        const noteTopY = getNotePosition(note, currentTime);
        const noteCenterY = noteTopY + noteRadius;
        const noteBottomY = noteTopY + NOTE_SIZE;
        if (noteBottomY < hitTop - entrySlack) continue;
        if (noteTopY < hitTop + topTighten) continue;
        const distanceFromHit = Math.abs(noteCenterY - hitCenterY);
        const allowedDistance =
          noteCenterY > hitCenterY ? maxCenterDistance + extraBottomAllowance : maxCenterDistance;
        if (distanceFromHit > allowedDistance) continue;

        if (timeDiff > HIT_WINDOW_MS) continue;

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

          const hitWords = ['Woow', 'Good', 'Nice', 'Perfect'] as const;
          const hitWord = hitWords[Math.floor(Math.random() * hitWords.length)] ?? 'Nice';
          triggerFeedback('hit', `${hitWord} x${state.combo}`);

          // Trigger success flash on expected shape
          setIsSuccessFlash(true);
          setTimeout(() => setIsSuccessFlash(false), 200);

          // Explode the hit note instead of hiding it
          explodeSingleNote(closestNote, currentTime);

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
      const { hitCenterY, hitboxRadius, hitTop } = getHitboxMetrics();
      const noteRadius = NOTE_SIZE / 2;
      const requiredOverlap = NOTE_SIZE * 0.4;
      const maxCenterDistance = hitboxRadius + noteRadius - requiredOverlap;
      const extraBottomAllowance = hitboxRadius * 0.5;
      const entrySlack = NOTE_SIZE * 0.1;
      const topTighten = hitboxRadius * 0.25;
      let hittableNow = false;

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

        const noteCenterY = y + noteRadius;
        const noteBottomY = y + NOTE_SIZE;
        const distanceFromHit = Math.abs(noteCenterY - hitCenterY);
        const allowedDistance =
          noteCenterY > hitCenterY ? maxCenterDistance + extraBottomAllowance : maxCenterDistance;
        const timeDiff = Math.abs(currentTime - note.hitTime);

        if (
          !hittableNow &&
          timeDiff <= HIT_WINDOW_MS &&
          distanceFromHit <= allowedDistance &&
          noteBottomY >= hitTop - entrySlack &&
          y >= hitTop + topTighten
        ) {
          hittableNow = true;
        }

        if (
          currentTime > note.hitTime + HIT_WINDOW_MS &&
          distanceFromHit > allowedDistance &&
          noteBottomY < hitTop - entrySlack
        ) {
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

      if (hittableNow !== isHittableRef.current) {
        isHittableRef.current = hittableNow;
        setIsHittable(hittableNow);
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

  return (
    <div
      role="button"
      tabIndex={-1}
      className="fixed select-none group inset-0 bg-black overflow-hidden"
      onClick={!isPlaying ? handleStart : undefined}
    >
      <audio ref={audioRef} src="/music.mp3" preload="auto" />

      <style>{`
        @keyframes startPulse {
          0% {
            transform: scale(0.9);
            opacity: 0.4;
          }
          50% {
            transform: scale(1.05);
            opacity: 1;
          }
          100% {
            transform: scale(0.9);
            opacity: 0.4;
          }
        }
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
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'hsl(var(--h), var(--s), var(--l))',
          opacity: 0.15,
          filter: 'blur(20px)',
          zIndex: -1,
        }}
      />

      <div
        className="absolute left-0 right-0 top-0 pointer-events-none"
        style={{
          height: '20vh',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.95), rgba(0,0,0,0))',
          zIndex: 1,
        }}
      />

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          top: '-6%',
          transform: 'perspective(700px) rotateX(22deg) scaleY(1.12)',
          transformOrigin: '50% 100%',
        }}
      >
        <div
          ref={shakeLayerRef}
          className="absolute inset-0 pointer-events-none"
          style={{ transformOrigin: '50% 60%' }}
        >
          <div
            className="absolute pointer-events-none left-1/2 -translate-x-1/2 overflow-hidden"
            style={{
              width: `${GRID_WIDTH}px`,
              height: '200vh',
              top: '-100vh',
              zIndex: 0,
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                transform: 'perspective(800px) rotateX(18deg) scaleY(1.1)',
                transformOrigin: '50% 100%',
              }}
            >
              {(['left', 'center', 'right'] as const).map((key, index) => (
                <div
                  key={key}
                  style={{
                    position: 'absolute',
                    left: `${(index / 2) * 100}%`,
                    top: 0,
                    bottom: 0,
                    width: `${STRING_WIDTH}px`,
                    transform: 'translateX(-50%)',
                    backgroundImage: `repeating-linear-gradient(to bottom, rgba(255,255,255,0.45) 0 ${STRING_CHUNK_SIZE}px, rgba(255,255,255,0.18) ${STRING_CHUNK_SIZE}px ${STRING_CHUNK_SIZE * 2}px)`,
                    maskImage:
                      key === 'center'
                        ? `linear-gradient(to top, transparent 0 ${STRING_CHUNK_SIZE * 1.5}px, black ${STRING_CHUNK_SIZE * 1.5}px)`
                        : 'none',
                    WebkitMaskImage:
                      key === 'center'
                        ? `linear-gradient(to top, transparent 0 ${STRING_CHUNK_SIZE * 1.5}px, black ${STRING_CHUNK_SIZE * 1.5}px)`
                        : 'none',
                    boxShadow: '0 0 14px rgba(255,255,255,0.55), 0 0 28px rgba(255,255,255,0.35)',
                  }}
                />
              ))}
            </div>
          </div>

          <div
            ref={containerRef}
            className="absolute pointer-events-none left-1/2 -translate-x-1/2 h-full"
            style={{
              width: `${TRACK_WIDTH}px`,
              color: 'hsl(var(--h), var(--s), var(--l))',
              zIndex: 2,
            }}
          />

          {/* Expected shape indicator */}
          <div
            style={{
              bottom: `${HIT_ZONE_OFFSET}px`,
            }}
            className="group-active:scale-95 z-1 absolute left-1/2 -translate-x-1/2"
          >
            <div
              style={{
                width: `${EXPECTED_SHAPE_SIZE}px`,
                height: `${EXPECTED_SHAPE_SIZE}px`,
                transform: 'rotateX(15deg)',
                backgroundColor: isHittable ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.1)',
                borderRadius: activeShape === 'circle' ? '50%' : '8px',
                clipPath:
                  activeShape === 'triangle' ? 'polygon(50% 0%, 0% 100%, 100% 100%)' : 'none',
                filter: 'drop-shadow(0 0 18px rgba(255,255,255,0.65))',
                transition: 'all 0.15s ease-out',
              }}
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
                      isSuccessFlash
                        ? 'hsl(var(--h), var(--s), var(--l))'
                        : 'rgba(255, 255, 255, 0.95)'
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
                      : 'rgba(255, 255, 255, 0.95)',
                    filter: isSuccessFlash
                      ? 'drop-shadow(0 0 20px hsl(var(--h), var(--s), var(--l)))'
                      : 'drop-shadow(0 0 18px rgba(255,255,255,0.6))',
                    borderRadius: activeShape === 'circle' ? '50%' : '8px',
                    transition: 'all 0.15s ease-out',
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="absolute z-3 top-4 left-4 text-white">
        <div className="text-2xl font-bold">Score: {score}</div>
        <div className="text-xl">Combo: {combo}x</div>
      </div>

      <div className="absolute z-3 top-4 right-4 text-white text-sm opacity-70">
        Track: {trackBand.toUpperCase()}
      </div>

      {feedback && (
        <div className="absolute z-3 inset-0 pointer-events-none flex items-center justify-center">
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

      {!isPlaying && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="text-4xl font-black text-white backdrop-blur"
              style={{
                animation: 'startPulse 1.6s ease-in-out infinite',
                padding: '12px 28px',
                background: 'rgba(0,0,0,0.35)',
                borderRadius: '16px',
              }}
            >
              START
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
