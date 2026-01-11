import { useState, useEffect } from "react";
import "./App.css";

const BAND_VALUES = [0, 1, 3, 7, 8, 20];

function App() {
  const [selectedBands, setSelectedBands] = useState([]);
  const [activeBands, setActiveBands] = useState([]);
  const [userSelectedBands, setUserSelectedBands] = useState([]);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const fetchStatus = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/status");
      const data = await response.json();
      setSelectedBands(data.selectedBands || []);
      setActiveBands(data.activeBands || []);

      // Initialize userSelectedBands only on first fetch
      if (!isInitialized) {
        setUserSelectedBands(data.selectedBands || []);
        setIsInitialized(true);
      }
    } catch (error) {
      console.error("Error fetching status:", error);
      setStatus("Error fetching status");
      setTimeout(() => setStatus(""), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Fetch immediately on mount
    fetchStatus();

    // Set up interval to fetch every 30 seconds
    const interval = setInterval(fetchStatus, 30000);

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

  return (
    <div className="app">
      <div className="container">
        <h1>LTE Band Selector</h1>

        <button
          className="refresh-button"
          onClick={fetchStatus}
          disabled={isLoading}
        >
          {isLoading ? "Refreshing..." : "Refresh Status"}
        </button>

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

        <button
          className="save-button"
          onClick={handleSave}
          disabled={!hasChanges()}
        >
          Save
        </button>

        {status && <div className="status-message">{status}</div>}
      </div>
    </div>
  );
}

export default App;
