#!/usr/bin/env python3
"""
Model inference CLI for landslide prediction.
Outputs JSON: {"prediction": 0|1, "probability": float}
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

BASE_FEATURES = [
    "rainfall",
    "soil_moisture",
    "tilt_x",
    "tilt_y",
    "vibration",
    "temperature",
    "pressure",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Predict landslide risk.")
    parser.add_argument("--model", default="landslide_model.pkl", help="Model path")
    parser.add_argument("rainfall", type=float)
    parser.add_argument("soil_moisture", type=float)
    parser.add_argument("tilt_x", type=float)
    parser.add_argument("tilt_y", type=float)
    parser.add_argument("vibration", type=float)
    parser.add_argument("temperature", type=float)
    parser.add_argument("pressure", type=float)
    return parser.parse_args()


def add_engineered_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["tilt_magnitude"] = np.sqrt((out["tilt_x"] ** 2) + (out["tilt_y"] ** 2))
    out["tilt_abs_delta"] = np.abs(out["tilt_x"] - out["tilt_y"])
    out["rain_soil_interaction"] = out["rainfall"] * out["soil_moisture"]
    out["rain_tilt_interaction"] = out["rainfall"] * out["tilt_magnitude"]
    out["vibration_tilt_interaction"] = out["vibration"] * out["tilt_magnitude"]
    out["temp_pressure_interaction"] = out["temperature"] * out["pressure"]
    return out


def safe_probability(model, X: pd.DataFrame) -> float:
    if hasattr(model, "predict_proba"):
        return float(model.predict_proba(X)[0][1])
    if hasattr(model, "decision_function"):
        value = float(model.decision_function(X)[0])
        return float(1 / (1 + np.exp(-value)))
    pred = int(model.predict(X)[0])
    return float(pred)


def main() -> int:
    args = parse_args()
    model_path = Path(args.model)
    if not model_path.exists():
        raise FileNotFoundError(f"Model file not found: {model_path}")

    payload = joblib.load(model_path)
    model = payload["model"] if isinstance(payload, dict) and "model" in payload else payload
    model_features = (
        payload.get("model_features")
        if isinstance(payload, dict) and payload.get("model_features")
        else BASE_FEATURES
    )

    base_row = pd.DataFrame(
        [
            {
                "rainfall": args.rainfall,
                "soil_moisture": args.soil_moisture,
                "tilt_x": args.tilt_x,
                "tilt_y": args.tilt_y,
                "vibration": args.vibration,
                "temperature": args.temperature,
                "pressure": args.pressure,
            }
        ],
        columns=BASE_FEATURES,
    )
    full_row = add_engineered_features(base_row)
    X = full_row[model_features]

    probability = safe_probability(model, X)
    probability = float(max(0.0, min(1.0, probability)))
    prediction = int(1 if probability >= 0.5 else 0)

    print(
        json.dumps(
            {
                "prediction": prediction,
                "probability": round(probability, 6),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
