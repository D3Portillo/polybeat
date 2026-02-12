type LifeBarProps = {
  value: number;
  className?: string;
  segments?: number;
};

export const LifeBar = ({ value, segments = 10, className }: LifeBarProps) => {
  const clamped = Math.max(0, Math.min(1, value));
  const filled = Math.round(clamped * segments);
  const rows = Array.from({ length: segments }, (_, index) => {
    const isFilled = segments - index <= filled;
    return isFilled ? '█' : '░';
  });

  return (
    <div
      aria-label="Energy"
      className={`font-mono text-xl leading-none ${className}`}
      style={{ whiteSpace: 'pre' }}
    >
      {rows.join('\n')}
    </div>
  );
};
