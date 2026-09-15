/**
 * The application engine: a module-level singleton (not a React
 * component) that owns the pipeline worker, the Muse 2 / simulator
 * acquisition source, and the ESP32 serial link, and drives
 * state/appStore.ts. React components call its methods and read results
 * from the store — they never touch the worker, MuseClient, or
 * Esp32Client directly, keeping "the UI displays the result of the safety
 * gate, it does not decide whether the hand should move" true by
 * construction (project brief section 25).
 */
import { Esp32Client } from "../esp32/esp32Client";
import { MuseClient } from "../muse/museClient";
import { buildDemoScenario, SignalSimulator, type SimEvent } from "../core/simulation/signalGenerator";
import type { Sample, Command } from "../core/types";
import type { MainToWorkerMessage, WorkerToMainMessage } from "../worker/workerProtocol";
import { useAppStore } from "../state/appStore";

const ESP32_HEALTH_TIMEOUT_MS_FALLBACK = 1500;

class AppEngine {
  private worker: Worker | null = null;
  private museClient: MuseClient | null = null;
  private esp32Client: Esp32Client | null = null;

  private sampleBuffer: Sample[] = [];
  private flushHandle: number | null = null;

  private simulationTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private esp32HealthPollTimer: number | null = null;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("../worker/pipelineWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => this.handleWorkerMessage(event.data);
    this.worker = worker;
    this.postToWorker({ type: "init", config: useAppStore.getState().config, fsHz: useAppStore.getState().fsHz });
    return worker;
  }

  private postToWorker(msg: MainToWorkerMessage): void {
    this.worker?.postMessage(msg);
  }

  private handleWorkerMessage(msg: WorkerToMainMessage): void {
    if (msg.type !== "results") return;
    const store = useAppStore.getState();
    store.pushResults(msg.results);
    store.setLatencySummary(msg.latencySummary);

    for (const result of msg.results) {
      if (result.stateEvent !== null) {
        store.logDiagnostic(
          `${result.stateEvent.eventType} conf=${result.stateEvent.confidence.toFixed(2)} -> ${result.gateDecision.command} (${result.gateDecision.reason})`,
        );
      }
    }

    this.maybeForwardCommandToEsp32(msg.results);
  }

  private lastCommandSentToEsp32: Command | null = null;

  private maybeForwardCommandToEsp32(results: { gateDecision: { command: Command } }[]): void {
    if (results.length === 0) return;
    const store = useAppStore.getState();
    if (store.esp32ConnState !== "connected" || !store.esp32OutputArmed) return;
    const finalCommand = results[results.length - 1].gateDecision.command;
    if (finalCommand === this.lastCommandSentToEsp32) return;
    this.lastCommandSentToEsp32 = finalCommand;
    this.esp32Client?.sendCommand(finalCommand).catch((err) => {
      store.setEsp32Error(err instanceof Error ? err.message : String(err));
    });
  }

  // ---- config / calibration -------------------------------------------
  applyConfig(): void {
    const store = useAppStore.getState();
    this.ensureWorker();
    this.postToWorker({ type: "setConfig", config: store.config });
  }

  applyCalibration(): void {
    const store = useAppStore.getState();
    this.ensureWorker();
    this.postToWorker({ type: "setCalibration", stats: store.calibrationStats });
  }

  // ---- Muse 2 (live) -----------------------------------------------------
  async connectMuse(): Promise<void> {
    this.stopSimulation();
    const store = useAppStore.getState();
    store.setMuseError(null);
    this.ensureWorker();

    this.museClient = new MuseClient({
      onSample: (s) => {
        this.enqueueSample({
          timestampS: s.timestampMs / 1000,
          af7: s.af7,
          af8: s.af8,
          tp9: s.tp9,
          tp10: s.tp10,
          accelX: s.accelX,
          accelY: s.accelY,
          accelZ: s.accelZ,
        });
      },
      onConnectionStateChange: (state, deviceName) => {
        useAppStore.getState().setMuseConnState(state, deviceName);
        if (state === "disconnected") this.flushSampleBuffer();
      },
      onBattery: (percent) => useAppStore.getState().setMuseBattery(percent),
      onError: (err) => useAppStore.getState().setMuseError(err.message),
    });

    useAppStore.getState().setMode("live");
    await this.museClient.connect();
  }

  async disconnectMuse(): Promise<void> {
    await this.museClient?.disconnect();
    this.museClient = null;
  }

