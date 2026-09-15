import { Header } from "./components/layout/Header";
import { LeftNav } from "./components/layout/LeftNav";
import { CompatibilityBanner } from "./components/common/CompatibilityBanner";
import { useAppStore } from "./state/appStore";
import { Dashboard } from "./components/pages/Dashboard";
import { LiveEeg } from "./components/pages/LiveEeg";
import { Filters } from "./components/pages/Filters";
import { BlinkDetector } from "./components/pages/BlinkDetector";
import { DoubleBlink } from "./components/pages/DoubleBlink";
import { ArtifactRejection } from "./components/pages/ArtifactRejection";
import { Calibration } from "./components/pages/Calibration";
import { Commands } from "./components/pages/Commands";
import { Esp32Page } from "./components/pages/Esp32Page";
import { Recorder } from "./components/pages/Recorder";
import { Diagnostics } from "./components/pages/Diagnostics";
import { Settings } from "./components/pages/Settings";
import { About } from "./components/pages/About";

function CurrentPage() {
  const page = useAppStore((s) => s.page);
  switch (page) {
    case "dashboard": return <Dashboard />;
    case "liveEeg": return <LiveEeg />;
    case "filters": return <Filters />;
    case "blinkDetector": return <BlinkDetector />;
    case "doubleBlink": return <DoubleBlink />;
    case "artifactRejection": return <ArtifactRejection />;
    case "calibration": return <Calibration />;
    case "commands": return <Commands />;
    case "esp32": return <Esp32Page />;
    case "recorder": return <Recorder />;
    case "diagnostics": return <Diagnostics />;
    case "settings": return <Settings />;
    case "about": return <About />;
    default: return <Dashboard />;
  }
}

function App() {
  return (
    <div className="flex h-screen flex-col bg-[var(--bg-app)] text-[var(--text)]">
      <Header />
      <CompatibilityBanner />
      <div className="flex min-h-0 flex-1">
        <LeftNav />
        <main className="flex-1 overflow-y-auto p-4">
          <CurrentPage />
        </main>
      </div>
    </div>
  );
}

export default App;
