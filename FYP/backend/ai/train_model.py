#!/usr/bin/env python3
"""
Production-grade training pipeline for landslide prediction.

What it does:
1) Loads and validates CSV data
2) Builds engineered features
3) Searches multiple model families with CV
4) Selects best model by cross-validated accuracy
5) Evaluates on test split
6) Saves model artifact + metrics JSON
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import List, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, roc_auc_score
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

BASE_FEATURES = [
    "rainfall",
    "soil_moisture",
    "tilt_x",
    "tilt_y",
    "vibration",
    "temperature",
    "pressure",
]
TARGET = "landslide"
RANDOM_STATE = 42


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train landslide model with tuning.")
    parser.add_argument(
        "--dataset",
        default="data/landslide_dataset.csv",
        help="CSV path containing required base features and landslide target.",
    )
    parser.add_argument(
        "--output",
        default="landslide_model.pkl",
        help="Output model artifact path (.pkl).",
    )
    parser.add_argument(
        "--metrics-output",
        default="training_metrics.json",
        help="Where to write training metrics JSON.",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.2,
        help="Test split ratio.",
    )
    parser.add_argument(
        "--search-iters",
        type=int,
        default=20,
        help="Random search iterations per model family.",
    )
    parser.add_argument(
        "--cv-folds",
        type=int,
        default=3,
        help="Cross-validation folds for randomized search.",
    )
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


def build_candidates() -> List[Tuple[str, Pipeline]]:
    linear_pipe = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("model", LogisticRegression(max_iter=4000, random_state=RANDOM_STATE)),
        ]
    )

    rf_pipe = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            (
                "model",
                RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=1),
            ),
        ]
    )

    et_pipe = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            (
                "model",
                ExtraTreesClassifier(random_state=RANDOM_STATE, n_jobs=1),
            ),
        ]
    )

    hgb_pipe = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("model", HistGradientBoostingClassifier(random_state=RANDOM_STATE)),
        ]
    )

    # Fast but strong baseline candidates chosen from prior experiments.
    linear_pipe.set_params(model__C=1.0, model__class_weight=None)
    rf_pipe.set_params(
        model__n_estimators=320,
        model__max_depth=12,
        model__min_samples_split=4,
        model__min_samples_leaf=2,
        model__max_features="sqrt",
        model__class_weight="balanced",
    )
    et_pipe.set_params(
        model__n_estimators=420,
        model__max_depth=20,
        model__min_samples_split=2,
        model__min_samples_leaf=1,
        model__max_features="sqrt",
        model__class_weight=None,
    )
    hgb_pipe.set_params(
        model__learning_rate=0.05,
        model__max_depth=6,
        model__max_iter=260,
        model__min_samples_leaf=20,
        model__l2_regularization=0.01,
    )

    candidates = [
        ("logistic_regression", linear_pipe),
        ("random_forest", rf_pipe),
        ("extra_trees", et_pipe),
        ("hist_gradient_boosting", hgb_pipe),
    ]
    return candidates


def safe_probabilities(model: Pipeline, X: pd.DataFrame) -> np.ndarray:
    if hasattr(model, "predict_proba"):
        return model.predict_proba(X)[:, 1]
    if hasattr(model, "decision_function"):
        raw = model.decision_function(X)
        return 1 / (1 + np.exp(-raw))
    preds = model.predict(X)
    return preds.astype(float)


def main() -> int:
    args = parse_args()
    dataset_path = Path(args.dataset)
    output_path = Path(args.output)
    metrics_path = Path(args.metrics_output)

    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")

    df = pd.read_csv(dataset_path)
    required = BASE_FEATURES + [TARGET]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset missing columns: {missing}")

    df = df.dropna(subset=required).copy()
    if df.empty:
        raise ValueError("No usable rows after dropping NA values.")

    df[TARGET] = df[TARGET].astype(int)
    unique_labels = sorted(df[TARGET].unique().tolist())
    if unique_labels != [0, 1]:
        raise ValueError(f"Target must be binary 0/1. Found: {unique_labels}")

    base_X = df[BASE_FEATURES]
    y = df[TARGET]

    X = add_engineered_features(base_X)
    model_features = list(X.columns)

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=args.test_size,
        random_state=RANDOM_STATE,
        stratify=y,
    )

    candidates = build_candidates()

    candidate_results = []
    best_name = None
    best_score = float("-inf")
    best_estimator = None
    best_params = {}

    for name, pipe in candidates:
        cv_scores = cross_val_score(
            pipe,
            X_train,
            y_train,
            scoring="accuracy",
            cv=max(2, int(args.cv_folds)),
            n_jobs=1,
        )
        cv_best = float(np.mean(cv_scores))
        candidate_results.append(
            {
                "name": name,
                "cv_accuracy": cv_best,
                "cv_std": float(np.std(cv_scores)),
                "params": pipe.named_steps["model"].get_params(),
            }
        )
        if cv_best > best_score:
            best_score = cv_best
            best_name = name
            best_estimator = pipe
            best_params = pipe.named_steps["model"].get_params()

    if best_estimator is None:
        raise RuntimeError("No model was trained.")

    best_estimator.fit(X_train, y_train)
    y_pred = best_estimator.predict(X_test)
    y_prob = safe_probabilities(best_estimator, X_test)

    test_accuracy = float(accuracy_score(y_test, y_pred))
    test_auc = float(roc_auc_score(y_test, y_prob))
    report = classification_report(y_test, y_pred, output_dict=True, zero_division=0)
    cm = confusion_matrix(y_test, y_pred).tolist()

    payload = {
        "model": best_estimator,
        "base_features": BASE_FEATURES,
        "model_features": model_features,
        "metadata": {
            "selected_model": best_name,
            "cv_accuracy": best_score,
            "test_accuracy": test_accuracy,
            "test_roc_auc": test_auc,
            "samples": int(len(df)),
            "train_samples": int(len(X_train)),
            "test_samples": int(len(X_test)),
            "best_params": best_params,
            "random_state": RANDOM_STATE,
        },
    }

    metrics = {
        "summary": payload["metadata"],
        "candidates": candidate_results,
        "classification_report": report,
        "confusion_matrix": cm,
        "class_balance": {
            "negative_0": int((y == 0).sum()),
            "positive_1": int((y == 1).sum()),
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    metrics_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(payload, output_path)
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "status": "ok",
                "model_path": str(output_path),
                "metrics_path": str(metrics_path),
                "selected_model": best_name,
                "cv_accuracy": round(best_score, 4),
                "test_accuracy": round(test_accuracy, 4),
                "test_roc_auc": round(test_auc, 4),
                "samples": int(len(df)),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
