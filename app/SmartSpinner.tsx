"use client";

import { useEffect, useRef, useState } from "react";

const OUTCOMES = ["1", "2", "3", "4"];
const DOWN_ANGLE = 180;
const GRAVITY_ACCEL = 2500;
const DRAG_LINEAR = 0.4;
const DRAG_QUADRATIC = 0.00011;
const END_DAMPING_BOOST = 2.6;
const END_DAMPING_WINDOW_DEG = 15;
const IMPULSE_MIN = 2400;
const IMPULSE_MAX = 3200;
const MAX_DT_SECONDS = 0.033;
const STOP_SPEED = 1.8;
const STOP_ANGLE_ERROR = 0.9;
const STOP_STABLE_FRAMES = 18;

type DeviceMotionPermissionApi = {
  requestPermission?: () => Promise<"granted" | "denied">;
};

type ConfettiPiece = {
  id: number;
  left: number;
  delay: number;
  duration: number;
  drift: number;
  rotation: number;
  color: string;
};

function normalize(value: number): number {
  return ((value % 360) + 360) % 360;
}

function angleDiff(target: number, current: number): number {
  return normalize(target - current + 180) - 180;
}

function getResultFromRotation(rotation: number): string {
  const segmentSize = 360 / OUTCOMES.length;
  const wheelOffset = 45;
  const arrowAngle = normalize(rotation);
  const segmentIndex = Math.floor(normalize(arrowAngle - wheelOffset) / segmentSize) % OUTCOMES.length;
  return OUTCOMES[segmentIndex] ?? "?";
}

function detectMobile(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const ua = navigator.userAgent.toLowerCase();
  const touch = navigator.maxTouchPoints > 1;
  return /iphone|ipad|ipod|android|mobile/.test(ua) || touch;
}

