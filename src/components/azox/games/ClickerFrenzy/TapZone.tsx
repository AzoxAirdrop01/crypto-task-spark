import { Lock, Zap } from "lucide-react";


type Props = {
  state: "ready" | "playing" | "locked";
  onTap: (x: number, y: number) => void;
  label?: string;
};

export default function TapZone({ state, onTap, label }: Props) {
  const locked = state === "locked";
  const playing = state === "playing";

  return (
    <div className="relative grid size-64 place-items-center sm:size-72">
      {/* Outer glow ring */}
      <div
        className={`absolute inset-0 rounded-full ${playing ? "clicker-ring-pulse" : ""}`}
        style={{
          border: "3px solid #FF7A18",
          boxShadow: "0 0 30px #FF7A18, 0 0 60px rgba(255,122,24,0.3)",
          opacity: locked ? 0.25 : playing ? 1 : 0.65,
        }}
        aria-hidden="true"
      />
      {/* Rotating conic gradient ring */}
      <div
        className="clicker-spin absolute inset-2 rounded-full"
        style={{
          background: "conic-gradient(#FF7A18, #FFD700, #FF7A18)",
          opacity: locked ? 0.15 : playing ? 0.9 : 0.5,
        }}
        aria-hidden="true"
      />
      {/* Inner tap target */}
      <button
        type="button"
        disabled={locked}
        aria-label={locked ? "Clicker Frenzy locked" : "Tap to earn points"}
        onPointerDown={(e) => {
          e.preventDefault();
          if (locked) return;
          onTap(e.clientX, e.clientY);
        }}
        onContextMenu={(e) => e.preventDefault()}
        className="clicker-tap absolute inset-5 grid place-items-center gap-1 overflow-hidden rounded-full"
        style={{
          background: "#0d0d0d",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          opacity: locked ? 0.45 : 1,
        }}
      >
        <img
          src="/assets/azox/azox-logo.png"
          alt=""
          width={220}
          height={220}
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full rounded-full object-cover"
          style={{ opacity: locked ? 0.3 : 0.85 }}
        />
        <span className="relative grid place-items-center gap-1 rounded-full bg-black/55 px-5 py-3 backdrop-blur-sm">
          {locked ? (
            <Lock className="size-7" style={{ color: "#FF7A18" }} aria-hidden="true" />
          ) : (
            <Zap
              className="size-7"
              style={{ color: "#FFD700", fill: "#FFD700" }}
              aria-hidden="true"
            />
          )}
          <span
            className="text-sm font-black tracking-widest"
            style={{ color: playing ? "#FFD700" : "#FF7A18" }}
          >
            {label ?? (playing ? "TAP!" : "TAP TO START")}
          </span>
        </span>
      </button>
    </div>
  );
}