  // ---- Simulation mode ----------------------------------------------------
  startSimulation(events: SimEvent[] = buildDemoScenario(), totalDurationS?: number, seed = 42): void {
    this.disconnectMuse();
    this.stopSimulation();
    this.ensureWorker();
    useAppStore.getState().setMode("simulate");

    const duration = totalDurationS ?? Math.max(...events.map((e) => e.onsetS + e.durationS), 10) + 5;
    const sim = new SignalSimulator(useAppStore.getState().fsHz, 52.0, seed);
    const rec = sim.render(duration, events);

    const n = rec.timestamps.length;
    let cursor = 0;
    const fsHz = useAppStore.getState().fsHz;
    const samplesPerTick = Math.max(Math.round(fsHz * 0.02), 1); // ~20ms ticks

    this.simulationTimer = window.setInterval(() => {
      const end = Math.min(cursor + samplesPerTick, n);
      for (let i = cursor; i < end; i++) {
        this.enqueueSample({
          timestampS: rec.timestamps[i],
          af7: rec.channels.AF7[i],
          af8: rec.channels.AF8[i],
          tp9: rec.channels.TP9[i],
          tp10: rec.channels.TP10[i],
          accelX: rec.accel.x[i],
          accelY: rec.accel.y[i],
          accelZ: rec.accel.z[i],
        });
      }
      cursor = end;
      if (cursor >= n) this.stopSimulation();
    }, 20);
  }

  stopSimulation(): void {
    if (this.simulationTimer !== null) {
      window.clearInterval(this.simulationTimer);
      this.simulationTimer = null;
    }
  }

  // ---- ESP32 ---------------------------------------------------------------
  async connectEsp32(): Promise<void> {
    const store = useAppStore.getState();
    store.setEsp32Error(null);
    store.setEsp32OutputArmed(false); // never auto-armed on connect
    this.lastCommandSentToEsp32 = null;

    this.esp32Client = new Esp32Client({
      onConnectionStateChange: (state) => {
        useAppStore.getState().setEsp32ConnState(state);
        if (state === "disconnected") {
          useAppStore.getState().setEsp32OutputArmed(false);
          useAppStore.getState().setEsp32CommHealthy(false);
          this.postToWorker({ type: "setCommOk", commOk: true }); // not connected -> comm health not applicable, matches Python default
          this.stopEsp32HealthPolling();
        }
      },
      onFrame: (frame) => {
        if (frame.kind === "ACK") {
          useAppStore.getState().setEsp32LastCommand(frame.payload as Command, Date.now());
        }
      },
      onCommHealthChange: (healthy) => useAppStore.getState().setEsp32CommHealthy(healthy),
      onError: (err) => useAppStore.getState().setEsp32Error(err.message),
    });

    await this.esp32Client.connect(useAppStore.getState().config.communication.baudRate);
    this.startEsp32HealthPolling();
  }

  async disconnectEsp32(): Promise<void> {
    this.stopEsp32HealthPolling();
    await this.esp32Client?.disconnect();
    this.esp32Client = null;
    this.postToWorker({ type: "setCommOk", commOk: true });
  }

  setEsp32OutputArmed(armed: boolean): void {
    useAppStore.getState().setEsp32OutputArmed(armed);
  }

  async sendEsp32TestCommand(command: Command): Promise<void> {
    await this.esp32Client?.sendCommand(command);
  }

  private startEsp32HealthPolling(): void {
    this.stopEsp32HealthPolling();
    const timeoutMs = (useAppStore.getState().config.communication.timeoutS ?? 1.5) * 1000 || ESP32_HEALTH_TIMEOUT_MS_FALLBACK;
    const heartbeatIntervalMs = (useAppStore.getState().config.communication.heartbeatIntervalS ?? 0.5) * 1000;

    this.heartbeatTimer = window.setInterval(() => {
      this.esp32Client?.sendHeartbeat().catch(() => {
        /* surfaced via onError/health polling */
      });
    }, heartbeatIntervalMs);

    this.esp32HealthPollTimer = window.setInterval(() => {
      if (!this.esp32Client) return;
      const healthy = this.esp32Client.isHealthy(timeoutMs);
      useAppStore.getState().setEsp32CommHealthy(healthy);
      this.postToWorker({ type: "setCommOk", commOk: healthy });
    }, 250);
  }

  private stopEsp32HealthPolling(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.esp32HealthPollTimer !== null) {
      window.clearInterval(this.esp32HealthPollTimer);
      this.esp32HealthPollTimer = null;
    }
  }

  // ---- sample batching (reduces postMessage overhead) ----------------------
  private enqueueSample(sample: Sample): void {
    this.sampleBuffer.push(sample);
    if (this.flushHandle === null) {
      this.flushHandle = window.setTimeout(() => this.flushSampleBuffer(), 10);
    }
  }

  private flushSampleBuffer(): void {
    if (this.flushHandle !== null) {
      window.clearTimeout(this.flushHandle);
      this.flushHandle = null;
    }
    if (this.sampleBuffer.length === 0) return;
    const samples = this.sampleBuffer;
    this.sampleBuffer = [];
    this.postToWorker({ type: "samples", samples });
  }
}

export const appEngine = new AppEngine();