export default function SmartSpinner() {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState("click spin");
  const [gravityMode, setGravityMode] = useState<"simulated" | "device">("simulated");
  const [sensorStatus, setSensorStatus] = useState(() =>
    detectMobile() ? "gravity: mobile detected, tap enable mobile gravity" : "gravity: desktop fixed down",
  );
  const [isMobile] = useState(() => detectMobile());
  const [confettiPieces, setConfettiPieces] = useState<ConfettiPiece[]>([]);

  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const rotationRef = useRef(0);
  const velocityRef = useRef(0);
  const settleFramesRef = useRef(0);
  const gravityTargetRef = useRef(DOWN_ANGLE);
  const hasSensorRef = useRef(false);
  const motionHandlerRef = useRef<((event: DeviceMotionEvent) => void) | null>(null);
  const motionTimeoutRef = useRef<number | null>(null);
  const gongAudioRef = useRef<HTMLAudioElement | null>(null);
  const tadaAudioRef = useRef<HTMLAudioElement | null>(null);
  const confettiTimeoutRef = useRef<number | null>(null);

  const playSound = (audioRef: React.RefObject<HTMLAudioElement | null>) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Ignore autoplay restrictions.
    });
  };

  const spawnConfetti = () => {
    const colors = ["#ff3b3b", "#ffd60a", "#00c853", "#2979ff", "#ff6d00", "#d500f9"];
    const pieces: ConfettiPiece[] = Array.from({ length: 48 }, (_, index) => ({
      id: index + Date.now(),
      left: Math.random() * 100,
      delay: Math.random() * 140,
      duration: 900 + Math.random() * 1000,
      drift: -120 + Math.random() * 240,
      rotation: -260 + Math.random() * 520,
      color: colors[index % colors.length] ?? "#ff3b3b",
    }));

    setConfettiPieces(pieces);

    if (confettiTimeoutRef.current !== null) {
      window.clearTimeout(confettiTimeoutRef.current);
    }

    confettiTimeoutRef.current = window.setTimeout(() => {
      setConfettiPieces([]);
      confettiTimeoutRef.current = null;
    }, 2300);
  };

  const stopMotionSensor = () => {
    if (motionHandlerRef.current) {
      window.removeEventListener("devicemotion", motionHandlerRef.current);
      motionHandlerRef.current = null;
    }

    if (motionTimeoutRef.current !== null) {
      window.clearTimeout(motionTimeoutRef.current);
      motionTimeoutRef.current = null;
    }
  };

  const enableSimulatedGravity = () => {
    stopMotionSensor();
    gravityTargetRef.current = DOWN_ANGLE;
    setGravityMode("simulated");
    setSensorStatus(isMobile ? "gravity: simulated down (mobile)" : "gravity: desktop fixed down");
  };

  const applyMotionGravity = (event: DeviceMotionEvent) => {
    const accel = event.accelerationIncludingGravity;
    if (!accel || accel.x === null || accel.y === null) {
      return;
    }

    const x = accel.x;
    const y = accel.y;
    if (Math.abs(x) + Math.abs(y) < 1) {
      return;
    }

    hasSensorRef.current = true;
    const angle = normalize((Math.atan2(x, -y) * 180) / Math.PI);
    gravityTargetRef.current = angle;
    setSensorStatus(`gravity: mobile sensor (${Math.round(angle)}deg)`);
  };

  const enableDeviceGravity = async () => {
    if (typeof window === "undefined") {
      return;
    }

    if (!isMobile) {
      enableSimulatedGravity();
      return;
    }

    stopMotionSensor();

    const maybePermissionApi = DeviceMotionEvent as unknown as DeviceMotionPermissionApi;
    if (typeof maybePermissionApi.requestPermission === "function") {
      try {
        const permission = await maybePermissionApi.requestPermission();
        if (permission !== "granted") {
          setSensorStatus("gravity: sensor denied, using simulated down");
          enableSimulatedGravity();
          return;
        }
      } catch {
        setSensorStatus("gravity: sensor error, using simulated down");
        enableSimulatedGravity();
        return;
      }
    }

    hasSensorRef.current = false;
    setGravityMode("device");
    setSensorStatus("gravity: reading mobile sensor...");

    const handler = (event: DeviceMotionEvent) => {
      applyMotionGravity(event);
    };

    motionHandlerRef.current = handler;
    window.addEventListener("devicemotion", handler);
    motionTimeoutRef.current = window.setTimeout(() => {
      if (!hasSensorRef.current) {
        setSensorStatus("gravity: no mobile sensor data, using simulated down");
        enableSimulatedGravity();
      }
    }, 1200);
  };

  const stopSimulation = (finalRotation: number) => {
    setSpinning(false);
    setRotation(finalRotation);
    rotationRef.current = finalRotation;
    velocityRef.current = 0;
    settleFramesRef.current = 0;
    setResult(getResultFromRotation(finalRotation));
    playSound(tadaAudioRef);
    spawnConfetti();
    lastTimeRef.current = null;
    rafRef.current = null;
  };

  const step = (now: number) => {
    if (lastTimeRef.current === null) {
      lastTimeRef.current = now;
      rafRef.current = requestAnimationFrame(step);
      return;
    }

    const dtSeconds = Math.min((now - lastTimeRef.current) / 1000, MAX_DT_SECONDS);
    lastTimeRef.current = now;

    const currentRotation = rotationRef.current;
    const currentVelocity = velocityRef.current;
    const gravityTarget = gravityTargetRef.current;
    const settleError = Math.abs(angleDiff(gravityTarget, currentRotation));

    const nearBottomFactor = Math.max(0, 1 - settleError / END_DAMPING_WINDOW_DEG);
    const adaptiveLinearDamping = DRAG_LINEAR + END_DAMPING_BOOST * nearBottomFactor * nearBottomFactor;

    const gravityTorque = GRAVITY_ACCEL * Math.sin(((gravityTarget - currentRotation) * Math.PI) / 180);
    const dragTorque =
      -adaptiveLinearDamping * currentVelocity - DRAG_QUADRATIC * currentVelocity * Math.abs(currentVelocity);
    const angularAcceleration = gravityTorque + dragTorque;

    const nextVelocity = currentVelocity + angularAcceleration * dtSeconds;
    const nextRotation = currentRotation + nextVelocity * dtSeconds;

    velocityRef.current = nextVelocity;
    rotationRef.current = nextRotation;
    setRotation(nextRotation);

    const settleErrorNext = Math.abs(angleDiff(gravityTarget, nextRotation));
    if (Math.abs(nextVelocity) < STOP_SPEED && settleErrorNext < STOP_ANGLE_ERROR) {
      settleFramesRef.current += 1;
    } else {
      settleFramesRef.current = 0;
    }

    if (settleFramesRef.current >= STOP_STABLE_FRAMES) {
      stopSimulation(gravityTargetRef.current);
      return;
    }

    rafRef.current = requestAnimationFrame(step);
  };

  const spin = () => {
    if (spinning) {
      return;
    }

    if (isMobile && gravityMode !== "device") {
      void enableDeviceGravity();
    }

    const direction = Math.random() > 0.5 ? 1 : -1;
    const impulse = IMPULSE_MIN + Math.random() * (IMPULSE_MAX - IMPULSE_MIN);

    playSound(gongAudioRef);

    velocityRef.current = direction * impulse;
    rotationRef.current = rotation;
    settleFramesRef.current = 0;

    setSpinning(true);
    lastTimeRef.current = null;

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    gravityTargetRef.current = DOWN_ANGLE;

    return () => {
      stopMotionSensor();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (confettiTimeoutRef.current !== null) {
        window.clearTimeout(confettiTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="blank-page">
      <div className="confetti-layer" aria-hidden="true">
        {confettiPieces.map((piece) => (
          <span
            key={piece.id}
            className="confetti-piece"
            style={{
              left: `${piece.left}%`,
              background: piece.color,
              animationDuration: `${piece.duration}ms`,
              animationDelay: `${piece.delay}ms`,
              ["--confetti-drift" as string]: `${piece.drift}px`,
              ["--confetti-rotate" as string]: `${piece.rotation}deg`,
            }}
          />
        ))}
      </div>

      <div className="basic-layout">
        <div className="basic-spinner-wrap">
          <div className="basic-wheel" aria-label="spinner wheel">
            <div className="basic-arrow-arm" style={{ transform: `translate(-50%, -100%) rotate(${rotation}deg)` }}>
              <div className="basic-arrow-head" />
            </div>
            <div className="basic-hub" />
          </div>

          <button type="button" onClick={spin} disabled={spinning}>
            {spinning ? "spinning..." : "spin"}
          </button>
          {isMobile ? (
            <button type="button" onClick={enableDeviceGravity} disabled={gravityMode === "device"}>
              {gravityMode === "device" ? "mobile gravity on" : "enable mobile gravity"}
            </button>
          ) : null}
            <button type="button" onClick={enableSimulatedGravity} disabled={gravityMode === "simulated"}>
            simulated gravity
          </button>
          <p>{sensorStatus}</p>
          <p>result: {result}</p>
          <audio ref={gongAudioRef} src="/gong.mp3" preload="auto" />
          <audio ref={tadaAudioRef} src="/tada.mp3" preload="auto" />
        </div>
      </div>
    </div>
  );
}
