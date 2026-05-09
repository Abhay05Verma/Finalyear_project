const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

class AIPredictionService {
  constructor() {
    this.pythonExecutable = this.resolvePythonExecutable();
    this.aiDir = path.resolve(__dirname, '..', 'ai');
    this.predictScript = path.join(this.aiDir, 'predict.py');
    this.modelPath = path.join(this.aiDir, 'landslide_model.pkl');
    this.timeoutMs = Number(process.env.AI_PREDICTION_TIMEOUT_MS || 8000);
  }

  resolvePythonExecutable() {
    if (process.env.PYTHON_EXECUTABLE) {
      return process.env.PYTHON_EXECUTABLE;
    }

    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const pythonRoot = path.join(localAppData, 'Programs', 'Python');
      if (fs.existsSync(pythonRoot)) {
        try {
          const candidates = fs
            .readdirSync(pythonRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(pythonRoot, entry.name, 'python.exe'))
            .filter((candidate) => fs.existsSync(candidate))
            .sort()
            .reverse();

          if (candidates.length > 0) {
            return candidates[0];
          }
        } catch (error) {
          console.warn('Failed to auto-discover python.exe:', error.message);
        }
      }
    }

    return 'python';
  }

  getRiskLevelFromProbability(probability) {
    if (probability >= 0.7) return 'high';
    if (probability >= 0.35) return 'medium';
    return 'low';
  }

  async predict(sensorValues) {
    const args = [
      this.predictScript,
      '--model',
      this.modelPath,
      String(toFiniteNumber(sensorValues.rainfall)),
      String(toFiniteNumber(sensorValues.soil_moisture)),
      String(toFiniteNumber(sensorValues.tilt_x)),
      String(toFiniteNumber(sensorValues.tilt_y)),
      String(toFiniteNumber(sensorValues.vibration)),
      String(toFiniteNumber(sensorValues.temperature)),
      String(toFiniteNumber(sensorValues.pressure))
    ];

    const output = await new Promise((resolve, reject) => {
      execFile(
        this.pythonExecutable,
        args,
        { timeout: this.timeoutMs, cwd: this.aiDir },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                `AI prediction failed: ${error.message}${stderr ? ` | ${stderr.trim()}` : ''}`
              )
            );
            return;
          }
          resolve(stdout);
        }
      );
    });

    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new Error(`AI prediction returned invalid JSON: ${String(output).trim()}`);
    }

    const probabilityRaw = toFiniteNumber(parsed.probability, 0);
    const probability = Math.max(0, Math.min(1, probabilityRaw));
    const prediction = toFiniteNumber(parsed.prediction, probability >= 0.5 ? 1 : 0) >= 1 ? 1 : 0;
    const riskScore = Math.round(probability * 100);
    const riskLevel = this.getRiskLevelFromProbability(probability);

    return {
      prediction,
      probability,
      riskScore,
      riskLevel,
      source: 'ai'
    };
  }

  async getHealthStatus() {
    const scriptExists = fs.existsSync(this.predictScript);
    const modelExists = fs.existsSync(this.modelPath);

    let pythonAvailable = false;
    let pythonVersion = null;
    let pythonError = null;

    await new Promise((resolve) => {
      execFile(this.pythonExecutable, ['--version'], { timeout: 5000 }, (error, stdout, stderr) => {
        if (error) {
          pythonError = error.message;
          resolve();
          return;
        }
        pythonAvailable = true;
        pythonVersion = String(stdout || stderr || '').trim() || null;
        resolve();
      });
    });

    const ready = scriptExists && modelExists && pythonAvailable;
    return {
      ready,
      python: {
        executable: this.pythonExecutable,
        available: pythonAvailable,
        version: pythonVersion,
        error: pythonError
      },
      files: {
        predict_script: {
          path: this.predictScript,
          exists: scriptExists
        },
        model: {
          path: this.modelPath,
          exists: modelExists
        }
      },
      checked_at: new Date().toISOString()
    };
  }
}

module.exports = new AIPredictionService();
