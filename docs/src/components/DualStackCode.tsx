import { useState } from "react";

type Props = {
  goCode: string;
  typescriptCode: string;
  goLabel?: string;
  typescriptLabel?: string;
};

export default function DualStackCode({
  goCode,
  typescriptCode,
  goLabel = "Go server",
  typescriptLabel = "Expo client",
}: Props) {
  const [active, setActive] = useState<"go" | "typescript">("go");
  return (
    <section className="dual-stack" aria-label="Server and client examples">
      <div
        className="dual-stack__tabs"
        role="tablist"
        aria-label="Code example language"
      >
        <button
          type="button"
          role="tab"
          aria-selected={active === "go"}
          aria-controls="dual-stack-go"
          id="dual-stack-tab-go"
          onClick={() => setActive("go")}
        >
          {goLabel}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === "typescript"}
          aria-controls="dual-stack-typescript"
          id="dual-stack-tab-typescript"
          onClick={() => setActive("typescript")}
        >
          {typescriptLabel}
        </button>
      </div>
      <div className="dual-stack__grid">
        <figure
          id="dual-stack-go"
          role="tabpanel"
          aria-labelledby="dual-stack-tab-go"
          hidden={active !== "go"}
        >
          <figcaption>{goLabel}</figcaption>
          <pre tabIndex={0}>
            <code>{goCode.trim()}</code>
          </pre>
        </figure>
        <figure
          id="dual-stack-typescript"
          role="tabpanel"
          aria-labelledby="dual-stack-tab-typescript"
          hidden={active !== "typescript"}
        >
          <figcaption>{typescriptLabel}</figcaption>
          <pre tabIndex={0}>
            <code>{typescriptCode.trim()}</code>
          </pre>
        </figure>
      </div>
    </section>
  );
}
