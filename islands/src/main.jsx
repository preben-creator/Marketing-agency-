// React sections for the static site. Each one mounts into an empty element in index.html.
import "./main.css";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Area } from "@/vendor/bklit/charts/area";
import { AreaChart } from "@/vendor/bklit/charts/area-chart";
import { Grid } from "@/vendor/bklit/charts/grid";
import { Ring } from "@/vendor/bklit/charts/ring";
import { RingChart } from "@/vendor/bklit/charts/ring-chart";
import { ChartTooltip } from "@/vendor/bklit/charts/tooltip";
import { XAxis } from "@/vendor/bklit/charts/x-axis";
import BackgroundPaths from "@/vendor/kokonut/background-paths";
import SplitFlapText from "@/vendor/kokonut/split-flap-text";

// ---- Placeholder data: replace with real campaign numbers ----

// Click-through rate (%) over 12 weeks, traditional video vs AI video
const ctrData = [1.1, 1.2, 1.15, 1.3, 1.25, 1.2, 1.35, 1.3, 1.4, 1.35, 1.45, 1.4].map((traditional, i) => ({
  date: new Date(2026, 6, 6 + i * 7),
  traditional,
  ai: [1.2, 1.6, 2.1, 2.5, 2.9, 3.2, 3.6, 3.9, 4.1, 4.4, 4.6, 4.8][i],
}));

// What clients save, as a share of a traditional production
const savingsData = [
  { label: "Production cost saved", value: 60, maxValue: 100, color: "#7c5cff" },
  { label: "Turnaround time saved", value: 85, maxValue: 100, color: "#00d4ff" },
  { label: "Campaigns hitting target", value: 92, maxValue: 100, color: "#ff4ecd" },
];

const flapWords = ["MORE VIEWS", "MORE CLICKS", "LOWER CPA", "FASTER"];

// ---- Sections ----

function CtrChart() {
  return (
    <AreaChart aspectRatio="16 / 9" data={ctrData}>
      <Grid horizontal />
      <Area dataKey="traditional" fill="var(--chart-4)" fillOpacity={0.15} fadeEdges />
      <Area dataKey="ai" fill="var(--chart-line-primary)" fillOpacity={0.35} fadeEdges />
      <XAxis />
      <ChartTooltip
        rows={(point) => [
          { color: "var(--chart-line-primary)", label: "AI video", value: `${point.ai}%` },
          { color: "var(--chart-4)", label: "Traditional", value: `${point.traditional}%` },
        ]}
      />
    </AreaChart>
  );
}

function SavingsRings() {
  const [hovered, setHovered] = useState(null);
  // The center shows the hovered ring, or the headline saving when nothing is hovered
  const item = savingsData[hovered ?? 0];
  return (
    <div className="relative">
      <RingChart
        baseInnerRadius={62}
        data={savingsData}
        hoveredIndex={hovered}
        onHoverChange={setHovered}
        ringGap={8}
        size={260}
        strokeWidth={14}
      >
        {savingsData.map((d, index) => (
          <Ring index={index} key={d.label} />
        ))}
      </RingChart>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-semibold text-3xl text-foreground">{item.value}%</span>
        <span className="max-w-24 text-center text-muted-foreground text-xs">{item.label}</span>
      </div>
    </div>
  );
}

function mount(id, element) {
  const el = document.getElementById(id);
  if (el) {
    createRoot(el).render(<StrictMode>{element}</StrictMode>);
  }
}

mount("flap-board", <SplitFlapText words={flapWords} interval={2600} length={11} />);
mount("results-area", <CtrChart />);
mount("results-ring", <SavingsRings />);
mount("contact-bg", <BackgroundPaths className="h-full min-h-0 bg-transparent text-[#7c5cff] dark:bg-transparent dark:text-[#7c5cff]" count={36} speed={0.6}>{null}</BackgroundPaths>);
