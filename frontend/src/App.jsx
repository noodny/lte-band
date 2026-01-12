import { useState, useEffect } from "react";
import "./App.css";

const BAND_VALUES = [1, 3, 7, 8, 20];

function App() {
  const [selectedBands, setSelectedBands] = useState([]);
  const [activeBands, setActiveBands] = useState([]);
  const [userSelectedBands, setUserSelectedBands] = useState([]);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [metrics, setMetrics] = useState({
    rssi: null,
    rsrp: null,
    cinr: null,
    rsrq: null,
  });
  const [speedtest, setSpeedtest] = useState({
    download: null,
    upload: null,
    ping: null,
    timestamp: null,
    isRunning: false,
    error: null,
  });

  const fetchStatus = async () => {
    setIsLoading(true);
    const startTime = Date.now();

    try {
      const response = await fetch("/status");

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      setSelectedBands(data.selectedBands || []);
      setActiveBands(data.activeBands || []);
      setMetrics({
        rssi: data.rssi,
        rsrp: data.rsrp,
        cinr: data.cinr,
        rsrq: data.rsrq,
      });
      if (data.speedtest) {
        setSpeedtest({
          download: data.speedtest.download,
          upload: data.speedtest.upload,
          ping: data.speedtest.ping,
          timestamp: data.speedtest.timestamp,
          isRunning: data.speedtest.isRunning || false,
          error: data.speedtest.error || null,
        });
      }
      setFetchError(false);
      setStatus("");

      // Initialize userSelectedBands only on first fetch
      if (!isInitialized) {
        setUserSelectedBands(data.selectedBands || []);
        setIsInitialized(true);
      }

      return true;
    } catch (error) {
      console.error("Error fetching status:", error);
      setFetchError(true);
      setStatus(`${error.message}`);
      return false;
    } finally {
      // Ensure minimum 500ms before resolving
      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, 500 - elapsed);

      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Fetch immediately on mount
    fetchStatus();

    // Set up interval to fetch every 5 seconds
    const interval = setInterval(fetchStatus, 5000);

    // Cleanup interval on unmount
    return () => clearInterval(interval);
  }, []);

  const toggleBand = (value) => {
    setUserSelectedBands((prev) => {
      if (prev.includes(value)) {
        // Remove from selection
        return prev.filter((band) => band !== value);
      } else {
        // Add to selection
        return [...prev, value];
      }
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bands: userSelectedBands,
        }),
      });

      const data = await response.json();
      setStatus("Saved successfully!");
      setTimeout(() => setStatus(""), 3000);
    } catch (error) {
      setStatus("Error saving data");
      console.error("Error:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunSpeedtest = async () => {
    try {
      const response = await fetch("/speedtest", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to start speedtest");
      }

      // Immediately mark as running
      setSpeedtest((prev) => ({ ...prev, isRunning: true }));
    } catch (error) {
      setStatus("Error starting speedtest");
      setTimeout(() => setStatus(""), 3000);
      console.error("Error:", error);
    }
  };

  const getBandClassName = (value) => {
    const isActive = activeBands.includes(value);
    const isSelected = userSelectedBands.includes(value);

    if (isActive && isSelected) return "band-button active-band";
    if (isSelected) return "band-button selected-band";
    return "band-button";
  };

  const hasChanges = () => {
    if (userSelectedBands.length !== selectedBands.length) return true;
    const sortedUser = [...userSelectedBands].sort((a, b) => a - b);
    const sortedSelected = [...selectedBands].sort((a, b) => a - b);
    return !sortedUser.every((band, index) => band === sortedSelected[index]);
  };

  const getMetricClass = (metricName, value) => {
    if (metricName === "cinr" && value !== null) {
      return value >= 10 ? "metric-good" : "metric-warning";
    }
    if (metricName === "rsrq" && value) {
      // Parse RSRQ value (format might be "(-15)" or "-15")
      const numValue = parseFloat(value.replace(/[()]/g, ""));
      if (!isNaN(numValue)) {
        return numValue >= -15 ? "metric-good" : "metric-warning";
      }
    }
    return "";
  };

  return (
    <div className="app">
      <div className="container">
        <h1>LTE Band Selector</h1>

        <div className="band-grid">
          {BAND_VALUES.map((value) => (
            <div
              key={value}
              className={getBandClassName(value)}
              onClick={() => toggleBand(value)}
              style={{ cursor: "pointer" }}
            >
              <span className="band-label">Band</span>
              <span className="band-value">{value}</span>
              {activeBands.includes(value) && (
                <span className="band-status">Active</span>
              )}
              {userSelectedBands.includes(value) &&
                !activeBands.includes(value) && (
                  <span className="band-status">Selected</span>
                )}
              {!userSelectedBands.includes(value) &&
                !activeBands.includes(value) && (
                  <span className="band-status">&nbsp;</span>
                )}
            </div>
          ))}
        </div>

        {(metrics.rssi || metrics.rsrp || metrics.cinr || metrics.rsrq) && (
          <div className="metrics-display">
            {metrics.rssi && <span>RSSI: {metrics.rssi}</span>}
            {metrics.rsrp && <span>RSRP: {metrics.rsrp}</span>}
            {metrics.cinr !== null && (
              <span className={getMetricClass("cinr", metrics.cinr)}>
                CINR: {metrics.cinr}
              </span>
            )}
            {metrics.rsrq && (
              <span className={getMetricClass("rsrq", metrics.rsrq)}>
                RSRQ: {metrics.rsrq}
              </span>
            )}
          </div>
        )}

        {(speedtest.download ||
          speedtest.upload ||
          speedtest.ping ||
          speedtest.isRunning ||
          speedtest.error) && (
          <div className="speedtest-display">
            <div className="speedtest-header">
              <div className="speedtest-title">Speed Test</div>
              <button
                className="speedtest-refresh-button"
                onClick={handleRunSpeedtest}
                disabled={speedtest.isRunning}
                title="Run speed test"
              >
                {speedtest.isRunning ? "Running..." : "↻"}
              </button>
            </div>
            {speedtest.isRunning ? (
              <div className="speedtest-running">
                Running speed test, please wait...
              </div>
            ) : speedtest.error ? (
              <div className="speedtest-error">Error: {speedtest.error}</div>
            ) : (
              <>
                <div className="speedtest-results">
                  {speedtest.download !== null && (
                    <span>
                      ↓ {(speedtest.download / 125000).toFixed(2)} Mbps
                    </span>
                  )}
                  {speedtest.upload !== null && (
                    <span>↑ {(speedtest.upload / 125000).toFixed(2)} Mbps</span>
                  )}
                  {speedtest.ping !== null && (
                    <span>Ping: {speedtest.ping.toFixed(0)}ms</span>
                  )}
                </div>
                {speedtest.timestamp && (
                  <div className="speedtest-time">
                    Last: {new Date(speedtest.timestamp).toLocaleTimeString()}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <button
          className="save-button"
          onClick={handleSave}
          disabled={!hasChanges() || isSaving}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>

        {status && (
          <div className={`status-message ${fetchError ? "error" : ""}`}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
