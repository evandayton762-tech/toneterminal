jest.mock("fluent-ffmpeg", () => {
  type Handler = () => void;
  type MockChain = {
    audioFrequency: jest.Mock<MockChain, []>;
    audioChannels: jest.Mock<MockChain, []>;
    audioCodec: jest.Mock<MockChain, []>;
    format: jest.Mock<MockChain, []>;
    duration: jest.Mock<MockChain, []>;
    output: jest.Mock<MockChain, [string]>;
    on: jest.Mock<MockChain, [string, Handler]>;
    run: jest.Mock<void, []>;
    __targetPath?: string;
    __endHandler?: Handler;
    __errorHandler?: Handler;
  };

  const createChain = (): MockChain => {
    const chain = {} as MockChain;
    const returnSelf = () => chain;

    chain.audioFrequency = jest.fn(returnSelf);
    chain.audioChannels = jest.fn(returnSelf);
    chain.audioCodec = jest.fn(returnSelf);
    chain.format = jest.fn(returnSelf);
    chain.duration = jest.fn(returnSelf);
    chain.output = jest.fn((path: string) => {
      chain.__targetPath = path;
      return chain;
    });
    chain.on = jest.fn((event: string, handler: Handler) => {
      if (event === "end") {
        chain.__endHandler = handler;
      } else if (event === "error") {
        chain.__errorHandler = handler;
      }
      return chain;
    });
    chain.run = jest.fn(() => {
      if (typeof chain.__targetPath === "string") {
        writeFileSync(chain.__targetPath, Buffer.alloc(1024));
      }
      chain.__endHandler?.();
    });

    return chain;
  };

  const factory = jest.fn(() => createChain());
  factory.setFfmpegPath = jest.fn();
  return factory;
});

jest.mock("../src/lib/transcription", () => ({
  transcribe15s: jest.fn().mockResolvedValue(""),
}));

jest.mock("essentia.js", () => {
  class MockVector {
    private values: number[];

    constructor(values: number[]) {
      this.values = values;
    }

    size() {
      return this.values.length;
    }

    get(index: number) {
      const value = this.values[index] ?? 0;
      if (Array.isArray(value)) {
        return { values: value };
      }
      return value;
    }

    toArray() {
      return this.values;
    }
  }

  class MockEssentia {
    arrayToVector(input: ArrayLike<number>) {
      return new MockVector(Array.from(input as ArrayLike<number>));
    }

    vectorToArray(vector: unknown) {
      if (vector instanceof MockVector) {
        return vector.toArray();
      }
      if (Array.isArray(vector)) {
        return vector;
      }
      if (typeof vector === "number") {
        return [vector];
      }
      if (vector && typeof vector === "object" && "values" in (vector as Record<string, unknown>)) {
        return Array.isArray((vector as { values: unknown }).values)
          ? ((vector as { values: unknown[] }).values as number[])
          : [];
      }
      return [];
    }

    RhythmExtractor2013() {
      return { bpm: 120 };
    }

    SpectralCentroidTime() {
      return { centroid: 440 };
    }

    LowLevelSpectralExtractor() {
      return {
        mfcc: {
          size: () => 1,
          get: () => new MockVector(Array(13).fill(0.1)),
        },
        pitch: {
          size: () => 2,
          get: (index: number) => (index === 0 ? 220 : 221),
        },
        spectral_rms: {
          size: () => 2,
          get: () => 0.5,
        },
        spectral_flux: {
          size: () => 2,
          get: () => 0.3,
        },
        spectral_rolloff: new MockVector([2000]),
        pitch_salience: new MockVector([0.8]),
      };
    }

    FrameGenerator() {
      return {
        size: () => 0,
        get: () => null,
      };
    }

    Windowing(frame: unknown) {
      return { frame };
    }

    Spectrum() {
      return { spectrum: new MockVector([]) };
    }

    SpectralPeaks() {
      return {
        frequencies: new MockVector([500, 1500, 2500]),
        magnitudes: new MockVector([1, 0.8, 0.6]),
      };
    }
  }

  return {
    __esModule: true,
    EssentiaWASM: {},
    Essentia: MockEssentia,
  };
});

import { extractMetrics } from "../src/workers/metrics.worker";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

describe("metrics worker stub", () => {
  it("returns default structure", async () => {
    const samplePath = join(__dirname, "data", "clip.mp3");
    const buffer = readFileSync(samplePath);
    const metrics = await extractMetrics(buffer);

    expect(metrics).toHaveProperty("tempo_bpm");
    expect(metrics).toHaveProperty("centroid_hz");
    expect(metrics).toHaveProperty("mfcc_mean");
    expect(metrics).toHaveProperty("rms_lufs");
    expect(Array.isArray(metrics.mfcc_mean)).toBe(true);
  });
});
