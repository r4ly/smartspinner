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

function normalize(value: number): number {
  return ((value % 360) + 360) % 360;
}

function angleDiff(target: number, current: number): number {
  const diff = normalize(target - current + 180) - 180;
  return diff;
}

function getResultFromRotation(rotation: number): string {
  const segmentSize = 360 / OUTCOMES.length;
  const wheelOffset = 45;
  const arrowAngle = normalize(rotation);
  const segmentIndex = Math.floor(normalize(arrowAngle - wheelOffset) / segmentSize) % OUTCOMES.length;
  return OUTCOMES[segmentIndex] ?? "?";
}

export default function SmartSpinner() {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState("click spin");

  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const rotationRef = useRef(0);
  const velocityRef = useRef(0);
  const settleFramesRef = useRef(0);

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const stopSimulation = (finalRotation: number) => {
    setSpinning(false);
    setRotation(finalRotation);
    rotationRef.current = finalRotation;
    velocityRef.current = 0;
    settleFramesRef.current = 0;
    setResult(getResultFromRotation(finalRotation));
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
    const settleError = Math.abs(angleDiff(DOWN_ANGLE, currentRotation));

    const nearBottomFactor = Math.max(0, 1 - settleError / END_DAMPING_WINDOW_DEG);
    const adaptiveLinearDamping = DRAG_LINEAR + END_DAMPING_BOOST * nearBottomFactor * nearBottomFactor;

    const gravityTorque = GRAVITY_ACCEL * Math.sin(((DOWN_ANGLE - currentRotation) * Math.PI) / 180);
    const dragTorque =
      -adaptiveLinearDamping * currentVelocity - DRAG_QUADRATIC * currentVelocity * Math.abs(currentVelocity);
    const angularAcceleration = gravityTorque + dragTorque;

    const nextVelocity = currentVelocity + angularAcceleration * dtSeconds;
    const nextRotation = currentRotation + nextVelocity * dtSeconds;

    velocityRef.current = nextVelocity;
    rotationRef.current = nextRotation;
    setRotation(nextRotation);

    const settleErrorNext = Math.abs(angleDiff(DOWN_ANGLE, nextRotation));
    if (Math.abs(nextVelocity) < STOP_SPEED && settleErrorNext < STOP_ANGLE_ERROR) {
      settleFramesRef.current += 1;
    } else {
      settleFramesRef.current = 0;
    }

    if (settleFramesRef.current >= STOP_STABLE_FRAMES) {
      stopSimulation(DOWN_ANGLE);
      return;
    }

    rafRef.current = requestAnimationFrame(step);
  };

  const spin = () => {
    if (spinning) {
      return;
    }

    const direction = Math.random() > 0.5 ? 1 : -1;
    const impulse = IMPULSE_MIN + Math.random() * (IMPULSE_MAX - IMPULSE_MIN);

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

  return (
    <div className="blank-page">
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
        <p>result: {result}</p>
      </div>
    </div>
  );
}
