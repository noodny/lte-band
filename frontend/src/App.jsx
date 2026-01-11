import { useState } from "react";
import "./App.css";

const BAND_VALUES = [1, 3, 7, 8, 20];

function App() {
  const [selectedBands, setSelectedBands] = useState(new Set());
  const [status, setStatus] = useState("");

  const toggleBand = (value) => {
    const newSelected = new Set(selectedBands);
    if (newSelected.has(value)) {
      newSelected.delete(value);
    } else {
      newSelected.add(value);
    }
    setSelectedBands(newSelected);
  };

  const handleSave = async () => {
    try {
      const response = await fetch("/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bands: Array.from(selectedBands),
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

  return (
    <div className="app">
      <div className="container">
        <h1>LTE Band Selector</h1>

        <div className="band-grid">
          {BAND_VALUES.map((value) => (
            <button
              key={value}
              className={`band-button ${
                selectedBands.has(value) ? "active" : ""
              }`}
              onClick={() => toggleBand(value)}
            >
              <span className="band-label">Band</span>
              <span className="band-value">{value}</span>
            </button>
          ))}
        </div>

        <button className="save-button" onClick={handleSave}>
          Save
        </button>

        {status && <div className="status-message">{status}</div>}
      </div>
    </div>
  );
}

export default App;
