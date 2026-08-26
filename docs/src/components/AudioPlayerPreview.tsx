import { useEffect, useState, type CSSProperties } from "react";

type Props = { title?: string; author?: string; durationSeconds?: number };
const waveform = [
  28, 46, 64, 38, 72, 52, 34, 60, 82, 44, 58, 30, 68, 48, 76, 40, 56, 86, 50,
  66, 36, 62, 46, 74, 32, 54, 80, 42, 70, 50, 34, 64,
];

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

export default function AudioPlayerPreview({
  title = "The Adventures of Alice in Wonderland",
  author = "Lewis Carroll",
  durationSeconds = 428,
}: Props) {
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(86);
  const progress = Math.min(position / durationSeconds, 1);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(
      () =>
        setPosition((current) => {
          if (current >= durationSeconds) {
            setPlaying(false);
            return 0;
          }
          return current + 1;
        }),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [durationSeconds, playing]);

  return (
    <section
      className="audio-preview"
      aria-label={`Preview player for ${title}`}
    >
      <div className="audio-preview__cover" aria-hidden="true">
        <span>ALDUS</span>
        <strong>Alice</strong>
        <span>Lewis Carroll</span>
      </div>
      <div className="audio-preview__body">
        <div className="audio-preview__heading">
          <div>
            <p className="audio-preview__title">{title}</p>
            <p className="audio-preview__author">{author}</p>
          </div>
          <button
            type="button"
            className="audio-preview__play"
            aria-label={playing ? "Pause preview" : "Play preview"}
            aria-pressed={playing}
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6.5 5.5h4v13h-4zm7 0h4v13h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m8 5 11 7-11 7z" />
              </svg>
            )}
          </button>
        </div>
        <div
          className={`audio-preview__waveform${playing ? " is-playing" : ""}`}
          aria-hidden="true"
        >
          {waveform.map((height, index) => (
            <i
              key={`${height}-${index}`}
              className={
                index / waveform.length <= progress ? "is-past" : undefined
              }
              style={
                {
                  "--bar-height": `${height}%`,
                  "--bar-index": index,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <label className="audio-preview__timeline">
          <span className="sr-only">Playback position</span>
          <span>{formatTime(position)}</span>
          <input
            type="range"
            min="0"
            max={durationSeconds}
            value={position}
            aria-valuetext={`${formatTime(position)} of ${formatTime(durationSeconds)}`}
            onChange={(event) => setPosition(Number(event.currentTarget.value))}
          />
          <span>{formatTime(durationSeconds)}</span>
        </label>
      </div>
    </section>
  );
}
