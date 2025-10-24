"use client";

import { useEffect, useMemo, useState } from "react";
import Particles, { initParticlesEngine } from "@tsparticles/react";
import type { Engine } from "@tsparticles/engine";
import { loadSlim } from "@tsparticles/slim";
import type { ISourceOptions } from "@tsparticles/engine";
import { useTheme } from "@/context/ThemeContext";

type ParticlesBackgroundProps = {
  variant?: "default" | "subtle";
};

export default function ParticlesBackground({ variant = "default" }: ParticlesBackgroundProps) {
  const [ready, setReady] = useState(false);
  const { theme } = useTheme();

  useEffect(() => {
    initParticlesEngine(async (engine: Engine) => {
      await loadSlim(engine);
    }).then(() => setReady(true));
  }, []);

  const options = useMemo<ISourceOptions>(() => {
    const baseDensity = variant === "subtle" ? 30 : 50;
    const twinkleOpacity = variant === "subtle" ? 0.25 : 0.4;
    const moveSpeed = variant === "subtle" ? 0.3 : 0.4;
    const backgroundColor = theme === "light" ? "#f7f9fc" : "#050505";
    const particleColor = theme === "light" ? "#0f172a" : "#ffffff";

    return {
      background: {
        color: backgroundColor,
      },
      fullScreen: {
        enable: false,
      },
      fpsLimit: 60,
      particles: {
        color: {
          value: particleColor,
        },
        move: {
          direction: "none",
          enable: true,
          outModes: {
            default: "out",
          },
          random: false,
          speed: moveSpeed,
          straight: false,
        },
        number: {
          density: {
            enable: true,
            area: 800,
          },
          value: baseDensity,
        },
        opacity: {
          value: { min: 0.05, max: 0.3 },
        },
        shape: {
          type: "circle",
        },
        size: {
          value: { min: 1, max: 3 },
        },
        twinkle: {
          particles: {
            enable: true,
            frequency: 0.05,
            opacity: twinkleOpacity,
          },
        },
      },
      detectRetina: true,
    };
  }, [variant, theme]);

  if (!ready) {
    return null;
  }

  return (
    <Particles
      id="particles-background"
      className="absolute inset-0 -z-10"
      options={options}
    />
  );
}
