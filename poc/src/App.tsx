import { createSignal, onMount, Show } from "solid-js";
import { LandingPage } from "./components/pages/LandingPage.tsx";
import { Header } from "./components/Header.tsx";
import { SimulationPage } from "./components/pages/SimulationPage.tsx";
import { type Metrics, Simulation } from "./components/Simulation.tsx";

function App() {
    const [visible, setVisible] = createSignal(false);
    const [isSim, setIsSim] = createSignal(false);

    const [isRunning, setIsRunning] = createSignal(true);
    const [avgDailyVolatility, setAvgDailyVolatility] = createSignal(5);
    const [speed, setSpeed] = createSignal(100);

    const [metrics, setMetrics] = createSignal<Metrics | undefined>();

    onMount(() => {
        const loader = document.getElementById("loader");
        if (!loader) return;

        setTimeout(() => {
            loader.parentElement?.removeChild(loader);
            setVisible(true);
        }, 2000);
    });

    const toggleSim = () => setIsSim((s) => !s);

    return (
        <Show when={visible()}>
            <Header isSim={isSim()} toggleSim={toggleSim} />
            <Simulation
                isRunning={isRunning()}
                volatility={avgDailyVolatility()}
                speed={speed()}
                updMetrics={setMetrics}
                isSim={isSim()}
            />

            <Show
                when={isSim() && metrics()}
                fallback={<LandingPage isSim={isSim()} toggleSim={toggleSim} />}
            >
                <SimulationPage
                    metrics={metrics()!}
                    isSim={isSim()}
                    toggleSim={toggleSim}
                    speed={speed()}
                    setSpeed={setSpeed}
                    volatility={avgDailyVolatility()}
                    setVolatility={setAvgDailyVolatility}
                    isRunning={isRunning()}
                    toggleRunning={() => setIsRunning((r) => !r)}
                />
            </Show>
        </Show>
    );
}

export default App;
