type LobbyProps = {
  onPlay: () => void;
};

export const Lobby = ({ onPlay }: LobbyProps) => {
  return (
    <div className="fixed inset-0 bg-black/10 backdrop-blur z-10 flex items-center justify-center">
      <div className="flex text-white text-lg font-bold flex-col">
        <button onClick={onPlay}>PLAY</button>
        <button onClick={onPlay}>LEADERBOARD</button>
      </div>
    </div>
  );
};
