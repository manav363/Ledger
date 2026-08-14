import { NODE_SPECS } from "../lib/nodeSpecs";

interface PaletteProps {
  onAdd: (type: string) => void;
}

export function Palette({ onAdd }: PaletteProps) {
  return (
    <div className="palette">
      <h2 className="panel__title">Nodes</h2>
      <div className="palette__list">
        {NODE_SPECS.map((spec) => (
          <button
            key={spec.type}
            className="palette__item"
            style={{ ["--accent" as string]: `var(${spec.accent})` }}
            onClick={() => onAdd(spec.type)}
          >
            <span className="palette__dot" />
            <span>{spec.label}</span>
            <span className="palette__type">{spec.type}</span>
          </button>
        ))}
      </div>
      <p className="palette__hint">Click to add · drag on canvas to arrange · drag handle → handle to connect</p>
    </div>
  );
}
